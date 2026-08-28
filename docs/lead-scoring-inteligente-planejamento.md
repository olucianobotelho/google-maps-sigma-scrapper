# Planejamento - Lead Scoring Inteligente para Prospecção Web

**Projeto:** Sigma GMaps Scraper  
**Status:** planejamento de produto e engenharia  
**Objetivo:** adicionar uma feature opcional de qualificação automática de leads para venda de sites, landing pages e sistemas.  
**Escopo:** nova camada de análise comercial sobre leads já coletados no Google Maps, sem transformar o produto inteiro em uma ferramenta exclusiva para agências.

---

## 1. Resumo executivo

O Sigma hoje coleta empresas no Google Maps, extrai dados de contato, identifica site, e-mail e Instagram, permite exportação e possui campanhas de WhatsApp. A nova feature proposta adiciona uma camada chamada **Lead Scoring Inteligente**, voltada para usuários que vendem sites, landing pages, sistemas, tráfego ou serviços digitais.

O objetivo não é apenas dizer se uma empresa tem site. O objetivo é responder:

- Vale a pena prospectar esta empresa?
- Qual chance de resposta?
- Qual chance de marcar reunião?
- Qual ticket estimado?
- Quais dores comerciais usar na abordagem?
- Qual mensagem mandar no WhatsApp?
- Qual e-mail enviar?
- Quais objeções podem aparecer?
- Como priorizar centenas de leads sem trabalho manual?

A feature deve ser opcional. Usuários que usam o Sigma para outros tipos de prospecção continuam usando o fluxo normal. Usuários que vendem sites podem ativar o módulo e transformar leads brutos em uma fila comercial priorizada.

---

## 2. Princípios do produto

### 2.1 O Sigma continua sendo genérico

A feature de Lead Scoring não deve substituir o scraper principal. Ela deve existir como uma camada adicional.

Fluxo atual preservado:

```text
Google Maps
-> Coleta de empresas
-> Tabela de leads
-> Filtros
-> Exportação
-> Campanhas WhatsApp
```

Fluxo novo opcional:

```text
Google Maps
-> Coleta de empresas
-> Coleta do site
-> Crawler do site
-> Screenshot desktop/mobile
-> Extração técnica
-> Análise comercial por IA
-> Lead Score
-> Abordagem automática
-> Fila de prospecção
-> Registro de resultado
-> Aprendizado
```

### 2.2 IA como vendedor, não auditor técnico

A IA não deve escrever laudo técnico frio. A IA deve agir como vendedor experiente analisando se vale investir tempo naquela empresa.

Exemplo de interpretação correta:

- "O site tem visual antigo, pouca clareza de oferta e WhatsApp pouco visível. Boa oportunidade para vender landing page focada em conversão."

Exemplo de interpretação errada:

- "O site usa jQuery 1.12, não possui lazy loading e tem 37 scripts."

Os dados técnicos alimentam a IA, mas a resposta final deve ser comercial.

### 2.3 Baixa fricção

O usuário não deve precisar abrir site por site. A tela deve entregar:

- prioridade;
- resumo;
- dores;
- oportunidades;
- mensagem pronta;
- próximo passo.

### 2.4 Controle local

Por padrão, dados e screenshots ficam no computador do usuário, seguindo o posicionamento atual do Sigma.

### 2.5 Degradação graciosa

Se a IA não estiver configurada, o sistema ainda deve gerar:

- score técnico/comercial determinístico;
- indicadores;
- filtros;
- fila;
- templates básicos.

Com IA configurada, o sistema gera diagnóstico e mensagens personalizadas.

---

## 3. Não objetivos

Esta feature não deve:

- obrigar todo usuário a usar IA;
- transformar toda busca em auditoria de site;
- bloquear exportação normal;
- exigir servidor;
- depender de CRM externo;
- prometer precisão absoluta;
- disparar mensagens automaticamente sem ação do usuário;
- substituir julgamento humano em negociações grandes.

---

## 4. Personas principais

### 4.1 Vendedor de sites

Busca empresas locais com site ruim, sem site ou com baixa conversão. Quer mensagem pronta e lista priorizada.

### 4.2 Agência pequena

Faz prospecção em volume. Precisa filtrar cidade, nicho, score, tecnologia e probabilidade de fechamento.

### 4.3 Freelancer

Quer poucos leads bons por dia. Precisa entender rapidamente a dor do cliente para mandar abordagem personalizada.

### 4.4 Usuário genérico do Sigma

Usa scraping para outros objetivos. Não deve ser impactado pela feature.

---

## 5. Experiência do usuário

### 5.1 Entrada na feature

Adicionar novo item na sidebar:

```text
Lead Scoring
```

Também adicionar ações na tabela principal:

- `Analisar site`
- `Analisar selecionados`
- `Analisar todos com site`
- `Enviar para fila de prospecção`

Na fila de busca, adicionar opção:

```text
[ ] Ativar Lead Scoring para venda de sites
```

Quando ativado, cada lead com site entra na fila de análise após a coleta principal.

### 5.2 Estados visuais por lead

