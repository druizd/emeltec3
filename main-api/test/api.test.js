process.env.TZ = "UTC";

// Suite de pruebas end-to-end con DB mockeada para HTTP y gRPC.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const grpc = require("@grpc/grpc-js");

const projectRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(projectRoot, "src");
const dbModulePath = path.join(srcRoot, "config", "db.js");

function clearSrcModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(srcRoot)) {
      delete require.cache[key];
    }
  }
}

// Mock simple del pool para controlar respuestas SQL por orden de llamada.
function createDbMock() {
  const handlers = [];
  const calls = [];

  return {
    calls,
    enqueue(result) {
      handlers.push(result);
    },
    pool: {
      on() {},
      async query(text, params = []) {
        calls.push({ text, params });

        if (handlers.length === 0) {
          throw new Error(`Consulta no mockeada: ${text}`);
        }

        const next = handlers.shift();
        if (typeof next === "function") {
          return next(text, params, calls);
        }

        return next;
      },
    },
  };
}

// Carga la app Express inyectando el pool mockeado.
function loadApp(dbMock) {
  clearSrcModules();
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: dbMock.pool,
  };

  return require(path.join(srcRoot, "app.js"));
}

// Levanta un servidor HTTP temporal para cada caso que prueba la API REST.
async function withTestServer(dbMock, run) {
  const app = loadApp(dbMock);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl, dbMock.calls);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    clearSrcModules();
  }
}

// Levanta un servidor gRPC temporal usando el mismo pool mockeado.
async function withTestGrpcServer(dbMock, run) {
  clearSrcModules();
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: dbMock.pool,
  };

  const grpcModule = require(path.join(srcRoot, "grpc", "server.js"));
  const proto = grpcModule.loadProto();
  const { server, port } = await grpcModule.startGrpcServer("127.0.0.1:0");
  const client = new proto.MainApi(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure()
  );

  try {
    await run(client, dbMock.calls);
  } finally {
    client.close();
    await new Promise((resolve, reject) => {
      server.tryShutdown((err) => (err ? reject(err) : resolve()));
    });
    clearSrcModules();
  }
}

// Helper para ejecutar unary RPCs como promesas en las pruebas.
function grpcUnary(client, method, request = {}) {
  return new Promise((resolve, reject) => {
    client[method](request, (error, response) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(response);
    });
  });
}

test("siteTelemetryService expone nivel_freatico cuando la variable Nivel usa la calculadora del pozo", () => {
  clearSrcModules();
  const {
    buildSiteDashboardData,
    mapHistoricalDashboardRow,
  } = require(path.join(srcRoot, "services", "siteTelemetryService.js"));

  const site = { id: "SITE-1", descripcion: "Pozo 1", id_serial: "PLC-01", tipo_sitio: "pozo" };
  const pozoConfig = { profundidad_sensor_m: 16, profundidad_pozo_m: 20 };
  const mappings = [
    {
      id: "MAP-1",
      alias: "Nivel",
      d1: "AI24",
      d2: null,
      tipo_dato: "FLOAT",
      unidad: "m",
      rol_dashboard: "nivel",
      transformacion: "nivel_freatico",
      parametros: { factor: 0.01, offset: 0 },
    },
  ];
  const latest = {
    time: "2026-05-07T17:00:00.000Z",
    timestamp_completo: "2026-05-07 14:00",
    id_serial: "PLC-01",
    data: { AI24: 268 },
  };

  const dashboard = buildSiteDashboardData({ site, pozoConfig, mappings, latest });
  assert.equal(dashboard.resumen.nivel_freatico.ok, true);
  assert.equal(dashboard.resumen.nivel_freatico.valor, 13.32);

  const historical = mapHistoricalDashboardRow({
    row: { ...latest, fecha: latest.timestamp_completo },
    site,
    mappings,
    pozoConfig,
  });
  assert.equal(historical.nivel_freatico.ok, true);
  assert.equal(historical.nivel_freatico.valor, 13.32);
});

