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
// send_records valida, encola y responde inmediatamente; la inserción real
// es async en flush_task con hasta MAX_FLUSH_RETRIES reintentos por lote.

use std::collections::VecDeque;
use std::env;
use std::sync::Arc;

use chrono::{NaiveDate, NaiveTime};
use tokio::sync::Mutex;
use tokio::time::Duration;
use tokio_postgres::{Client, NoTls};
use tonic::{transport::Server, Request, Response, Status};

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
const MAX_QUEUE_SIZE: usize = 50_000;       // V-089: backpressure
const MAX_RECORDS_PER_REQUEST: usize = 500; // V-090: límite por request
const MAX_FIELD_LEN: usize = 256;           // V-090: longitud máx id_serial/fecha/hora
const MAX_DATA_LEN: usize = 8_192;          // V-090: longitud máx JSON data (8 KB)
const MAX_FILENAME_DISPLAY: usize = 120;    // V-097: longitud log filename
const MAX_FLUSH_RETRIES: u32 = 3;           // V-092: reintentos por lote fallido

fn get_env(key: &str, default: &str) -> String {
    match env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => default.to_string(),
    }
}

/// Comparación en tiempo constante para evitar timing attacks en verificación de API key.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let len = a.len().max(b.len());
    let mut diff: u8 = 0;
    for i in 0..len {
        let x = if i < a.len() { a[i] } else { 0 };
        let y = if i < b.len() { b[i] } else { 0 };
        diff |= x ^ y;
    }
    // También diferencia de longitud
    diff |= (a.len() ^ b.len()) as u8;
    diff == 0
}

/// Sanitiza strings de cliente para logs: solo ASCII imprimible.
fn sanitize_log(s: &str, max_len: usize) -> String {
    s.chars()
        .filter(|c| c.is_ascii_graphic() || *c == ' ')
        .take(max_len)
        .collect()
}

async fn connect_db() -> Result<Arc<Client>, Box<dyn std::error::Error>> {
    let host = get_env("DB_HOST", "host.docker.internal");
    let port = get_env("DB_PORT", "5433");
    let name = get_env("DB_NAME", "db_infra");
    let user = get_env("DB_USER", "admin_infra");
    let password = get_env("DB_PASSWORD", "");
    // V-088: sslmode controlado por variable de entorno.
    // Dentro de red Docker privada aislada se acepta "disable"; en producción
    // expuesta usar "require" o "verify-full".
    let sslmode = get_env("DB_SSLMODE", "disable");

    let conn_str = format!(
        "host={} port={} dbname={} user={} password={} sslmode={}",
        host, port, name, user, password, sslmode
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
// V-100: ON CONFLICT DO NOTHING deduplicar reintentos del csvprocessor.
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
            b + 1,
            b + 2,
            b + 3,
            b + 4
        ));
    }
    query.push_str(" ON CONFLICT DO NOTHING");

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
// V-092: reintenta hasta MAX_FLUSH_RETRIES veces con backoff exponencial.
// Si agota reintentos, registra el lote en dead-letter a stderr.
async fn flush_task(client: Arc<Client>, queue: SharedQueue) {
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

            let mut success = false;
            for attempt in 1..=MAX_FLUSH_RETRIES {
                match insert_batch(&client, &batch).await {
                    Ok(n) => {
                        eprintln!("flush: {} insertados ({} en lote)", n, batch.len());
                        success = true;
                        break;
                    }
                    Err(e) => {
                        eprintln!(
                            "flush error (intento {}/{}): {}",
                            attempt, MAX_FLUSH_RETRIES, e
                        );
                        if attempt < MAX_FLUSH_RETRIES {
                            tokio::time::sleep(Duration::from_millis(500 * attempt as u64))
                                .await;
                        }
                    }
                }
            }

            if !success {
                eprintln!(
                    "[DEAD-LETTER] {} registros descartados tras {} intentos fallidos:",
                    batch.len(),
                    MAX_FLUSH_RETRIES
                );
                for (fecha, hora, id_serial, _) in &batch {
                    eprintln!(
                        "  serial={} fecha={} hora={}",
                        sanitize_log(id_serial, 64),
                        sanitize_log(fecha, 16),
                        sanitize_log(hora, 16)
                    );
                }
            }
        }
    }
}

pub struct ConsumerService {
    queue: SharedQueue,
    api_key: String,
}

impl ConsumerService {
    /// V-087: verifica API key en metadata gRPC con comparación en tiempo constante.
    /// Si GRPC_API_KEY no está configurado, permite todo con advertencia.
    fn verify_api_key<T>(&self, req: &Request<T>) -> Result<(), Status> {
        if self.api_key.is_empty() {
            return Ok(());
        }
        let provided = req
            .metadata()
            .get("x-api-key")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !constant_time_eq(provided.as_bytes(), self.api_key.as_bytes()) {
            return Err(Status::unauthenticated("api key inválida o ausente"));
        }
        Ok(())
    }
}

#[tonic::async_trait]
impl LogIngestion for ConsumerService {
    async fn ping(&self, req: Request<PingRequest>) -> Result<Response<PingResponse>, Status> {
        self.verify_api_key(&req)?;
        eprintln!("Ping recibido");
        Ok(Response::new(PingResponse {
            status: "ok".to_string(),
        }))
    }