Cada lead pode ter um status de análise:

- `Não analisado`
- `Sem site`
- `Na fila`
- `Analisando`
- `Analisado`
- `Falhou`
- `Reanalisar`

### 5.3 Card de análise do lead

Ao abrir um lead analisado, mostrar:

- score grande;
- prioridade;
- vale prospectar;
- chance de resposta;
- chance de reunião;
- ticket estimado;
- principais dores;
- principais oportunidades;
- screenshot desktop;
- screenshot mobile;
- resumo da empresa;
- argumento principal de venda;
- mensagem WhatsApp;
- primeiro e-mail;
- follow-up;
- objeções e respostas;
- histórico de prospecção.

### 5.4 Ações comerciais

Botões principais:

- `Copiar WhatsApp`
- `Copiar e-mail`
- `Criar campanha WhatsApp`
- `Marcar como prospectado`
- `Registrar resposta`
- `Registrar reunião`
- `Registrar proposta`
- `Registrar fechamento`
- `Registrar perda`

### 5.5 Fila de prospecção

Tela focada em execução:

```text
Alta prioridade
Boa oportunidade
Baixa prioridade
Ignorar
```

Cada item deve mostrar:

- empresa;
- cidade;
- categoria;
- score;
- motivo do score;
- melhor canal;
- próxima ação.

---

## 6. Dados coletados

### 6.1 Dados da empresa

Campos desejados:

| Campo | Origem principal | Observação |
|---|---|---|
| Nome | Google Maps | Já existe parcialmente |
| Categoria | Google Maps | Já existe |
| Endereço | Google Maps | Já existe |
| Cidade | Endereço/consulta | Normalizar |
| Estado | Endereço/consulta | Normalizar |
| Telefone | Google Maps | Já existe |
| WhatsApp | Telefone/site | Inferir quando Brasil e telefone móvel |
| E-mail | Site | Já existe parcialmente |
| Website | Google Maps | Já existe |
| Instagram | Maps/site | Já existe parcialmente |
| Quantidade de avaliações | Google Maps | Já existe |
| Nota média | Google Maps | Já existe |
| Horário de funcionamento | Google Maps | Novo |
| Coordenadas | Google Maps | Já existe |
| URL do Maps | Google Maps | Já existe |
| Fotos | Google Maps | Já existe parcialmente |

### 6.2 Dados técnicos do site

| Campo | Como coletar |
|---|---|
| URL final | Playwright após redirects |
| HTTPS | URL final começa com `https://` |
| Domínio próprio | domínio não é rede social, agregador ou subdomínio grátis comum |
| Data aproximada do domínio | WHOIS opcional, fase posterior |
| CMS detectado | HTML, assets, meta generator, paths |
| Tecnologias utilizadas | scripts, headers, padrões |
| Frameworks | React/Vue/Next/Angular/etc. |
| Google Analytics | `gtag`, `analytics.js`, `G-`, `UA-` |
| Google Tag Manager | `GTM-` |
| Meta Pixel | `fbq`, `connect.facebook.net` |
| Google Ads Conversion | `AW-`, `conversion_async.js` |
| TikTok Pixel | `ttq`, `analytics.tiktok.com` |
| Microsoft Clarity | `clarity.ms`, `clarity(` |
| Hotjar | `hotjar`, `hj(` |
| LinkedIn Insight | `linkedin.com/insight` |
| Cloudflare | headers e names comuns |
| CDN | headers e hosts de assets |
| Tempo de carregamento | Playwright timing |
| Tamanho da página | response body + assets principais |
| Quantidade de imagens | DOM |
| Quantidade de scripts | DOM |
| Quantidade de CSS | DOM |
| Número de páginas encontradas | crawler |
| Possui sitemap | `/sitemap.xml` |
| Possui robots.txt | `/robots.txt` |
| Meta Title | DOM |
| Meta Description | DOM |
| H1 | DOM |
| Quantidade de H2 | DOM |
| Open Graph | meta `og:*` |
| Schema.org | JSON-LD/microdata |
| Favicon | link icon ou fallback |
| Responsividade | viewport mobile + heurísticas |
| Botão WhatsApp | links `wa.me`, `api.whatsapp.com`, texto |
| Telefone clicável | `tel:` |
| Formulário | `form`, inputs, CTAs |
| Chat Online | scripts/intercom/tawk/crisp/jivo/etc. |
| Links quebrados | crawler limitado |
| Erros HTTP | status code por página |

---

## 7. Screenshot

### 7.1 Capturas obrigatórias

Para cada site analisado:

- desktop: `1366x768`;
- mobile: `390x844`;
- página inicial;
- salvar PNG ou WebP.

### 7.2 Organização dos arquivos

Sugestão:

```text
{userData}/lead-scoring/screenshots/
  {leadId}/
    desktop.png
    mobile.png
    metadata.json
```

### 7.3 Política de armazenamento

Configurações:

- manter screenshots por 30/60/90 dias;
- apagar screenshots de leads ignorados;
- limitar cache por tamanho;
- reusar screenshot se análise tiver menos de X dias.

