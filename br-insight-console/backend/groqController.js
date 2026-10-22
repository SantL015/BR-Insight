"use strict";

const Groq = require("groq-sdk");

const PRIMARY_MODEL = (process.env.GROQ_MODEL || "llama-3.1-70b-versatile").trim();
const FALLBACK_MODEL = "openai/gpt-oss-20b";
const REQUEST_TIMEOUT_MS = 12000;

const LANGUAGE_NAMES = {
  es: "español",
  en: "English",
  fr: "français",
  pt: "português",
  zh: "简体中文",
  de: "Deutsch",
  it: "italiano",
  nl: "Nederlands",
  sv: "svenska"
};

// Títulos de sección obligatorios en cada idioma. El frontend los usa como encabezados.
const SECTIONS = {
  es: { summary: "Resumen ejecutivo", action: "Acción operativa", risk: "Riesgo / oportunidad estratégica" },
  en: { summary: "Executive summary", action: "Operational action", risk: "Strategic risk / opportunity" },
  fr: { summary: "Résumé exécutif", action: "Action opérationnelle", risk: "Risque / opportunité stratégique" },
  pt: { summary: "Resumo executivo", action: "Ação operacional", risk: "Risco / oportunidade estratégica" },
  zh: { summary: "执行摘要", action: "运营行动", risk: "战略风险 / 机会" },
  de: { summary: "Zusammenfassung", action: "Operative Maßnahme", risk: "Strategisches Risiko / Chance" },
  it: { summary: "Sintesi esecutiva", action: "Azione operativa", risk: "Rischio / opportunità strategica" },
  nl: { summary: "Samenvatting", action: "Operationele actie", risk: "Strategisch risico / kans" },
  sv: { summary: "Sammanfattning", action: "Operativ åtgärd", risk: "Strategisk risk / möjlighet" }
};

const FALLBACK_COPY = {
  es: { context: "BR (Building Reliability) · cuenta H&M", kpis: "Indicadores", priority: "Prioridad", action: "Acción BR", signal: "Señal H&M", returns: "devoluciones", noTicket: "Sin tickets prioritarios activos", tech: "Aplicar SOP-TS-002: validar el token de fidelidad y confirmar el checkout antes de cerrar.", logistics: "Aplicar SOP-LOG-001: revisar OMS/SAP y escalar pedidos detenidos que superen 48 h.", payment: "Validar la autorización con la pasarela antes de tramitar una devolución.", generic: "Seguir el SOP correspondiente y confirmar la recuperación con el equipo H&M." },
  en: { context: "BR (Building Reliability) · H&M account", kpis: "Metrics", priority: "Priority", action: "BR action", signal: "H&M signal", returns: "returns", noTicket: "No active priority tickets", tech: "Use SOP-TS-002: validate the loyalty token and confirm checkout before closing.", logistics: "Use SOP-LOG-001: check OMS/SAP and escalate orders stalled over 48 hours.", payment: "Verify the payment authorization with the processor before issuing a refund.", generic: "Follow the relevant SOP and confirm recovery with the H&M team." },
  fr: { context: "BR (Building Reliability) · compte H&M", kpis: "Indicateurs", priority: "Priorité", action: "Action BR", signal: "Signal H&M", returns: "retours", noTicket: "Aucun ticket prioritaire actif", tech: "Appliquer SOP-TS-002 : valider le jeton fidélité et confirmer le paiement avant clôture.", logistics: "Appliquer SOP-LOG-001 : vérifier OMS/SAP et escalader les commandes bloquées depuis plus de 48 h.", payment: "Vérifier l’autorisation auprès du prestataire avant tout remboursement.", generic: "Suivre le SOP applicable et confirmer le rétablissement avec l’équipe H&M." },
  pt: { context: "BR (Building Reliability) · conta H&M", kpis: "Indicadores", priority: "Prioridade", action: "Ação BR", signal: "Sinal H&M", returns: "devoluções", noTicket: "Sem chamados prioritários ativos", tech: "Aplicar SOP-TS-002: validar o token de fidelidade e confirmar o checkout antes de encerrar.", logistics: "Aplicar SOP-LOG-001: consultar OMS/SAP e escalar pedidos parados há mais de 48 h.", payment: "Validar a autorização com a operadora antes de iniciar um reembolso.", generic: "Seguir o SOP correspondente e confirmar a recuperação com a equipe H&M." },
  zh: { context: "BR（Building Reliability）· H&M 业务", kpis: "指标", priority: "优先事项", action: "BR 行动", signal: "H&M 信号", returns: "退货", noTicket: "没有待处理的优先工单", tech: "执行 SOP-TS-002：验证会员令牌并确认结账流程后再关闭工单。", logistics: "执行 SOP-LOG-001：检查 OMS/SAP，并升级滞留超过 48 小时的订单。", payment: "退款前先与支付服务商核实授权状态。", generic: "遵循相应 SOP，并与 H&M 团队确认恢复情况。" },
  de: { context: "BR (Building Reliability) · H&M-Konto", kpis: "Kennzahlen", priority: "Priorität", action: "BR-Maßnahme", signal: "H&M-Signal", returns: "Rückgaben", noTicket: "Keine aktiven priorisierten Tickets", tech: "SOP-TS-002 anwenden: Loyalty-Token prüfen und Checkout vor dem Schließen bestätigen.", logistics: "SOP-LOG-001 anwenden: OMS/SAP prüfen und seit über 48 Stunden blockierte Bestellungen eskalieren.", payment: "Zahlungsautorisierung vor einer Erstattung beim Zahlungsanbieter prüfen.", generic: "Das passende SOP befolgen und die Wiederherstellung mit dem H&M-Team bestätigen." },
  it: { context: "BR (Building Reliability) · account H&M", kpis: "Indicatori", priority: "Priorità", action: "Azione BR", signal: "Segnale H&M", returns: "resi", noTicket: "Nessun ticket prioritario attivo", tech: "Applicare SOP-TS-002: verificare il token fedeltà e confermare il checkout prima della chiusura.", logistics: "Applicare SOP-LOG-001: controllare OMS/SAP ed escalare gli ordini fermi da oltre 48 ore.", payment: "Verificare l’autorizzazione con il gestore dei pagamenti prima del rimborso.", generic: "Seguire la SOP pertinente e confermare il ripristino con il team H&M." },
  nl: { context: "BR (Building Reliability) · H&M-account", kpis: "KPI's", priority: "Prioriteit", action: "BR-actie", signal: "H&M-signaal", returns: "retouren", noTicket: "Geen actieve prioriteitstickets", tech: "Volg SOP-TS-002: controleer de loyaliteitstoken en bevestig de checkout vóór sluiting.", logistics: "Volg SOP-LOG-001: controleer OMS/SAP en escaleer orders die langer dan 48 uur vaststaan.", payment: "Controleer de betalingsautorisatie bij de verwerker vóór terugbetaling.", generic: "Volg de relevante SOP en bevestig herstel met het H&M-team." },
  sv: { context: "BR (Building Reliability) · H&M-konto", kpis: "Nyckeltal", priority: "Prioritet", action: "BR-åtgärd", signal: "H&M-signal", returns: "returer", noTicket: "Inga aktiva prioriterade ärenden", tech: "Följ SOP-TS-002: kontrollera lojalitetstoken och bekräfta kassan före stängning.", logistics: "Följ SOP-LOG-001: kontrollera OMS/SAP och eskalera order som stått stilla i över 48 timmar.", payment: "Verifiera betalningsauktoriseringen hos betalningsleverantören före återbetalning.", generic: "Följ relevant SOP och bekräfta återställning med H&M-teamet." }
};

