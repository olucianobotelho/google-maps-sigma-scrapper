import React from 'react';
import {
  Users,
  LayoutDashboard,
  Target,
  MessageSquare,
  GitBranch,
  PlusCircle,
  ArrowRight,
  TrendingUp,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import CollapsibleText from './CollapsibleText';

function Overview({ onNavigate, waStatus, leadsCount, scoringCount }) {
  return (
    <>
      <div className="page-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', gap:16 }}>
        <div className="info">
          <h1 style={{ fontSize:20, fontWeight:800, letterSpacing:'-.015em' }}>Centro de Comando</h1>
          <p style={{ fontSize:12.5, color:'var(--muted)', marginTop:4, maxWidth:'56ch' }}>Visão geral respirável — 1 accent, muito branco, sem cards repetidos. Escolha 1 ação e siga.</p>
        </div>
        <button onClick={() => onNavigate('scraper')} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px', height:36, padding:'0 14px', borderRadius:8 }}>
          <PlusCircle size={14} /> Nova Busca
        </button>
      </div>

      {/* Metric strip — Stripe style, 1 linha */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
        <div style={{ padding:'12px 14px', borderRight:'1px solid var(--border)' }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--muted)', display:'flex', alignItems:'center', gap:6 }}><Users size={12} style={{ color:'var(--accent)' }}/> Total de Leads</div>
          <div style={{ fontSize:20, fontWeight:800, marginTop:4 }}>{leadsCount.toLocaleString()}</div>
          <div style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:4, marginTop:2 }}><TrendingUp size={11}/> Base sincronizada</div>
        </div>
        <div style={{ padding:'12px 14px', borderRight:'1px solid var(--border)' }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--muted)', display:'flex', alignItems:'center', gap:6 }}>{waStatus==='connected' ? <CheckCircle2 size={12} style={{ color:'var(--success)' }}/> : <AlertCircle size={12} style={{ color:'var(--danger)' }}/>} WhatsApp</div>
          <div style={{ fontSize:16, fontWeight:700, marginTop:4, color: waStatus==='connected' ? 'var(--success)' : 'var(--danger)', display:'flex', alignItems:'center', gap:6 }}>{waStatus==='connected' ? 'Online' : 'Desconectado'} <span className={`status-dot ${waStatus==='connected'?'green':'red'}`} style={{ width:7, height:7 }}/></div>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{waStatus==='connected' ? 'Multi-sessão' : 'Requer QR'}</div>
        </div>
        <div style={{ padding:'12px 14px', borderRight:'1px solid var(--border)' }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--muted)', display:'flex', alignItems:'center', gap:6 }}><Zap size={12} style={{ color:'var(--warn)' }}/> Fila</div>
          <div style={{ fontSize:16, fontWeight:700, marginTop:4 }}>Pronto</div>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>Scraper ocioso</div>
        </div>
        <div style={{ padding:'12px 14px' }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--muted)', display:'flex', alignItems:'center', gap:6 }}><Sparkles size={12} style={{ color:'var(--success)' }}/> Ligar primeiro</div>
          <div style={{ fontSize:20, fontWeight:800, marginTop:4, color:'var(--success)' }}>{scoringCount}</div>
          <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>Oportunidades</div>
        </div>
      </div>

      {/* 2 primários + lista compacta secundária */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <button onClick={() => onNavigate('scraper')} style={{ textAlign:'left', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:16, display:'flex', flexDirection:'column', gap:10, cursor:'pointer' }}>
          <div style={{ width:32, height:32, borderRadius:7, background:'var(--accent-soft)', color:'var(--accent)', display:'grid', placeItems:'center' }}><Users size={16}/></div>
          <div><h3 style={{ fontSize:13.5, fontWeight:700 }}>Módulo de Leads</h3><CollapsibleText lines={2} style={{ fontSize:11.5, color:'var(--muted)', marginTop:4, lineHeight:1.5 }}>Busca no Google Maps por nicho e região com enriquecimento automático de e-mails, redes sociais e telefones.</CollapsibleText></div>
          <span style={{ fontSize:11.5, fontWeight:600, color:'var(--accent)', display:'flex', alignItems:'center', gap:4 }}>Explorar <ArrowRight size={12}/></span>
        </button>
        <button onClick={() => onNavigate('scoring')} style={{ textAlign:'left', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:16, display:'flex', flexDirection:'column', gap:10, cursor:'pointer' }}>
          <div style={{ width:32, height:32, borderRadius:7, background:'rgba(5,150,105,.08)', color:'var(--success)', display:'grid', placeItems:'center' }}><Target size={16}/></div>
          <div><h3 style={{ fontSize:13.5, fontWeight:700 }}>Quem Ligar Primeiro</h3><CollapsibleText lines={2} style={{ fontSize:11.5, color:'var(--muted)', marginTop:4, lineHeight:1.5 }}>Auditoria técnica dos sites (Pixel, SSL, mobile, velocidade) e geração de pitch de IA pronto para envio. Priorize quem tem maior falha rápida de corrigir.</CollapsibleText></div>
          <span style={{ fontSize:11.5, fontWeight:600, color:'var(--success)', display:'flex', alignItems:'center', gap:4 }}>Abrir fila <ArrowRight size={12}/></span>
        </button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <button onClick={() => onNavigate('whatsapp')} style={{ textAlign:'left', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
          <div style={{ width:28, height:28, borderRadius:7, background:'var(--surface-2)', display:'grid', placeItems:'center', color:'var(--accent)' }}><MessageSquare size={14}/></div>
          <div style={{ minWidth:0 }}><div style={{ fontSize:12, fontWeight:600 }}>WhatsApp Omnichannel</div><div style={{ fontSize:11, color:'var(--muted)' }}>Multi-sessão · anti-ban →</div></div>
        </button>
        <button onClick={() => onNavigate('dashboard')} style={{ textAlign:'left', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
          <div style={{ width:28, height:28, borderRadius:7, background:'var(--surface-2)', display:'grid', placeItems:'center' }}><LayoutDashboard size={14}/></div>
          <div style={{ minWidth:0 }}><div style={{ fontSize:12, fontWeight:600 }}>Painel de Análises</div><div style={{ fontSize:11, color:'var(--muted)' }}>Métricas e histórico →</div></div>
        </button>
      </div>
    </>
  );
}

export default Overview;

