import React, { useMemo } from 'react';
import { Search, Activity, Users, Phone, Globe, Instagram, Clock, TrendingUp, Sparkles, ArrowUpRight, Layers, Zap, Target } from 'lucide-react';
import { dedupeLeads, getLeadStats, getSearchLeadCount, readLocalArray } from '../leadData';

function MiniSpark({ values }) {
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 60;
    const y = 18 - (v / max) * 14;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="60" height="20" viewBox="0 0 60 20" style={{ display:'block' }}>
      <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} style={{ opacity:.9 }} />
      <circle cx={pts.split(' ').pop().split(',')[0]} cy={pts.split(' ').pop().split(',')[1]} r="2.2" fill="var(--accent)" />
    </svg>
  );
}

function Dashboard() {
  const leads = useMemo(() => readLocalArray('sigma_leads'), []);
  const searches = useMemo(() => readLocalArray('sigma_searches'), []);
  const dedupedLeads = useMemo(() => dedupeLeads(leads), [leads]);
  const { total, phoneCount, webCount, igCount } = getLeadStats(dedupedLeads);
  const getPct = (val) => (total > 0 ? Math.round((val / total) * 100) : 0);

  const categoryCounts = {};
  dedupedLeads.forEach((l) => { if (l.category) categoryCounts[l.category] = (categoryCounts[l.category] || 0) + 1; });
  const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCategoryCount = topCategories[0]?.[1] || 1;
  const recentSearches = [...searches].reverse().slice(0, 6);
  const hasData = total > 0;
  const coverage = total ? Math.round(((phoneCount + webCount + igCount) / (total*3))*100) : 0;

  // sparkline mock baseado em buscas
  const sparkVals = recentSearches.length ? recentSearches.map(s=> getSearchLeadCount(leads, s.id)).slice(0,5).reverse() : [2,5,3,8,6];

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:1120, width:'100%' }}>
      {/* Header — mais amigável */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:28, height:28, borderRadius:7, background:'var(--accent-soft)', color:'var(--accent)', display:'grid', placeItems:'center' }}><Layers size={14}/></div>
            <h1 style={{ fontSize:18, fontWeight:800, letterSpacing:'-.015em' }}>Painel de Análises</h1>
            <span style={{ fontSize:11, padding:'3px 8px', borderRadius:999, background:'var(--surface-2)', border:'1px solid var(--border)', color:'var(--muted)' }}>{total} leads</span>
          </div>
          <p style={{ fontSize:12.5, color:'var(--muted)', marginTop:6, maxWidth:560, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }} title="Entenda sua base em 5 segundos: cobertura por canal, nichos que mais retornam e histórico — sem tabela densa.">Cobertura por canal e nichos que mais retornam — sem tabela densa.</p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:6 }}><span style={{ width:7, height:7, borderRadius:999, background: hasData?'var(--success)':'var(--border)', display:'inline-block' }}/> {hasData ? 'Base pronta' : 'Vazia'}</span>
          <span style={{ fontSize:11, padding:'5px 10px', borderRadius:999, background:'var(--surface)', border:'1px solid var(--border)', color:'var(--muted)' }}>{recentSearches.length} buscas</span>
        </div>
      </div>

      {/* Metric strip — bento moderno com sparklines */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
        {[
          { label:'Total', icon:Users, value: total, sub:'únicos', color:'var(--accent)', pct:100, spark: sparkVals },
          { label:'Telefone', icon:Phone, value: phoneCount, sub:`${getPct(phoneCount)}% WhatsApp`, color:'var(--success)', pct:getPct(phoneCount) },
          { label:'Website', icon:Globe, value: webCount, sub:`${getPct(webCount)}% scoring`, color:'var(--accent)', pct:getPct(webCount) },
          { label:'Instagram', icon:Instagram, value: igCount, sub:`${getPct(igCount)}% social`, color:'#DB2777', pct:getPct(igCount) },
        ].map((m, i)=>(
          <div key={i} style={{ padding:'12px 14px', borderRight: i<3 ? '1px solid var(--border)' : 'none', display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--muted)', display:'flex', alignItems:'center', gap:6 }}><m.icon size={11} style={{ color:m.color }}/> {m.label}</div>
            <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
              <span style={{ fontSize:18, fontWeight:800 }}>{m.value}</span>
              {i===0 ? <MiniSpark values={m.spark}/> : <span style={{ fontSize:11, fontWeight:500, color: m.pct>60?'var(--success)': m.pct>30?'var(--muted)':'var(--danger)' }}>{m.pct}%</span>}
            </div>
            <div style={{ fontSize:11, color:'var(--muted)' }}>{m.sub}</div>
            <div style={{ height:4, background:'var(--track-bg)', borderRadius:999, marginTop:2 }}><div style={{ width:`${m.pct}%`, height:'100%', background:m.color, borderRadius:999, transition:'width 400ms ease' }}/></div>
          </div>
        ))}
      </div>

      {/* Bento grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1.35fr .85fr', gap:12 }}>
        {/* Categorias — horizontal bars modernas */}
        <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <h3 style={{ fontSize:12.5, fontWeight:700, display:'flex', alignItems:'center', gap:7 }}><Activity size={14} style={{ color:'var(--accent)' }}/> Categorias que mais retornam</h3>
            <span style={{ fontSize:11, color:'var(--muted)', display:'flex', alignItems:'center', gap:4 }}><TrendingUp size={12}/> Top 6</span>
          </div>
          {topCategories.length === 0 ? (
            <div style={{ textAlign:'center', padding:'22px 16px', color:'var(--muted)' }}>
              <div style={{ width:40, height:40, borderRadius:999, background:'var(--surface-2)', border:'1px solid var(--border)', display:'grid', placeItems:'center', margin:'0 auto' }}><Search size={16}/></div>
              <div style={{ fontSize:12, fontWeight:600, marginTop:8, color:'var(--fg)' }}>Sem categorias ainda</div>
              <div style={{ fontSize:11, marginTop:2 }}>Faça uma extração e volte aqui — o gráfico aparece sozinho.</div>
            </div>
          ) : (
            <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:10 }}>
              {topCategories.map(([name, count], idx)=>(
                <div key={name} style={{ display:'grid', gridTemplateColumns:'24px 1fr 36px', gap:8, alignItems:'center' }}>
                  <span style={{ fontSize:11, fontWeight:700, color: idx===0?'var(--accent)':'var(--muted)' }}>#{idx+1}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} title={name}>{name}</div>
                    <div style={{ height:6, background:'var(--track-bg)', borderRadius:999, marginTop:4, overflow:'hidden' }}>
                      <div style={{ width:`${Math.round((count/maxCategoryCount)*100)}%`, height:'100%', borderRadius:999, background: idx===0 ? 'linear-gradient(90deg,var(--accent),#A78BFA)' : 'var(--accent)', transition:'width 500ms ease' }}/>
                    </div>
                  </div>
                  <span style={{ fontSize:12, fontWeight:700, textAlign:'right' }}>{count}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop:10, display:'flex', gap:6, flexWrap:'wrap' }}>
            <span style={{ fontSize:11, padding:'4px 8px', borderRadius:999, background:'var(--accent-soft)', color:'var(--accent)', border:'1px solid rgba(99,102,241,.18)' }}>{coverage}% cobertura média</span>
            <span style={{ fontSize:11, padding:'4px 8px', borderRadius:999, background:'var(--surface-2)', border:'1px solid var(--border)', color:'var(--muted)' }}>{Object.keys(categoryCounts).length} nichos únicos</span>
          </div>
        </div>

        {/* Coluna direita — histórico + atalhos */}
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, padding:14, flex:1 }}>
            <h3 style={{ fontSize:12.5, fontWeight:700, display:'flex', alignItems:'center', gap:7 }}><Clock size={14} style={{ color:'var(--accent)' }}/> Histórico de buscas</h3>
            <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{recentSearches.length ? 'Últimas extrações — clique para filtrar' : 'Suas buscas aparecerão aqui'}</div>
            {recentSearches.length === 0 ? (
              <div style={{ textAlign:'center', padding:'18px 12px', marginTop:8, border:'1px dashed var(--border)', borderRadius:8, background:'var(--surface-2)' }}>
                <div style={{ fontSize:12, fontWeight:600 }}>Nenhuma busca ainda</div>
                <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>Ex: “Clínicas em Pinheiros · 30 leads”</div>
              </div>
            ) : (
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
                {recentSearches.map(s=>{
                  const c = getSearchLeadCount(leads, s.id);
                  return (
                    <div key={s.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', border:'1px solid var(--border)', borderRadius:8, background:'var(--surface)', transition:'border-color 120ms' }}>
                      <div style={{ width:22, height:22, borderRadius:6, background:'var(--accent-soft)', color:'var(--accent)', display:'grid', placeItems:'center', flexShrink:0 }}><Search size={11}/></div>
                      <span style={{ fontSize:12, fontWeight:500, minWidth:0, flex:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} title={s.label||s.query}>{s.label||s.query}</span>
                      <span style={{ fontSize:11, fontWeight:700, padding:'2px 6px', borderRadius:999, background:'var(--surface-2)', border:'1px solid var(--border)' }}>{c} <span style={{ fontWeight:500, color:'var(--muted)' }}>leads</span></span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick actions — amigável */}
          <div style={{ background:'linear-gradient(135deg, var(--accent-soft), #F0F0FF)', border:'1px solid rgba(99,102,241,.18)', borderRadius:10, padding:12, display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ fontSize:12, fontWeight:700, display:'flex', alignItems:'center', gap:6 }}><Sparkles size={12} style={{ color:'var(--accent)' }}/> Próximo passo sugerido</div>
            {!hasData ? (
              <div style={{ fontSize:11.5, color:'var(--muted)', lineHeight:1.5 }}>Comece com 1 extração de 30 leads. Depois veja “Quem ligar primeiro”.</div>
            ) : coverage < 50 ? (
              <div style={{ fontSize:11.5, color:'var(--muted)', lineHeight:1.5 }}>Cobertura baixa ({coverage}%). Tente enriquecer mais telefones + sites na próxima extração.</div>
            ) : (
              <div style={{ fontSize:11.5, color:'var(--muted)', lineHeight:1.5 }}>Base saudável! Vá em <b style={{ color:'var(--fg)' }}>Lead Scoring</b> para priorizar quem ligar.</div>
            )}
            <div style={{ display:'flex', gap:6, marginTop:2 }}>
              <span style={{ fontSize:11, padding:'5px 10px', borderRadius:999, background:'var(--surface)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', gap:4 }}><Target size={11}/> Lead Scoring <ArrowUpRight size={11}/></span>
              <span style={{ fontSize:11, padding:'5px 10px', borderRadius:999, background:'var(--accent)', color:'#fff', display:'inline-flex', alignItems:'center', gap:4 }}><Zap size={11}/> Nova extração</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