const FALLBACK_LABELS = {
  es: { daily: "interacciones hoy", active: "tickets activos", error: "Problemas frecuentes", target: "meta", latest: "último periodo", followup: "Confirmar la recuperación con H&M y registrar la evidencia antes de cerrar el caso.", outlook: "La oportunidad está en contener el incidente y convertir el aprendizaje en prevención para el próximo pico de volumen.", topics: ["token de fidelidad / checkout", "pedido demorado", "autorización de pago"] },
  en: { daily: "interactions today", active: "active tickets", error: "Frequent problems", target: "target", latest: "latest period", followup: "Confirm recovery with H&M and log the evidence before closing the case.", outlook: "The opportunity is to contain the incident and turn the learning into prevention for the next volume peak.", topics: ["loyalty token / checkout", "delayed order", "payment authorization"] },
  fr: { daily: "interactions aujourd’hui", active: "tickets actifs", error: "Problèmes fréquents", target: "cible", latest: "dernière période", followup: "Confirmer le rétablissement avec H&M et consigner les preuves avant clôture.", outlook: "L’opportunité consiste à contenir l’incident et à transformer le retour d’expérience en prévention pour le prochain pic.", topics: ["jeton fidélité / paiement", "commande retardée", "autorisation de paiement"] },
  pt: { daily: "interações hoje", active: "chamados ativos", error: "Problemas frequentes", target: "meta", latest: "período mais recente", followup: "Confirmar a recuperação com a H&M e registrar a evidência antes de encerrar o caso.", outlook: "A oportunidade é conter o incidente e transformar o aprendizado em prevenção para o próximo pico de volume.", topics: ["token de fidelidade / checkout", "pedido atrasado", "autorização de pagamento"] },
  zh: { daily: "今日交互量", active: "个活动工单", error: "高频问题", target: "目标", latest: "最近一期", followup: "与 H&M 确认恢复情况，并在关闭工单前记录证据。", outlook: "机会在于控制事件，并将经验转化为下一个高峰期的预防措施。", topics: ["会员令牌 / 结账", "订单延迟", "支付授权"] },
  de: { daily: "Interaktionen heute", active: "aktive Tickets", error: "Häufige Probleme", target: "Ziel", latest: "letzter Zeitraum", followup: "Wiederherstellung mit H&M bestätigen und Nachweise vor dem Schließen dokumentieren.", outlook: "Die Chance liegt darin, den Vorfall einzudämmen und die Erkenntnisse für die nächste Lastspitze in Prävention zu überführen.", topics: ["Loyalty-Token / Checkout", "verspätete Bestellung", "Zahlungsautorisierung"] },
  it: { daily: "interazioni oggi", active: "ticket attivi", error: "Problemi frequenti", target: "obiettivo", latest: "ultimo periodo", followup: "Confermare il ripristino con H&M e registrare le prove prima della chiusura.", outlook: "L’opportunità è contenere l’incidente e trasformare l’apprendimento in prevenzione per il prossimo picco.", topics: ["token fedeltà / checkout", "ordine in ritardo", "autorizzazione di pagamento"] },
  nl: { daily: "interacties vandaag", active: "actieve tickets", error: "Veelvoorkomende problemen", target: "doel", latest: "laatste periode", followup: "Bevestig herstel met H&M en leg bewijs vast vóór het sluiten.", outlook: "De kans is het incident beheersen en de lessen omzetten in preventie voor de volgende piek.", topics: ["loyaliteitstoken / checkout", "vertraagde bestelling", "betalingsautorisatie"] },
  sv: { daily: "interaktioner i dag", active: "aktiva ärenden", error: "Vanliga problem", target: "mål", latest: "senaste perioden", followup: "Bekräfta återställning med H&M och logga bevis före stängning.", outlook: "Möjligheten är att begränsa incidenten och omvandla lärdomen till förebyggande arbete inför nästa volymtopp.", topics: ["lojalitetstoken / kassa", "försenad beställning", "betalningsauktorisering"] }
};

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// Conocimiento institucional de la alianza BR · H&M. Se envía a la IA como
// contexto fijo para que responda con la operación real de la cuenta
// (perfil corporativo, equipo, metas, casos críticos, SOPs y reglas), no solo
// con el snapshot del día.
const BR_KNOWLEDGE = {
  role: "Analista de Operaciones e Inteligencia de Negocio de la firma BPO 'BR', asignado en exclusiva a la cuenta corporativa del cliente ancla H&M (HyM). Brinda diagnósticos ejecutivos, soporte técnico L1/L2, recomendaciones operativas y análisis en tiempo real para supervisores, líderes de equipo y la alta dirección (CEO / Director de Operaciones).",
  bpo_partner: "BR (Building Reliability): centro de operaciones multilingüe nearshore, especializado en soporte técnico, atención al cliente y gestión omnicanal.",
  anchor_client: "H&M (HyM): gigante global de fast fashion y e-commerce con presencia en más de 70 mercados.",
  operations_hub: "Colombia (hub multilingüe nearshore).",
  console_purpose: "BR Insight Console es la consola de inteligencia operativa y visibilidad ejecutiva para decisiones gerenciales, optimización de cargas de trabajo y supervisión de la experiencia del cliente.",
  org_chart: [
    "Santiago Alemán · CEO & Director de Calidad (QA Director): revisa el cumplimiento global de KPIs, auditorías de calidad y decisiones estratégicas.",
    "Camilo Castrillo · Director de Operaciones (Ops Director): supervisa la eficiencia operativa, el dimensionamiento de personal y el cumplimiento de SLAs.",
    "Juan Salinas · Supervisor de Operaciones: monitoreo en piso, colas de atención en vivo y tráfico de llamadas/chats.",
    "Gabriel Silva · Líder de Equipo (Team Leader): coaching, métricas individuales de agentes y seguimiento de CSAT.",
    "Cristian Anillo · Soporte Técnico Nivel 2 (Tech Support L2): monitoreo de errores de sistema, análisis de logs y reporte de datos en tiempo real."
  ],
  kpi_targets: [
    "FCR (Resolución al Primer Contacto): meta ≥ 80% · estado objetivo 82.5% (saludable).",
    "ASA (Tiempo Medio de Respuesta): meta < 30 s · estado objetivo 24 s (saludable).",
    "CSAT (Satisfacción del Cliente): meta ≥ 4.8 / 5.0 · estado objetivo 4.8 / 5.0.",
    "QA Compliance (Cumplimiento de Auditoría de Calidad): meta ≥ 95% · estado objetivo 96.2%.",
    "Volumen diario promedio: ≈ 1,450 interacciones omnicanal (chat web, app móvil, voz y correo).",
    "Backlog de tickets activos: ≈ 124 casos acumulados en colas de trabajo."
  ],
  critical_incidents: [
    "TECH-403 · Error de sesión y token de fidelidad en H&M Mobile. Síntoma: el usuario no puede aplicar descuentos de membresía ni finalizar la compra; la API devuelve 403 Forbidden por desincronización de tokens. SOP-TS-002: (1) L1 verifica la versión de la App y el correo de la cuenta Club H&M; (2) si persiste, escala a L2 (Cristian Anillo) para forzar el reseteo del token en la consola API; (3) reasigna temporalmente agentes de L1 a la cola de chat para absorber picos; (4) comunica al cliente: 'Hemos refrescado tu credencial digital. Por favor cierra sesión, espera 2 minutos y vuelve a ingresar'.",
    "LOG-001 · Retraso en el despacho logístico OMS/SAP. Síntoma: pedido retenido más de 48 h en estado 'Preparing' en el centro de distribución, afectando prendas de alta demanda (p. ej. Oversized Hoodies). SOP-LOG-001: (1) el agente consulta el número de orden en OMS/SAP; (2) si está en 'Hold', envía el comando de liberación al centro de distribución regional; (3) envía correo de actualización automática al cliente con código de rastreo prioritario; (4) si excede 5 días, emite un cupón de compensación del 15% para la próxima compra.",
    "BILL-209 · Doble retención de autorización bancaria. Síntoma: el cliente ve dos cobros por la misma orden durante picos de venta. SOP-FIN-003: (1) explicar que el primer monto es una 'retención temporal de autorización' y no un cobro duplicado efectivo; (2) verificar el estado de la transacción en la pasarela de pagos; (3) si la pasarela confirma fallo en el primer intento, enviar la carta de liberación bancaria estándar (procesamiento bancario: 3 a 5 días hábiles)."
  ],
  strategic_landscape: {
    strengths: [
      "Presencia omnicanal global en más de 70 mercados.",
      "Logística ágil de fast-fashion con rotación continua de inventario.",
      "Ecosistema de fidelización digital masivo (H&M Club)."
    ],
    weaknesses: [
      "Congestión en horas pico posventa durante lanzamientos de temporada.",
      "Fricción en la app móvil por errores de sesión.",
      "Carga financiera y operativa fija si el soporte se gestiona internamente."
    ],
    opportunities: [
      "Al delegar el soporte al BPO BR, los directivos de H&M aligeran la carga operativa para concentrarse en decisiones estratégicas y nuevas colecciones.",
      "Escalamiento e-commerce multilingüe desde un único hub nearshore (Colombia).",
      "Optimización de costos operativos manteniendo estándares altos de CSAT y QA."
    ],
    threats: [
      "Presión competitiva del mercado de ultra-fast fashion.",
      "Riesgo de fuga de clientes (brand churn) por mala experiencia posventa o demoras en la atención.",
      "Fluctuaciones macroeconómicas en el consumo minorista."
    ]
  },
  languages: "La consola y el soporte operan en español, inglés, francés, portugués, chino y alemán.",
  escalation: "Las escalaciones se dirigen a los superiores (Ops Director y QA Director) por email desde el propio centro de comunicaciones de la consola.",
  response_rules: [
    "Ser siempre profesional, conciso, humano y estructurado, con viñetas claras (Resumen ejecutivo, Acción operativa, Riesgo / oportunidad estratégica).",
    "Nunca generar párrafos largos ni saturados.",
    "Si los datos muestran FCR < 80% o picos de problemas frecuentes, generar alertas rojas y recomendar ejecutar el parche SOP-TS-002 de inmediato.",
    "La meta principal del BPO es liberar a los directivos de H&M de los problemas operativos diarios para que se concentren en la estrategia comercial y el diseño de ropa."
  ]
};