---

## 8. Crawler do site

### 8.1 Escopo do crawler

O crawler deve ser limitado para evitar lentidão e comportamento invasivo.

Configuração inicial:

- máximo 8 páginas por domínio;
- timeout por página: 20s;
- profundidade máxima: 2;
- ignorar arquivos grandes;
- ignorar PDFs na V1;
- respeitar domínio principal;
- evitar loops por query params.

### 8.2 Páginas prioritárias

Priorizar URLs que contenham:

- contato;
- sobre;
- servicos;
- serviços;
- produtos;
- orçamento;
- agendamento;
- portfolio;
- cases;
- landing;
- home.

### 8.3 Saída do crawler

```json
{
  "finalUrl": "",
  "pagesVisited": 0,
  "pages": [
    {
      "url": "",
      "status": 200,
      "title": "",
      "description": "",
      "h1": "",
      "h2Count": 0,
      "forms": 0,
      "whatsappLinks": [],
      "phoneLinks": [],
      "emails": [],
      "brokenLinks": []
    }
  ],
  "errors": []
}
```

---

## 9. Detector técnico

### 9.1 Estratégia

Criar detector por heurísticas simples primeiro. Evitar dependência pesada no MVP.

Fontes:

- HTML;
- scripts;
- links CSS;
- meta tags;
- response headers;
- cookies;
- URLs de assets;
- objetos globais via `page.evaluate`.

### 9.2 Exemplos de regras

WordPress:

- `/wp-content/`;
- `/wp-includes/`;
- `wp-json`;
- meta generator WordPress.

Wix:

- `wixstatic.com`;
- `wix.com`;
- scripts Wix.

Shopify:

- `cdn.shopify.com`;
- `Shopify.theme`;
- paths `/cart`, `/products`.

React:

- root com data attributes comuns;
- scripts com bundles;
- `__REACT_DEVTOOLS_GLOBAL_HOOK__` quando disponível.

Next.js:

- `/_next/static/`;
- `__NEXT_DATA__`.

GTM:

- `GTM-`;
- `googletagmanager.com/gtm.js`.

Meta Pixel:

- `fbq(`;
- `connect.facebook.net`.

### 9.3 Confiança da detecção

Cada tecnologia deve ter:

```json
{
  "name": "WordPress",
  "category": "cms",
  "confidence": 0.95,
  "evidence": ["wp-content found", "wp-json found"]
}
```

---

## 10. Score determinístico

### 10.1 Por que score híbrido

A IA pode variar. O score base deve ser reproduzível. A IA ajusta e explica, mas não deve ser a única fonte.

### 10.2 Composição inicial

| Área | Peso |
|---|---:|
| Fit comercial | 20 |
| Dor digital | 30 |
| Facilidade de contato | 15 |
| Potencial de conversão | 20 |
| Sinais comerciais da IA | 15 |
| Total | 100 |

### 10.3 Fit comercial

Sinais positivos:

- categoria vende serviço de ticket razoável;
- muitas avaliações;
- nota boa;
- presença local ativa;
- nicho com concorrência visual.

Exemplos de nichos fortes:

- clínicas;
- estética;
- odontologia;
- advocacia;
- arquitetura;
- restaurantes premium;
- escolas;
- academias;
- oficinas especializadas;
- imobiliárias;
- construtoras;
- turismo;
- serviços B2B.

### 10.4 Dor digital

Sinais de dor:

- sem site;
- site sem HTTPS;
- site lento;
- layout antigo;
- sem CTA;
- sem WhatsApp visível;
- sem formulário;
- sem mobile bom;
- title/description fracos;
- sem analytics/pixel;
- erros HTTP;
- links quebrados;
- site em subdomínio grátis;
- domínio de rede social no lugar de site.

### 10.5 Facilidade de contato

Sinais:

- telefone válido;
- WhatsApp provável;
- e-mail encontrado;
- Instagram encontrado;
- formulário funcional;
- link direto para WhatsApp.

### 10.6 Potencial de conversão

Sinais:

- boa reputação no Maps;
- negócio local com demanda;
- avaliações recentes;
- site já tem algum investimento;
- tem pixel/analytics mas site fraco;
- site tem tráfego provável, mas conversão ruim.

### 10.7 Sinais da IA

A IA avalia:

- visual;
- credibilidade;
- modernidade;
- clareza;
- hierarquia visual;
- facilidade de conversão;
- força do CTA;
- experiência mobile;
- confiança;
- comunicação;
- potencial comercial;
- urgência.

### 10.8 Faixas de score

| Score | Classificação | Ação |
|---:|---|---|
| 0-39 | Ignorar | Não prospectar agora |
| 40-59 | Baixa prioridade | Guardar ou abordar depois |
| 60-79 | Boa oportunidade | Prospectar |
| 80-100 | Alta prioridade | Prospectar primeiro |

---

## 11. Contrato da IA

### 11.1 Entrada para IA

Enviar somente dados necessários:

