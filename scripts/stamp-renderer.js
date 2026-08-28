/**
 * Pós-build: carimba o index.html com versão única e cache-bust nos assets.
 * Assim o Electron nunca reutiliza index-BC5opcok.js antigo.
 */
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "renderer", "dist");
const indexPath = path.join(distDir, "index.html");
const stamp = `ui-${Date.now().toString(36)}`;

if (!fs.existsSync(indexPath)) {
  console.error("[stamp-renderer] index.html não encontrado:", indexPath);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, "utf8");

// Remove carimbos anteriores (re-run seguro)
html = html.replace(/\?v=ui-[a-z0-9]+/gi, "");
html = html.replace(/ · ui-[a-z0-9]+/gi, "");
html = html.replace(/\s*<meta name="sigma-ui-build"[^>]*>/gi, "");
html = html.replace(/\s*<style>\s*#sigma-build-banner[\s\S]*?<\/style>/gi, "");
html = html.replace(/\s*<div id="sigma-build-banner">[\s\S]*?<\/div>/gi, "");
html = html.replace(/\s*<script>\s*setTimeout\(function \(\) \{[\s\S]*?\[SIGMA\] scripts[\s\S]*?<\/script>/gi, "");

// cache-bust em scripts e css
html = html.replace(
  /(src|href)="(\.\/assets\/[^"?]+)(?:\?[^"]*)?"/g,
  (_, attr, asset) => `${attr}="${asset}?v=${stamp}"`,
);

// título visível
html = html.replace(
  /<title>([^<]*)<\/title>/i,
  `<title>Sigma Control Center · ${stamp}</title>`,
);

const injectHead = `
  <meta name="sigma-ui-build" content="${stamp}">
  <style>
    #sigma-build-banner{
      position:fixed;bottom:8px;right:8px;z-index:99999;
      background:#6c5ce7;color:#fff;font:600 11px/1.2 system-ui,sans-serif;
      padding:6px 10px;border-radius:999px;opacity:.92;
      pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.35);
    }
  </style>
`;
html = html.replace("</head>", `${injectHead}</head>`);

html = html.replace(
  /<div id="root"><\/div>/,
  `<div id="root"></div>
  <div id="sigma-build-banner">${stamp}</div>
  <script>
    // Banner fica 60s para o user confirmar a build (não some em 12s)
    setTimeout(function () {
      var el = document.getElementById('sigma-build-banner');
      if (el) el.remove();
    }, 60000);
    console.info('[SIGMA] HTML build ${stamp}');
    console.info('[SIGMA] scripts', [...document.scripts].map(function (s) { return s.src; }));
    // Se algum script antigo aparecer na página, avisa forte
    try {
      var bad = [...document.scripts].some(function (s) {
        return /7F4QwPd2|ui-mrfg9u99|BC5opcok|rad4ZrnG|CaedZwU-|Dj5wJ2qb/i.test(s.src || '');
      });
      if (bad) {
        console.error('[SIGMA] SCRIPT ANTIGO DETECTADO — feche o app e rode npm start');
        document.title = 'UI ANTIGA — reinicie o app';
      }
    } catch (e) {}
  </script>`,
);

fs.writeFileSync(indexPath, html, "utf8");
console.log("[stamp-renderer] carimbado:", stamp);
console.log("[stamp-renderer]", indexPath);