function languageKey(language) {
  return SECTIONS[language] ? language : "es";
}

function isPlaceholderKey(apiKey) {
  return !apiKey || /^(tu_|your_|placeholder|replace[-_ ]?me)/i.test(apiKey);
}

function pickPriorityCase(metricsData) {
  return (metricsData?.active_critical_tickets || [])
    .filter((ticket) => !/resolved|closed/i.test(String(ticket.status_key || ticket.status || "")))
    .sort((left, right) => (SEVERITY_ORDER[left.severity] ?? 4) - (SEVERITY_ORDER[right.severity] ?? 4))[0] || null;
}

function inferCaseType(ticket) {
  if (!ticket) return "generic";
  if (ticket.type) return ticket.type;
  const haystack = `${ticket.id} ${ticket.issue}`.toLowerCase();
  if (/403|token|loyalty/.test(haystack)) return "technical_error_403";
  if (/shipment|delayed|logistic|preparing|oms/.test(haystack)) return "logistics_delay";
  if (/auth hold|payment|duplicate|double/.test(haystack)) return "payment_double_hold";
  if (/refund|return/.test(haystack)) return "refund_pending";
  if (/crash|app/.test(haystack)) return "app_crash";
  return "generic";
}

function fallbackActionFor(ticket, words) {
  if (ticket?.type === "technical_error_403" || ticket?.id === "TECH-403") return words.tech;
  if (ticket?.type === "logistics_delay" || ticket?.id === "HM-55420") return words.logistics;
  if (ticket?.type === "payment_double_hold" || ticket?.id === "BILL-209") return words.payment;
  return words.generic;
}

