async function analyzeWithSalesAI(lead, siteAnalysis, score, settings) {
  const ai = settings?.ai || {};
  if (!ai.enabled || !ai.apiKey) {
    return fallbackSalesAnalysis(lead, siteAnalysis, score, settings);
  }
  try {
    const result = await analyzeBatchWithSalesAI([{ lead, siteAnalysis, score }], settings);
    return result[0] || fallbackSalesAnalysis(lead, siteAnalysis, score, settings);
  } catch (e) {
    return fallbackSalesAnalysis(lead, siteAnalysis, score, settings, e.message);
  }
}

async function analyzeBatchWithSalesAI(items, settings) {
  const ai = settings?.ai || {};
  const leads = (items || []).filter(Boolean);
  if (!leads.length) return [];
  if (!ai.enabled || !hasAnyProviderKey(ai)) {
    return leads.map((item) => fallbackSalesAnalysis(item.lead, item.siteAnalysis, item.score, settings));
  }

  const payload = buildBatchPromptPayload(leads, settings);
  const providers = resolveProviderChain(ai);
  let lastError = "";
  for (const providerConfig of providers) {
    try {
      const json = await requestChatCompletion(providerConfig, payload);
      const parsed = parseJsonResponse(json.choices?.[0]?.message?.content || "{}");
      const rows = Array.isArray(parsed) ? parsed : parsed.leads || parsed.resultados || [];
      return leads.map((item, index) => {
        const input = rows.find((row) => String(row.leadId || row.id || "") === String(item.lead.id)) || rows[index] || {};
        const normalized = normalizeAiJson(input, item.lead, item.siteAnalysis, item.score);
        normalized.rawProvider = providerConfig.provider;
        normalized.providerModel = providerConfig.model;
        return normalized;
      });
    } catch (e) {
      lastError = `${providerConfig.provider}: ${e.message}`;
      if (!shouldTryNextProvider(e)) break;
    }
  }

  return leads.map((item) => fallbackSalesAnalysis(item.lead, item.siteAnalysis, item.score, settings, lastError));
}

