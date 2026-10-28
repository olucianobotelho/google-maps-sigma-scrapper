import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  MapPin,
  Mail,
  Phone,
  Globe,
  Instagram,
  Filter,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Users,
  Sparkles,
  ExternalLink,
  Table,
  Map as MapIcon,
  Check,
  ChevronDown,
  FileSpreadsheet,
  X,
  Navigation,
  Info
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  dedupeLeads,
  getExtractionSearches,
  hasLeadingLeadAddressNoise,
  normalizeLeadAddress,
  normalizeLeadCollection,
  readLocalArray,
} from '../leadData';
import { useNotifications } from './NotificationCenter';
import { instagramProfileUrl, normalizeInstagram, isRealWebsite } from '../leadLinks.mjs';

const BASEMAPS = {
  padrao: {
    key: 'padrao',
    label: 'Padrão',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    subdomains: 'abc',
    maxZoom: 19,
  },
  satelite: {
    key: 'satelite',
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    subdomains: 'abc',
    maxZoom: 18,
  },
  terreno: {
    key: 'terreno',
    label: 'Terreno',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap, OpenTopoMap (CC-BY-SA)',
    subdomains: 'abc',
    maxZoom: 17,
  }
};

const DEFAULT_MAP_CENTER = [-14.235, -51.9253];
const DEFAULT_MAP_ZOOM = 4;

function toCoordinateNumber(value) {
  if (value == null || String(value).trim() === '') return Number.NaN;
  return Number(value);
}

function isValidCoordinatePair(lat, lng) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
    && !(lat === 0 && lng === 0);
}

function parseCanonicalGoogleCoordinates(url = '') {
  let decoded = String(url);
  try { decoded = decodeURIComponent(decoded); } catch {}
  const match = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return isValidCoordinatePair(lat, lng) ? { lat, lng } : null;
}

function getExactLeadLocation(lead = {}) {
  const canonicalCoords = parseCanonicalGoogleCoordinates(
    lead.googleMapsUrl || lead.mapsUrl || lead.google_maps_url || ''
  );
  if (canonicalCoords) {
    return { ...canonicalCoords, source: 'Google Maps' };
  }

  const lat = toCoordinateNumber(lead.latitude ?? lead.lat);
  const lng = toCoordinateNumber(lead.longitude ?? lead.lng);
  if (!isValidCoordinatePair(lat, lng)) return null;

  const source = String(lead.coordSource || '').toLowerCase();
  if (source === 'poi' || source === 'meta') {
    return { lat, lng, source: 'Google Maps' };
  }
  if (source === 'nominatim' && String(lead.geocodeConfidence || '').toLowerCase() === 'exact') {
    return { lat, lng, source: 'endereço exato' };
  }
  return { lat, lng, source: 'coordenada' };
}

function readStoredUserLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem('sigma_ref') || 'null');
    const lat = toCoordinateNumber(saved?.lat);
    const lng = toCoordinateNumber(saved?.lng);
    if (isValidCoordinatePair(lat, lng)) {
      return {
        lat,
        lng,
        label: saved?.label || 'Sua referência',
        accuracy: Number.isFinite(Number(saved.accuracy)) ? Number(saved.accuracy) : null,
      };
    }
  } catch {}
  return null;
}