function getIntelligentFallback(metricsData, language = "es") {
  const lang = languageKey(language);
  const words = FALLBACK_COPY[lang] || FALLBACK_COPY.en;
  const labels = FALLBACK_LABELS[lang] || FALLBACK_LABELS.en;
  const sections = SECTIONS[lang];
  const kpis = metricsData.kpis || {};
  const ticket = pickPriorityCase(metricsData);
  const action = fallbackActionFor(ticket, words);
  const latestProblems = metricsData.interaction_volume?.top_problems?.slice(-1)[0] ?? "—";
  const qa = metricsData.qa_compliance_trend?.values?.slice(-1)[0] ?? "—";
  const product = (metricsData.top_complaint_products || [])
    .slice()
    .sort((left, right) => right.returns - left.returns)[0];
  const ticketTopics = {
    "TECH-403": labels.topics[0],
    "HM-55420": labels.topics[1],
    "BILL-209": labels.topics[2]
  };
  const priority = ticket
    ? `${ticket.id} · ${ticket.severity} · ${ticketTopics[ticket.id] || ticket.issue}`
    : words.noTicket;
  const insight = [
    `### ${sections.summary}`,
    `- ${words.context} · ${kpis.daily_volume ?? "—"} ${labels.daily} · ${kpis.active_tickets ?? "—"} ${labels.active}.`,
    `- ${words.kpis}: FCR ${kpis.fcr ?? "—"}% (${labels.target} 80%) · ASA ${kpis.asa_seconds ?? "—"} s (${labels.target} 30 s) · CSAT ${kpis.csat ?? "—"}/5 · QA ${qa}% (${labels.target} 95%).`,
    `### ${sections.action}`,
    `- ${words.priority}: ${priority}.`,
    `- ${words.action}: ${action}`,
    `- ${labels.followup}`,
    `### ${sections.risk}`,
    product ? `- ${words.signal}: ${product.product} · ${product.issue} · ${product.returns} ${words.returns}.` : `- ${labels.error}: ${latestProblems} (${labels.latest}).`,
    `- ${labels.outlook}`
  ].join("\n");
  return {
    insight,
    source: "intelligent-fallback",
    generated_at: new Date().toISOString(),
    case_id: ticket?.id || null
  };
}

