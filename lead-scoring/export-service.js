const fs = require("fs");

function saveProspectingCSV(leads, filename) {
  const rows = (leads || []).map((lead) => ({
    nome: lead.company?.name || "",
    categoria: lead.company?.category || "",
    cidade: lead.company?.city || "",
    estado: lead.company?.state || "",
    telefone: lead.company?.phone || "",
    whatsapp: lead.company?.whatsapp || "",
    email: lead.company?.email || "",
    site: lead.company?.website || "",
    instagram: lead.company?.instagram || "",
    nota_google: lead.company?.rating || "",
    avaliacoes: lead.company?.reviewCount || lead.company?.totalReviews || "",
    score: lead.score?.value || 0,
    prioridade: lead.score?.classification || lead.score?.priority || "",
    vale_prospectar: lead.score?.worthProspecting ? "sim" : "nao",
    chance_resposta: lead.aiAnalysis?.chance_resposta || "",
    chance_reuniao: lead.aiAnalysis?.chance_reuniao || "",
    ticket_estimado: lead.aiAnalysis?.ticket_estimado || "",
    dor_principal: lead.aiAnalysis?.principais_dores?.[0] || "",
    oportunidade_principal: lead.aiAnalysis?.principais_oportunidades?.[0] || "",
    argumento: lead.aiAnalysis?.argumento_principal_venda || "",
    mensagem_whatsapp: lead.aiAnalysis?.mensagem_whatsapp || "",
    assunto_email: lead.aiAnalysis?.assunto_email || "",
    cms: lead.siteAnalysis?.cms || "",
    tecnologias: (lead.siteAnalysis?.technologies || []).map((t) => t.name || t).join("; "),
    analytics: lead.siteAnalysis?.tracking?.googleAnalytics ? "sim" : "nao",
    gtm: lead.siteAnalysis?.tracking?.googleTagManager ? "sim" : "nao",
    meta_pixel: lead.siteAnalysis?.tracking?.metaPixel ? "sim" : "nao",
    tem_formulario: lead.siteAnalysis?.conversion?.hasForm ? "sim" : "nao",
    tem_whatsapp_site: lead.siteAnalysis?.conversion?.hasWhatsappButton ? "sim" : "nao",
    status_prospeccao: lead.prospecting?.status || "not_contacted",
    respondeu: lead.prospecting?.responded ? "sim" : "nao",
    reuniao: lead.prospecting?.meetingBooked ? "sim" : "nao",
    proposta: lead.prospecting?.proposalSent ? "sim" : "nao",
    fechou: lead.prospecting?.closed ? "sim" : "nao",
    valor_fechado: lead.prospecting?.closedValue || "",
  }));
  const keys = rows.length ? Object.keys(rows[0]) : ["nome", "score", "prioridade"];
  const csv = [keys.map(escapeCsv).join(",")]
    .concat(rows.map((row) => keys.map((key) => escapeCsv(row[key])).join(",")))
    .join("\n");
  fs.writeFileSync(filename, `${csv}\n`, "utf-8");
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

module.exports = { saveProspectingCSV };
