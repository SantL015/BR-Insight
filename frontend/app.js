"use strict";

const API_BASE_URL = (() => {
  const hostname = window.location.hostname.replace(/^\[|\]$/g, "");
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  return isLocalHost && window.location.port !== "3000"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "";
})();
let metricsData = null;
let activeLanguage = localStorage.getItem("br-language") || "es";
let activeProfile = null;
const charts = new Map();
let numberFormatter = new Intl.NumberFormat(activeLanguage === "zh" ? "zh-CN" : activeLanguage);
let analysisOpener = null;
let caseOpener = null;
let activeCaseId = null;
let activeCaseData = null;
let liveTimer = null;
let liveIntervalMs = 0;
let lastSimTicketId = null;
let sectionTitleCache = null;

/* ---------------------------------------------------------------- i18n --- */

function t(key) {
  return window.BR_TRANSLATIONS?.[activeLanguage]?.[key]
    || window.BR_TRANSLATIONS?.es?.[key]
    || key;
}

// Resuelve datos dinámicos del backend que llegan como clave neutral (ej. "pending_l2").
function dynamic(prefix, key, fallback) {
  if (!key) return fallback ?? "";
  const resolved = t(`${prefix}${key}`);
  return resolved === `${prefix}${key}` ? (fallback ?? "") : resolved;
}

function translateKeys(keys, fallbackList) {
  return keys?.length ? keys.map((key) => t(key)) : (fallbackList || []);
}

function translatePeriodLabels(labels) {
  const weekdays = {
    es: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
    en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    fr: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
    pt: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"],
    zh: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
    de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
    it: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],
    nl: ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"],
    sv: ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"]
  }[activeLanguage];
  return (labels || []).map((label, index) => {
    if (/^(sem(?:ana)?|week|woche|sett\.?|settimana|周)\s*\d+$/i.test(label)) {
      const number = label.match(/\d+/)?.[0];
      return `${t("weekPrefix")} ${number}`;
    }
    if (index < 7 && /^(lun|mar|mié|mie|jue|vie|sáb|sab|dom)$/i.test(label)) {
      return weekdays[index];
    }
    return label;
  });
}

// Traduce el título de sección devuelto por la IA usando los títulos conocidos por idioma.
function normalizeSectionTitle(title) {
  const clean = String(title || "").trim();
  const normalized = clean.toLocaleLowerCase();
  if (!sectionTitleCache) {
    sectionTitleCache = new Map();
    ["aiSectionSummary", "aiSectionAction", "aiSectionRisk"].forEach((key) => {
      const variants = new Set();
      Object.values(window.BR_TRANSLATIONS || {}).forEach((dictionary) => {
        const value = dictionary?.[key];
        if (value) variants.add(String(value).trim().toLocaleLowerCase());
      });
      sectionTitleCache.set(key, [...variants]);
    });
  }
  for (const [key, variants] of sectionTitleCache) {
    if (variants.includes(normalized)) return t(key);
  }
  return clean;
}

document.addEventListener("DOMContentLoaded", () => {
  if (!window.BR_TRANSLATIONS?.[activeLanguage]) activeLanguage = "es";
  activeLanguage = document.getElementById("login-language").value = activeLanguage;
  applyLanguage(activeLanguage);
  initTabs();
  setupEventListeners();
  initializeAccess();
});

function applyLanguage(language) {
  if (!window.BR_TRANSLATIONS?.[language]) return;
  activeLanguage = language;
  localStorage.setItem("br-language", language);
  document.documentElement.lang = language;
  numberFormatter = new Intl.NumberFormat(language === "zh" ? "zh-CN" : language);
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    if (element.dataset.live === "true") return;
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    element.setAttribute("alt", t(element.dataset.i18nAlt));
  });
  const pageTitle = document.querySelector("title");
  if (pageTitle) pageTitle.textContent = t("pageTitle");
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) metaDescription.setAttribute("content", t("metaDescription"));

  // Contenido generado dinámicamente que debe seguir el idioma activo.
  const aiBox = document.getElementById("ai-response-box");
  if (aiBox.dataset.generated && aiBox.dataset.raw) renderAiInsight(aiBox, aiBox.dataset.raw);
  document.querySelectorAll(".chat-bubble[data-raw]").forEach((bubble) => {
    const caseId = bubble.dataset.caseId;
    renderAiInsight(bubble, bubble.dataset.raw);
    if (caseId) appendCaseButton(bubble, caseId);
  });
  const analysisAi = document.getElementById("ai-analysis-response");
  if (analysisAi.dataset.raw) renderAiInsight(analysisAi, analysisAi.dataset.raw);
  ["ai-case-detail", "analysis-case-detail"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.textContent = t("caseDetailButton");
  });
  refreshLiveStamp();
  if (document.getElementById("case-modal").classList.contains("is-open") && activeCaseData) {
    renderCaseDetail(activeCaseData);
  }

  if (metricsData) {
    renderTicketsTable(metricsData.active_critical_tickets || []);
    renderAgentsTable(metricsData.agent_performance || []);
    renderProductsTable(metricsData.top_complaint_products || []);
    renderComplaints(metricsData.frequent_complaints || []);
    renderSOPs(visibleSops(), { force: true });
    renderTicketKnowledge(metricsData.ticket_knowledge || []);
    renderFaq(metricsData.customer_faq || []);
    renderLogs(metricsData.technical_logs || []);
    renderTeamMessages(metricsData.team_messages || [], metricsData.escalation_email || "");
    renderTeamDirectory(metricsData.team_directory || []);
    initCharts(metricsData);
    if (document.getElementById("analysis-modal").classList.contains("is-open")) {
      const activeId = document.getElementById("analysis-modal").dataset.analysisId;
      const trigger = document.querySelector(`[data-analysis-id="${CSS.escape(activeId)}"]`);
      if (trigger) openAnalysis(trigger, false);
    }
  }
}

/* -------------------------------------------------------------- acceso --- */

async function initializeAccess() {
  try {
    const session = await requestJson("/api/session");
    if (session.authenticated) {
      activeProfile = session.profile;
      activeLanguage = session.language || activeLanguage;
      document.getElementById("login-language").value = activeLanguage;
      applyLanguage(activeLanguage);
      renderProfile(activeProfile);
      enterDashboard();
      return;
    }
    document.getElementById("access-pin").focus();
  } catch (error) {
    showLoginError(`${t("sessionError")} ${error.message}`);
  }
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("login-submit");
  const pin = document.getElementById("access-pin").value;
  const errorBox = document.getElementById("login-error");
  errorBox.hidden = true;
  setLoading(button, true, t("loadingButton"));

  try {
    const session = await requestJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, language: activeLanguage })
    });
    activeProfile = session.profile;
    renderProfile(activeProfile);
    form.reset();
    enterDashboard();
  } catch (error) {
    showLoginError(error.message.includes("PIN") ? t("wrongPin") : error.message);
    document.getElementById("access-pin").select();
  } finally {
    setLoading(button, false);
  }
}

function renderProfile(profile) {
  if (!profile) return;
  setText("user-name", profile.name);
  setText("user-role", profile.role);
  const initials = profile.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("");
  setText("user-initials", initials);
}

function showLoginError(message) {
  const errorBox = document.getElementById("login-error");
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function enterDashboard() {
  const login = document.getElementById("login-screen");
  const dashboard = document.getElementById("dashboard");
  dashboard.hidden = false;
  requestAnimationFrame(() => login.classList.add("is-leaving"));
  window.setTimeout(() => {
    login.hidden = true;
    fetchMetrics();
  }, 360);
}

function initTabs() {
  const buttons = [...document.querySelectorAll(".nav-btn")];
  const contents = [...document.querySelectorAll(".tab-content")];

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.tab;
      if (!tabId) return;

      buttons.forEach((item) => {
        const isActive = item === button;
        item.classList.toggle("active", isActive);
        item.setAttribute("aria-selected", String(isActive));
        item.tabIndex = isActive ? 0 : -1;
      });

      contents.forEach((section) => {
        const isActive = section.id === `tab-${tabId}`;
        section.classList.toggle("active", isActive);
        section.hidden = !isActive;
      });

      requestAnimationFrame(() => {
        charts.forEach((chart) => chart.resize());
      });
    });
  });
}

/* --------------------------------------------------------------- datos --- */

