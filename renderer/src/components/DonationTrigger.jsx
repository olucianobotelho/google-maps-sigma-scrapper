import React, { useEffect, useState } from 'react';
import { Heart, X } from 'lucide-react';

export default function DonationTrigger() {
  const [visible, setVisible] = useState(true);
  const [campaignPulse, setCampaignPulse] = useState(false);
  const [showVersion, setShowVersion] = useState(0);

  useEffect(() => {
    const onCampaignStarted = () => {
      setVisible(true);
      setShowVersion((version) => version + 1);
      setCampaignPulse(true);
      window.setTimeout(() => setCampaignPulse(false), 2200);
    };
    window.addEventListener('sigma:campaign-started', onCampaignStarted);
    return () => window.removeEventListener('sigma:campaign-started', onCampaignStarted);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(() => setVisible(false), 180000);
    return () => window.clearTimeout(timer);
  }, [visible, showVersion]);

  if (!visible) return null;
  return (
    <aside className={`donation-trigger ${campaignPulse ? 'is-pulsing' : ''}`} aria-label="Apoie este projeto">
      <button type="button" className="donation-close" onClick={() => setVisible(false)} aria-label="Fechar aviso">
        <X size={13} />
      </button>
      <div className="donation-title"><Heart size={13} fill="currentColor" /> Curtiu? Deixa uma ⭐ no GitHub</div>
      <div className="donation-hint">Compartilhe com quem precisa de leads</div>
    </aside>
  );
}