- dados da empresa;
- resumo do site;
- dados técnicos relevantes;
- prints desktop/mobile quando suportado;
- sinais de conversão;
- sinais de confiança;
- sinais de dor;
- idioma desejado.

### 11.2 Prompt do sistema

```text
Você é um vendedor experiente de sites, landing pages e sistemas.
Sua função é decidir se vale investir tempo tentando vender uma solução digital para esta empresa.

Não faça auditoria técnica profunda.
Use os dados técnicos apenas como evidências comerciais.
Fale como alguém que entende prospecção, objeções, timing, dor e oferta.
Retorne apenas JSON válido no schema solicitado.
```

### 11.3 Prompt do usuário

```text
Analise a empresa abaixo para prospecção de venda de site, landing page ou sistema.

Responda:
- Vale prospectar?
- Qual prioridade?
- Qual chance de resposta?
- Qual chance de reunião?
- Qual ticket estimado?
- Quais dores usar na abordagem?
- Quais oportunidades apresentar?
- Qual mensagem personalizada mandar?

Dados:
{lead}

Dados técnicos:
{technicalAnalysis}

Screenshots:
{screenshots}
```

### 11.4 JSON esperado

```json
{
  "score": 0,
  "prioridade": "ignorar | baixa | boa | alta",
  "vale_prospectar": true,
  "chance_resposta": "baixa | media | alta",
  "chance_reuniao": "baixa | media | alta",
  "ticket_estimado": "baixo | medio | alto",
  "grau_de_urgencia": "baixo | medio | alto",
  "facilidade_de_convencer": "baixa | media | alta",
  "principais_dores": ["", "", ""],
  "principais_oportunidades": ["", "", ""],
  "resumo": "",
  "resumo_empresa": "",
  "problemas_encontrados": ["", "", ""],
  "argumento_principal_venda": "",
  "mensagem_whatsapp": "",
  "assunto_email": "",
  "primeiro_email": "",
  "mensagem_follow_up": "",
  "objecoes_provaveis": [
    {
      "objecao": "",
      "resposta": ""
    }
  ]
}
```

### 11.5 Validação

Após resposta da IA:

- validar JSON;
- normalizar score entre 0 e 100;
- garantir arrays com tamanho esperado;
- preencher fallback quando campo vier vazio;
- salvar resposta bruta para depuração;
- salvar versão normalizada para UI.

---

## 12. Geração automática da abordagem

### 12.1 WhatsApp

A mensagem deve:

- ser curta;
- mencionar a empresa;
- citar uma observação real;
- evitar tom de robô;
- não parecer auditoria gratuita agressiva;
- abrir conversa, não tentar vender tudo no primeiro contato.

Exemplo:

```text
Oi, {{nome}}. Tudo bem?
Vi a {{empresa}} no Google e percebi que vocês já têm boa presença local, mas o site parece pouco focado em gerar contato pelo WhatsApp.

Trabalho criando sites e landing pages para transformar visitas em orçamentos.
Posso te mandar uma ideia rápida do que eu melhoraria?
```

### 12.2 E-mail

Estrutura:

- assunto específico;
- abertura contextual;
- dor observada;
- oportunidade;
- prova/clareza;
- CTA leve.

### 12.3 Follow-up

Follow-up deve ser menor que a primeira mensagem e retomar uma dor.

### 12.4 Objeções

Objeções comuns:

- "Já tenho site."
- "Não preciso disso agora."
- "Está caro."
- "Vou ver depois."
- "Já tenho alguém que faz."
- "Não tenho tempo."

Cada objeção deve ter resposta curta, consultiva e sem pressão excessiva.

---

## 13. Dashboard e filtros

### 13.1 Filtros obrigatórios

- cidade;
- categoria;
- score mínimo/máximo;
- tecnologia;
- tem pixel;
- tem analytics;
- tem WhatsApp;
- tem formulário;
- tem domínio;
- nota Google;
- quantidade de avaliações;
- prioridade;
- status da prospecção;
- status da análise.

### 13.2 Métricas principais

Cards:

- leads analisados;
- alta prioridade;
- boa oportunidade;
- sem site;
- site fraco;
- com WhatsApp;
- com pixel/analytics;
- prospectados;
- responderam;
- reuniões;
- propostas;
- fechamentos;
- valor fechado.

### 13.3 Segmentos prontos

Criar filtros salvos:

- `Alta prioridade`
- `Sem site`
- `Site antigo`
- `Tem tráfego, site ruim`
- `Boa reputação, baixa conversão`
- `WhatsApp escondido`
- `Sem formulário`
- `Sem pixel`
- `Já prospectados`
- `Follow-up pendente`

### 13.4 Tabela

Colunas:

- empresa;
- cidade;
- categoria;
- score;
- prioridade;
- site;
- CMS;
- analytics;
- pixel;
- WhatsApp;
- formulário;
- nota;
- avaliações;
- status;
- última ação;
- próximo passo.

---

## 14. Aprendizado com prospecção

### 14.1 Dados a registrar

Após cada prospecção:

