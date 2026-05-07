# Sigma GMaps Scraper

**Ferramenta desktop de prospecção de leads via Google Maps** — desenvolvida em **Electron + Playwright**. Extrai dados de estabelecimentos (nome, endereço, telefone, site, Instagram, e-mail, rating, avaliações, categorias, coordenadas) e exporta em **CSV** ou **JSON**.

---

## 👤 Desenvolvido por

**Luciano Botelho**

---

## ⚠️ Aviso de Segurança do Windows (SmartScreen)

Este aplicativo **não possui assinatura digital da Microsoft**. Isso acontece porque a assinatura de código (code signing certificate) exige o pagamento de uma licença anual à Microsoft, que **não foi adquirida**.

Ao executar o `.exe` pela primeira vez, o Windows Defender SmartScreen exibirá uma mensagem como:

> "O Windows protegeu o seu computador. O Microsoft Defender SmartScreen impediu a inicialização de um aplicativo não reconhecido."

**Isso não significa que o app contém vírus** — significa apenas que ele não foi assinado digitalmente por uma autoridade reconhecida pela Microsoft.

### Como executar mesmo assim:

1. Clique em **"Mais informações"** (ou "More info") na tela de bloqueio
2. Clique em **"Executar mesmo assim"** (ou "Run anyway")
3. O aplicativo abrirá normalmente a partir da segunda execução

> 💡 Após a primeira execução bem-sucedida, o Windows não exibirá mais esse aviso para este arquivo.

---

## 🎯 O que faz

O Sigma GMaps Scraper automatiza a extração de dados do Google Maps através de uma interface desktop com tema escuro. Permite buscar estabelecimentos por palavra-chave + bairro + cidade, raspar páginas de detalhes e gerar arquivos de exportação.

**Funcionalidades principais:**
- Raspagem de dados via navegador Chromium integrado (Playwright)
- Fila de buscas — adicione múltiplas consultas e processe em sequência
- Log em tempo real no estilo terminal
- Dashboard com total de resultados, média de rating e categorias principais
- Exportação CSV e JSON
- Filtros por categoria e atributos (tem telefone, site, Instagram, e-mail)
- Suporte a PT-BR, EN e ES

**Dados extraídos por estabelecimento:**

| Campo | Descrição |
|-------|-----------|
| Nome | Nome do estabelecimento |
| Endereço | Endereço completo |
| Telefone | Número de telefone |
| Site | Website do estabelecimento |
| Instagram | Perfil do Instagram (extraído do site) |
| E-mail | E-mail (extraído do site do estabelecimento) |
| Rating | Nota de 1 a 5 estrelas |
| Avaliações | Número total de avaliações |
| Categoria | Categoria do estabelecimento |
| Coordenadas | Latitude e longitude |
| Fotos | URLs das fotos do Google Maps |

---

## 📂 Estrutura do Projeto

```
sigma-gmaps-scraper/
├── main.js                  # Processo principal do Electron — janela, IPC, arquivos
├── preload.js               # Context bridge — APIs seguras para o renderer
├── scraper.js               # Motor de raspagem — Playwright (Chromium)
├── config.js                # Configurações (timeout, concorrência, etc.)
├── index.js                 # Modo CLI standalone (dev/testes)
├── utils/
│   ├── autoScroll.js        # Scroll do feed de resultados
│   ├── businessData.js      # Extração de dados da página de detalhes
│   ├── csv.js               # Exportador CSV
│   ├── report.js            # Relatório de qualidade dos dados (.txt)
│   └── stats.js             # Calculadora de percentuais
├── renderer/
│   ├── index.html           # Interface gráfica completa
│   ├── renderer.js          # Lógica do frontend — fila, dashboard, i18n
│   └── sigma-logo.png       # Logo do app
├── assets/
│   └── icon.ico             # Ícone do app para Windows
└── dist/                    # Build gerado (após npm run build)
    └── Sigma-Prospeccao.exe # Executável portátil para Windows
```

---

## ⚙️ Requisitos (para desenvolvedores)

- **Node.js** v18+
- **npm**
- Windows (o build é configurado para Windows portable)
- Conexão com internet

---

## 🛠 Setup de Desenvolvimento

```bash
git clone https://github.com/olucianobotelho/google-maps-sigma-scrapper.git
cd sigma-gmaps-scraper
npm install
```

### Rodar em Desenvolvimento

```bash
# App Electron (GUI)
npm start

# Modo CLI (sem interface gráfica)
node index.js
```

### Gerar Executável

```bash
npm run build
```

O `.exe` portátil será gerado em `dist/Sigma-Prospeccao.exe`.

---

## 🎮 Guia de Uso

1. Execute o `Sigma-Prospeccao.exe` (ignore o aviso do SmartScreen na primeira vez)
2. Preencha os campos: **Nicho** + **Bairro** + **Cidade**
3. Defina o número máximo de resultados
4. Clique em **Iniciar Extração** ou **Adicionar à Fila** para processar depois
5. Acompanhe o progresso no terminal integrado
6. Ao finalizar, exporte como **JSON** ou **CSV**

---

## 📄 Licença

MIT License — © 2025 Luciano Botelho
