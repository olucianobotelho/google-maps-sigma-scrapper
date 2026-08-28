import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export default function UpdateBanner() {
  const [status, setStatus] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;
    const cleanup = window.electronAPI.onUpdateStatus((data) => {
      if (!data) return;
      if (data.status === 'progress') {
        setProgress(data.percent || 0);
        setDownloading(true);
        setStatus({ type: 'progress', percent: data.percent });
        return;
      }
      if (data.status === 'checking') {
        setStatus({ type: 'checking' });
        return;
      }
      if (data.status === 'available') {
        setDismissed(false);
        setStatus({ type: 'available', version: data.version });
        setDownloading(false);
        return;
      }
      if (data.status === 'downloaded') {
        setStatus({ type: 'downloaded', version: data.version });
        setDownloading(false);
        return;
      }
      if (data.status === 'not-available') {
        setStatus(null);
        return;
      }
      if (data.status === 'error') {
        setStatus({ type: 'error', message: data.message });
        setDownloading(false);
        return;
      }
    });
    return cleanup;
  }, []);

  const handleCheck = async () => {
    setStatus({ type: 'checking' });
    try {
      await window.electronAPI?.checkUpdate?.();
    } catch {}
  };

  const handleDownload = async () => {
    setDownloading(true);
    setProgress(0);
    try {
      await window.electronAPI?.downloadUpdate?.();
    } catch {
      setDownloading(false);
    }
  };

  const handleInstall = async () => {
    try {
      await window.electronAPI?.installUpdate?.();
    } catch {}
  };

  if (dismissed) return null;

  if (status?.type === 'checking') {
    return (
      <div className="update-banner checking">
        <RefreshCw size={14} className="spin-icon" />
        <span>Verificando atualizações...</span>
      </div>
    );
  }

  if (status?.type === 'progress' || downloading) {
    return (
      <div className="update-banner downloading">
        <Download size={14} />
        <span>Baixando atualização... {progress}%</span>
        <div className="update-progress-bar"><div className="update-progress-fill" style={{ width: `${progress}%` }} /></div>
      </div>
    );
  }

  if (status?.type === 'available') {
    return (
      <div className="update-banner available">
        <Download size={14} />
        <span>Nova versão {status.version} disponível</span>
        <button className="btn btn-primary btn-sm" onClick={handleDownload}>Baixar</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>Depois</button>
      </div>
    );
  }

  if (status?.type === 'downloaded') {
    return (
      <div className="update-banner downloaded">
        <CheckCircle2 size={14} />
        <span>Atualização pronta — reinicie para instalar</span>
        <button className="btn btn-primary btn-sm" onClick={handleInstall}>Reiniciar agora</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>Depois</button>
      </div>
    );
  }

  if (status?.type === 'error') {
    return (
      <div className="update-banner error">
        <AlertCircle size={14} />
        <span>Falha ao verificar atualização</span>
        <button className="btn btn-ghost btn-sm" onClick={handleCheck}>Tentar de novo</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(true)}>×</button>
      </div>
    );
  }

  return null;
}