| Campo | Tipo |
|---|---|
| respondeu | boolean |
| marcou reunião | boolean |
| recebeu proposta | boolean |
| fechou | boolean |
| valor fechado | number |
| serviço vendido | string |
| motivo da perda | string |
| data do primeiro contato | date |
| data da resposta | date |
| data da reunião | date |
| data da proposta | date |
| data do fechamento/perda | date |
| canal | WhatsApp/e-mail/telefone |
| mensagem usada | string |

### 14.2 Uso inicial dos dados

No MVP, usar os dados para relatórios:

- taxa de resposta por score;
- taxa de reunião por prioridade;
- taxa de fechamento por categoria;
- ticket médio por categoria;
- melhores cidades;
- melhores dores;
- melhores mensagens.

### 14.3 Uso avançado

Na V2:

- ajustar pesos do score;
- sugerir melhor abordagem por segmento;
- detectar nichos com maior fechamento;
- reduzir score de padrões que não convertem;
- aumentar score de padrões que geram reunião;
- recomendar horário/canal.

---

## 15. Arquitetura proposta

### 15.1 Estrutura de arquivos

```text
lead-scoring/
  index.js
  prospecting-store.js
  site-crawler.js
  screenshot-service.js
  site-analyzer.js
  tech-detector.js
  scoring-engine.js
  ai-sales-analyzer.js
  learning-service.js
  export-service.js

renderer/
  lead-scoring.js
  lead-scoring.css
```

### 15.2 Integração com arquivos existentes

| Arquivo | Mudança planejada |
|---|---|
| `main.js` | novos IPC handlers para análise, listagem, filtros e feedback |
| `preload.js` | expor `leadScoringAPI` |
| `renderer/index.html` | nova aba e containers |
| `renderer/renderer.js` | roteamento da nova view |
| `renderer/styles.css` | ajustes base ou import do CSS novo |
| `scraper.js` | opção para enfileirar análise pós-coleta |
| `campaigns/campaign-store.js` | receber campos de score e mensagem sugerida |
| `utils/csv.js` | exportar campos de score |
| `utils/report.js` | resumo de qualidade comercial |

### 15.3 IPCs novos

```text
lead-scoring-analyze-lead
lead-scoring-analyze-batch
lead-scoring-cancel
lead-scoring-get-all
lead-scoring-get-lead
lead-scoring-update-outcome
lead-scoring-export
lead-scoring-get-settings
lead-scoring-update-settings
lead-scoring-open-screenshot
lead-scoring-create-campaign
```

### 15.4 API no preload

```js
contextBridge.exposeInMainWorld("leadScoringAPI", {
  analyzeLead: (lead) => ipcRenderer.invoke("lead-scoring-analyze-lead", { lead }),
  analyzeBatch: (leads, options) => ipcRenderer.invoke("lead-scoring-analyze-batch", { leads, options }),
  cancel: (jobId) => ipcRenderer.invoke("lead-scoring-cancel", { jobId }),
  getAll: (filters) => ipcRenderer.invoke("lead-scoring-get-all", { filters }),
  getLead: (id) => ipcRenderer.invoke("lead-scoring-get-lead", { id }),
  updateOutcome: (id, outcome) => ipcRenderer.invoke("lead-scoring-update-outcome", { id, outcome }),
  export: (filters, format) => ipcRenderer.invoke("lead-scoring-export", { filters, format }),
  getSettings: () => ipcRenderer.invoke("lead-scoring-get-settings"),
  updateSettings: (patch) => ipcRenderer.invoke("lead-scoring-update-settings", { patch }),
});
```

---

## 16. Modelo de dados

### 16.1 Lead enriquecido

```json
{
  "id": "lead_...",
  "source": "google_maps",
  "query": "",
  "company": {
    "name": "",
    "category": "",
    "address": "",
    "city": "",
    "state": "",
    "phone": "",
    "whatsapp": "",
    "email": "",
    "website": "",
    "instagram": "",
    "rating": 0,
    "reviewCount": 0,
    "openingHours": "",
    "latitude": "",
    "longitude": "",
    "googleMapsUrl": ""
  },
  "siteAnalysis": {},
  "screenshots": {},
  "score": {},
  "aiAnalysis": {},
  "prospecting": {},
  "createdAt": 0,
  "updatedAt": 0
}
```

### 16.2 Análise do site

```json
{
  "finalUrl": "",
  "domain": "",
  "hasHttps": true,
  "hasOwnDomain": true,
  "cms": "",
  "technologies": [],
  "frameworks": [],
  "tracking": {
    "googleAnalytics": false,
    "googleTagManager": false,
    "metaPixel": false,
    "googleAdsConversion": false,
    "tiktokPixel": false,
    "microsoftClarity": false,
    "hotjar": false,
    "linkedinInsight": false
  },
  "infrastructure": {
    "cloudflare": false,
    "cdn": false
  },
  "performance": {
    "loadTimeMs": 0,
    "pageSizeBytes": 0
  },
  "content": {
    "title": "",
    "description": "",
    "h1": "",
    "h2Count": 0,
    "hasOpenGraph": false,
    "hasSchema": false,
    "hasFavicon": false
  },
  "conversion": {
    "hasWhatsappButton": false,
    "hasClickablePhone": false,
    "hasForm": false,
    "hasOnlineChat": false,
    "ctaStrength": "low"
  },
  "seoBasics": {
    "hasSitemap": false,
    "hasRobotsTxt": false
  },
  "crawl": {
    "pagesFound": 0,
    "brokenLinks": [],
    "httpErrors": []
  },
  "mobile": {
    "isResponsive": true,
    "issues": []
  }
}
```

