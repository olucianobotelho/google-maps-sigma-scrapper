import React, { useState, useEffect } from 'react';
import { Compass, Sparkles, MessageSquare, X, ArrowRight, Check } from 'lucide-react';

const STEPS = [
  {
    id: 'scraper',
    icon: Compass,
    title: 'Passo 1 — Extraia leads',
    desc: 'Busque no Google Maps por nicho + bairro. Ex: “Odontologia em Pinheiros”. O feed mostra em tempo real.',
    cta: 'Nova extração',
    targetTab: 'scraper',
  },
  {
    id: 'scoring',
    icon: Sparkles,
    title: 'Passo 2 — Quem ligar primeiro',
    desc: 'Analise sites (pixel, HTTPS, mobile) e receba um pitch pronto. Foque onde há falha rápida de corrigir.',
    cta: 'Ver scoring',
    targetTab: 'scoring',
  },
  {
    id: 'whatsapp',
    icon: MessageSquare,
    title: 'Passo 3 — Converta no WhatsApp',
    desc: 'Multi-sessão, disparos com janela anti-ban e biblioteca de áudios 1-click.',
    cta: 'Abrir WhatsApp',
    targetTab: 'whatsapp',
  },
];

export default function OnboardingTour({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    try {
      if (localStorage.getItem('sigma_onboarding_done') === '1') return;
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    } catch {}
  }, []);

  const dismiss = (done=false) => {
    try { localStorage.setItem('sigma_onboarding_done', '1'); } catch {}
    setOpen(false);
  };

  const next = () => {
    const step = STEPS[idx];
    if (step?.targetTab && onNavigate) onNavigate(step.targetTab);
    if (idx < STEPS.length - 1) setIdx(idx+1);
    else dismiss(true);
  };

  if (!open) return null;
  const step = STEPS[idx];
  const Icon = step.icon;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.32)', display:'grid', placeItems:'center', zIndex:9998, padding:16 }} onClick={()=>dismiss()}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'min(440px,96vw)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, boxShadow:'0 20px 40px rgba(15,23,42,.18)', overflow:'hidden', animation:'viewIn 180ms cubic-bezier(.16,1,.3,1)' }}>
        <div style={{ height:4, background:'linear-gradient(90deg,var(--accent),#A78BFA)' }}/>
        <div style={{ padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:11, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--accent)' }}>Bem-vindo · {idx+1} de {STEPS.length}</span>
          <button onClick={()=>dismiss()} style={{ width:26, height:26, borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', display:'grid', placeItems:'center', cursor:'pointer' }}><X size={14} style={{ color:'var(--muted)' }}/></button>
        </div>
        <div style={{ padding:'0 16px 14px', display:'flex', flexDirection:'column', gap:10 }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
            <div style={{ width:36, height:36, borderRadius:8, background:'var(--accent-soft)', color:'var(--accent)', display:'grid', placeItems:'center', flexShrink:0 }}><Icon size={16}/></div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:700, letterSpacing:'-.01em' }}>{step.title}</div>
              <div style={{ fontSize:12, color:'var(--muted)', marginTop:4, lineHeight:1.5 }}>{step.desc}</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:6, marginTop:4 }}>
            {STEPS.map((_,i)=>(
              <span key={i} style={{ flex:1, height:4, borderRadius:999, background: i<=idx ? 'var(--accent)' : 'var(--border)' }}/>
            ))}
          </div>
          <div style={{ display:'flex', gap:8, justifyContent:'space-between', marginTop:2 }}>
            <button onClick={()=>dismiss()} style={{ fontSize:12, fontWeight:500, color:'var(--muted)', background:'transparent', border:'none', cursor:'pointer', padding:'8px 4px' }}>Pular tour</button>
            <button onClick={next} className="btn btn-primary" style={{ display:'inline-flex', alignItems:'center', gap:6, height:34, padding:'0 14px', borderRadius:8, background:'var(--accent)', color:'#fff', border:'none', fontWeight:600, cursor:'pointer' }}>
              {step.cta} {idx < STEPS.length-1 ? <ArrowRight size={14}/> : <Check size={14}/>}
            </button>
          </div>
          <div style={{ fontSize:10.5, color:'var(--muted)', textAlign:'center', marginTop:2 }}>Dica: <span style={{ fontFamily:'ui-monospace', background:'var(--surface-2)', padding:'1px 5px', borderRadius:4, border:'1px solid var(--border)' }}>⌘K</span> abre busca global a qualquer momento.</div>
        </div>
      </div>
    </div>
  );
}
