use std::env;
use std::sync::Arc;

use tokio_postgres::{Client, NoTls};
use tonic::{transport::Server, Request, Response, Status};

pub mod logpipeline {
    tonic::include_proto!("logpipeline");
}

use logpipeline::log_ingestion_server::{LogIngestion, LogIngestionServer};
use logpipeline::{PingRequest, PingResponse, SendRecordsRequest, SendRecordsResponse};

fn get_env(key: &str, default: &str) -> String {
    match env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => default.to_string(),
    }
}

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

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("conexión PostgreSQL terminada: {}", e);
        }
    });

    eprintln!("✅ conexión a PostgreSQL exitosa");
    Ok(Arc::new(client))
}

pub struct ConsumerService {
    client: Arc<Client>,
}

#[tonic::async_trait]
impl LogIngestion for ConsumerService {
    async fn ping(
        &self,
        _req: Request<PingRequest>,
    ) -> Result<Response<PingResponse>, Status> {
        eprintln!("Ping recibido");
        Ok(Response::new(PingResponse {
            status: "ok".to_string(),
        }))
    }

    async fn send_records(
        &self,
        req: Request<SendRecordsRequest>,
    ) -> Result<Response<SendRecordsResponse>, Status> {
        let req = req.into_inner();
        let filename = req.filename;
        let records = req.records;

        if records.is_empty() {
            return Ok(Response::new(SendRecordsResponse {
                ok: true,
                inserted: 0,
                duplicates: 0,
                message: "el lote no contiene registros".to_string(),
            }));
        }

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

        let mut inserted: i32 = 0;
        let duplicates: i32 = 0;

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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::from_filename("csvconsumer/.env");

    let grpc_port = get_env("GRPC_PORT", "50051");
    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", grpc_port).parse()?;

    let client = connect_db().await?;
    let service = ConsumerService { client };

    eprintln!("🚀 csvconsumer escuchando en puerto {}", grpc_port);

    Server::builder()
        .add_service(LogIngestionServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
