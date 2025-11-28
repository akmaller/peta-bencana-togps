import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, Droplets, Flame, Users, Activity, MapPin, Info, Wind, Search, Newspaper, Layers, Lock, LogOut, Save, Trash2, Plus, Edit3, X, Eye } from 'lucide-react';
import disastersCsv from './data/disasters.csv?raw';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [isLeafletReady, setIsLeafletReady] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));
  const [locationOptions, setLocationOptions] = useState(SUMATRA_LOCATIONS);
  const [isFetchingLocations, setIsFetchingLocations] = useState(false);
  const [locationFetchMessage, setLocationFetchMessage] = useState(null);
  const [isSyncingRegions, setIsSyncingRegions] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);
  
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

  // --- 2. INITIALIZATION & DATA LOADING ---
  useEffect(() => {
    // A. Load Data - Uses v3 key to force update for merged data
    const saved = localStorage.getItem('disaster_data_csv_v3');
    if (saved) {
      setRegions(JSON.parse(saved));
    } else {
      const parsedData = getFallbackRegions();
      setRegions(parsedData);
    }

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

        return () => clearInterval(intervalId);
    }

    return () => {
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

  // --- 3. PERSIST DATA ---
  useEffect(() => {
    if (regions.length > 0) {
        localStorage.setItem('disaster_data_csv_v3', JSON.stringify(regions));
    }
  }, [regions]);

  // --- 4. MAP RENDERING LOGIC ---
  useEffect(() => {
    if (!isLeafletReady || viewMode !== 'map' || !mapContainerRef.current) return;
    if (!window.L || typeof window.L.map !== 'function') return;

    if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
    }

    try {
        const map = window.L.map(mapContainerRef.current, {
            center: [2.0, 98.0], // Centered to show Aceh (Top), Sumut (Mid), Sumbar (Bottom)
            zoom: 6, 
            zoomControl: false,
            attributionControl: false
        });

        window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19, subdomains: 'abcd',
        }).addTo(map);

        mapInstanceRef.current = map;
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

        const severityClass = region.severity === 'critical' ? 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 
                              region.severity === 'high' ? 'bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.6)]' : 
                              'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]';
        const pulseClass = region.severity === 'critical' || region.severity === 'high' ? 'animate-ping' : '';
        
        const customIcon = window.L.divIcon({
            className: 'custom-div-icon',
            html: `
                <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
                    <div class="${pulseClass} absolute inset-0 rounded-full ${severityClass} opacity-75"></div>
                    <div class="relative w-3 h-3 rounded-full ${severityClass} border-2 border-slate-900"></div>
                </div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        const marker = window.L.marker([region.lat, region.lng], { icon: customIcon }).addTo(map);
        marker.on('click', () => {
            setActiveRegion(region);
            map.flyTo([region.lat, region.lng], 9, { animate: true, duration: 1.5 });
        });
        markersRef.current[region.id] = marker;
    });
  };

  useEffect(() => {
    if (mapInstanceRef.current && isLeafletReady && window.L) {
        Object.values(markersRef.current).forEach(m => m.remove());
        addMarkersToMap(mapInstanceRef.current);
    }
  }, [regions]);

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
    setSyncFeedback('Mengambil data wilayah Sumatera dari API...');
    try {
      const apiLocations = locationOptions.length ? locationOptions : await fetchSumatraLocationOptions();
      if (!apiLocations.length) throw new Error('API tidak mengembalikan data.');
      const existingIds = new Set(regions.map((region) => region.id));
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
        setRegions((prev) => [...prev, ...newEntries]);
        setSyncFeedback(`${newEntries.length} wilayah baru ditambahkan dari API.`);
      } else {
        setSyncFeedback('Tidak ada wilayah baru dari API.');
      }
    } catch (error) {
      console.error('API sync failed:', error);
      setSyncFeedback('Sinkronisasi gagal. Periksa koneksi API.');
    } finally {
      setIsSyncingRegions(false);
      setTimeout(() => setSyncFeedback(null), 6000);
    }
  };

  const handleDelete = (id) => {
    if (window.confirm('Hapus data ini?')) {
        setRegions(prev => prev.filter(r => r.id !== id));
    }
  };

  const handleSaveForm = (e) => {
    e.preventDefault();
    const { locationPreset, ...dataWithoutPreset } = editFormData;
    const formData = {
        ...dataWithoutPreset,
        lat: parseFloat(dataWithoutPreset.lat),
        lng: parseFloat(dataWithoutPreset.lng)
    };
    if (editingId === 'NEW') {
        setRegions(prev => [...prev, formData]);
    } else {
        setRegions(prev => prev.map(r => r.id === editingId ? formData : r));
    }
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

  const filteredRegions = useMemo(() => {
    return regions.filter(r => 
      (r.name && r.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (r.disasterType && r.disasterType.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [searchTerm, regions]);

  // --- RENDERERS ---

  const renderMapSection = (variant = 'desktop') => {
    const mobileVariant = variant === 'mobile';
    return (
      <div className={`${mobileVariant ? 'relative w-full h-full bg-slate-900 overflow-hidden' : 'flex-[2] relative bg-slate-900 border border-slate-800 rounded-xl overflow-hidden'}`}>
        <div
          id="map-container"
          ref={mapContainerRef}
          className={`${mobileVariant ? 'relative w-full h-full min-h-[calc(100vh-40px)]' : 'relative w-full h-full'} bg-slate-900 z-0`}
        >
          {!isLeafletReady && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-500 animate-pulse">
              Initializing Map System...
            </div>
          )}
        </div>
        <div className={`absolute ${mobileVariant ? 'top-3 left-3' : 'bottom-4 left-4'} z-[400] text-[10px] font-mono text-cyan-500/80 bg-slate-950/80 px-3 py-1.5 rounded-full border border-slate-800/70`}>
          LAT: {activeRegion?.lat?.toFixed(4) || '-'} | LNG: {activeRegion?.lng?.toFixed(4) || '-'}
        </div>
        {mobileVariant && (
          <div className="absolute top-3 right-3 z-[450] flex gap-2">
            <button
              onClick={() => setViewMode('login')}
              className="p-2 rounded-full bg-slate-900/80 border border-slate-700 text-slate-200 hover:text-cyan-300 transition"
              aria-label="Admin Login"
            >
              <Lock size={16} />
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderMobileSnackbar = () => {
    if (!isMobile || !activeRegion) return null;
    return (
      <div className="absolute bottom-4 left-4 right-4 z-[500] pointer-events-auto">
        <div className="bg-slate-950/95 border border-slate-800 rounded-2xl p-4 shadow-2xl ring-1 ring-cyan-500/20">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-white">{activeRegion.name}</p>
              <span className={`mt-1 inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${getSeverityColor(activeRegion.severity)}`}>{activeRegion.status}</span>
            </div>
            <button onClick={() => setActiveRegion(null)} className="text-slate-400 hover:text-white transition p-1" aria-label="Tutup detail">
              <X size={14} />
            </button>
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-300">
            <p className="font-semibold text-slate-100">{activeRegion.disasterType}</p>
            <p className="font-mono text-cyan-400 text-[11px]">{activeRegion.victimsText}</p>
            <p className="text-slate-400 text-[11px] italic">"{activeRegion.description}"</p>
          </div>
          <div className="mt-3 text-[10px] text-slate-500 flex justify-between gap-2">
            <span>Lat {activeRegion.lat?.toFixed(2)} / Lng {activeRegion.lng?.toFixed(2)}</span>
            <span>Update {activeRegion.lastUpdate}</span>
          </div>
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
                                <button type="submit" className="w-full bg-cyan-600 p-3 rounded font-bold text-white flex items-center justify-center gap-2">
                                    <Save size={16} /> Simpan Perubahan
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
                        <button onClick={handleSyncFromAPI} disabled={isSyncingRegions} className={`px-3 py-1 rounded text-white text-sm flex items-center gap-1 ${isSyncingRegions ? 'bg-slate-700 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
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
      <header className="absolute top-0 left-0 w-full p-4 z-50 hidden md:flex justify-between items-center backdrop-blur-md bg-slate-900/80 border-b border-slate-800">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-wider text-cyan-400 flex items-center gap-2"><Activity className="animate-pulse" /> SUMATERA MONITOR</h1>
        </div>
        <div className="flex items-center gap-4 mt-2 md:mt-0">
            <div className="relative">
                <input type="text" placeholder="Search..." className="bg-slate-800 border border-slate-700 rounded-full px-4 py-2 pl-10 text-xs w-48 md:w-64" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                <Search className="absolute left-3 top-2.5 text-slate-500" size={14} />
            </div>
            <button onClick={() => setViewMode('login')} className="p-2 text-slate-500 hover:text-cyan-400 border-l border-slate-700 pl-4"><Lock size={16} /></button>
        </div>
      </header>

      <main
        className={isMobile ? 'relative z-10 px-0 pb-0' : 'flex flex-col md:flex-row h-screen pt-24 pb-4 px-4 gap-4 relative z-10'}
        style={isMobile ? { minHeight: 'calc(100vh - 40px)' } : undefined}
      >
        {isMobile ? (
          <div className="relative h-full w-full">
            {renderMapSection('mobile')}
            {renderMobileSnackbar()}
          </div>
        ) : (
          <>
            {renderMapSection('desktop')}
            <div className="flex-1 min-w-[320px] max-w-md flex flex-col gap-3 pointer-events-auto">
                <div className={`flex-1 bg-slate-900/90 backdrop-blur-xl border border-slate-700 rounded-xl p-5 relative overflow-hidden flex flex-col ${activeRegion ? 'ring-1 ring-cyan-500/30' : ''}`}>
                    {!activeRegion ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center"><MapPin size={48} className="mb-4 opacity-50"/>SELECT REGION</div>
                    ) : (
                        <>
                             <div className={`absolute -top-20 -right-20 w-64 h-64 blur-[60px] opacity-20 pointer-events-none rounded-full ${getSeverityBg(activeRegion.severity)}`}></div>
                             <div className="relative z-10">
                                <h2 className="text-xl font-bold text-white mb-2">{activeRegion.name}</h2>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getSeverityColor(activeRegion.severity)}`}>{activeRegion.status}</span>
                                <div className="mt-4 space-y-3">
                                    <div className="bg-slate-950/50 p-3 rounded border border-slate-800"><p className="text-[10px] text-slate-400">TYPE</p><p className="font-semibold">{activeRegion.disasterType}</p></div>
                                    <div className="bg-slate-950/50 p-3 rounded border border-slate-800"><p className="text-[10px] text-slate-400">IMPACT</p><p className="font-mono">{activeRegion.victimsText}</p></div>
                                    <div className="bg-slate-800/30 p-3 rounded border border-slate-800"><p className="text-[10px] text-cyan-500/70 mb-1">REPORT</p><p className="text-sm text-slate-300">"{activeRegion.description}"</p></div>
                                </div>
                             </div>
                        </>
                    )}
                </div>

                <div className="h-1/3 bg-slate-900/90 border border-slate-800 rounded-xl p-4 overflow-hidden flex flex-col">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase mb-3">Live Feed</h3>
                    <div className="overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                        {filteredRegions.map((r, idx) => (
                            <div key={idx} onClick={() => { setActiveRegion(r); if(mapInstanceRef.current) mapInstanceRef.current.flyTo([r.lat, r.lng], 9); }} className={`flex items-center justify-between p-3 rounded cursor-pointer hover:bg-slate-800 ${activeRegion?.id === r.id ? 'bg-slate-800 border border-cyan-900' : 'bg-slate-950/30'}`}>
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${r.severity === 'critical' ? 'bg-red-500' : r.severity === 'high' ? 'bg-orange-500' : 'bg-yellow-400'}`}></div>
                                    <div><p className="text-xs font-semibold text-slate-200">{r.name}</p><p className="text-[10px] text-slate-500">{r.disasterType}</p></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
          </>
        )}
      </main>
      <footer className="w-full text-center text-[10px] text-slate-500 py-2 border-t border-slate-900 bg-slate-950/80">
        Created By TOGPS - Kodekita08
      </footer>
      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-thumb { background: #475569; rounded: 4px; } .leaflet-popup-content-wrapper { background: #0f172a; color: #fff; }`}</style>
    </div>
  );
};

export default App;
