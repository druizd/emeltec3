// csvconsumer (Rust) — servidor gRPC que recibe lotes de telemetría
// desde csvprocessor y los inserta en PostgreSQL/TimescaleDB.
//
// Flujo general:
//   csvprocessor (Windows, Go) --gRPC--> csvconsumer (Linux, Rust) --SQL--> PostgreSQL
//
// Servicios expuestos (ver proto/logpipeline.proto):
//   - Ping        → health check simple
//   - SendRecords → recibe lote de TelemetryRecord y los persiste

use std::env;
use std::sync::Arc;

use tokio_postgres::{Client, NoTls};
use tonic::{transport::Server, Request, Response, Status};

// Módulo generado en tiempo de build a partir de logpipeline.proto.
// build.rs invoca tonic-build, que escribe el código en OUT_DIR y
// `include_proto!` lo trae a este árbol con el nombre del paquete proto.
pub mod logpipeline {
    tonic::include_proto!("logpipeline");
}

use logpipeline::log_ingestion_server::{LogIngestion, LogIngestionServer};
use logpipeline::{PingRequest, PingResponse, SendRecordsRequest, SendRecordsResponse};

// Lee una variable de entorno. Si está vacía o no existe, devuelve `default`.
fn get_env(key: &str, default: &str) -> String {
    match env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => default.to_string(),
    }
}

// Abre la conexión a PostgreSQL usando variables de entorno (DB_HOST/PORT/...).
// tokio_postgres separa el `Client` (handle de queries) del `Connection`
// (driver del socket): el Connection debe correr en su propia task con
// `tokio::spawn` o las queries se quedan colgadas.
async fn connect_db() -> Result<Arc<Client>, Box<dyn std::error::Error>> {
    let host = get_env("DB_HOST", "host.docker.internal");
    let port = get_env("DB_PORT", "5433");
    let name = get_env("DB_NAME", "db_infra");
    let user = get_env("DB_USER", "admin_infra");
    let password = get_env("DB_PASSWORD", "Infra2026Secure!");

    let conn_str = format!(
        "host={} port={} dbname={} user={} password={} sslmode=disable",
        host, port, name, user, password
    );

    let (client, connection) = tokio_postgres::connect(&conn_str, NoTls).await?;

    // Driver del socket: lee/escribe sobre el TCP en segundo plano.
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("conexión PostgreSQL terminada: {}", e);
        }
    });

    eprintln!("✅ conexión a PostgreSQL exitosa");
    Ok(Arc::new(client))
}

// Estado compartido por todas las llamadas gRPC.
// `Arc<Client>` permite clonar refs baratas; tokio_postgres::Client
// es Send+Sync y serializa internamente las queries por pipeline.
pub struct ConsumerService {
    client: Arc<Client>,
}

// Implementación del trait generado por tonic-build a partir del
// `service LogIngestion` del .proto. Cada `rpc` se vuelve un método async.
#[tonic::async_trait]
impl LogIngestion for ConsumerService {
    // Health check: el processor lo usa para validar conectividad.
    async fn ping(
        &self,
        _req: Request<PingRequest>,
    ) -> Result<Response<PingResponse>, Status> {
        eprintln!("Ping recibido");
        Ok(Response::new(PingResponse {
            status: "ok".to_string(),
        }))
    }

    // Recibe un lote y lo inserta fila por fila en la tabla `equipo`.
    async fn send_records(
        &self,
        req: Request<SendRecordsRequest>,
    ) -> Result<Response<SendRecordsResponse>, Status> {
        // `into_inner()` extrae el mensaje del envoltorio gRPC (que también
        // contiene metadata, deadlines, etc.).
        let req = req.into_inner();
        let filename = req.filename;
        let records = req.records;

        // Lote vacío: respondemos ok=true con mensaje informativo (paridad con la versión Go).
        if records.is_empty() {
            return Ok(Response::new(SendRecordsResponse {
                ok: true,
                inserted: 0,
                duplicates: 0,
                message: "el lote no contiene registros".to_string(),
            }));
        }

        // Validación mínima de cada registro. Al primer fallo, cortamos
        // el lote y devolvemos ok=true con el mensaje (no es error gRPC,
        // es resultado de negocio — mismo contrato que el Go original).
        for (i, r) in records.iter().enumerate() {
            let bad = if r.id_serial.trim().is_empty() {
                Some(format!("registro {} sin id_serial", i))
            } else if r.fecha.trim().is_empty() {
                Some(format!("registro {} sin fecha", i))
            } else if r.hora.trim().is_empty() {
                Some(format!("registro {} sin hora", i))
            } else if r.data.trim().is_empty() {
                Some(format!("registro {} sin data", i))
            } else {
                None
            };
            if let Some(message) = bad {
                return Ok(Response::new(SendRecordsResponse {
                    ok: true,
                    inserted: 0,
                    duplicates: 0,
                    message,
                }));
            }
        }

        // Contadores del lote. `duplicates` queda en 0 porque el INSERT
        // actual no maneja ON CONFLICT (replica el comportamiento Go).
        let mut inserted: i32 = 0;
        let duplicates: i32 = 0;

        // Inserción fila por fila. El INSERT concatena fecha y hora,
        // los castea a `timestamptz` interpretándolos como UTC, y deja
        // el campo `data` como JSONB (`$4::text::jsonb` fuerza el tipo
        // del parámetro a `text` para que tokio_postgres pueda serializar
        // un String — sin el doble cast, prepare detecta jsonb y falla).
        for record in &records {
            let res = self
                .client
                .execute(
                    "INSERT INTO equipo (time, id_serial, data) VALUES (($1 || ' ' || $2)::timestamptz AT TIME ZONE 'UTC', $3, $4::text::jsonb)",
                    &[&record.fecha, &record.hora, &record.id_serial, &record.data],
                )
                .await;

            match res {
                Ok(_) => inserted += 1,
                Err(e) => {
                    // Error de BD: lo logueamos y respondemos con Status::internal.
                    // El cliente recibe un error gRPC (no un response con ok=false).
                    eprintln!("error procesando lote [{}]: {}", filename, e);
                    return Err(Status::internal(
                        "error insertando registros en PostgreSQL",
                    ));
                }
            }
        }

        let message = format!("lote [{}] procesado correctamente", filename);
        eprintln!(
            "lote recibido desde archivo [{}]: insertados={} duplicados={}",
            filename, inserted, duplicates
        );

        Ok(Response::new(SendRecordsResponse {
            ok: true,
            inserted,
            duplicates,
            message,
        }))
    }
}

// Entrypoint. `#[tokio::main]` arranca el runtime async multi-thread.
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Carga opcional de un .env local (útil corriendo fuera de Docker).
    let _ = dotenvy::from_filename("csvconsumer/.env");

    let grpc_port = get_env("GRPC_PORT", "50051");
    // Bind a 0.0.0.0 (IPv4 wildcard) para que clientes Windows
    // alcancen el servidor sin depender de IPv6 dual-stack.
    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", grpc_port).parse()?;

    let client = connect_db().await?;
    let service = ConsumerService { client };

    eprintln!("🚀 csvconsumer escuchando en puerto {}", grpc_port);

    // Levanta el servidor tonic y queda bloqueado hasta que reciba SIGTERM/SIGINT.
    Server::builder()
        .add_service(LogIngestionServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
