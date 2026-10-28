const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BaileysProvider } = require("../whatsapp/baileys-provider");

function makeProvider() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigma-wa-test-"));
  return new BaileysProvider({}, () => {}, () => {}, dir);
}

const jid = "5511999999999@s.whatsapp.net";
const key = { remoteJid: jid, fromMe: true, id: "AUDIO1" };

function serverEcho() {
  return {
    key,
    messageTimestamp: 1000,
    message: {
      audioMessage: {
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
        url: "https://mmg.whatsapp.net/x",
        directPath: "/x",
        mediaKey: Buffer.alloc(32, 1),
      },
    },
  };
}

function localRecord(provider) {
  return {
    key,
    messageTimestamp: 1001,
    status: 1,
    message: provider._buildOutgoingMessagePayload({
      audio: Buffer.alloc(100),
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    }),
  };
}

test("registro local de envio não apaga a mediaKey do eco do servidor", () => {
  const provider = makeProvider();
  provider._addMessage(jid, serverEcho());
  provider._addMessage(jid, localRecord(provider));

  const [stored] = provider._messages[jid];
  assert.ok(stored.message.audioMessage.mediaKey);
  assert.equal(stored.message.audioMessage.directPath, "/x");
  assert.equal(stored.status, 1);
});

test("eco do servidor substitui o registro local sem mediaKey", () => {
  const provider = makeProvider();
  provider._addMessage(jid, localRecord(provider));
  provider._addMessage(jid, serverEcho());

  assert.ok(provider._messages[jid][0].message.audioMessage.mediaKey);
});

test("getMessage do retry devolve só o conteúdo (proto.IMessage)", () => {
  const provider = makeProvider();
  provider._addMessage(jid, serverEcho());

  const content = provider._getMessageForRetry(key);
  assert.ok(content.audioMessage);
  assert.equal(content.key, undefined);
});

test("retry não reenvia mídia sem mediaKey", () => {
  const provider = makeProvider();
  provider._addMessage(jid, localRecord(provider));

  assert.equal(provider._getMessageForRetry(key), undefined);
});

test("retry encontra a mensagem pelo alias LID", () => {
  const provider = makeProvider();
  const lid = "123456789012345@lid";
  provider._registerAlias(jid, lid);
  provider._addMessage(jid, serverEcho());

  assert.ok(provider._getMessageForRetry({ ...key, remoteJid: lid })?.audioMessage);
});

test("retry de texto continua funcionando", () => {
  const provider = makeProvider();
  provider._addMessage(jid, { key: { ...key, id: "T1" }, message: { conversation: "oi" }, messageTimestamp: 1 });

  assert.deepEqual(provider._getMessageForRetry({ ...key, id: "T1" }), { conversation: "oi" });
});

test("log do Baileys vai para arquivo em nível warn", async () => {
  const provider = makeProvider();
  const logger = provider._createBaileysLogger();
  assert.equal(logger.level, "warn");
  logger.warn({ host: "mmg.whatsapp.net" }, "Error in uploading");
  logger.info("não deve aparecer");
  logger.flush();
  await new Promise((r) => setTimeout(r, 100));
  const text = fs.readFileSync(provider._logPath, "utf8");
  assert.match(text, /Error in uploading/);
  assert.doesNotMatch(text, /não deve aparecer/);
});
