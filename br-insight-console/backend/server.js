"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const {
  generateDiagnostic,
  generateChatResponse,
  getIntelligentFallback,
  buildCaseDetail,
  pickPriorityCase
} = require("./groqController");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const metricsPath = path.join(__dirname, "metrics.json");
const frontendCandidates = [
  path.resolve(__dirname, "..", "..", "frontend"),
  path.resolve(__dirname, "..", "frontend")
];
const frontendPath = frontendCandidates.find((candidate) => fs.existsSync(candidate)) || frontendCandidates[0];

let patchApplied = false;
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const SUPPORTED_LANGUAGES = new Set(["es", "en", "fr", "pt", "zh", "de", "it", "nl", "sv"]);
const USERS_BY_PIN = {
  "0001": { name: "Santiago Lopez Rubio", role: "CEO", title: "Chief Executive Officer" },
  "0002": { name: "Camilo Castrillo", role: "Ops Director", title: "Operations Director" },
  "0003": { name: "Santiago Alemán", role: "QA Director", title: "Quality Assurance Director" }
};

// --- Simulación operativa en vivo -------------------------------------------------
const SIM_ENABLED = process.env.SIM_ENABLED !== "false";
const SIM_TICK_MS = Math.max(2000, Number(process.env.SIM_TICK_MS) || 6000);
const MAX_TICKETS = 9;
const MAX_LOGS = 40;
const MAX_MESSAGES = 10;
const SIM_TICKET_TYPES = [
  { type: "technical_error_403", severity: "CRITICAL", channel: "Mobile App", channel_key: "mobile_app", owner_key: "owner_tech_l2", sla_minutes: 30, status_key: "pending_l2" },
  { type: "logistics_delay", severity: "MEDIUM", channel: "Web Portal", channel_key: "web_portal", owner_key: "owner_logistics", sla_minutes: 120, status_key: "escalated_logistics" },
  { type: "payment_double_hold", severity: "HIGH", channel: "Phone", channel_key: "phone", owner_key: "owner_payments", sla_minutes: 45, status_key: "in_progress" },
  { type: "refund_pending", severity: "MEDIUM", channel: "Web Portal", channel_key: "web_portal", owner_key: "owner_returns", sla_minutes: 90, status_key: "awaiting_customer" },
  { type: "product_inquiry", severity: "LOW", channel: "Chat", channel_key: "chat", owner_key: "owner_product", sla_minutes: 60, status_key: "awaiting_customer" },
  { type: "qa_review", severity: "MEDIUM", channel: "Phone", channel_key: "phone", owner_key: "owner_qa", sla_minutes: 240, status_key: "qa_review" },
  { type: "shipping_address", severity: "LOW", channel: "Chat", channel_key: "chat", owner_key: "owner_logistics", sla_minutes: 90, status_key: "in_progress" },
  { type: "app_crash", severity: "HIGH", channel: "Mobile App", channel_key: "mobile_app", owner_key: "owner_tech_l2", sla_minutes: 30, status_key: "pending_l2" }
];
const SIM_AGENTS = [
  { name: "Cristian Anillo", role_key: "tech_support_l2" },
  { name: "Gabriel Silva", role_key: "team_leader" },
  { name: "Juan Salinas", role_key: "supervisor" },
  { name: "Santiago Alemán", role_key: "qa_director" }
];
// Etiquetas legibles (inglés neutro) para el contexto de la IA cuando el frontend localiza el texto.
const SIM_ISSUE_LABELS = {
  technical_error_403: "Error 403: loyalty token invalid at checkout",
  logistics_delay: "Delayed shipment stuck in order preparing",
  payment_double_hold: "Double authorization hold on card payment",
  refund_pending: "Refund pending beyond the committed cycle",
  product_inquiry: "Product sizing and fit inquiry",
  qa_review: "QA review with critical findings",
  shipping_address: "Shipping address validation failure",
  app_crash: "Mobile app crash during session"
};
const SIM_STATUS_LABELS = {
  pending_l2: "Pending L2 resolution",
  escalated_logistics: "Escalated to logistics",
  in_progress: "In progress",
  awaiting_customer: "Awaiting customer",
  qa_review: "QA review",
  resolved_monitored: "Resolved and monitored"
};

