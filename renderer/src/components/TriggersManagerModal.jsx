import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Mic,
  Type,
  Paperclip,
  Pencil,
  Trash2,
  PlusCircle,
  Check,
  Play,
} from 'lucide-react';

function formatSec(s) {
  const v = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(v / 60);
  const sec = v % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const u8 = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Modal passo a passo para gerenciar gatilhos de texto e áudio.
 */
export default function TriggersManagerModal({
  open,
  onClose,
  snippets,
  setSnippets,
  addLog,
}) {
  // list | type | content | done
  const [step, setStep] = useState('list');
  const [editId, setEditId] = useState(null); // null = novo
  const [kind, setKind] = useState('text'); // text | audio
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  /** Segundos de “digitando/gravando” antes de enviar. Vazio = automático */
  const [delaySec, setDelaySec] = useState('');
  const [audioMeta, setAudioMeta] = useState(null); // { filePath, durationSec, mimetype, previewUrl }
  const [busy, setBusy] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setStep('list');
    setEditId(null);
    setError('');
    setBusy(false);
    stopRecCleanup();
  }, [open]);

  useEffect(() => () => stopRecCleanup(), []);

  const stopRecCleanup = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch { /* ignore */ }
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
    setRecordingMs(0);
  };

  const resetForm = () => {
    setEditId(null);
    setKind('text');
    setLabel('');
    setText('');
    setDelaySec('');
    if (audioMeta?.previewUrl) {
      try { URL.revokeObjectURL(audioMeta.previewUrl); } catch { /* ignore */ }
    }
    setAudioMeta(null);
    setError('');
    stopRecCleanup();
  };

  const startCreate = () => {
    resetForm();
    setStep('type');
  };

  const startEdit = (s) => {
    resetForm();
    setEditId(s.id);
    setKind(s.kind === 'audio' || s.filePath ? 'audio' : 'text');
    setLabel(s.label || '');
    setText(s.text || '');
    setDelaySec(s.delaySec != null && s.delaySec !== '' ? String(s.delaySec) : '');
    if (s.filePath) {
      setAudioMeta({
        filePath: s.filePath,
        durationSec: s.durationSec || 0,
        mimetype: s.mimetype || 'audio/ogg',
        previewUrl: null,
      });
      // carrega prévia
      window.chatAPI?.readTriggerAudio?.(s.filePath).then((res) => {
        if (res?.success && res.data) {
          try {
            const binary = atob(res.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'audio/ogg' });
            setAudioMeta((prev) => ({
              ...(prev || {}),
              previewUrl: URL.createObjectURL(blob),
            }));
          } catch { /* ignore */ }
        }
      }).catch(() => {});
    }
    setStep('content');
  };

  const handleDelete = async (s) => {
    if (!confirm(`Remover o gatilho "${s.label}"?`)) return;
    if (s.filePath && window.chatAPI?.deleteTriggerAudio) {
      await window.chatAPI.deleteTriggerAudio(s.filePath).catch(() => {});
    }
    setSnippets((prev) => prev.filter((x) => x.id !== s.id));
    addLog?.(`[WHATSAPP] Gatilho removido: ${s.label}`);
  };

  const startRecording = async () => {
    if (isRecording || busy) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microfone indisponível neste ambiente.');
      return;
    }
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const preferred = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = preferred
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data?.size) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        await new Promise((r) => setTimeout(r, 80));
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        try {
          const mime = recorder.mimeType || preferred || 'audio/webm';
          const blob = new Blob(chunksRef.current, { type: mime });
          if (!blob.size || blob.size < 200) {
            setError('Gravação vazia ou muito curta. Grave de novo.');
            return;
          }
          setBusy(true);
          const b64 = await blobToBase64(blob);
          const res = await window.chatAPI.saveTriggerAudio({
            audioData: b64,
            mimetype: mime,
            label: label.trim() || `Áudio ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
            durationSec,
          });
          if (!res?.success || !res.filePath) {
            setError(res?.error || 'Falha ao salvar áudio');
            return;
          }
          const previewUrl = URL.createObjectURL(blob);
          setAudioMeta({
            filePath: res.filePath,
            durationSec: res.durationSec || durationSec,
            mimetype: res.mimetype || 'audio/ogg',
            previewUrl,
            id: res.id,
          });
          if (!label.trim()) setLabel(res.label || 'Áudio');
          addLog?.(`[WHATSAPP] Áudio gravado para gatilho (${durationSec}s)`);
        } catch (e) {
          setError(e.message || 'Erro ao gravar');
        } finally {
          setBusy(false);
          stopRecCleanup();
        }
      };
      recorder.start(250);
      setIsRecording(true);
      setRecordingMs(0);
      startedAtRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setRecordingMs(Date.now() - startedAtRef.current);
      }, 200);
    } catch (e) {
      stopRecCleanup();
      setError('Permita o microfone para gravar. ' + (e.message || ''));
    }
  };

  const stopRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === 'inactive') {
      stopRecCleanup();
      return;
    }
    try {
      if (typeof rec.requestData === 'function') {
        try { rec.requestData(); } catch { /* ignore */ }
      }
      rec.stop();
    } catch { stopRecCleanup(); }
  };

  const attachAudioFile = async () => {
    if (!window.chatAPI?.openFile) return;
    setError('');
    try {
      const res = await window.chatAPI.openFile({
        filters: [
          { name: 'Áudio', extensions: ['mp3', 'ogg', 'opus', 'wav', 'm4a', 'webm'] },
        ],
      });
      const filePath = res?.path || res?.filePath;
      if (res?.canceled || !filePath) return;
      setBusy(true);
      const saveRes = await window.chatAPI.saveTriggerAudio({
        sourcePath: filePath,
        label: label.trim() || res.name || 'Áudio anexado',
        durationSec: 5,
      });
      if (!saveRes?.success || !saveRes.filePath) {
        setError(saveRes?.error || 'Falha ao importar áudio');
        return;
      }
      // prévia
      let previewUrl = null;
      try {
        const read = await window.chatAPI.readTriggerAudio(saveRes.filePath);
        if (read?.success && read.data) {
          const binary = atob(read.data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }));
        }
      } catch { /* ignore */ }
      setAudioMeta({
        filePath: saveRes.filePath,
        durationSec: saveRes.durationSec || 5,
        mimetype: saveRes.mimetype || 'audio/ogg',
        previewUrl,
        id: saveRes.id,
      });
      if (!label.trim()) setLabel(saveRes.label || 'Áudio anexado');
      addLog?.(`[WHATSAPP] Áudio anexado ao gatilho`);
    } catch (e) {
      setError(e.message || 'Erro ao anexar');
    } finally {
      setBusy(false);
    }
  };

  const canGoNextFromType = true;
  const canSave = () => {
    if (!label.trim()) return false;
    if (kind === 'text') return !!text.trim();
    return !!(audioMeta?.filePath);
  };

  const parseDelaySec = () => {
    if (delaySec === '' || delaySec == null) return null; // automático
    const n = Number(delaySec);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(90, Math.round(n)));
  };

  const save = () => {
    if (!canSave()) {
      setError(kind === 'text' ? 'Preencha nome e texto.' : 'Grave ou anexe um áudio e dê um nome.');
      return;
    }
    const delay = parseDelaySec();
    if (kind === 'text') {
      if (editId) {
        setSnippets((prev) =>
          prev.map((s) =>
            s.id === editId
              ? {
                ...s,
                kind: 'text',
                label: label.trim(),
                text: text.trim(),
                delaySec: delay,
                filePath: undefined,
              }
              : s,
          ),
        );
        addLog?.(`[WHATSAPP] Gatilho de texto atualizado: ${label.trim()}`);
      } else {
        const entry = {
          id: `snip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: 'text',
          label: label.trim(),
          text: text.trim(),
          delaySec: delay,
        };
        setSnippets((prev) => [entry, ...prev].slice(0, 80));
        addLog?.(`[WHATSAPP] Gatilho de texto criado: ${entry.label}`);
      }
    } else {
      const entry = {
        id: audioMeta.id || editId || `aud_${Date.now()}`,
        kind: 'audio',
        label: label.trim(),
        filePath: audioMeta.filePath,
        mimetype: audioMeta.mimetype || 'audio/ogg',
        durationSec: audioMeta.durationSec || 1,
        delaySec: delay,
        createdAt: Date.now(),
      };
      if (editId) {
        setSnippets((prev) => prev.map((s) => (s.id === editId ? { ...s, ...entry, id: editId } : s)));
        addLog?.(`[WHATSAPP] Gatilho de áudio atualizado: ${entry.label}`);
      } else {
        setSnippets((prev) => {
          const without = prev.filter((s) => s.id !== entry.id && s.filePath !== entry.filePath);
          return [entry, ...without].slice(0, 80);
        });
        addLog?.(`[WHATSAPP] Gatilho de áudio criado: ${entry.label}`);
      }
    }
    setStep('done');
  };

  if (!open) return null;

  const stepsMeta = {
    list: { n: 0, title: 'Seus gatilhos', hint: 'Envie com 1 clique nas conversas' },
    type: { n: 1, title: 'Tipo do gatilho', hint: 'Texto ou áudio de voz' },
    content: { n: 2, title: editId ? 'Editar' : 'Configurar', hint: kind === 'audio' ? 'Grave ou anexe' : 'Escreva a mensagem' },
    done: { n: 3, title: 'Pronto!', hint: 'Gatilho salvo' },
  };
  const meta = stepsMeta[step] || stepsMeta.list;

  return createPortal(
    <div className="modal-backdrop trig-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="trig-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <header className="trig-modal-header">
          <div>
            <h3>Gatilhos</h3>
            <p>{meta.hint}</p>
          </div>
          <button type="button" className="trig-modal-close" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        {step !== 'list' && step !== 'done' && (
          <div className="trig-steps">
            {['type', 'content'].map((id, i) => (
              <div key={id} className={`trig-step-dot ${step === id ? 'act' : ''} ${['type', 'content'].indexOf(step) > i ? 'done' : ''}`}>
                {i + 1}
              </div>
            ))}
          </div>
        )}

        <div className="trig-modal-body">
          {error ? <div className="trig-error">{error}</div> : null}

          {/* LIST */}
          {step === 'list' && (
            <div className="trig-list-pane">
              <div className="trig-list-actions">
                <button type="button" className="btn btn-primary" onClick={startCreate}>
                  <PlusCircle size={14} /> Novo gatilho
                </button>
              </div>
              {(!snippets || snippets.length === 0) ? (
                <div className="trig-empty">
                  <p>Nenhum gatilho ainda.</p>
                  <span>Crie mensagens de texto ou grave áudios para enviar em 1 clique.</span>
                </div>
              ) : (
                <div className="trig-cards">
                  {snippets.map((s) => {
                    const isAudio = s.kind === 'audio' || !!s.filePath;
                    return (
                      <div key={s.id} className={`trig-card ${isAudio ? 'audio' : 'text'}`}>
                        <div className="trig-card-icon">
                          {isAudio ? <Mic size={16} /> : <Type size={16} />}
                        </div>
                        <div className="trig-card-body">
                          <strong>{s.label}</strong>
                          <span>
                            {isAudio
                              ? `Áudio · ${formatSec(s.durationSec)}${s.delaySec != null ? ` · espera ${s.delaySec}s` : ' · espera auto'}`
                              : `${(s.text || '').slice(0, 60)}${(s.text || '').length > 60 ? '…' : ''}${s.delaySec != null ? ` · ${s.delaySec}s dig.` : ''}`}
                          </span>
                        </div>
                        <div className="trig-card-actions">
                          <button type="button" className="btn btn-secondary" title="Editar" onClick={() => startEdit(s)}>
                            <Pencil size={12} />
                          </button>
                          <button type="button" className="btn btn-danger" title="Apagar" onClick={() => handleDelete(s)}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TYPE */}
          {step === 'type' && (
            <div className="trig-type-grid">
              <button
                type="button"
                className={`trig-type-card ${kind === 'text' ? 'selected' : ''}`}
                onClick={() => setKind('text')}
              >
                <Type size={22} />
                <strong>Texto</strong>
                <span>Mensagem escrita com variáveis como {'{{name}}'}</span>
              </button>
              <button
                type="button"
                className={`trig-type-card ${kind === 'audio' ? 'selected' : ''}`}
                onClick={() => setKind('audio')}
              >
                <Mic size={22} />
                <strong>Áudio de voz</strong>
                <span>Grava ou anexa — envia como se estivesse gravando agora</span>
              </button>
            </div>
          )}

          {/* CONTENT */}
          {step === 'content' && (
            <div className="trig-content-pane">
              <label className="trig-field">
                <span>Nome</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={kind === 'audio' ? 'Ex: Apresentação oral' : 'Ex: Follow-up'}
                  autoFocus
                />
              </label>

              <label className="trig-field">
                <span>Tempo de espera antes de enviar (segundos)</span>
                <div className="trig-delay-row">
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={delaySec}
                    onChange={(e) => setDelaySec(e.target.value)}
                    placeholder="Auto"
                  />
                  <div className="trig-delay-presets">
                    {[
                      { v: '', label: 'Auto' },
                      { v: '0', label: '0s' },
                      { v: '3', label: '3s' },
                      { v: '5', label: '5s' },
                      { v: '10', label: '10s' },
                      { v: '15', label: '15s' },
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className={`trig-delay-chip ${String(delaySec) === String(p.v) ? 'act' : ''}`}
                        onClick={() => setDelaySec(p.v)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <em className="trig-hint">
                  {kind === 'audio'
                    ? 'Nesse tempo o contato vê “gravando áudio…”. Vazio = usa a duração do áudio.'
                    : 'Nesse tempo o contato vê “digitando…”. Vazio = calcula pelo tamanho do texto.'}
                </em>
              </label>

              {kind === 'text' ? (
                <label className="trig-field">
                  <span>Mensagem</span>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={5}
                    placeholder="Olá {{name}}, tudo bem?"
                  />
                  <em className="trig-hint">Variáveis: {'{{name}}'} · {'{{phone}}'}</em>
                </label>
              ) : (
                <div className="trig-audio-box">
                  <div className="trig-audio-actions">
                    {!isRecording ? (
                      <>
                        <button type="button" className="btn btn-primary" onClick={startRecording} disabled={busy}>
                          <Mic size={14} /> {audioMeta ? 'Regravar' : 'Gravar agora'}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={attachAudioFile} disabled={busy}>
                          <Paperclip size={14} /> Anexar arquivo
                        </button>
                      </>
                    ) : (
                      <div className="chat-recording-bar" style={{ width: '100%' }}>
                        <span className="chat-recording-dot" />
                        <span>Gravando {formatSec(Math.round(recordingMs / 1000))}…</span>
                        <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={stopRecCleanup}>
                          Cancelar
                        </button>
                        <button type="button" className="btn btn-primary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={stopRecording}>
                          Parar
                        </button>
                      </div>
                    )}
                  </div>
                  {busy && !isRecording ? <p className="trig-hint">Processando áudio…</p> : null}
                  {audioMeta?.filePath ? (
                    <div className="trig-audio-preview">
                      <Check size={14} color="var(--success)" />
                      <span>Áudio pronto · {formatSec(audioMeta.durationSec)}</span>
                      {audioMeta.previewUrl ? (
                        <audio src={audioMeta.previewUrl} controls preload="metadata" style={{ width: '100%', marginTop: 8 }} />
                      ) : (
                        <span className="trig-hint"><Play size={12} /> Prévia indisponível</span>
                      )}
                    </div>
                  ) : (
                    <p className="trig-hint" style={{ marginTop: 8 }}>
                      Grave com o microfone ou anexe mp3/ogg/wav. No envio, o app mostra “gravando…” e manda como voz.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* DONE */}
          {step === 'done' && (
            <div className="trig-done">
              <div className="trig-done-icon"><Check size={28} /></div>
              <h4>Gatilho salvo</h4>
              <p>Use na barra de gatilhos da conversa — um clique e envia.</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setStep('list'); }}>
                  Ver lista
                </button>
                <button type="button" className="btn btn-primary" onClick={startCreate}>
                  Criar outro
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="trig-modal-footer">
          {step === 'list' && (
            <button type="button" className="btn btn-secondary" onClick={onClose}>Fechar</button>
          )}
          {step === 'type' && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); setStep('list'); }}>
                <ChevronLeft size={14} /> Voltar
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setStep('content')} disabled={!canGoNextFromType}>
                Próximo <ChevronRight size={14} />
              </button>
            </>
          )}
          {step === 'content' && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  if (isRecording) stopRecCleanup();
                  setStep(editId ? 'list' : 'type');
                }}
              >
                <ChevronLeft size={14} /> Voltar
              </button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={busy || isRecording || !canSave()}>
                Salvar gatilho
              </button>
            </>
          )}
          {step === 'done' && (
            <button type="button" className="btn btn-primary" onClick={onClose}>Concluir</button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