### 16.3 Score

```json
{
  "value": 82,
  "priority": "alta",
  "classification": "Alta prioridade",
  "worthProspecting": true,
  "components": {
    "commercialFit": 18,
    "digitalPain": 27,
    "contactability": 13,
    "conversionPotential": 17,
    "aiSignal": 7
  },
  "reasons": [
    "Boa reputação no Google",
    "Site com baixa força de CTA",
    "WhatsApp não está evidente no mobile"
  ]
}
```

### 16.4 Prospecção

```json
{
  "status": "not_contacted",
  "channel": "",
  "lastContactAt": null,
  "nextFollowUpAt": null,
  "responded": false,
  "meetingBooked": false,
  "proposalSent": false,
  "closed": false,
  "closedValue": 0,
  "serviceSold": "",
  "lostReason": "",
  "notes": ""
}
```

---

## 17. Configurações

### 17.1 Configurações de análise

- analisar automaticamente leads com site;
- analisar automaticamente leads sem site;
- máximo de páginas por domínio;
- timeout por página;
- salvar screenshots;
- reanalisar após X dias;
- ignorar domínios sociais;
- idioma das mensagens;
- tipo de oferta principal:
  - site institucional;
  - landing page;
  - sistema;
  - redesign;
  - tráfego + landing;
  - consultoria.

### 17.2 Configurações de IA

- provedor;
- chave API;
- modelo;
- usar imagem/screenshot quando suportado;
- limite diário de análises IA;
- modo econômico;
- modo detalhado;
- fallback sem IA.

### 17.3 Configurações comerciais

- nome do vendedor/agência;
- cidade base;
- assinatura;
- tom da mensagem:
  - direto;
  - consultivo;
  - informal;
  - premium;
- faixa de ticket desejada;
- serviços oferecidos;
- prova social do vendedor.

---

## 18. Integração com campanhas WhatsApp

### 18.1 Variáveis novas de template

Adicionar variáveis:

```text
{{score}}
{{prioridade}}
{{dor_principal}}
{{oportunidade_principal}}
{{argumento_principal}}
{{mensagem_whatsapp_ia}}
{{ticket_estimado}}
{{chance_resposta}}
{{site_final}}
{{cms}}
{{tem_whatsapp_site}}
{{tem_formulario}}
```

### 18.2 Criar campanha a partir da fila

Fluxo:

```text
Lead Scoring
-> filtra Alta prioridade
-> seleciona leads
-> Criar campanha WhatsApp
-> template sugerido já preenchido
-> usuário revisa
-> campanha fica pronta
```

### 18.3 Registro automático de resposta

Quando campanha receber resposta, vincular ao lead quando possível:

- por telefone;
- por campanha;
- por messageId;
- por leadId.

Esse evento atualiza:

- respondeu: true;
- data da resposta;
- tempo até resposta;
- status da prospecção.

---

## 19. Exportação

### 19.1 CSV/JSON

Adicionar exportação própria da fila:

- todos os campos básicos;
- score;
- prioridade;
- dores;
- oportunidades;
- mensagem WhatsApp;
- e-mail;
- status comercial.

### 19.2 Relatório por lead

Gerar relatório individual em Markdown/PDF em fase posterior:

- empresa;
- prints;
- diagnóstico comercial;
- oportunidades;
- sugestão de abordagem.

### 19.3 Relatório executivo

Resumo da busca:

- total analisado;
- altas prioridades;
- ticket estimado total;
- melhores categorias;
- melhores cidades;
- principais dores encontradas;
- primeiras ações recomendadas.

---

## 20. Segurança, privacidade e limites

### 20.1 Dados locais

Manter padrão do Sigma: dados salvos no computador do usuário.

### 20.2 Chaves de IA

Chaves devem:

- ficar em arquivo local com permissão restrita;
- nunca ir para exportação;
- nunca aparecer em logs;
- ser mascaradas na UI.

### 20.3 Screenshots

Screenshots podem conter dados públicos ou dados visíveis no site. Tratar como dado sensível local:

- permitir apagar cache;
- permitir desativar screenshot;
- limitar armazenamento.

### 20.4 Rate limits

Evitar análise agressiva:

- limitar concorrência;
- cooldown por domínio;
- retries limitados;
- botão cancelar.

### 20.5 WhatsApp

Manter aviso de uso responsável:

- mensagens personalizadas;
- intervalos realistas;
- evitar spam;
- usuário revisa antes de disparar.

---

## 21. Performance

### 21.1 Concorrência recomendada

MVP:

