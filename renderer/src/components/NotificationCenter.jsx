import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  X,
  Trash2,
  CheckCheck,
  Volume2,
  VolumeX,
  ChevronRight
} from 'lucide-react';

const NotificationContext = createContext(null);

// Web Audio API feedback chime
function playNotificationSound(type = 'info') {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'success') {
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'error' || type === 'warning') {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(330, now + 0.2);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.12); // E5
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch {
    // Ignore audio error
  }
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem('sigma_notifications');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [toasts, setToasts] = useState([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState('all'); // all | scraper | whatsapp | scoring | system
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem('sigma_sound_enabled') !== 'false';
    } catch {
      return true;
    }
  });

  // Save notifications
  useEffect(() => {
    try {
      localStorage.setItem('sigma_notifications', JSON.stringify(notifications.slice(0, 50)));
    } catch {
      // ignore
    }
  }, [notifications]);

  useEffect(() => {
    try {
      localStorage.setItem('sigma_sound_enabled', String(soundEnabled));
    } catch {
      // ignore
    }
  }, [soundEnabled]);

  const addNotification = useCallback(({
    title,
    message,
    type = 'info', // 'success' | 'warning' | 'error' | 'info'
    category = 'system', // 'scraper' | 'whatsapp' | 'scoring' | 'system'
    actionLabel = null,
    onAction = null,
    duration = 5000
  }) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newNotif = {
      id,
      title,
      message,
      type,
      category,
      actionLabel,
      timestamp: Date.now(),
      read: false,
    };

    setNotifications(prev => [newNotif, ...prev].slice(0, 50));

    // Add toast
    setToasts(prev => [...prev, { ...newNotif, onAction, duration }]);

    // Sound chime
    if (soundEnabled) {
      playNotificationSound(type);
    }

    // Auto remove toast
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }

    return id;
  }, [soundEnabled]);

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const markAsRead = (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const deleteNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  const filteredNotifications = notifications.filter(n => {
    if (activeFilter === 'all') return true;
    return n.category === activeFilter;
  });

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      addNotification,
      markAsRead,
      markAllAsRead,
      clearAll,
      deleteNotification,
      isDrawerOpen,
      setIsDrawerOpen,
      soundEnabled,
      setSoundEnabled
    }}>
      {children}

      {/* Floating Toast Area (Top-Right) */}
      <div className="toast-container" aria-live="polite">
        {toasts.map(toast => {
          const Icon = toast.type === 'success' ? CheckCircle2
            : toast.type === 'warning' ? AlertTriangle
            : toast.type === 'error' ? AlertCircle
            : Info;

          return (
            <div key={toast.id} className={`toast-card toast-${toast.type}`}>
              <div className="toast-icon-wrap">
                <Icon size={18} className="toast-icon" />
              </div>
              <div className="toast-body">
                <div className="toast-title">{toast.title}</div>
                {toast.message && <div className="toast-message">{toast.message}</div>}
                {toast.actionLabel && (
                  <button
                    className="toast-action-btn"
                    onClick={() => {
                      if (typeof toast.onAction === 'function') toast.onAction();
                      removeToast(toast.id);
                    }}
                  >
                    {toast.actionLabel} <ChevronRight size={12} />
                  </button>
                )}
              </div>
              <button
                className="toast-close"
                onClick={() => removeToast(toast.id)}
                aria-label="Fechar notificação"
              >
                <X size={14} />
              </button>
              {toast.duration > 0 && (
                <div
                  className="toast-progress-bar"
                  style={{ animationDuration: `${toast.duration}ms` }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Slide-out Notification Center Drawer */}
      {isDrawerOpen && (
        <div className="notification-drawer-overlay" onClick={() => setIsDrawerOpen(false)}>
          <div className="notification-drawer" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title-group">
                <Bell size={18} style={{ color: 'var(--accent)' }} />
                <h3>Central de Notificações</h3>
                {unreadCount > 0 && (
                  <span className="drawer-unread-badge">{unreadCount}</span>
                )}
              </div>
              <div className="drawer-header-actions">
                <button
                  className="drawer-action-icon"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  title={soundEnabled ? "Desativar alertas sonoros" : "Ativar alertas sonoros"}
                >
                  {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} style={{ color: 'var(--muted)' }} />}
                </button>
                {unreadCount > 0 && (
                  <button
                    className="drawer-action-btn"
                    onClick={markAllAsRead}
                    title="Marcar todas como lidas"
                  >
                    <CheckCheck size={14} /> Lidas
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    className="drawer-action-btn text-danger"
                    onClick={clearAll}
                    title="Limpar todas as notificações"
                  >
                    <Trash2 size={14} /> Limpar
                  </button>
                )}
                <button
                  className="drawer-close-btn"
                  onClick={() => setIsDrawerOpen(false)}
                  aria-label="Fechar painel"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="drawer-filter-tabs">
              <button
                className={`drawer-tab ${activeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setActiveFilter('all')}
              >
                Todas ({notifications.length})
              </button>
              <button
                className={`drawer-tab ${activeFilter === 'scraper' ? 'active' : ''}`}
                onClick={() => setActiveFilter('scraper')}
              >
                Scraper
              </button>
              <button
                className={`drawer-tab ${activeFilter === 'whatsapp' ? 'active' : ''}`}
                onClick={() => setActiveFilter('whatsapp')}
              >
                WhatsApp
              </button>
              <button
                className={`drawer-tab ${activeFilter === 'scoring' ? 'active' : ''}`}
                onClick={() => setActiveFilter('scoring')}
              >
                Scoring
              </button>
            </div>

            {/* Notifications List */}
            <div className="drawer-content">
              {filteredNotifications.length === 0 ? (
                <div className="drawer-empty">
                  <Bell size={32} style={{ opacity: 0.2, marginBottom: '12px' }} />
                  <p>Nenhuma notificação por aqui</p>
                  <span>Os alertas e resultados de tarefas aparecerão nesta central.</span>
                </div>
              ) : (
                <div className="drawer-list">
                  {filteredNotifications.map(notif => {
                    const Icon = notif.type === 'success' ? CheckCircle2
                      : notif.type === 'warning' ? AlertTriangle
                      : notif.type === 'error' ? AlertCircle
                      : Info;

                    const timeAgo = formatTimeAgo(notif.timestamp);

                    return (
                      <div
                        key={notif.id}
                        className={`drawer-item ${!notif.read ? 'unread' : ''} type-${notif.type}`}
                        onClick={() => markAsRead(notif.id)}
                      >
                        <div className="drawer-item-icon">
                          <Icon size={16} />
                        </div>
                        <div className="drawer-item-body">
                          <div className="drawer-item-top">
                            <span className="drawer-item-title">{notif.title}</span>
                            <span className="drawer-item-time">{timeAgo}</span>
                          </div>
                          {notif.message && (
                            <p className="drawer-item-msg">{notif.message}</p>
                          )}
                        </div>
                        <button
                          className="drawer-item-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNotification(notif.id);
                          }}
                          title="Excluir notificação"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return ctx;
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'Agora';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}