function buildOperationalContext(metricsData) {
  const kpis = metricsData.kpis || {};
  const tickets = metricsData.active_critical_tickets || [];
  const agents = metricsData.agent_performance || [];
  const products = metricsData.top_complaint_products || [];
  const complaints = metricsData.frequent_complaints || [];
  const sops = metricsData.sops || [];
  const analytics = metricsData.analytics || {};

  return {
    account: `${metricsData.client || "H&M"} customer operations`,
    BPO_partner: metricsData.bpo_partner || "BR (Building Reliability)",
    service_scope: "BR support for H&M digital commerce, loyalty, orders, payments, returns, and technical incidents.",
    account_knowledge: BR_KNOWLEDGE,
    kpis: {
      fcr_pct: kpis.fcr,
      fcr_target_pct: 80,
      asa_seconds: kpis.asa_seconds,
      asa_target_seconds: 30,
      csat_out_of_5: kpis.csat,
      daily_interactions: kpis.daily_volume,
      active_tickets_total: kpis.active_tickets,
      qa_compliance_pct: metricsData.qa_compliance_trend?.values?.slice(-1)[0],
      qa_target_pct: metricsData.qa_compliance_trend?.target
    },
    kpi_health: [
      `FCR ${kpis.fcr}% vs meta 80%`,
      `ASA ${kpis.asa_seconds}s vs meta < 30s`,
      `CSAT ${kpis.csat}/5 vs meta 4.8`
    ],
    seven_day_trends: {
      interaction_volume: metricsData.interaction_volume?.values,
      top_problems: metricsData.interaction_volume?.top_problems,
      qa_compliance: metricsData.qa_compliance_trend?.values
    },
    operational_analytics: {
      main_product_complaints: analytics.complaints_by_type,
      customer_inquiries: analytics.inquiries_by_category,
      logistics_bottlenecks: analytics.logistics_bottlenecks,
      refunds_and_returns: analytics.refunds_returns,
      weekly_frequent_problems: analytics.weekly_problems
    },
    priority_tickets: tickets.slice(0, 5).map(({ id, type, issue, issue_key, channel, severity, status, status_key, time_open }) => ({
      id, type: type || issue_key, issue, channel, severity, status: status_key || status, age: time_open
    })),
    team_performance: agents.slice(0, 5).map(({ name, role, aht_min, csat, status }) => ({
      name, role, average_handle_time_minutes: aht_min, csat, status
    })),
    org_chart: (metricsData.team_directory || []).map(({ name, role, email }) => ({ name, role, email })),
    top_h_and_m_product_issues: products.slice(0, 5).map(({ product, category, issue, returns }) => ({
      product, category, issue, returns
    })),
    frequent_contact_reasons: complaints.slice(0, 5),
    knowledge_base: (metricsData.ticket_knowledge || []).map(({ id, severity, title, desc, tip }) => ({
      id, severity, title, description: desc, agent_tip: tip
    })),
    customer_faq_reference: (metricsData.customer_faq || []).map(({ id, question, answer }) => ({
      id, question, answer
    })),
    relevant_br_procedures: sops.map(({ code, title, category, steps }) => ({ code, title, category, steps })),
    recent_team_messages: (metricsData.team_messages || []).slice(0, 4).map(({ sender, time, message }) => ({
      sender, time, message
    })),
    escalation_contact: metricsData.escalation_email || "Ops Director / QA Director",
    latest_technical_events: (metricsData.technical_logs || []).slice(-4).map(({ time, level, message }) => ({
      time, level, message
    }))
  };
}

function isModelUnavailable(error) {
  const status = error?.status || error?.response?.status;
  return status === 404 || status === 400 && /model/i.test(error?.message || "")
    || /model|decommission|not found|does not exist/i.test(error?.message || "");
}

async function createChatCompletion(messages, { temperature = 0.25, maxTokens = 320 } = {}) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (isPlaceholderKey(apiKey)) {
    const error = new Error("GROQ_API_KEY no está configurada.");
    error.code = "GROQ_API_KEY_MISSING";
    throw error;
  }

  const groq = new Groq({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });
  const models = PRIMARY_MODEL === FALLBACK_MODEL ? [PRIMARY_MODEL] : [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError = null;

  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        messages, model, temperature, max_tokens: maxTokens
      });
      const content = completion.choices?.[0]?.message?.content?.trim();
      if (content) return content;
      lastError = new Error(`El modelo ${model} devolvió una respuesta vacía.`);
    } catch (error) {
      lastError = error;
      if (error.code === "GROQ_API_KEY_MISSING") throw error;
      if (!isModelUnavailable(error)) break;
      console.warn(`Modelo ${model} no disponible; se intenta el siguiente.`);
    }
  }

  throw lastError || new Error("No fue posible obtener respuesta del proveedor de IA.");
}

