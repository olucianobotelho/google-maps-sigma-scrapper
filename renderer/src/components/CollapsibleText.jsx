import React, { useState } from 'react';

/**
 * Texto inteligente: mostra só o essencial, expande sob demanda.
 * - lines: clamp inicial (2 ou 3)
 * - children: texto longo
 * - as="p" | "span" | "div"
 */
export default function CollapsibleText({ children, lines = 2, as: As = 'p', style, className, moreLabel='Ver mais', lessLabel='Ver menos' }) {
  const [open, setOpen] = useState(false);
  const text = typeof children === 'string' ? children : String(children || '');
  if (!text) return null;
  // heurística: só mostra toggle se passar de ~90 chars (2 linhas) ou 140 (3)
  const threshold = lines === 2 ? 90 : 140;
  const needsToggle = text.length > threshold;
  return (
    <As
      className={className}
      style={{
        ...style,
        display: open || !needsToggle ? 'block' : '-webkit-box',
        WebkitLineClamp: open || !needsToggle ? 'unset' : lines,
        WebkitBoxOrient: 'vertical',
        overflow: open || !needsToggle ? 'visible' : 'hidden',
        cursor: needsToggle ? 'pointer' : undefined,
      }}
      title={!open && needsToggle ? text : undefined}
      onClick={needsToggle ? () => setOpen(v=>!v) : undefined}
    >
      {text}
      {needsToggle && (
        <span
          onClick={(e)=>{ e.stopPropagation(); setOpen(v=>!v); }}
          style={{
            marginLeft: 6,
            fontSize: '11px',
            fontWeight:600,
            color:'var(--accent)',
            whiteSpace:'nowrap',
            cursor:'pointer',
            userSelect:'none',
          }}
        >
          {open ? lessLabel : moreLabel}
        </span>
      )}
    </As>
  );
}

export function HelpTip({ text, children }) {
  const [open, setOpen] = useState(false);
  if (!text) return children || null;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4, position:'relative' }}>
      {children}
      <button
        type="button"
        aria-label="Ajuda"
        onClick={()=> setOpen(v=>!v)}
        onBlur={()=> setTimeout(()=> setOpen(false), 150)}
        style={{
          width:16, height:16, borderRadius:999, border:'1px solid var(--border)', background:'var(--surface-2)',
          display:'grid', placeItems:'center', fontSize:10, fontWeight:700, color:'var(--muted)', cursor:'pointer', flexShrink:0, lineHeight:1
        }}
      >?</button>
      {open && (
        <span style={{
          position:'absolute', left:0, top:'calc(100% + 6px)', zIndex:20,
          background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'8px 10px',
          fontSize:11, color:'var(--fg-2)', lineHeight:1.5, boxShadow:'0 8px 24px rgba(15,23,42,.12)',
          width:'min(280px, 70vw)', whiteSpace:'normal'
        }}>
          {text}
        </span>
      )}
    </span>
  );
}