async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${url}`, {
      ...options,
      credentials: "include"
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(t("backendUnavailable"));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = data.error || `${t("serverError")} (${response.status})`;
    throw new Error(data.errorKey ? t(data.errorKey) : fallback);
  }
  return data;
}

async function fetchMetrics({ silent = false } = {}) {
  try {
    const data = await requestJson("/api/metrics");
    const previousTicketId = lastSimTicketId || metricsData?.simulation?.new_ticket_id || null;
    metricsData = data;
    const freshTicketId = data.simulation?.new_ticket_id || null;
    if (previousTicketId && freshTicketId && freshTicketId !== previousTicketId) {
      showToast(`${t("teamMessageNewCase")} · ${freshTicketId}`, "info");
    }
    if (freshTicketId) lastSimTicketId = freshTicketId;
    renderMetrics(data);
    startLivePolling(data);
  } catch (error) {
    if (silent) return;
    console.error("Error cargando métricas:", error);
    showToast(`${t("metricsLoadError")} ${error.message}`, "error");
  }
}

function startLivePolling(data) {
  const interval = Math.max(5000, Number(data?.simulation?.interval_ms) || 6000);
  if (liveTimer && liveIntervalMs === interval) return;
  if (liveTimer) window.clearInterval(liveTimer);
  liveIntervalMs = interval;
  liveTimer = window.setInterval(() => fetchMetrics({ silent: true }), interval);
}

function stopLivePolling() {
  if (!liveTimer) return;
  window.clearInterval(liveTimer);
  liveTimer = null;
  liveIntervalMs = 0;
}

function renderMetrics(data) {
  const kpis = data.kpis || {};
  setText("kpi-fcr", `${kpis.fcr ?? "—"}%`);
  setText("kpi-asa", `${kpis.asa_seconds ?? "—"}s`);
  setText("kpi-csat", `${kpis.csat ?? "—"} / 5.0`);
  setText("kpi-volume", numberFormatter.format(kpis.daily_volume ?? 0));
  setText("kpi-active", numberFormatter.format(kpis.active_tickets ?? 0));
  updateKpiStatus(kpis, data);

  const stamp = document.getElementById("analytics-updated");
  if (stamp) {
    stamp.dataset.stamp = new Date().toLocaleTimeString(activeLanguage === "zh" ? "zh-CN" : activeLanguage);
    refreshLiveStamp();
  }

  renderTicketsTable(data.active_critical_tickets || []);
  renderAgentsTable(data.agent_performance || []);
  renderProductsTable(data.top_complaint_products || []);
  renderComplaints(data.frequent_complaints || []);
  renderSOPs(visibleSops());
  renderTicketKnowledge(data.ticket_knowledge || []);
  renderFaq(data.customer_faq || []);
  renderLogs(data.technical_logs || []);
  renderTeamMessages(data.team_messages || [], data.escalation_email || "");
  renderTeamDirectory(data.team_directory || []);
  initCharts(data);
}

function refreshLiveStamp() {
  const stamp = document.getElementById("analytics-updated");
  if (!stamp) return;
  const time = stamp.dataset.stamp || new Date().toLocaleTimeString(activeLanguage === "zh" ? "zh-CN" : activeLanguage);
  stamp.dataset.stamp = time;
  stamp.textContent = `${t("updatedJustNow")} · ${time}`;
}

function updateKpiStatus(kpis, data) {
  const statusById = {
    "kpi-fcr": Number(kpis.fcr) > 80,
    "kpi-asa": Number(kpis.asa_seconds) < 30,
    "kpi-csat": Number(kpis.csat) >= 4.8
  };
  Object.entries(statusById).forEach(([id, healthy]) => {
    const card = document.getElementById(id)?.closest(".kpi-card");
    if (!card) return;
    card.classList.toggle("is-healthy", healthy);
    card.classList.toggle("is-alert", !healthy);
  });

  const activeCritical = (data.active_critical_tickets || []).some((ticket) =>
    (ticket.severity === "CRITICAL" || ticket.severity_key === "critical")
    && !/resolved|closed/i.test(`${ticket.status_key || ""} ${ticket.status || ""}`)
  );
  const problemCounts = data.interaction_volume?.top_problems || [];
  const latestProblemCount = Number(problemCounts[problemCounts.length - 1] || 0);
  const hasProblemSpike = latestProblemCount > 20;
  const activeCard = document.getElementById("kpi-active")?.closest(".kpi-card");
  const liveIndicator = document.querySelector(".live-indicator");
  if (activeCard) {
    activeCard.classList.toggle("is-alert", activeCritical || hasProblemSpike);
    activeCard.classList.toggle("is-healthy", !activeCritical && !hasProblemSpike);
  }
  if (liveIndicator) {
    const alert = activeCritical || hasProblemSpike;
    liveIndicator.classList.toggle("has-alert", alert);
    liveIndicator.title = alert
      ? t("liveAlertActive")
      : t("liveAllClear");
  }
}

/* ----------------------------------------------------------- tablas UI --- */

function renderTeamMessages(messages, escalationEmail) {
  const container = document.getElementById("team-messages");
  const unreadCount = messages.filter((message) => message.unread).length;
  const unreadBadge = document.getElementById("unread-count");
  if (unreadBadge) {
    unreadBadge.textContent = String(unreadCount);
    unreadBadge.hidden = unreadCount === 0;
  }
  const inboxCount = document.getElementById("inbox-count");
  if (inboxCount) {
    inboxCount.textContent = String(messages.length);
    inboxCount.hidden = messages.length === 0;
  }
  container.innerHTML = messages.length ? messages.map((message) => `
    <article class="team-message${message.unread ? " is-unread" : ""}">
      <div class="team-message-head">
        <span class="message-avatar" aria-hidden="true">${escapeHtml(initials(message.sender))}</span>
        <div class="message-meta">
          <strong>${escapeHtml(message.sender)}</strong>
          <span class="message-role">${escapeHtml(dynamic("role_", message.role_key, message.role))}</span>
        </div>
        <time>${escapeHtml(message.time)}</time>
      </div>
      <p>${escapeHtml(message.message_key ? t(message.message_key) : message.message)}</p>
      <div class="message-actions">
        <button class="btn-quiet message-reply" type="button" data-sender="${escapeHtml(message.sender)}">${escapeHtml(t("replyAction"))}</button>
        ${message.unread ? `<span class="message-status">${escapeHtml(t("unread"))}</span>` : ""}
      </div>
    </article>
  `).join("") : `<p class="empty-state">${escapeHtml(t("noMessages"))}</p>`;

  const emailLink = document.getElementById("escalation-email");
  const subject = encodeURIComponent(t("emailTitle"));
  const body = encodeURIComponent(`${t("mailBody")}\n\n`);
  emailLink.href = `mailto:${encodeURIComponent(escalationEmail)}?subject=${subject}&body=${body}`;
  emailLink.title = escalationEmail
    ? `${t("contactSuperiors")} · ${escalationEmail}`
    : t("contactSuperiors");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function renderTicketsTable(tickets) {
  const tbody = document.getElementById("tickets-table-body");
  tbody.innerHTML = tickets.length ? tickets.map((ticket) => `
    <tr class="drilldown-trigger" tabindex="0" role="button" data-analysis-id="ticket-${escapeHtml(ticket.id)}" aria-label="${escapeHtml(ticket.id)}">
      <td data-label="${escapeHtml(t("ticketId"))}"><strong>${escapeHtml(ticket.id)}</strong></td>
      <td data-label="${escapeHtml(t("issue"))}">${escapeHtml(dynamic("case_type_", ticket.issue_key, ticket.issue))}</td>
      <td data-label="${escapeHtml(t("channel"))}">${escapeHtml(dynamic("channel_", ticket.channel_key, ticket.channel))}</td>
      <td data-label="${escapeHtml(t("severity"))}"><span class="severity severity-${escapeHtml(String(ticket.severity).toLowerCase())}">${escapeHtml(ticket.severity)}</span></td>
      <td data-label="${escapeHtml(t("status"))}">${escapeHtml(dynamic("status_", ticket.status_key, ticket.status))}</td>
      <td data-label="${escapeHtml(t("time"))}">${escapeHtml(ticket.time_open)}</td>
    </tr>
  `).join("") : emptyRow(6, t("emptyTickets"));
}

function renderAgentsTable(agents) {
  const tbody = document.getElementById("agents-table-body");
  tbody.innerHTML = agents.length ? agents.map((agent) => `
    <tr>
      <td data-label="${escapeHtml(t("agent"))}"><strong>${escapeHtml(agent.name)}</strong></td>
      <td data-label="${escapeHtml(t("role"))}">${escapeHtml(dynamic("role_", agent.role_key, agent.role))}</td>
      <td data-label="${escapeHtml(t("aht"))}">${escapeHtml(agent.aht_min)} min</td>
      <td data-label="${escapeHtml(t("csat"))}"><span class="score">${escapeHtml(agent.csat)} / 5</span></td>
      <td data-label="${escapeHtml(t("action"))}"><button class="btn-quiet feedback-btn" type="button" data-agent="${escapeHtml(agent.name)}">${escapeHtml(t("sentFeedback"))}</button></td>
    </tr>
  `).join("") : emptyRow(5, t("emptyAgents"));
  tbody.dataset.agentCount = String(agents.length);
}

function renderProductsTable(products) {
  const tbody = document.getElementById("products-table-body");
  const productAnalysisIds = ["oversized-hoodie", "denim-jacket", "loyalty-card"];
  tbody.innerHTML = products.length ? products.map((product) => `
    <tr class="drilldown-trigger" tabindex="0" role="button" data-analysis-id="product-${productAnalysisIds[products.indexOf(product)] || "oversized-hoodie"}" aria-label="${escapeHtml(product.product)}">
      <td data-label="${escapeHtml(t("product"))}"><strong>${escapeHtml(product.product)}</strong></td>
      <td data-label="${escapeHtml(t("category"))}">${escapeHtml(dynamic("category_", product.category_key, product.category))}</td>
      <td data-label="${escapeHtml(t("frequentCause"))}">${escapeHtml(dynamic("issue_", product.issue_key, product.issue))}</td>
      <td data-label="${escapeHtml(t("returns"))}"><span class="severity severity-high">${numberFormatter.format(product.returns)} ${escapeHtml(t("cases"))}</span></td>
    </tr>
  `).join("") : emptyRow(4, t("emptyProducts"));
}

function renderComplaints(complaints) {
  const tbody = document.getElementById("complaints-table-body");
  tbody.innerHTML = complaints.length ? complaints.map((complaint) => `
    <tr>
      <td data-label="${escapeHtml(t("complaint"))}"><strong>${escapeHtml(complaint.key ? t(complaint.key) : complaint.complaint)}</strong></td>
      <td data-label="${escapeHtml(t("recommendedSolution"))}">${escapeHtml(complaint.solution_key ? t(complaint.solution_key) : complaint.solution)}</td>
      <td data-label="${escapeHtml(t("responsibleQueue"))}">${escapeHtml(localizedValue(complaint.owner_key, complaint.owner))}</td>
    </tr>
  `).join("") : emptyRow(3, t("emptyComplaints"));
}

function sopStepsKey(code) {
  const suffix = String(code || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return suffix ? `${suffix}_steps` : "";
}

// Devuelve el contenido de un SOP ya localizado.
function localizedSop(sop) {
  const titleKey = sop.title_key;
  const categoryKey = sop.category_key;
  const stepsKey = sopStepsKey(sop.code);
  return {
    title: titleKey && t(titleKey) !== titleKey ? t(titleKey) : sop.title,
    category: categoryKey && t(categoryKey) !== categoryKey ? t(categoryKey) : sop.category,
    stepsText: stepsKey && t(stepsKey) !== stepsKey ? t(stepsKey) : sop.steps
  };
}

// Resuelve una clave i18n y, si no existe traducción, usa el texto neutral.
function localizedValue(key, fallback) {
  if (!key) return fallback ?? "";
  const value = t(key);
  return value === key ? (fallback ?? "") : value;
}

// Convierte la cadena de pasos ("1. … 2. …") en nodos de flujo numerados.
function splitSteps(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const chunks = raw.split(/(?=\b\d{1,2}[.)]\s)/).map((chunk) => chunk.trim()).filter(Boolean);
  const steps = chunks.map((chunk) => chunk.replace(/^\d{1,2}[.)]\s*/, "").trim()).filter(Boolean);
  return steps.length ? steps : [raw];
}

/* ---------------------------------------------------- notas operativas --- */

const SOP_NOTES_KEY = "br-sop-notes";
let sopNoteStore = null;

function loadSopNotes() {
  if (sopNoteStore) return sopNoteStore;
  try {
    sopNoteStore = JSON.parse(localStorage.getItem(SOP_NOTES_KEY)) || {};
  } catch (error) {
    sopNoteStore = {};
  }
  return sopNoteStore;
}

function persistSopNotes() {
  try {
    localStorage.setItem(SOP_NOTES_KEY, JSON.stringify(sopNoteStore || {}));
  } catch (error) {
    /* almacenamiento no disponible */
  }
}

function addSopNote(code, text) {
  const store = loadSopNotes();
  const notes = store[code] || [];
  notes.unshift({
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    at: new Date().toISOString()
  });
  store[code] = notes.slice(0, 20);
  persistSopNotes();
}

function deleteSopNote(code, noteId) {
  const store = loadSopNotes();
  if (!store[code]) return;
  store[code] = store[code].filter((note) => note.id !== noteId);
  if (!store[code].length) delete store[code];
  persistSopNotes();
}

function renderSopNotes(code) {
  const list = document.querySelector(`[data-sop-notes="${CSS.escape(code)}"] .sop-note-list`);
  if (!list) return;
  const notes = loadSopNotes()[code] || [];
  list.innerHTML = notes.length
    ? notes.map((note) => `
      <li class="sop-note">
        <span class="sop-note-text">${escapeHtml(note.text)}</span>
        <button class="sop-note-delete" type="button" data-note-code="${escapeHtml(code)}" data-note-id="${escapeHtml(note.id)}" aria-label="${escapeHtml(t("deleteNote"))}" title="${escapeHtml(t("deleteNote"))}">×</button>
      </li>`).join("")
    : `<li class="sop-note is-empty">${escapeHtml(t("noNotes"))}</li>`;
}

/* ---------------------------------------------------- manual operativo --- */

let sopSignature = "";
let sopQuery = "";

function visibleSops() {
  const all = metricsData?.sops || [];
  if (!sopQuery) return all;
  const query = sopQuery.toLocaleLowerCase(activeLanguage);
  return all.filter((sop) => {
    const view = localizedSop(sop);
    return [sop.code, view.title, view.category, view.stepsText]
      .some((value) => String(value ?? "").toLocaleLowerCase(activeLanguage).includes(query));
  });
}

function renderSOPs(sops, { force = false } = {}) {
  const container = document.getElementById("sops-container");
  if (!container) return;
  const signature = `${activeLanguage}|${sopQuery}|${(sops || []).map((sop) => sop.code).join(",")}`;
  if (!force && signature === sopSignature && container.dataset.ready === "true") return;
  sopSignature = signature;

  container.innerHTML = (sops || []).length ? sops.map((sop) => {
    const view = localizedSop(sop);
    const steps = splitSteps(view.stepsText);
    return `
    <article class="sop-card">
      <header class="sop-card-head">
        <span class="sop-code">${escapeHtml(sop.code)}</span>
        <span class="eyebrow">${escapeHtml(view.category)}</span>
      </header>
      <p class="sop-title">${escapeHtml(view.title)}</p>
      <p class="sop-flow-label">${escapeHtml(t("processFlow"))}</p>
      <ol class="sop-flow">
        ${steps.map((step, index) => `
          <li class="sop-node">
            <span class="sop-node-index" aria-hidden="true">${index + 1}</span>
            <span class="sop-node-text">${escapeHtml(step)}</span>
          </li>`).join("")}
      </ol>
      <section class="sop-notes" data-sop-notes="${escapeHtml(sop.code)}">
        <h5 class="sop-notes-title">${escapeHtml(t("notesTitle"))}</h5>
        <ul class="sop-note-list"></ul>
        <form class="sop-note-form">
          <label class="sr-only" for="note-input-${escapeHtml(sop.code)}">${escapeHtml(t("noteInputPlaceholder"))}</label>
          <input id="note-input-${escapeHtml(sop.code)}" class="sop-note-input" type="text" maxlength="180" placeholder="${escapeHtml(t("noteInputPlaceholder"))}">
          <button class="btn-quiet sop-note-add" type="submit">${escapeHtml(t("addNote"))}</button>
        </form>
        <p class="sop-notes-hint">${escapeHtml(t("notesLocalHint"))}</p>
      </section>
    </article>`;
  }).join("") : `<p class="empty-state">${escapeHtml(t("emptySops"))}</p>`;

  container.dataset.ready = "true";
  (sops || []).forEach((sop) => renderSopNotes(sop.code));
}

function renderTicketKnowledge(items) {
  const container = document.getElementById("ticket-knowledge");
  if (!container) return;
  container.innerHTML = (items || []).length ? items.map((item) => `
    <article class="kb-card">
      <header class="kb-card-head">
        <span class="kb-id">${escapeHtml(item.id)}</span>
        <span class="severity severity-${escapeHtml(String(item.severity).toLowerCase())}">${escapeHtml(item.severity)}</span>
      </header>
      <h4>${escapeHtml(localizedValue(item.title_key, item.title))}</h4>
      <p class="kb-desc">${escapeHtml(localizedValue(item.desc_key, item.desc))}</p>
      <p class="kb-tip"><span class="kb-tag">${escapeHtml(t("agentTip"))}</span>${escapeHtml(localizedValue(item.tip_key, item.tip))}</p>
      <blockquote class="kb-phrasing">${escapeHtml(t(item.phrasing_key))}</blockquote>
    </article>
  `).join("") : `<p class="empty-state">${escapeHtml(t("emptySops"))}</p>`;
}

function renderFaq(items) {
  const container = document.getElementById("faq-container");
  if (!container) return;
  container.innerHTML = (items || []).length ? items.map((item) => `
    <article class="kb-card">
      <p class="kb-question">${escapeHtml(localizedValue(item.question_key, item.question))}</p>
      <p class="kb-answer">${escapeHtml(localizedValue(item.answer_key, item.answer))}</p>
      <blockquote class="kb-phrasing"><span class="kb-tag">${escapeHtml(t("recommendedPhrasing"))}</span>${escapeHtml(t(item.phrasing_key))}</blockquote>
    </article>
  `).join("") : `<p class="empty-state">${escapeHtml(t("emptySops"))}</p>`;
}

/* ------------------------------------------------------- mensajería --- */

const SENT_MESSAGES_KEY = "br-sent-messages";
let teamDirectoryCache = [];
let sentMessages = [];
let mailView = "inbox";

function loadSentMessages() {
  try {
    const stored = JSON.parse(localStorage.getItem(SENT_MESSAGES_KEY));
    sentMessages = Array.isArray(stored) ? stored : [];
  } catch (error) {
    sentMessages = [];
  }
  return sentMessages;
}

function persistSentMessages() {
  try {
    localStorage.setItem(SENT_MESSAGES_KEY, JSON.stringify(sentMessages.slice(0, 40)));
  } catch (error) {
    /* almacenamiento no disponible */
  }
}

function currentTime() {
  return new Date().toLocaleTimeString(activeLanguage === "zh" ? "zh-CN" : activeLanguage, { hour: "2-digit", minute: "2-digit" });
}

function initials(name) {
  const parts = String(name || "BR").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]).join("") || "BR").toLocaleUpperCase();
}

function roleLabel(roleKey, fallback) {
  const suffix = String(roleKey || "").replace(/^role_/, "");
  return dynamic("role_", suffix, fallback);
}

function findDirectoryMember(name) {
  const needle = String(name || "").trim().toLocaleLowerCase();
  if (!needle) return null;
  return teamDirectoryCache.find((member) => {
    const candidate = String(member.name || "").toLocaleLowerCase();
    return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
  }) || null;
}

function syncRecipientChips() {
  const select = document.getElementById("message-recipient");
  const value = select?.value || "";
  document.querySelectorAll(".recipient-chip").forEach((chip) => {
    chip.classList.toggle("is-active", chip.dataset.recipient === value);
  });
}

function renderTeamDirectory(directory) {
  teamDirectoryCache = Array.isArray(directory) ? directory : [];
  const select = document.getElementById("message-recipient");
  if (select) {
    const previous = select.value;
    select.innerHTML = teamDirectoryCache.map((member) => `
      <option value="${escapeHtml(member.email || member.name)}">${escapeHtml(member.name)} · ${escapeHtml(roleLabel(member.role_key, member.role))}</option>
    `).join("");
    if (previous && [...select.options].some((option) => option.value === previous)) select.value = previous;
  }
  const chips = document.getElementById("recipient-chips");
  if (chips) {
    chips.innerHTML = teamDirectoryCache.map((member) => `
      <button class="recipient-chip" type="button" data-recipient="${escapeHtml(member.email || member.name)}" title="${escapeHtml(roleLabel(member.role_key, member.role))}">
        <span class="chip-avatar" aria-hidden="true">${escapeHtml(initials(member.name))}</span>
        <span class="chip-name">${escapeHtml(member.name)}</span>
      </button>
    `).join("");
    syncRecipientChips();
  }
}

function switchMailView(view) {
  mailView = view === "sent" ? "sent" : "inbox";
  document.getElementById("message-compose").hidden = true;
  document.querySelectorAll(".mail-tab").forEach((tab) => {
    const active = tab.dataset.mailView === mailView;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.getElementById("mail-inbox").hidden = mailView !== "inbox";
  document.getElementById("mail-sent").hidden = mailView !== "sent";
  if (mailView === "sent") renderSentMessages();
}

function openComposer({ recipient = "", subject = "", body = "" } = {}) {
  const form = document.getElementById("message-compose");
  if (!form) return;
  form.hidden = false;
  document.getElementById("mail-inbox").hidden = true;
  document.getElementById("mail-sent").hidden = true;
  const select = document.getElementById("message-recipient");
  if (recipient && select && [...select.options].some((option) => option.value === recipient)) select.value = recipient;
  const subjectInput = document.getElementById("message-subject");
  const bodyInput = document.getElementById("message-body");
  if (subjectInput) subjectInput.value = subject;
  if (bodyInput) bodyInput.value = body;
  syncRecipientChips();
  (subjectInput || bodyInput)?.focus();
}

function closeComposer() {
  switchMailView(mailView);
}

function renderSentMessages() {
  const container = document.getElementById("sent-messages");
  if (!container) return;
  const sender = activeProfile?.name || "BR";
  container.innerHTML = sentMessages.length ? sentMessages.map((message, index) => `
    <article class="team-message is-outgoing">
      <div class="team-message-head">
        <span class="message-avatar" aria-hidden="true">${escapeHtml(initials(sender))}</span>
        <div class="message-meta">
          <strong>${escapeHtml(sender)}</strong>
          <span class="message-role">${escapeHtml(t("toLabel"))} ${escapeHtml(message.target)}</span>
        </div>
        <time>${escapeHtml(message.time)}</time>
      </div>
      ${message.subject ? `<p class="message-subject">${escapeHtml(message.subject)}</p>` : ""}
      <p>${escapeHtml(message.text)}</p>
      <div class="message-actions">
        <button class="btn-quiet message-delete" type="button" data-sent-index="${index}">${escapeHtml(t("deleteMessage"))}</button>
      </div>
    </article>`).join("") : `<p class="empty-state">${escapeHtml(t("sentEmpty"))}</p>`;
  const count = document.getElementById("sent-count");
  if (count) {
    count.textContent = String(sentMessages.length);
    count.hidden = sentMessages.length === 0;
  }
}

function handleComposeSubmit(event) {
  event.preventDefault();
  const select = document.getElementById("message-recipient");
  const body = document.getElementById("message-body");
  const subjectInput = document.getElementById("message-subject");
  if (!select || !body) return;
  const text = body.value.trim();
  const member = teamDirectoryCache.find((item) => (item.email || item.name) === select.value);
  if (!select.value || !text) {
    showToast(t("composeRequired"), "error");
    return;
  }
  const target = member?.name || select.options[select.selectedIndex]?.textContent || "";
  sentMessages.unshift({
    sender: activeProfile?.name || "BR",
    target,
    subject: subjectInput?.value.trim() || "",
    text,
    time: currentTime()
  });
  sentMessages = sentMessages.slice(0, 40);
  persistSentMessages();
  if (subjectInput) subjectInput.value = "";
  body.value = "";
  switchMailView("sent");
  showToast(`${t("messageSent")} ${target}`, "success");
}

function sendComposeEmail() {
  const select = document.getElementById("message-recipient");
  const body = document.getElementById("message-body");
  const subjectInput = document.getElementById("message-subject");
  if (!select || !body) return;
  const member = teamDirectoryCache.find((item) => (item.email || item.name) === select.value);
  const to = member?.email || metricsData?.escalation_email || "";
  const subject = encodeURIComponent(subjectInput?.value.trim() || t("emailSubjectPrefix"));
  const mailBody = encodeURIComponent(body.value.trim() || t("mailBody"));
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${subject}&body=${mailBody}`;
}

