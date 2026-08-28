import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Pause as PauseIcon, Play as PlayIcon } from 'lucide-react';

function formatTime(s) {
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0) return '0:00';
  const m = Math.floor(v / 60);
  const sec = Math.floor(v % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Player de voz — NUNCA lê/escreve HTMLMediaElement.currentTime.
 * Progresso = relógio de parede (evita TypeError em elemento null no Electron).
 */
export default function ChatVoicePlayer({
  msgId,
  src,
  isPtt,
  secondsHint,
  loading,
  error,
  onLoad,
  onRetry,
}) {
  const audioRef = useRef(null);
  const mountedRef = useRef(true);
  const playingRef = useRef(false);
  const startedAtRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [displaySec, setDisplaySec] = useState(0);
  const duration = Math.max(0, Number(secondsHint) || 0);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  const readElapsed = useCallback(() => {
    if (playingRef.current && startedAtRef.current) {
      return offsetRef.current + (Date.now() - startedAtRef.current) / 1000;
    }
    return offsetRef.current;
  }, []);

  const tick = useCallback(() => {
    if (!mountedRef.current || !playingRef.current) return;
    const elapsed = readElapsed();
    setDisplaySec(elapsed);
    if (duration > 0 && elapsed >= duration) {
      // fim estimado
      playingRef.current = false;
      offsetRef.current = 0;
      startedAtRef.current = 0;
      setPlaying(false);
      setDisplaySec(0);
      stopRaf();
      try {
        audioRef.current?.pause?.();
      } catch {
        /* ignore */
      }
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [duration, readElapsed, stopRaf]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRaf();
      playingRef.current = false;
      try {
        const el = audioRef.current;
        if (el) {
          el.pause?.();
          el.removeAttribute?.('src');
          // não chama load() — em alguns Chromium gera eventos estranhos
        }
      } catch {
        /* ignore */
      }
    };
  }, [stopRaf]);

  // troca de mensagem / src → reseta UI
  useEffect(() => {
    stopRaf();
    playingRef.current = false;
    offsetRef.current = 0;
    startedAtRef.current = 0;
    setPlaying(false);
    setDisplaySec(0);
    const el = audioRef.current;
    if (!el) return;
    try {
      el.pause?.();
      if (src) {
        el.setAttribute('src', src);
      } else {
        el.removeAttribute('src');
      }
    } catch {
      /* ignore */
    }
  }, [src, msgId, stopRaf]);

  const togglePlay = useCallback(async () => {
    if (!src) {
      if (typeof onLoad === 'function') onLoad();
      return;
    }
    const el = audioRef.current;
    if (!el) return;

    try {
      if (!playingRef.current) {
        // pausa outros players (só pause — sem currentTime)
        try {
          document.querySelectorAll('audio[data-sigma-voice="1"]').forEach((other) => {
            if (other !== el) {
              try {
                other.pause?.();
              } catch {
                /* ignore */
              }
            }
          });
        } catch {
          /* ignore */
        }

        if (el.getAttribute('src') !== src) {
          el.setAttribute('src', src);
        }
        await el.play();
        playingRef.current = true;
        startedAtRef.current = Date.now();
        setPlaying(true);
        stopRaf();
        rafRef.current = requestAnimationFrame(tick);
      } else {
        try {
          el.pause?.();
        } catch {
          /* ignore */
        }
        offsetRef.current = readElapsed();
        playingRef.current = false;
        startedAtRef.current = 0;
        setPlaying(false);
        setDisplaySec(offsetRef.current);
        stopRaf();
      }
    } catch {
      playingRef.current = false;
      setPlaying(false);
      stopRaf();
    }
  }, [src, onLoad, tick, stopRaf, readElapsed]);

  // seek só atualiza o relógio local — NÃO toca currentTime no DOM
  const seek = useCallback((e) => {
    e.stopPropagation();
    if (!src || duration <= 0) return;
    try {
      const rect = e.currentTarget?.getBoundingClientRect?.();
      if (!rect?.width) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const next = ratio * duration;
      offsetRef.current = next;
      if (playingRef.current) {
        startedAtRef.current = Date.now();
      }
      setDisplaySec(next);
      // reinicia o áudio do começo se estiver tocando (sem seek nativo)
      const el = audioRef.current;
      if (el && playingRef.current) {
        try {
          el.pause?.();
          el.setAttribute('src', src);
          el.play?.().catch(() => {});
          // aproximação: não há seek real sem currentTime; aceitável para PTT curto
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }, [src, duration]);

  const showTime = playing || displaySec > 0 ? displaySec : duration;
  const pct = duration > 0 ? Math.min(100, (Math.min(displaySec, duration) / duration) * 100) : (playing ? 8 : 0);

  return (
    <div className={`chat-voice ${src ? 'ready' : ''} ${isPtt ? 'ptt' : ''}`}>
      <button
        type="button"
        className={`chat-voice-play ${playing ? 'playing' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        disabled={!!loading}
        title={src ? (playing ? 'Pausar' : 'Reproduzir') : 'Carregar áudio'}
      >
        {loading ? (
          <span className="chat-voice-spinner" />
        ) : playing ? (
          <PauseIcon size={16} />
        ) : (
          <PlayIcon size={16} />
        )}
      </button>
      <div className="chat-voice-body">
        <div className="chat-voice-wave" onClick={seek}>
          <div className="chat-voice-wave-bg" />
          <div className="chat-voice-wave-fill" style={{ width: `${pct}%` }} />
          <div className="chat-voice-bars" aria-hidden>
            {Array.from({ length: 24 }).map((_, i) => (
              <span key={i} style={{ height: `${30 + ((i * 17) % 55)}%` }} />
            ))}
          </div>
        </div>
        <div className="chat-voice-meta">
          <span>{isPtt ? 'Mensagem de voz' : 'Áudio'}</span>
          <span className="chat-voice-time">{formatTime(showTime)}</span>
        </div>
      </div>
      <audio
        ref={audioRef}
        data-sigma-voice="1"
        data-msg-id={msgId || ''}
        preload="none"
        style={{ display: 'none' }}
        onEnded={() => {
          playingRef.current = false;
          offsetRef.current = 0;
          startedAtRef.current = 0;
          setPlaying(false);
          setDisplaySec(0);
          stopRaf();
        }}
        onError={() => {
          playingRef.current = false;
          setPlaying(false);
          stopRaf();
        }}
      />
      {error ? (
        <button
          type="button"
          className="chat-media-retry"
          onClick={(e) => {
            e.stopPropagation();
            onRetry?.();
          }}
        >
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}
