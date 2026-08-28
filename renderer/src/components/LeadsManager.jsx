import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  PlusCircle,
  Play,
  Square,
  Trash2,
  Download,
  Edit2,
  Users,
  UploadCloud,
  ChevronLeft,
  ChevronRight,
  Globe,
  Instagram,
  Mail,
  Phone,
  Star,
  Sparkles,
  ExternalLink,
  MapPin
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { dedupeLeads, getLeadIdentity, getLeadStats, readLocalArray } from '../leadData';
import { useNotifications } from './NotificationCenter';

function LeadsManager({ onUpdateLeadsCount, addLog }) {
  const { addNotification } = useNotifications();

  // Load data from localStorage
  const [leads, setLeads] = useState(() => readLocalArray('sigma_leads'));
  const [searches, setSearches] = useState(() => readLocalArray('sigma_searches'));
  const [queue, setQueue] = useState(() => readLocalArray('sigma_queue'));
  
  const [activeSearchId, setActiveSearchId] = useState('__all__');
  const searchCarouselRef = useRef(null);

  const scrollSearches = (direction) => {
    const el = searchCarouselRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 320, behavior: 'smooth' });
  };
  
  // Input fields
  const [niche, setNiche] = useState('');
  const [neigh, setNeigh] = useState('');
  const [city, setCity] = useState('Rio de Janeiro');
  const [limit, setLimit] = useState(30);

  // Filters
  const [filterText, setFilterText] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterHas, setFilterHas] = useState('all');

  // Scraping state
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeScrapeId, setActiveScrapeId] = useState(null);
  const [progressPct, setProgressPct] = useState(0);

  // Rename modal state
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [renameTargetId, setRenameTargetId] = useState(null);

  // Save states to localStorage and propagate count to parent
  useEffect(() => {
    localStorage.setItem('sigma_leads', JSON.stringify(leads));
    onUpdateLeadsCount(dedupeLeads(leads).length);
  }, [leads, onUpdateLeadsCount]);

  useEffect(() => {
    localStorage.setItem('sigma_searches', JSON.stringify(searches));
  }, [searches]);

  useEffect(() => {
    localStorage.setItem('sigma_queue', JSON.stringify(queue));
  }, [queue]);

  // IPC progress hook
  useEffect(() => {
    if (window.electronAPI && typeof window.electronAPI.onProgress === 'function') {
      window.electronAPI.onProgress((msg) => {
        const m = msg.match(/\[(\d+)\/(\d+)\]/);
        if (m) {
          const pct = Math.round((parseInt(m[1]) / parseInt(m[2])) * 100);
          setProgressPct(pct);
        }
      });
    }
  }, []);

  const handleAddQueue = () => {
    const nicheTrim = niche.trim();
    const neighTrim = neigh.trim();
    const cityTrim = city.trim();
    if (!nicheTrim || !neighTrim) {
      addNotification({
        type: 'warning',
        category: 'scraper',
        title: 'Campos Obrigatórios',
        message: 'Preencha o nicho e o bairro para buscar.'
      });
      return;
    }
    const newItem = { niche: nicheTrim, neigh: neighTrim, city: cityTrim, max: parseInt(limit) || 30 };
    setQueue((prev) => [...prev, newItem]);
    setNiche('');
    setNeigh('');
    addLog(`[QUEUE] Adicionado à fila: ${nicheTrim} em ${neighTrim}`);
    addNotification({
      type: 'info',
      category: 'scraper',
      title: 'Item na Fila',
      message: `${nicheTrim} em ${neighTrim} adicionado à fila de busca.`,
      duration: 3000
    });
  };

  const handleRemoveQueueItem = (idx) => {
    setQueue(prev => prev.filter((_, i) => i !== idx));
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    addLog(`[SISTEMA] Lendo arquivo ${file.name}...`);
    
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet);
      
      if (rows.length === 0) {
        addNotification({
          type: 'warning',
          category: 'scraper',
          title: 'Planilha Vazia',
          message: 'O arquivo selecionado não contém dados.'
        });
        return;
      }
      
      const newLeads = rows.map((r, i) => {
        // Try to guess columns
        const name = r.Nome || r.name || r.NOME || r.Name || `Importado ${i}`;
        const phone = r.Telefone || r.telefone || r.Phone || r.phone || r.WhatsApp || r.whatsapp || null;
        const category = r.Categoria || r.category || r.Nicho || r.niche || "Importado";
        const email = r.Email || r.email || r.EMAIL || null;
        const website = r.Site || r.site || r.Website || r.website || null;
        
        return {
          id: Math.random().toString(36).slice(2),
          searchId: 'importados',
          name,
          phone: phone ? String(phone) : null,
          category,
          email,
          website,
          address: r.Endereco || r.address || r.Endereço || '',
          rating: r.Rating || r.rating || null,
          reviews: r.Reviews || r.reviews || null,
          instagram: r.Instagram || r.instagram || null,
          facebook: r.Facebook || r.facebook || null,
          linkedin: r.Linkedin || r.linkedin || null,
          source: 'import',
          importedAt: Date.now()
        };
      });
      
      // Also add 'importados' to searches if not exists
      setSearches(prev => {
        if (!prev.find(s => s.id === 'importados')) {
          return [...prev, { id: 'importados', label: 'Planilhas Importadas' }];
        }
        return prev;
      });

      setLeads((prev) => [...prev, ...newLeads]);
      addLog(`[SISTEMA] Importados ${newLeads.length} leads da planilha.`);
      addNotification({
        type: 'success',
        category: 'scraper',
        title: 'Planilha Importada',
        message: `Sucesso! ${newLeads.length} leads importados.`
      });
    } catch (err) {
      addLog(`[SISTEMA] Erro ao importar: ${err.message}`);
      addNotification({
        type: 'error',
        category: 'scraper',
        title: 'Erro na Importação',
        message: 'Não foi possível ler o arquivo. Verifique o formato.'
      });
    }
    // reset input
    e.target.value = null;
  };


  const handleCancelScrape = () => {
    if (activeScrapeId) {
      window.electronAPI?.cancelScrape?.(activeScrapeId).catch(() => {});
    }
    setIsProcessing(false);
    setActiveScrapeId(null);
    addLog(`[SISTEMA] Extração cancelada pelo usuário.`);
  };

  const handleProcessQueue = async () => {
    if (activeScrapeId) {
      window.electronAPI?.cancelScrape?.(activeScrapeId).catch(() => {});
    }
    setIsProcessing(false);
    setActiveScrapeId(null);
    
    if (queue.length === 0) return;

    setIsProcessing(true);
    setProgressPct(0);
    addLog(`[SISTEMA] Iniciando processamento da fila de buscas...`);

    const searchId = Date.now().toString();
    const qLabels = queue.map((q) => `${q.niche} em ${q.neigh}, ${q.city}`);
    const searchLabel = qLabels.join(" | ");
    const searchQuery = queue.map((q) => `${q.niche} ${q.neigh} ${q.city}`).join(" | ");

    const newSearch = {
      id: searchId,
      query: searchQuery,
      label: searchLabel,
      timestamp: Date.now(),
    };

    setSearches((prev) => [...prev, newSearch]);

    let totalAdded = 0;
    const currentQueue = [...queue];

    for (let qi = 0; qi < currentQueue.length; qi++) {
      const q = currentQueue[qi];
      const qstr = `${q.niche} ${q.neigh} ${q.city}`;
      const scrapeId = `${searchId}_${qi}`;
      setActiveScrapeId(scrapeId);
      addLog(`[SISTEMA] [${qi + 1}/${currentQueue.length}] Buscando "${qstr}"...`);

      try {
        const result = await window.electronAPI.startScrape(qstr, q.max, scrapeId);
        if (result && result.success && result.data && result.data.length > 0) {
          const existing = new Set(
            leads.map((l) => `${l.name}||${l.address}`.toLowerCase().trim())
          );
          
          const newLeads = result.data
            .filter((l) => l.name)
            .map((l) => ({
              ...l,
              id: Math.random().toString(36).slice(2),
              searchId,
            }));

          const added = newLeads.filter(
            (l) => !existing.has(`${l.name}||${l.address}`.toLowerCase().trim())
          );

          setLeads((prev) => [...prev, ...added]);
          totalAdded += added.length;
          addLog(`[SISTEMA] Encontrados ${result.count} leads, ${added.length} novos.`);
        }
      } catch (err) {
        addLog(`[SISTEMA] Erro ao extrair "${qstr}": ${err.message || err}`);
      }
    }

    setQueue([]);
    setIsProcessing(false);
    setActiveScrapeId(null);
    setActiveSearchId(searchId);
    addLog(`[SISTEMA] Concluído! total de ${totalAdded} leads adicionados.`);
    addNotification({
      type: 'success',
      category: 'scraper',
      title: 'Extração Concluída',
      message: `${totalAdded} novos leads encontrados e adicionados à sua base.`
    });
  };

  const getVisibleLeads = () => {
    let list = activeSearchId === '__all__'
      ? leads
      : leads.filter((l) => l.searchId === activeSearchId);

    // Deduplicate if showing all
    if (activeSearchId === '__all__') {
      list = dedupeLeads(list);
    }

    // Text Filter
    const ft = filterText.toLowerCase().trim();
    if (ft) {
      list = list.filter((l) =>
        `${l.name} ${l.phone} ${l.email} ${l.address} ${l.category}`
          .toLowerCase()
          .includes(ft)
      );
    }

    // Category Filter
    if (filterCategory && filterCategory !== 'all') {
      list = list.filter((l) => l.category === filterCategory);
    }

    // Attribute Filter
    if (filterHas === 'phone') list = list.filter((l) => l.phone);
    if (filterHas === 'website') list = list.filter((l) => l.website);
    if (filterHas === 'instagram') list = list.filter((l) => l.instagram);
    if (filterHas === 'email') list = list.filter((l) => l.email);

    return list;
  };

  const visibleLeads = getVisibleLeads();
  const categories = [...new Set(leads.map((l) => l.category).filter(Boolean))];

  // Stats Calculations
  const totalCount = visibleLeads.length;
  const phoneCount = visibleLeads.filter((l) => l.phone).length;
  const webCount = visibleLeads.filter((l) => l.website).length;
  const igCount = visibleLeads.filter((l) => l.instagram).length;
  const emailCount = visibleLeads.filter((l) => l.email).length;
  const getPct = (val) => (totalCount > 0 ? Math.round((val / totalCount) * 100) : 0);

  const handleExport = async (format) => {
    if (visibleLeads.length === 0) {
      addNotification({
        type: 'warning',
        category: 'scraper',
        title: 'Nenhum Lead para Exportar',
        message: 'A lista atual está vazia.'
      });
      return;
    }
    const res = await window.electronAPI.exportLeads(visibleLeads, format);
    if (res && res.success) {
      addNotification({
        type: 'success',
        category: 'scraper',
        title: 'Exportação Concluída',
        message: `Arquivo ${format.toUpperCase()} exportado com sucesso!`
      });
    } else {
      addNotification({
        type: 'error',
        category: 'scraper',
        title: 'Erro ao Exportar',
        message: res?.message || 'Não foi possível salvar o arquivo.'
      });
    }
  };

  const handleDeleteSearch = () => {
    if (activeSearchId === '__all__') return;
    if (window.confirm("Apagar esta pesquisa e seus leads?")) {
      setLeads((prev) => prev.filter((l) => l.searchId !== activeSearchId));
      setSearches((prev) => prev.filter((s) => s.id !== activeSearchId));
      setActiveSearchId('__all__');
      addLog(`[SISTEMA] Pesquisa apagada.`);
      addNotification({
        type: 'info',
        category: 'scraper',
        title: 'Pesquisa Apagada',
        message: 'Pesquisa e leads removidos com sucesso.',
        duration: 3000
      });
    }
  };

  const handleOpenRename = () => {
    if (activeSearchId === '__all__') return;
    const s = searches.find((x) => x.id === activeSearchId);
    if (!s) return;
    setRenameTargetId(activeSearchId);
    setRenameText(s.label || s.query);
    setIsRenameModalOpen(true);
  };

  const handleSaveRename = () => {
    setSearches((prev) => 
      prev.map((s) => (s.id === renameTargetId ? { ...s, label: renameText.trim() } : s))
    );
    setIsRenameModalOpen(false);
  };

  const handleScoringAudit = async (lead) => {
    if (!window.leadScoringAPI) {
      addNotification({
        type: 'error',
        category: 'scoring',
        title: 'API Indisponível',
        message: 'Módulo de Lead Scoring não carregado.'
      });
      return;
    }
    addLog(`[SCORING] Analisando site para ${lead.name}...`);
    try {
      const res = await window.leadScoringAPI.analyzeLead(lead);
      if (res && res.success) {
        const score = res.lead?.score?.value ?? res.lead?.score ?? 0;
        const details = res.lead?.siteAnalysis?.error || res.lead?.aiAnalysis?.resumo || 'Veja a aba Quem Ligar Primeiro';
        addLog(`[SCORING] Sucesso! Pontuação de ${lead.name}: ${score}`);
        addNotification({
          type: 'success',
          category: 'scoring',
          title: `Auditoria: ${lead.name}`,
          message: `Nota ${score}/100 gerada com sucesso! ${details}`
        });
      } else {
        addNotification({
          type: 'error',
          category: 'scoring',
          title: 'Falha na Auditoria',
          message: res?.error || res?.message || 'Verifique o log do sistema.'
        });
      }
    } catch (e) {
      addNotification({
        type: 'error',
        category: 'scoring',
        title: 'Erro na Auditoria',
        message: e.message
      });
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="info">
          <h1>Módulo de Leads</h1>
          <p>Configure buscas por nicho, bairro e cidade no Google Maps e filtre os resultados obtidos.</p>
        </div>
        <div className="toolbar-actions">
          {activeSearchId !== '__all__' && (
            <>
              <button className="btn btn-secondary" onClick={handleOpenRename}>
                <Edit2 size={14} /> Renomear
              </button>
              <button className="btn btn-danger" onClick={handleDeleteSearch}>
                <Trash2 size={14} /> Apagar
              </button>
            </>
          )}
          <div className="toolbar-actions">
            <label className="btn btn-secondary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <UploadCloud size={14} /> Importar (CSV/XLSX)
              <input type="file" accept=".csv, .xlsx, .xls" style={{ display: 'none' }} onChange={handleImportFile} />
            </label>
            <button className="btn btn-primary" onClick={() => handleExport('json')}>
              <Download size={14} /> Exportar JSON
            </button>
            <button className="btn btn-primary" onClick={() => handleExport('csv')}>
              <Download size={14} /> Exportar CSV
            </button>
          </div>
        </div>
      </div>

      {/* Search Configuration Fields + Queue (merged into one card) */}
      <div id="searchBar" className="wa-card search-config-card">
        <div className="search-config-header">
          <h4 className="section-title">
            <Search size={16} style={{ color: 'var(--accent)' }} /> Parâmetros de Busca
          </h4>
          <span className="badge accent" style={{ fontSize: '10px' }}>Google Maps Portátil</span>
        </div>
        <div id="searchFields" className="search-fields-grid">
          <input 
            type="text" 
            placeholder="Nicho (ex: Academia, Odontologia)"
            value={niche}
            onChange={(e) => setNiche(e.target.value)}
            disabled={isProcessing}
          />
          <input 
            type="text" 
            placeholder="Bairro (ex: Copacabana, Pinheiros)"
            value={neigh}
            onChange={(e) => setNeigh(e.target.value)}
            disabled={isProcessing}
          />
          <input 
            type="text" 
            placeholder="Cidade"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            disabled={isProcessing}
          />
          <input 
            type="number" 
            placeholder="Limite"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            disabled={isProcessing}
            min="1"
          />
        </div>
        <div id="searchActions" className="search-actions-row">
          <div className="search-actions-group">
            <button className="btn btn-secondary" onClick={handleAddQueue} disabled={isProcessing}>
              <PlusCircle size={14} /> Adicionar à Fila
            </button>
            {!isProcessing ? (
              <button className="btn btn-primary" onClick={handleProcessQueue} disabled={queue.length === 0}>
                <Play size={14} /> Processar Fila
              </button>
            ) : (
              <button className="btn btn-danger" onClick={handleCancelScrape}>
                <Square size={14} /> Cancelar ({progressPct}%)
              </button>
            )}
          </div>
          {isProcessing && <div className="sp" id="spinner"></div>}
        </div>

        {/* Inline Queue (inside the search card) */}
        {queue.length > 0 && (
          <div id="queueList" className="queue-list-inline">
            {queue.map((q, idx) => (
              <span key={idx} className="queue-item">
                <span>{q.niche} - {q.neigh}, {q.city} (máx: {q.max})</span>
                <span className="remove-btn" onClick={() => handleRemoveQueueItem(idx)}>×</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Select Search Filter */}
      <div className="search-carousel">
        <button 
          className={`search-carousel-primary btn ${activeSearchId === '__all__' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveSearchId('__all__')}
        >
          <Users size={14} /> Todos os Leads ({leads.length})
        </button>
        <button className="search-nav" onClick={() => scrollSearches(-1)} disabled={searches.length === 0} aria-label="Ver pesquisas anteriores">
          <ChevronLeft size={16} />
        </button>
        <div className="search-carousel-track" ref={searchCarouselRef}>
          {searches.map((s) => (
            <button 
              key={s.id}
              className={`search-chip btn ${activeSearchId === s.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveSearchId(s.id)}
              title={s.label || s.query}
            >
              {s.label || s.query}
            </button>
          ))}
        </div>
        <button className="search-nav" onClick={() => scrollSearches(1)} disabled={searches.length === 0} aria-label="Ver próximas pesquisas">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Filter Bar */}
      <div id="filterBar" style={{ marginBottom: 'var(--space-4)' }}>
        <input 
          type="text"
          id="filterText" 
          placeholder="Filtrar por nome, telefone, email, endereço..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">Todas categorias</option>
          {categories.map((c, i) => <option key={i} value={c}>{c}</option>)}
        </select>
        <select value={filterHas} onChange={(e) => setFilterHas(e.target.value)}>
          <option value="all">Todos</option>
          <option value="phone">Com telefone</option>
          <option value="website">Com site</option>
          <option value="instagram">Com Instagram</option>
          <option value="email">Com email</option>
        </select>
      </div>

      {/* Stats Row */}
      <div id="statsRow" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="mstat t-accent">
          <div className="lb">Resultados</div>
          <div className="vl" id="stTotal">{totalCount}</div>
        </div>
        <div className="mstat t-success">
          <div className="lb">Com Telefone</div>
          <div className="vl" id="stPhone">{phoneCount}</div>
          <div className="sb">{getPct(phoneCount)}%</div>
        </div>
        <div className="mstat t-web">
          <div className="lb">Com Site</div>
          <div className="vl" id="stWeb">{webCount}</div>
          <div className="sb">{getPct(webCount)}%</div>
        </div>
        <div className="mstat t-ig">
          <div className="lb">Com Instagram</div>
          <div className="vl" id="stIg">{igCount}</div>
          <div className="sb">{getPct(igCount)}%</div>
        </div>
        <div className="mstat t-email">
          <div className="lb">Com Email</div>
          <div className="vl" id="stEmail">{emailCount}</div>
          <div className="sb">{getPct(emailCount)}%</div>
        </div>
      </div>

      {/* Table Section */}
      <div className="table-section">
        <div className="table-header">
          <h2>Leads capturados</h2>
        </div>
        <div className="table-wrapper">
          {visibleLeads.length === 0 ? (
            <div className="empty">
              <div className="ic"><Search size={48} style={{ color: 'var(--muted)' }} /></div>
              <p>Nenhum lead encontrado com os filtros atuais.</p>
            </div>
          ) : (
            <table id="dataTable" className="leads-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nome</th>
                  <th>Categoria</th>
                  <th>Nota</th>
                  <th>Reviews</th>
                  <th>Telefone</th>
                  <th>Site</th>
                  <th>Instagram</th>
                  <th>Email</th>
                  <th>Endereço</th>
                  <th>Scoring</th>
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map((item, idx) => (
                  <tr key={item.id || idx}>
                    <td>{idx + 1}</td>
                    <td><strong>{item.name || '-'}</strong></td>
                    <td><span className="badge" style={{ fontSize: '11px', background: 'var(--hover-bg)' }}>{item.category || '-'}</span></td>
                    <td>
                      {item.rating ? (
                        <span className="rate" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <Star size={12} style={{ fill: '#f59e0b', color: '#f59e0b' }} />
                          {item.rating}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{item.totalReviews || '-'}</td>
                    <td>
                      {item.phone ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Phone size={12} style={{ color: 'var(--success)' }} />
                          {item.phone}
                        </span>
                      ) : '-'}
                    </td>
                    <td>
                      {item.website ? (
                        <a href={item.website} target="_blank" rel="noopener noreferrer" title={item.website} style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center' }}>
                          <Globe size={15} />
                        </a>
                      ) : (
                        <span style={{ color: 'var(--meta)' }}>-</span>
                      )}
                    </td>
                    <td>
                      {item.instagram ? (
                        <a href={item.instagram} target="_blank" rel="noopener noreferrer" title={item.instagram} style={{ color: '#e056a0', display: 'inline-flex', alignItems: 'center' }}>
                          <Instagram size={15} />
                        </a>
                      ) : (
                        <span style={{ color: 'var(--meta)' }}>-</span>
                      )}
                    </td>
                    <td>
                      {item.email ? (
                        <a href={`mailto:${item.email}`} title={item.email} style={{ color: '#3b82f6', display: 'inline-flex', alignItems: 'center' }}>
                          <Mail size={15} />
                        </a>
                      ) : (
                        <span style={{ color: 'var(--meta)' }}>-</span>
                      )}
                    </td>
                    <td className="truncate-address" title={item.address || ''}>
                      {item.address || '-'}
                    </td>
                    <td>
                      {item.website ? (
                        <button className="mini-score-btn" onClick={() => handleScoringAudit(item)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Sparkles size={12} /> Analisar
                        </button>
                      ) : (
                        <span className="score-muted">Sem site</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Rename Modal */}
      {isRenameModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content rename-modal">
            <div className="modal-header">
              <h3>Renomear pesquisa</h3>
            </div>
            <div className="modal-body rename-modal-body">
              <input
                id="renameInput"
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                placeholder="Nome da pesquisa..."
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setIsRenameModalOpen(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveRename}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default LeadsManager;
