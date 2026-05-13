# 🎯 Sigma GMaps Scraper v2

**Transforme o Google Maps na sua máquina de prospecção.**

O Sigma GMaps Scraper extrai automaticamente milhares de leads qualificados do Google Maps e dispara campanhas de WhatsApp diretamente do seu desktop — sem APIs pagas, sem servidores, sem complicação.

---

## 🔥 Por que o Sigma?

Enquanto ferramentas concorrentes cobram centenas de reais por mês para raspar dados públicos do Google, o Sigma faz isso **de graça, offline e sem limites**. Você controla tudo do seu próprio computador.

| | Sigma GMaps Scraper | Ferramentas SaaS |
|---|---|---|
| Custo mensal | **Grátis** | R$ 200–600/mês |
| Limite de buscas | **Ilimitado** | Planos restritivos |
| Seus dados | **No seu PC** | No servidor deles |
| Envio WhatsApp | **Integrado e gratuito** | Não incluso ou pago à parte |

---

## 📦 O que vem no pacote

### 🔍 Raspagem Inteligente do Google Maps
- Busca por **nicho + bairro + cidade** com rolagem automática do feed
- Extrai dezenas de dados por estabelecimento: nome, telefone, site, rating, avaliações, endereço, coordenadas, fotos
- Visita o site de cada lead e extrai **e-mail e Instagram** automaticamente
- Suporte a buscas paralelas e variações de termos para máxima cobertura

### 📊 Dashboard & Exportação
- Dashboard em tempo real com total de leads, média de rating e categorias principais
- Fila de buscas com processamento sequencial — configure e deixe rodando
- Filtros por categoria e atributos (tem telefone, site, Instagram, e-mail)
- Exportação em **CSV** e **JSON** com um clique
- Log estilo terminal para acompanhar cada etapa

### 💬 Sistema de Campanhas WhatsApp
- **Conexão via WhatsApp Web** (biblioteca Baileys) — escaneie o QR Code e pronto
- **Templates personalizados** — use `{{nome}}`, `{{empresa}}`, `{{telefone}}` para mensagens automáticas
- **Campanhas programadas** — defina intervalo entre disparos, pause e retome quando quiser
- **Monitoramento em tempo real** — acompanhe status de cada mensagem (enviada, falha, pendente)
- **Auto-reconexão** — se a conexão cair, o Sigma reconecta sozinho e continua de onde parou

### 🌎 Interface Profissional
- Tema escuro com sidebar, cards de estatísticas e tabela de dados
- **Multilíngue** — português, inglês e espanhol
- Personalização da janela com arraste, botões customizados e ícone próprio
- Notificações toast para ações importantes

---

## ⚙️ Requisitos Mínimos

| Componente | Mínimo |
|---|---|
| Sistema Operacional | Windows 10/11 (64-bit) ou Linux (64-bit) |
| RAM | 4 GB (Chromium usa ~500 MB por instância) |
| Espaço em disco | 500 MB livres |
| Internet | Conexão estável (banda larga) |
| Node.js | **Não necessário** — o app é portátil |

> 💡 O app é **totalmente portátil** no Windows. Baixe, execute, use. Sem instalação.

---

## 📏 Tamanho Estimado

| Plataforma | Download | Instalado |
|---|---|---|
| Windows (.exe portátil) | ~157 MB (ZIP) | ~500 MB |
| Linux (tar.gz) | ~114 MB | ~450 MB |

O tamanho é maior porque o app empacota um navegador **Chromium completo** (via Electron + Playwright) para realizar a raspagem de forma headless e confiável.

---

## 🚀 Instalação

### Windows