function renderLogs(logs) {
  const terminal = document.getElementById("log-terminal");
  terminal.innerHTML = logs.map((log) => `
    <p class="log-entry">
      <span class="log-time">[${escapeHtml(log.time)}]</span>
      <span class="log-${escapeHtml(String(log.level).toLowerCase())}">[${escapeHtml(log.level)}]</span>
      ${escapeHtml(log.message_key ? t(log.message_key) : log.message)}
    </p>
  `).join("");
}

function emptyRow(columns, message) {
  return `<tr><td class="empty-state" colspan="${columns}">${escapeHtml(message)}</td></tr>`;
}

/* --------------------------------------------------- respuesta IA (RAG) --- */

function renderAiInsight(container, text) {
  const raw = String(text || "").trim();
  container.dataset.raw = raw;
  container.replaceChildren();
  if (!raw) return;

  let list = null;
  const ensureList = () => {
    if (list) return list;
    const section = document.createElement("section");
    section.className = "ai-section";
    list = document.createElement("ul");
    list.className = "ai-section-list";
    section.appendChild(list);
    container.appendChild(section);
    return list;
  };

  raw.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      const section = document.createElement("section");
      section.className = "ai-section";
      const title = document.createElement("h3");
      title.className = "ai-section-title";
      title.textContent = normalizeSectionTitle(heading[1]);
      section.appendChild(title);
      list = document.createElement("ul");
      list.className = "ai-section-list";
      section.appendChild(list);
      container.appendChild(section);
      return;
    }
    const item = document.createElement("li");
    item.textContent = line.replace(/^[-*•]\s+/, "");
    if (!/^[-*•]\s+/.test(line)) item.classList.add("ai-plain-line");
    ensureList().appendChild(item);
  });
}