    // Valida y encola los registros. Responde inmediatamente; inserción real
    // ocurre en flush_task (async) con reintentos. V-091: message clarifica semántica.
    async fn send_records(
        &self,
        req: Request<SendRecordsRequest>,
    ) -> Result<Response<SendRecordsResponse>, Status> {
        self.verify_api_key(&req)?;

        let req = req.into_inner();
        // V-097: sanitizar filename de cliente antes de usarlo en logs
        let filename = sanitize_log(&req.filename, MAX_FILENAME_DISPLAY);
        let records = req.records;

        // V-090: límite de records por request
        if records.len() > MAX_RECORDS_PER_REQUEST {
            return Err(Status::invalid_argument(format!(
                "el lote supera el límite de {} registros por request",
                MAX_RECORDS_PER_REQUEST
            )));
        }

        if records.is_empty() {
            return Ok(Response::new(SendRecordsResponse {
                ok: true,
                inserted: 0,
                duplicates: 0,
                message: "el lote no contiene registros".to_string(),
            }));
        }

        // V-093/094/095: validar cada registro; retorna invalid_argument en vez de ok=true
        for (i, r) in records.iter().enumerate() {
            // V-090: longitudes máximas
            if r.id_serial.len() > MAX_FIELD_LEN {
                return Err(Status::invalid_argument(format!(
                    "registro {}: id_serial supera {} bytes",
                    i, MAX_FIELD_LEN
                )));
            }
            if r.data.len() > MAX_DATA_LEN {
                return Err(Status::invalid_argument(format!(
                    "registro {}: data supera {} bytes",
                    i, MAX_DATA_LEN
                )));
            }
            // campos requeridos no vacíos
            if r.id_serial.trim().is_empty() {
                return Err(Status::invalid_argument(format!("registro {} sin id_serial", i)));
            }
            if r.fecha.trim().is_empty() {
                return Err(Status::invalid_argument(format!("registro {} sin fecha", i)));
            }
            if r.hora.trim().is_empty() {
                return Err(Status::invalid_argument(format!("registro {} sin hora", i)));
            }
            if r.data.trim().is_empty() {
                return Err(Status::invalid_argument(format!("registro {} sin data", i)));
            }
            // V-095: formato estricto fecha YYYY-MM-DD y hora HH:MM:SS
            if NaiveDate::parse_from_str(r.fecha.trim(), "%Y-%m-%d").is_err() {
                return Err(Status::invalid_argument(format!(
                    "registro {}: fecha '{}' no es YYYY-MM-DD",
                    i,
                    sanitize_log(&r.fecha, 16)
                )));
            }
            if NaiveTime::parse_from_str(r.hora.trim(), "%H:%M:%S").is_err() {
                return Err(Status::invalid_argument(format!(
                    "registro {}: hora '{}' no es HH:MM:SS",
                    i,
                    sanitize_log(&r.hora, 16)
                )));
            }
            // V-094: validar JSON antes de encolar para aislar registros inválidos
            if serde_json::from_str::<serde_json::Value>(r.data.trim()).is_err() {
                return Err(Status::invalid_argument(format!(
                    "registro {}: data no es JSON válido",
                    i
                )));
            }
        }

        let count = records.len() as i32;

        // V-089: rechazar si la cola está llena (backpressure)
        let pending_after = {
            let mut q = self.queue.lock().await;
            if q.len() + records.len() > MAX_QUEUE_SIZE {
                return Err(Status::resource_exhausted(format!(
                    "cola llena ({} pendientes), reintenta más tarde",
                    q.len()
                )));
            }
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
            // V-091: message deja claro que son aceptados en cola, no insertados aún
            message: format!(
                "{} registros aceptados en cola (flush async modo {})",
                count, mode
            ),
        }))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // V-099: loguear si .env no se carga para evitar arranque con defaults inseguros sin aviso
    match dotenvy::from_filename("csvconsumer/.env") {
        Ok(_) => eprintln!("[INFO] .env cargado"),
        Err(e) => eprintln!(
            "[INFO] .env no cargado ({}), usando variables de entorno del proceso",
            e
        ),
    }

    let grpc_port = get_env("GRPC_PORT", "50051");
    // V-086: GRPC_BIND_HOST permite restringir el bind dentro del contenedor.
    // Default 0.0.0.0 requerido para aceptar conexiones inter-contenedor Docker;
    // el acceso externo está controlado por el port binding 127.0.0.1 en docker-compose.
    let bind_host = get_env("GRPC_BIND_HOST", "0.0.0.0");
    let addr: std::net::SocketAddr = format!("{}:{}", bind_host, grpc_port).parse()?;

    let api_key = get_env("GRPC_API_KEY", "");
    if api_key.is_empty() {
        eprintln!("[WARN] GRPC_API_KEY no configurado — endpoint gRPC sin autenticación");
    }

    let client = connect_db().await?;
    let queue: SharedQueue = Arc::new(Mutex::new(VecDeque::new()));

    tokio::spawn(flush_task(Arc::clone(&client), Arc::clone(&queue)));

    let service = ConsumerService { queue, api_key };

    eprintln!(
        "🚀 csvconsumer escuchando en {}:{} | normal={}r bulk={}r threshold={} flush={}s max_queue={}",
        bind_host, grpc_port, BATCH_NORMAL, BATCH_BULK, BULK_THRESHOLD, FLUSH_SECS, MAX_QUEUE_SIZE
    );

    Server::builder()
        .add_service(LogIngestionServer::new(service).max_decoding_message_size(4 * 1024 * 1024))
        .serve(addr)
        .await?;

    Ok(())
}