async function requestChatCompletion(providerConfig, payload) {
  const res = await fetch(providerConfig.chatCompletionsUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${providerConfig.apiKey}`,
      ...providerConfig.headers,
    },
    body: JSON.stringify({
      model: providerConfig.model || providerConfig.defaultModel,
      temperature: 0.25,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Voce e um analista CRO e closer B2B. Avalie copy, conversao, prova social e objecoes. Use os dados ja extraidos; nao invente. Retorne apenas JSON valido no schema pedido.",
        },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });
  if (!res.ok) {
    const err = new Error(`IA falhou: HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return await res.json();
}

function resolveProviderConfig(ai = {}) {
  const provider = String(ai.provider || "openrouter").toLowerCase();
  const appName = ai.appName || "Sigma GMaps Scraper";
  if (provider === "openrouter") {
    return {
      provider,
      apiKey: ai.apiKey || "",
      model: ai.model || "openrouter/free",
      defaultModel: "openrouter/free",
      chatCompletionsUrl: joinChatUrl(ai.baseUrl || "https://openrouter.ai/api/v1"),
      headers: {
        ...(ai.siteUrl ? { "HTTP-Referer": ai.siteUrl } : { "HTTP-Referer": "https://sigma-gmaps.local" }),
        "X-Title": appName,
      },
    };
  }
  if (provider === "opencode") {
    // OpenCode Zen — endpoint OpenAI-compatible com modelos gratuitos
    // https://opencode.ai/zen/v1/chat/completions
    return {
      provider: "opencode",
      apiKey: ai.apiKey || "",
      model: ai.model || "deepseek-v4-flash-free",
      defaultModel: "deepseek-v4-flash-free",
      chatCompletionsUrl: joinChatUrl(ai.baseUrl || "https://opencode.ai/zen/v1"),
      headers: {
        ...parseExtraHeaders(ai.extraHeaders),
        "X-Title": appName,
      },
    };
  }
  if (provider === "custom") {
    return {
      provider,
      apiKey: ai.apiKey || "",
      model: ai.model || "gpt-4.1-mini",
      defaultModel: ai.model || "gpt-4.1-mini",
      chatCompletionsUrl: joinChatUrl(ai.baseUrl || ""),
      headers: parseExtraHeaders(ai.extraHeaders),
    };
  }
  return {
    provider: "openai",
    apiKey: ai.apiKey || "",
    model: ai.model || "gpt-4.1-mini",
    defaultModel: "gpt-4.1-mini",
    chatCompletionsUrl: joinChatUrl(ai.baseUrl || "https://api.openai.com/v1"),
    headers: {},
  };
}

function resolveProviderChain(ai = {}) {
  const primary = resolveProviderConfig(ai);
  const extras = parseProviderFallbacks(ai);
  const chain = [primary, ...extras.map((provider) => resolveProviderConfig({ ...ai, ...provider }))];
  const seen = new Set();
  return chain.filter((provider) => {
    const key = `${provider.provider}|${provider.chatCompletionsUrl}|${provider.model}`;
    if (!provider.apiKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseProviderFallbacks(ai = {}) {
  if (Array.isArray(ai.providers)) return ai.providers.filter((item) => item && item.enabled !== false);
  if (!ai.fallbackProviders) return [];
  try {
    const parsed = JSON.parse(ai.fallbackProviders);
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.enabled !== false) : [];
  } catch {
    return [];
  }
}

function hasAnyProviderKey(ai = {}) {
  if (ai.apiKey) return true;
  return parseProviderFallbacks(ai).some((provider) => provider.apiKey);
}

function joinChatUrl(baseUrl) {
  const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!clean) throw new Error("Base URL do provedor de IA nao configurada");
  if (/\/chat\/completions$/i.test(clean)) return clean;
  return `${clean}/chat/completions`;
}

function parseExtraHeaders(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildPromptPayload(lead, siteAnalysis, score, settings) {
  return {
    tarefa: "Determinar se vale investir tempo tentando vender um novo site, landing page ou sistema.",
    idioma: settings?.analysis?.language || "pt-BR",
    oferta: settings?.analysis?.offerType || "site_landing_sistema",
    empresa: lead.company,
    score_base: score,
    dados_tecnicos_resumidos: {
      url: siteAnalysis.finalUrl,
      cms: siteAnalysis.cms,
      tecnologias: (siteAnalysis.technologies || []).map((t) => t.name),
      frameworks: (siteAnalysis.frameworks || []).map((t) => t.name),
      tracking: siteAnalysis.tracking,
      performance: siteAnalysis.performance,
      conteudo: siteAnalysis.content,
      conversao: siteAnalysis.conversion,
      seo: siteAnalysis.seoBasics,
      paginas: siteAnalysis.crawl?.pagesFound,
      erros: siteAnalysis.crawl?.httpErrors?.length || 0,
      mobile: siteAnalysis.mobile,
    },
    json_obrigatorio: {
      score: "0-100",
      prioridade: "ignorar | baixa | boa | alta",
      vale_prospectar: "boolean",
      chance_resposta: "baixa | media | alta",
      chance_reuniao: "baixa | media | alta",
      ticket_estimado: "baixo | medio | alto",
      grau_de_urgencia: "baixo | medio | alto",
      facilidade_de_convencer: "baixa | media | alta",
      principais_dores: ["", "", ""],
      principais_oportunidades: ["", "", ""],
      resumo: "",
      resumo_empresa: "",
      problemas_encontrados: ["", "", ""],
      argumento_principal_venda: "",
      mensagem_whatsapp: "",
      assunto_email: "",
      primeiro_email: "",
      mensagem_follow_up: "",
      objecoes_provaveis: [{ objecao: "", resposta: "" }],
    },
  };
}

function buildBatchPromptPayload(items, settings) {
  return {
    tarefa: "Avaliar em lote se cada lead vale prospeccao para vender site, landing page ou sistema.",
    idioma: settings?.analysis?.language || "pt-BR",
    oferta: settings?.analysis?.offerType || "site_landing_sistema",
    regra: "Use os campos siteSummary/conversion.likelyLeaks como insumo principal. Avalie copy real, clareza, CTA, confianca, quebra de objecoes e potencial comercial. Retorne JSON no formato {\"leads\": [...]} mantendo leadId.",
    leads: items.map((item) => ({
      leadId: item.lead.id,
      empresa: item.lead.company,
      score_base: item.score,
      siteSummary: item.siteAnalysis.siteSummary || {},
      dados_tecnicos_resumidos: {
        url: item.siteAnalysis.finalUrl,
        cms: item.siteAnalysis.cms,
        tecnologias: (item.siteAnalysis.technologies || []).map((t) => t.name),
        tracking: item.siteAnalysis.tracking,
        performance: item.siteAnalysis.performance,
        conteudo: item.siteAnalysis.content,
        conversao: item.siteAnalysis.conversion,
        seo: item.siteAnalysis.seoBasics,
        paginas: item.siteAnalysis.crawl?.pagesFound,
        erros: item.siteAnalysis.crawl?.httpErrors?.length || 0,
        mobile: item.siteAnalysis.mobile,
      },
    })),
    json_obrigatorio_por_lead: {
      leadId: "",
      score: "0-100",
      prioridade: "ignorar | baixa | boa | alta",
      vale_prospectar: "boolean",
      conversionScore: "0-100",
      copyScore: "0-100",
      objectionScore: "0-100",
      trustScore: "0-100",
      principal_vazamento_conversao: "",
      diagnostico_copy: "",
      objecoes_nao_quebradas: ["", "", ""],
      provas_que_faltam: ["", "", ""],
      principais_dores: ["", "", ""],
      principais_oportunidades: ["", "", ""],
      argumento_principal_venda: "",
      mensagem_whatsapp: "",
      assunto_email: "",
      primeiro_email: "",
      mensagem_follow_up: "",
      objecoes_provaveis: [{ objecao: "", resposta: "" }],
      resumo: "",
      resumo_empresa: "",
      problemas_encontrados: ["", "", ""],
      chance_resposta: "baixa | media | alta",
      chance_reuniao: "baixa | media | alta",
      ticket_estimado: "baixo | medio | alto",
      grau_de_urgencia: "baixo | medio | alto",
      facilidade_de_convencer: "baixa | media | alta",
    },
  };
}

function normalizeAiJson(input, lead, siteAnalysis, score) {
  const fb = fallbackSalesAnalysis(lead, siteAnalysis, score, {});
  const out = {
    ...fb,
    ...input,
    score: clamp(input.score ?? score.value),
    prioridade: normalizePriority(input.prioridade || score.priority),
    vale_prospectar: Boolean(input.vale_prospectar ?? score.worthProspecting),
    principais_dores: array3(input.principais_dores, fb.principais_dores),
    principais_oportunidades: array3(input.principais_oportunidades, fb.principais_oportunidades),
    problemas_encontrados: array3(input.problemas_encontrados, fb.problemas_encontrados),
    conversionScore: clamp(input.conversionScore ?? input.conversion_score ?? siteAnalysis.siteSummary?.conversion?.localCopyScore?.overall ?? score.value),
    copyScore: clamp(input.copyScore ?? input.copy_score ?? siteAnalysis.siteSummary?.conversion?.localCopyScore?.heroClarity ?? score.value),
    objectionScore: clamp(input.objectionScore ?? input.objection_score ?? siteAnalysis.siteSummary?.conversion?.localCopyScore?.objectionScore ?? score.value),
    trustScore: clamp(input.trustScore ?? input.trust_score ?? siteAnalysis.siteSummary?.conversion?.localCopyScore?.trustScore ?? score.value),
    principal_vazamento_conversao: input.principal_vazamento_conversao || input.mainLeak || siteAnalysis.siteSummary?.conversion?.likelyLeaks?.[0] || "",
    diagnostico_copy: input.diagnostico_copy || input.copyDiagnosis || "",
    objecoes_nao_quebradas: array3(input.objecoes_nao_quebradas || input.missingObjections, siteAnalysis.siteSummary?.conversion?.likelyLeaks || []),
    provas_que_faltam: array3(input.provas_que_faltam || input.missingProof, fb.principais_oportunidades),
    objecoes_provaveis: Array.isArray(input.objecoes_provaveis) && input.objecoes_provaveis.length
      ? input.objecoes_provaveis.slice(0, 6)
      : fb.objecoes_provaveis,
    rawProvider: "openai",
  };
  return out;
}

function parseJsonResponse(text) {
  const raw = String(text || "{}").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return {};
    return JSON.parse(match[0]);
  }
}

function shouldTryNextProvider(error) {
  const status = Number(error?.status || 0);
  return !status || status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500;
}

function fallbackSalesAnalysis(lead, siteAnalysis, score, settings, warning = "") {
  const c = lead.company || {};
  const hasSite = !!c.website;
  const mainPain = pickMainPain(c, siteAnalysis);
  const opportunity = pickOpportunity(c, siteAnalysis);
  const companyName = c.name || "sua empresa";
  const service = (settings?.commercial?.services || ["site", "landing page"])[0] || "site";
  const message = `Oi, ${companyName}! Tudo bem? Vi a empresa no Google e notei uma oportunidade: ${mainPain.toLowerCase()} Trabalho com ${service} para transformar visitas em contatos pelo WhatsApp. Posso te mandar uma ideia rápida do que eu melhoraria?`;
  const priorityLabel = score.classification || "Prioridade a avaliar";
  return {
    score: score.value,
    prioridade: score.priority,
    vale_prospectar: score.worthProspecting,
    chance_resposta: score.value >= 80 ? "alta" : score.value >= 60 ? "media" : "baixa",
    chance_reuniao: score.value >= 80 ? "media" : score.value >= 60 ? "media" : "baixa",
    ticket_estimado: estimateTicket(c, siteAnalysis),
    grau_de_urgencia: score.value >= 80 ? "alto" : score.value >= 60 ? "medio" : "baixo",
    facilidade_de_convencer: c.phone || c.whatsapp ? "media" : "baixa",
    principais_dores: [
      mainPain,
      hasSite
        ? "O site existe, mas pode estar perdendo contatos que já chegam pelo Google."
        : "Sem site próprio, a empresa perde credibilidade e contatos no digital.",
      siteAnalysis.tracking?.googleAnalytics
        ? "Já mede visitas, mas ainda dá para melhorar quantos viram cliente."
        : "Não dá para saber bem o que o site está gerando de resultado.",
    ],
    principais_oportunidades: [
      opportunity,
      "Facilitar o pedido de orçamento pelo WhatsApp.",
      "Usar as avaliações do Google como prova social no site.",
    ],
    resumo: `${companyName}: nota ${score.value}/100 (${priorityLabel}). ${score.reasons?.[0] || "Vale olhar o site e a presença no Google."}`,
    resumo_empresa: `${companyName}${c.category ? ` trabalha com ${c.category}` : ""}${c.city ? ` em ${c.city}` : ""}.`,
    problemas_encontrados: [
      mainPain,
      siteAnalysis.conversion?.hasWhatsappButton
        ? "Há botão de contato, mas o caminho até a venda pode ficar mais claro."
        : "WhatsApp não aparece de forma fácil no site.",
      siteAnalysis.content?.description
        ? "A mensagem do site pode ser mais clara e persuasiva."
        : "A primeira impressão do site não explica bem o que a empresa oferece.",
    ],
    argumento_principal_venda: opportunity,
    mensagem_whatsapp: message,
    assunto_email: `Ideia para gerar mais contatos pelo site da ${companyName}`,
    primeiro_email: `Olá, ${companyName}.\n\nEncontrei vocês pelo Google e notei uma oportunidade: ${mainPain.toLowerCase()}\n\nTrabalho criando sites e páginas simples para transformar visitas em pedidos de orçamento. Acredito que a ${companyName} poderia aproveitar melhor a presença local e levar mais pessoas para o WhatsApp.\n\nPosso te mandar uma ideia objetiva do que eu mudaria?`,
    mensagem_follow_up: `Oi, ${companyName}. Passando só para reforçar: minha sugestão é melhorar a conversão digital de quem já encontra vocês no Google. Faz sentido eu te mandar uma ideia rápida?`,
    objecoes_provaveis: [
      { objecao: "Já tenho site.", resposta: "Perfeito. A ideia não é trocar por trocar — é ver se o site está gerando contatos de verdade." },
      { objecao: "Não preciso agora.", resposta: "Entendo. Posso te mandar uma análise curta para você guardar e avaliar quando fizer sentido." },
      { objecao: "Está caro.", resposta: "Podemos começar com uma página enxuta, focada em gerar orçamentos." },
    ],
    warning,
    rawProvider: "fallback",
  };
}

function pickMainPain(company, site) {
  if (!company.website) return "A empresa não tem um site próprio claro.";
  if (!site.hasHttps) return "O site não está seguro (sem cadeado HTTPS).";
  if (!site.conversion?.hasWhatsappButton) return "O site não facilita o contato imediato pelo WhatsApp.";
  if (!site.conversion?.hasForm) return "O site não captura pedidos de orçamento por formulário.";
  if (!site.content?.h1 || !site.content?.description) return "A mensagem do site não deixa a oferta clara de cara.";
  if (!site.mobile?.isResponsive) return "O site pode não funcionar bem no celular.";
  if ((site.performance?.loadTimeMs || 0) > 5000) return "O site carrega devagar e pode afastar clientes.";
  return "O site existe, mas pode converter melhor (gerar mais contatos).";
}

function pickOpportunity(company, site) {
  if (!company.website) return "Criar um site simples e profissional para aumentar confiança e receber contatos.";
  if (site.tracking?.metaPixel || site.tracking?.googleAdsConversion) return "Melhorar a página para aproveitar melhor o tráfego de anúncios que já existe.";
  if (company.reviewCount >= 50) return "Usar as avaliações do Google como prova social em uma página mais persuasiva.";
  return "Reposicionar o site para gerar mais contatos qualificados.";
}

function estimateTicket(company, site) {
  const reviews = Number(company.reviewCount || 0);
  if ((site.tracking?.metaPixel || site.tracking?.googleAdsConversion) && reviews >= 50) return "alto";
  if (reviews >= 30 || site.hasOwnDomain) return "medio";
  return "baixo";
}

function normalizePriority(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("alta")) return "alta";
  if (v.includes("boa")) return "boa";
  if (v.includes("baixa")) return "baixa";
  if (v.includes("ignorar")) return "ignorar";
  return v;
}

function array3(value, fallback) {
  const arr = Array.isArray(value) ? value.filter(Boolean) : [];
  return (arr.length ? arr : fallback || []).slice(0, 3);
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

module.exports = { analyzeWithSalesAI, analyzeBatchWithSalesAI, fallbackSalesAnalysis, resolveProviderConfig, resolveProviderChain };