let liveMetrics = null;
let simulationTimer = null;

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    try {
      const { protocol, hostname, port } = new URL(origin);
      const isLocalDevelopmentOrigin = protocol === "http:"
        && ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
        && Boolean(port);
      callback(null, isLocalDevelopmentOrigin ? origin : false);
    } catch {
      callback(null, false);
    }
  },
  credentials: true
}));
app.use(express.json({ limit: "32kb" }));

function getSessionToken(req) {
  const cookie = req.headers.cookie || "";
  const sessionCookie = cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("br_session="));
  return sessionCookie ? sessionCookie.slice("br_session=".length) : "";
}

function isAuthenticated(req) {
  const token = getSessionToken(req);
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return session;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drift(value, amplitude, min, max, decimals = 0) {
  const next = value + (Math.random() * 2 - 1) * amplitude;
  const bounded = clamp(next, min, max);
  const factor = 10 ** decimals;
  return Math.round(bounded * factor) / factor;
}

function driftSeries(values, amplitude, min, max, decimals = 0) {
  if (!Array.isArray(values) || !values.length) return values;
  const factor = 10 ** decimals;
  const next = values.map((value) => Math.round(clamp(value + (Math.random() * 2 - 1) * amplitude, min, max) * factor) / factor);
  return next;
}

function driftAnalytics(analytics) {
  if (!analytics) return;
  const groups = ["complaints_by_type", "inquiries_by_category", "logistics_bottlenecks"];
  groups.forEach((group) => {
    const dataset = analytics[group];
    if (!dataset?.values) return;
    const ceiling = group === "inquiries_by_category" ? 600 : 120;
    dataset.values = dataset.values.map((value) => Math.round(clamp(value + (Math.random() * 2 - 1) * (value * 0.12 + 1), 2, ceiling)));
  });
  const refunds = analytics.refunds_returns;
  if (refunds) {
    refunds.refunds = driftSeries(refunds.refunds, 4, 5, 120);
    refunds.returns = driftSeries(refunds.returns, 4, 5, 140);
  }
  const problems = analytics.weekly_problems;
  if (problems?.values) {
    problems.values = problems.values.map((value, index) => Math.round(clamp(
      value + (Math.random() * 2 - 1) * (value * 0.08 + 1),
      3,
      index === problems.values.length - 1 ? 140 : 90
    )));
  }
}

function currentClock() {
  return new Date().toLocaleTimeString("es-CO", { hour12: false, timeZone: "America/Bogota" });
}

function generateSimulatedTicket(tick) {
  const template = SIM_TICKET_TYPES[Math.floor(Math.random() * SIM_TICKET_TYPES.length)];
  const sequence = 1000 + tick;
  return {
    id: `${template.type === "logistics_delay" ? "HM" : template.type.startsWith("technical") || template.type === "app_crash" ? "TECH" : "INC"}-${sequence}`,
    type: template.type,
    issue_key: template.type,
    issue: SIM_ISSUE_LABELS[template.type] || "",
    channel_key: template.channel_key,
    channel: template.channel,
    severity: template.severity,
    status_key: template.status_key,
    status: SIM_STATUS_LABELS[template.status_key] || "",
    owner_key: template.owner_key,
    sla_minutes: template.sla_minutes,
    time_open: `${1 + Math.floor(Math.random() * 12)}m`,
    created_at: new Date().toISOString()
  };
}

function pushSimulatedLog(metrics, type) {
  metrics.technical_logs = (metrics.technical_logs || []).slice(-(MAX_LOGS - 1));
  metrics.technical_logs.push({
    time: currentClock(),
    level: type === "qa_review" ? "WARN" : "ERROR",
    message_key: type === "qa_review" ? "log_qa_alert" : "log_new_critical",
    message: ""
  });
}

function runSimulationTick() {
  if (!liveMetrics) return;
  const metrics = liveMetrics;
  // Los KPIs operan dentro de la banda saludable. En raras ocasiones (~2%)
  // rozan levemente la meta y se recuperan al siguiente ciclo, de modo que la
  // operación casi nunca se muestra por debajo de los objetivos.
  const dip = Math.random() < 0.02;

  metrics.kpis.fcr = dip
    ? drift(Number(metrics.kpis.fcr), 0.5, 78.6, 79.9, 1)
    : drift(Number(metrics.kpis.fcr), 0.7, 80.4, 92.5, 1);
  metrics.kpis.asa_seconds = dip
    ? drift(Number(metrics.kpis.asa_seconds), 1.6, 30.4, 33.5)
    : drift(Number(metrics.kpis.asa_seconds), 2.0, 17, 29.4);
  metrics.kpis.csat = dip
    ? drift(Number(metrics.kpis.csat), 0.04, 4.6, 4.7, 1)
    : drift(Number(metrics.kpis.csat), 0.05, 4.8, 5, 1);
  metrics.kpis.daily_volume = drift(Number(metrics.kpis.daily_volume), 45, 1050, 1980);
  metrics.kpis.active_tickets = drift(Number(metrics.kpis.active_tickets), 6, 70, 210);

  metrics.interaction_volume.values = driftSeries(metrics.interaction_volume.values, 60, 900, 1900);
  metrics.interaction_volume.top_problems = driftSeries(metrics.interaction_volume.top_problems, 2, 6, 24);
  metrics.qa_compliance_trend.values = driftSeries(metrics.qa_compliance_trend.values, 0.6, 95.2, 99.4, 1);
  driftAnalytics(metrics.analytics);

  metrics.agent_performance = (metrics.agent_performance || []).map((agent) => ({
    ...agent,
    aht_min: String(drift(Number(agent.aht_min), 0.3, 2.8, 5.2, 1)),
    csat: drift(Number(agent.csat), 0.05, 4.8, 5, 1)
  }));

  const tick = (metrics.simulation?.tick || 0) + 1;
  // Nuevos tickets/pedidos en vivo "de vez en cuando": al menos 3 ciclos de
  // separación y ~28% de probabilidad de ingreso en cada ciclo posterior.
  const lastSpawnTick = Number(metrics.simulation?.last_spawn_tick || 0);
  const spawnsTicket = tick - lastSpawnTick >= 3 && Math.random() < 0.28;

  if (spawnsTicket) {
    const ticket = generateSimulatedTicket(tick);
    metrics.active_critical_tickets = [ticket, ...(metrics.active_critical_tickets || [])].slice(0, MAX_TICKETS);
    pushSimulatedLog(metrics, ticket.type);
    metrics.team_messages = [{
      id: `msg-sim-${tick}`,
      sender: SIM_AGENTS[tick % SIM_AGENTS.length].name,
      role_key: SIM_AGENTS[tick % SIM_AGENTS.length].role_key,
      role: "",
      time: currentClock(),
      unread: true,
      message_key: "teamMessageNewCase",
      message: ""
    }, ...(metrics.team_messages || [])].slice(0, MAX_MESSAGES);
  } else {
    metrics.technical_logs = (metrics.technical_logs || []).slice(-(MAX_LOGS - 1));
    metrics.technical_logs.push({
      time: currentClock(),
      level: metrics.kpis.asa_seconds > 30 ? "WARN" : "INFO",
      message_key: metrics.kpis.asa_seconds > 30 ? "log_oms_latency" : "log_monitoring_ok",
      message: ""
    });
  }

  metrics.simulation = {
    enabled: true,
    tick,
    interval_ms: SIM_TICK_MS,
    last_tick: new Date().toISOString(),
    last_spawn_tick: spawnsTicket ? tick : lastSpawnTick,
    new_ticket_id: spawnsTicket ? metrics.active_critical_tickets[0].id : null
  };
  metrics.kpis.active_tickets = Math.max(Number(metrics.kpis.active_tickets), (metrics.active_critical_tickets || []).length);
}

function startSimulation() {
  if (!SIM_ENABLED || simulationTimer) return;
  simulationTimer = setInterval(runSimulationTick, SIM_TICK_MS);
  if (typeof simulationTimer.unref === "function") simulationTimer.unref();
}

async function loadBaseMetrics() {
  const fileContents = await fs.promises.readFile(metricsPath, "utf8");
  const metrics = JSON.parse(fileContents);
  metrics.escalation_email = process.env.ESCALATION_EMAIL || metrics.escalation_email || "";
  if (patchApplied) {
    const ticket = (metrics.active_critical_tickets || []).find((item) => item.id === "TECH-403");
    if (ticket) ticket.status_key = "resolved_monitored";
  }
  return metrics;
}

async function readMetrics() {
  if (!SIM_ENABLED) return loadBaseMetrics();

  if (!liveMetrics) {
    liveMetrics = await loadBaseMetrics();
    liveMetrics.simulation = {
      enabled: true,
      tick: 0,
      interval_ms: SIM_TICK_MS,
      last_tick: new Date().toISOString(),
      new_ticket_id: null
    };
    startSimulation();
  } else {
    liveMetrics.escalation_email = process.env.ESCALATION_EMAIL || liveMetrics.escalation_email || "";
    if (patchApplied) {
      const ticket = (liveMetrics.active_critical_tickets || []).find((item) => item.id === "TECH-403");
      if (ticket) ticket.status_key = "resolved_monitored";
    }
  }

  return liveMetrics;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"), (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ success: false, error: "No se encontró la aplicación frontend." });
    }
  });
});