function diagnosticPrompt(language, sections) {
  return [
    "Eres el Analista de Operaciones e Inteligencia de Negocio de BR (Building Reliability), socio BPO del cliente ancla H&M (HyM), y operas la BR Insight Console.",
    `Escribe en ${LANGUAGE_NAMES[language] || LANGUAGE_NAMES.es}.`,
    "Conoces la cuenta: el perfil corporativo, el organigrama BR (Santiago Alemán CEO & QA Director, Camilo Castrillo Ops Director, Juan Salinas Supervisor, Gabriel Silva Team Leader, Cristian Anillo Soporte Técnico L2), las metas (FCR ≥ 80%, ASA < 30 s, CSAT ≥ 4.8/5, QA ≥ 95%), los casos críticos (TECH-403, LOG-001, BILL-209) con sus SOPs y el panorama estratégico de la cuenta.",
    "Tono humano, profesional y directo. Nunca escribas párrafos densos ni bloques de texto saturados.",
    "Formato obligatorio: exactamente tres secciones, cada una iniciada con '### ' y su título, seguidas de viñetas que empiecen con '- '.",
    `1) '### ${sections.summary}': 2 o 3 viñetas cortas (máximo 20 palabras cada una) con los hechos y el KPI más relevante.`,
    `2) '### ${sections.action}': 2 o 3 viñetas accionables con responsable del equipo BR, procedimiento (SOP) y siguiente paso concreto.`,
    `3) '### ${sections.risk}': 2 viñetas, una de riesgo si no se actúa y otra de oportunidad o impacto medible esperado.`,
    "Si el FCR cae por debajo del 80% o hay picos de problemas frecuentes, abre con una alerta roja y recomienda ejecutar el parche SOP-TS-002 de inmediato.",
    "Máximo 120 palabras en total. Usa el contexto entregado (account_knowledge, priority_tickets, relevant_br_procedures, knowledge_base) como única fuente: no inventes SLA, causas, importes ni resultados. Separa hechos de recomendaciones."
  ].join(" ");
}

function chatPrompt(language, sections) {
  return [
    "Eres el Analista de Operaciones e Inteligencia de Negocio de BR (Building Reliability), socio BPO del cliente ancla H&M (HyM), y operas la BR Insight Console.",
    `Responde en ${LANGUAGE_NAMES[language] || LANGUAGE_NAMES.es}.`,
    "Tienes conocimiento institucional completo de la cuenta: perfil corporativo, organigrama BR y sus roles, metas de KPI, casos críticos (TECH-403, LOG-001, BILL-209) con sus SOPs y el panorama estratégico (fortalezas, debilidades, oportunidades y amenazas).",
    "Habla como un supervisor humano, cercano y profesional; evita párrafos saturados y jerga innecesaria.",
    "Formato obligatorio: tres secciones con '### ' y viñetas con '- '.",
    `1) '### ${sections.summary}': 1 o 2 viñetas que respondan directamente la pregunta.`,
    `2) '### ${sections.action}': 1 a 3 viñetas accionables con ticket, responsable del equipo BR o SOP cuando aplique.`,
    `3) '### ${sections.risk}': 1 o 2 viñetas de riesgo y oportunidad, o el dato que falta para decidir.`,
    "Si los datos muestran FCR < 80% o picos de problemas frecuentes, indica una alerta roja y recomienda el parche SOP-TS-002.",
    "Máximo 140 palabras. Usa el contexto entregado (account_knowledge, kpi_health, priority_tickets, knowledge_base, relevant_br_procedures) como única fuente, distingue hechos de recomendaciones y no inventes SLA ni resultados. Si la pregunta es sobre personas, usa solo el organigrama y los roles; no solicites ni incluyas datos personales de clientes."
  ].join(" ");
}

async function generateDiagnostic(metricsData, language = "es") {
  const lang = languageKey(language);
  const priorityCase = pickPriorityCase(metricsData);
  const fallbackCaseId = priorityCase?.id || null;

  if (isPlaceholderKey(process.env.GROQ_API_KEY?.trim())) {
    console.warn("GROQ_API_KEY no está configurada; se utilizará el diagnóstico local.");
    return getIntelligentFallback(metricsData, lang);
  }

  try {
    const insight = await createChatCompletion([
      { role: "system", content: diagnosticPrompt(lang, SECTIONS[lang]) },
      {
        role: "user",
        content: `Analiza este resumen operativo BR–H&M y recomienda la acción de mayor impacto inmediato:\n${JSON.stringify(buildOperationalContext(metricsData))}`
      }
    ], { temperature: 0.25, maxTokens: 520 });

    return {
      insight,
      source: "groq",
      model: PRIMARY_MODEL,
      generated_at: new Date().toISOString(),
      case_id: fallbackCaseId
    };
  } catch (error) {
    console.error(`No fue posible completar el diagnóstico de Groq: ${error.message}`);
    return getIntelligentFallback(metricsData, lang);
  }
}

function getChatFallback(message, metricsData, language = "es") {
  const lang = languageKey(language);
  const sections = SECTIONS[lang];
  const words = FALLBACK_COPY[lang] || FALLBACK_COPY.en;
  const labels = FALLBACK_LABELS[lang] || FALLBACK_LABELS.en;
  const kpis = metricsData.kpis || {};
  const mentioned = String(message || "").match(/\b(?:[A-Z]{2,5})-\d{2,6}\b/);
  const ticket = (metricsData.active_critical_tickets || []).find((item) => item.id === mentioned?.[0]) || pickPriorityCase(metricsData);
  const action = fallbackActionFor(ticket, words);
  const product = (metricsData.top_complaint_products || [])
    .slice()
    .sort((left, right) => right.returns - left.returns)[0];

  return {
    response: [
      `### ${sections.summary}`,
      `- ${words.context} · ${kpis.daily_volume ?? "—"} ${labels.daily} · ${kpis.active_tickets ?? "—"} ${labels.active}.`,
      ticket
        ? `- ${words.priority}: ${ticket.id} · ${ticket.severity} · ${ticket.issue || ticket.issue_key || ""}`.trim()
        : `- ${words.noTicket}.`,
      `### ${sections.action}`,
      `- ${words.action}: ${action}`,
      `- ${labels.followup}`,
      `### ${sections.risk}`,
      product
        ? `- ${words.signal}: ${product.product} · ${product.issue} · ${product.returns} ${words.returns}.`
        : `- ${labels.error}: ${metricsData.interaction_volume?.top_problems?.slice(-1)[0] ?? "—"} (${labels.latest}).`,
      `- ${labels.outlook}`
    ].join("\n"),
    case_id: ticket?.id || null,
    source: "intelligent-fallback",
    generated_at: new Date().toISOString()
  };
}