function appendCaseButton(container, caseId) {
  const wrap = document.createElement("div");
  wrap.className = "ai-actions inline-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-quiet case-detail-btn";
  button.dataset.caseId = caseId;
  button.textContent = t("caseDetailButton");
  wrap.appendChild(button);
  container.appendChild(wrap);
  return button;
}

function setCaseAction(buttonId, caseId) {
  const button = document.getElementById(buttonId);
  if (!button) return;
  const container = button.parentElement;
  if (!caseId) {
    container.hidden = true;
    button.removeAttribute("data-case-id");
    return;
  }
  container.hidden = false;
  button.dataset.caseId = caseId;
  button.textContent = t("caseDetailButton");
}

async function runDiagnostic() {
  const button = document.getElementById("btn-run-ai");
  const box = document.getElementById("ai-response-box");
  setLoading(button, true, t("loadingAI"));
  box.classList.add("is-loading");
  box.dataset.generated = "true";
  delete box.dataset.raw;
  box.textContent = `${t("analyzing")} ${t("timeoutLabel")}`;
  setCaseAction("ai-case-detail", null);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 10000);

  try {
    const data = await requestJson(
      `/api/generate-insight?language=${encodeURIComponent(activeLanguage)}`,
      { signal: controller.signal }
    );
    box.classList.remove("is-loading");
    renderAiInsight(box, data.insight);
    setCaseAction("ai-case-detail", data.case_id);
    showToast(data.source === "groq" ? t("insightReady") : t("intelligentFallback"), data.source === "groq" ? "success" : "info");
  } catch (error) {
    const timedOut = error.name === "AbortError";
    let fallback;
    try {
      fallback = await requestJson(
        `/api/generate-insight?language=${encodeURIComponent(activeLanguage)}&fallback=true`
      );
    } catch (fallbackError) {
      console.error("Backend fallback unavailable; usando análisis local:", fallbackError);
      fallback = buildBrowserFallback();
    }
    box.classList.remove("is-loading");
    renderAiInsight(box, `${fallback.insight}\n\n- ${timedOut ? t("timeoutLabel") : t("fallbackUnavailable")}`);
    setCaseAction("ai-case-detail", fallback.case_id || null);
    showToast(
      fallback.source === "browser-fallback" ? t("fallbackUnavailable") : t("intelligentFallback"),
      "info"
    );
  } finally {
    window.clearTimeout(timeoutId);
    setLoading(button, false);
  }
}