app.use(express.static(frontendPath));

app.get("/api/session", (req, res) => {
  const session = isAuthenticated(req);
  res.json(session
    ? { authenticated: true, profile: session.profile, language: session.language }
    : { authenticated: false });
});

app.post("/api/login", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = loginAttempts.get(ip);
  const attempt = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + LOGIN_WINDOW_MS };

  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({
      success: false,
      error: "Demasiados intentos. Espera 15 minutos antes de volver a intentarlo."
    });
  }

  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
  const profile = USERS_BY_PIN[pin];
  if (!/^\d{4}$/.test(pin) || !profile) {
    attempt.count += 1;
    loginAttempts.set(ip, attempt);
    return res.status(401).json({ success: false, errorKey: "wrongPin", error: "PIN incorrecto. Verifica los 4 dígitos." });
  }

  loginAttempts.delete(ip);
  for (const [sessionToken, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(sessionToken);
  }
  const token = crypto.randomBytes(32).toString("hex");
  const language = SUPPORTED_LANGUAGES.has(req.body?.language) ? req.body.language : "es";
  sessions.set(token, { expiresAt: now + SESSION_TTL_MS, profile, language });
  const secureFlag = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `br_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secureFlag}`);
  res.json({ success: true, profile, language });
});

app.use("/api", (req, res, next) => {
  req.userSession = isAuthenticated(req);
  if (!req.userSession) {
    return res.status(401).json({ success: false, errorKey: "sessionExpired", error: "La sesión expiró. Vuelve a iniciar sesión." });
  }
  next();
});