async function generateChatResponse(message, metricsData, language = "es") {
  const lang = languageKey(language);

  if (isPlaceholderKey(process.env.GROQ_API_KEY?.trim())) {
    console.warn("GROQ_API_KEY no está configurada; se utilizará la respuesta local del asistente.");
    return getChatFallback(message, metricsData, lang);
  }

  const sections = SECTIONS[lang];
  try {
    const response = await createChatCompletion([
      { role: "system", content: chatPrompt(lang, sections) },
      {
        role: "user",
        content: `Resumen operativo BR–H&M:\n${JSON.stringify(buildOperationalContext(metricsData))}\n\nPregunta del supervisor: ${message}`
      }
    ], { temperature: 0.25, maxTokens: 600 });

    const mentioned = String(response).match(/\b(?:[A-Z]{2,5})-\d{2,6}\b/);
    const knownTicket = (metricsData.active_critical_tickets || []).find((ticket) => ticket.id === mentioned?.[0]);
    const caseId = knownTicket?.id || pickPriorityCase(metricsData)?.id || null;

    return { response, case_id: caseId };
  } catch (error) {
    if (error.code === "GROQ_API_KEY_MISSING") throw error;
    console.error(`No fue posible completar la respuesta del chat de Groq: ${error.message}`);
    return getChatFallback(message, metricsData, lang);
  }
}

function hashString(value) {
  let hash = 0;
  for (const character of String(value)) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) || 1;
}