function buildBrowserFallback() {
  const kpis = metricsData?.kpis || {};
  const qa = metricsData?.qa_compliance_trend?.values?.slice(-1)[0] ?? "—";
  const priorityTicket = (metricsData?.active_critical_tickets || [])
    .filter((ticket) => !/resolved|closed/i.test(`${ticket.status_key || ""} ${ticket.status}`))
    .sort((left, right) => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[left.severity] ?? 4)
      - ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }[right.severity] ?? 4))[0];
  const product = (metricsData?.top_complaint_products || [])
    .slice()
    .sort((left, right) => right.returns - left.returns)[0];
  const insight = [
    `### ${t("aiSectionSummary")}`,
    `- BR (Building Reliability) · H&M · ${t("kpiVolume")}: ${numberFormatter.format(kpis.daily_volume ?? 0)} · ${t("kpiActive")}: ${numberFormatter.format(kpis.active_tickets ?? 0)}.`,
    `- ${t("kpiFcr")}: ${kpis.fcr ?? "—"}% (${t("targetFcr")}) · ${t("kpiAsa")}: ${kpis.asa_seconds ?? "—"}s (${t("targetAsa")}) · ${t("kpiCsat")}: ${kpis.csat ?? "—"}/5 · QA: ${qa}%.`,
    `### ${t("aiSectionAction")}`,
    `- ${t("priority")}: ${priorityTicket ? `${priorityTicket.id} · ${priorityTicket.severity} · ${dynamic("case_type_", priorityTicket.issue_key, priorityTicket.issue)}` : t("emptyTickets")}.`,
    `- ${t("recommendation")}: ${priorityTicket ? t("drillTicketRecommendation") : t("drillKpiRecommendation")}`,
    `### ${t("aiSectionRisk")}`,
    product ? `- ${t("topComplaints")}: ${product.product} · ${dynamic("issue_", product.issue_key, product.issue)} · ${numberFormatter.format(product.returns)} ${t("cases")}.` : `- ${t("emptyProducts")}`,
    `- ${t("issueKpiPressure")}`
  ].join("\n");
  return {
    insight,
    source: "browser-fallback",
    case_id: priorityTicket?.id || null
  };
}

/* ------------------------------------------------- detalle del caso UI --- */

async function openCaseDetail(caseId, opener, showLoading = true) {
  if (!caseId) return;
  const modal = document.getElementById("case-modal");
  const body = document.getElementById("case-modal-body");
  if (!modal.classList.contains("is-open")) caseOpener = opener || null;
  activeCaseId = caseId;
  modal.hidden = false;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("case-backdrop").hidden = false;
  setText("case-modal-title", caseId);
  if (showLoading || !activeCaseData || activeCaseData.id !== caseId) {
    body.innerHTML = `<p class="case-loading">${escapeHtml(t("loadingCase"))}</p>`;
  }
  document.getElementById("close-case").focus();

  try {
    const data = await requestJson(`/api/case/${encodeURIComponent(caseId)}`);
    if (!modal.classList.contains("is-open") || activeCaseId !== caseId) return;
    activeCaseData = data.case || data;
    renderCaseDetail(activeCaseData);
  } catch (error) {
    body.innerHTML = `<p class="case-error">${escapeHtml(t("caseLoadError"))} ${escapeHtml(error.message)}</p>`;
  }
}

function closeCaseDetail() {
  const modal = document.getElementById("case-modal");
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("case-backdrop").hidden = true;
  window.setTimeout(() => {
    if (!modal.classList.contains("is-open")) modal.hidden = true;
  }, 190);
  caseOpener?.focus();
  caseOpener = null;
  activeCaseId = null;
}

function formatMetricValue(metric) {
  const unit = metric.unit ? (String(metric.unit).startsWith(" ") ? metric.unit : ` ${metric.unit}`) : "";
  const value = typeof metric.value === "number" ? numberFormatter.format(metric.value) : metric.value;
  return `${value ?? "—"}${unit}`;
}