test("siteTelemetryService deriva nivel_freatico desde una variable Nivel lineal", () => {
  clearSrcModules();
  const {
    buildSiteDashboardData,
    mapHistoricalDashboardRow,
  } = require(path.join(srcRoot, "services", "siteTelemetryService.js"));

  const site = { id: "SITE-1", descripcion: "Pozo 1", id_serial: "PLC-01", tipo_sitio: "pozo" };
  const pozoConfig = { profundidad_sensor_m: 16, profundidad_pozo_m: 20 };
  const mappings = [
    {
      id: "MAP-1",
      alias: "Nivel",
      d1: "AI24",
      d2: null,
      tipo_dato: "FLOAT",
      unidad: "m",
      rol_dashboard: "nivel",
      transformacion: "lineal",
      parametros: { factor: 0.01, offset: 0 },
    },
  ];
  const latest = {
    time: "2026-05-07T17:00:00.000Z",
    timestamp_completo: "2026-05-07 14:00",
    id_serial: "PLC-01",
    data: { AI24: 268 },
  };

  const dashboard = buildSiteDashboardData({ site, pozoConfig, mappings, latest });
  assert.equal(dashboard.resumen.nivel.valor, 2.68);
  assert.equal(dashboard.resumen.nivel_freatico.valor, 13.32);

  const historical = mapHistoricalDashboardRow({
    row: { ...latest, fecha: latest.timestamp_completo },
    site,
    mappings,
    pozoConfig,
  });
  assert.equal(historical.nivel_freatico.ok, true);
  assert.equal(historical.nivel_freatico.valor, 13.32);
});

test("siteTelemetryService usa profundidad total como baseDelSensor cuando profundidad del sensor es cero", () => {
  clearSrcModules();
  const {
    buildSiteDashboardData,
    mapHistoricalDashboardRow,
  } = require(path.join(srcRoot, "services", "siteTelemetryService.js"));

  const site = { id: "SITE-1", descripcion: "Pozo 1", id_serial: "PLC-01", tipo_sitio: "pozo" };
  const pozoConfig = { profundidad_sensor_m: 0, profundidad_pozo_m: 800 };
  const mappings = [
    {
      id: "MAP-1",
      alias: "Nivel",
      d1: "AI24",
      d2: null,
      tipo_dato: "FLOAT",
      unidad: "m",
      rol_dashboard: "nivel",
      transformacion: "lineal",
      parametros: { factor: 0.1, offset: 0 },
    },
  ];
  const latest = {
    time: "2026-05-07T17:00:00.000Z",
    timestamp_completo: "2026-05-07 14:00",
    id_serial: "PLC-01",
    data: { AI24: 268 },
  };

  const dashboard = buildSiteDashboardData({ site, pozoConfig, mappings, latest });
  assert.equal(dashboard.resumen.nivel.valor, 26.8);
  assert.equal(dashboard.resumen.nivel_freatico.ok, true);
  assert.equal(dashboard.resumen.nivel_freatico.valor, 773.2);

  const historical = mapHistoricalDashboardRow({
    row: { ...latest, fecha: latest.timestamp_completo },
    site,
    mappings,
    pozoConfig,
  });
  assert.equal(historical.nivel_freatico.ok, true);
  assert.equal(historical.nivel_freatico.valor, 773.2);
});

test("GET /api/health responde con estado y hora del servidor", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [{ server_time: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestServer(dbMock, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.database, "Conexión exitosa");
    assert.equal(body.server_time, "2026-04-16T12:00:00.000Z");
  });
});