function seededRandom(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const CASE_PROFILES = {
  technical_error_403: {
    owner_key: "owner_tech_l2",
    sop_code: "SOP-TS-002",
    sla_minutes: 30,
    telemetry: (random) => [
      { key: "telemetry_error_rate", value: Number((6 + random() * 9).toFixed(1)), unit: "%", trend: "up" },
      { key: "telemetry_affected_sessions", value: Math.round(180 + random() * 320), unit: "", trend: "up" },
      { key: "telemetry_login_failures", value: Math.round(40 + random() * 90), unit: "", trend: "up" },
      { key: "telemetry_avg_latency", value: Math.round(820 + random() * 700), unit: "ms", trend: "flat" }
    ]
  },
  logistics_delay: {
    owner_key: "owner_logistics",
    sop_code: "SOP-LOG-001",
    sla_minutes: 120,
    telemetry: (random) => [
      { key: "telemetry_orders_stalled", value: Math.round(12 + random() * 38), unit: "", trend: "up" },
      { key: "telemetry_avg_delay_hours", value: Number((28 + random() * 40).toFixed(1)), unit: "h", trend: "up" },
      { key: "telemetry_carrier_sync", value: Number((82 + random() * 12).toFixed(1)), unit: "%", trend: "down" },
      { key: "telemetry_repeat_contacts", value: Math.round(9 + random() * 22), unit: "", trend: "up" }
    ]
  },
  payment_double_hold: {
    owner_key: "owner_payments",
    sop_code: "SOP-PAY-003",
    sla_minutes: 45,
    telemetry: (random) => [
      { key: "telemetry_hold_amount", value: Number((38 + random() * 260).toFixed(2)), unit: "EUR", trend: "flat" },
      { key: "telemetry_duplicate_auth", value: Math.round(3 + random() * 14), unit: "", trend: "up" },
      { key: "telemetry_gateway_latency", value: Math.round(400 + random() * 1200), unit: "ms", trend: "flat" },
      { key: "telemetry_financial_risk", value: Number((2 + random() * 9).toFixed(1)), unit: "k EUR", trend: "up" }
    ]
  },
  refund_pending: {
    owner_key: "owner_returns",
    sop_code: "SOP-RET-004",
    sla_minutes: 90,
    telemetry: (random) => [
      { key: "telemetry_open_refunds", value: Math.round(18 + random() * 44), unit: "", trend: "up" },
      { key: "telemetry_refund_cycle_time", value: Number((3 + random() * 5).toFixed(1)), unit: "días", trend: "up" },
      { key: "telemetry_return_rate", value: Number((8 + random() * 7).toFixed(1)), unit: "%", trend: "up" },
      { key: "telemetry_refund_value", value: Number((1200 + random() * 4200).toFixed(0)), unit: "EUR", trend: "up" }
    ]
  },
  product_inquiry: {
    owner_key: "owner_product",
    sop_code: "SOP-PRD-005",
    sla_minutes: 60,
    telemetry: (random) => [
      { key: "telemetry_contacts_today", value: Math.round(30 + random() * 120), unit: "", trend: "flat" },
      { key: "telemetry_size_complaints", value: Math.round(8 + random() * 26), unit: "", trend: "up" },
      { key: "telemetry_csat_product", value: Number((4.2 + random() * 0.6).toFixed(2)), unit: " / 5", trend: "flat" },
      { key: "telemetry_return_intent", value: Number((3 + random() * 8).toFixed(1)), unit: "%", trend: "up" }
    ]
  },
  qa_review: {
    owner_key: "owner_qa",
    sop_code: "SOP-QA-006",
    sla_minutes: 240,
    telemetry: (random) => [
      { key: "telemetry_qa_score", value: Number((88 + random() * 8).toFixed(1)), unit: "%", trend: "down" },
      { key: "telemetry_evaluated_calls", value: Math.round(14 + random() * 40), unit: "", trend: "flat" },
      { key: "telemetry_critical_findings", value: Math.round(1 + random() * 6), unit: "", trend: "up" },
      { key: "telemetry_coaching_actions", value: Math.round(2 + random() * 9), unit: "", trend: "up" }
    ]
  },
  shipping_address: {
    owner_key: "owner_logistics",
    sop_code: "SOP-LOG-001",
    sla_minutes: 90,
    telemetry: (random) => [
      { key: "telemetry_address_conflicts", value: Math.round(6 + random() * 22), unit: "", trend: "up" },
      { key: "telemetry_delivery_failures", value: Math.round(2 + random() * 11), unit: "", trend: "flat" },
      { key: "telemetry_revalidation_time", value: Number((1.2 + random() * 3).toFixed(1)), unit: "h", trend: "down" },
      { key: "telemetry_carrier_sync", value: Number((85 + random() * 10).toFixed(1)), unit: "%", trend: "flat" }
    ]
  },
  app_crash: {
    owner_key: "owner_tech_l2",
    sop_code: "SOP-TS-002",
    sla_minutes: 30,
    telemetry: (random) => [
      { key: "telemetry_crash_rate", value: Number((0.4 + random() * 2.2).toFixed(2)), unit: "%", trend: "up" },
      { key: "telemetry_affected_sessions", value: Math.round(60 + random() * 240), unit: "", trend: "up" },
      { key: "telemetry_app_version", value: "v" + (3 + Math.round(random() * 2)) + "." + Math.round(random() * 9), unit: "", trend: "flat" },
      { key: "telemetry_avg_latency", value: Math.round(600 + random() * 900), unit: "ms", trend: "flat" }
    ]
  },
  generic: {
    owner_key: "owner_supervisor",
    sop_code: "SOP-OPS-001",
    sla_minutes: 60,
    telemetry: (random) => [
      { key: "telemetry_open_cases", value: Math.round(5 + random() * 25), unit: "", trend: "flat" },
      { key: "telemetry_repeat_contacts", value: Math.round(4 + random() * 18), unit: "", trend: "up" },
      { key: "telemetry_avg_latency", value: Math.round(500 + random() * 900), unit: "ms", trend: "flat" }
    ]
  }
};

function parseSopSteps(steps) {
  return String(steps || "")
    .split(/\s*(?=\d+\.\s)/)
    .map((step) => step.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function buildCaseDetail(metricsData, caseId) {
  const tickets = metricsData.active_critical_tickets || [];
  const ticket = tickets.find((item) => item.id === caseId) || pickPriorityCase(metricsData);
  if (!ticket) return null;

  const type = inferCaseType(ticket);
  const profile = CASE_PROFILES[type] || CASE_PROFILES.generic;
  const random = seededRandom(hashString(`${ticket.id}-${type}`));
  const openMinutes = Number(String(ticket.time_open || "0").replace(/\D/g, "")) || Math.round(5 + random() * 90);
  const slaUsedPct = Math.min(99, Math.round((openMinutes / profile.sla_minutes) * 100));

  const sop = (metricsData.sops || []).find((item) => item.code === profile.sop_code);
  const sopSteps = sop ? parseSopSteps(sop.steps) : [];
  const logs = (metricsData.technical_logs || []).slice(-6).reverse();

  return {
    case: {
      id: ticket.id,
      type,
      severity: ticket.severity,
      channel: ticket.channel,
      channel_key: ticket.channel_key || null,
      status: ticket.status,
      status_key: ticket.status_key || null,
      issue: ticket.issue,
      issue_key: ticket.issue_key || null,
      time_open: ticket.time_open,
      time_open_minutes: openMinutes,
      owner_key: ticket.owner_key || profile.owner_key,
      sla_minutes: ticket.sla_minutes || profile.sla_minutes,
      sla_used_pct: slaUsedPct,
      sla_at_risk: slaUsedPct >= 80,
      telemetry: profile.telemetry(random).map((metric) => ({ ...metric, value: metric.value })),
      affected_users: Array.from({ length: 4 }, () => `HM-••••${Math.floor(1000 + random() * 8999)}`),
      impacted_orders: Math.round(3 + random() * 26),
      regional_impact: ["EMEA-North", "EMEA-South", "LATAM", "APAC"][Math.floor(random() * 4)],
      logs: logs.map(({ time, level, message, message_key }) => ({ time, level, message, message_key: message_key || null })),
      resolution: {
        code: sop?.code || profile.sop_code,
        title: sop?.title || null,
        title_key: sop?.title_key || null,
        steps: sopSteps.map((text, index) => ({ index, text }))
      }
    }
  };
}

module.exports = {
  generateDiagnostic,
  generateChatResponse,
  getIntelligentFallback,
  buildCaseDetail,
  pickPriorityCase
};
