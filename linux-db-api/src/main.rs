use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio_postgres::{Client, NoTls};
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

const DEFAULT_TOP_TABLES_LIMIT: i64 = 10;
const MAX_TOP_TABLES_LIMIT: i64 = 50;

#[derive(Clone)]
struct AppState {
    db: Arc<Client>,
    started_at: Instant,
}

#[derive(Debug, Deserialize)]
struct UsageQuery {
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
struct ApiErrorBody {
    ok: bool,
    error: String,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ApiErrorBody {
                ok: false,
                error: self.message,
            }),
        )
            .into_response()
    }
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    status: &'static str,
    uptime_s: u64,
}

#[derive(Debug, Serialize)]
struct DbUsageResponse {
    ok: bool,
    timestamp: String,
    response_time_ms: u128,
    priority_source: &'static str,
    database: DatabaseUsage,
    connections: ConnectionUsage,
    timescale: TimescaleUsage,
    top_tables: Vec<TableUsage>,
    windows_sync: WindowsSyncStatus,
}

#[derive(Debug, Serialize)]
struct DatabaseUsage {
    name: String,
    status: &'static str,
    size_bytes: i64,
    size_mb: f64,
    active_backends: i64,
    transactions: TransactionUsage,
    cache_hit_ratio: Option<f64>,
    tuples: TupleUsage,
    deadlocks: i64,
    temp_files: i64,
    temp_bytes: i64,
}

#[derive(Debug, Serialize)]
struct TransactionUsage {
    committed: i64,
    rolled_back: i64,
}

#[derive(Debug, Serialize)]
struct TupleUsage {
    returned: i64,
    fetched: i64,
    inserted: i64,
    updated: i64,
    deleted: i64,
}

#[derive(Debug, Serialize)]
struct ConnectionUsage {
    total: i64,
    active: i64,
    idle: i64,
    idle_in_transaction: i64,
    max: i64,
    usage_pct: Option<f64>,
}

#[derive(Debug, Serialize)]
struct TimescaleUsage {
    available: bool,
    hypertables: Option<i64>,
    compressed_hypertables: Option<i64>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct TableUsage {
    schema: String,
    table: String,
    live_rows_estimate: i64,
    dead_rows_estimate: i64,
    total_bytes: i64,
    total_mb: f64,
    table_bytes: i64,
    index_bytes: i64,
}

#[derive(Debug, Serialize)]
struct WindowsSyncStatus {
    status: &'static str,
    pending: Option<i64>,
    last_sync: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlcCommandQuery {
    limit: Option<i64>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreatePlcCommandRequest {
    command_id: Option<String>,
    id_serial: String,
    tag: String,
    value: Value,
    command_type: Option<String>,
    requested_by: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlcCommandResultRequest {
    status: String,
    error: Option<String>,
    response: Option<Value>,
}

#[derive(Debug, Serialize)]
struct PlcCommandResponse {
    ok: bool,
    command: PlcCommand,
}

#[derive(Debug, Serialize)]
struct PlcCommandListResponse {
    ok: bool,
    count: usize,
    commands: Vec<PlcCommand>,
}

#[derive(Debug, Serialize)]
struct PlcCommandResultResponse {
    ok: bool,
    command_id: String,
    status: String,
}

#[derive(Debug, Serialize)]
struct PlcCommand {
    command_id: String,
    id_serial: String,
    tag: String,
    value: String,
    command_type: String,
    status: String,
    requested_by: Option<String>,
    requested_at: String,
    sent_at: Option<String>,
    completed_at: Option<String>,
    error: Option<String>,
    response: Option<Value>,
}

fn get_env(key: &str, default: &str) -> String {
    match env::var(key) {
        Ok(value) if !value.trim().is_empty() => value,
        _ => default.to_string(),
    }
}

fn bytes_to_mb(bytes: i64) -> f64 {
    ((bytes as f64 / 1024.0 / 1024.0) * 100.0).round() / 100.0
}

fn pct(numerator: i64, denominator: i64) -> Option<f64> {
    if denominator <= 0 {
        return None;
    }
    Some(((numerator as f64 / denominator as f64) * 10000.0).round() / 100.0)
}

fn usage_limit(limit: Option<i64>) -> i64 {
    limit
        .unwrap_or(DEFAULT_TOP_TABLES_LIMIT)
        .clamp(1, MAX_TOP_TABLES_LIMIT)
}

fn command_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(20).clamp(1, 100)
}

fn generated_command_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("plc-{}", nanos)
}

fn required_text(value: &str, field: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request(format!("{} requerido", field)));
    }
    Ok(trimmed.to_string())
}