test("GET /api/data usa el serial mas reciente cuando no se envia serial_id", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [{ id_serial: "PLC-RECENT" }],
  });
  dbMock.enqueue({
    rows: [
      {
        id_serial: "PLC-RECENT",
        fecha: "2026-04-16",
        hora: "10:31:00",
        data: { REG4: 11.5 },
      },
    ],
  });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [{ request_count: 1, bytes_sent: 222, updated_at: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestServer(dbMock, async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/data?key=REG4`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.filters.serial_id, "PLC-RECENT");
    assert.deepEqual(body.data[0].data, { REG4: 11.5 });
    assert.match(calls[0].text, /SELECT id_serial/i);
    assert.deepEqual(calls[1].params, ["PLC-RECENT", "REG4", 100]);
  });
});

test("GET /api/data filtra y proyecta multiples variables", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [
      {
        id_serial: "PLC-01",
        fecha: "2026-04-15",
        hora: "10:31:00",
        data: { REG4: 23.7, AI23: 45, AI24: 11 },
      },
      {
        id_serial: "PLC-01",
        fecha: "2026-04-15",
        hora: "10:30:00",
        data: { REG4: 23.5, AI23: 44.8, AI24: 10 },
      },
    ],
  });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [{ request_count: 1, bytes_sent: 321, updated_at: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestServer(dbMock, async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/data?serial_id=PLC-01&keys=REG4,AI23&limit=2`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.count, 2);
    assert.deepEqual(body.filters.selected_keys, ["REG4", "AI23"]);
    assert.deepEqual(body.data[0].data, { REG4: 23.7, AI23: 45 });
    assert.deepEqual(body.data[0].keys_present, ["REG4", "AI23"]);
    assert.equal(body.metrics.request_count_total, 1);
    assert.equal(typeof body.response_time_ms, "number");

    assert.match(calls[0].text, /FROM equipo/i);
    assert.match(calls[0].text, /data \?\| \$2::text\[\]/i);
    assert.deepEqual(calls[0].params, ["PLC-01", ["REG4", "AI23"], 2]);
    assert.match(calls[1].text, /CREATE TABLE IF NOT EXISTS public\.api_metrics/i);
    assert.match(calls[2].text, /INSERT INTO api_metrics/i);
    assert.match(calls[3].text, /CREATE TABLE IF NOT EXISTS public\.api_variable_metrics/i);
    assert.match(calls[4].text, /INSERT INTO public\.api_variable_metrics/i);
    assert.match(calls[5].text, /INSERT INTO public\.api_variable_metrics/i);
    assert.match(calls[6].text, /FROM api_metrics/i);
  });
});

test("GET /api/data/latest devuelve el ultimo registro proyectado", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [
      {
        id_serial: "PLC-01",
        fecha: "2026-04-15",
        hora: "10:31:00",
        data: { REG4: 23.7, AI23: 45.0 },
      },
    ],
  });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [{ request_count: 4, bytes_sent: 800, updated_at: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestServer(dbMock, async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/data/latest?serial_id=PLC-01&key=REG4`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.deepEqual(body.data[0].data, { REG4: 23.7 });
    assert.match(calls[0].text, /LIMIT \$3/i);
    assert.deepEqual(calls[0].params, ["PLC-01", "REG4", 1]);
    assert.match(calls[3].text, /CREATE TABLE IF NOT EXISTS public\.api_variable_metrics/i);
    assert.match(calls[4].text, /INSERT INTO public\.api_variable_metrics/i);
  });
});

test("GET /api/data/range exige serial_id, from y to", async () => {
  const dbMock = createDbMock();

  await withTestServer(dbMock, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/data/range?serial_id=PLC-01`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.match(body.message, /from, to/);
  });
});

