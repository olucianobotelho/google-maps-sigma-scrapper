# Sigma GMaps Scraper

Extraia leads do Google Maps, visualize no mapa, analise oportunidades e dispare campanhas no WhatsApp — tudo no desktop, sem mensalidade.

## Baixar e instalar (Windows)

1. Baixe o instalador em **[Releases](../../releases)** — arquivo `Sigma-GMaps-Scraper-Setup-*.exe`.
2. Execute o instalador e siga os passos (atalho na Área de Trabalho).
3. Abra o app e clique em **Nova Extração** para começar.

> Atualizações são automáticas: quando sair versão nova, o app baixa e pede para reiniciar.

Sem instalador? Baixe o `Sigma-GMaps-Scraper-*.zip` (portable) e execute `Sigma GMaps Scraper.exe`.

## O que o app faz

- **Scraper Google Maps** — busca por nicho + bairro/cidade, paginação automática, extrai nome, categoria, telefone, site, Instagram, e-mail (via site), avaliação e fotos.
- **Mapa interativo** — pins no lugar certo (coordenada exata do POI), 4 camadas gratuitas (OSM/Esri, sem API key), badges de precisão.
- **Lead Scoring** — analisa o site da empresa (pixel, HTTPS, mobile, WhatsApp) e prioriza quem vale ligar primeiro, com opção de IA gratuita (OpenRouter/OpenCode).
- **WhatsApp** — conecta múltiplos números via QR, chats, etiquetas, gatilhos de áudio e campanhas com agendamento e cota diária anti-ban.
- **Dashboard** — métricas por categoria, exportação CSV/XLSX.

## Executar localmente (desenvolvimento)

```bash
npm install
npm start          # builda o renderer e abre o Electron
# ou
npm run dev:renderer  # só o front em http://localhost:5173
```

Outros comandos:

```bash
npm test              # testes (Node --test)
npm run build:renderer
npm run build:win     # gera instalador NSIS + ZIP em dist/
```

## Requisitos

- Windows 10/11 (64-bit), Node 20+ para desenvolvimento.

## Suporte e comunidade

- Siga no X: **[@luker2o](https://x.com/luker2o)**
- Dúvidas ou bugs? Abra uma **[Issue](../../issues)**.

## Licença

MIT