fn utc_now_sql() -> &'static str {
    "timezone('UTC', now())"
}

async fn connect_db() -> Result<Arc<Client>, tokio_postgres::Error> {
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
            tracing::error!(error = %err, "conexion PostgreSQL terminada");
        }
    });

    Ok(Arc::new(client))
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "linux-db-api",
        status: "online",
        uptime_s: state.started_at.elapsed().as_secs(),
    })
}

async fn db_usage(
    State(state): State<AppState>,
    Query(query): Query<UsageQuery>,
) -> Result<Json<DbUsageResponse>, ApiError> {
    let started = Instant::now();
    let limit = usage_limit(query.limit);

    let database = database_usage(&state.db).await?;
    let connections = connection_usage(&state.db).await?;
    let timescale = timescale_usage(&state.db).await;
    let top_tables = top_tables(&state.db, limit).await?;
    let timestamp = current_timestamp(&state.db).await?;

    Ok(Json(DbUsageResponse {
        ok: true,
        timestamp,
        response_time_ms: started.elapsed().as_millis(),
        priority_source: "linux",
        database,
        connections,
        timescale,
        top_tables,
        windows_sync: WindowsSyncStatus {
            status: "not_configured",
            pending: None,
            last_sync: None,
        },
    }))
}

async fn create_plc_command(
    State(state): State<AppState>,
    Json(req): Json<CreatePlcCommandRequest>,
) -> Result<(StatusCode, Json<PlcCommandResponse>), ApiError> {
    let command_id = req
        .command_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(generated_command_id);
    let id_serial = required_text(&req.id_serial, "id_serial")?;
    let tag = required_text(&req.tag, "tag")?;
    let command_type = req
        .command_type
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "write_tag".to_string());
    let value = match req.value {
        Value::String(value) => value,
        other => other.to_string(),
    };

    let row = state
        .db
        .query_one(
            "
            INSERT INTO plc_commands (
              command_id, id_serial, tag, value, command_type, requested_by
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
              command_id, id_serial, tag, value, command_type, status,
              requested_by,
              to_char(timezone('UTC', requested_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS requested_at,
              to_char(timezone('UTC', sent_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS sent_at,
              to_char(timezone('UTC', completed_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS completed_at,
              error,
              response
            ",
            &[
                &command_id,
                &id_serial,
                &tag,
                &value,
                &command_type,
                &req.requested_by,
            ],
        )
        .await
        .map_err(|err| ApiError::internal(format!("no se pudo crear comando PLC: {}", err)))?;

    Ok((
        StatusCode::CREATED,
        Json(PlcCommandResponse {
            ok: true,
            command: plc_command_from_row(&row),
        }),
    ))
}

async fn list_plc_commands(
    State(state): State<AppState>,
    Query(query): Query<PlcCommandQuery>,
) -> Result<Json<PlcCommandListResponse>, ApiError> {
    let limit = command_limit(query.limit);
    let status = query.status.unwrap_or_default();

    let rows = state
        .db
        .query(
            "
            SELECT
              command_id, id_serial, tag, value, command_type, status,
              requested_by,
              to_char(timezone('UTC', requested_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS requested_at,
              to_char(timezone('UTC', sent_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS sent_at,
              to_char(timezone('UTC', completed_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS completed_at,
              error,
              response
            FROM plc_commands
            WHERE ($1 = '' OR status = $1)
            ORDER BY requested_at DESC
            LIMIT $2
            ",
            &[&status, &limit],
        )
        .await
        .map_err(|err| ApiError::internal(format!("no se pudieron listar comandos PLC: {}", err)))?;

    let commands = rows.iter().map(plc_command_from_row).collect::<Vec<_>>();
    Ok(Json(PlcCommandListResponse {
        ok: true,
        count: commands.len(),
        commands,
    }))
}

async fn pending_plc_commands(
    State(state): State<AppState>,
    Query(query): Query<PlcCommandQuery>,
) -> Result<Json<PlcCommandListResponse>, ApiError> {
    let limit = command_limit(query.limit);

    let rows = state
        .db
        .query(
            "
            UPDATE plc_commands
            SET status = 'sent', sent_at = now()
            WHERE command_id IN (
              SELECT command_id
              FROM plc_commands
              WHERE status = 'pending'
              ORDER BY requested_at ASC
              LIMIT $1
            )
            RETURNING
              command_id, id_serial, tag, value, command_type, status,
              requested_by,
              to_char(timezone('UTC', requested_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS requested_at,
              to_char(timezone('UTC', sent_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS sent_at,
              to_char(timezone('UTC', completed_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS completed_at,
              error,
              response
            ",
            &[&limit],
        )
        .await
        .map_err(|err| ApiError::internal(format!("no se pudieron tomar comandos PLC: {}", err)))?;

    let commands = rows.iter().map(plc_command_from_row).collect::<Vec<_>>();
    Ok(Json(PlcCommandListResponse {
        ok: true,
        count: commands.len(),
        commands,
    }))
}

async fn report_plc_command_result(
    State(state): State<AppState>,
    Path(command_id): Path<String>,
    Json(req): Json<PlcCommandResultRequest>,
) -> Result<Json<PlcCommandResultResponse>, ApiError> {
    let status = required_text(&req.status, "status")?;
    if status != "done" && status != "failed" {
        return Err(ApiError::bad_request("status debe ser done o failed"));
    }
    let response = req.response.unwrap_or(Value::Null);

    let updated = state
        .db
        .execute(
            "
            UPDATE plc_commands
            SET status = $2,
                completed_at = now(),
                error = $3,
                response = $4
            WHERE command_id = $1
            ",
            &[&command_id, &status, &req.error, &response],
        )
        .await
        .map_err(|err| ApiError::internal(format!("no se pudo actualizar resultado PLC: {}", err)))?;

    if updated == 0 {
        return Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: "comando PLC no encontrado".to_string(),
        });
    }

    Ok(Json(PlcCommandResultResponse {
        ok: true,
        command_id,
        status,
    }))
}

fn plc_command_from_row(row: &tokio_postgres::Row) -> PlcCommand {
    PlcCommand {
        command_id: row.get("command_id"),
        id_serial: row.get("id_serial"),
        tag: row.get("tag"),
        value: row.get("value"),
        command_type: row.get("command_type"),
        status: row.get("status"),
        requested_by: row.get("requested_by"),
        requested_at: row.get("requested_at"),
        sent_at: row.get("sent_at"),
        completed_at: row.get("completed_at"),
        error: row.get("error"),
        response: row.get("response"),
    }
}

async fn current_timestamp(db: &Client) -> Result<String, ApiError> {
    let sql = format!(
        "SELECT to_char({}, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
        utc_now_sql()
    );
    let row = db
        .query_one(&sql, &[])
        .await
        .map_err(|err| ApiError::internal(format!("no se pudo leer timestamp: {}", err)))?;
    Ok(row.get::<_, String>(0))
}

async fn database_usage(db: &Client) -> Result<DatabaseUsage, ApiError> {
    let row = db
        .query_one(
            "
            SELECT
              current_database() AS database_name,
              pg_database_size(current_database())::bigint AS database_size_bytes,
              stats.numbackends::bigint AS active_backends,
              stats.xact_commit::bigint,
              stats.xact_rollback::bigint,
              stats.blks_read::bigint,
              stats.blks_hit::bigint,
              stats.tup_returned::bigint,
              stats.tup_fetched::bigint,
              stats.tup_inserted::bigint,
              stats.tup_updated::bigint,
              stats.tup_deleted::bigint,
              stats.deadlocks::bigint,
              stats.temp_files::bigint,
              stats.temp_bytes::bigint
            FROM pg_stat_database stats
            WHERE stats.datname = current_database()
            ",
            &[],
        )
        .await
        .map_err(|err| ApiError::internal(format!("no se pudo consultar uso de DB: {}", err)))?;

    let blks_read = row.get::<_, i64>("blks_read");
    let blks_hit = row.get::<_, i64>("blks_hit");
    let total_blocks = blks_read + blks_hit;
    let size_bytes = row.get::<_, i64>("database_size_bytes");

    Ok(DatabaseUsage {
        name: row.get("database_name"),
        status: "online",
        size_bytes,
        size_mb: bytes_to_mb(size_bytes),
        active_backends: row.get("active_backends"),
        transactions: TransactionUsage {
            committed: row.get("xact_commit"),
            rolled_back: row.get("xact_rollback"),
        },
        cache_hit_ratio: pct(blks_hit, total_blocks),
        tuples: TupleUsage {
            returned: row.get("tup_returned"),
            fetched: row.get("tup_fetched"),
            inserted: row.get("tup_inserted"),
            updated: row.get("tup_updated"),
            deleted: row.get("tup_deleted"),
        },
        deadlocks: row.get("deadlocks"),
        temp_files: row.get("temp_files"),
        temp_bytes: row.get("temp_bytes"),
    })
}

async fn connection_usage(db: &Client) -> Result<ConnectionUsage, ApiError> {
    let row = db
        .query_one(
            "
            SELECT
              COUNT(*)::bigint AS total,
              COUNT(*) FILTER (WHERE state = 'active')::bigint AS active,
              COUNT(*) FILTER (WHERE state = 'idle')::bigint AS idle,
              COUNT(*) FILTER (WHERE state = 'idle in transaction')::bigint AS idle_in_transaction,
              current_setting('max_connections')::bigint AS max_connections
            FROM pg_stat_activity
            WHERE datname = current_database()
            ",
            &[],
        )
        .await
        .map_err(|err| ApiError::internal(format!("no se pudo consultar conexiones: {}", err)))?;

    let total = row.get::<_, i64>("total");
    let max = row.get::<_, i64>("max_connections");

    Ok(ConnectionUsage {
        total,
        active: row.get("active"),
        idle: row.get("idle"),
        idle_in_transaction: row.get("idle_in_transaction"),
        max,
        usage_pct: pct(total, max),
    })
}

async fn top_tables(db: &Client, limit: i64) -> Result<Vec<TableUsage>, ApiError> {
    let rows = db
        .query(
            "
            SELECT
              schemaname,
              relname,
              n_live_tup::bigint,
              n_dead_tup::bigint,
              pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)::bigint AS total_bytes,
              pg_relation_size(format('%I.%I', schemaname, relname)::regclass)::bigint AS table_bytes,
              (
                pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)
                - pg_relation_size(format('%I.%I', schemaname, relname)::regclass)
              )::bigint AS index_bytes
            FROM pg_stat_user_tables
            ORDER BY total_bytes DESC
            LIMIT $1
            ",
            &[&limit],
        )
        .await
        .map_err(|err| ApiError::internal(format!("no se pudo consultar tablas: {}", err)))?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let total_bytes = row.get::<_, i64>("total_bytes");
            TableUsage {
                schema: row.get("schemaname"),
                table: row.get("relname"),
                live_rows_estimate: row.get("n_live_tup"),
                dead_rows_estimate: row.get("n_dead_tup"),
                total_bytes,
                total_mb: bytes_to_mb(total_bytes),
                table_bytes: row.get("table_bytes"),
                index_bytes: row.get("index_bytes"),
            }
        })
        .collect())
}

async fn timescale_usage(db: &Client) -> TimescaleUsage {
    match db
        .query_one(
            "
            SELECT
              COUNT(*)::bigint AS hypertables,
              COUNT(*) FILTER (WHERE compression_enabled)::bigint AS compressed_hypertables
            FROM timescaledb_information.hypertables
            ",
            &[],
        )
        .await
    {
        Ok(row) => TimescaleUsage {
            available: true,
            hypertables: Some(row.get("hypertables")),
            compressed_hypertables: Some(row.get("compressed_hypertables")),
            error: None,
        },
        Err(err) => TimescaleUsage {
            available: false,
            hypertables: None,
            compressed_hypertables: None,
            error: Some(err.to_string()),
        },
    }
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/db/usage", get(db_usage))
        .route("/api/plc/commands", post(create_plc_command).get(list_plc_commands))
        .route("/api/plc/commands/pending", get(pending_plc_commands))
        .route(
            "/api/plc/commands/:command_id/result",
            post(report_plc_command_result),
        )
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let port = get_env("PORT", "3010");
    let addr: SocketAddr = format!("0.0.0.0:{}", port).parse()?;
    let db = connect_db().await?;

    let state = AppState {
        db,
        started_at: Instant::now(),
    };
    let listener = TcpListener::bind(addr).await?;

    tracing::info!(%addr, "linux-db-api escuchando");

    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;

    Ok(())
}