1. Baixe o arquivo `Sigma-GMaps-Scraper-Windows-x64.zip` da [página de releases](https://github.com/olucianobotelho/google-maps-sigma-scrapper/releases)
2. Extraia o ZIP em qualquer pasta
3. Execute `Sigma GMaps Scraper.exe`

> ⚠️ **Primeira execução:** O Windows SmartScreen pode bloquear o app por não ter assinatura digital (que custa ~R$ 2.000/ano). Clique em **"Mais informações" → "Executar mesmo assim"**. Após a primeira execução esse aviso não aparece mais.

### Linux

1. Baixe `sigma-gmaps-scraper-1.0.0.tar.gz` ou `Sigma-GMaps-Scraper-Linux-x64.zip`
2. Extraia:
   ```bash
   tar -xzf sigma-gmaps-scraper-1.0.0.tar.gz
   ```
3. Execute:
   ```bash
   ./sigma-gmaps-scraper
   ```

---

## 🎮 Guia Rápido

### 1. Raspagem de Leads

1. Abra o Sigma e vá para a aba **Extração**
2. Preencha os campos:
   - **Nicho** — ex: `restaurantes`, `clínicas`, `mecânicos`
   - **Bairro** — ex: `Centro`, `Moema`
   - **Cidade** — ex: `São Paulo`, `Rio de Janeiro`
3. Defina o **número máximo de resultados** (recomendado: 20–50)
4. Clique em **Adicionar à Fila** para múltiplas buscas
5. Clique em **Iniciar Extração** e acompanhe no terminal
6. Ao finalizar, exporte como **CSV** ou **JSON**

### 2. Campanha WhatsApp

1. Vá para a aba **WhatsApp** e clique em **Conectar**
2. Escaneie o QR Code com seu WhatsApp
3. Vá para **Campanhas** → **Nova Campanha**
4. Selecione os leads da extração
5. Escreva a mensagem usando templates:
   ```
   Olá {{nome}}! Vi que sua empresa {{empresa}} está no Google Maps.
   Gostaria de oferecer nossos serviços para o telefone {{telefone}}.
   ```
6. Configure o **intervalo entre disparos** (recomendado: 30–60 segundos)
7. Clique em **Iniciar Campanha** e monitore o progresso

> ⚠️ Use com responsabilidade. O WhatsApp pode banir contas que enviam spam. Mantenha intervalos realistas e mensagens personalizadas.

### 3. Templates de Mensagem

| Variável | Substituição |
|---|---|
| `{{nome}}` | Nome do estabelecimento |
| `{{empresa}}` | Nome do estabelecimento (alias) |
| `{{telefone}}` | Telefone formatado |
| `{{site}}` | Website |
| `{{endereco}}` | Endereço completo |
| `{{categoria}}` | Categoria do estabelecimento |
| `{{rating}}` | Nota (1–5) |
| `{{avaliacoes}}` | Número de avaliações |

---

## 📋 Dados Extraídos

| Campo | Descrição | Exemplo |
|---|---|---|
| Nome | Nome do estabelecimento | `Restaurante Sabor & Arte` |
| Endereço | Endereço completo | `Rua Augusta, 1500 - Consolação` |
| Telefone | Número de telefone | `(11) 3124-5678` |
| Website | Site do estabelecimento | `https://saborarte.com.br` |
| E-mail | Extraído do site | `contato@saborarte.com.br` |
| Instagram | Perfil extraído do site | `@saborarte` |
| Rating | Nota de 1 a 5 estrelas | `4.7` |
| Avaliações | Total de avaliações | `342` |
| Categoria | Categoria principal | `Restaurante` |
| Coordenadas | Latitude e longitude | `-23.5505, -46.6333` |
| Fotos | URLs das fotos do Google Maps | — |

---

## 🆕 O que mudou da V1 para a V2

| Recurso | V1 | V2 |
|---|---|---|
| **WhatsApp** | ❌ | ✅ Sistema completo de campanhas |
| **Templates** | ❌ | ✅ Mensagens personalizadas com variáveis |
| **Fila de buscas** | ❌ | ✅ Múltiplas consultas sequenciais |
| **Dashboard** | ❌ | ✅ Estatísticas em tempo real |
| **Filtros** | ❌ | ✅ Filtrar por atributos e categorias |
| **i18n** | ❌ | ✅ PT-BR, EN, ES |
| **CSS Tema Escuro** | Básico | ✅ Tema profissional completo |
| **Linux** | ❌ | ✅ Binário nativo (.tar.gz) |
| **E-mail / Instagram** | Básico | ✅ Extração otimizada do site |
| **Janela customizada** | Padrão | ✅ Frame customizado, ícone, arraste |
| **Notificações** | ❌ | ✅ Toast notifications |
| **Monitoramento campanhas** | ❌ | ✅ Status em tempo real |
| **Auto-reconexão** | ❌ | ✅ WhatsApp reconecta automaticamente |

---

## 🛠 Para Desenvolvedores

```bash
git clone https://github.com/olucianobotelho/google-maps-sigma-scrapper.git
cd sigma-gmaps-scraper
npm install
npm start          # modo desenvolvimento (Electron GUI)
node index.js      # modo CLI standalone
```

### Build

```bash
npm run build:portable   # Windows (.exe portátil)
npm run build:linux      # Linux (tar.gz)
```

### Stack

- **Electron** 38 — janela desktop nativa
- **Playwright** — automação Chromium headless
- **Baileys** (WhiskeySockets) — WhatsApp Web client
- **QRCode** — geração de QR para auth WhatsApp
- **ffmpeg-static** — processamento de mídia WhatsApp

---

## 📄 Licença

MIT License — © 2025 Luciano Botelho

---

**Feito para vendedores, empreendedores e profissionais que querem leads — não desculpas.**
