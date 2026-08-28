const fs = require('fs');
const p = 'renderer/src/components/WhatsAppPanel.jsx';
let s = fs.readFileSync(p, 'utf8');
const startMark = '                  {/* Trigger bar: quick snippets + media */}';
const endMark = '                  {/* Message Input Bar */}';
const start = s.indexOf(startMark);
const end = s.indexOf(endMark);
if (start < 0 || end < 0) {
  console.error('markers', start, end);
  process.exit(1);
}
const replacement = `                  {/* Trigger bar compacta + modal de gestão */}
                  <div className="chat-trigger-bar">
                    <button
                      type="button"
                      className={\`chat-trigger-toggle \${showTriggers ? 'act' : ''}\`}
                      onClick={() => setShowTriggers((v) => !v)}
                      title="Atalhos de gatilhos"
                    >
                      <Zap size={14} />
                      <span style={{ fontSize: '11px' }}>Gatilhos</span>
                    </button>
                    <div className="chat-trigger-chips">
                      {triggerSnippets.slice(0, 6).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={\`chat-trigger-chip \${s.kind === 'audio' || s.filePath ? 'audio' : ''}\`}
                          disabled={sendingHumanized || sendingAudio || !activeChatJid}
                          onClick={() => handleSendTrigger(s)}
                          title={s.kind === 'audio' || s.filePath ? 'Enviar áudio como voz' : s.text}
                        >
                          {(s.kind === 'audio' || s.filePath) ? <Mic size={12} /> : null}
                          {' '}{s.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: 11, flexShrink: 0 }}
                      onClick={() => setShowTriggersModal(true)}
                      title="Gerenciar gatilhos"
                    >
                      Gerenciar
                    </button>
                  </div>

                  {showTriggers && (
                    <div className="chat-trigger-panel chat-trigger-panel-compact">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Toque para enviar · Gerenciar para criar/editar</span>
                        <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setShowTriggersModal(true)}>
                          <PlusCircle size={12} /> Novo / editar
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {snippets.length === 0 ? (
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Nenhum gatilho. Clique em Gerenciar.</span>
                        ) : snippets.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={\`chat-trigger-chip \${s.kind === 'audio' || s.filePath ? 'audio' : ''}\`}
                            disabled={sendingHumanized || sendingAudio || !activeChatJid}
                            onClick={() => handleSendTrigger(s)}
                          >
                            {(s.kind === 'audio' || s.filePath) ? <Mic size={12} /> : null} {s.label}
                          </button>
                        ))}
                      </div>
                      {(sendingHumanized || sendingAudio) && (
                        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--accent)' }}>Enviando…</p>
                      )}
                    </div>
                  )}

`;
s = s.slice(0, start) + replacement + s.slice(end);
s = s.replace("onClick={() => startVoiceRecording('send')}", 'onClick={() => startVoiceRecording()}');

// Simplify recording bar ternary if both branches exist
const complex = s.match(/\{isRecording && recordingPurposeRef\.current === 'send' \? \([\s\S]*?\) : isRecording && recordingPurposeRef\.current === 'trigger' \? \([\s\S]*?\) : \(/);
if (complex) {
  s = s.replace(
    /\{isRecording && recordingPurposeRef\.current === 'send' \? \([\s\S]*?\) : isRecording && recordingPurposeRef\.current === 'trigger' \? \([\s\S]*?\) : \(/,
    `{isRecording ? (
                      <div className="chat-recording-bar">
                        <span className="chat-recording-dot" />
                        <span>Gravando {formatAudioSeconds(Math.round(recordingMs / 1000))}…</span>
                        <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={cancelVoiceRecording}>
                          Cancelar
                        </button>
                        <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={stopVoiceRecordingAndSend}>
                          Enviar áudio
                        </button>
                      </div>
                    ) : (`
  );
}

if (!s.includes('<TriggersManagerModal')) {
  s = s.replace(
    '{lightbox && (',
    `<TriggersManagerModal
              open={showTriggersModal}
              onClose={() => setShowTriggersModal(false)}
              snippets={snippets}
              setSnippets={setSnippets}
              addLog={addLog}
            />

            {lightbox && (`
  );
}

fs.writeFileSync(p, s);
console.log('patched triggers UI');