test("GET /api/data/preset soporta 7d y usa el ultimo registro si base_date no viene", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [{ fecha: "2026-04-15", hora: "12:00:00" }],
  });
  dbMock.enqueue({
    rows: [
      {
        id_serial: "PLC-01",
        fecha: "2026-04-15",
        hora: "12:00:00",
        data: { REG4: 20.1, AI23: 40.2 },
      },
    ],
  });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [{ request_count: 2, bytes_sent: 123, updated_at: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestServer(dbMock, async (baseUrl, calls) => {
    const response = await fetch(
      `${baseUrl}/api/data/preset?serial_id=PLC-01&preset=7d&keys=REG4`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.filters.preset, "7d");
    assert.equal(body.filters.base_date, "2026-04-15 12:00:00");
    assert.equal(body.filters.from, "2026-04-08 12:00:00");
    assert.equal(body.filters.to, "2026-04-15 12:00:00");
    assert.equal(body.filters.limit, null);
    assert.deepEqual(body.data[0].data, { REG4: 20.1 });

    assert.match(calls[0].text, /ORDER BY time DESC/i);
    assert.deepEqual(calls[0].params, ["PLC-01"]);
    assert.deepEqual(calls[1].params, [
      "PLC-01",
      "2026-04-08 12:00:00",
      "2026-04-15 12:00:00",
      "REG4",
    ]);
    assert.match(calls[4].text, /CREATE TABLE IF NOT EXISTS public\.api_variable_metrics/i);
    assert.match(calls[5].text, /INSERT INTO public\.api_variable_metrics/i);
  });
});

test("GET /api/data/preset valida preset y base_date invalida", async () => {
  const dbMock = createDbMock();

  await withTestServer(dbMock, async (baseUrl) => {
    const invalidPreset = await fetch(
      `${baseUrl}/api/data/preset?serial_id=PLC-01&preset=90d`
    );
    const invalidPresetBody = await invalidPreset.json();

    assert.equal(invalidPreset.status, 400);
    assert.match(invalidPresetBody.message, /Preset invalido/i);

    const invalidBaseDate = await fetch(
      `${baseUrl}/api/data/preset?serial_id=PLC-01&preset=24h&base_date=nope`
    );
    const invalidBaseDateBody = await invalidBaseDate.json();

    assert.equal(invalidBaseDate.status, 400);
    assert.match(invalidBaseDateBody.message, /base_date/);
  });
});

test("GET /api/data/online devuelve el ultimo valor conocido por variable", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [
      {
        id_serial: "PLC-01",
        nombre_dato: "AI23",
        valor_dato: 45.2,
        fecha: "2026-04-15",
        hora: "10:31:00",
      },
      {
        id_serial: "PLC-01",
        nombre_dato: "REG4",
        valor_dato: 23.7,
        fecha: "2026-04-15",
        hora: "10:31:00",
      },
    ],
  });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [{ request_count: 3, bytes_sent: 456, updated_at: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestServer(dbMock, async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/data/online?serial_id=PLC-01&keys=AI23,REG4`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.count, 2);
    assert.deepEqual(body.snapshot, { AI23: 45.2, REG4: 23.7 });
    assert.equal(body.data[0].nombre_dato, "AI23");
    assert.match(calls[0].text, /jsonb_each\(lr\.data\)/i);
    assert.deepEqual(calls[0].params, ["PLC-01", ["AI23", "REG4"]]);
    assert.match(calls[3].text, /CREATE TABLE IF NOT EXISTS public\.api_variable_metrics/i);
    assert.match(calls[4].text, /INSERT INTO public\.api_variable_metrics/i);
    assert.match(calls[5].text, /INSERT INTO public\.api_variable_metrics/i);
  });
});

test("GET /api/data/keys lista variables distintas por serial", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [{ nombre_dato: "AI23" }, { nombre_dato: "REG4" }],
  });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [{ request_count: 3, bytes_sent: 456, updated_at: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestServer(dbMock, async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/data/keys?serial_id=PLC-01`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, ["AI23", "REG4"]);
    assert.match(calls[0].text, /jsonb_object_keys\(data\)/i);
    assert.deepEqual(calls[0].params, ["PLC-01"]);
  });
});

