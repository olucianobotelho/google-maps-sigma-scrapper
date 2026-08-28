import React, { useState } from 'react';
import {
  X,
  Search,
  Plus,
  Play,
  MapPin,
  Target,
  Sliders,
  Sparkles,
  Layers
} from 'lucide-react';

export default function NewExtractionModal({
  isOpen,
  onClose,
  onStartExtraction,
  onAddToQueue,
  isProcessing
}) {
  const [niche, setNiche] = useState('');
  const [neigh, setNeigh] = useState('');
  const [city, setCity] = useState('San Francisco');
  const [limit, setLimit] = useState(30);
  const [radius, setRadius] = useState('5km');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!niche.trim() || !neigh.trim()) return;
    onStartExtraction({ niche: niche.trim(), neigh: neigh.trim(), city: city.trim(), limit: parseInt(limit) || 30, radius });
    onClose();
  };

  const handleQueue = () => {
    if (!niche.trim() || !neigh.trim()) return;
    onAddToQueue({ niche: niche.trim(), neigh: neigh.trim(), city: city.trim(), max: parseInt(limit) || 30, radius });
    setNiche('');
    setNeigh('');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content new-extraction-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <Plus size={18} />
            </div>
            <div>
              <h3>Nova Extração Google Maps</h3>
              <p className="modal-subtitle">Configure os parâmetros de busca e enriquecimento de leads</p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label>Nicho / Palavra-Chave</label>
            <div className="input-with-icon">
              <Search size={16} className="field-icon" />
              <input
                type="text"
                placeholder="Ex: SaaS, Advocacia, Restaurantes, Clínicas"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className="form-row-grid">
            <div className="form-group">
              <label>Bairro ou Região</label>
              <div className="input-with-icon">
                <MapPin size={16} className="field-icon" />
                <input
                  type="text"
                  placeholder="Ex: Downtown, Pinheiros, Copacabana"
                  value={neigh}
                  onChange={(e) => setNeigh(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Cidade</label>
              <input
                type="text"
                placeholder="Ex: San Francisco, São Paulo, Rio de Janeiro"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row-grid">
            <div className="form-group">
              <label>Quantidade Máxima de Leads</label>
              <select value={limit} onChange={(e) => setLimit(e.target.value)}>
                <option value={10}>10 Leads (Rápido)</option>
                <option value={30}>30 Leads (Recomendado)</option>
                <option value={60}>60 Leads</option>
                <option value={100}>100 Leads</option>
                <option value={200}>200 Leads (Extensivo)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Raio de Busca Estimado</label>
              <select value={radius} onChange={(e) => setRadius(e.target.value)}>
                <option value="2km">2 km (Local / Hiperfocado)</option>
                <option value="5km">5 km (Padrão)</option>
                <option value="10km">10 km (Amplo)</option>
                <option value="25km">25 km (Metropolitano)</option>
              </select>
            </div>
          </div>

          <div className="modal-features-pill">
            <Sparkles size={14} style={{ color: 'var(--primary)' }} />
            <span>Enriquecimento automático de e-mails, telefones e redes sociais ativo</span>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleQueue}
              disabled={!niche.trim() || !neigh.trim()}
            >
              <Plus size={15} /> Adicionar à Fila
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!niche.trim() || !neigh.trim() || isProcessing}
            >
              <Play size={15} /> Iniciar Extração Agora
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