function distM(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtD(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(1).replace('.', ',') + ' km';
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// O processo de coleta pode receber mensagens de uma versão anterior do
// scraper. A interface nunca expõe essas mensagens técnicas em inglês.
function formatProgressMessage(value) {
  const message = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!message) return '';
  if (/^Launching browser/i.test(message)) return 'Abrindo o navegador para a extração…';
  if (/^Loading results/i.test(message)) return 'Carregando os resultados encontrados…';
  if (/^No results found/i.test(message)) return 'Nenhum resultado foi encontrado no Google Maps.';
  if (/^Scrape cancelled/i.test(message)) return 'Extração cancelada.';

  const found = message.match(/\bFound:\s*(\d+)/i);
  if (found) return `${found[1]} empresa${found[1] === '1' ? '' : 's'} encontrada${found[1] === '1' ? '' : 's'} na lista do Google Maps.`;

  const extracting = message.match(/^Extracting\s+(\d+)\s+places/i);
  if (extracting) return `Iniciando a extração de ${extracting[1]} empresa${extracting[1] === '1' ? '' : 's'}…`;

  const skipped = message.match(/^\[(\d+)\/(\d+)\]\s+skip/i);
  if (skipped) return `Empresa ${skipped[1]} de ${skipped[2]} ignorada por dados incompletos.`;

  const legacyLead = message.match(/^\[(\d+)\/(\d+)\]\s+(.+)$/);
  if (legacyLead) return `Empresa ${legacyLead[1]} de ${legacyLead[2]} extraída: ${legacyLead[3]}`;

  const retry = message.match(/^Retry\s+(\d+)\/(\d+)\s+in\s+(\d+)ms/i);
  if (retry) return `Nova tentativa ${retry[1]} de ${retry[2]} em ${Math.round(Number(retry[3]) / 1000)} s…`;

  const done = message.match(/^Done!\s*(\d+)\s+places/i);
  if (done) return `Extração concluída: ${done[1]} empresa${done[1] === '1' ? '' : 's'} extraída${done[1] === '1' ? '' : 's'}.`;

  if (/^Error:/i.test(message)) return `Erro durante a extração: ${message.replace(/^Error:\s*/i, '')}`;
  return message;
}

// Accessors
function getLeadName(l) { return l.name || l.n || 'Empresa'; }
function getLeadCat(l) { return l.category || l.cat || 'Geral'; }
function getLeadPhone(l) { return l.phone || l.tel || ''; }
function getLeadEmail(l) { return l.email || l.mail || ''; }
function getLeadWebsite(l) { return isRealWebsite(l.website || l.site) ? (l.website || l.site) : ''; }
function getLeadIg(l) {
  const raw = l.instagram || l.ig || '';
  return normalizeInstagram(raw) || raw;
}
function getLeadBairro(l) { return l.neighborhood || l.bairro || l.hood || ''; }
function getLeadCity(l) { return l.city || l.cidade || ''; }
function getLeadState(l) { return l.state || l.uf || ''; }
function getLeadRating(l) { return l.rating != null ? l.rating : (l.rn != null ? l.rn : 0); }
function getLeadReviews(l) { return l.reviews != null ? l.reviews : (l.reviewCount != null ? l.reviewCount : (l.rc != null ? l.rc : 0)); }
function getLeadScore(l) { return l.score != null ? l.score : (l.s != null ? l.s : 0); }

export default function MapScraperView({
  onUpdateLeadsCount,
  addLog,
  onOpenNewExtraction,
  activeExtraction,
}) {
  const { addNotification } = useNotifications();

  const [leads, setLeads] = useState(() => normalizeLeadCollection(readLocalArray('sigma_leads')));
  const [liveLeads, setLiveLeads] = useState([]);
  const [searches, setSearches] = useState(() => getExtractionSearches(readLocalArray('sigma_searches')));

  // Estado de processamento
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [isProgressDetailsOpen, setIsProgressDetailsOpen] = useState(false);
  const [progressDetails, setProgressDetails] = useState({
    status: 'idle',
    message: 'Aguardando extração',
    current: 0,
    total: 0,
    found: 0,
    neighborhood: '',
  });
  const [progressLog, setProgressLog] = useState([]);
  const [mapTileError, setMapTileError] = useState('');

  // Basemap
  const [baseKey, setBaseKey] = useState(() => {
    try {
      const b = localStorage.getItem('sigma_base');
      if (b && BASEMAPS[b]) return b;
    } catch {}
    return 'padrao';
  });

  // User location
  const [userLocation, setUserLocation] = useState(() => readStoredUserLocation());
  const [locAddrQuery, setLocAddrQuery] = useState('');
  const [locSuggestions, setLocSuggestions] = useState([]);
  const [isSearchingLoc, setIsSearchingLoc] = useState(false);
  const [locationError, setLocationError] = useState('');

  // Popovers & Drawers
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [isBasePopOpen, setIsBasePopOpen] = useState(false);
  const [isLocPopOpen, setIsLocPopOpen] = useState(false);
  const [isListPopOpen, setIsListPopOpen] = useState(false);

  // Filtros do Map Filter Drawer
  const [filterCat, setFilterCat] = useState('');
  const [filterScore, setFilterScore] = useState(0);
  const [filterTel, setFilterTel] = useState('');
  const [filterOrd, setFilterOrd] = useState('score'); // 'score' | 'rating' | 'name'

  // Filtros do Feed Dock / List Pop
  const [feedSearch, setFeedSearch] = useState('');
  const [listNicho, setListNicho] = useState('');
  const [listUf, setListUf] = useState('');
  const [listCidade, setListCidade] = useState('');
  const [listBairro, setListBairro] = useState('');

  // Seleção e foco
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const userMarkerRef = useRef(null);
  const leadCardRefs = useRef({});
  const markersMapRef = useRef(new Map());
  const autoLocationAttemptedRef = useRef(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const locDebounceRef = useRef(null);
  const tileErrorsRef = useRef(0);
  const repairedAddressKeysRef = useRef(new Set());
  const addressRepairInFlightRef = useRef(false);
  const liveLeadSequenceRef = useRef(0);

  const repairDirtyStoredAddresses = useCallback(async (rawLeads) => {
    if (typeof window.electronAPI?.repairMapAddresses !== 'function' || addressRepairInFlightRef.current) return;
    const candidates = (Array.isArray(rawLeads) ? rawLeads : [])
      .filter((lead) => lead && (lead.needsMapAddressRepair || hasLeadingLeadAddressNoise(lead.address)) && !getExactLeadLocation(lead))
      .map((lead) => {
        const key = String(lead.id || `${lead.name || ''}||${normalizeLeadAddress(lead.address)}`);
        return { key, address: lead.address, city: getLeadCity(lead), state: getLeadState(lead) };
      })
      .filter((lead) => lead.address && !repairedAddressKeysRef.current.has(lead.key));

    if (!candidates.length) return;
    candidates.forEach((lead) => repairedAddressKeysRef.current.add(lead.key));
    addressRepairInFlightRef.current = true;
    try {
      const result = await window.electronAPI.repairMapAddresses(candidates);
      if (!result?.success || !Array.isArray(result.repaired)) {
        addressRepairInFlightRef.current = false;
        return;
      }
      const byKey = new Map(result.repaired.map((lead) => [String(lead.key), lead]));
      const repairedWithCoordinates = result.repaired.filter((lead) => isValidCoordinatePair(Number(lead.latitude), Number(lead.longitude))).length;
      setLeads((current) => current.map((lead) => {
        const key = String(lead.id || `${lead.name || ''}||${normalizeLeadAddress(lead.address)}`);
        const repaired = byKey.get(key);
        return repaired ? {
          ...lead,
          address: repaired.address || normalizeLeadAddress(lead.address),
          ...(isValidCoordinatePair(Number(repaired.latitude), Number(repaired.longitude)) ? {
            latitude: repaired.latitude,
            longitude: repaired.longitude,
            coordSource: repaired.coordSource || 'nominatim',
            geocodeConfidence: repaired.geocodeConfidence || 'approximate',
            needsMapAddressRepair: false,
          } : {}),
        } : lead;
      }));
      if (repairedWithCoordinates) {
        addNotification({
          type: 'success',
          category: 'system',
          title: 'Endereços corrigidos',
          message: `${repairedWithCoordinates} endereço(s) antigo(s) foram localizados no mapa.`,
        });
      }
      if (Array.isArray(result.failures) && result.failures.length) {
        addNotification({
          type: 'warning',
          category: 'system',
          title: 'Alguns endereços serão tentados depois',
          message: `${result.failures.length} endereço(s) não puderam ser geocodificados agora.`,
        });
      }
      addressRepairInFlightRef.current = false;
    } catch {
      addressRepairInFlightRef.current = false;
      // A limpeza local ainda acontece; a próxima abertura pode tentar geocodificar de novo.
    }
  }, [addNotification]);

  useEffect(() => {
    if (!activeExtraction?.id) {
      setLiveLeads([]);
      return;
    }
    liveLeadSequenceRef.current = 0;
    setLiveLeads([]);
    setIsProcessing(true);
    setProgressPct(0);
    setIsProgressDetailsOpen(false);
    setProgressDetails({
      status: 'started',
      message: 'Preparando a extração…',
      current: 0,
      total: 0,
      found: 0,
      neighborhood: activeExtraction.currentNeighborhood || '',
    });
    setProgressLog([]);
  }, [activeExtraction?.id]);

  // Sincronizar contagem global
  useEffect(() => {
    localStorage.setItem('sigma_leads', JSON.stringify(leads));
    onUpdateLeadsCount?.(dedupeLeads(leads).length);
  }, [leads, onUpdateLeadsCount]);

  useEffect(() => {
    const refreshStoredData = () => {
      const rawLeads = readLocalArray('sigma_leads');
      setLeads(normalizeLeadCollection(rawLeads));
      repairDirtyStoredAddresses(rawLeads);
      setSearches(getExtractionSearches(readLocalArray('sigma_searches')));
    };
    refreshStoredData();
    window.addEventListener('sigma:leads-updated', refreshStoredData);
    window.addEventListener('storage', refreshStoredData);
    return () => {
      window.removeEventListener('sigma:leads-updated', refreshStoredData);
      window.removeEventListener('storage', refreshStoredData);
    };
  }, [repairDirtyStoredAddresses]);

  // IPC de progresso do Playwright
  useEffect(() => {
    if (window.electronAPI && typeof window.electronAPI.onProgress === 'function') {
      const cleanup = window.electronAPI.onProgress((entry) => {
        const payload = typeof entry === 'string'
          ? { message: entry, status: /error|cancel/i.test(entry) ? 'failed' : 'running' }
          : (entry || {});
        if (activeExtraction?.id && payload.queryId && payload.queryId !== activeExtraction.id) return;
        const completedBatch = payload.status === 'completed' && payload.batchComplete !== false;
        const terminal = ['failed', 'cancelled'].includes(payload.status) || completedBatch;
        if (!terminal) setIsProcessing(true);
        if (Number.isFinite(Number(payload.current)) && Number(payload.total) > 0) {
          const targetCount = Math.max(1, Number(payload.totalNeighborhoods) || activeExtraction?.neighborhoods?.length || 1);
          const targetIndex = Math.max(0, Math.min(targetCount - 1, Number(payload.neighborhoodIndex) || 0));
          const targetPct = Math.max(0, Math.min(1, Number(payload.current) / Number(payload.total)));
          setProgressPct(Math.round(((targetIndex + targetPct) / targetCount) * 100));
        }
        setProgressDetails((previous) => ({
          ...previous,
          ...payload,
          found: Number.isFinite(Number(payload.found)) ? Number(payload.found) : previous.found,
        }));
        if (payload.lead && typeof payload.lead === 'object') {
          const sequence = liveLeadSequenceRef.current += 1;
          const [normalizedLead] = normalizeLeadCollection([{
            ...payload.lead,
            id: payload.lead.id || `live-${payload.queryId || activeExtraction?.id || 'scrape'}-${sequence}`,
            searchId: payload.lead.searchId || payload.queryId || activeExtraction?.id,
          }]);
          if (normalizedLead?.name) {
            setLiveLeads((previous) => dedupeLeads([...previous, normalizedLead]));
          }
        }
        if (payload.message) {
          setProgressLog((previous) => {
            const message = formatProgressMessage(payload.message);
            if (!message || previous.at(-1)?.message === message) return previous;
            return [...previous, { message, status: payload.status || 'running', timestamp: Date.now() }].slice(-8);
          });
        }
        if (terminal) {
          setIsProcessing(false);
          setProgressPct(payload.status === 'completed' ? 100 : 0);
        }
      });
      return cleanup;
    }
  }, [activeExtraction?.id]);

  // Enquanto a extração está em andamento, os leads recém-coletados ficam no
  // mapa e no feed antes de a transação final ser gravada na base local.
  const displayLeads = useMemo(
    () => dedupeLeads([...liveLeads, ...leads]),
    [leads, liveLeads],
  );
  const liveLeadIds = useMemo(
    () => new Set(liveLeads.map((lead) => String(lead.id))),
    [liveLeads],
  );

  // Lista de leads visíveis filtrada
  const visibleLeads = useMemo(() => {
    const nq = norm(feedSearch.trim());

    return displayLeads.filter((lead) => {
      const name = getLeadName(lead);
      const cat = getLeadCat(lead);
      const tel = getLeadPhone(lead);
      const mail = getLeadEmail(lead);
      const hood = getLeadBairro(lead);
      const city = getLeadCity(lead);
      const uf = getLeadState(lead);
      const score = getLeadScore(lead);

      // Filter Drawer
      if (filterCat && cat !== filterCat) return false;
      if (filterScore > 0 && score < filterScore) return false;
      if (filterTel === 'yes' && !tel) return false;

      // Feed List Pop
      if (listNicho && cat !== listNicho) return false;
      if (listUf && uf !== listUf) return false;
      if (listCidade && city !== listCidade) return false;
      if (listBairro && hood !== listBairro) return false;

      // Text search
      if (nq) {
        const full = norm(`${name} ${cat} ${hood} ${city} ${uf} ${tel} ${mail}`);
        if (!full.includes(nq)) return false;
      }

      return true;
    }).sort((a, b) => {
      if (filterOrd === 'score') return getLeadScore(b) - getLeadScore(a);
      if (filterOrd === 'rating') return getLeadRating(b) - getLeadRating(a);
      if (filterOrd === 'name') return getLeadName(a).localeCompare(getLeadName(b), 'pt-BR');
      return 0;
    });
  }, [
    displayLeads,
    feedSearch,
    filterCat,
    filterScore,
    filterTel,
    filterOrd,
    listNicho,
    listUf,
    listCidade,
    listBairro,
  ]);

  // Contagem de filtros ativos do feed
  const activeListFiltersCount = useMemo(() => {
    let count = 0;
    if (feedSearch) count++;
    if (listNicho) count++;
    if (listUf) count++;
    if (listCidade) count++;
    if (listBairro) count++;
    return count;
  }, [feedSearch, listNicho, listUf, listCidade, listBairro]);

  // Opções únicas para filtros
  const uniqueCategories = useMemo(() => {
    return [...new Set(displayLeads.map(getLeadCat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [displayLeads]);

  const uniqueUfs = useMemo(() => {
    return [...new Set(displayLeads.map(getLeadState).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [displayLeads]);

  const uniqueCities = useMemo(() => {
    return [...new Set(displayLeads.map(getLeadCity).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [displayLeads]);

  const uniqueBairros = useMemo(() => {
    return [...new Set(displayLeads.map(getLeadBairro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [displayLeads]);

  const attachTileDiagnostics = useCallback((tile) => {
    tileErrorsRef.current = 0;
    setMapTileError('');
    tile.on('load', () => {
      tileErrorsRef.current = 0;
      setMapTileError('');
    });
    tile.on('tileerror', () => {
      tileErrorsRef.current += 1;
      if (tileErrorsRef.current >= 2) {
        setMapTileError('Não foi possível carregar o mapa base. Verifique sua conexão ou tente outro tipo de mapa.');
      }
    });
  }, []);

  // Inicializar Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let initialInvalidateTimer = null;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        zoomControl: false,
        attributionControl: true,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      const cfg = BASEMAPS[baseKey] || BASEMAPS.padrao;
      const tile = L.tileLayer(cfg.url, {
        maxZoom: cfg.maxZoom,
        attribution: cfg.attribution,
        subdomains: cfg.subdomains || 'abc',
      }).addTo(map);

      attachTileDiagnostics(tile);

      tileLayerRef.current = tile;
      mapInstanceRef.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);
      setIsMapReady(true);

      initialInvalidateTimer = window.setTimeout(() => {
        // A rota pode ter sido trocada antes do primeiro repaint do Leaflet.
        // Nunca invalida uma instância que já foi removida no cleanup.
        if (mapInstanceRef.current !== map) return;
        try { map.invalidateSize(); } catch {}
      }, 150);
    }

    const handleResize = () => {
      try { mapInstanceRef.current?.invalidateSize(); } catch {}
    };
    window.addEventListener('resize', handleResize);
    return () => {
      if (initialInvalidateTimer) window.clearTimeout(initialInvalidateTimer);
      window.removeEventListener('resize', handleResize);
      try { markersLayerRef.current?.clearLayers(); } catch {}
      try { mapInstanceRef.current?.remove(); } catch {}
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      markersLayerRef.current = null;
      userMarkerRef.current = null;
      markersMapRef.current.clear();
      setIsMapReady(false);
    };
  }, [attachTileDiagnostics]);

  // Ao abrir o Scraper, o mapa parte do Brasil e aproxima a referência salva
  // ou a localização concedida pelo navegador. Sem permissão, mantém o mapa
  // utilizável e não cria uma notificação de erro intrusiva.
  useEffect(() => {
    if (!isMapReady || autoLocationAttemptedRef.current) return undefined;
    const map = mapInstanceRef.current;
    if (!map) return undefined;
    autoLocationAttemptedRef.current = true;
    let cancelled = false;

    const flyToLocation = (location) => {
      window.setTimeout(() => {
        if (cancelled || mapInstanceRef.current !== map) return;
        try {
          map.invalidateSize();
          map.flyTo([location.lat, location.lng], 13, { duration: 1.15, easeLinearity: 0.22 });
        } catch {}
      }, 180);
    };

    const saved = readStoredUserLocation();
    if (saved) {
      flyToLocation(saved);
      return () => { cancelled = true; };
    }
    if (!navigator.geolocation) return () => { cancelled = true; };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        if (cancelled || !isValidCoordinatePair(lat, lng)) return;
        const location = {
          lat,
          lng,
          label: 'Sua posição',
          accuracy: Number.isFinite(Number(position.coords.accuracy)) ? Number(position.coords.accuracy) : null,
        };
        setUserLocation(location);
        flyToLocation(location);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 }
    );

    return () => { cancelled = true; };
  }, [isMapReady]);

  // Atualizar camada de basemap quando baseKey mudar
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const cfg = BASEMAPS[baseKey] || BASEMAPS.padrao;
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const nextTile = L.tileLayer(cfg.url, {
      maxZoom: cfg.maxZoom,
      attribution: cfg.attribution,
      subdomains: cfg.subdomains || 'abc',
    }).addTo(map);

    attachTileDiagnostics(nextTile);
    tileLayerRef.current = nextTile;
    try { localStorage.setItem('sigma_base', baseKey); } catch {}
  }, [attachTileDiagnostics, baseKey]);

  // Atualizar marcador de referência do usuário
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (userMarkerRef.current) {
      map.removeLayer(userMarkerRef.current);
      userMarkerRef.current = null;
    }

    if (userLocation && isValidCoordinatePair(userLocation.lat, userLocation.lng)) {
      const marker = L.marker([userLocation.lat, userLocation.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="me"></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        title: userLocation.label || 'Sua referência',
        zIndexOffset: 600,
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family: var(--font-body); font-size: 12px; padding: 4px;">
          <b>${userLocation.label || 'Sua referência'}</b>
          <div style="color: var(--muted); font-size: 11px; margin-top: 2px;">Ponto de referência ativo</div>
        </div>
      `);

      userMarkerRef.current = marker;
    }
  }, [userLocation]);

  // Renderizar Marcadores de Leads
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markers = markersLayerRef.current;
    if (!map || !markers) return;

    markers.clearLayers();
    markersMapRef.current.clear();

    const bounds = [];
    const leadsWithCoords = visibleLeads;

    leadsWithCoords.forEach((lead, idx) => {
      const loc = getExactLeadLocation(lead);
      if (!loc) return;

      const leadId = lead.id || `lead_${idx}`;
      const isSel = leadId === selectedLeadId;
      const name = getLeadName(lead);
      const cat = getLeadCat(lead);
      const phone = getLeadPhone(lead);
      const rating = getLeadRating(lead);
      const reviews = getLeadReviews(lead);
      const hood = getLeadBairro(lead) || getLeadCity(lead);

      const marker = L.marker([loc.lat, loc.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="lp${isSel ? ' sel' : ''}"></div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -15],
        }),
        title: name,
      });

      marker.bindPopup(`
        <div class="lp-pop">
          <b>${name}</b>
          <div class="m">${hood ? `${hood} · ` : ''}★ ${rating} (${reviews})</div>
          <div class="m" ${phone ? 'data-sensitive-phone="true"' : ''}>${phone || cat}</div>
          <button type="button" data-lead-key="${leadId}">Ver no feed</button>
        </div>
      `);

      marker.on('click', () => {
        handleSpotlightLead(lead, leadId, loc.lat, loc.lng, false);
      });

      markers.addLayer(marker);
      markersMapRef.current.set(leadId, { marker, lat: loc.lat, lng: loc.lng, lead });
      bounds.push([loc.lat, loc.lng]);
    });

    if (bounds.length > 0 && !selectedLeadId) {
      try {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
      } catch {}
    }
  }, [visibleLeads, selectedLeadId]);

  // Efeito para delegar clique do botão "Ver no feed" dentro do popup Leaflet
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handlePopupOpen = (e) => {
      const el = e.popup?.getElement();
      if (!el) return;
      const btn = el.querySelector('[data-lead-key]');
      if (btn) {
        btn.onclick = () => {
          const key = btn.getAttribute('data-lead-key');
          setSelectedLeadId(key);
          const cardEl = leadCardRefs.current[key];
          if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            cardEl.classList.remove('flash');
            void cardEl.offsetWidth;
            cardEl.classList.add('flash');
          }
        };
      }
    };

    map.on('popupopen', handlePopupOpen);
    return () => map.off('popupopen', handlePopupOpen);
  }, []);

  // Spotlight lead (pan map, trigger ping animation, select card)
  const handleSpotlightLead = useCallback((lead, leadId, lat, lng, pan = true) => {
    setSelectedLeadId(leadId);

    const map = mapInstanceRef.current;
    const item = markersMapRef.current.get(leadId);

    if (item && map) {
      if (pan) {
        map.flyTo([lat || item.lat, lng || item.lng], 15, { duration: 0.8 });
      }
      item.marker.openPopup();

      const el = item.marker.getElement();
      if (el) {
        const lpDiv = el.querySelector('.lp');
        if (lpDiv) {
          lpDiv.classList.remove('ping');
          void lpDiv.offsetWidth;
          lpDiv.classList.add('ping');
          setTimeout(() => lpDiv.classList.remove('ping'), 1300);
        }
      }
    }

    const cardEl = leadCardRefs.current[leadId];
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);

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
        message: `leads_${Date.now()}.${format} com ${visibleLeads.length} registros.`
      });
    } else {
      addNotification({
        type: 'info',
        category: 'scraper',
        title: 'Exportação',
        message: `${visibleLeads.length} leads prontos para envio.`
      });
    }
  };

  // Preparar WhatsApp
  const handleWhatsAppLead = (lead) => {
    const name = getLeadName(lead);
    const phone = getLeadPhone(lead);
    if (!phone) {
      addNotification({
        type: 'warning',
        category: 'whatsapp',
        title: 'Sem Telefone',
        message: `${name} não possui número de telefone cadastrado.`
      });
      return;
    }
    try {
      localStorage.setItem('sigma_wa_pending', JSON.stringify({ name, tel: phone }));
    } catch {}
    addNotification({
      type: 'success',
      category: 'whatsapp',
      title: 'Conversa Preparada',
      message: `${name} · ${phone} — continue no módulo WhatsApp.`
    });
  };

  // Usar localização atual
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      addNotification({
        type: 'warning',
        category: 'system',
        title: 'Localização indisponível',
        message: 'Este dispositivo não oferece geolocalização.',
      });
      return;
    }

    addNotification({
      type: 'info',
      category: 'system',
      title: 'Localizando…',
      message: 'Aguarde a posição do seu dispositivo.',
    });

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        if (!isValidCoordinatePair(lat, lng)) {
          addNotification({
            type: 'warning',
            category: 'system',
            title: 'Localização inválida',
            message: 'O dispositivo não retornou coordenadas utilizáveis.',
          });
          return;
        }

        const nextRef = {
          lat,
          lng,
          label: 'Sua posição',
          accuracy: Number.isFinite(Number(position.coords.accuracy)) ? Number(position.coords.accuracy) : null,
        };
        try { localStorage.setItem('sigma_ref', JSON.stringify(nextRef)); } catch {}
        setUserLocation(nextRef);
        setIsLocPopOpen(false);

        mapInstanceRef.current?.flyTo([lat, lng], 13, { duration: 0.8 });
        addNotification({
          type: 'success',
          category: 'system',
          title: 'Localização definida',
          message: 'Sua posição foi definida como ponto de referência.',
        });
      },
      (error) => {
        addNotification({
          type: 'warning',
          category: 'system',
          title: 'Localização negada',
          message: 'Permita o acesso à localização no seu dispositivo.',
        });
      },
      { timeout: 9000 }
    );
  };

  // Busca de endereço com Nominatim
  const handleAddrSearchChange = (text) => {
    setLocAddrQuery(text);
    setLocationError('');
    clearTimeout(locDebounceRef.current);
    const query = normalizeLeadAddress(text);
    if (query.length < 4) {
      setLocSuggestions([]);
      return;
    }
    locDebounceRef.current = setTimeout(() => {
      setIsSearchingLoc(true);
      fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=br&q=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json' }
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Serviço de endereço indisponível (${res.status}).`);
          return res.json();
        })
        .then((data) => {
          setIsSearchingLoc(false);
          if (Array.isArray(data)) {
            setLocSuggestions(
              data.map((item) => ({
                label: String(item.display_name).split(',').slice(0, 3).join(','),
                full: item.display_name,
                lat: Number(item.lat),
                lng: Number(item.lon),
              }))
            );
          }
          if (!Array.isArray(data) || data.length === 0) setLocationError('Nenhum endereço foi encontrado. Tente incluir cidade e estado.');
        })
        .catch((error) => {
          setIsSearchingLoc(false);
          setLocSuggestions([]);
          setLocationError(error?.message || 'Não foi possível buscar endereços agora.');
        });
    }, 350);
  };

  const handlePickAddress = (suggestion) => {
    const nextRef = {
      lat: suggestion.lat,
      lng: suggestion.lng,
      label: suggestion.label,
    };
    try { localStorage.setItem('sigma_ref', JSON.stringify(nextRef)); } catch {}
    setUserLocation(nextRef);
    setLocSuggestions([]);
    setLocAddrQuery('');
    setIsLocPopOpen(false);

    mapInstanceRef.current?.flyTo([suggestion.lat, suggestion.lng], 14, { duration: 0.8 });
    addNotification({
      type: 'success',
      category: 'system',
      title: 'Localização definida',
      message: `${suggestion.label} · distâncias em linha reta calculadas.`,
    });
  };

  const handleClearLocation = () => {
    setUserLocation(null);
    try { localStorage.removeItem('sigma_ref'); } catch {}
    setIsLocPopOpen(false);
    addNotification({
      type: 'info',
      category: 'system',
      title: 'Referência removida',
      message: 'Ponto de referência apagado do mapa.',
    });
  };

  const handleCancelExtraction = async () => {
    if (!activeExtraction?.id || !window.electronAPI?.cancelScrape) return;
    try {
      const result = await window.electronAPI.cancelScrape(activeExtraction.id);
      if (!result?.success || !result.cancelled) throw new Error(result?.error || 'Nenhuma extração ativa foi encontrada.');
      setIsProcessing(false);
      setProgressPct(0);
      addNotification({
        type: 'info',
        category: 'scraper',
        title: 'Cancelamento solicitado',
        message: 'A busca atual será encerrada mantendo os resultados já salvos na base.',
      });
    } catch (error) {
      addNotification({
        type: 'error',
        category: 'scraper',
        title: 'Não foi possível cancelar',
        message: error?.message || 'Tente novamente em alguns segundos.',
      });
    }
  };

  const handleClearListFilters = () => {
    setFeedSearch('');
    setListNicho('');
    setListUf('');
    setListCidade('');
    setListBairro('');
    setIsListPopOpen(false);
  };

  const handleResetAllFilters = () => {
    handleClearListFilters();
    setFilterCat('');
    setFilterScore(0);
    setFilterTel('');
    setFilterOrd('score');
    setIsFilterDrawerOpen(false);
  };

  const plannedNeighborhoods = activeExtraction?.neighborhoods || [];
  const completedNeighborhoods = activeExtraction?.completedNeighborhoods || [];
  const failedNeighborhoods = activeExtraction?.failedNeighborhoods || [];
  const currentProgressNeighborhood = progressDetails.neighborhood || activeExtraction?.currentNeighborhood || '';
  const currentTargetCompleted = completedNeighborhoods.includes(currentProgressNeighborhood);
  const liveFound = Number.isFinite(Number(progressDetails.found))
    ? Number(progressDetails.found)
    : (Number.isFinite(Number(progressDetails.current)) ? Number(progressDetails.current) : 0);
  const foundSoFar = Math.max(
    liveLeads.length,
    Math.max(0, Number(activeExtraction?.foundCount) || 0) + (currentTargetCompleted ? 0 : liveFound),
  );
  const pendingNeighborhoods = plannedNeighborhoods.filter((name) => !completedNeighborhoods.includes(name) && !failedNeighborhoods.includes(name));

  return (
    <div className="map-full" data-od-id="scraper-map-full">
      {/* Map Wrap (Protagonista) */}
      <div className="map-wrap">
        <div
          id="realMap"
          ref={mapContainerRef}
          role="application"
          aria-label="Mapa de leads"
        />

        {/* Barra superior de ações do mapa */}
        <div className="map-bar">
          <button
            type="button"
            className="btn btn-sm"
            id="filterBtn"
            aria-expanded={isFilterDrawerOpen}
            data-od-id="scraper-filter"
            onClick={() => {
              setIsFilterDrawerOpen((v) => !v);
              setIsBasePopOpen(false);
              setIsLocPopOpen(false);
            }}
          >
            Filtrar
          </button>

          <button
            type="button"
            className="btn btn-sm"
            id="exportBtn"
            data-od-id="scraper-export"
            onClick={() => handleExport('csv')}
          >
            Exportar
          </button>

          <button
            type="button"
            className="icon-btn"
            id="locBtn"
            title="Minha localização"
            aria-label="Minha localização"
            aria-expanded={isLocPopOpen}
            style={{ width: 36, height: 36, minHeight: 36, borderRadius: 10 }}
            onClick={() => {
              setIsLocPopOpen((v) => !v);
              setIsBasePopOpen(false);
              setIsFilterDrawerOpen(false);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#EA4335"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ width: 16, height: 16 }}
            >
              <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </button>

          <button
            type="button"
            className="icon-btn"
            id="baseBtn"
            aria-expanded={isBasePopOpen}
            title="Tipo de mapa"
            aria-label="Tipo de mapa"
            style={{ width: 36, height: 36, minHeight: 36, borderRadius: 10 }}
            onClick={() => {
              setIsBasePopOpen((v) => !v);
              setIsLocPopOpen(false);
              setIsFilterDrawerOpen(false);
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ width: 16, height: 16 }}
            >
              <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
              <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
              <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
            </svg>
          </button>
        </div>

        {mapTileError && (
          <div className="map-tile-error" role="alert">
            <AlertCircle size={15} />
            <span>{mapTileError}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setMapTileError('');
                tileErrorsRef.current = 0;
                tileLayerRef.current?.redraw?.();
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Popover de Basemap */}
        {isBasePopOpen && (
          <div className="map-pop" id="basePop">
            <button
              type="button"
              className="bopt"
              aria-pressed={baseKey === 'padrao'}
              onClick={() => { setBaseKey('padrao'); setIsBasePopOpen(false); }}
            >
              Padrão
            </button>
            <button
              type="button"
              className="bopt"
              aria-pressed={baseKey === 'satelite'}
              onClick={() => { setBaseKey('satelite'); setIsBasePopOpen(false); }}
            >
              Satélite
            </button>
            <button
              type="button"
              className="bopt"
              aria-pressed={baseKey === 'terreno'}
              onClick={() => { setBaseKey('terreno'); setIsBasePopOpen(false); }}
            >
              Terreno
            </button>
          </div>
        )}

        {/* Popover de Localização */}
        {isLocPopOpen && (
          <div className="map-pop" id="locPop" style={{ minWidth: 260, padding: 12 }}>
            <div className="loc-title">Minha localização</div>
            <div className="field" style={{ marginTop: 8 }}>
              <div className="ac-wrap">
                <input
                  id="locAddr"
                  placeholder="Digite seu endereço…"
                  autoComplete="off"
                  aria-label="Digite seu endereço"
                  style={{ minHeight: 44 }}
                  value={locAddrQuery}
                  onChange={(e) => handleAddrSearchChange(e.target.value)}
                />
                {locSuggestions.length > 0 && (
                  <div className="ac-list" role="listbox">
                    {locSuggestions.map((item, i) => (
                      <button
                        key={i}
                        type="button"
                        className="ac-item"
                        onClick={() => handlePickAddress(item)}
                      >
                        <span title={item.full}>{item.label}</span>
                        <span className="t">Endereço</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {isSearchingLoc && <span className="map-location-searching" role="status">Buscando endereço…</span>}
              {locationError && <span className="field-err" role="alert">{locationError}</span>}
            </div>

            <button type="button" className="loc-auto" id="locAuto" onClick={handleUseMyLocation}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#EA4335"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ width: 17, height: 17 }}
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              Usar minha localização
            </button>

            {userLocation && (
              <button
                type="button"
                className="loc-clear"
                id="locClear"
                style={{ marginTop: 8, width: '100%', minHeight: 36, background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}
                onClick={handleClearLocation}
              >
                Remover referência
              </button>
            )}
          </div>
        )}

        {/* Drawer de Filtros do Mapa */}
        <div
          className={`drawer map-filter ${isFilterDrawerOpen ? 'on' : ''}`}
          id="filterDrawer"
          data-od-id="scraper-filter-drawer"
        >
          <div className="field">
            <label htmlFor="fCat">Categoria</label>
            <select
              id="fCat"
              className={filterCat ? 'has-value' : ''}
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value)}
            >
              <option value="">Todas</option>
              {uniqueCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="fScore">Score mínimo</label>
            <select
              id="fScore"
              className={filterScore > 0 ? 'has-value' : ''}
              value={filterScore}
              onChange={(e) => setFilterScore(Number(e.target.value))}
            >
              <option value="0">Qualquer</option>
              <option value="50">50+</option>
              <option value="70">70+</option>
              <option value="85">85+</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="fTel">Telefone</label>
            <select
              id="fTel"
              className={filterTel ? 'has-value' : ''}
              value={filterTel}
              onChange={(e) => setFilterTel(e.target.value)}
            >
              <option value="">Com e sem</option>
              <option value="yes">Só com telefone</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="fOrd">Ordenar</label>
            <select
              id="fOrd"
              value={filterOrd}
              onChange={(e) => setFilterOrd(e.target.value)}
            >
              <option value="score">Maior score</option>
              <option value="rating">Melhor avaliados</option>
              <option value="name">Nome A–Z</option>
            </select>
          </div>
        </div>

        {/* Barra de Progresso de Extração */}
        <div
          className={`map-progress ${isProcessing ? 'on' : ''} ${isProgressDetailsOpen ? 'expanded' : ''}`}
          id="progWrap"
          data-od-id="scraper-progress"
        >
          <div className="map-progress-main">
            <div className="progress-track">
              <div className="progress-fill" id="progFill" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="progress-txt" id="progTxt">{progressPct}%</span>
            <button
              type="button"
              className="map-progress-info"
              data-od-id="scraper-progress-info"
              aria-label="Mostrar detalhes da extração"
              aria-expanded={isProgressDetailsOpen}
              title="Detalhes da extração"
              onClick={() => setIsProgressDetailsOpen((value) => !value)}
            >
              <Info size={15} aria-hidden="true" />
            </button>
            <button type="button" className="btn btn-sm" id="cancelBtn" disabled={!activeExtraction?.id} onClick={handleCancelExtraction}>
              Cancelar
            </button>
          </div>
          {isProgressDetailsOpen && (
            <section className="map-progress-detail" aria-label="Detalhes da extração em andamento">
              <div className="map-progress-stats">
                <span><b>{foundSoFar}</b><small>empresas encontradas</small></span>
                <span><b>{completedNeighborhoods.length}/{plannedNeighborhoods.length}</b><small>{activeExtraction?.hasNeighborhoodPlan ? 'bairros concluídos' : 'etapas concluídas'}</small></span>
                <span><b>{pendingNeighborhoods.length}</b><small>{activeExtraction?.hasNeighborhoodPlan ? 'bairros pendentes' : 'etapas pendentes'}</small></span>
              </div>
              {activeExtraction?.hasNeighborhoodPlan && (
                <div className="map-progress-neighborhoods">
                  <div><b>Prospectados</b><span>{completedNeighborhoods.length ? completedNeighborhoods.join(' · ') : 'Nenhum bairro concluído ainda.'}</span></div>
                  <div><b>Ainda faltam</b><span>{pendingNeighborhoods.length ? pendingNeighborhoods.join(' · ') : 'Nenhum bairro pendente.'}</span></div>
                  {failedNeighborhoods.length > 0 && <div className="is-warning"><b>Precisam de revisão</b><span>{failedNeighborhoods.join(' · ')}</span></div>}
                </div>
              )}
              <div className="map-progress-log" aria-live="polite">
                <b>Registro da execução</b>
                {progressLog.length ? progressLog.map((entry, index) => (
                  <span key={`${entry.timestamp}-${index}`} className={`is-${entry.status}`}>{entry.message}</span>
                )) : <span>Preparando os dados da extração…</span>}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Feed Dock Lateral Direito */}
      <aside className="feed-dock" data-od-id="scraper-feed" aria-label="Leads no mapa">
        <div className="feed-head">
          <div className="feed-search">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              id="leadSearch"
              placeholder="Buscar lead…"
              aria-label="Buscar leads"
              autoComplete="off"
              value={feedSearch}
              onChange={(e) => setFeedSearch(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="icon-btn"
            id="listFilterBtn"
            aria-expanded={isListPopOpen}
            title="Filtros da lista"
            aria-label="Filtros da lista"
            onClick={() => setIsListPopOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {activeListFiltersCount > 0 && (
              <span className="fbadge pop" id="fbadge">
                {activeListFiltersCount}
              </span>
            )}
          </button>
        </div>

        {/* Popover de Filtros da Lista */}
        {isListPopOpen && (
          <div className="list-pop open" id="listPop">
            <div className="field">
              <label htmlFor="lpNicho">Nicho</label>
              <select
                id="lpNicho"
                value={listNicho}
                className={listNicho ? 'has-value' : ''}
                onChange={(e) => setListNicho(e.target.value)}
              >
                <option value="">Todos os nichos</option>
                {uniqueCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="lpUf">Estado</label>
              <select
                id="lpUf"
                value={listUf}
                className={listUf ? 'has-value' : ''}
                onChange={(e) => setListUf(e.target.value)}
              >
                <option value="">Todos os estados</option>
                {uniqueUfs.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="lpCidade">Cidade</label>
              <select
                id="lpCidade"
                value={listCidade}
                className={listCidade ? 'has-value' : ''}
                onChange={(e) => setListCidade(e.target.value)}
              >
                <option value="">Todas as cidades</option>
                {uniqueCities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="lpBairro">Bairro</label>
              <select
                id="lpBairro"
                value={listBairro}
                className={listBairro ? 'has-value' : ''}
                onChange={(e) => setListBairro(e.target.value)}
              >
                <option value="">Todos os bairros</option>
                {uniqueBairros.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>

            <div className="full">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                id="lpClear"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={handleClearListFilters}
              >
                Limpar filtros
              </button>
            </div>
          </div>
        )}

        <div style={{ padding: '8px 12px 0', fontSize: 12, color: 'var(--muted)' }} id="feedCount" role="status">
          {visibleLeads.length} lead{visibleLeads.length === 1 ? '' : 's'}
          {activeExtraction?.id && liveLeads.length > 0 && <span className="feed-live-count"> · {liveLeads.length} chegando agora</span>}
        </div>

        {/* Lista de Lead Cards */}
        <div className="feed-list" id="feedList">
          {visibleLeads.length === 0 ? (
            <div className="empty">
              <div className="e-icon">○</div>
              <b style={{ color: 'var(--fg)' }}>Nada por aqui</b>
              <span>Nenhum lead passa nos filtros atuais.</span>
              <button
                type="button"
                className="btn btn-sm"
                id="feedRestore"
                onClick={handleResetAllFilters}
              >
                Limpar filtros
              </button>
            </div>
          ) : (
            visibleLeads.map((lead, pos) => {
              const leadId = lead.id || `lead_${pos}`;
              const isSelected = selectedLeadId === leadId;
              const isLiveLead = liveLeadIds.has(String(leadId));
              const name = getLeadName(lead);
              const rating = getLeadRating(lead);
              const reviews = getLeadReviews(lead);
              const hood = getLeadBairro(lead);
              const uf = getLeadState(lead);
              const city = getLeadCity(lead);
              const phone = getLeadPhone(lead);
              const ig = getLeadIg(lead);
              const loc = getExactLeadLocation(lead);

              let straightDist = null;
              if (userLocation && loc) {
                const meters = distM(userLocation.lat, userLocation.lng, loc.lat, loc.lng);
                straightDist = fmtD(meters);
              }

              return (
                <button
                  key={leadId}
                  ref={(el) => (leadCardRefs.current[leadId] = el)}
                  type="button"
                  className="lead-card"
                  style={{ animationDelay: `${Math.min(pos * 40, 240)}ms` }}
                  aria-current={isSelected ? 'true' : 'false'}
                  data-od-id={`lead-card-${pos}`}
                  onClick={() => handleSpotlightLead(lead, leadId, loc?.lat, loc?.lng, true)}
                >
                  <div className="lead-top">
                    <b>{name}</b>
                    {isLiveLead && <span className="lead-live">Ao vivo</span>}
                    <span className="rate">
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      <b className="rv">{rating}</b>
                      <span className="rc">({reviews})</span>
                    </span>
                  </div>

                  <div className="lead-meta">
                    {hood || city ? `${hood || city}${uf ? ` · ${uf}` : ''}` : getLeadCat(lead)}
                  </div>

                  <div className="lead-actions">
                    {phone && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Enviar mensagem via WhatsApp"
                        aria-label="Enviar mensagem via WhatsApp"
                        style={{ width: 32, height: 32, minHeight: 32, borderRadius: 8 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleWhatsAppLead(lead);
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          style={{ width: 15, height: 15 }}
                        >
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </button>
                    )}

                    <button
                      type="button"
                      className="icon-btn"
                      title="Ver no mapa"
                      aria-label="Ver no mapa"
                      style={{ width: 32, height: 32, minHeight: 32, borderRadius: 8 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSpotlightLead(lead, leadId, loc?.lat, loc?.lng, true);
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        style={{ width: 15, height: 15 }}
                      >
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                    </button>

                    {ig && (
                      <button
                        type="button"
                        className="icon-btn"
                        title={`Abrir Instagram de ${name}`}
                        aria-label={`Abrir Instagram de ${name}`}
                        style={{ width: 32, height: 32, minHeight: 32, borderRadius: 8 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const profileUrl = instagramProfileUrl(ig);
                          if (profileUrl) window.open(profileUrl, '_blank', 'noopener');
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#E056A0"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          style={{ width: 15, height: 15 }}
                        >
                          <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                        </svg>
                      </button>
                    )}

                    {straightDist && (
                      <span className="dist" title="Distância em linha reta">
                        {straightDist}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
