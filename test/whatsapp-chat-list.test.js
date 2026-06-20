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
