use std::env;
use std::net::SocketAddr;
use std::sync::Arc;

use chrono::{NaiveDate, NaiveTime};
use serde_json::Value;
use tokio::sync::Mutex;
use tokio_postgres::{Client, NoTls};
use tonic::{transport::Server, Request, Response, Status};
use tracing::{error, info};

pub mod logpipeline {
    tonic::include_proto!("logpipeline");
}

use logpipeline::TelemetryRecord;
use logpipeline::log_ingestion_server::{LogIngestion, LogIngestionServer};
use logpipeline::{PingRequest, PingResponse, SendRecordsRequest, SendRecordsResponse};

fn get_env(key: &str, default: &str) -> String {
    match env::var(key) {
        Ok(value) if !value.trim().is_empty() => value,
        _ => default.to_string(),
    }
}

async fn connect_db() -> Result<Client, Box<dyn std::error::Error>> {
    let host = get_env("DB_HOST", "localhost");
    let port = get_env("DB_PORT", "5433");
    let name = get_env("DB_NAME", "telemetry_platform");
    let user = get_env("DB_USER", "postgres");
    let password = get_env("DB_PASSWORD", "");

    let conn_str = format!(
        "host={} port={} dbname={} user={} password={} sslmode=disable",
        host, port, name, user, password
    );

    let (client, connection) = tokio_postgres::connect(&conn_str, NoTls).await?;

    tokio::spawn(async move {
        if let Err(err) = connection.await {
            error!("conexion PostgreSQL terminada: {}", err);
        }
    });

    info!("conexion a PostgreSQL exitosa");
    Ok(client)
}

struct InsertRecord {
    fecha: String,
    hora: String,
    id_serial: String,
    data: Value,
}

fn validate_record(idx: usize, record: &TelemetryRecord) -> Result<InsertRecord, String> {
    if record.id_serial.trim().is_empty() {
        return Err(format!("registro {} sin id_serial", idx));
    }
    if NaiveDate::parse_from_str(record.fecha.trim(), "%Y-%m-%d").is_err() {
        return Err(format!("registro {} con fecha invalida", idx));
    }
    if NaiveTime::parse_from_str(record.hora.trim(), "%H:%M:%S").is_err() {
        return Err(format!("registro {} con hora invalida", idx));
    }

    let data: Value = serde_json::from_str(record.data.trim())
        .map_err(|err| format!("registro {} con data JSON invalida: {}", idx, err))?;
    if !data.is_object() {
        return Err(format!("registro {} data debe ser objeto JSON", idx));
    }

    Ok(InsertRecord {
        fecha: record.fecha.trim().to_string(),
        hora: record.hora.trim().to_string(),
        id_serial: record.id_serial.trim().to_string(),
        data,
    })
}

async fn insert_records(
    client: &mut Client,
    records: &[InsertRecord],
) -> Result<u64, tokio_postgres::Error> {
    let transaction = client.transaction().await?;
    let statement = transaction
        .prepare(
            "INSERT INTO equipo (time, id_serial, data)
             SELECT ($1 || ' ' || $2)::timestamptz AT TIME ZONE 'UTC', $3::varchar(50), $4
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM equipo
                 WHERE time = (($1 || ' ' || $2)::timestamptz AT TIME ZONE 'UTC')
                   AND id_serial = $3::varchar(50)
                   AND data = $4
             )",
        )
        .await?;

    let mut inserted = 0;
    for record in records {
        inserted += transaction
            .execute(
                &statement,
                &[&record.fecha, &record.hora, &record.id_serial, &record.data],
            )
            .await?;
    }

    transaction.commit().await?;
    Ok(inserted)
}

struct ConsumerService {
    db: Arc<Mutex<Client>>,
}

#[tonic::async_trait]
impl LogIngestion for ConsumerService {
    async fn ping(&self, _req: Request<PingRequest>) -> Result<Response<PingResponse>, Status> {
        Ok(Response::new(PingResponse {
            status: "ok".to_string(),
        }))
    }

    async fn send_records(
        &self,
        req: Request<SendRecordsRequest>,
    ) -> Result<Response<SendRecordsResponse>, Status> {
        let req = req.into_inner();
        if req.records.is_empty() {
            return Ok(Response::new(SendRecordsResponse {
                ok: true,
                inserted: 0,
                duplicates: 0,
                message: "el lote no contiene registros".to_string(),
            }));
        }

        let mut parsed = Vec::with_capacity(req.records.len());
        for (idx, record) in req.records.iter().enumerate() {
            match validate_record(idx, record) {
                Ok(item) => parsed.push(item),
                Err(message) => {
                    return Ok(Response::new(SendRecordsResponse {
                        ok: false,
                        inserted: 0,
                        duplicates: 0,
                        message,
                    }));
                }
            }
        }

        let mut client = self.db.lock().await;
        let inserted = match insert_records(&mut client, &parsed).await {
            Ok(count) => count,
            Err(err) => {
                error!("insert error [{}]: {}", req.filename, err);
                return Err(Status::internal(format!("db: {}", err)));
            }
        };

        info!(
            "lote recibido [{}]: {} registros insertados",
            req.filename, inserted
        );

        Ok(Response::new(SendRecordsResponse {
            ok: true,
            inserted: inserted as i32,
            duplicates: 0,
            message: format!("lote [{}] insertado", req.filename),
        }))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(get_env("RUST_LOG", "info"))
        .init();

    let port = get_env("FTP_CONSUMER_PORT", "50061");
    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse()?;
    let db = connect_db().await?;
    let service = ConsumerService {
        db: Arc::new(Mutex::new(db)),
    };

    info!("ftpconsumer gRPC escuchando en {}", addr);

    Server::builder()
        .add_service(LogIngestionServer::new(service))
        .serve_with_shutdown(addr, shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        let mut signal = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("instalar handler SIGTERM");
        signal.recv().await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}
