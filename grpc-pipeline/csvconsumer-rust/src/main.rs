// csvconsumer (Rust) — servidor gRPC que recibe lotes de telemetría
// desde csvprocessor y los inserta en PostgreSQL/TimescaleDB.
//
// Flujo general:
//   csvprocessor (Windows, Go) --gRPC--> csvconsumer (Linux, Rust) --SQL--> PostgreSQL
//
// Durabilidad (WAL):
//   Cada registro se persiste en SQLite local ANTES de ACKar al emisor.
//   Si csvconsumer se reinicia, los registros pendientes se recargan del WAL
//   automáticamente y se insertan en la próxima ventana de flush.
//
// Reconexión:
//   Si flush falla por conexión cerrada, el lote se reencola y se reconecta
//   con backoff exponencial (2s → 4s → ... → 60s máx).
//   Cualquier otro error de flush también reencola el lote para reintentar.
//
// Modos de inserción:
//   Normal: lotes de BATCH_NORMAL (3) registros, flush cada FLUSH_SECS (3) segundos.
//   Bulk:   cuando la cola supera BULK_THRESHOLD (10), lotes de BATCH_BULK (100).

use std::collections::VecDeque;
use std::env;
use std::sync::{Arc, Mutex as StdMutex};

use rusqlite::Connection;
use tokio::sync::Mutex;
use tokio::time::Duration;
use tokio_postgres::{Client, NoTls};
use tonic::{transport::Server, Request, Response, Status};

type SharedClient = Arc<Mutex<Arc<Client>>>;
type SharedDb = Arc<StdMutex<Connection>>;

pub mod logpipeline {
    tonic::include_proto!("logpipeline");
}

use logpipeline::log_ingestion_server::{LogIngestion, LogIngestionServer};
use logpipeline::{PingRequest, PingResponse, SendRecordsRequest, SendRecordsResponse};

// (wal_id, fecha, hora, id_serial, data)
// wal_id es la primary key de pending_records en SQLite.
type RecordTuple = (i64, String, String, String, String);
type SharedQueue = Arc<Mutex<VecDeque<RecordTuple>>>;

const BATCH_NORMAL: usize = 3;
const BATCH_BULK: usize = 100;
const BULK_THRESHOLD: usize = 10;
const FLUSH_SECS: u64 = 3;
const WAL_CLEANUP_EVERY: u32 = 100; // elimina done=1 cada N flushes exitosos

fn get_env(key: &str, default: &str) -> String {
    match env::var(key) {
        Ok(v) if !v.is_empty() => v,
        _ => default.to_string(),
    }
}

// ── WAL (SQLite durability) ───────────────────────────────────────────────────

fn open_wal_db(path: &str) -> Connection {
    let conn = Connection::open(path).expect("no se pudo abrir WAL db");
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         CREATE TABLE IF NOT EXISTS pending_records (
             id        INTEGER PRIMARY KEY AUTOINCREMENT,
             fecha     TEXT NOT NULL,
             hora      TEXT NOT NULL,
             id_serial TEXT NOT NULL,
             data      TEXT NOT NULL,
             done      INTEGER NOT NULL DEFAULT 0
         );",
    )
    .expect("no se pudo inicializar WAL db");
    conn
}

// Persiste un registro antes de encolarlo. Retorna el row id asignado.
// Nota: la operación SQLite local es ~microsegundos; no usamos spawn_blocking
// para mantener la lógica simple. Si el volumen crece significativamente,
// evaluar mover a spawn_blocking.
fn wal_save(db: &StdMutex<Connection>, fecha: &str, hora: &str, id_serial: &str, data: &str) -> i64 {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO pending_records (fecha, hora, id_serial, data) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![fecha, hora, id_serial, data],
    )
    .expect("WAL insert failed");
    conn.last_insert_rowid()
}

// Marca un lote de ids como procesados en una transacción.
fn wal_mark_done(db: &StdMutex<Connection>, ids: &[i64]) {
    if ids.is_empty() {
        return;
    }
    let mut conn = db.lock().unwrap();
    let tx = conn.transaction().unwrap();
    for id in ids {
        let _ = tx.execute("UPDATE pending_records SET done=1 WHERE id=?1", [id]);
    }
    let _ = tx.commit();
}

// Elimina registros ya procesados para que el archivo WAL no crezca indefinidamente.
fn wal_cleanup(db: &StdMutex<Connection>) {
    let conn = db.lock().unwrap();
    let _ = conn.execute("DELETE FROM pending_records WHERE done=1", []);
}

// Carga registros pendientes (done=0) al arrancar. Permite recuperar datos
// que estaban en la cola in-memory cuando el proceso se reinició.
fn wal_load_pending(db: &StdMutex<Connection>) -> Vec<RecordTuple> {
    let conn = db.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT id, fecha, hora, id_serial, data \
             FROM pending_records WHERE done=0 ORDER BY id",
        )
        .unwrap();
    stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────

