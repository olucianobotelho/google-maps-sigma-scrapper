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

test("getChats hides timestamp-only contact records", () => {
  const provider = makeProvider();
  provider._chats["558888888888@s.whatsapp.net"] = {
    jid: "558888888888@s.whatsapp.net",
    name: "Contato salvo",
    lastMessage: "",
    unread: 0,
    timestamp: 1770000000,
    pinned: 0,
    archived: false,
    isGroup: false,
  };

  assert.deepEqual(provider.getChats(), []);
});

test("getMessages merges phone and alias jids", () => {
  const provider = makeProvider();
  const phone = "5511999999999@s.whatsapp.net";
  const lid = "123456789012345@lid";
  provider._registerAlias(phone, lid);
  provider._messages[phone] = [
    {
      key: { id: "a1", remoteJid: phone, fromMe: true },
      message: { conversation: "Oi campanha" },
      messageTimestamp: 100,
    },
  ];
  provider._messages[lid] = [
    {
      key: { id: "b1", remoteJid: lid, fromMe: false },
      message: { conversation: "Resposta" },
      messageTimestamp: 200,
    },
  ];
  const msgs = provider.getMessages(phone);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].key.id, "a1");
  assert.equal(msgs[1].key.id, "b1");
});

test("recordOutgoing requires message id and marks fromMe", () => {
  const provider = makeProvider();
  const jid = "5511888888888@s.whatsapp.net";
  provider._recordOutgoing(jid, { key: { id: "out-1", remoteJid: jid } }, { text: "Teste envio" });
  const chats = provider.getChats();
  assert.equal(chats.length, 1);
  assert.match(chats[0].lastMessage, /Teste envio/);
  const msgs = provider.getMessages(jid);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].key.fromMe, true);
  assert.equal(msgs[0].message.conversation, "Teste envio");
});

test("getChats keeps conversations with real messages and unread counts", () => {
  const provider = makeProvider();
  const jid = "559999999999@s.whatsapp.net";
  provider._messages[jid] = [
    {
      key: { id: "msg-1", remoteJid: jid, fromMe: false },
      message: { conversation: "Oi" },
      messageTimestamp: 1770000000,
    },
  ];
  provider._chats[jid] = {
    jid,
    name: "Cliente",
    lastMessage: "Oi",
    unread: 3,
    timestamp: 1770000000,
    pinned: 0,
    archived: false,
    isGroup: false,
  };

  const [chat] = provider.getChats();
  assert.equal(chat.jid, jid);
  assert.equal(chat.unread, 3);
  assert.equal(chat.messageCount, 1);
});

test("getMediaCacheRoot and sticker root are exposed", () => {
  const provider = makeProvider();
  assert.ok(provider.getMediaCacheRoot());
  assert.ok(provider.getStickerCacheRoot());
  assert.match(provider.getMediaCacheRoot(), /whatsapp-media-cache/);
  assert.match(provider.getStickerCacheRoot(), /whatsapp-stickers/);
});

test("media meta detects stickers and unwraps ephemeral wrappers", () => {
  const provider = makeProvider();
  const stickerMsg = {
    message: {
      stickerMessage: { mimetype: "image/webp" },
    },
  };
  const meta = provider._getMessageMediaMeta(stickerMsg);
  assert.equal(meta.kind, "sticker");
  assert.equal(meta.mimetype, "image/webp");

  const ephemeral = {
    message: {
      ephemeralMessage: {
        message: {
          imageMessage: { mimetype: "image/jpeg", caption: "foto" },
        },
      },
    },
  };
  const imgMeta = provider._getMessageMediaMeta(ephemeral);
  assert.equal(imgMeta.kind, "image");
  assert.equal(provider._getMessageText(ephemeral), "foto");
});

test("getChats separates groups and unread for list filters", () => {
  const provider = makeProvider();
  const person = "551111111111@s.whatsapp.net";
  const group = "120363@g.us";

  provider._messages[person] = [
    {
      key: { id: "p1", remoteJid: person, fromMe: false },
      message: { conversation: "Oi" },
      messageTimestamp: 1770000001,
    },
  ];
  provider._messages[group] = [
    {
      key: { id: "g1", remoteJid: group, fromMe: false },
      message: { conversation: "Pessoal" },
      messageTimestamp: 1770000002,
    },
  ];
  provider._chats[person] = {
    jid: person,
    name: "Cliente",
    lastMessage: "Oi",
    unread: 2,
    timestamp: 1770000001,
    pinned: 0,
    archived: false,
    isGroup: false,
  };
  provider._chats[group] = {
    jid: group,
    name: "Equipe",
    lastMessage: "Pessoal",
    unread: 0,
    timestamp: 1770000002,
    pinned: 0,
    archived: false,
    isGroup: true,
  };

  const chats = provider.getChats();
  assert.equal(chats.length, 2);
  assert.equal(chats.filter((c) => c.isGroup).length, 1);
  assert.equal(chats.filter((c) => c.unread > 0).length, 1);
});