test("GET /api/metrics/by-variable devuelve consumo agregado por nombre_dato", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [
      {
        nombre_dato: "REG4",
        serial_id: "PLC-01",
        request_count: 9,
        bytes_sent: 52849,
        duration_ms_total: 181,
        updated_at: "2026-04-16T12:00:00.000Z",
      },
      {
        nombre_dato: "AI23",
        serial_id: "PLC-01",
        request_count: 2,
        bytes_sent: 2048,
        duration_ms_total: 60,
        updated_at: "2026-04-16T12:01:00.000Z",
      },
    ],
  });

  await withTestServer(dbMock, async (baseUrl, calls) => {
    const response = await fetch(
      `${baseUrl}/api/metrics/by-variable?serial_id=PLC-01&keys=REG4,AI23`
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.count, 2);
    assert.equal(body.data[0].nombre_dato, "REG4");
    assert.equal(body.data[0].bytes_sent_kb, 51.61);
    assert.equal(body.data[0].avg_duration_ms, 20.11);
    assert.deepEqual(body.filters.selected_keys, ["REG4", "AI23"]);

    assert.match(calls[0].text, /CREATE TABLE IF NOT EXISTS public\.api_variable_metrics/i);
    assert.match(calls[1].text, /FROM public\.api_variable_metrics/i);
    assert.deepEqual(calls[1].params, ["PLC-01", ["REG4", "AI23"]]);
  });
});

test("GET /api/metrics/by-variable usa el serial mas reciente si no se envia", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [{ id_serial: "PLC-RECENT" }],
  });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [
      {
        nombre_dato: "REG4",
        serial_id: "PLC-RECENT",
        request_count: 3,
        bytes_sent: 4096,
        duration_ms_total: 30,
        updated_at: "2026-04-16T12:00:00.000Z",
      },
    ],
  });

  await withTestServer(dbMock, async (baseUrl, calls) => {
    const response = await fetch(`${baseUrl}/api/metrics/by-variable?keys=REG4`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.filters.serial_id, "PLC-RECENT");
    assert.equal(body.data[0].serial_id, "PLC-RECENT");
    assert.match(calls[0].text, /SELECT id_serial/i);
    assert.deepEqual(calls[2].params, ["PLC-RECENT", ["REG4"]]);
  });
});

test("gRPC Health responde con estado y hora del servidor", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [{ server_time: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestGrpcServer(dbMock, async (client) => {
    const body = await grpcUnary(client, "health", {});

    assert.equal(body.ok, true);
    assert.equal(body.database, "Conexion exitosa");
    assert.equal(body.server_time, "2026-04-16T12:00:00.000Z");
  });
});

test("gRPC GetLatest devuelve el ultimo registro proyectado", async () => {
  const dbMock = createDbMock();
  dbMock.enqueue({
    rows: [
      {
        id_serial: "PLC-01",
        fecha: "2026-04-15",
        hora: "10:31:00",
        data: { REG4: 23.7, AI23: 45.0 },
      },
    ],
  });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({ rows: [] });
  dbMock.enqueue({
    rows: [{ request_count: 4, bytes_sent: 800, updated_at: "2026-04-16T12:00:00.000Z" }],
  });

  await withTestGrpcServer(dbMock, async (client, calls) => {
    const body = await grpcUnary(client, "getLatest", {
      serial_id: "PLC-01",
      keys: ["REG4"],
    });

    assert.equal(body.ok, true);
    assert.equal(body.serial_id, "PLC-01");
    assert.equal(body.count, 1);
    assert.equal(body.data[0].id_serial, "PLC-01");
    assert.equal(body.data[0].values[0].nombre_dato, "REG4");
    assert.equal(body.data[0].values[0].valor_json, "23.7");
    assert.equal(body.request_count_total, 4);
    assert.equal(typeof body.response_time_ms, "number");

    assert.match(calls[0].text, /FROM equipo/i);
    assert.deepEqual(calls[0].params, ["PLC-01", "REG4", 1]);
    assert.match(calls[1].text, /CREATE TABLE IF NOT EXISTS public\.api_metrics/i);
    assert.match(calls[2].text, /INSERT INTO api_metrics/i);
    assert.match(calls[3].text, /CREATE TABLE IF NOT EXISTS public\.api_variable_metrics/i);
    assert.match(calls[4].text, /INSERT INTO public\.api_variable_metrics/i);
    assert.match(calls[5].text, /FROM api_metrics/i);
  });
});