- 1 site por vez por padrão;
- opção avançada para 2-3 sites simultâneos;
- IA em fila separada.

### 21.2 Cache

Cache por domínio:

- não reanalisar mesmo site em menos de X dias;
- reusar screenshots recentes;
- reusar sitemap/robots;
- reusar tecnologias detectadas.

### 21.3 Cancelamento

Todo job deve ser cancelável:

- scraping;
- crawling;
- screenshot;
- IA;
- batch inteiro.

---

## 22. Estados e erros

### 22.1 Erros esperados

- site fora do ar;
- timeout;
- certificado inválido;
- bloqueio por Cloudflare;
- domínio redireciona para rede social;
- IA sem chave;
- IA retornou JSON inválido;
- screenshot falhou;
- crawler encontrou erro HTTP.

### 22.2 Como exibir erro

Erro deve ser útil:

```text
Não foi possível analisar o site. Motivo: timeout ao carregar a página inicial.
```

Não mostrar stack trace na UI.

### 22.3 Retentativa

Botões:

- `Tentar novamente`
- `Reanalisar sem screenshot`
- `Reanalisar sem IA`
- `Ignorar lead`

---

## 23. Roadmap de implementação

### Fase 0 - Preparação

Objetivo: preparar arquitetura sem mexer no fluxo principal.

Tarefas:

- criar documento de arquitetura;
- definir schema dos dados;
- criar store local;
- criar IDs estáveis para leads;
- definir IPCs;
- criar feature flag interna.

Critério de aceite:

- app continua abrindo;
- scraping atual continua igual;
- nenhum usuário é forçado a usar Lead Scoring.

### Fase 1 - Enriquecimento básico do lead

Objetivo: melhorar dados de empresa vindos do Maps.

Tarefas:

- normalizar cidade/estado;
- inferir WhatsApp;
- extrair horário de funcionamento;
- preservar query de origem;
- enriquecer lead com `leadId`;
- preparar exportação com campos novos.

Critério de aceite:

- lead comum continua exportável;
- campos novos aparecem quando disponíveis;
- sem quebra de compatibilidade.

### Fase 2 - Crawler e análise técnica

Objetivo: analisar site sem IA.

Tarefas:

- resolver URL final;
- detectar HTTPS/domínio próprio;
- coletar title/description/H1/H2;
- detectar forms, WhatsApp, telefone clicável;
- checar sitemap e robots;
- contar imagens/scripts/CSS;
- medir tempo de carregamento;
- detectar tecnologias principais;
- salvar resultado em store local.

Critério de aceite:

- usuário consegue clicar em `Analisar site`;
- resultado aparece sem IA;
- falhas são registradas por lead.

### Fase 3 - Screenshots

Objetivo: capturar prova visual.

Tarefas:

- screenshot desktop;
- screenshot mobile;
- armazenar caminhos;
- exibir na UI;
- criar limpeza de cache;
- adicionar opção para desativar screenshot.

Critério de aceite:

- cada lead analisado com site tem print desktop/mobile quando possível;
- UI mostra preview;
- arquivos podem ser apagados pelo app.

### Fase 4 - Score determinístico

Objetivo: priorizar leads sem depender de IA.

Tarefas:

- criar `scoring-engine.js`;
- implementar pesos;
- classificar score;
- gerar motivos do score;
- filtrar por score/prioridade;
- exportar score.

Critério de aceite:

- leads recebem score 0-100;
- filtros funcionam;
- score explica seus principais motivos.

### Fase 5 - IA comercial

Objetivo: gerar diagnóstico e abordagem.

Tarefas:

- criar configurações de IA;
- implementar cliente do provedor escolhido;
- enviar dados técnicos resumidos;
- enviar screenshot quando suportado;
- validar JSON;
- criar fallback;
- salvar resposta bruta e normalizada;
- exibir mensagens na UI.

Critério de aceite:

- IA retorna JSON válido;
- UI mostra resumo, dores, oportunidades e mensagens;
- sem chave de IA, app continua útil.

### Fase 6 - Dashboard Lead Scoring

Objetivo: transformar análises em operação comercial.

Tarefas:

- criar aba `Lead Scoring`;
- criar cards principais;
- criar tabela com filtros;
- criar segmentos prontos;
- criar tela de detalhe;
- criar ações de copiar mensagem;
- criar seleção em massa.

Critério de aceite:

- usuário consegue sair de uma busca para uma fila priorizada;
- alta prioridade aparece primeiro;
- mensagens ficam prontas para uso.

### Fase 7 - Integração com WhatsApp/campanhas

Objetivo: usar o score dentro do fluxo comercial existente.

Tarefas:

- criar campanha a partir da fila;
- preencher template com mensagem da IA;
- adicionar variáveis novas;
- registrar resposta recebida;
- atualizar status do lead.

Critério de aceite:

- usuário seleciona leads score alto e cria campanha;
- mensagem personalizada já vem preenchida;
- resposta atualiza lead quando possível.

### Fase 8 - Aprendizado e relatórios

Objetivo: usar resultados reais para melhorar decisões.

Tarefas:

