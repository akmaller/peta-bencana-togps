import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AlertTriangle, Droplets, Flame, Users, Activity, MapPin, Info, Wind, Search, Newspaper, Layers, Lock, LogOut, Save, Trash2, Plus, Edit3, X, Eye } from 'lucide-react';
import disastersCsv from './data/disasters.csv?raw';

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');
const DISASTERS_API_URL = `${API_BASE_URL}/api/disasters`;
const SERVER_SYNC_INTERVAL = 30000; // 30s
const SUMATRA_PROVINCE_IDS = ['11', '12', '13', '14', '15', '16', '17', '18', '19', '21'];
const PROVINCE_API_URL = 'https://ibnux.github.io/data-indonesia/provinsi.json';
const REGENCY_API_URL = (provinceId) => `https://ibnux.github.io/data-indonesia/kabupaten/${provinceId}.json`;

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

const parseCSV = (csvText) => {
  const lines = csvText.trim().split('\n');
  return lines.slice(1).map(line => {
    const values = [];
    let currentVal = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(currentVal);
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    values.push(currentVal);

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
      source: values[10]
    };
  });
};

const getFallbackRegions = () => parseCSV(disastersCsv);

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
  const [viewMode, setViewMode] = useState('map'); // 'map', 'login', 'admin'
  const [activeRegion, setActiveRegion] = useState(null);
  const [isLeafletReady, setIsLeafletReady] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  const [locationOptions, setLocationOptions] = useState(SUMATRA_LOCATIONS);
  const [isFetchingLocations, setIsFetchingLocations] = useState(false);
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
  const [passwordModal, setPasswordModal] = useState({ open: false, context: null });
  const [passwordInputValue, setPasswordInputValue] = useState('');
  const [passwordModalError, setPasswordModalError] = useState(null);
  
  // Auth State
  const [passwordInput, setPasswordInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  
  // Admin Editing State
  const [editingId, setEditingId] = useState(null); 
  const [editFormData, setEditFormData] = useState({});

  // Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const feedbackTimerRef = useRef(null);
  const regionsRef = useRef(regions);
  const searchDebounceRef = useRef(null);
  const searchAbortRef = useRef(null);
  const sidebarDragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });

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
         mapInstanceRef.current.remove();
         mapInstanceRef.current = null;
       }
    }
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
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
    }

    try {
        const map = window.L.map(mapContainerRef.current, {
            center: [2.0, 98.0], // Centered to show Aceh (Top), Sumut (Mid), Sumbar (Bottom)
            zoom: 6, 
            zoomControl: false,
            attributionControl: true
        });

        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
        }).addTo(map);
        const handleContextMenu = (event) => {
            event.originalEvent?.preventDefault();
            openMapFormAt(event.latlng.lat, event.latlng.lng);
        };
        map.on('contextmenu', handleContextMenu);

        mapInstanceRef.current = map;
        mapInstanceRef.current.__contextHandler = handleContextMenu;
        addMarkersToMap(map);
        
    } catch (err) {
        console.error("Map Init Error:", err);
    }

  }, [isLeafletReady, viewMode]);

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
          : `
            <div style="position: relative; width: ${size(24)}px; height: ${size(24)}px; display: flex; align-items: center; justify-content: center;">
              <div class="${pulseClass} absolute inset-0 rounded-full ${severityClass} opacity-75"></div>
              <div style="width: ${size(12)}px; height: ${size(12)}px;" class="relative rounded-full ${severityClass} border-2 border-slate-900"></div>
            </div>
          `;

        const customIcon = window.L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: isAccessAir ? [size(36), size(36)] : isAccessCut ? [size(24), size(24)] : isAccessSafe ? [size(20), size(20)] : [size(24), size(24)],
            iconAnchor: isAccessAir ? [size(18), size(18)] : isAccessCut ? [size(12), size(12)] : isAccessSafe ? [size(10), size(10)] : [size(12), size(12)]
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
    setEditFormData({ ...region, locationPreset: getPresetForRegion(region) });
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
        locationPreset: 'custom'
    });
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
          source: 'API Ibnux (auto-sync)'
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
        lng: parseFloat(dataWithoutPreset.lng)
    };
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

  const showFeedback = (message, duration = 6000) => {
    setSyncFeedback(message);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    if (message) {
      feedbackTimerRef.current = setTimeout(() => setSyncFeedback(null), duration);
    }
  };

  const resetMapFormState = () => {
    setMapFormData({ type: 'Akses Putus', name: '', description: '', victims: '', status: '', severity: 'medium' });
    setMapFormPassword('');
    setMapFormAuthorized(false);
    setMapFormError(null);
    setIsSubmittingMapForm(false);
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

  const openPasswordModal = (context) => {
    setPasswordModal({ open: true, context });
    setPasswordInputValue('');
    setPasswordModalError(null);
  };

  const closePasswordModal = () => {
    setPasswordModal({ open: false, context: null });
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

  const persistRegions = async (nextRegions, { successMessage } = {}) => {
    setRegions(nextRegions);
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
        body: JSON.stringify({ records: nextRegions }),
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
      source: 'Map Context Form'
    };
    const nextRegions = isEditing
      ? regionsRef.current.map(region => region.id === entryId ? newEntry : region)
      : [...regionsRef.current, newEntry];
    const success = await persistRegions(nextRegions, { successMessage: isEditing ? 'Titik berhasil diperbarui.' : 'Titik baru berhasil ditambahkan.' });
    setIsSubmittingMapForm(false);
  if (success) {
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
      <div id="map-container" ref={mapContainerRef} className="absolute inset-0 bg-slate-900">
        {!isLeafletReady && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 animate-pulse">
            Initializing Map System...
          </div>
        )}
      </div>
      <div className="absolute top-3 left-3 z-[400] text-[10px] font-mono text-cyan-500/80 bg-slate-950/80 px-3 py-1.5 rounded-full border border-slate-800/70">
        LAT: {activeRegion?.lat?.toFixed(4) || '-'} | LNG: {activeRegion?.lng?.toFixed(4) || '-'}
      </div>
      <div className="absolute top-3 right-3 z-[450] flex gap-2">
        <button
          onClick={openSearchModal}
          className="p-2 rounded-full bg-slate-900/80 border border-slate-700 text-slate-200 hover:text-cyan-300 transition"
          aria-label="Cari Lokasi"
        >
          <Search size={16} />
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
          </div>
        </div>
      </div>
    );
  };

  const renderMobileSnackbar = () => null;

  const renderMapAddOverlay = () => {
    if (!mapAddForm.open) return null;
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
                <select value={mapFormData.type} onChange={(e) => setMapFormData({ ...mapFormData, type: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white">
                  <option value="Banjir">Banjir</option>
                  <option value="Longsor">Longsor</option>
                  <option value="Akses Putus">Akses Putus</option>
                  <option value="Akses Aman">Akses Aman</option>
                </select>
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
                                <label className="text-[11px] font-semibold text-slate-400 tracking-wide uppercase">Jenis Bencana</label>
                                <input required placeholder="Contoh: Banjir Bandang" value={editFormData.disasterType} onChange={e => setEditFormData({...editFormData, disasterType: e.target.value})} className="bg-slate-800 border-slate-700 rounded p-2 text-white" />
                                <span className="text-[10px] text-slate-500">Tuliskan jenis bencana utama (banjir, longsor, angin kencang, dll).</span>
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
      {renderMapAddOverlay()}
      {renderSearchModal()}
      {renderPasswordModal()}
      <style>{` .custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #475569; rounded: 4px; } .leaflet-popup-content-wrapper { background: #0f172a; color: #fff; } `}</style>
    </div>
  );
};

export default App;
