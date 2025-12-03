import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AlertTriangle, Droplets, Flame, Users, Activity, MapPin, Info, Wind, Search, Newspaper, Layers, Lock, LogOut, Save, Trash2, Plus, Edit3, X, Eye, Navigation, GitBranch, ChevronDown, ChevronUp, Image } from 'lucide-react';
import disastersCsv from './data/disasters.csv?raw';
import routesCsv from './data/routes.csv?raw';

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
const DISASTERS_API_URL = `${API_BASE_URL}/api/disasters`;
const ROUTES_API_URL = `${API_BASE_URL}/api/routes`;
const SERVER_SYNC_INTERVAL = 30000; // 30s
const ROUTE_SYNC_INTERVAL = 45000;
const SUMATRA_PROVINCE_IDS = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '21'];
const PROVINCE_API_URL = 'https://ibnux.github.io/data-indonesia/provinsi.json';
const REGENCY_API_URL = (provinceId) => `https://ibnux.github.io/data-indonesia/kabupaten/${provinceId}.json`;
const ROUTE_COLORS = ['#34d399', '#60a5fa', '#f472b6', '#f97316', '#a855f7', '#facc15', '#2dd4bf', '#fb7185'];
const AVERAGE_CAR_SPEED_KMH = 60;
const ROUTE_LONG_PRESS_MS = 800;
const getRoutePaletteColor = (index = 0) => ROUTE_COLORS[index % ROUTE_COLORS.length];
const BASE_DISASTER_TYPE_OPTIONS = [
  'Banjir',
  'Banjir Bandang',
  'Banjir & Longsor',
  'Longsor',
  'Longsor & Banjir',
  'Kebakaran',
  'Gempa Bumi',
  'Akses Putus',
  'Akses Aman',
  'Akses Udara',
  'Belum Tercatat',
  'Dapur Umum',
  'Posko Bantuan'
];
const TYPE_SELECT_CUSTOM_VALUE = '__custom';
const normalizeTypeValue = (value = '') => value.trim().toLowerCase();
const buildTypeOptions = (regionsList = []) => {
  const seen = new Set();
  const options = [];
  const register = (label) => {
    const trimmed = (label || '').trim();
    if (!trimmed) return;
    const key = normalizeTypeValue(trimmed);
    if (seen.has(key)) return;
    seen.add(key);
    options.push(trimmed);
  };
  BASE_DISASTER_TYPE_OPTIONS.forEach(register);
  regionsList.forEach((region) => register(region?.disasterType));
  return options;
};
const isTypeWithinOptions = (options = [], value) => {
  if (!value) return false;
  const key = normalizeTypeValue(value);
  return options.some((option) => normalizeTypeValue(option) === key);
};

const formatLocationName = (raw = '') => {
  const cleaned = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  return cleaned.split(' ').map((word) => {
    if (word === 'kab.' || word === 'kab') return 'Kab.';
    if (word === 'kota') return 'Kota';
    if (word === '&') return '&';
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
};

const normalizeLocationKey = (name = '') => name.replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
const MAX_PHOTOS_PER_REGION = 12;

const parsePhotosCell = (raw) => {
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value)).filter(Boolean).slice(0, MAX_PHOTOS_PER_REGION);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((value) => String(value)).filter(Boolean).slice(0, MAX_PHOTOS_PER_REGION);
      }
    } catch (error) {
      // Fallback to delimiter-based parsing
    }
    return trimmed
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, MAX_PHOTOS_PER_REGION);
  }
  return [];
};

const normalizePhotos = (raw) => parsePhotosCell(raw);

const resolvePhotoUrl = (fileName = '') => {
  if (!fileName) return '';
  if (/^https?:\/\//i.test(fileName)) return fileName;
  const base = API_BASE_URL || '';
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedFile = fileName.replace(/^\/+/, '');
  return `${normalizedBase}/uploads/${normalizedFile}`;
};

const uploadRegionPhotos = async (files = [], locationName = '') => {
  if (!files?.length) return [];
  if (typeof fetch === 'undefined') {
    throw new Error('Lingkungan tidak mendukung upload.');
  }
  const uploadEndpoint = API_BASE_URL
    ? `${API_BASE_URL}/api/photos/upload`
    : '/api/photos/upload';
  const formData = new FormData();
  formData.append('locationName', locationName || 'lokasi');
  files.forEach((file) => formData.append('photos', file));
  const response = await fetch(uploadEndpoint, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) {
    throw new Error('Gagal mengunggah foto.');
  }
  const payload = await response.json();
  if (!payload?.files || !Array.isArray(payload.files)) {
    throw new Error('Server tidak mengembalikan daftar foto.');
  }
  return payload.files;
};

const parseCSVRow = (line = '') => {
  const values = [];
  let currentVal = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      const nextChar = line[i + 1];
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(currentVal);
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  values.push(currentVal);
  return values;
};

const parseCSV = (csvText = '') => {
  const trimmed = csvText.trim();
  if (!trimmed) return [];
  const lines = trimmed.split('\n').filter(Boolean);
  if (lines.length <= 1) return [];
  return lines.slice(1).map((line) => {
    const values = parseCSVRow(line);
    return {
      id: values[0],
      name: values[1],
      lat: parseFloat(values[2]),
      lng: parseFloat(values[3]),
      disasterType: values[4],
      victimsText: values[5]?.replace(/"/g, '').trim(),
      status: values[6],
      severity: values[7],
      description: values[8]?.replace(/"/g, '').trim(),
      lastUpdate: values[9],
      source: values[10],
      photos: parsePhotosCell(values[11])
    };
  });
};

const parseRouteCoordinates = (raw = '[]') => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((pair) => {
        if (Array.isArray(pair) && pair.length >= 2) {
          const lat = parseFloat(pair[0]);
          const lng = parseFloat(pair[1]);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return [lat, lng];
          }
        }
        return null;
      })
      .filter(Boolean);
  } catch (error) {
    console.error('Failed to parse route coordinates:', error);
    return [];
  }
};

const parseRoutesCSV = (csvText = '') => {
  const trimmed = csvText.trim();
  if (!trimmed) return [];
  const lines = trimmed.split('\n').filter(Boolean);
  if (lines.length <= 1) return [];
  const headers = parseCSVRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCSVRow(line);
    const record = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });
    const distanceKm = record.distanceKm ? parseFloat(record.distanceKm) : 0;
    const durationMinutes = Number.isFinite(distanceKm) && distanceKm > 0
      ? (distanceKm / AVERAGE_CAR_SPEED_KMH) * 60
      : 0;
    return {
      id: record.id || `route-${Date.now()}`,
      name: record.name || 'Jalur',
      color: record.color || null,
      coordinates: parseRouteCoordinates(record.coordinates),
      distanceKm,
      durationMinutes,
      createdAt: record.createdAt || ''
    };
  }).filter((route) => Array.isArray(route.coordinates) && route.coordinates.length >= 2);
};

const getFallbackRegions = () => parseCSV(disastersCsv);
const getFallbackRoutes = () => parseRoutesCSV(routesCsv);

const SUMATRA_LOCATIONS = (() => {
  const parsed = getFallbackRegions();
  const unique = new Map();
  parsed.forEach(({ id, name, lat, lng }) => {
    if (!name || Number.isNaN(lat) || Number.isNaN(lng)) return;
    const key = name.trim().toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, { id, name: name.trim(), lat, lng, provinceId: null, provinceName: 'Sumatera (Fallback)' });
    }
  });
  return Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name, 'id-ID'));
})();