app.post("/api/logout", (req, res) => {
  sessions.delete(getSessionToken(req));
  const secureFlag = req.secure ? "; Secure" : "";
  res.setHeader("Set-Cookie", `br_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureFlag}`);
  res.json({ success: true });
});

app.get("/api/metrics", async (req, res) => {
  try {
    res.json(await readMetrics());
  } catch (error) {
    console.error(`Error cargando métricas: ${error.message}`);
    res.status(500).json({
      success: false,
      errorKey: "metricsUnavailable",
      error: "No fue posible cargar las métricas operativas."
    });
  }
});

app.get("/api/case/:id", async (req, res) => {
  try {
    const detail = buildCaseDetail(await readMetrics(), req.params.id);
    if (!detail) {
      return res.status(404).json({ success: false, error: "No se encontró el caso solicitado." });
    }
    res.json({ success: true, ...detail });
  } catch (error) {
    console.error(`Error cargando el detalle del caso: ${error.message}`);
    res.status(500).json({ success: false, error: "No fue posible cargar el detalle del caso." });
  }
});

app.get("/api/generate-insight", async (req, res) => {
  try {
    const metrics = await readMetrics();
    const language = SUPPORTED_LANGUAGES.has(req.query.language) ? req.query.language : req.userSession.language;
    const diagnostic = req.query.fallback === "true"
      ? getIntelligentFallback(metrics, language)
      : await generateDiagnostic(metrics, language);
    res.json({ success: true, ...diagnostic });
  } catch (error) {
    console.error(`Error generando diagnóstico: ${error.message}`);
    res.status(500).json({
      success: false,
      errorKey: "insightUnavailable",
      error: "No fue posible preparar el diagnóstico operativo."
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 2000) {
    return res.status(400).json({
      success: false,
      errorKey: "chatTooLong",
      error: "Escribe una pregunta de hasta 2.000 caracteres."
    });
  }

  try {
    const language = SUPPORTED_LANGUAGES.has(req.body?.language) ? req.body.language : req.userSession.language;
    const metrics = await readMetrics();
    const answer = await generateChatResponse(message.trim(), metrics, language);
    res.json({ success: true, response: answer.response, case_id: answer.case_id });
  } catch (error) {
    console.error(`Error en el chat operativo: ${error.message}`);
    const missingKey = error.code === "GROQ_API_KEY_MISSING";
    res.status(missingKey ? 503 : 502).json({
      success: false,
      error: missingKey
        ? "El asistente no está disponible: configura GROQ_API_KEY en el servidor."
        : "No fue posible obtener una respuesta del asistente. Intenta nuevamente."
    });
  }
});

app.post("/api/apply-patch", async (req, res) => {
  patchApplied = true;
  const metrics = await readMetrics().catch(() => null);
  const ticket = (metrics?.active_critical_tickets || []).find((item) => item.id === "TECH-403");
  if (ticket) ticket.status_key = "resolved_monitored";
  res.json({
    success: true,
    ticket_id: ticket?.id || "TECH-403",
    messageKey: "patchAppliedMessage",
    message: "Parche SOP-TS-002 simulado. El ticket TECH-403 quedó resuelto y en monitoreo.",
    status_key: "resolved_monitored",
    applied_at: new Date().toISOString()
  });
});

app.get("/api/priority-case", async (req, res) => {
  try {
    const priority = pickPriorityCase(await readMetrics());
    if (!priority) return res.status(404).json({ success: false, errorKey: "priorityCaseUnavailable", error: "Sin casos prioritarios." });
    res.json({ success: true, case_id: priority.id });
  } catch (error) {
    res.status(500).json({ success: false, errorKey: "priorityCaseError", error: "No fue posible resolver el caso prioritario." });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ success: false, errorKey: "endpointNotFound", error: "Endpoint de API no encontrado." });
});

app.use((error, req, res, next) => {
  console.error(`Error inesperado en la API: ${error.message}`);
  if (res.headersSent) return next(error);
  res.status(500).json({ success: false, errorKey: "internalError", error: "Ocurrió un error interno del servidor." });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`BR Insight Console disponible en http://localhost:${PORT}`);
    console.log(SIM_ENABLED
      ? `Simulación operativa en vivo activa (cada ${SIM_TICK_MS / 1000} s).`
      : "Simulación operativa desactivada (SIM_ENABLED=false).");
  });
}

module.exports = app;