function renderCaseDetail(caseData) {
  if (!caseData) return;
  const body = document.getElementById("case-modal-body");
  setText("case-modal-title", caseData.id || "—");

  const telemetry = (caseData.telemetry || []).map((metric) => `
    <div class="telemetry-chip trend-${escapeHtml(String(metric.trend || "flat").toLowerCase())}">
      <span class="telemetry-label">${escapeHtml(t(metric.key))}</span>
      <strong class="telemetry-value">${escapeHtml(formatMetricValue(metric))}</strong>
    </div>
  `).join("");

  const users = (caseData.affected_users || [])
    .map((user) => `<span class="user-chip">${escapeHtml(user)}</span>`).join("");

  const logs = (caseData.logs || []).length ? caseData.logs.map((log) => `
    <li class="case-log">
      <span class="log-time">[${escapeHtml(log.time)}]</span>
      <span class="log-${escapeHtml(String(log.level).toLowerCase())}">${escapeHtml(log.level)}</span>
      <span class="case-log-message">${escapeHtml(log.message_key ? t(log.message_key) : log.message)}</span>
    </li>
  `).join("") : `<li class="empty-state">${escapeHtml(t("caseNoLogs"))}</li>`;

  const resolutionStepsKey = caseData.resolution?.code ? sopStepsKey(caseData.resolution.code) : "";
  const localizedStepsText = resolutionStepsKey && t(resolutionStepsKey) !== resolutionStepsKey
    ? t(resolutionStepsKey)
    : null;
  const steps = (localizedStepsText
    ? splitSteps(localizedStepsText)
    : (caseData.resolution?.steps || []).map((step) => step.text))
    .map((text) => `<li>${escapeHtml(text)}</li>`).join("");

  const resolutionTitle = caseData.resolution?.title_key
    ? t(caseData.resolution.title_key)
    : (caseData.resolution?.title || "");

  body.innerHTML = `
    <div class="case-meta">
      <span class="severity severity-${escapeHtml(String(caseData.severity || "").toLowerCase())}">${escapeHtml(caseData.severity || "")}</span>
      <span class="case-chip">${escapeHtml(t("caseTypeLabel"))}: ${escapeHtml(t(`case_type_${caseData.type}`))}</span>
      <span class="case-chip">${escapeHtml(t("channel"))}: ${escapeHtml(dynamic("channel_", caseData.channel_key, caseData.channel))}</span>
      <span class="case-chip">${escapeHtml(t("status"))}: ${escapeHtml(dynamic("status_", caseData.status_key, caseData.status))}</span>
      <span class="case-chip">${escapeHtml(t("caseOwner"))}: ${escapeHtml(localizedValue(caseData.owner_key, ""))}</span>
      <span class="case-chip ${caseData.sla_at_risk ? "is-alert" : "is-ok"}">
        ${escapeHtml(caseData.sla_at_risk ? t("slaAtRisk") : t("slaOnTrack"))} · ${escapeHtml(String(caseData.sla_used_pct ?? 0))}%
      </span>
      <span class="case-chip">${escapeHtml(t("caseSla"))}: ${escapeHtml(String(caseData.sla_minutes ?? "—"))} min</span>
      <span class="case-chip">${escapeHtml(t("caseTimeOpen"))}: ${escapeHtml(caseData.time_open || "—")}</span>
    </div>
    <p class="case-issue">${escapeHtml(caseData.issue_key ? t(`case_type_${caseData.issue_key}`) : (caseData.issue || ""))}</p>
    <section class="case-section">
      <h3>${escapeHtml(t("caseTelemetry"))}</h3>
      <div class="telemetry-grid">${telemetry}</div>
    </section>
    <div class="case-columns">
      <section class="case-section">
        <h3>${escapeHtml(t("affectedUsers"))}</h3>
        <div class="user-chips">${users || "—"}</div>
      </section>
      <section class="case-section">
        <h3>${escapeHtml(t("impactedOrders"))}</h3>
        <p class="case-metric">${escapeHtml(numberFormatter.format(caseData.impacted_orders ?? 0))}</p>
        <p class="case-sub">${escapeHtml(t("regionalImpact"))}: ${escapeHtml(caseData.regional_impact || "—")}</p>
      </section>
    </div>
    <section class="case-section">
      <h3>${escapeHtml(t("historicalLogs"))}</h3>
      <ul class="case-logs">${logs}</ul>
    </section>
    <section class="case-section">
      <h3>${escapeHtml(t("resolutionSteps"))} · ${escapeHtml(caseData.resolution?.code || "")}</h3>
      ${resolutionTitle ? `<p class="case-sub">${escapeHtml(resolutionTitle)}</p>` : ""}
      <ol class="case-steps">${steps || "<li>—</li>"}</ol>
    </section>
  `;
}

/* ---------------------------------------------------------- interactivo --- */

function setupEventListeners() {
  document.getElementById("login-form").addEventListener("submit", submitLogin);
  document.getElementById("login-language").addEventListener("change", (event) => {
    applyLanguage(event.currentTarget.value);
    document.getElementById("login-error").hidden = true;
  });
  document.getElementById("logout-button").addEventListener("click", logout);
  document.getElementById("btn-run-ai").addEventListener("click", runDiagnostic);
  document.getElementById("btn-apply-patch").addEventListener("click", applyPatch);
  document.getElementById("chat-form").addEventListener("submit", sendChatMessage);
  document.getElementById("top-kpi-bar").addEventListener("click", handleDrilldownClick);
  document.getElementById("top-kpi-bar").addEventListener("keydown", handleDrilldownKeydown);
  document.getElementById("tickets-table-body").addEventListener("click", handleDrilldownClick);
  document.getElementById("tickets-table-body").addEventListener("keydown", handleDrilldownKeydown);
  document.getElementById("products-table-body").addEventListener("click", handleDrilldownClick);
  document.getElementById("products-table-body").addEventListener("keydown", handleDrilldownKeydown);
  document.getElementById("close-analysis").addEventListener("click", closeAnalysis);
  document.getElementById("analysis-backdrop").addEventListener("click", closeAnalysis);
  document.getElementById("close-case").addEventListener("click", closeCaseDetail);
  document.getElementById("case-backdrop").addEventListener("click", closeCaseDetail);

  // Botones "Ver detalle del caso" (diagnóstico IA, chat y modal de análisis).
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".case-detail-btn");
    if (button?.dataset.caseId) openCaseDetail(button.dataset.caseId, button);
  });
  document.addEventListener("keydown", (event) => {
    const button = event.target.closest?.(".case-detail-btn");
    if (button?.dataset.caseId && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openCaseDetail(button.dataset.caseId, button);
    }
  });

  const drawer = document.getElementById("messages-drawer");
  const messageTrigger = document.getElementById("open-messages");
  messageTrigger.addEventListener("click", () => {
    drawer.hidden = false;
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    messageTrigger.setAttribute("aria-expanded", "true");
    document.getElementById("drawer-backdrop").hidden = false;
    document.querySelectorAll(".team-message.is-unread").forEach((message) => {
      message.classList.remove("is-unread");
      message.querySelector(".message-status")?.remove();
    });
    document.getElementById("unread-count").hidden = true;
    setText("unread-count", "0");
    switchMailView("inbox");
    document.getElementById("close-messages").focus();
  });
  const closeDrawer = () => {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    messageTrigger.setAttribute("aria-expanded", "false");
    document.getElementById("drawer-backdrop").hidden = true;
    window.setTimeout(() => {
      if (!drawer.classList.contains("is-open")) drawer.hidden = true;
    }, 240);
    messageTrigger.focus();
  };
  document.getElementById("close-messages").addEventListener("click", closeDrawer);
  document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    const caseModal = document.getElementById("case-modal");
    if (caseModal.classList.contains("is-open")) {
      if (event.key === "Escape") closeCaseDetail();
      if (event.key === "Tab") {
        event.preventDefault();
        document.getElementById("close-case").focus();
      }
      return;
    }
    if (event.key === "Escape" && drawer.classList.contains("is-open")) {
      closeDrawer();
      return;
    }
    const modal = document.getElementById("analysis-modal");
    if (!modal.classList.contains("is-open")) return;
    if (event.key === "Escape") closeAnalysis();
    if (event.key === "Tab") {
      event.preventDefault();
      document.getElementById("close-analysis").focus();
    }
  });

  document.getElementById("sop-search").addEventListener("input", (event) => {
    sopQuery = event.target.value.trim();
    renderSOPs(visibleSops(), { force: true });
  });

  // Notas operativas dentro de las tarjetas del manual (delegado).
  document.addEventListener("submit", (event) => {
    const form = event.target.closest(".sop-note-form");
    if (!form) return;
    event.preventDefault();
    const code = form.closest("[data-sop-notes]")?.dataset.sopNotes;
    const input = form.querySelector(".sop-note-input");
    const text = input?.value.trim();
    if (!code || !text) {
      showToast(t("noteRequired"), "error");
      return;
    }
    addSopNote(code, text);
    if (input) input.value = "";
    renderSopNotes(code);
    showToast(t("noteAdded"), "success");
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest(".sop-note-delete");
    if (!button) return;
    deleteSopNote(button.dataset.noteCode, button.dataset.noteId);
    renderSopNotes(button.dataset.noteCode);
    showToast(t("noteDeleted"), "success");
  });

  // Mensajería tipo "mini Gmail": carpetas, redacción, destinatario y respuesta.
  document.getElementById("message-compose").addEventListener("submit", handleComposeSubmit);
  document.getElementById("email-message").addEventListener("click", sendComposeEmail);
  document.getElementById("compose-open").addEventListener("click", () => openComposer());
  document.getElementById("compose-close").addEventListener("click", closeComposer);
  document.querySelectorAll(".mail-tab").forEach((tab) => {
    tab.addEventListener("click", () => switchMailView(tab.dataset.mailView));
  });
  document.getElementById("message-recipient").addEventListener("change", syncRecipientChips);
  document.getElementById("recipient-chips").addEventListener("click", (event) => {
    const chip = event.target.closest(".recipient-chip");
    if (!chip) return;
    document.getElementById("message-recipient").value = chip.dataset.recipient;
    syncRecipientChips();
    document.getElementById("message-body").focus();
  });
  document.getElementById("team-messages").addEventListener("click", (event) => {
    const button = event.target.closest(".message-reply");
    if (!button) return;
    const member = findDirectoryMember(button.dataset.sender);
    openComposer({
      recipient: member ? (member.email || member.name) : "",
      subject: `Re: ${t("teamMessages")}`
    });
  });
  document.getElementById("sent-messages").addEventListener("click", (event) => {
    const button = event.target.closest(".message-delete");
    if (!button) return;
    sentMessages.splice(Number(button.dataset.sentIndex), 1);
    persistSentMessages();
    renderSentMessages();
    showToast(t("noteDeleted"), "success");
  });

  document.getElementById("agents-table-body").addEventListener("click", (event) => {
    const button = event.target.closest(".feedback-btn");
    if (!button) return;
    showToast(`${t("sentFeedback")}: ${button.dataset.agent}.`, "success");
  });

  document.getElementById("toast-close").addEventListener("click", hideToast);
}