const fetchServerRegions = async () => {
  if (!DISASTERS_API_URL || typeof fetch === 'undefined') return null;
  const response = await fetch(DISASTERS_API_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch server disasters data');
  const csvPayload = await response.text();
  return parseCSV(csvPayload);
};

const fetchServerRoutes = async () => {
  if (!ROUTES_API_URL || typeof fetch === 'undefined') return null;
  const response = await fetch(ROUTES_API_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch server routes data');
  const csvPayload = await response.text();
  return parseRoutesCSV(csvPayload);
};

const fetchSumatraLocationOptions = async () => {
  const provinceResponse = await fetch(PROVINCE_API_URL);
  if (!provinceResponse.ok) throw new Error('Failed to fetch province data');
  const provinces = await provinceResponse.json();
  const sumatraProvinces = provinces.filter((province) => SUMATRA_PROVINCE_IDS.includes(province.id));

  const regencyGroups = await Promise.all(sumatraProvinces.map(async (province) => {
    const regencyResponse = await fetch(REGENCY_API_URL(province.id));
    if (!regencyResponse.ok) throw new Error(`Failed to fetch regencies for province ${province.nama}`);
    const regencies = await regencyResponse.json();
    return regencies.map((regency) => ({
      id: regency.id,
      provinceId: province.id,
      provinceName: formatLocationName(province.nama),
      name: formatLocationName(regency.nama),
      lat: typeof regency.latitude === 'string' ? parseFloat(regency.latitude) : regency.latitude,
      lng: typeof regency.longitude === 'string' ? parseFloat(regency.longitude) : regency.longitude,
    }));
  }));

  return regencyGroups
    .flat()
    .filter((loc) => Number.isFinite(loc.lat) && Number.isFinite(loc.lng))
    .sort((a, b) => a.name.localeCompare(b.name, 'id-ID'));
};

// SHA-256 Hash untuk "08080808"
const TARGET_HASH = "9651674db05263e2f6176a7f4302a6317e5549694d55c69cdc7a6c608baf91df";

const App = () => {
  // --- STATE ---
  const [regions, setRegions] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [viewMode, setViewMode] = useState('map'); // 'map', 'login', 'admin'
  const [activeRegion, setActiveRegion] = useState(null);
  const [isLeafletReady, setIsLeafletReady] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  const [locationOptions, setLocationOptions] = useState(SUMATRA_LOCATIONS);
  const [isFetchingLocations, setIsFetchingLocations] = useState(false);
  const typeOptions = useMemo(() => buildTypeOptions(regions), [regions]);
  const [locationFetchMessage, setLocationFetchMessage] = useState(null);
  const [isSyncingRegions, setIsSyncingRegions] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);
  const [isPersistingRegions, setIsPersistingRegions] = useState(false);
  const [mapAddForm, setMapAddForm] = useState({ open: false, lat: null, lng: null });
  const [mapFormData, setMapFormData] = useState({ type: 'Akses Putus', name: '', description: '', victims: '', status: '', severity: 'medium' });
  const [mapFormPassword, setMapFormPassword] = useState('');
  const [mapFormAuthorized, setMapFormAuthorized] = useState(false);
  const [mapFormError, setMapFormError] = useState(null);
  const [isSubmittingMapForm, setIsSubmittingMapForm] = useState(false);
  const [mapExistingPhotos, setMapExistingPhotos] = useState([]);
  const [mapPhotoFiles, setMapPhotoFiles] = useState([]);
  const [mapPhotoError, setMapPhotoError] = useState(null);
  const [mapEditTarget, setMapEditTarget] = useState(null);
  const [isEditingPosition, setIsEditingPosition] = useState(false);
  const [positionEditCoords, setPositionEditCoords] = useState(null);
  const [positionAuthorized, setPositionAuthorized] = useState(false);
  const [isSavingPosition, setIsSavingPosition] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearchingLocations, setIsSearchingLocations] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchPointer, setSearchPointer] = useState(null);
  const [sidebarPosition, setSidebarPosition] = useState(null);
  const [sidebarLocked, setSidebarLocked] = useState(false);
  const [passwordModal, setPasswordModal] = useState({ open: false, context: null, payload: null });
  const [passwordInputValue, setPasswordInputValue] = useState('');
  const [passwordModalError, setPasswordModalError] = useState(null);
  // User GPS State
  const [userLocation, setUserLocation] = useState(null);
  const [isTrackingUser, setIsTrackingUser] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationPermissionState, setLocationPermissionState] = useState('unknown');
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [locationModalError, setLocationModalError] = useState(null);
  const [locationToast, setLocationToast] = useState(null);
  
  // Auth State
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  
  // Admin Editing State
  const [editingId, setEditingId] = useState(null); 
  const [editFormData, setEditFormData] = useState({});
  const [isPersistingRoutes, setIsPersistingRoutes] = useState(false);
  const [isCreatingRoute, setIsCreatingRoute] = useState(false);
  const [routeDraftPoints, setRouteDraftPoints] = useState([]);
  const [routeDraftSegments, setRouteDraftSegments] = useState([]);
  const [routeDraftColor, setRouteDraftColor] = useState(null);
  const [routeDraftName, setRouteDraftName] = useState('');
  const [routeDraftDistance, setRouteDraftDistance] = useState(0);
  const [routeDraftDuration, setRouteDraftDuration] = useState(0);
  const [routeDraftError, setRouteDraftError] = useState(null);
  const [isRoutingSegment, setIsRoutingSegment] = useState(false);
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [isRoutePanelCollapsed, setIsRoutePanelCollapsed] = useState(false);
  const [routeAuthorized, setRouteAuthorized] = useState(false);
  const [routeDeleteIntent, setRouteDeleteIntent] = useState(null);
  const [routeDeletePassword, setRouteDeletePassword] = useState('');
  const [routeDeleteError, setRouteDeleteError] = useState(null);
  const [isDeletingRoute, setIsDeletingRoute] = useState(false);
  const [editPhotoFiles, setEditPhotoFiles] = useState([]);
  const [photoGalleryModal, setPhotoGalleryModal] = useState({ open: false, photos: [], title: '', activeIndex: 0 });

  // Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const feedbackTimerRef = useRef(null);
  const regionsRef = useRef(regions);
  const routesRef = useRef(routes);
  const searchDebounceRef = useRef(null);
  const searchAbortRef = useRef(null);
  const sidebarDragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const userWatchIdRef = useRef(null);
  const userMarkerRef = useRef(null);
  const userAccuracyRef = useRef(null);
  const hasCenteredOnUserRef = useRef(false);
  const locationToastTimerRef = useRef(null);
  const routeLayerGroupRef = useRef(null);
  const routeDraftLayerRef = useRef(null);
  const routePointsRef = useRef(routeDraftPoints);
  const routeSegmentsRef = useRef(routeDraftSegments);
  const routeColorRef = useRef(routeDraftColor);
  const routeHoldTimerRef = useRef(null);
  const customWheelHandlerRef = useRef(null);
  const cancelRouteHoldTimer = useCallback(() => {
    if (routeHoldTimerRef.current) {
      clearTimeout(routeHoldTimerRef.current);
      routeHoldTimerRef.current = null;
    }
  }, []);
  const editTypeSelectValue = useMemo(() => {
    if (!editingId || !editFormData) return TYPE_SELECT_CUSTOM_VALUE;
    return isTypeWithinOptions(typeOptions, editFormData.disasterType)
      ? editFormData.disasterType
      : TYPE_SELECT_CUSTOM_VALUE;
  }, [editingId, editFormData, typeOptions]);
  const showEditCustomTypeInput = Boolean(editingId && editTypeSelectValue === TYPE_SELECT_CUSTOM_VALUE);

  const computeSidebarPosition = useCallback((region, force = false) => {
    if (!region || !mapInstanceRef.current || !mapContainerRef.current) return;
    if (sidebarLocked && !force) return;
    const map = mapInstanceRef.current;
    const containerPoint = map.latLngToContainerPoint([region.lat, region.lng]);
    const rect = mapContainerRef.current.getBoundingClientRect();
    const modalWidth = 320;
    const modalHeight = 360;
    let left = rect.left + containerPoint.x + 24;
    let top = rect.top + containerPoint.y - modalHeight / 2;
    if (left + modalWidth > rect.right - 16) {
      left = rect.left + containerPoint.x - modalWidth - 24;
    }
    if (left < rect.left + 16) left = rect.left + 16;
    if (top + modalHeight > rect.bottom - 16) top = rect.bottom - modalHeight - 16;
    if (top < rect.top + 16) top = rect.top + 16;
    setSidebarPosition({ left, top });
  }, [sidebarLocked]);

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  useEffect(() => {
    routesRef.current = routes;
  }, [routes]);

  useEffect(() => {
    routePointsRef.current = routeDraftPoints;
  }, [routeDraftPoints]);

  useEffect(() => {
    routeSegmentsRef.current = routeDraftSegments;
  }, [routeDraftSegments]);

  useEffect(() => {
    routeColorRef.current = routeDraftColor;
  }, [routeDraftColor]);

  useEffect(() => {
    if (!Number.isFinite(routeDraftDistance) || routeDraftDistance <= 0) {
      setRouteDraftDuration(0);
    } else {
      setRouteDraftDuration((routeDraftDistance / AVERAGE_CAR_SPEED_KMH) * 60);
    }
  }, [routeDraftDistance]);

  const configureMapZoomDynamics = useCallback((map) => {
    if (!map) return;
    const updateProfile = () => {
      const zoom = map.getZoom();
      if (zoom >= 15) {
        map.options.zoomDelta = 0.18;
        map.options.wheelPxPerZoomLevel = 220;
      } else if (zoom >= 13) {
        map.options.zoomDelta = 0.28;
        map.options.wheelPxPerZoomLevel = 160;
      } else if (zoom >= 10) {
        map.options.zoomDelta = 0.4;
        map.options.wheelPxPerZoomLevel = 110;
      } else {
        map.options.zoomDelta = 0.65;
        map.options.wheelPxPerZoomLevel = 80;
      }
    };
    updateProfile();
    map.on('zoomend', updateProfile);
    map.__zoomSensitivityHandler = updateProfile;
  }, []);

  useEffect(() => {
    if (isCreatingRoute) {
      setIsRoutePanelCollapsed(true);
    } else {
      setIsRoutePanelCollapsed(false);
    }
  }, [isCreatingRoute]);

  const resetRouteDraftState = () => {
    setRouteDraftPoints([]);
    setRouteDraftSegments([]);
    setRouteDraftDistance(0);
    setRouteDraftDuration(0);
    setRouteDraftError(null);
    setRouteDraftName('');
    setRouteDraftColor(null);
    routeColorRef.current = null;
    setIsRoutingSegment(false);
    setIsSavingRoute(false);
  };

  const startRouteCreation = () => {
    resetRouteDraftState();
    const color = getRoutePaletteColor(routesRef.current.length);
    routeColorRef.current = color;
    setRouteDraftColor(color);
    setRouteDraftName(`Jalur ${routesRef.current.length + 1}`);
    setIsCreatingRoute(true);
    setActiveRegion(null);
    setSidebarPosition(null);
    closeMapForm();
    if (isEditingPosition) {
      setIsEditingPosition(false);
      setPositionEditCoords(null);
    }
  };

  const cancelRouteCreation = () => {
    resetRouteDraftState();
    setIsCreatingRoute(false);
  };

  const handleRouteModeToggle = () => {
    if (isCreatingRoute) {
      cancelRouteCreation();
    } else {
      if (!routeAuthorized) {
        openPasswordModal('route-mode', { action: 'start-route' });
        return;
      }
      startRouteCreation();
    }
  };

  const handleRouteNameChange = (event) => {
    setRouteDraftName(event.target.value);
  };

  const closeRouteDeleteModal = () => {
    setRouteDeleteIntent(null);
    setRouteDeletePassword('');
    setRouteDeleteError(null);
    setIsDeletingRoute(false);
  };

  const handleRouteDeleteSubmit = async (event) => {
    event.preventDefault();
    if (!routeDeleteIntent) return;
    setRouteDeleteError(null);
    setIsDeletingRoute(true);
    try {
      const hash = await hashPassword(routeDeletePassword);
      if (hash !== TARGET_HASH) {
        setRouteDeleteError('Password salah.');
        setIsDeletingRoute(false);
        return;
      }
      const routeId = routeDeleteIntent.id;
      const currentRoutes = routesRef.current || [];
      const nextRoutes = currentRoutes.filter(route => route.id !== routeId);
      if (nextRoutes.length === currentRoutes.length) {
        setRouteDeleteError('Jalur tidak ditemukan.');
        setIsDeletingRoute(false);
        return;
      }
      const success = await persistRoutes(nextRoutes, { successMessage: `Jalur "${routeDeleteIntent.name}" dihapus.` });
      if (success) {
        closeRouteDeleteModal();
      }
    } catch (error) {
      console.error('Failed to delete route:', error);
      setRouteDeleteError('Gagal menghapus jalur.');
    } finally {
      setIsDeletingRoute(false);
    }
  };

  useEffect(() => {
    if (!activeRegion) {
      setSidebarPosition(null);
      return;
    }
    setSidebarLocked(false);
    computeSidebarPosition(activeRegion, true);
  }, [activeRegion, computeSidebarPosition]);

  useEffect(() => {
    if (!activeRegion || !mapInstanceRef.current || sidebarLocked) return;
    const handler = () => computeSidebarPosition(activeRegion);
    const map = mapInstanceRef.current;
    map.on('move zoom', handler);
    return () => {
      map.off('move zoom', handler);
    };
  }, [activeRegion, computeSidebarPosition, sidebarLocked]);

  // --- 2. INITIALIZATION & DATA LOADING ---
  useEffect(() => {
    let isMounted = true;
    setRegions(getFallbackRegions());

    const loadServerData = async () => {
      try {
        const parsedData = await fetchServerRegions();
        if (isMounted && parsedData?.length) {
          setRegions(parsedData);
        }
      } catch (error) {
        console.error('Failed to load server data:', error);
      }
    };

    loadServerData();

    // B. Load Leaflet Script Safely
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    const checkForLeaflet = () => {
        if (window.L && typeof window.L.map === 'function') {
            setIsLeafletReady(true);
            return true;
        }
        return false;
    };

    if (!checkForLeaflet()) {
        if (!document.querySelector('script[src*="leaflet.js"]')) {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.async = true;
            script.onload = () => {
                if (checkForLeaflet()) {
                    console.log("Leaflet Initialized via onload");
                }
            };
            document.body.appendChild(script);
        }
        
        const intervalId = setInterval(() => {
            if (checkForLeaflet()) {
                clearInterval(intervalId);
            }
        }, 100);

        return () => {
          clearInterval(intervalId);
          isMounted = false;
        };
    }

    return () => {
       isMounted = false;
       if(mapInstanceRef.current) {
         if (mapInstanceRef.current.__contextHandler) {
           mapInstanceRef.current.off('contextmenu', mapInstanceRef.current.__contextHandler);
           delete mapInstanceRef.current.__contextHandler;
         }
       if (mapInstanceRef.current.__zoomSensitivityHandler) {
         mapInstanceRef.current.off('zoomend', mapInstanceRef.current.__zoomSensitivityHandler);
         delete mapInstanceRef.current.__zoomSensitivityHandler;
       }
        if (customWheelHandlerRef.current?.handler && customWheelHandlerRef.current?.container) {
          customWheelHandlerRef.current.container.removeEventListener('wheel', customWheelHandlerRef.current.handler);
          customWheelHandlerRef.current = null;
        }
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        routeLayerGroupRef.current = null;
        routeDraftLayerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    setRoutes(getFallbackRoutes());
    const loadRoutes = async () => {
      try {
        const parsedRoutes = await fetchServerRoutes();
        if (isMounted && Array.isArray(parsedRoutes)) {
          setRoutes(parsedRoutes);
        }
      } catch (error) {
        console.error('Failed to load routes data:', error);
      }
    };
    loadRoutes();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setIsEditingPosition(false);
    setPositionEditCoords(null);
    resetPositionAuth();
  }, [activeRegion?.id]);

  useEffect(() => {
    setPhotoGalleryModal((prev) => (prev.open ? { open: false, photos: [], title: '', activeIndex: 0 } : prev));
  }, [activeRegion?.id]);

  useEffect(() => {
    if (!editingId) {
      setEditPhotoFiles([]);
    }
  }, [editingId]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return undefined;
    let isActive = true;
    let cleanup = null;
    navigator.permissions.query({ name: 'geolocation' }).then((status) => {
      if (!isActive || !status) return;
      setLocationPermissionState(status.state || 'unknown');
      const handleChange = () => setLocationPermissionState(status.state || 'unknown');
      if (typeof status.addEventListener === 'function') {
        status.addEventListener('change', handleChange);
        cleanup = () => status.removeEventListener('change', handleChange);
      } else if ('onchange' in status) {
        status.onchange = handleChange;
        cleanup = () => { status.onchange = null; };
      }
    }).catch(() => {});
    return () => {
      isActive = false;
      if (cleanup) cleanup();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!DISASTERS_API_URL || typeof fetch === 'undefined') return undefined;
    let isMounted = true;
    let timeoutId;

    const syncFromServer = async () => {
      try {
        if (!isPersistingRegions) {
          const latest = await fetchServerRegions();
          if (isMounted && Array.isArray(latest) && latest.length) {
            const currentString = JSON.stringify(regionsRef.current);
            const latestString = JSON.stringify(latest);
            if (currentString !== latestString) {
              setRegions(latest);
            }
          }
        }
      } catch (error) {
        console.error('Background sync failed:', error);
      } finally {
        if (isMounted) {
          timeoutId = setTimeout(syncFromServer, SERVER_SYNC_INTERVAL);
        }
      }
    };

    syncFromServer();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isPersistingRegions]);

  useEffect(() => {
    if (!ROUTES_API_URL || typeof fetch === 'undefined') return undefined;
    let isMounted = true;
    let timeoutId;

    const syncRoutesFromServer = async () => {
      try {
        if (!isPersistingRoutes) {
          const latestRoutes = await fetchServerRoutes();
          if (isMounted && Array.isArray(latestRoutes)) {
            const currentString = JSON.stringify(routesRef.current);
            const latestString = JSON.stringify(latestRoutes);
            if (currentString !== latestString) {
              setRoutes(latestRoutes);
            }
          }
        }
      } catch (error) {
        console.error('Background route sync failed:', error);
      } finally {
        if (isMounted) {
          timeoutId = setTimeout(syncRoutesFromServer, ROUTE_SYNC_INTERVAL);
        }
      }
    };

    syncRoutesFromServer();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isPersistingRoutes]);

  useEffect(() => {
    if (!isSearchModalOpen) {
      setSearchResults([]);
      setSearchError(null);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (searchAbortRef.current) searchAbortRef.current.abort();
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (searchAbortRef.current) searchAbortRef.current.abort();
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearchingLocations(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      setIsSearchingLocations(true);
      setSearchError(null);
      const controller = new AbortController();
      searchAbortRef.current = controller;
      const params = new URLSearchParams({
        format: 'json',
        addressdetails: '1',
        limit: '8',
        bounded: '1',
        viewbox: '94,-7,106,6.5',
        q: searchQuery
      });
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'SumateraMonitor/1.0 (+https://petabencana.kodekita.id)'
          },
          signal: controller.signal
        });
        if (!response.ok) throw new Error('Pencarian gagal');
        const data = await response.json();
        const filtered = Array.isArray(data) ? data.filter(item => item?.lat && item?.lon && item?.address?.state) : [];
        setSearchResults(filtered.map(item => ({
          id: item.place_id,
          title: item.display_name?.split(',')[0] || item.display_name,
          subtitle: [
            item.address?.village || item.address?.suburb || '',
            item.address?.city || item.address?.town || item.address?.municipality || '',
            item.address?.state || ''
          ].filter(Boolean).join(' · '),
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon)
        })));
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Search error:', error);
          setSearchError('Gagal memuat hasil pencarian.');
        }
      } finally {
        setIsSearchingLocations(false);
      }
    }, 450);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, isSearchModalOpen]);

  useEffect(() => {
    let isMounted = true;
    const loadLocationOptions = async () => {
      try {
        setIsFetchingLocations(true);
        const apiLocations = await fetchSumatraLocationOptions();
        if (isMounted && apiLocations.length > 0) {
          setLocationOptions(apiLocations);
          setLocationFetchMessage(null);
        }
      } catch (error) {
        console.error('Failed to fetch Sumatra locations:', error);
        if (isMounted) {
          setLocationFetchMessage('Gagal memuat daftar lokasi API. Menggunakan data bawaan.');
        }
      } finally {
        if (isMounted) {
          setIsFetchingLocations(false);
        }
      }
    };
    loadLocationOptions();
    return () => {
      isMounted = false;
    };
  }, []);

  // --- 3. MAP RENDERING LOGIC ---
  useEffect(() => {
    if (!isLeafletReady || viewMode !== 'map' || !mapContainerRef.current) return;
    if (!window.L || typeof window.L.map !== 'function') return;

    if (mapInstanceRef.current) {
        if (mapInstanceRef.current.__contextHandler) {
            mapInstanceRef.current.off('contextmenu', mapInstanceRef.current.__contextHandler);
            delete mapInstanceRef.current.__contextHandler;
        }
        if (mapInstanceRef.current.__zoomSensitivityHandler) {
            mapInstanceRef.current.off('zoomend', mapInstanceRef.current.__zoomSensitivityHandler);
            delete mapInstanceRef.current.__zoomSensitivityHandler;
        }
        if (customWheelHandlerRef.current?.handler && customWheelHandlerRef.current?.container) {
            customWheelHandlerRef.current.container.removeEventListener('wheel', customWheelHandlerRef.current.handler);
            customWheelHandlerRef.current = null;
        }
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        userMarkerRef.current = null;
        userAccuracyRef.current = null;
        routeLayerGroupRef.current = null;
        routeDraftLayerRef.current = null;
    }

    try {
        const map = window.L.map(mapContainerRef.current, {
            center: [2.0, 98.0], // Centered to show Aceh (Top), Sumut (Mid), Sumbar (Bottom)
            zoom: 6, 
            zoomControl: false,
            attributionControl: true,
            scrollWheelZoom: true,
            touchZoom: 'center',
            wheelDebounceTime: 8,
            wheelPxPerZoomLevel: 100,
            zoomSnap: 0,
            zoomDelta: 0.35,
            zoomAnimation: true,
            zoomAnimationThreshold: 10,
            easeLinearity: 0.35,
            inertia: true,
            inertiaDeceleration: 4000
        });
        mapInstanceRef.current = map;

        map.scrollWheelZoom.disable();
        if (customWheelHandlerRef.current?.handler && customWheelHandlerRef.current?.container) {
          customWheelHandlerRef.current.container.removeEventListener('wheel', customWheelHandlerRef.current.handler);
          customWheelHandlerRef.current = null;
        }
        const wheelContainer = map.getContainer();
        const handleWheelSmooth = (event) => {
          event.preventDefault();
          const mapRef = mapInstanceRef.current;
          if (!mapRef) return;
          const delta = event.deltaY;
          const direction = delta > 0 ? 1 : -1;
          const modifier = event.ctrlKey || event.metaKey ? 0.5 : 1;
          const magnitude = Math.min(Math.abs(delta) / 180, 3) * modifier;
          const currentZoom = mapRef.getZoom();
          let baseStep;
          if (currentZoom >= 15) baseStep = 0.2;
          else if (currentZoom >= 13) baseStep = 0.32;
          else if (currentZoom >= 10) baseStep = 0.55;
          else baseStep = 0.85;
          const targetZoom = currentZoom - direction * baseStep * (0.6 + magnitude);
          mapRef.setZoom(targetZoom, { animate: true });
        };
        wheelContainer.addEventListener('wheel', handleWheelSmooth, { passive: false });
        customWheelHandlerRef.current = { handler: handleWheelSmooth, container: wheelContainer };

        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
        }).addTo(map);
        const handleContextMenu = (event) => {
            event.originalEvent?.preventDefault();
            openMapFormAt(event.latlng.lat, event.latlng.lng);
        };
        map.on('contextmenu', handleContextMenu);

        mapInstanceRef.current.__contextHandler = handleContextMenu;
        routeLayerGroupRef.current = window.L.layerGroup().addTo(map);
        routeDraftLayerRef.current = window.L.layerGroup().addTo(map);
        addMarkersToMap(map);
        refreshSavedRoutes();
        refreshRouteDraftLayers();
        configureMapZoomDynamics(map);
        
    } catch (err) {
        console.error("Map Init Error:", err);
    }

  }, [isLeafletReady, viewMode, configureMapZoomDynamics]);

  const handleRouteLongPress = useCallback((route) => {
    if (!route) return;
    setRouteDeleteIntent(route);
    setRouteDeletePassword('');
    setRouteDeleteError(null);
  }, []);

  const refreshSavedRoutes = useCallback((data) => {
    if (!routeLayerGroupRef.current || !window.L) return;
    const group = routeLayerGroupRef.current;
    group.clearLayers();
    const list = Array.isArray(data) ? data : routesRef.current;
    if (!Array.isArray(list)) return;
    list.forEach((route, index) => {
      const coords = Array.isArray(route?.coordinates) ? route.coordinates : [];
      if (coords.length < 2) return;
      const color = route?.color || getRoutePaletteColor(index);
      const polyline = window.L.polyline(coords, {
        color,
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(group);
      const startHold = () => {
        cancelRouteHoldTimer();
        routeHoldTimerRef.current = setTimeout(() => {
          cancelRouteHoldTimer();
          handleRouteLongPress(route);
        }, ROUTE_LONG_PRESS_MS);
      };
      const endHold = () => {
        cancelRouteHoldTimer();
      };
      polyline.on('mousedown', startHold);
      polyline.on('touchstart', startHold);
      polyline.on('mouseup', endHold);
      polyline.on('mouseleave', endHold);
      polyline.on('touchend', endHold);
      polyline.on('touchcancel', endHold);
    });
  }, [cancelRouteHoldTimer, handleRouteLongPress]);

  const refreshRouteDraftLayers = useCallback(() => {
    if (!routeDraftLayerRef.current || !window.L) return;
    const group = routeDraftLayerRef.current;
    group.clearLayers();
    const segments = routeSegmentsRef.current || [];
    const points = routePointsRef.current || [];
    const color = routeColorRef.current || getRoutePaletteColor(routesRef.current.length);
    segments.forEach((segment) => {
      if (!Array.isArray(segment) || segment.length < 2) return;
      window.L.polyline(segment, {
        color,
        weight: 4,
        opacity: 0.8,
        dashArray: '8 6',
        lineCap: 'round'
      }).addTo(group);
    });
    points.forEach((point, idx) => {
      if (!Array.isArray(point) || point.length < 2) return;
      window.L.circleMarker(point, {
        radius: idx === 0 ? 5 : 4,
        color,
        weight: idx === 0 ? 3 : 2,
        fillColor: '#0f172a',
        fillOpacity: 1
      }).addTo(group);
    });
  }, []);

  useEffect(() => {
    refreshSavedRoutes(routes);
  }, [routes, refreshSavedRoutes]);

  useEffect(() => {
    refreshRouteDraftLayers();
  }, [routeDraftSegments, routeDraftPoints, routeDraftColor, refreshRouteDraftLayers]);

  const addMarkersToMap = (map) => {
     markersRef.current = {};
     regions.forEach(region => {
        if (!region.lat || !region.lng) return;
        if (!region.disasterType || region.disasterType.trim().toLowerCase() === 'belum tercatat') return;

        const disasterTypeText = String(region.disasterType || '');
        const typeLower = disasterTypeText.toLowerCase();
        const isAccessCut = typeLower.includes('akses putus');
        const isAccessAir = typeLower.includes('akses udara');
        const isAccessSafe = typeLower.includes('akses aman');
        const isPublicKitchen = typeLower.includes('dapur umum');
        const isAidPost = typeLower.includes('posko bantuan');
        const isActive = activeRegion?.id === region.id;
        const scale = isActive ? 1.5 : 1;
        const size = (value) => value * scale;

        const severityClass = region.severity === 'critical' ? 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 
                              region.severity === 'high' ? 'bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.6)]' : 
                              'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]';
        const pulseClass = region.severity === 'critical' || region.severity === 'high' ? 'animate-ping' : '';
        
        const iconHtml = isAccessAir
          ? `
            <div style="position: relative; width: ${size(36)}px; height: ${size(36)}px; display: flex; align-items: center; justify-content: center;">
              <div style="width: ${size(32)}px; height: ${size(32)}px; border-radius: 9999px; background: rgba(16,185,129,0.15); border: ${size(2)}px solid rgba(16,185,129,0.8); box-shadow: 0 0 12px rgba(16,185,129,0.4);"></div>
              <div style="position: absolute; color: #22c55e; font-size: ${size(18)}px; font-weight: bold;">✈</div>
            </div>
          `
          : isAccessCut
          ? `
            <div style="position: relative; width: ${size(24)}px; height: ${size(24)}px; display: flex; align-items: center; justify-content: center;">
              <div style="width: ${size(18)}px; height: ${size(18)}px; border-radius: 9999px; background: #dc2626; border: ${size(3)}px solid #7f1d1d; box-shadow: 0 0 8px rgba(220,38,38,0.65);"></div>
              <div style="position: absolute; width: ${size(12)}px; height: ${size(3)}px; background: #fff; border-radius: 9999px;"></div>
            </div>
          `
          : isAccessSafe
          ? `
            <div style="position: relative; width: ${size(20)}px; height: ${size(20)}px; display: flex; align-items: center; justify-content: center;">
              <div style="width: ${size(10)}px; height: ${size(10)}px; border-radius: 9999px; background: #22c55e; border: ${size(2)}px solid #064e3b;"></div>
            </div>
          `
          : isPublicKitchen
          ? `
            <div style="position: relative; width: ${size(22)}px; height: ${size(22)}px; display: flex; align-items: center; justify-content: center;">
              <div style="width: ${size(18)}px; height: ${size(18)}px; border-radius: ${size(5)}px; background: linear-gradient(135deg,#fde047,#f97316); border: ${size(2)}px solid #78350f; box-shadow: 0 0 10px rgba(249,115,22,0.45); display: flex; align-items: center; justify-content: center;">
                <span style="color: #0f172a; font-size: ${size(9)}px; font-weight: 800; letter-spacing: 0.3px;">DU</span>
              </div>
              <div style="position: absolute; top: ${size(2)}px; width: ${size(8)}px; height: ${size(3)}px; border-radius: 9999px; background: rgba(255,255,255,0.85); opacity: 0.9;"></div>
            </div>
          `
          : isAidPost
          ? `
            <div style="position: relative; width: ${size(24)}px; height: ${size(24)}px; display: flex; align-items: center; justify-content: center;">
              <svg width="${size(20)}" height="${size(20)}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 0 6px rgba(239,68,68,0.6));">
                <polygon points="12,2 21,9 17.5,22 6.5,22 3,9" fill="#f87171" stroke="#7f1d1d" stroke-width="1.5" />
                <polygon points="12,4.3 19.1,9.7 16.4,20.3 7.6,20.3 4.9,9.7" fill="#b91c1c" opacity="0.4" />
              </svg>
              <div style="position:absolute; bottom:${size(4)}px; width:${size(8)}px; height:${size(2.4)}px; border-radius:9999px; background:rgba(255,255,255,0.6);"></div>
            </div>
          `
          : `
            <div style="position: relative; width: ${size(24)}px; height: ${size(24)}px; display: flex; align-items: center; justify-content: center;">
              <div class="${pulseClass} absolute inset-0 rounded-full ${severityClass} opacity-75"></div>
              <div style="width: ${size(12)}px; height: ${size(12)}px;" class="relative rounded-full ${severityClass} border-2 border-slate-900"></div>
            </div>
          `;

        const iconSize = isAccessAir
          ? [size(36), size(36)]
          : isAccessCut
          ? [size(24), size(24)]
          : isAccessSafe
          ? [size(20), size(20)]
          : isPublicKitchen
          ? [size(22), size(22)]
          : isAidPost
          ? [size(24), size(24)]
          : [size(24), size(24)];
        const iconAnchor = isAccessAir
          ? [size(18), size(18)]
          : isAccessCut
          ? [size(12), size(12)]
          : isAccessSafe
          ? [size(10), size(10)]
          : isPublicKitchen
          ? [size(11), size(11)]
          : isAidPost
          ? [size(12), size(12)]
          : [size(12), size(12)];

        const customIcon = window.L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize,
            iconAnchor
        });

        const marker = window.L.marker([region.lat, region.lng], { icon: customIcon, draggable: isActive && isEditingPosition }).addTo(map);
        marker.on('click', () => {
            setActiveRegion(region);
            computeSidebarPosition(region);
        });
        if (isActive && isEditingPosition) {
            marker.on('drag', (event) => {
                const { lat, lng } = event.latlng;
                setPositionEditCoords({ lat, lng });
            });
            marker.on('dragend', (event) => {
                const { lat, lng } = event.target.getLatLng();
                setPositionEditCoords({ lat, lng });
            });
        }
        markersRef.current[region.id] = marker;
    });
     if (searchPointer) {
        if (markersRef.current.__searchPointer) {
            map.removeLayer(markersRef.current.__searchPointer);
        }
        const pointerIcon = window.L.divIcon({
            className: 'custom-div-icon pointer',
            html: `
                <div style="position: relative; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;">
                    <div style="width: 14px; height: 14px; border-radius: 9999px; background: #22d3ee; border: 2px solid #0e7490; box-shadow: 0 0 10px rgba(34,211,238,0.7);"></div>
                </div>
            `,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        const pointerMarker = window.L.marker([searchPointer.lat, searchPointer.lng], { icon: pointerIcon, interactive: true }).addTo(map);
        pointerMarker.on('click', () => {
            openMapFormAt(searchPointer.lat, searchPointer.lng);
        });
        markersRef.current.__searchPointer = pointerMarker;
     }
  };

  useEffect(() => {
    if (mapInstanceRef.current && isLeafletReady && window.L) {
        Object.values(markersRef.current).forEach(m => m.remove());
        if (markersRef.current.__searchPointer) {
            markersRef.current.__searchPointer.remove();
            delete markersRef.current.__searchPointer;
        }
        addMarkersToMap(mapInstanceRef.current);
    }
  }, [regions, searchPointer, activeRegion, isEditingPosition]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !window.L) return;
    if (!userLocation) {
      if (userMarkerRef.current) {
        map.removeLayer(userMarkerRef.current);
        userMarkerRef.current = null;
      }
      if (userAccuracyRef.current) {
        map.removeLayer(userAccuracyRef.current);
        userAccuracyRef.current = null;
      }
      return;
    }
    const rotation = Number.isFinite(userLocation.heading) ? userLocation.heading : 0;
    const triangleIcon = window.L.divIcon({
      className: 'user-location-triangle',
      html: `
        <div style="position: relative; width: 0; height: 0; filter: drop-shadow(0 0 8px rgba(14,165,233,0.7));">
          <div style="
            width: 0;
            height: 0;
            border-left: 10px solid transparent;
            border-right: 10px solid transparent;
            border-bottom: 20px solid rgba(56,189,248,0.95);
            transform: rotate(${rotation}deg);
          "></div>
        </div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 18]
    });
    if (!userMarkerRef.current) {
      userMarkerRef.current = window.L.marker([userLocation.lat, userLocation.lng], {
        icon: triangleIcon,
        interactive: false,
        zIndexOffset: 1500
      }).addTo(map);
    } else {
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
      userMarkerRef.current.setIcon(triangleIcon);
    }
    if (Number.isFinite(userLocation.accuracy)) {
      const radius = Math.max(userLocation.accuracy, 15);
      if (!userAccuracyRef.current) {
        userAccuracyRef.current = window.L.circle([userLocation.lat, userLocation.lng], {
          radius,
          color: '#38bdf8',
          fillColor: '#0ea5e9',
          fillOpacity: 0.12,
          opacity: 0.8,
          weight: 1,
          interactive: false
        }).addTo(map);
      } else {
        userAccuracyRef.current.setLatLng([userLocation.lat, userLocation.lng]);
        userAccuracyRef.current.setRadius(radius);
      }
    } else if (userAccuracyRef.current) {
      map.removeLayer(userAccuracyRef.current);
      userAccuracyRef.current = null;
    }
    if (!hasCenteredOnUserRef.current) {
      map.flyTo([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 12), { duration: 0.75 });
      hasCenteredOnUserRef.current = true;
    }
  }, [userLocation, isLeafletReady]);

  useEffect(() => {
    if (!editingId || !editFormData?.name) return;
    const normalizedName = normalizeLocationKey(editFormData.name);
    const match = locationOptions.find((loc) => normalizeLocationKey(loc.name) === normalizedName);
    const presetId = match ? match.id : 'custom';
    if ((editFormData.locationPreset || 'custom') !== presetId) {
      setEditFormData((prev) => ({ ...prev, locationPreset: presetId }));
    }
  }, [locationOptions, editingId, editFormData?.name]);

  // --- HELPER FUNCTIONS ---
  const hashPassword = async (string) => {
    const utf8 = new TextEncoder().encode(string);
    const hashBuffer = await crypto.subtle.digest('SHA-256', utf8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((bytes) => bytes.toString(16).padStart(2, '0')).join('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const hash = await hashPassword(passwordInput);
    if (hash === TARGET_HASH) {
      setViewMode('admin');
      setLoginError(false);
      setPasswordInput('');
    } else {
      setLoginError(true);
    }
  };

  const getPresetForRegion = (region) => {
    if (!region?.name) return 'custom';
    const key = normalizeLocationKey(region.name);
    const match = locationOptions.find(loc => normalizeLocationKey(loc.name) === key);
    return match?.id || 'custom';
  };

  const handleLocationPresetChange = (event) => {
    const selectedId = event.target.value;
    if (selectedId === 'custom') {
      setEditFormData(prev => ({ ...prev, locationPreset: 'custom' }));
      return;
    }
    const preset = locationOptions.find(loc => loc.id === selectedId);
    if (preset) {
      setEditFormData(prev => ({
        ...prev,
        locationPreset: selectedId,
        name: preset.name,
        lat: preset.lat,
        lng: preset.lng
      }));
    }
  };

  const handleEditClick = (region) => {
    setEditingId(region.id);
    setEditFormData({ ...region, photos: normalizePhotos(region?.photos), locationPreset: getPresetForRegion(region) });
    setEditPhotoFiles([]);
  };

  const handleAddNew = () => {
    setEditingId('NEW');
    setEditFormData({
        id: `new-${Date.now()}`,
        name: '',
        lat: 0,
        lng: 0,
        disasterType: 'Banjir',
        victimsText: '-',
        status: 'Waspada',
        severity: 'medium',
        description: '',
        lastUpdate: new Date().toLocaleDateString('id-ID'),
        source: '-',
        photos: [],
        locationPreset: 'custom'
    });
    setEditPhotoFiles([]);
  };

  const handleEditPhotoInputChange = (event) => {
    const files = Array.from(event.target?.files || []);
    if (!files.length) return;
    const currentExisting = Array.isArray(editFormData.photos) ? editFormData.photos.length : 0;
    const remainingSlots = MAX_PHOTOS_PER_REGION - (currentExisting + editPhotoFiles.length);
    if (remainingSlots <= 0) {
      showFeedback(`Maksimal ${MAX_PHOTOS_PER_REGION} foto per titik.`);
      event.target.value = '';
      return;
    }
    const acceptedFiles = files.slice(0, remainingSlots);
    setEditPhotoFiles((prev) => [...prev, ...acceptedFiles]);
    if (acceptedFiles.length < files.length) {
      showFeedback(`Hanya ${MAX_PHOTOS_PER_REGION} foto yang dapat disimpan per titik.`);
    }
    event.target.value = '';
  };

  const handleRemoveEditExistingPhoto = (fileName) => {
    setEditFormData((prev) => ({
      ...prev,
      photos: (prev.photos || []).filter((photo) => photo !== fileName)
    }));
  };

  const handleRemoveEditNewPhoto = (index) => {
    setEditPhotoFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSyncFromAPI = async () => {
    if (isSyncingRegions) return;
    setIsSyncingRegions(true);
    showFeedback('Mengambil data wilayah Sumatera dari API...');
    try {
      const apiLocations = locationOptions.length ? locationOptions : await fetchSumatraLocationOptions();
      if (!apiLocations.length) throw new Error('API tidak mengembalikan data.');
      const currentRegions = regionsRef.current;
      const existingIds = new Set(currentRegions.map((region) => region.id));
      const timestamp = new Date().toLocaleDateString('id-ID');
      const newEntries = apiLocations
        .map((loc) => ({
          id: `api-${loc.id}`,
          name: loc.name,
          lat: loc.lat,
          lng: loc.lng,
          disasterType: 'Belum Tercatat',
          victimsText: '-',
          status: 'Waspada',
          severity: 'medium',
          description: `Data wilayah ${loc.name} (${loc.provinceName}) hasil sinkronisasi otomatis.`,
          lastUpdate: timestamp,
          source: 'API Ibnux (auto-sync)',
          photos: []
        }))
        .filter((entry) => Number.isFinite(entry.lat) && Number.isFinite(entry.lng) && !existingIds.has(entry.id));
      if (newEntries.length > 0) {
        const nextRegions = [...currentRegions, ...newEntries];
        await persistRegions(nextRegions, { successMessage: `${newEntries.length} wilayah baru ditambahkan dari API.` });
      } else {
        showFeedback('Tidak ada wilayah baru dari API.');
      }
    } catch (error) {
      console.error('API sync failed:', error);
      showFeedback('Sinkronisasi gagal. Periksa koneksi API.');
    } finally {
      setIsSyncingRegions(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Hapus data ini?')) return;
    const currentRegions = regionsRef.current;
    const nextRegions = currentRegions.filter(r => r.id !== id);
    await persistRegions(nextRegions, { successMessage: 'Data berhasil dihapus dan disimpan ke server.' });
  };

  const handleSaveForm = async (e) => {
    e.preventDefault();
    const { locationPreset, ...dataWithoutPreset } = editFormData;
    const formData = {
        ...dataWithoutPreset,
        lat: parseFloat(dataWithoutPreset.lat),
        lng: parseFloat(dataWithoutPreset.lng),
        photos: Array.isArray(dataWithoutPreset.photos) ? dataWithoutPreset.photos : []
    };
    try {
      const uploaded = await uploadRegionPhotos(editPhotoFiles, formData.name);
      formData.photos = normalizePhotos([...(formData.photos || []), ...uploaded]);
      setEditFormData((prev) => ({ ...prev, photos: formData.photos }));
      setEditPhotoFiles([]);
    } catch (error) {
      console.error('Edit form photo upload failed:', error);
      showFeedback(error?.message || 'Gagal mengunggah foto.');
      return;
    }
    const currentRegions = regionsRef.current;
    const nextRegions = editingId === 'NEW'
      ? [...currentRegions, formData]
      : currentRegions.map(r => r.id === editingId ? formData : r);
    await persistRegions(nextRegions, { successMessage: 'Data berhasil disimpan ke server.' });
    setEditingId(null);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'text-red-500 border-red-500 bg-red-500/20';
      case 'high': return 'text-orange-500 border-orange-500 bg-orange-500/20';
      case 'medium': return 'text-yellow-400 border-yellow-400 bg-yellow-400/20';
      default: return 'text-blue-400 border-blue-400 bg-blue-400/20';
    }
  };

  const getSeverityBg = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-400';
      default: return 'bg-blue-400';
    }
  };

  const getIcon = (type) => {
    if (!type) return <AlertTriangle size={24} />;
    const t = String(type).toLowerCase();
    if (t.includes('gempa')) return <Activity size={24} />;
    if (t.includes('banjir')) return <Droplets size={24} />;
    if (t.includes('kebakaran') || t.includes('erupsi')) return <Flame size={24} />;
    if (t.includes('angin')) return <Wind size={24} />;
    return <AlertTriangle size={24} />;
  };

  const resolveRouteColor = (route, index = 0) => {
    if (route?.color) return route.color;
    return getRoutePaletteColor(index);
  };

  const formatDurationMinutes = (minutes) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return 'N/A';
    const totalMinutes = Math.round(minutes);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours > 0) {
      return `${hours} jam ${mins} mnt`;
    }
    return `${mins} menit`;
  };

  const showFeedback = (message, duration = 6000) => {
    setSyncFeedback(message);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    if (message) {
      feedbackTimerRef.current = setTimeout(() => setSyncFeedback(null), duration);
    }
  };

  const pushLocationToast = useCallback((message, type = 'info', duration = 5000) => {
    if (!message) return;
    setLocationToast({ message, type });
    if (locationToastTimerRef.current) {
      clearTimeout(locationToastTimerRef.current);
    }
    locationToastTimerRef.current = setTimeout(() => setLocationToast(null), duration);
  }, []);

  const fetchRouteSegment = useCallback(async (start, end) => {
    if (!start || !end) return;
    setIsRoutingSegment(true);
    try {
      const startLat = start[0];
      const startLng = start[1];
      const endLat = end[0];
      const endLng = end[1];
      const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('OSRM request failed');
      const data = await response.json();
      const [routeCandidate] = data.routes || [];
      const coords = routeCandidate?.geometry?.coordinates || [];
      if (!coords.length) {
        throw new Error('Empty geometry');
      }
      const latLngSegments = coords.map(([lng, lat]) => [lat, lng]);
      setRouteDraftSegments((prev) => [...prev, latLngSegments]);
      const distanceKm = Number(routeCandidate.distance || 0) / 1000;
      if (Number.isFinite(distanceKm)) {
        setRouteDraftDistance((prev) => prev + distanceKm);
      }
      setRouteDraftError(null);
    } catch (error) {
      console.error('Route segment error:', error);
      setRouteDraftError('Gagal menemukan jalur jalan untuk titik tersebut. Pilih titik lain.');
      setRouteDraftPoints((prev) => prev.slice(0, -1));
    } finally {
      setIsRoutingSegment(false);
    }
  }, []);

  const handleRouteMapClick = useCallback((event) => {
    if (!isCreatingRoute) return;
    if (isRoutingSegment) {
      setRouteDraftError('Sedang menghitung jalur sebelumnya, harap tunggu.');
      return;
    }
    const { lat, lng } = event?.latlng || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setRouteDraftError(null);
    const newPoint = [lat, lng];
    const lastPoint = routePointsRef.current[routePointsRef.current.length - 1];
    setRouteDraftPoints((prev) => [...prev, newPoint]);
    if (lastPoint) {
      fetchRouteSegment(lastPoint, newPoint);
    }
  }, [fetchRouteSegment, isCreatingRoute, isRoutingSegment]);

  useEffect(() => {
    if (!isCreatingRoute) return undefined;
    const map = mapInstanceRef.current;
    if (!map || !window.L) return undefined;
    const clickHandler = (event) => handleRouteMapClick(event);
    map.on('click', clickHandler);
    return () => {
      map.off('click', clickHandler);
    };
  }, [isCreatingRoute, handleRouteMapClick]);

  const handleFinishRoute = async () => {
    if (!isCreatingRoute) return;
    if (isRoutingSegment) {
      setRouteDraftError('Sedang menghitung jalur, tunggu sebelum menyelesaikan.');
      return;
    }
    if (routeDraftSegments.length === 0 || routeDraftPoints.length < 2) {
      setRouteDraftError('Tambahkan minimal dua titik di peta untuk membentuk jalur.');
      return;
    }
    setIsSavingRoute(true);
    const mergedCoords = [];
    routeDraftSegments.forEach((segment, segmentIndex) => {
      if (!Array.isArray(segment)) return;
      segment.forEach((coord, coordIndex) => {
        if (!Array.isArray(coord) || coord.length < 2) return;
        if (segmentIndex > 0 && coordIndex === 0) return;
        mergedCoords.push(coord);
      });
    });
    if (!mergedCoords.length) {
      setRouteDraftError('Jalur belum terbentuk. Coba ulangi titik Anda.');
      setIsSavingRoute(false);
      return;
    }
    const totalDistance = Number.isFinite(routeDraftDistance) ? Number(routeDraftDistance.toFixed(3)) : 0;
    const totalDuration = totalDistance > 0 ? Number(((totalDistance / AVERAGE_CAR_SPEED_KMH) * 60).toFixed(2)) : 0;
    const newRoute = {
      id: `route-${Date.now()}`,
      name: routeDraftName?.trim() || `Jalur ${routesRef.current.length + 1}`,
      color: routeDraftColor || getRoutePaletteColor(routesRef.current.length),
      coordinates: mergedCoords,
      distanceKm: totalDistance,
      durationMinutes: totalDuration,
      createdAt: new Date().toISOString()
    };
    const nextRoutes = [...routesRef.current, newRoute];
    const success = await persistRoutes(nextRoutes, { successMessage: 'Jalur baru berhasil disimpan.' });
    setIsSavingRoute(false);
    if (success) {
      cancelRouteCreation();
    }
  };

  const resetMapFormState = () => {
    setMapFormData({ type: 'Akses Putus', name: '', description: '', victims: '', status: '', severity: 'medium' });
    setMapFormPassword('');
    setMapFormAuthorized(false);
    setMapFormError(null);
    setIsSubmittingMapForm(false);
    setMapExistingPhotos([]);
    setMapPhotoFiles([]);
    setMapPhotoError(null);
  };

  const openMapFormAt = (lat, lng, editingRegion = null) => {
    if (editingRegion) {
      setMapFormData({
        type: editingRegion.disasterType || 'Akses Putus',
        name: editingRegion.name || '',
        description: editingRegion.description || '',
        victims: editingRegion.victimsText || '',
        status: editingRegion.status || '',
        severity: editingRegion.severity || 'medium'
      });
      setMapExistingPhotos(normalizePhotos(editingRegion.photos));
      setMapPhotoFiles([]);
      setMapPhotoError(null);
      setMapEditTarget(editingRegion);
      setMapAddForm({ open: true, lat: editingRegion.lat, lng: editingRegion.lng });
    } else {
      resetMapFormState();
      setMapAddForm({ open: true, lat, lng });
    }
  };

  const closeMapForm = () => {
    setMapAddForm({ open: false, lat: null, lng: null });
    resetMapFormState();
    setMapEditTarget(null);
  };

  const handleMapPhotoInputChange = (event) => {
    const files = Array.from(event.target?.files || []);
    if (!files.length) return;
    const totalSelected = mapExistingPhotos.length + mapPhotoFiles.length;
    const remainingSlots = MAX_PHOTOS_PER_REGION - totalSelected;
    if (remainingSlots <= 0) {
      setMapPhotoError(`Maksimal ${MAX_PHOTOS_PER_REGION} foto per titik.`);
      event.target.value = '';
      return;
    }
    const acceptedFiles = files.slice(0, remainingSlots);
    setMapPhotoFiles((prev) => [...prev, ...acceptedFiles]);
    setMapPhotoError(acceptedFiles.length < files.length
      ? `Maksimal ${MAX_PHOTOS_PER_REGION} foto per titik. Beberapa file tidak dimasukkan.`
      : null);
    event.target.value = '';
  };

  const handleRemoveMapExistingPhoto = (fileName) => {
    setMapExistingPhotos((prev) => prev.filter((photo) => photo !== fileName));
  };

  const handleRemoveMapNewPhoto = (index) => {
    setMapPhotoFiles((prev) => prev.filter((_, idx) => idx !== index));
  };
  const openPhotoGallery = useCallback((region, startIndex = 0) => {
    if (!region?.photos || !region.photos.length) return;
    const boundedIndex = Math.min(Math.max(startIndex, 0), region.photos.length - 1);
    setPhotoGalleryModal({
      open: true,
      photos: region.photos,
      title: region.name || 'Album Foto',
      activeIndex: boundedIndex
    });
  }, []);

  const closePhotoGallery = useCallback(() => {
    setPhotoGalleryModal({ open: false, photos: [], title: '', activeIndex: 0 });
  }, []);

  const openSearchModal = () => {
    setIsSearchModalOpen(true);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    setSearchPointer(null);
  };

  const closeSearchModal = () => {
    setIsSearchModalOpen(false);
  };

  const activatePositionEditing = () => {
    if (!activeRegion) return;
    setIsEditingPosition(true);
    setPositionEditCoords({ lat: activeRegion.lat, lng: activeRegion.lng });
  };

  const openPasswordModal = (context, payload = null) => {
    setPasswordModal({ open: true, context, payload });
    setPasswordInputValue('');
    setPasswordModalError(null);
  };

  const closePasswordModal = () => {
    setPasswordModal({ open: false, context: null, payload: null });
    setPasswordInputValue('');
    setPasswordModalError(null);
  };

  const handlePasswordModalSubmit = async (event) => {
    event.preventDefault();
    setPasswordModalError(null);
    try {
      const hash = await hashPassword(passwordInputValue);
      if (hash !== TARGET_HASH) {
        setPasswordModalError('Password salah.');
        return;
      }
      if (passwordModal.context === 'position-edit') {
        setPositionAuthorized(true);
        activatePositionEditing();
        closePasswordModal();
        return;
      }
      if (passwordModal.context === 'route-mode') {
        setRouteAuthorized(true);
        closePasswordModal();
        if (passwordModal.payload?.action === 'start-route') {
          startRouteCreation();
        }
        return;
      }
      closePasswordModal();
    } catch (error) {
      console.error('Password modal error:', error);
      setPasswordModalError('Gagal memverifikasi password.');
    }
  };

  const handlePositionEditButtonClick = () => {
    if (!activeRegion) return;
    if (isEditingPosition) {
      setIsEditingPosition(false);
      setPositionEditCoords(null);
      return;
    }
    if (positionAuthorized) {
      activatePositionEditing();
      return;
    }
    openPasswordModal('position-edit');
  };

  const resetPositionAuth = () => {
    setPositionAuthorized(false);
    if (passwordModal.context === 'position-edit') {
      closePasswordModal();
    }
  };

  const stopTrackingUser = useCallback(({ silent } = {}) => {
    if (typeof navigator !== 'undefined' && navigator.geolocation && userWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(userWatchIdRef.current);
    }
    userWatchIdRef.current = null;
    setIsTrackingUser(false);
    setIsLocating(false);
    setUserLocation(null);
    hasCenteredOnUserRef.current = false;
    if (mapInstanceRef.current) {
      if (userMarkerRef.current) {
        mapInstanceRef.current.removeLayer(userMarkerRef.current);
      }
      if (userAccuracyRef.current) {
        mapInstanceRef.current.removeLayer(userAccuracyRef.current);
      }
    }
    userMarkerRef.current = null;
    userAccuracyRef.current = null;
    if (!silent) {
      setLocationModalError(null);
    }
  }, []);

  const startTrackingUser = useCallback(() => {
    if (isLocating || userWatchIdRef.current !== null) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationModalError('Peramban ini tidak mendukung GPS.');
      pushLocationToast('Peramban ini tidak mendukung GPS.', 'error');
      return;
    }
    setLocationModalError(null);
    setIsLocationModalOpen(false);
    setIsLocating(true);
    try {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setIsLocating(false);
          setIsTrackingUser((prev) => {
            if (!prev) {
              pushLocationToast('Lokasi Anda ditampilkan di peta.', 'success');
            }
            return true;
          });
          const { latitude, longitude, accuracy, heading, speed } = position.coords || {};
          setUserLocation({
            lat: latitude,
            lng: longitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : 25,
            heading: Number.isFinite(heading) ? heading : 0,
            speed: Number.isFinite(speed) ? speed : 0,
            timestamp: position.timestamp
          });
          setLocationPermissionState('granted');
        },
        (error) => {
          setIsLocating(false);
          if (!error) {
            pushLocationToast('Gagal mendapatkan lokasi Anda.', 'error');
            stopTrackingUser({ silent: true });
            return;
          }
          if (error.code === error.PERMISSION_DENIED) {
            setLocationPermissionState('denied');
            pushLocationToast('Izin GPS ditolak. Aktifkan melalui pengaturan browser.', 'error');
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            pushLocationToast('Sinyal GPS tidak tersedia saat ini.', 'error');
          } else if (error.code === error.TIMEOUT) {
            pushLocationToast('Penentuan lokasi melebihi batas waktu.', 'error');
          } else {
            pushLocationToast('Gagal mendapatkan lokasi Anda.', 'error');
          }
          stopTrackingUser({ silent: true });
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000
        }
      );
      userWatchIdRef.current = watchId;
    } catch (error) {
      setIsLocating(false);
      setLocationModalError('Browser memblokir akses GPS.');
      pushLocationToast('Browser memblokir akses GPS.', 'error');
    }
  }, [isLocating, pushLocationToast, stopTrackingUser]);

  const handleLocateButtonClick = useCallback(() => {
    if (isTrackingUser) {
      stopTrackingUser();
      pushLocationToast('Pelacakan GPS dimatikan.', 'info');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      pushLocationToast('Peramban ini tidak mendukung GPS.', 'error');
      return;
    }
    if (locationPermissionState === 'denied') {
      pushLocationToast('Izin GPS masih diblokir oleh browser.', 'error');
      return;
    }
    if (locationPermissionState === 'granted') {
      startTrackingUser();
      return;
    }
    setIsLocationModalOpen(true);
    setLocationModalError(null);
  }, [isTrackingUser, locationPermissionState, pushLocationToast, startTrackingUser, stopTrackingUser]);

  const handleLocationPermissionConfirm = useCallback(() => {
    if (locationPermissionState === 'denied') {
      pushLocationToast('Izin GPS sedang diblokir. Buka pengaturan browser Anda.', 'error');
      return;
    }
    startTrackingUser();
  }, [locationPermissionState, pushLocationToast, startTrackingUser]);

  const handleLocationPermissionClose = useCallback(() => {
    setIsLocationModalOpen(false);
    setLocationModalError(null);
  }, []);

  useEffect(() => {
    if (locationPermissionState === 'granted') {
      setIsLocationModalOpen(false);
      setLocationModalError(null);
    }
  }, [locationPermissionState]);

  useEffect(() => {
    if (viewMode !== 'map') {
      stopTrackingUser();
    }
  }, [viewMode, stopTrackingUser]);

  useEffect(() => {
    return () => {
      stopTrackingUser();
      if (locationToastTimerRef.current) {
        clearTimeout(locationToastTimerRef.current);
      }
    };
  }, [stopTrackingUser]);

  useEffect(() => {
    return () => {
      cancelRouteHoldTimer();
    };
  }, [cancelRouteHoldTimer]);

  const persistRegions = async (nextRegions, { successMessage } = {}) => {
    const normalizedRegions = (nextRegions || []).map((region) => ({
      ...region,
      photos: normalizePhotos(region?.photos)
    }));
    setRegions(normalizedRegions);
    if (typeof fetch === 'undefined') {
      showFeedback('API server tidak tersedia di lingkungan ini.');
      return false;
    }
    if (!DISASTERS_API_URL) {
      showFeedback('Endpoint API belum dikonfigurasi.');
      return false;
    }
    try {
      setIsPersistingRegions(true);
      const response = await fetch(DISASTERS_API_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: normalizedRegions }),
      });
      if (!response.ok) {
        throw new Error('Failed to save server data');
      }
      if (successMessage) {
        showFeedback(successMessage);
      }
      return true;
    } catch (error) {
      console.error('Failed to persist regions:', error);
      showFeedback('Gagal menyimpan ke server. Data hanya tersimpan di browser.');
      return false;
    } finally {
      setIsPersistingRegions(false);
    }
  };

  const persistRoutes = async (nextRoutes, { successMessage } = {}) => {
    setRoutes(nextRoutes);
    if (typeof fetch === 'undefined') {
      showFeedback('API server tidak tersedia di lingkungan ini.');
      return false;
    }
    if (!ROUTES_API_URL) {
      showFeedback('Endpoint API jalur belum dikonfigurasi.');
      return false;
    }
    try {
      setIsPersistingRoutes(true);
      const response = await fetch(ROUTES_API_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: nextRoutes })
      });
      if (!response.ok) {
        throw new Error('Failed to save routes data');
      }
      if (successMessage) {
        showFeedback(successMessage);
      }
      return true;
    } catch (error) {
      console.error('Failed to persist routes:', error);
      showFeedback('Gagal menyimpan data jalur ke server.');
      return false;
    } finally {
      setIsPersistingRoutes(false);
    }
  };

  const handleMapFormUnlock = async (e) => {
    e.preventDefault();
    try {
      const hash = await hashPassword(mapFormPassword);
      if (hash === TARGET_HASH) {
        setMapFormAuthorized(true);
        setMapFormError(null);
      } else {
        setMapFormError('Password salah.');
      }
    } catch (error) {
      console.error('Password hash error:', error);
      setMapFormError('Gagal memverifikasi password.');
    }
  };

  const handleMapFormSubmit = async (e) => {
    e.preventDefault();
    if (!mapAddForm.open || !mapFormAuthorized) {
      setMapFormError('Masukkan password admin terlebih dahulu.');
      return;
    }
    setIsSubmittingMapForm(true);
    const timestamp = new Date().toLocaleDateString('id-ID');
    const isEditing = Boolean(mapEditTarget);
    const entryId = isEditing ? mapEditTarget.id : `map-${Date.now()}`;
    let uploadedPhotos = [];
    try {
      uploadedPhotos = await uploadRegionPhotos(mapPhotoFiles, mapFormData.name || `Titik ${timestamp}`);
    } catch (error) {
      console.error('Map form photo upload failed:', error);
      setMapFormError(error?.message || 'Gagal mengunggah foto.');
      setIsSubmittingMapForm(false);
      return;
    }
    const combinedPhotos = normalizePhotos([
      ...mapExistingPhotos,
      ...uploadedPhotos
    ]);
    const newEntry = {
      id: entryId,
      name: mapFormData.name || `Titik ${timestamp}`,
      lat: mapAddForm.lat,
      lng: mapAddForm.lng,
      disasterType: mapFormData.type || 'Akses Putus',
      victimsText: mapFormData.victims || '-',
      status: mapFormData.status || 'Waspada',
      severity: mapFormData.severity || 'medium',
      description: mapFormData.description || '-',
      lastUpdate: timestamp,
      source: 'Map Context Form',
      photos: combinedPhotos
    };
    const nextRegions = isEditing
      ? regionsRef.current.map(region => region.id === entryId ? newEntry : region)
      : [...regionsRef.current, newEntry];
    const success = await persistRegions(nextRegions, { successMessage: isEditing ? 'Titik berhasil diperbarui.' : 'Titik baru berhasil ditambahkan.' });
    setIsSubmittingMapForm(false);
    if (success) {
      if (isEditing && activeRegion?.id === entryId) {
        setActiveRegion(newEntry);
      }
      setMapExistingPhotos([]);
      setMapPhotoFiles([]);
      setMapPhotoError(null);
      if (isEditingPosition) {
        setIsEditingPosition(false);
        setPositionEditCoords(null);
        resetPositionAuth();
      }
      closeMapForm();
    }
  };

  const startSidebarDrag = (event) => {
    if (!sidebarPosition) return;
    if (event?.preventDefault) event.preventDefault();
    const pointer = event?.touches ? event.touches[0] : event;
    if (!pointer) return;
    setSidebarLocked(true);
    sidebarDragRef.current = {
      active: true,
      offsetX: pointer.clientX - sidebarPosition.left,
      offsetY: pointer.clientY - sidebarPosition.top
    };
    window.addEventListener('mousemove', handleSidebarDrag);
    window.addEventListener('mouseup', stopSidebarDrag);
    window.addEventListener('touchmove', handleSidebarDrag, { passive: false });
    window.addEventListener('touchend', stopSidebarDrag);
  };

  const handleSidebarDrag = (event) => {
    const info = sidebarDragRef.current;
    if (!info.active) return;
    if (event?.preventDefault) event.preventDefault();
    const pointer = event?.touches ? event.touches[0] : event;
    if (!pointer) return;
    const left = pointer.clientX - info.offsetX;
    const top = pointer.clientY - info.offsetY;
    setSidebarPosition({ left, top });
  };

  const stopSidebarDrag = () => {
    sidebarDragRef.current.active = false;
    window.removeEventListener('mousemove', handleSidebarDrag);
    window.removeEventListener('mouseup', stopSidebarDrag);
    window.removeEventListener('touchmove', handleSidebarDrag);
    window.removeEventListener('touchend', stopSidebarDrag);
  };
  const handleSavePositionEdit = async () => {
    if (!activeRegion || !positionEditCoords) return;
    setIsSavingPosition(true);
    const updatedRegion = { ...activeRegion, lat: positionEditCoords.lat, lng: positionEditCoords.lng };
    const nextRegions = regionsRef.current.map(region => region.id === updatedRegion.id ? updatedRegion : region);
    const success = await persistRegions(nextRegions, { successMessage: 'Posisi titik diperbarui.' });
    setIsSavingPosition(false);
    if (success) {
      setActiveRegion(updatedRegion);
      setIsEditingPosition(false);
      setPositionEditCoords(null);
    }
  };

  // --- RENDERERS ---

  const renderMapSection = () => (
    <div className="relative w-full h-screen bg-slate-900">
      <div
        id="map-container"
        ref={mapContainerRef}
        className="absolute inset-0 bg-slate-900"
        style={{ cursor: isCreatingRoute ? 'crosshair' : undefined }}
      >
        {!isLeafletReady && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 animate-pulse">
            Initializing Map System...
          </div>
        )}
      </div>
      <div className="absolute top-3 left-3 z-[400] text-[10px] font-mono text-cyan-500/80 bg-slate-950/80 px-3 py-1.5 rounded-full border border-slate-800/70">
        LAT: {activeRegion?.lat?.toFixed(4) || '-'} | LNG: {activeRegion?.lng?.toFixed(4) || '-'}
      </div>
      {isCreatingRoute && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[420] bg-slate-950/85 border border-pink-500/50 text-pink-100 px-4 py-1.5 rounded-full text-[11px] font-semibold shadow-lg shadow-pink-500/10">
          Mode jalur aktif – klik jalan untuk menambah titik, tekan "Selesai" jika sudah.
        </div>
      )}
      <div className="absolute top-3 right-3 z-[450] flex gap-2">
        <button
          onClick={handleLocateButtonClick}
          className={`p-2 rounded-full border transition ${isTrackingUser ? 'bg-cyan-600 border-cyan-400 text-white shadow-lg shadow-cyan-500/30' : 'bg-slate-900/80 border-slate-700 text-slate-200 hover:text-cyan-300'}`}
          aria-label={isTrackingUser ? 'Matikan pelacakan GPS' : 'Tampilkan lokasi saya'}
        >
          {isLocating ? <Activity size={16} className="animate-spin" /> : <Navigation size={16} />}
        </button>
        <button
          onClick={openSearchModal}
          className="p-2 rounded-full bg-slate-900/80 border border-slate-700 text-slate-200 hover:text-cyan-300 transition"
          aria-label="Cari Lokasi"
        >
          <Search size={16} />
        </button>
        <button
          onClick={handleRouteModeToggle}
          className={`p-2 rounded-full border transition ${isCreatingRoute ? 'bg-pink-600/90 border-pink-400 text-white shadow-lg shadow-pink-500/30' : 'bg-slate-900/80 border-slate-700 text-slate-200 hover:text-pink-300'}`}
          aria-label={isCreatingRoute ? 'Batalkan pembuatan jalur' : 'Buat jalur baru'}
        >
          <GitBranch size={16} />
        </button>
        <button
          onClick={() => setViewMode('login')}
          className="p-2 rounded-full bg-slate-900/80 border border-slate-700 text-slate-200 hover:text-cyan-300 transition"
          aria-label="Admin Login"
        >
          <Lock size={16} />
        </button>
      </div>
    </div>
  );

  const renderSidebarModal = () => {
    if (!activeRegion || !sidebarPosition) return null;
    const top = sidebarPosition.top;
    const left = sidebarPosition.left;
    return (
      <div className="fixed z-[550] pointer-events-auto" style={{ top, left }}>
        <div className="w-80 bg-slate-900/95 border border-slate-700 rounded-2xl shadow-2xl p-4 relative backdrop-blur">
          <button onClick={() => { setActiveRegion(null); setSidebarPosition(null); }} className="absolute top-3 right-3 text-slate-400 hover:text-white">
            <X size={16} />
          </button>
          <div
            className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-slate-500/80 mb-2 cursor-move select-none pr-6"
            onMouseDown={startSidebarDrag}
            onTouchStart={startSidebarDrag}
          >
            <span className="inline-flex h-1.5 w-12 rounded-full bg-slate-600/70" />
            Geser
          </div>
          <h2 className="text-lg font-bold text-white mb-2">{activeRegion.name}</h2>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getSeverityColor(activeRegion.severity)}`}>{activeRegion.status}</span>
          <div className="mt-3 space-y-3 text-sm">
            <div className="bg-slate-950/40 border border-slate-800 rounded p-2">
              <p className="text-[10px] text-slate-500">TYPE</p>
              <p className="font-semibold text-white">{activeRegion.disasterType}</p>
            </div>
            <div className="bg-slate-950/40 border border-slate-800 rounded p-2">
              <p className="text-[10px] text-slate-500">IMPACT</p>
              <p className="font-mono text-cyan-400 text-xs">{activeRegion.victimsText}</p>
            </div>
            <div className="bg-slate-800/30 border border-slate-800 rounded p-2">
              <p className="text-[10px] text-cyan-500/70 mb-1">REPORT</p>
              <p className="text-xs text-slate-300">"{activeRegion.description}"</p>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              Lat {activeRegion.lat?.toFixed(4)} · Lng {activeRegion.lng?.toFixed(4)} <br /> Update {activeRegion.lastUpdate}
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => openMapFormAt(activeRegion.lat, activeRegion.lng, activeRegion)} className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white rounded-lg flex items-center justify-center gap-2 disabled:bg-slate-700" disabled={isEditingPosition}>
                <Edit3 size={14} /> Edit Data Titik
              </button>
              <button
                onClick={handlePositionEditButtonClick}
                className={`w-full py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-2 ${isEditingPosition ? 'bg-yellow-500 text-slate-900' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
              >
                {isEditingPosition ? 'Batalkan Edit Posisi' : 'Edit Posisi Titik'}
              </button>
              {isEditingPosition && (
                <div className="text-[11px] text-slate-400 font-mono text-center">
                  Lat {(positionEditCoords?.lat ?? activeRegion.lat).toFixed(5)} · Lng {(positionEditCoords?.lng ?? activeRegion.lng).toFixed(5)}
                </div>
              )}
              {isEditingPosition && (
                <button
                  onClick={handleSavePositionEdit}
                  className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white rounded-lg flex items-center justify-center gap-2 disabled:bg-slate-700"
                  disabled={isSavingPosition || !positionEditCoords}
                >
                  {isSavingPosition ? <Activity size={14} className="animate-spin" /> : null}
                  {isSavingPosition ? 'Menyimpan...' : 'Simpan Posisi Titik'}
                </button>
              )}
            </div>
            {Array.isArray(activeRegion.photos) && activeRegion.photos.length > 0 && (
              <div className="pt-2 border-t border-slate-800/50">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">
                  <span>Dokumentasi</span>
                  <span>{activeRegion.photos.length} Foto</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {activeRegion.photos.slice(0, 4).map((photoName, index) => (
                    <button
                      key={`${photoName}-${index}`}
                      onClick={() => openPhotoGallery(activeRegion, index)}
                      className="relative w-full pt-[56%] bg-slate-900/60 rounded-lg overflow-hidden border border-slate-800 group"
                    >
                      <img
                        src={resolvePhotoUrl(photoName)}
                        alt={`${activeRegion.name} dokumentasi ${index + 1}`}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-slate-950/20 group-hover:bg-slate-950/5 transition-colors" />
                    </button>
                  ))}
                </div>
                {activeRegion.photos.length > 4 && (
                  <button
                    onClick={() => openPhotoGallery(activeRegion, 0)}
                    className="mt-3 w-full text-xs font-semibold text-cyan-300 hover:text-white py-1.5 border border-slate-800 rounded-lg flex items-center justify-center gap-2"
                  >
                    <Image size={14} /> Lihat semua
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMobileSnackbar = () => null;

  const renderMapAddOverlay = () => {
    if (!mapAddForm.open) return null;
    const mapTypeSelectValue = isTypeWithinOptions(typeOptions, mapFormData.type)
      ? mapFormData.type
      : TYPE_SELECT_CUSTOM_VALUE;
    const showMapCustomTypeInput = mapTypeSelectValue === TYPE_SELECT_CUSTOM_VALUE;
    return (
      <div className="fixed inset-0 z-[650] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm px-4 py-6">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xl p-6 relative shadow-2xl">
          <button onClick={closeMapForm} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X size={18} />
          </button>
          <h3 className="text-lg font-bold text-white mb-2">Tambahkan Kondisi dari Peta</h3>
          <p className="text-xs text-slate-400">Klik kanan di peta membuka formulir ini. Koordinat: <span className="font-mono text-cyan-400">{mapAddForm.lat?.toFixed(4)}, {mapAddForm.lng?.toFixed(4)}</span></p>
          {!mapFormAuthorized ? (
            <form onSubmit={handleMapFormUnlock} className="mt-4 space-y-3">
              <label className="text-xs text-slate-400 uppercase tracking-wide">Password Admin</label>
              <input type="password" value={mapFormPassword} onChange={(e) => setMapFormPassword(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white" placeholder="Masukkan password admin" autoFocus />
              {mapFormError && <p className="text-xs text-red-400">{mapFormError}</p>}
              <button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-semibold py-2 rounded-lg">Verifikasi Password</button>
            </form>
          ) : (
            <form onSubmit={handleMapFormSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase">Jenis / Tipe</label>
                <select
                  value={mapTypeSelectValue}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    if (nextValue === TYPE_SELECT_CUSTOM_VALUE) {
                      setMapFormData((prev) => ({ ...prev, type: '' }));
                    } else {
                      setMapFormData((prev) => ({ ...prev, type: nextValue }));
                    }
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                >
                  {typeOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                  <option value={TYPE_SELECT_CUSTOM_VALUE}>Masukkan Manual</option>
                </select>
                {showMapCustomTypeInput && (
                  <input
                    value={mapFormData.type}
                    onChange={(e) => setMapFormData((prev) => ({ ...prev, type: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white mt-2"
                    placeholder="Tulis jenis secara manual"
                  />
                )}
                <span className="text-[10px] text-slate-500 mt-1 inline-block">Tambahkan titik Dapur Umum atau pilih tipe lain yang tersedia.</span>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase">Nama Wilayah</label>
                <input value={mapFormData.name} onChange={(e) => setMapFormData({ ...mapFormData, name: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white" placeholder="Contoh: Ruas Bireuen - Takengon" required />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase">Deskripsi</label>
                <textarea value={mapFormData.description} onChange={(e) => setMapFormData({ ...mapFormData, description: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white" rows="3" placeholder="Detail kejadian (opsional)" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase">Dampak / Korban</label>
                <input value={mapFormData.victims} onChange={(e) => setMapFormData({ ...mapFormData, victims: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white" placeholder='Contoh: "Akses total, 200 KK terdampak"' />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase">Tingkat Keparahan</label>
                <select value={mapFormData.severity} onChange={(e) => setMapFormData({ ...mapFormData, severity: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white">
                  <option value="medium">Medium (Waspada)</option>
                  <option value="high">High (Siaga)</option>
                  <option value="critical">Critical (Darurat)</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase">Label Status</label>
                <input value={mapFormData.status} onChange={(e) => setMapFormData({ ...mapFormData, status: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white" placeholder="Contoh: Darurat (opsional)" />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-400 uppercase flex items-center gap-2">
                  Foto Dokumentasi
                  <span className="text-[10px] text-slate-500">(maks {MAX_PHOTOS_PER_REGION} foto)</span>
                </label>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleMapPhotoInputChange}
                  className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-cyan-600 file:text-white hover:file:bg-cyan-500 bg-slate-900 border border-slate-800 rounded-lg"
                />
                {mapPhotoError && <p className="text-[10px] text-amber-400 mt-1">{mapPhotoError}</p>}
                {mapExistingPhotos.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {mapExistingPhotos.map((photoName, index) => (
                      <div key={`${photoName}-${index}`} className="relative rounded-lg overflow-hidden border border-slate-800">
                        <img src={resolvePhotoUrl(photoName)} alt={`Foto ${index + 1}`} className="w-full h-full object-cover" loading="lazy" />
                        <button
                          type="button"
                          onClick={() => handleRemoveMapExistingPhoto(photoName)}
                          className="absolute top-1 right-1 bg-slate-900/80 text-[10px] px-1.5 py-0.5 rounded text-red-300 hover:bg-slate-900"
                        >
                          Hapus
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {mapPhotoFiles.length > 0 && (
                  <ul className="mt-2 text-[11px] text-slate-300 space-y-1">
                    {mapPhotoFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2">
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMapNewPhoto(index)}
                          className="text-red-400 hover:text-red-300 text-[10px]"
                        >
                          Hapus
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {mapFormError && <p className="text-xs text-red-400">{mapFormError}</p>}
              <button type="submit" disabled={isSubmittingMapForm} className={`w-full py-2 rounded-lg font-semibold text-white flex items-center justify-center gap-2 ${isSubmittingMapForm ? 'bg-slate-700 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500'}`}>
                {isSubmittingMapForm ? <Activity size={16} className="animate-spin" /> : <Plus size={16} />}
                {isSubmittingMapForm ? 'Menyimpan...' : 'Simpan ke Database'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  };

  const renderPhotoGalleryModal = () => {
    if (!photoGalleryModal.open) return null;
    const { photos, title, activeIndex } = photoGalleryModal;
    const activePhotoSrc = photos[activeIndex] ? resolvePhotoUrl(photos[activeIndex]) : null;
    return (
      <div className="fixed inset-0 z-[675] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4 py-6">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl p-6 relative shadow-2xl">
          <button onClick={closePhotoGallery} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X size={20} />
          </button>
          <div className="flex items-center gap-2 text-cyan-300 text-xs font-semibold tracking-[0.3em] uppercase mb-2">
            <Image size={16} /> Album Foto
          </div>
          <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
          {activePhotoSrc ? (
            <div className="w-full aspect-video bg-slate-950/50 border border-slate-800 rounded-xl overflow-hidden flex items-center justify-center">
              <img src={activePhotoSrc} alt={`${title} foto ${activeIndex + 1}`} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="w-full aspect-video bg-slate-950/50 border border-dashed border-slate-700 rounded-xl flex items-center justify-center text-slate-500">
              Tidak ada foto dipilih
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-4 max-h-72 overflow-y-auto custom-scrollbar pr-1">
            {photos.map((photoName, index) => (
              <button
                key={`${photoName}-${index}`}
                onClick={() => setPhotoGalleryModal((prev) => ({ ...prev, activeIndex: index }))}
                className={`relative w-full pt-[70%] rounded-lg overflow-hidden border ${index === activeIndex ? 'border-cyan-400 shadow shadow-cyan-500/30' : 'border-slate-800'}`}
              >
                <img
                  src={resolvePhotoUrl(photoName)}
                  alt={`${title} foto ${index + 1}`}
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-slate-950/20 hover:bg-slate-950/5 transition-colors" />
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-3">Klik thumbnail untuk memperbesar tampilan foto di atas.</p>
        </div>
      </div>
    );
  };

  const renderLocationPermissionModal = () => {
    if (!isLocationModalOpen) return null;
    return (
      <div className="fixed inset-0 z-[700] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm px-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 relative shadow-2xl text-slate-100">
          <button onClick={handleLocationPermissionClose} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X size={18} />
          </button>
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold tracking-[0.3em] uppercase mb-3">
            <Navigation size={16} /> GPS ACCESS
          </div>
          <h3 className="text-lg font-bold mb-1">Bagikan Posisi Anda</h3>
          <p className="text-sm text-slate-300 mb-4">
            Kami membutuhkan izin lokasi untuk menampilkan penanda segitiga biru yang menunjuk posisi perangkat Anda secara presisi di atas peta ini. Data lokasi hanya dipakai secara lokal dan tidak dikirim ke server.
          </p>
          {locationModalError && <div className="text-xs text-red-400 mb-4">{locationModalError}</div>}
          <div className="flex gap-3 text-sm font-semibold">
            <button onClick={handleLocationPermissionClose} className="flex-1 py-2 rounded-lg border border-slate-700 text-slate-300">
              Nanti Saja
            </button>
            <button
              onClick={handleLocationPermissionConfirm}
              disabled={isLocating}
              className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 ${isLocating ? 'bg-cyan-800/60 cursor-not-allowed text-white/70' : 'bg-cyan-600 hover:bg-cyan-500 text-white'}`}
            >
              {isLocating ? <Activity size={14} className="animate-spin" /> : <Navigation size={14} />}
              {isLocating ? 'Mengambil Lokasi...' : 'Izinkan GPS'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLocationToast = () => {
    if (!locationToast) return null;
    const tone = locationToast.type === 'error'
      ? 'border-red-500/60 text-red-200'
      : locationToast.type === 'success'
      ? 'border-cyan-400/70 text-cyan-100'
      : 'border-slate-600 text-slate-200';
    return (
      <div className={`fixed bottom-5 left-5 z-[600] bg-slate-950/90 px-4 py-2 rounded-2xl text-[11px] font-mono tracking-wide border ${tone} shadow-2xl shadow-black/40`}>
        {locationToast.message}
      </div>
    );
  };

  const renderRouteBuilderPanel = () => {
    if (!isCreatingRoute) return null;
    const pointCount = routeDraftPoints.length;
    const distanceLabel = Number.isFinite(routeDraftDistance) ? `${routeDraftDistance.toFixed(2)} km` : '0 km';
    const durationLabel = Number.isFinite(routeDraftDuration) && routeDraftDuration > 0
      ? formatDurationMinutes(routeDraftDuration)
      : 'Estimasi -';
    const canFinishRoute = routeDraftSegments.length > 0 && pointCount >= 2 && !isRoutingSegment && !isSavingRoute;
    const panelWidthStyle = { width: 'min(22rem, calc(100vw - 2rem))' };
    const anchorClass = isRoutePanelCollapsed ? 'bottom-4 right-4' : 'top-20 right-4';

    if (isRoutePanelCollapsed) {
      return (
        <div className={`fixed ${anchorClass} z-[620]`} style={panelWidthStyle}>
          <button
            onClick={() => setIsRoutePanelCollapsed(false)}
            className="w-full bg-slate-900/85 border border-slate-700 rounded-2xl px-4 py-3 flex items-center justify-between shadow-2xl shadow-black/40 text-left"
          >
            <div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-pink-300">Mode Jalur</p>
              <p className="text-sm font-semibold text-white">{pointCount} titik • {distanceLabel}</p>
              <p className="text-xs text-slate-400 mt-0.5">Estimasi mobil: {durationLabel}</p>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <span
                className="inline-flex h-3 w-6 rounded-full border border-slate-600"
                style={{ backgroundColor: routeDraftColor || '#22d3ee' }}
              />
              <ChevronUp size={18} />
            </div>
          </button>
        </div>
      );
    }

    return (
      <div className={`fixed ${anchorClass} z-[620]`} style={panelWidthStyle}>
        <div className="bg-slate-900/95 border border-slate-700 rounded-2xl shadow-2xl px-5 py-4 backdrop-blur max-h-[calc(100vh-140px)] overflow-y-auto custom-scrollbar">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-cyan-400">Mode Jalur</p>
              <p className="text-base font-semibold text-white">Tetapkan rute akses</p>
            </div>
            <button
              onClick={() => setIsRoutePanelCollapsed(true)}
              className="text-slate-400 hover:text-white transition"
              aria-label="Ciutkan panel jalur"
            >
              <ChevronDown size={18} />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-2">
              <span
                className="inline-flex h-3 w-8 rounded-full border border-slate-600"
                style={{ backgroundColor: routeDraftColor || '#22d3ee' }}
              />
              {pointCount} titik
            </span>
            <span className="font-mono text-[11px] text-cyan-300">{distanceLabel}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Estimasi perjalanan mobil: <span className="text-white font-semibold">{durationLabel}</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            Klik berturut di jalur jalan. Sistem otomatis menarik garis mengikuti akses terdekat.
          </p>
          <div className="mt-3 space-y-2">
            <label className="text-[11px] uppercase font-semibold text-slate-400">Nama Jalur</label>
            <input
              value={routeDraftName}
              onChange={handleRouteNameChange}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="Contoh: Jalur Evakuasi Utama"
            />
          </div>
          {isRoutingSegment && (
            <div className="mt-3 text-xs text-amber-400 flex items-center gap-2">
              <Activity size={14} className="animate-spin" />
              Menghitung jalur jalan...
            </div>
          )}
          {routeDraftError && (
            <div className="mt-3 text-xs text-red-400">
              {routeDraftError}
            </div>
          )}
          <div className="mt-4 flex gap-2 flex-wrap">
            <button
              onClick={cancelRouteCreation}
              className="flex-1 min-w-[120px] py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
              disabled={isSavingRoute}
            >
              Batalkan
            </button>
            <button
              onClick={handleFinishRoute}
              disabled={!canFinishRoute}
              className={`flex-1 min-w-[120px] py-2 rounded-lg text-white font-semibold flex items-center justify-center gap-2 ${canFinishRoute ? 'bg-gradient-to-r from-cyan-500 to-emerald-500 hover:opacity-90' : 'bg-slate-800 text-slate-400 cursor-not-allowed'}`}
            >
              {isSavingRoute ? <Activity size={14} className="animate-spin" /> : <Save size={14} />}
              {isSavingRoute ? 'Menyimpan...' : 'Selesai'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderRouteDeleteModal = () => {
    if (!routeDeleteIntent) return null;
    const routeColor = routeDeleteIntent.color || getRoutePaletteColor(0);
    return (
      <div className="fixed inset-0 z-[710] flex items-center justify-center bg-slate-950/80 backdrop-blur px-4 py-6">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 relative shadow-2xl">
          <button onClick={closeRouteDeleteModal} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X size={18} />
          </button>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full border-2 border-slate-700 flex items-center justify-center">
              <GitBranch size={20} className="text-cyan-400" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.35em] text-pink-300">Hapus Jalur</p>
              <h3 className="text-lg font-semibold text-white">{routeDeleteIntent.name}</h3>
            </div>
          </div>
          <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3 text-sm text-slate-300 mb-4">
            <div className="flex items-center justify-between">
              <span>Warna</span>
              <span className="inline-flex items-center gap-2 font-mono text-xs">
                <span className="h-3 w-8 rounded-full border border-slate-600" style={{ backgroundColor: routeColor }} />
                {routeColor}
              </span>
            </div>
            <div className="flex items-center justify-between mt-2 text-xs">
              <span>Panjang jalur</span>
              <span className="font-mono text-cyan-300">{(routeDeleteIntent.distanceKm ?? 0).toFixed(2)} km</span>
            </div>
            <div className="flex items-center justify-between mt-2 text-xs">
              <span>Estimasi waktu (mobil)</span>
              <span className="font-mono text-emerald-300">{formatDurationMinutes(routeDeleteIntent.durationMinutes)}</span>
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              Jalur ini dibuat {routeDeleteIntent.createdAt ? new Date(routeDeleteIntent.createdAt).toLocaleString('id-ID') : 'sebelumnya'}.
            </div>
          </div>
          <form onSubmit={handleRouteDeleteSubmit} className="space-y-3">
            <div>
              <label className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Password Admin</label>
              <input
                type="password"
                value={routeDeletePassword}
                onChange={(e) => setRouteDeletePassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white mt-1"
                placeholder="Masukkan password untuk menghapus"
                autoFocus
              />
            </div>
            {routeDeleteError && <p className="text-xs text-red-400">{routeDeleteError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={closeRouteDeleteModal} className="flex-1 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800">
                Batal
              </button>
              <button
                type="submit"
                disabled={isDeletingRoute}
                className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center justify-center gap-2 disabled:bg-slate-800"
              >
                {isDeletingRoute ? <Activity size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {isDeletingRoute ? 'Menghapus...' : 'Hapus Jalur'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  const handleSearchResultSelect = (result) => {
    if (!result) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([result.lat, result.lng], 11, { animate: true, duration: 1.3 });
    }
    setSearchPointer({ lat: result.lat, lng: result.lng });
    setActiveRegion(null);
    closeSearchModal();
  };

  const renderSearchModal = () => {
    if (!isSearchModalOpen) return null;
    return (
      <div className="fixed inset-0 z-[640] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm px-4 py-6">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl p-6 relative shadow-2xl">
          <button onClick={closeSearchModal} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X size={18} />
          </button>
          <h3 className="text-lg font-bold text-white mb-1">Cari Lokasi Sumatera</h3>
          <p className="text-xs text-slate-400 mb-4">Masukkan nama provinsi, kab/kota, kecamatan, kelurahan/desa, atau nama jalan. Data dibatasi pada Pulau Sumatera.</p>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Contoh: Jembatan Gunung Nago, Kabupaten Bener Meriah..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white pr-12"
              autoFocus
            />
            <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          </div>
          {isSearchingLocations && <p className="text-xs text-slate-400 mt-3">Mencari lokasi...</p>}
          {searchError && <p className="text-xs text-red-400 mt-3">{searchError}</p>}
          <div className="mt-4 space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-2">
            {searchResults.length === 0 && !isSearchingLocations ? (
              <p className="text-xs text-slate-500 text-center py-6">Tidak ada hasil. Coba kata kunci lain.</p>
            ) : (
              searchResults.map(result => (
                <button
                  key={result.id}
                  onClick={() => handleSearchResultSelect(result)}
                  className="w-full text-left bg-slate-800/60 hover:bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 transition flex flex-col"
                >
                  <span className="text-sm font-semibold text-white">{result.title}</span>
                  {result.subtitle && <span className="text-xs text-slate-400">{result.subtitle}</span>}
                  <span className="text-[10px] text-slate-500 font-mono mt-1">Lat {result.lat.toFixed(4)} · Lng {result.lng.toFixed(4)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderPasswordModal = () => {
    if (!passwordModal.open) return null;
    const contextLabel = passwordModal.context === 'position-edit' ? 'Edit Posisi Titik' : 'Aksi Admin';
    return (
      <div className="fixed inset-0 z-[700] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm px-4 py-6">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-6 relative shadow-2xl">
          <button onClick={closePasswordModal} className="absolute top-4 right-4 text-slate-400 hover:text-white">
            <X size={18} />
          </button>
          <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm mb-1">
            <Lock size={18} /> Verifikasi Password
          </div>
          <p className="text-xs text-slate-400 mb-4">Diperlukan untuk {contextLabel}.</p>
          <form onSubmit={handlePasswordModalSubmit} className="space-y-3">
            <input
              type="password"
              value={passwordInputValue}
              onChange={(e) => setPasswordInputValue(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white"
              placeholder="Masukkan password admin"
              autoFocus
            />
            {passwordModalError && <p className="text-xs text-red-400">{passwordModalError}</p>}
            <button type="submit" className="w-full py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center justify-center gap-2">
              <Lock size={14} /> Konfirmasi
            </button>
          </form>
        </div>
      </div>
    );
  };

  const renderAdminDashboard = () => (
    <div className="w-full h-screen overflow-y-auto bg-slate-950 p-6">
        <div className="max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-cyan-400 flex items-center gap-2">
                        <Lock size={24} /> DATABASE ADMIN
                    </h1>
                </div>
                <button onClick={() => setViewMode('map')} className="px-4 py-2 bg-slate-800 text-slate-200 rounded-lg flex items-center gap-2 border border-slate-700">
                    <Eye size={16} /> View Map
                </button>
            </div>

            {editingId && (
                <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl p-6 relative max-h-[90vh] overflow-y-auto">
                        <button onClick={() => setEditingId(null)} className="absolute top-4 right-4 text-slate-500"><X size={24} /></button>
                        <h2 className="text-xl font-bold text-white mb-6">Edit Data</h2>
                        <p className="text-xs text-slate-400 mb-4">Isi setiap kolom sesuai panduan singkat di bawah agar data tampil akurat di peta.</p>
                        <form onSubmit={handleSaveForm} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2 md:col-span-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Daftar Kota/Kab (Pulau Sumatera)</label>
                                <select value={editFormData.locationPreset || 'custom'} onChange={handleLocationPresetChange} className="bg-slate-800 border-slate-700 rounded p-2 text-white">
                                    <option value="custom">Input manual - isi nama & koordinat sendiri</option>
                                    {locationOptions.map((loc) => (
                                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                                    ))}
                                </select>
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] text-slate-500">Memilih lokasi akan otomatis mengisi nama wilayah serta koordinat latitude dan longitude.</span>
                                    {isFetchingLocations && <span className="text-[10px] text-cyan-400">Mengambil daftar dari API...</span>}
                                    {locationFetchMessage && <span className="text-[10px] text-yellow-400">{locationFetchMessage}</span>}
                                </div>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Nama Wilayah</label>
                                <input required placeholder="Contoh: Kab. Agam" value={editFormData.name} onChange={e => setEditFormData({...editFormData, name: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white" />
                                <span className="text-[10px] text-slate-500">Gunakan nama kabupaten/kota lengkap agar mudah dicari.</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Jenis / Tipe</label>
                                <select
                                    required
                                    value={editTypeSelectValue}
                                    onChange={(e) => {
                                        if (!editFormData) return;
                                        const nextValue = e.target.value;
                                        if (nextValue === TYPE_SELECT_CUSTOM_VALUE) {
                                            setEditFormData((prev) => ({ ...prev, disasterType: '' }));
                                        } else {
                                            setEditFormData((prev) => ({ ...prev, disasterType: nextValue }));
                                        }
                                    }}
                                    className="bg-slate-800 border-slate-700 rounded p-2 text-white"
                                >
                                    {typeOptions.map((option) => (
                                        <option key={option} value={option}>{option}</option>
                                    ))}
                                    <option value={TYPE_SELECT_CUSTOM_VALUE}>Masukkan Manual</option>
                                </select>
                                {showEditCustomTypeInput && (
                                    <input
                                        required
                                        placeholder="Contoh: Banjir Bandang"
                                        value={editFormData?.disasterType || ''}
                                        onChange={(e) => setEditFormData((prev) => ({ ...prev, disasterType: e.target.value }))}
                                        className="bg-slate-900 border-slate-800 rounded p-2 text-white"
                                    />
                                )}
                                <span className="text-[10px] text-slate-500">Gunakan dropdown untuk memilih Dapur Umum atau tipe lain. Pilih &quot;Masukkan Manual&quot; jika ingin mengetik sendiri.</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Latitude</label>
                                <input required placeholder="Contoh: -0.5830" type="number" step="any" value={editFormData.lat} onChange={e => setEditFormData({...editFormData, lat: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white" />
                                <span className="text-[10px] text-slate-500">Koordinat utara-selatan dalam format desimal (gunakan titik).</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Longitude</label>
                                <input required placeholder="Contoh: 100.1660" type="number" step="any" value={editFormData.lng} onChange={e => setEditFormData({...editFormData, lng: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white" />
                                <span className="text-[10px] text-slate-500">Koordinat barat-timur dalam format desimal (gunakan titik).</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Tingkat Keparahan</label>
                                <select value={editFormData.severity} onChange={e => setEditFormData({...editFormData, severity: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white">
                                    <option value="medium">Medium (Waspada)</option>
                                    <option value="high">High (Siaga)</option>
                                    <option value="critical">Critical (Darurat)</option>
                                </select>
                                <span className="text-[10px] text-slate-500">Sesuaikan dengan kondisi di lapangan untuk warna marker.</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Label Status</label>
                                <input placeholder="Contoh: Darurat / Siaga" value={editFormData.status} onChange={e => setEditFormData({...editFormData, status: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white" />
                                <span className="text-[10px] text-slate-500">Teks yang muncul di kartu detail (opsional namun disarankan).</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Dampak/Korban</label>
                                <input placeholder='Contoh: "5 Meninggal, 300 Mengungsi"' value={editFormData.victimsText || ''} onChange={e => setEditFormData({...editFormData, victimsText: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white" />
                                <span className="text-[10px] text-slate-500">Ringkas korban jiwa atau pengungsian untuk ditampilkan di panel.</span>
                            </div>
                            <div className="flex flex-col gap-2 md:col-span-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Deskripsi Singkat</label>
                                <textarea placeholder="Ringkasan situasi terbaru..." rows="3" value={editFormData.description} onChange={e => setEditFormData({...editFormData, description: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white"></textarea>
                                <span className="text-[10px] text-slate-500">Tambahkan informasi lapangan yang relevan (maks. 2-3 kalimat).</span>
                            </div>
                            <div className="flex flex-col gap-2 md:col-span-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase flex items-center gap-2">
                                    Foto Dokumentasi
                                    <span className="text-[10px] text-slate-500">(maks {MAX_PHOTOS_PER_REGION} foto)</span>
                                </label>
                                <input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    onChange={handleEditPhotoInputChange}
                                    className="bg-slate-900 border border-slate-800 rounded p-2 text-white text-sm"
                                />
                                <span className="text-[10px] text-slate-500">Gunakan foto kondisi lapangan terkini untuk memperjelas laporan.</span>
                                {editFormData.photos?.length > 0 && (
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                                        {editFormData.photos.map((photoName, index) => (
                                            <div key={`${photoName}-${index}`} className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-900/60">
                                                <img src={resolvePhotoUrl(photoName)} alt={`Dokumentasi ${index + 1}`} className="w-full h-full object-cover" loading="lazy" />
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveEditExistingPhoto(photoName)}
                                                    className="absolute top-1 right-1 bg-slate-900/80 text-[10px] px-1.5 py-0.5 rounded text-red-300 hover:bg-slate-900"
                                                >
                                                    Hapus
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {editPhotoFiles.length > 0 && (
                                    <ul className="mt-2 text-[11px] text-slate-300 space-y-1">
                                        {editPhotoFiles.map((file, index) => (
                                            <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-2 bg-slate-900/50 border border-slate-800 rounded px-2 py-1">
                                                <span className="truncate">{file.name}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveEditNewPhoto(index)}
                                                    className="text-red-400 hover:text-red-300 text-[10px]"
                                                >
                                                    Batalkan
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Tanggal Update</label>
                                <input placeholder="Contoh: 28-Nov-2025" value={editFormData.lastUpdate || ''} onChange={e => setEditFormData({...editFormData, lastUpdate: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white" />
                                <span className="text-[10px] text-slate-500">Gunakan format tanggal yang konsisten agar mudah dibaca.</span>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Sumber Informasi</label>
                                <input placeholder="Contoh: BMKG / Media" value={editFormData.source || ''} onChange={e => setEditFormData({...editFormData, source: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white" />
                                <span className="text-[10px] text-slate-500">Cantumkan sumber agar data mudah diverifikasi.</span>
                            </div>
                            <div className="col-span-1 md:col-span-2">
                                <button
                                    type="submit"
                                    disabled={isPersistingRegions}
                                    className={`w-full p-3 rounded font-bold text-white flex items-center justify-center gap-2 ${isPersistingRegions ? 'bg-cyan-800 cursor-not-allowed opacity-70' : 'bg-cyan-600 hover:bg-cyan-500'}`}
                                >
                                    {isPersistingRegions ? (
                                        <>
                                            <Activity size={16} className="animate-spin" /> Menyimpan...
                                        </>
                                    ) : (
                                        <>
                                            <Save size={16} /> Simpan Perubahan
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="p-4 flex justify-between bg-slate-900/50">
                    <h3 className="font-bold text-slate-300">Records ({regions.length})</h3>
                    <div className="flex items-center gap-2">
                        <button onClick={handleSyncFromAPI} disabled={isSyncingRegions || isPersistingRegions} className={`px-3 py-1 rounded text-white text-sm flex items-center gap-1 ${(isSyncingRegions || isPersistingRegions) ? 'bg-slate-700 cursor-not-allowed opacity-70' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
                            {isSyncingRegions ? <Activity size={14} className="animate-spin" /> : <Layers size={14} />}
                            {isSyncingRegions ? 'Syncing...' : 'Sync API'}
                        </button>
                        <button onClick={handleAddNew} className="bg-green-600 px-3 py-1 rounded text-white text-sm flex items-center gap-1"><Plus size={14}/> Add</button>
                    </div>
                </div>
                {syncFeedback && <div className="px-4 py-2 text-[12px] text-cyan-300 border-b border-slate-800 bg-slate-900/60">{syncFeedback}</div>}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-slate-400">
                        <thead className="bg-slate-950/50">
                            <tr><th className="px-6 py-3">Region</th><th className="px-6 py-3">Type</th><th className="px-6 py-3">Severity</th><th className="px-6 py-3 text-right">Action</th></tr>
                        </thead>
                        <tbody>
                            {regions.map((region) => (
                                <tr key={region.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                                    <td className="px-6 py-4">{region.name}</td>
                                    <td className="px-6 py-4">{region.disasterType}</td>
                                    <td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-bold ${region.severity === 'critical' ? 'text-red-400 bg-red-900/20' : 'text-yellow-400 bg-yellow-900/20'}`}>{region.severity}</span></td>
                                    <td className="px-6 py-4 text-right">
                                        <button onClick={() => handleEditClick(region)} className="mr-2 text-cyan-400"><Edit3 size={16}/></button>
                                        <button onClick={() => handleDelete(region.id)} className="text-red-400"><Trash2 size={16}/></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
  );

  const renderLogin = () => (
    <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 w-full max-w-md">
            <h2 className="text-2xl font-bold text-white mb-6 text-center">ADMIN ACCESS</h2>
            <form onSubmit={handleLogin} className="space-y-6">
                <input type="password" placeholder="Password" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-center text-white" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} autoFocus />
                {loginError && <div className="text-red-500 text-xs text-center">INVALID PASSWORD</div>}
                <div className="flex gap-3">
                    <button type="button" onClick={() => setViewMode('map')} className="flex-1 py-3 border border-slate-700 text-slate-400 rounded-lg">Back</button>
                    <button type="submit" className="flex-1 py-3 bg-cyan-600 text-white font-bold rounded-lg">Login</button>
                </div>
            </form>
        </div>
    </div>
  );

  if (viewMode === 'admin') return renderAdminDashboard();
  if (viewMode === 'login') return renderLogin();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden relative selection:bg-cyan-500/30">
      <main className="relative z-10 h-screen">
        {renderMapSection()}
        {renderSidebarModal()}
      </main>
      {renderRouteBuilderPanel()}
      {renderRouteDeleteModal()}
      {renderMapAddOverlay()}
      {renderPhotoGalleryModal()}
      {renderLocationPermissionModal()}
      {renderSearchModal()}
      {renderPasswordModal()}
      {renderLocationToast()}
      <style>{` .custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #475569; rounded: 4px; } .leaflet-popup-content-wrapper { background: #0f172a; color: #fff; } `}</style>
    </div>
  );
};

export default App;
