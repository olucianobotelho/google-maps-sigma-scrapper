import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapPin,
  Mail,
  Phone,
  Globe,
  Instagram,
  Layers,
  Filter,
  Download,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Users,
  Sparkles,
  Play,
  Square,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Table,
  Map as MapIcon,
  Copy,
  Check,
  ChevronDown,
  FileSpreadsheet
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { dedupeLeads, readLocalArray } from '../leadData';
import { useNotifications } from './NotificationCenter';

// Dicionário extensivo de coordenadas de cidades e bairros brasileiros
const MAP_LAYERS = {
  streets: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    subdomains: 'abc',
    maxZoom: 19,
  },
  humanitarian: {
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors, HOT',
    subdomains: 'abc',
    maxZoom: 19,
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap © OpenTopoMap',
    subdomains: 'abc',
    maxZoom: 17,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxZoom: 18,
  },
};

const LAYER_LABELS = {
  streets: 'Ruas',
  humanitarian: 'Humanitário',
  topo: 'Relevo',
  satellite: 'Satélite',
};

const LAYER_FALLBACK = {
  streets: 'humanitarian',
  humanitarian: 'streets',
  topo: 'streets',
  satellite: 'streets',
};

function getStoredMapLayer() {
  try {
    const saved = localStorage.getItem('sigma_map_layer');
    if (saved && MAP_LAYERS[saved]) return saved;
  } catch {}
  return 'streets';
}

const GEO_DICT = {
  // Rio de Janeiro e Bairros
  'paciência': [-22.8988, -43.6429],
  'paciencia': [-22.8988, -43.6429],
  'campo grande': [-22.9035, -43.5594],
  'santa cruz': [-22.9200, -43.6850],
  'bangu': [-22.8756, -43.4667],
  'realengo': [-22.8789, -43.4319],
  'madureira': [-22.8722, -43.3378],
  'tijuca': [-22.9248, -43.2328],
  'barra da tijuca': [-23.0003, -43.3659],
  'barra': [-23.0003, -43.3659],
  'recreio': [-23.0278, -43.4639],
  'jacarepaguá': [-22.9358, -43.3428],
  'jacarepagua': [-22.9358, -43.3428],
  'freguesia': [-22.9328, -43.3411],
  'taquara': [-22.9198, -43.3688],
  'vila valqueire': [-22.8894, -43.3667],
  'méier': [-22.8997, -43.2797],
  'meier': [-22.8997, -43.2797],
  'centro': [-22.9068, -43.1829],
  'lapa': [-22.9133, -43.1800],
  'copacabana': [-22.9698, -43.1868],
  'ipanema': [-22.9840, -43.2045],
  'leblon': [-22.9844, -43.2239],
  'botafogo': [-22.9510, -43.1810],
  'flamengo': [-22.9310, -43.1780],
  'rio de janeiro': [-22.9068, -43.1729],
  'niterói': [-22.8833, -43.1039],
  'niteroi': [-22.8833, -43.1039],
  'duque de caxias': [-22.7856, -43.3117],
  'nova iguaçu': [-22.7556, -43.4603],
  'nova iguacu': [-22.7556, -43.4603],
  'são gonçalo': [-22.8269, -43.0539],
  'sao goncalo': [-22.8269, -43.0539],

  // São Paulo e Bairros
  'são paulo': [-23.5505, -46.6333],
  'sao paulo': [-23.5505, -46.6333],
  'pinheiros': [-23.5617, -46.6928],
  'vila madalena': [-23.5547, -46.6908],
  'moema': [-23.6015, -46.6617],
  'vila mariana': [-23.5896, -46.6346],
  'itaim bibi': [-23.5843, -46.6789],
  'jardins': [-23.5658, -46.6678],
  'bela vista': [-23.5620, -46.6470],
  'paulista': [-23.5615, -46.6559],
  'santana': [-23.5042, -46.6269],
  'tatuapé': [-23.5404, -46.5768],
  'tatuape': [-23.5404, -46.5768],
  'mooca': [-23.5540, -46.6020],
  'morumbi': [-23.6022, -46.7214],
  'santo amaro': [-23.6536, -46.7083],
  'campinas': [-22.9099, -47.0626],
  'santos': [-23.9608, -46.3331],
  'guarulhos': [-23.4542, -46.5333],

  // Outras Capitais
  'curitiba': [-25.4284, -49.2733],
  'belo horizonte': [-19.9167, -43.9345],
  'brasília': [-15.7975, -47.8919],
  'brasilia': [-15.7975, -47.8919],
  'salvador': [-12.9777, -38.5016],
  'fortaleza': [-3.7319, -38.5267],
  'recife': [-8.0476, -34.8770],
  'porto alegre': [-30.0346, -51.2177],
  'florianópolis': [-27.5954, -48.5480],
  'florianopolis': [-27.5954, -48.5480],
  'goiânia': [-16.6869, -49.2648],
  'goiania': [-16.6869, -49.2648],
  'manaus': [-3.1190, -60.0217],
  'belém': [-1.4558, -48.5039],
  'belem': [-1.4558, -48.5039],
  'vitória': [-20.3155, -40.3128],
  'vitoria': [-20.3155, -40.3128],
  'san francisco': [37.7749, -122.4194]
};