function handleDrilldownKeydown(event) {
  if ((event.key === "Enter" || event.key === " ") && event.target.closest(".drilldown-trigger")) {
    event.preventDefault();
    openAnalysis(event.target.closest(".drilldown-trigger"));
  }
}

function handleDrilldownClick(event) {
  const trigger = event.target.closest(".drilldown-trigger");
  if (trigger) openAnalysis(trigger);
}

async function openAnalysis(trigger, requestAI = true) {
  const analysisId = trigger.dataset.analysisId;
  const parts = analysisId.split("-");
  const type = parts.shift();
  const key = parts.join("-");
  const drilldowns = metricsData?.drilldown_analytics;
  const data = type === "ticket" ? drilldowns?.tickets?.[key]
    : type === "product" ? drilldowns?.products?.[key]
      : drilldowns?.[analysisId];
  if (!data) {
    showToast(t("noHistoricalData"), "error");
    return;
  }

  const productIndex = ["oversized-hoodie", "denim-jacket", "loyalty-card"].indexOf(key);
  const ticket = type === "ticket" ? metricsData.active_critical_tickets.find((item) => item.id === key) : null;
  const title = type === "kpi"
    ? trigger.querySelector(".kpi-title").textContent
    : type === "ticket"
      ? dynamic("case_type_", ticket?.issue_key, ticket?.issue || key)
      : metricsData.top_complaint_products[productIndex]?.product || key;
  const recommendationKey = type === "ticket" ? "drillTicketRecommendation"
    : type === "product" ? "drillProductRecommendation"
      : "drillKpiRecommendation";
  const impactKey = type === "ticket" ? "drillTicketImpact"
    : type === "product" ? "drillProductImpact"
      : "drillKpiImpact";
  const modal = document.getElementById("analysis-modal");
  if (!modal.classList.contains("is-open")) analysisOpener = trigger;
  modal.hidden = false;
  modal.dataset.analysisId = analysisId;
  document.getElementById("analysis-title").textContent = title;
  setText("analysis-recommendation", data.recommendation || t(recommendationKey));
  setText("analysis-impact", data.expected_kpi_impact || t(impactKey));
  renderActionList("analysis-issues", buildIssues(type));
  renderActionList("analysis-fixes", buildFixes(type));
  const aiResponse = document.getElementById("ai-analysis-response");
  delete aiResponse.dataset.raw;
  aiResponse.replaceChildren();
  setCaseAction("analysis-case-detail", null);
  createChart("chart-analysis", {
    type: "line",
    data: {
      labels: translatePeriodLabels(data.labels),
      datasets: [{
        label: `${t("drillHistorical")} (${data.unit || ""})`,
        data: data.values,
        borderColor: "#00D2FF",
        backgroundColor: "rgba(0, 210, 255, .13)",
        fill: true,
        tension: 0.35,
        pointRadius: 4
      }]
    },
    options: chartOptions({
      scales: {
        x: { ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } },
        y: { beginAtZero: false, ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } }
      }
    })
  });
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("analysis-backdrop").hidden = false;
  document.getElementById("close-analysis").focus();
  if (!requestAI) return;
  aiResponse.textContent = t("loadingAI");

  try {
    const result = await requestJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        language: activeLanguage,
        message: `Provide a short executive analysis in the selected language for ${title}. Include one actionable recommendation, expected measurable KPI impact, and major risk. Use only this operational context: ${JSON.stringify({ current: data, kpis: metricsData.kpis, ticket, product: type === "product" ? metricsData.top_complaint_products[productIndex] : undefined })}`
      })
    });
    if (modal.classList.contains("is-open") && modal.dataset.analysisId === analysisId) {
      renderAiInsight(aiResponse, result.response);
      setCaseAction("analysis-case-detail", result.case_id);
    }
  } catch (error) {
    if (modal.classList.contains("is-open") && modal.dataset.analysisId === analysisId) {
      aiResponse.textContent = error.message.includes("GROQ_API_KEY")
        ? t("assistantUnavailable")
        : error.message;
    }
  }
}

// "Problemas a reparar": fricciones concretas detectadas según el tipo de indicador.
const ISSUE_KEYS = {
  kpi: ["issueKpiOffTarget", "issueKpiSpread", "issueKpiPressure"],
  ticket: ["issueTicketActive", "issueTicketSla", "issueTicketRepeat"],
  product: ["issueProductVolume", "issueProductRoot", "issueProductReturn"]
};

// "Cómo reparar": plan de acción accionable por tipo de indicador.
const FIX_KEYS = {
  kpi: ["fixKpiOwner", "fixKpiCoach", "fixVerify"],
  ticket: ["fixTicketOwner", "fixTicketContain", "fixVerify"],
  product: ["fixProductRoot", "fixProductMonitor", "fixVerify"]
};

function buildIssues(type) {
  return (ISSUE_KEYS[type] || ISSUE_KEYS.kpi).map((key) => t(key));
}

function buildFixes(type) {
  return (FIX_KEYS[type] || FIX_KEYS.kpi).map((key) => t(key));
}

function renderActionList(id, values) {
  const list = document.getElementById(id);
  if (!list) return;
  list.replaceChildren(...(values || []).map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}

function closeAnalysis() {
  const modal = document.getElementById("analysis-modal");
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("analysis-backdrop").hidden = true;
  window.setTimeout(() => {
    if (!modal.classList.contains("is-open")) modal.hidden = true;
  }, 190);
  analysisOpener?.focus();
  analysisOpener = null;
}

async function logout() {
  try {
    await requestJson("/api/logout", { method: "POST" });
    stopLivePolling();
    lastSimTicketId = null;
    const login = document.getElementById("login-screen");
    document.getElementById("dashboard").hidden = true;
    login.hidden = false;
    document.getElementById("access-pin").value = "";
    requestAnimationFrame(() => {
      login.classList.remove("is-leaving");
      document.getElementById("access-pin").focus();
    });
  } catch (error) {
    showToast(`${t("logoutError")} ${error.message}`, "error");
  }
}

async function sendChatMessage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = document.getElementById("chat-input");
  const button = document.getElementById("chat-submit");
  const message = input.value.trim();
  if (!message) return;

  addChatBubble(message, "user-bubble");
  input.value = "";
  input.disabled = true;
  const responseBubble = addChatBubble(t("loadingChat"), "assistant-bubble");
  setLoading(button, true, t("loadingButton"));
  try {
    const result = await requestJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, language: activeLanguage })
    });
    renderAiInsight(responseBubble, result.response);
    if (result.case_id) {
      responseBubble.dataset.caseId = result.case_id;
      appendCaseButton(responseBubble, result.case_id);
    }
  } catch (error) {
    const failureMessage = error.message.includes("GROQ_API_KEY") ? t("assistantUnavailable") : error.message;
    responseBubble.textContent = failureMessage;
    responseBubble.classList.add("chat-error");
    showToast(failureMessage, "error");
  } finally {
    setLoading(button, false);
    input.disabled = false;
    input.focus();
    form.closest(".chat-panel").querySelector(".chat-messages").scrollTop = Number.MAX_SAFE_INTEGER;
  }
}

function addChatBubble(content, className) {
  const container = document.getElementById("chat-messages");
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${className}`;
  if (typeof content === "string") bubble.textContent = content;
  else bubble.appendChild(content);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

async function applyPatch() {
  const button = document.getElementById("btn-apply-patch");
  setLoading(button, true, t("loadingButton"));

  try {
    const data = await requestJson("/api/apply-patch", { method: "POST" });
    const message = data.messageKey ? t(data.messageKey) : data.message;
    const alertBox = document.getElementById("patch-alert");
    alertBox.textContent = message;
    alertBox.classList.remove("hidden");
    alertBox.classList.add("is-visible");

    const ticket = metricsData?.active_critical_tickets?.find((item) => item.id === data.ticket_id);
    if (ticket) {
      ticket.status_key = data.status_key;
      ticket.status = message;
      renderTicketsTable(metricsData.active_critical_tickets);
      updateKpiStatus(metricsData.kpis, metricsData);
    }
    showToast(message, "success");
  } catch (error) {
    showToast(`${t("patchError")} ${error.message}`, "error");
  } finally {
    setLoading(button, false);
  }
}

function setLoading(button, isLoading, label) {
  if (isLoading) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(label)}`;
  } else {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = button.dataset.originalLabel || button.textContent;
  }
}