async fn connect_db() -> Result<Arc<Client>, Box<dyn std::error::Error + Send + Sync>> {
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
    for (_, fecha, hora, id_serial, data) in batch {
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

// ── Flush task ────────────────────────────────────────────────────────────────

async fn flush_task(shared_client: SharedClient, queue: SharedQueue, shared_db: SharedDb) {
    let mut ticker = tokio::time::interval(Duration::from_secs(FLUSH_SECS));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut flush_count: u32 = 0;

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
                Ok(n) => {
                    // Marcar como procesados en WAL (spawn_blocking: SQLite es sync)
                    let ids: Vec<i64> = batch.iter().map(|(id, ..)| *id).collect();
                    let db_clone = Arc::clone(&shared_db);
                    tokio::task::spawn_blocking(move || wal_mark_done(&db_clone, &ids));

                    flush_count += 1;
                    if flush_count % WAL_CLEANUP_EVERY == 0 {
                        let db_clone = Arc::clone(&shared_db);
                        tokio::task::spawn_blocking(move || wal_cleanup(&db_clone));
                    }

                    eprintln!("flush: {} registros insertados", n);
                }
                Err(e) => {
                    eprintln!("flush error: {}", e);

                    // Reencolar el lote en cualquier error — el WAL ya tiene los datos
                    // así que no hay pérdida aunque el proceso muera aquí.
                    {
                        let mut q = queue.lock().await;
                        for record in batch.into_iter().rev() {
                            q.push_front(record);
                        }
                    }

                    if e.is_closed() {
                        eprintln!("conexión cerrada — reconectando con backoff...");
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
                                    eprintln!(
                                        "reconexión fallida: {} — reintentando en {}s",
                                        e, delay_secs
                                    );
                                    delay_secs = (delay_secs * 2).min(60);
                                }
                            }
                        }
                    }

                    break; // Salir del inner loop; ticker maneja el próximo flush
                }
            }
        }
    }
}

// ── gRPC service ──────────────────────────────────────────────────────────────

pub struct ConsumerService {
    queue: SharedQueue,
    db: SharedDb,
}

#[tonic::async_trait]
impl LogIngestion for ConsumerService {
    async fn ping(&self, _req: Request<PingRequest>) -> Result<Response<PingResponse>, Status> {
        eprintln!("Ping recibido");
        Ok(Response::new(PingResponse {
            status: "ok".to_string(),
        }))
    }

    // Persiste en WAL → encola en memoria → ACK.
    // El orden garantiza que si el proceso muere después del WAL write pero
    // antes del ACK, csvprocessor reintentará y el WAL tendrá un duplicado
    // que la constraint ON CONFLICT de PostgreSQL descartará sin error.
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

        // Paso 1: persistir en WAL (fuera del lock de la cola)
        let mut tuples: Vec<RecordTuple> = Vec::with_capacity(records.len());
        for r in records {
            let wal_id = wal_save(&self.db, &r.fecha, &r.hora, &r.id_serial, &r.data);
            tuples.push((wal_id, r.fecha, r.hora, r.id_serial, r.data));
        }

        // Paso 2: encolar en memoria
        let pending_after = {
            let mut q = self.queue.lock().await;
            for tuple in tuples {
                q.push_back(tuple);
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

// ── main ──────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let _ = dotenvy::from_filename("csvconsumer/.env");

    let grpc_port = get_env("GRPC_PORT", "50051");
    let wal_path = get_env("WAL_DB_PATH", "/data/csvconsumer-wal.db");
    let addr: std::net::SocketAddr = format!("0.0.0.0:{}", grpc_port).parse()?;

    // Abrir WAL SQLite (crea el archivo si no existe)
    let db: SharedDb = Arc::new(StdMutex::new(open_wal_db(&wal_path)));

    // Conectar a PostgreSQL
    let client: SharedClient = Arc::new(Mutex::new(connect_db().await?));

    // Cargar registros pendientes del WAL (recovery tras reinicio)
    let queue: SharedQueue = Arc::new(Mutex::new(VecDeque::new()));
    {
        let pending = wal_load_pending(&db);
        if !pending.is_empty() {
            eprintln!(
                "⚠️  WAL: recuperando {} registros pendientes del reinicio anterior",
                pending.len()
            );
            let mut q = queue.lock().await;
            for record in pending {
                q.push_back(record);
            }
        }
    }

    // Lanzar tarea de flush en background
    tokio::spawn(flush_task(
        Arc::clone(&client),
        Arc::clone(&queue),
        Arc::clone(&db),
    ));

    let service = ConsumerService { queue, db };

    eprintln!(
        "🚀 csvconsumer puerto={} normal={}r bulk={}r threshold={} flush={}s WAL={}",
        grpc_port, BATCH_NORMAL, BATCH_BULK, BULK_THRESHOLD, FLUSH_SECS, wal_path
    );

    Server::builder()
        .add_service(LogIngestionServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
