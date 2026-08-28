import React, { useEffect, useState } from 'react';
import { Users, Activity, Calendar, BarChart3 } from 'lucide-react';

export default function UsagePanel() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI?.getMetrics?.();
      if (res?.success) setStats(res);
      else setStats(res);
    } catch {
      setStats(null);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return <div className="usage-panel"><div className="skeleton" style={{ height: 120 }} /></div>;
  }

  if (!stats || stats.success === false) {
    return <div className="usage-panel"><p style={{ fontSize: 12, color: 'var(--muted)' }}>Sem dados de uso ainda.</p></div>;
  }

  const installId = stats.install?.id || '—';
  const shortId = installId.slice(0, 8);
  const byEvent = stats.byEvent || {};

  return (
    <div className="usage-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="kpi-card">
          <div className="kpi-header"><span className="kpi-label">ESTE DISPOSITIVO</span><Users size={14} /></div>
          <div className="kpi-value-row"><span className="kpi-value" style={{ fontSize: 14, fontFamily: 'monospace' }}>{shortId}</span></div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, wordBreak: 'break-all' }}>{installId}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header"><span className="kpi-label">HOJE</span><Activity size={14} /></div>
          <div className="kpi-value-row"><span className="kpi-value">{stats.todayCount ?? 0}</span><span className="kpi-subtext">eventos</span></div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{stats.totalDays ?? 0} dias · {stats.totalEvents ?? 0} total</div>
        </div>
      </div>

      <div className="usage-breakdown" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><BarChart3 size={12} /> Eventos</div>
        {Object.keys(byEvent).length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Nenhum evento ainda.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(byEvent).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'var(--muted)' }}>{k}</span><strong>{v}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <Calendar size={10} /> v{stats.version} · anônimo · sem PII
      </div>
    </div>
  );
}
