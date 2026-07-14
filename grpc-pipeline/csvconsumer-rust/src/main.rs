// csvconsumer (Rust) — servidor gRPC que recibe lotes de telemetría
// desde csvprocessor y los inserta en PostgreSQL/TimescaleDB.
//
// Flujo general:
//   csvprocessor (Windows, Go) --gRPC--> csvconsumer (Linux, Rust) --SQL--> PostgreSQL
//
// Modos de inserción (gestionados por flush_task en segundo plano):
//   Normal: lotes de BATCH_NORMAL (3) registros, flush cada FLUSH_SECS (3) segundos.
//   Bulk:   cuando la cola supera BULK_THRESHOLD (10), lotes de BATCH_BULK (100).
//
// send_records encola y responde inmediatamente; la inserción real es async.

use std::collections::VecDeque;
use std::env;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio::time::Duration;
use tokio_postgres::{Client, NoTls};
use tonic::{transport::Server, Request, Response, Status};

type SharedClient = Arc<Mutex<Arc<Client>>>;

pub mod logpipeline {
    tonic::include_proto!("logpipeline");
}

use logpipeline::log_ingestion_server::{LogIngestion, LogIngestionServer};
use logpipeline::{PingRequest, PingResponse, SendRecordsRequest, SendRecordsResponse};

// (fecha, hora, id_serial, data)
type RecordTuple = (String, String, String, String);
type SharedQueue = Arc<Mutex<VecDeque<RecordTuple>>>;

const BATCH_NORMAL: usize = 3;
const BATCH_BULK: usize = 100;
const BULK_THRESHOLD: usize = 10;
const FLUSH_SECS: u64 = 3;

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
    let password = get_env("DB_PASSWORD", "");

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

// Inserta un lote en una sola transacción usando multi-row INSERT.
// Un round-trip a PostgreSQL por lote completo.
async fn insert_batch(client: &Client, batch: &[RecordTuple]) -> Result<u64, tokio_postgres::Error> {
    client.execute("BEGIN", &[]).await?;

    let mut param_strs: Vec<&str> = Vec::with_capacity(batch.len() * 4);
    for (fecha, hora, id_serial, data) in batch {
        param_strs.push(fecha);
        param_strs.push(hora);
        param_strs.push(id_serial);
        param_strs.push(data);
    }

    let mut query = String::from("INSERT INTO equipo (time, id_serial, data) VALUES ");
    for i in 0..batch.len() {
        let b = i * 4;
        if i > 0 {
            query.push_str(", ");
        }
        query.push_str(&format!(
            "((${}  || ' ' || ${})::timestamptz AT TIME ZONE 'UTC', ${}, ${}::text::jsonb)",
            b + 1, b + 2, b + 3, b + 4
        ));
    }

    let params: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = param_strs
        .iter()
        .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
        .collect();

    match client.execute(&query[..], &params[..]).await {
        Ok(n) => {
            client.execute("COMMIT", &[]).await?;
            Ok(n)
        }
        Err(e) => {
            let _ = client.execute("ROLLBACK", &[]).await;
            Err(e)
        }
    }
}

// Tarea de fondo: desencola y persiste cada FLUSH_SECS segundos.
//
// Modo normal (cola <= BULK_THRESHOLD):
//   Extrae hasta BATCH_NORMAL registros y los inserta. Si hay menos de
//   BATCH_NORMAL en la cola, los envía igual (no espera más).
//
// Modo bulk (cola > BULK_THRESHOLD):
//   Extrae hasta BATCH_BULK registros por iteración hasta vaciar la cola.
//   Útil cuando hay muchos archivos acumulados: drena más rápido.
//
// Reconexión: si el flush falla por conexión cerrada, reconecta con backoff
// y reencola el lote para no perder datos.
async fn flush_task(shared_client: SharedClient, queue: SharedQueue) {
    let mut ticker = tokio::time::interval(Duration::from_secs(FLUSH_SECS));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;

        loop {
            let batch: Vec<RecordTuple> = {
                let mut q = queue.lock().await;
                let pending = q.len();
                if pending == 0 {
                    break;
                }

                let batch_size = if pending > BULK_THRESHOLD {
                    BATCH_BULK
                } else {
                    BATCH_NORMAL
                };

                let take = batch_size.min(pending);
                q.drain(..take).collect()
            };

            if batch.is_empty() {
                break;
            }

            let client = shared_client.lock().await.clone();
            match insert_batch(&client, &batch).await {
                Ok(n) => eprintln!("flush: {} registros insertados", n),
                Err(e) => {
                    eprintln!("flush error: {}", e);
                    if e.is_closed() {
                        eprintln!("conexión cerrada — reconectando...");
                        // Reencolar el lote antes de reconectar para no perder datos.
                        {
                            let mut q = queue.lock().await;
                            for record in batch.into_iter().rev() {
                                q.push_front(record);
                            }
                        }
                        let mut delay_secs = 2u64;
                        loop {
                            tokio::time::sleep(Duration::from_secs(delay_secs)).await;
                            match connect_db().await {
                                Ok(new_client) => {
                                    *shared_client.lock().await = new_client;
                                    eprintln!("reconexión exitosa");
                                    break;
                                }
                                Err(e) => {
                                    eprintln!("reconexión fallida: {} — reintentando en {}s", e, delay_secs);
                                    delay_secs = (delay_secs * 2).min(60);
                                }
                            }
                        }
                        break; // Salir del inner loop; el ticker maneja el próximo flush.
                    }
                }
            }
        }
    }
}

pub struct ConsumerService {
    queue: SharedQueue,
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

    // Valida y encola los registros. Responde inmediatamente sin esperar
    // la inserción en DB (que ocurre en flush_task cada FLUSH_SECS segundos).
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

        let count = records.len() as i32;
        let pending_after = {
            let mut q = self.queue.lock().await;
            for r in records {
                q.push_back((r.fecha, r.hora, r.id_serial, r.data));
            }
            q.len()
        };

        let mode = if pending_after > BULK_THRESHOLD { "bulk" } else { "normal" };
        eprintln!(
            "lote encolado [{}]: {} registros | cola={} modo={}",
            filename, count, pending_after, mode
        );

        Ok(Response::new(SendRecordsResponse {
            ok: true,
            inserted: count,
            duplicates: 0,
            message: format!("lote [{}] encolado (modo {})", filename, mode),
        }))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::from_filename("csvconsumer/.env");

    let grpc_port = get_env("GRPC_PORT", "50051");
    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", grpc_port).parse()?;

    let client: SharedClient = Arc::new(Mutex::new(connect_db().await?));
    let queue: SharedQueue = Arc::new(Mutex::new(VecDeque::new()));

    // Lanzar tarea de fondo antes de aceptar conexiones gRPC.
    tokio::spawn(flush_task(Arc::clone(&client), Arc::clone(&queue)));

    let service = ConsumerService { queue };

    eprintln!(
        "🚀 csvconsumer escuchando en puerto {} | normal={}r bulk={}r threshold={} flush={}s",
        grpc_port, BATCH_NORMAL, BATCH_BULK, BULK_THRESHOLD, FLUSH_SECS
    );

    Server::builder()
        .add_service(LogIngestionServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