// Resolução inteligente de coordenadas com base em texto e CEP
function resolveLeadLocation(address = '', query = '') {
  const combined = (address + ' ' + query).toLowerCase();

  // 1. Busca por CEPs conhecidos da Zona Oeste RJ
  if (/235\d{2}-\d{3}/.test(combined)) {
    return [-22.8988, -43.6429]; // Paciência / Zona Oeste RJ
  }
  if (/230\d{2}-\d{3}/.test(combined)) {
    return [-22.9035, -43.5594]; // Campo Grande RJ
  }

  // 2. Busca por termos no dicionário
  for (const [key, coords] of Object.entries(GEO_DICT)) {
    if (combined.includes(key)) {
      return coords;
    }
  }

  // 3. Fallbacks por estado
  if (combined.includes('rj') || combined.includes('rio')) return [-22.9068, -43.1829];
  if (combined.includes('sp') || combined.includes('paulo')) return [-23.5505, -46.6333];
  if (combined.includes('mg') || combined.includes('minas')) return [-19.9167, -43.9345];
  if (combined.includes('pr') || combined.includes('paraná')) return [-25.4284, -49.2733];

  return [-22.9068, -43.1829];
}

// Marcador limpo
function createPinIcon(hasEmail = false, isSelected = false) {
  const bg = isSelected ? '#2563EB' : hasEmail ? '#10B981' : '#475569';
  const size = isSelected ? 22 : 16;
  return L.divIcon({
    className: 'custom-leaflet-marker',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: ${bg};
        border: 2px solid #FFFFFF;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      ">
        <div style="width: 4px; height: 4px; background: #FFF; border-radius: 50%;"></div>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

export default function MapScraperView({
  onUpdateLeadsCount,
  addLog,
  onOpenNewExtraction
}) {
  const { addNotification } = useNotifications();

  const [leads, setLeads] = useState(() => readLocalArray('sigma_leads'));
  const [searches, setSearches] = useState(() => readLocalArray('sigma_searches'));
  const [activeSearchId, setActiveSearchId] = useState('__all__');

  // Estado de processamento
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeScrapeId, setActiveScrapeId] = useState(null);
  const [progressPct, setProgressPct] = useState(0);

  // Interface e visualização
  const [viewMode, setViewMode] = useState('map'); // 'map' | 'table'
  const [mapLayer, setMapLayer] = useState(() => getStoredMapLayer());
  const [tileErrorCount, setTileErrorCount] = useState(0);
  const tileErrorCountRef = useRef(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const leadCardRefs = useRef({});

  // Sincronizar contagem global
  useEffect(() => {
    localStorage.setItem('sigma_leads', JSON.stringify(leads));
    onUpdateLeadsCount(dedupeLeads(leads).length);
  }, [leads, onUpdateLeadsCount]);

  useEffect(() => {
    localStorage.setItem('sigma_searches', JSON.stringify(searches));
  }, [searches]);

  // IPC de progresso do Playwright
  useEffect(() => {
    if (window.electronAPI && typeof window.electronAPI.onProgress === 'function') {
      const cleanup = window.electronAPI.onProgress((msg) => {
        const m = msg.match(/\[(\d+)\/(\d+)\]/);
        if (m) {
          const pct = Math.round((parseInt(m[1]) / parseInt(m[2])) * 100);
          setProgressPct(pct);
        }
      });
      return cleanup;
    }
  }, []);

  // Determinar pesquisa ativa
  const currentSearchObj = useMemo(() => {
    if (activeSearchId === '__all__') return null;
    return searches.find((s) => s.id === activeSearchId);
  }, [activeSearchId, searches]);

  const activeQueryLabel = useMemo(() => {
    if (currentSearchObj) {
      return currentSearchObj.label || currentSearchObj.query || 'Pesquisa Selecionada';
    }
    if (searches.length > 0) {
      return searches[0].label || searches[0].query || 'Todas as Extrações';
    }
    return 'Todas as Extrações';
  }, [currentSearchObj, searches]);

  // Filtragem de leads
  const visibleLeads = useMemo(() => {
    let list = activeSearchId === '__all__'
      ? dedupeLeads(leads)
      : leads.filter((l) => l.searchId === activeSearchId);

    const st = searchTerm.toLowerCase().trim();
    if (st) {
      list = list.filter((l) =>
        `${l.name} ${l.phone} ${l.email} ${l.address} ${l.category}`
          .toLowerCase()
          .includes(st)
      );
    }
    return list;
  }, [leads, activeSearchId, searchTerm]);

  const totalFound = visibleLeads.length;
  const emailsFound = visibleLeads.filter((l) => l.email).length;
  const yieldPct = totalFound > 0 ? Math.round((emailsFound / totalFound) * 100) : 0;

  // Inicializar Mapa Leaflet
  useEffect(() => {
    if (viewMode !== 'map' || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const initialCenter = resolveLeadLocation(visibleLeads[0]?.address, activeQueryLabel);

      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: 13,
        zoomControl: false,
        attributionControl: true
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const layerCfg = MAP_LAYERS[mapLayer] || MAP_LAYERS.streets;
      const tileLayer = L.tileLayer(layerCfg.url, {
        maxZoom: layerCfg.maxZoom,
        attribution: layerCfg.attribution,
        subdomains: layerCfg.subdomains || 'abc',
      });
      tileLayer.on('tileerror', () => {
        tileErrorCountRef.current += 1;
        setTileErrorCount(tileErrorCountRef.current);
        if (tileErrorCountRef.current >= 4) {
          const fallback = LAYER_FALLBACK[mapLayer];
          if (fallback && MAP_LAYERS[fallback]) {
            setMapLayer(fallback);
            tileErrorCountRef.current = 0;
          }
        }
      });
      tileLayer.addTo(map);
      mapInstanceRef.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);

      setTimeout(() => {
        map.invalidateSize();
      }, 200);
    } else {
      setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 100);
    }

    const handleResize = () => mapInstanceRef.current?.invalidateSize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [viewMode]);

  useEffect(() => {
    try { localStorage.setItem('sigma_map_layer', mapLayer); } catch {}
    tileErrorCountRef.current = 0;
    setTileErrorCount(0);
  }, [mapLayer]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!markersLayerRef.current) return;

    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        map.removeLayer(layer);
      }
    });

    const cfg = MAP_LAYERS[mapLayer] || MAP_LAYERS.streets;
    const layer = L.tileLayer(cfg.url, {
      maxZoom: cfg.maxZoom,
      attribution: cfg.attribution,
      subdomains: cfg.subdomains || 'abc',
    });
    layer.on('tileerror', () => {
      tileErrorCountRef.current += 1;
      setTileErrorCount(tileErrorCountRef.current);
      if (tileErrorCountRef.current >= 4) {
        const fallback = LAYER_FALLBACK[mapLayer];
        if (fallback && MAP_LAYERS[fallback]) {
          setMapLayer(fallback);
          tileErrorCountRef.current = 0;
        }
      }
    });
    layer.addTo(map);
    if (markersLayerRef.current && !map.hasLayer(markersLayerRef.current)) {
      markersLayerRef.current.addTo(map);
    }
  }, [mapLayer]);

  const markersMapRef = useRef(new Map());

  // Renderizar Marcadores no Mapa (Apenas quando a lista de leads ou a pesquisa mudar)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markers = markersLayerRef.current;
    if (!map || !markers) return;

    markers.clearLayers();
    markersMapRef.current.clear();

    const bounds = [];
    const leadsToRender = visibleLeads.slice(0, 80);

    const skippedCount = { current: 0 };
    leadsToRender.forEach((lead, i) => {
      const leadKey = lead.id || i;

      const rawLat = parseFloat(lead.latitude ?? lead.lat ?? lead.geocodeLat ?? '');
      const rawLng = parseFloat(lead.longitude ?? lead.lng ?? lead.geocodeLng ?? '');
      const hasRealCoords = Number.isFinite(rawLat) && Number.isFinite(rawLng) && Math.abs(rawLat) > 0.1 && Math.abs(rawLng) > 0.1;
      const isPrecise = hasRealCoords && (lead.coordSource === 'poi' || lead.coordSource === 'meta');
      const isGeocoded = hasRealCoords && lead.coordSource === 'nominatim';
      const isViewportJunk = hasRealCoords && lead.coordSource === 'viewport';
      const shouldShow = hasRealCoords && (isPrecise || isGeocoded) && !isViewportJunk;
      const geoLat = parseFloat(lead.geocodeLat ?? lead.geocode?.lat ?? '');
      const geoLng = parseFloat(lead.geocodeLng ?? lead.geocode?.lng ?? '');
      const hasGeoCoords = !shouldShow && Number.isFinite(geoLat) && Number.isFinite(geoLng) && Math.abs(geoLat) > 0.1;

      let lat, lng;
      let coordSource = 'sem-coord';
      let coordConfidence = 'none';
      if (shouldShow) {
        lat = rawLat;
        lng = rawLng;
        coordSource = lead.coordSource || 'poi';
        coordConfidence = lead.geocodeConfidence || 'exact';
      } else if (hasGeoCoords) {
        lat = geoLat;
        lng = geoLng;
        coordSource = 'nominatim';
        coordConfidence = lead.geocodeConfidence || 'approximate';
      } else if (hasRealCoords && !isViewportJunk) {
        lat = rawLat;
        lng = rawLng;
        coordSource = lead.coordSource || 'url';
        coordConfidence = lead.geocodeConfidence || 'approximate';
      } else {
        skippedCount.current += 1;
        return;
      }

      const hasEmail = Boolean(lead.email);
      const marker = L.marker([lat, lng], {
        icon: createPinIcon(hasEmail, false)
      });

      const precise = coordSource === 'poi' || coordSource === 'meta' || coordConfidence === 'exact';
      const confidenceBadge = precise ? '✓ exato' : coordConfidence === 'approximate' ? '~ aproximado' : coordSource === 'nominatim' ? '~ geocodificado' : '? bairro';
      const confidenceColor = precise ? '#059669' : coordSource === 'nominatim' ? '#0EA5E9' : coordConfidence === 'approximate' ? '#D97706' : '#94A3B8';
      marker.bindPopup(`
        <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 200px; padding: 4px;">
          <h4 style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #0F172A;">${lead.name || 'Empresa'}</h4>
          <div style="font-size: 11px; color: #64748B; margin-bottom: 6px;">${lead.category || 'Estabelecimento'}</div>
          ${lead.phone ? `<div style="font-size: 11px; margin-bottom: 2px;"><strong>Telefone:</strong> ${lead.phone}</div>` : ''}
          ${lead.email ? `<div style="font-size: 11px; margin-bottom: 2px;"><strong>E-mail:</strong> ${lead.email}</div>` : ''}
          ${lead.address ? `<div style="font-size: 10px; color: #94A3B8; margin-top: 4px;">📍 ${lead.address}</div>` : ''}
          <div style="font-size: 10px; color: ${confidenceColor}; margin-top: 4px;">${confidenceBadge} · ${coordSource}</div>
        </div>
      `);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedLeadId(leadKey);

        // Focar no mapa suavemente SEM resetar o zoom do usuário
        map.panTo([lat, lng], { animate: true, duration: 0.4 });
        marker.openPopup();

        // Rolar card no feed lateral
        const cardEl = leadCardRefs.current[leadKey];
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      markers.addLayer(marker);
      markersMapRef.current.set(leadKey, { marker, lead, hasEmail, lat, lng });
      bounds.push([lat, lng]);
    });

    if (skippedCount.current > 0) {
      console.warn(`[MAP] ${skippedCount.current} leads sem coordenada precisa — ocultos (re-scrape para geocodificar)`);
    }
    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
      } catch {}
    } else {
      const defaultCenter = resolveLeadLocation('', activeQueryLabel);
      map.setView(defaultCenter, 13);
    }
  }, [visibleLeads, activeQueryLabel]);

  // Efeito dedicado para atualizar o destaque visual do marcador selecionado
  useEffect(() => {
    markersMapRef.current.forEach(({ marker, hasEmail }, key) => {
      const isSelected = key === selectedLeadId;
      marker.setIcon(createPinIcon(hasEmail, isSelected));
      if (isSelected) {
        marker.setZIndexOffset(1000);
      } else {
        marker.setZIndexOffset(0);
      }
    });
  }, [selectedLeadId]);

  // Ao selecionar um card no feed, centralizar suavemente no marcador correspondente
  const handleSelectLeadFromFeed = (lead, idx) => {
    const leadKey = lead.id || idx;
    setSelectedLeadId(leadKey);

    const item = markersMapRef.current.get(leadKey);
    const map = mapInstanceRef.current;
    if (item && map) {
      map.panTo([item.lat, item.lng], { animate: true, duration: 0.4 });
      item.marker.openPopup();
    } else if (map) {
      const baseCoords = resolveLeadLocation(lead.address, activeQueryLabel);
      map.panTo(baseCoords, { animate: true, duration: 0.4 });
    }
  };

  // Exportar dados
  const handleExport = async (format = 'csv') => {
    if (visibleLeads.length === 0) {
      addNotification({
        type: 'warning',
        category: 'scraper',
        title: 'Lista Vazia',
        message: 'Nenhum lead disponível para exportação.'
      });
      return;
    }
    const res = await window.electronAPI?.exportLeads?.(visibleLeads, format);
    if (res && res.success) {
      addNotification({
        type: 'success',
        category: 'scraper',
        title: 'Exportado com Sucesso',
        message: `Arquivo ${format.toUpperCase()} gerado no seu computador.`
      });
    }
  };

  const copyText = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    addNotification({
      type: 'info',
      category: 'system',
      title: 'Copiado para Área de Transferência',
      message: text,
      duration: 1800
    });
  };

  return (
    <div className="map-scraper-layout">
      {/* Painel Central (Mapa ou Tabela) */}
      <div className="map-center-panel">
        {viewMode === 'map' ? (
          <div className="map-wrapper">
            <div id="leafletMap" ref={mapContainerRef} className="map-canvas" />

            {/* Card Flutuante Superior Esquerdo com Seletor de Busca */}
            <div className="map-floating-scan-card">
              <div className="scan-card-icon">
                <MapPin size={16} style={{ color: 'var(--app-primary)' }} />
              </div>
              <div className="scan-card-info">
                <span className="scan-label">PESQUISA ATIVA</span>
                <div className="scan-dropdown-wrap">
                  <select
                    className="scan-select-dropdown"
                    value={activeSearchId}
                    onChange={(e) => setActiveSearchId(e.target.value)}
                  >
                    <option value="__all__">Todas as Extrações ({dedupeLeads(leads).length} leads)</option>
                    {searches.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || s.query}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={`scan-status-pill ${isProcessing ? 'active' : 'idle'}`}>
                <span className="pulsing-dot" />
                <span>{isProcessing ? `Extraindo... (${progressPct}%)` : 'Pronto'}</span>
              </div>
            </div>

            {/* Controles Flutuantes Superiores Direitos */}
            <div className="map-floating-controls">
              <div className="map-layer-switcher" title="Camada do mapa — gratuita">
                {Object.keys(MAP_LAYERS).map((key) => (
                  <button
                    key={key}
                    className={`map-layer-btn ${mapLayer === key ? 'active' : ''}`}
                    onClick={() => setMapLayer(key)}
                    title={`${LAYER_LABELS[key]} — ${MAP_LAYERS[key].attribution}`}
                  >
                    {LAYER_LABELS[key]}
                  </button>
                ))}
              </div>
              <button
                className={`map-ctrl-btn ${mapLayer === 'satellite' ? 'active' : ''}`}
                onClick={() => setMapLayer(mapLayer === 'satellite' ? 'streets' : 'satellite')}
                title="Alternar rápido Ruas/Satélite"
              >
                <Layers size={16} />
              </button>
              <button
                className="map-ctrl-btn"
                onClick={() => setViewMode('table')}
                title="Alternar para Modo Planilha"
              >
                <Table size={16} />
              </button>
            </div>

            {/* Barra de Telemetria Flutuante Inferior */}
            <div className="map-floating-telemetry">
              <div className="telemetry-item">
                <span className="tel-label">Raio:</span>
                <span className="tel-val">5 km</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span className="tel-label">Termos:</span>
                <span className="tel-val">'{activeQueryLabel.slice(0, 26)}'</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span className="tel-label">Profundidade:</span>
                <span className="tel-val">Nível 2</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item time-remaining">
                <span className="tel-label">Total Filtrado:</span>
                <span className="tel-val">{totalFound.toLocaleString()} Leads</span>
              </div>
            </div>
          </div>
        ) : (
          /* Visualização Alternativa em Tabela */
          <div className="table-full-view">
            <div className="table-top-bar">
              <div className="table-view-switch">
                <button className="btn btn-secondary" onClick={() => setViewMode('map')}>
                  <MapIcon size={15} /> Voltar ao Mapa
                </button>
              </div>
              <div className="table-search-box">
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Filtrar por nome, telefone, e-mail..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="table-wrapper">
              <table className="leads-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Empresa</th>
                    <th>Categoria</th>
                    <th>Telefone</th>
                    <th>E-mail</th>
                    <th>Website</th>
                    <th>Instagram</th>
                    <th>Endereço</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLeads.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td>{idx + 1}</td>
                      <td><strong>{item.name || '-'}</strong></td>
                      <td><span className="feed-badge feed-badge-gray">{item.category || 'Geral'}</span></td>
                      <td>{item.phone || '-'}</td>
                      <td>{item.email || '-'}</td>
                      <td>
                        {item.website ? (
                          <a href={item.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--app-primary)' }}>
                            <Globe size={14} />
                          </a>
                        ) : '-'}
                      </td>
                      <td>
                        {item.instagram ? (
                          <a href={item.instagram} target="_blank" rel="noopener noreferrer" style={{ color: '#E056A0' }}>
                            <Instagram size={14} />
                          </a>
                        ) : '-'}
                      </td>
                      <td className="truncate-address">{item.address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Painel Direito (Métricas e Feed em Tempo Real) */}
      <aside className="feed-right-panel">
        {/* Cards de Métricas Superiores */}
        <div className="kpi-cards-grid">
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">LEADS ENCONTRADOS</span>
              <div className="kpi-icon-wrap blue">
                <Users size={16} />
              </div>
            </div>
            <div className="kpi-value-row">
              <span className="kpi-value">{totalFound.toLocaleString()}</span>
              <span className="kpi-trend">↑12%</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">E-MAILS EXTRAÍDOS</span>
              <div className="kpi-icon-wrap outline-blue">
                <Mail size={16} />
              </div>
            </div>
            <div className="kpi-value-row">
              <span className="kpi-value">{emailsFound.toLocaleString()}</span>
              <span className="kpi-subtext">{yieldPct}% Taxa</span>
            </div>
          </div>
        </div>

        {/* Cabeçalho do Feed */}
        <div className="feed-header-row">
          <h3>Feed de Extração ao Vivo</h3>
          <div className="feed-streaming-badge">
            <span className="feed-streaming-dot" />
            <span>{isProcessing ? 'TRANSMITINDO' : 'SINCRONIZADO'}</span>
          </div>
        </div>

        {/* Lista Rolável de Leads */}
        <div className="feed-list-scroll">
          {visibleLeads.length === 0 ? (
            <div className="feed-empty-state" style={{ textAlign:'center', padding:'28px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <div className="empty-circle-icon" style={{ width:48, height:48, borderRadius:999, background:'var(--surface-2)', border:'1px solid var(--border)', display:'grid', placeItems:'center', color:'var(--muted)' }}>
                <Search size={22} />
              </div>
              <h4 style={{ fontSize:13, fontWeight:700 }}>Nenhum lead nesta seleção</h4>
              <p style={{ fontSize:11.5, color:'var(--muted)', maxWidth:240, lineHeight:1.5 }}>Comece em 1 clique. A extração enriquece e-mails e telefones automaticamente.</p>
              <button className="btn btn-primary" style={{ marginTop:4, height:32, padding:'0 12px', borderRadius:8, fontSize:12, fontWeight:600 }} onClick={() => onOpenNewExtraction?.()}>
                ＋ Nova extração
              </button>
            </div>
          ) : (
            visibleLeads.map((lead, idx) => {
              const hasEmail = Boolean(lead.email);
              const isProcessingItem = isProcessing && idx === 0;
              const isSelected = selectedLeadId === (lead.id || idx);

              return (
                <div
                  key={lead.id || idx}
                  ref={(el) => (leadCardRefs.current[lead.id || idx] = el)}
                  className={`feed-item-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectLeadFromFeed(lead, idx)}
                >
                  <div className="feed-item-top">
                    <div className="feed-item-title-group">
                      {isSelected && <span className="blue-active-dot" />}
                      <span className="feed-company-name">{lead.name || 'Empresa Local'}</span>
                    </div>

                    {isProcessingItem ? (
                      <span className="feed-badge feed-badge-gray">
                        PROCESSANDO
                      </span>
                    ) : hasEmail ? (
                      <span className="feed-badge feed-badge-green">
                        VERIFICADO
                      </span>
                    ) : (
                      <span className="feed-badge feed-badge-red">
                        SEM E-MAIL
                      </span>
                    )}
                  </div>

                  <div className="feed-item-location">
                    <MapPin size={12} className="loc-pin-icon" />
                    <span>{lead.address || lead.category || 'Localização identificada'}</span>
                  </div>

                  <div className="feed-item-pills-row">
                    {isProcessingItem ? (
                      <div className="feed-pill loading-pill">
                        <Loader2 size={12} className="spin-icon" />
                        <span>Buscando contatos...</span>
                      </div>
                    ) : (
                      <>
                        {lead.email && (
                          <div
                            className="feed-pill email-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyText(lead.email, `email_${lead.id || idx}`);
                            }}
                            title="Clique para copiar e-mail"
                          >
                            <Mail size={12} />
                            <span>{lead.email}</span>
                            {copiedId === `email_${lead.id || idx}` ? <Check size={11} /> : null}
                          </div>
                        )}

                        {lead.phone && (
                          <div
                            className="feed-pill phone-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyText(lead.phone, `phone_${lead.id || idx}`);
                            }}
                            title="Clique para copiar telefone"
                          >
                            <Phone size={12} />
                            <span>{lead.phone}</span>
                            {copiedId === `phone_${lead.id || idx}` ? <Check size={11} /> : null}
                          </div>
                        )}

                        {lead.website && (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="feed-pill website-pill"
                            title={lead.website}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Globe size={12} />
                          </a>
                        )}

                        {lead.instagram && (
                          <a
                            href={lead.instagram}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="feed-pill ig-pill"
                            title={lead.instagram}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Instagram size={12} />
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Ações Inferiores de Exportação */}
        <div className="feed-bottom-action-group">
          <button
            className="btn btn-export-csv"
            onClick={() => handleExport('csv')}
            disabled={visibleLeads.length === 0}
          >
            Exportar CSV
          </button>
          <button
            className="btn btn-export-xlsx"
            onClick={() => handleExport('xlsx')}
            disabled={visibleLeads.length === 0}
            title="Exportar em formato Excel (.xlsx)"
          >
            <FileSpreadsheet size={15} />
          </button>
        </div>
      </aside>
    </div>
  );
}
