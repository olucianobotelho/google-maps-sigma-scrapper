/**
 * Smoke test: abre a UI, força a aba de scoring e captura erros de console.
 */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const errors = [];
const logs = [];

// Isolated renderer harness: mock only the read IPC surface used during boot.
// This keeps the smoke deterministic and never touches the user's WhatsApp/session data.
const readMocks = {
  "whatsapp-status": () => ({ status: "disconnected", connectionId: "e2e-fake" }),
  "lead-scoring-get-all": () => ({ success: true, leads: [], total: 0 }),
  "lead-scoring-list-groups": () => ({ success: true, groups: [] }),
  "lead-scoring-get-settings": () => ({ success: true, settings: {} }),
};
for (const [channel, handler] of Object.entries(readMocks)) {
  try { ipcMain.removeHandler(channel); } catch {}
  ipcMain.handle(channel, handler);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on("console-message", (event, level, message) => {
    const line = `[${level}] ${message}`;
    logs.push(line);
    if (level >= 2 && !/Electron Security Warning/i.test(message) || /error|Error|too many|Minified React/i.test(message)) {
      errors.push(line);
    }
  });

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    errors.push(`FAIL_LOAD ${code} ${desc} ${url}`);
  });

  const indexHtml = path.join(__dirname, "..", "renderer", "dist", "index.html");
  await win.loadURL(pathToFileURL(indexHtml).href);

  // Espera React montar
  await new Promise((r) => setTimeout(r, 1500));

  // Força navegação para scoring via DOM
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const out = { clicks: [], text: '', error: null };
      try {
        // clica no item do menu que contenha "ligar" ou "scoring"
        const items = [...document.querySelectorAll('#sideNav .ni, .ni, [class*="ni"]')];
        out.navCount = items.length;
        const scoring = items.find((el) => /ligar|scoring|score/i.test(el.textContent || ''));
        if (scoring) {
          scoring.click();
          out.clicks.push('scoring');
          await new Promise((r) => setTimeout(r, 1200));
        }
        out.text = (document.body && document.body.innerText || '').slice(0, 800);
        out.hasReactError = /Algo deu errado no React|Minified React|Too many re-renders|Objects are not valid/i.test(out.text);
        out.htmlSnippet = (document.getElementById('root')?.innerHTML || '').slice(0, 400);
      } catch (e) {
        out.error = String(e && e.stack || e);
      }
      return out;
    })()
  `);

  console.log(JSON.stringify({ result, errors, logs: logs.slice(-30) }, null, 2));
  app.exit(errors.length || result?.hasReactError ? 1 : 0);
});

app.on("window-all-closed", () => app.quit());