- criar formulário de resultado;
- registrar reunião/proposta/fechamento/perda;
- criar métricas por score/categoria/cidade;
- criar insights de aprendizado;
- ajustar pesos manualmente;
- sugerir pesos com base em histórico.

Critério de aceite:

- usuário sabe quais scores convertem;
- dashboard mostra taxa de resposta/reunião/fechamento;
- histórico influencia recomendações futuras.

---

## 24. MVP recomendado

Para entregar valor rápido sem escopo gigante:

### Incluir no MVP

- aba Lead Scoring;
- análise manual de um lead;
- análise em lote de leads com site;
- crawler limitado;
- screenshot desktop/mobile;
- score determinístico;
- filtros por score/prioridade/cidade/categoria;
- IA opcional;
- mensagem WhatsApp gerada;
- e-mail gerado;
- exportação CSV/JSON com score;
- registro manual de resultado.

### Deixar para V2

- WHOIS/data do domínio;
- PDF individual;
- aprendizado automático avançado;
- modelo preditivo local;
- integração com CRM externo;
- análise de concorrentes;
- Lighthouse completo;
- validação real de formulário;
- crawler profundo;
- enriquecimento por APIs pagas.

---

## 25. Critérios de aceite globais

A feature está pronta quando:

- o fluxo principal do Sigma continua funcionando;
- usuário consegue coletar leads sem usar scoring;
- usuário consegue analisar leads com site;
- cada lead analisado tem score e prioridade;
- análise sem IA funciona;
- análise com IA gera JSON estruturado;
- screenshots desktop/mobile são salvos;
- dashboard permite filtrar oportunidades;
- mensagem WhatsApp e e-mail são gerados;
- fila prioriza melhores leads;
- resultados comerciais podem ser registrados;
- exportação inclui dados do score;
- erros são claros;
- jobs podem ser cancelados;
- dados ficam locais por padrão.

---

## 26. Testes necessários

### 26.1 Testes unitários

- normalização de lead;
- detecção de tecnologias;
- cálculo de score;
- classificação de prioridade;
- validação de JSON da IA;
- atualização de outcome;
- exportação.

### 26.2 Testes de integração

- analisar site real simples;
- analisar site com WordPress;
- analisar site sem HTTPS;
- analisar site com WhatsApp;
- analisar site sem site;
- crawler com timeout;
- screenshot desktop/mobile;
- campanha criada a partir de leads scoreados.

### 26.3 Testes manuais

- app abre;
- scraping normal funciona;
- filtros atuais funcionam;
- nova aba abre;
- análise individual funciona;
- análise em lote cancela;
- screenshot aparece;
- copiar mensagem funciona;
- exportar funciona;
- registrar fechamento atualiza dashboard.

---

## 27. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Escopo crescer demais | Alto | MVP bem fechado |
| IA retornar JSON ruim | Médio | validação e fallback |
| Crawler lento | Alto | limite de páginas e concorrência baixa |
| Screenshots ocuparem muito disco | Médio | cache limit e limpeza |
| Sites bloquearem crawler | Médio | registrar falha útil |
| Score ser injusto | Médio | explicar motivos e permitir ajuste |
| Usuário usar para spam | Alto | revisão manual, intervalos e avisos |
| Quebrar fluxo atual | Alto | feature isolada e opt-in |
| Dependência de provedor IA | Médio | modo sem IA |

---

## 28. Decisões abertas

- Qual provedor de IA será usado primeiro?
- A chave de IA será do usuário ou embutida em alguma versão?
- O app deve suportar múltiplos perfis comerciais?
- O score deve variar por serviço vendido?
- O usuário poderá editar pesos manualmente?
- Exportação PDF entra na V1 ou V2?
- Deve haver tela de revisão antes de criar campanha?
- Quanto tempo manter screenshots por padrão?
- SQLite entra agora ou só quando JSON ficar pesado?

---

## 29. Ordem sugerida para implementação

Ordem mais segura:

1. Store local e schema.
2. Enriquecimento de lead.
3. Crawler técnico.
4. Screenshot.
5. Score determinístico.
6. UI da aba Lead Scoring.
7. IA.
8. Integração com WhatsApp.
9. Registro de resultados.
10. Aprendizado.

Essa ordem evita travar a feature em IA e já entrega valor com dados técnicos + score.

---

## 30. Definição final da feature

Lead Scoring Inteligente será uma camada opcional do Sigma que transforma leads do Google Maps em oportunidades comerciais priorizadas para venda de sites, landing pages e sistemas.

Ela deve fazer três coisas muito bem:

1. **Encontrar oportunidade:** identificar empresas com dor digital real e chance de compra.
2. **Explicar a oportunidade:** mostrar por que vale prospectar e quais dores usar.
3. **Acelerar a abordagem:** gerar WhatsApp, e-mail, follow-up e objeções prontas.

O resultado final esperado é uma fila de prospecção onde o usuário não pergunta mais "quem eu chamo agora?", mas sim abre a tela e começa pelos leads com maior chance de virar conversa, reunião e venda.