let toastTimeout;
function showToast(message, type = "info") {
  const toast = document.getElementById("toast");
  toast.className = `toast toast-${type}`;
  document.getElementById("toast-message").textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(hideToast, 4500);
}

function hideToast() {
  const toast = document.getElementById("toast");
  toast.classList.remove("is-visible");
  setTimeout(() => {
    toast.hidden = true;
  }, 220);
}

/* ----------------------------------------------------------- gráficas --- */

const AXIS_SCALES = {
  x: { ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } },
  y: { beginAtZero: true, ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } }
};

function initCharts(data) {
  if (typeof Chart === "undefined") {
    showToast(t("chartsLoadError"), "error");
    return;
  }

  const volume = data.interaction_volume || { labels: [], values: [] };
  const topProblems = volume.top_problems || [];
  const agents = data.agent_performance || [];
  const resolutions = data.resolution_breakdown || [];
  const qa = data.qa_compliance_trend || { labels: [], values: [], target: 95 };

  createChart("chart-volume", {
    type: "line",
    data: {
      labels: translatePeriodLabels(volume.labels),
      datasets: [{
        label: t("volumeErrors"),
        data: volume.values,
        borderColor: "#00D2FF",
        backgroundColor: "rgba(0, 210, 255, 0.12)",
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 6
      }, {
        label: t("topProblems"),
        data: topProblems,
        yAxisID: "y1",
        borderColor: "#FF5370",
        backgroundColor: "rgba(255, 83, 112, 0.12)",
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 6
      }]
    },
    options: chartOptions({
      scales: {
        x: { ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } },
        y: { beginAtZero: true, position: "left", ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } },
        y1: { beginAtZero: true, position: "right", ticks: { color: "#FF879A" }, grid: { drawOnChartArea: false } }
      }
    })
  });

  createChart("chart-agents-csat", {
    type: "bar",
    data: {
      labels: agents.map((agent) => agent.name),
      datasets: [{
        label: `${t("csat")} / 5`,
        data: agents.map((agent) => Number(agent.csat)),
        backgroundColor: "rgba(0, 210, 255, .72)",
        borderColor: "#00D2FF",
        borderWidth: 1,
        borderRadius: 6,
        xAxisID: "x"
      }, {
        label: t("aht"),
        data: agents.map((agent) => Number(agent.aht_min)),
        backgroundColor: "rgba(100, 255, 218, .68)",
        borderColor: "#64FFDA",
        borderWidth: 1,
        borderRadius: 6,
        xAxisID: "x1"
      }]
    },
    options: chartOptions({
      indexAxis: "y",
      scales: {
        x: { min: 0, max: 5, position: "bottom", title: { display: true, text: "CSAT / 5", color: "#00D2FF" }, ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } },
        x1: { min: 0, max: 6, position: "top", title: { display: true, text: "AHT / min", color: "#64FFDA" }, ticks: { color: "#8892B0" }, grid: { drawOnChartArea: false } },
        y: { ticks: { color: "#D8E2F3" }, grid: { display: false } }
      }
    })
  });

  createChart("chart-qa", {
    type: "line",
    data: {
      labels: translatePeriodLabels(qa.labels),
      datasets: [{
        label: `${t("qaTitle")} (%)`,
        data: qa.values,
        borderColor: "#64FFDA",
        backgroundColor: "rgba(100, 255, 218, 0.11)",
        fill: true,
        tension: 0.32,
        pointRadius: 3
      }, {
        label: `${t("qaTarget")} ${qa.target}%`,
        data: (qa.labels || []).map(() => qa.target),
        borderColor: "#FFB86C",
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false
      }]
    },
    options: chartOptions({
      scales: {
        x: { ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } },
        y: { min: 85, max: 100, ticks: { color: "#8892B0", callback: (value) => `${value}%` }, grid: { color: "rgba(136,146,176,.1)" } }
      }
    })
  });

  createChart("chart-resolutions", {
    type: "doughnut",
    data: {
      labels: resolutions.map((item, index) => [
        t("resolutionFcr"),
        t("resolutionL2"),
        t("resolutionLogistics")
      ][index] || item.label),
      datasets: [{
        data: resolutions.map((item) => item.value),
        backgroundColor: ["#00D2FF", "#64FFDA", "#FFB86C"],
        borderColor: "#112240",
        borderWidth: 4,
        hoverOffset: 8
      }]
    },
    options: chartOptions({ cutout: "68%" })
  });

  renderAnalyticsCharts(data.analytics || {});
}

function renderAnalyticsCharts(analytics) {
  const complaints = analytics.complaints_by_type || { labels: [], values: [] };
  createChart("chart-complaints", {
    type: "bar",
    data: {
      labels: complaints.labels.map((label) => t(label)),
      datasets: [{
        label: t("complaintsByType"),
        data: complaints.values,
        backgroundColor: "rgba(0, 210, 255, .68)",
        borderColor: "#00D2FF",
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: chartOptions({ scales: AXIS_SCALES })
  });

  const inquiries = analytics.inquiries_by_category || { labels: [], values: [] };
  createChart("chart-inquiries", {
    type: "bar",
    data: {
      labels: inquiries.labels.map((label) => t(label)),
      datasets: [{
        label: t("inquiriesByCategory"),
        data: inquiries.values,
        backgroundColor: "rgba(100, 255, 218, .6)",
        borderColor: "#64FFDA",
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: chartOptions({
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } },
        y: { ticks: { color: "#D8E2F3" }, grid: { display: false } }
      }
    })
  });

  const logistics = analytics.logistics_bottlenecks || { labels: [], values: [] };
  createChart("chart-logistics", {
    type: "bar",
    data: {
      labels: logistics.labels.map((label) => t(label)),
      datasets: [{
        label: t("logisticsBottlenecks"),
        data: logistics.values,
        backgroundColor: "rgba(255, 184, 108, .7)",
        borderColor: "#FFB86C",
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: chartOptions({ scales: AXIS_SCALES })
  });

  const refunds = analytics.refunds_returns || { labels: [], refunds: [], returns: [] };
  createChart("chart-refunds", {
    type: "line",
    data: {
      labels: translatePeriodLabels(refunds.labels),
      datasets: [{
        label: t("refunds"),
        data: refunds.refunds,
        borderColor: "#00D2FF",
        backgroundColor: "rgba(0, 210, 255, .12)",
        fill: true,
        tension: 0.34,
        pointRadius: 3
      }, {
        label: t("returns"),
        data: refunds.returns,
        borderColor: "#64FFDA",
        backgroundColor: "rgba(100, 255, 218, .1)",
        fill: true,
        tension: 0.34,
        pointRadius: 3
      }]
    },
    options: chartOptions({ scales: AXIS_SCALES })
  });

  const problems = analytics.weekly_problems || { labels: [], values: [] };
  createChart("chart-technical-errors", {
    type: "bar",
    data: {
      labels: problems.labels.map((label) => t(label)),
      datasets: [{
        label: t("topProblems"),
        data: problems.values,
        backgroundColor: ["rgba(255, 83, 112, .8)", "rgba(255, 184, 108, .8)", "rgba(0, 210, 255, .75)", "rgba(136, 146, 176, .55)"],
        borderColor: ["#FF5370", "#FFB86C", "#00D2FF", "#8892B0"],
        borderWidth: 1,
        borderRadius: 6
      }]
    },
    options: chartOptions({
      scales: {
        x: { ticks: { color: "#D8E2F3" }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: "#8892B0" }, grid: { color: "rgba(136,146,176,.1)" } }
      }
    })
  });
}

// Actualiza los datos en sitio para que la fluctuación en vivo se anime suavemente.
function createChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const existing = charts.get(canvasId);
  if (existing && existing.config.type === config.type) {
    existing.data.labels = config.data.labels;
    config.data.datasets.forEach((dataset, index) => {
      if (existing.data.datasets[index]) Object.assign(existing.data.datasets[index], dataset);
      else existing.data.datasets.push(dataset);
    });
    existing.data.datasets.length = config.data.datasets.length;
    if (config.options) existing.options = config.options;
    existing.update();
    return;
  }
  if (existing) existing.destroy();
  charts.set(canvasId, new Chart(canvas, config));
}

function chartOptions(extraOptions = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 550 },
    plugins: {
      legend: { labels: { color: "#D8E2F3", usePointStyle: true, boxWidth: 8 } },
      tooltip: {
        backgroundColor: "#061121",
        titleColor: "#FFFFFF",
        bodyColor: "#D8E2F3",
        borderColor: "rgba(0,210,255,.35)",
        borderWidth: 1,
        padding: 12
      }
    },
    ...extraOptions
  };
}
