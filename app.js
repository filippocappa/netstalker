mapboxgl.accessToken = CONFIG.MAPBOX_TOKEN;

let currentStyle = localStorage.getItem('netstalker-theme') || 'dark';
const mapStyle = currentStyle === 'light'
    ? 'mapbox://styles/mapbox/light-v11'
    : 'mapbox://styles/mapbox/dark-v11';

if (currentStyle === 'light') document.body.classList.add('light-theme');

const map = new mapboxgl.Map({
    container: "map",
    style: mapStyle,
    center: [7.8927, 45.4743],
    zoom: 14,
    dragPan: { cursor: 'default' }
});

map.addControl(new mapboxgl.NavigationControl(), 'bottom-left');

let allFeatures = [];
let sessions = [];
let currentMode = localStorage.getItem('netstalker-viewmode') || 'density';
let activeVendorFilter = null;

map.on('load', async () => {
    try {
        const response = await fetch('data/wardrive.geojson');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: Could not load wardrive.geojson`);
        }

        const data = await response.json();

        if (!data.features || data.features.length === 0) {
            console.warn("⚠️ No features found");
            alert("No wardriving data found. Run the Python script first!");
            return;
        }

        // Separate APs and routes
        allFeatures = data.features.filter(f => f.properties.layer === 'access_points');
        const routeFeatures = data.features.filter(f => f.properties.layer === 'route');

        // Load session metadata
        if (data.metadata && data.metadata.sessions) {
            sessions = data.metadata.sessions;
            populateSessionDropdown(sessions);
        }

        console.log(`✅ Loaded ${allFeatures.length} APs and ${routeFeatures.length} route(s)`);

        // Auto-center on data
        autoCenterMap(data);

        // Add sources
        map.addSource('wardrive', {
            type: 'geojson',
            data: { type: "FeatureCollection", features: allFeatures }
        });

        map.addSource('routes', {
            type: 'geojson',
            data: { type: "FeatureCollection", features: routeFeatures }
        });

        initLayers();
        setViewMode(currentMode);
        if (!routeVisible) {
            map.setLayoutProperty('route-line', 'visibility', 'none');
            map.setLayoutProperty('route-glow', 'visibility', 'none');
        }
        initInteractions();
        buildVendorChips();
        updateMapFilters();

    } catch (err) {
        console.error("❌ Error loading data:", err);
        alert(`Failed to load data: ${err.message}`);
    }
});

function autoCenterMap(data) {
    if (!data.features || data.features.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    data.features.forEach(feature => {
        if (feature.geometry.type === 'Point') {
            bounds.extend(feature.geometry.coordinates);
        } else if (feature.geometry.type === 'LineString') {
            feature.geometry.coordinates.forEach(coord => bounds.extend(coord));
        }
    });

    map.fitBounds(bounds, { padding: 50, maxZoom: 15 });
}

// ============================================================
// LAYER INITIALIZATION
// ============================================================
function initLayers() {
    // ROUTE GLOW (below route line)
    map.addLayer({
        id: "route-glow",
        type: "line",
        source: "routes",
        paint: {
            "line-color": "#8b5cf6",
            "line-width": 8,
            "line-opacity": 0.2,
            "line-blur": 4
        }
    });

    // ROUTE LINE
    map.addLayer({
        id: "route-line",
        type: "line",
        source: "routes",
        paint: {
            "line-color": "#8b5cf6",
            "line-width": 3,
            "line-opacity": 0.7
        }
    });

    // DENSITY HEATMAP (the only heatmap now)
    map.addLayer({
        id: "heatmap-density",
        type: "heatmap",
        source: "wardrive",
        maxzoom: 16,
        layout: { visibility: 'visible' },
        paint: {
            "heatmap-weight": 0.15,
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.5, 15, 1.0],
            "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(0,0,0,0)",
                0.2, "rgba(0, 0, 255, 0.5)",
                0.4, "rgb(0, 255, 255)",
                0.6, "rgb(0, 255, 0)",
                0.8, "rgb(255, 255, 0)",
                0.98, "rgb(255, 0, 0)"
            ],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 2, 15, 20],
            "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.8, 15, 0]
        }
    });

    // OPEN NETWORKS GLOW (pulsing effect via larger faded circle)
    map.addLayer({
        id: "points-open-glow",
        type: "circle",
        source: "wardrive",
        layout: { visibility: 'none' },
        filter: ["any",
            ["==", ["get", "AuthMode"], "OPEN"],
            ["==", ["get", "AuthMode"], ""]
        ],
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 6, 15, 14, 18, 20],
            "circle-color": "#ef4444",
            "circle-opacity": 0.25,
            "circle-stroke-width": 0
        }
    });

    // OPEN NETWORKS CORE
    map.addLayer({
        id: "points-open",
        type: "circle",
        source: "wardrive",
        layout: { visibility: 'none' },
        filter: ["any",
            ["==", ["get", "AuthMode"], "OPEN"],
            ["==", ["get", "AuthMode"], ""]
        ],
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 6, 18, 9],
            "circle-color": "#ef4444",
            "circle-opacity": 0.9,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#fca5a5"
        }
    });

    // SECURITY COLORED POINTS (green=WPA3, yellow=WPA2, red=Open)
    map.addLayer({
        id: "points-security",
        type: "circle",
        source: "wardrive",
        layout: { visibility: 'none' },
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 15, 5, 18, 8],
            "circle-color": [
                "match", ["get", "AuthMode"],
                "WPA3_PSK", "#4ade80",
                "WPA2_WPA3_PSK", "#4ade80",
                "WPA2_PSK", "#fbbf24",
                "WPA_WPA2_PSK", "#fbbf24",
                "WPA2_ENTERPRISE", "#fbbf24",
                "WPA_PSK", "#fb923c",
                "WEP", "#f87171",
                "OPEN", "#ef4444",
                "", "#ef4444",
                "#94a3b8"
            ],
            "circle-opacity": 0.85,
            "circle-stroke-width": 0.5,
            "circle-stroke-color": "rgba(255,255,255,0.3)"
        }
    });

    // SIGNAL STRENGTH COLORED POINTS (purple=weak → cyan → white=strong)
    map.addLayer({
        id: "points-signal",
        type: "circle",
        source: "wardrive",
        layout: { visibility: 'none' },
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 15, 5, 18, 8],
            "circle-color": [
                "interpolate", ["linear"], ["get", "best_rssi"],
                -100, "#581c87",
                -85, "#7c3aed",
                -75, "#38bdf8",
                -65, "#67e8f9",
                -55, "#ecfeff"
            ],
            "circle-opacity": 0.85,
            "circle-stroke-width": 0.5,
            "circle-stroke-color": "rgba(255,255,255,0.2)"
        }
    });

    // DEFAULT POINT LAYERS (for density/none mode when zoomed in)
    map.addLayer({
        id: "points-default",
        type: "circle",
        source: "wardrive",
        minzoom: 13,
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 1.5, 18, 4],
            "circle-color": "#a855f7",
            "circle-opacity": 0.9,
            "circle-stroke-width": 0.5,
            "circle-stroke-color": "#ffffff"
        }
    });
}

// ============================================================
// VIEW MODE SWITCHER
// ============================================================
function setViewMode(mode) {
    currentMode = mode;
    localStorage.setItem('netstalker-viewmode', mode);

    // Hide everything first
    map.setLayoutProperty('heatmap-density', 'visibility', 'none');
    map.setLayoutProperty('points-security', 'visibility', 'none');
    map.setLayoutProperty('points-signal', 'visibility', 'none');
    map.setLayoutProperty('points-default', 'visibility', 'none');

    switch (mode) {
        case 'density':
            map.setLayoutProperty('heatmap-density', 'visibility', 'visible');
            map.setLayoutProperty('points-default', 'visibility', 'visible');
            break;
        case 'security':
            map.setLayoutProperty('points-security', 'visibility', 'visible');
            break;
        case 'signal':
            map.setLayoutProperty('points-signal', 'visibility', 'visible');
            break;
        case 'none':
            map.setLayoutProperty('points-default', 'visibility', 'visible');
            break;
    }

    // Update button styles
    document.querySelectorAll('.heatmap-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');
}

// ============================================================
// OPEN NETWORKS HIGHLIGHT
// ============================================================
let openHighlight = false;

function toggleOpenNetworks() {
    openHighlight = !openHighlight;
    const vis = openHighlight ? 'visible' : 'none';
    map.setLayoutProperty('points-open', 'visibility', vis);
    map.setLayoutProperty('points-open-glow', 'visibility', vis);

    const btn = document.getElementById('toggle-open');
    if (btn) {
        btn.classList.toggle('active', openHighlight);
    }
}

// ============================================================
// VENDOR FILTER CHIPS
// ============================================================
function buildVendorChips() {
    const container = document.getElementById('vendor-chips');
    if (!container) return;

    // Count vendors
    const counts = {};
    allFeatures.forEach(f => {
        const v = f.properties.Vendor || 'Unknown';
        counts[v] = (counts[v] || 0) + 1;
    });

    // Top 5 vendors (skip Randomized/Unknown)
    const top = Object.entries(counts)
        .filter(([name]) => name !== 'Randomized' && name !== 'Unknown')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    top.forEach(([name, count]) => {
        const chip = document.createElement('button');
        chip.className = 'vendor-chip';
        // Shorten long names
        const short = name.length > 16 ? name.slice(0, 14) + '…' : name;
        chip.textContent = `${short} (${count})`;
        chip.title = name;
        chip.addEventListener('click', () => {
            if (activeVendorFilter === name) {
                activeVendorFilter = null;
                chip.classList.remove('active');
            } else {
                activeVendorFilter = name;
                container.querySelectorAll('.vendor-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
            }
            updateMapFilters();
        });
        container.appendChild(chip);
    });
}

// ============================================================
// SESSION FILTERING
// ============================================================
function populateSessionDropdown(sessions) {
    const optionsContainer = document.getElementById('session-options');
    const trigger = document.getElementById('session-trigger');
    const selectEl = document.getElementById('session-select');
    const hiddenInput = document.getElementById('session-filter');
    const label = document.getElementById('session-label');
    if (!optionsContainer || !trigger || !selectEl) return;

    optionsContainer.innerHTML = '<div class="custom-select-option selected" data-value="all">All Sessions</div>';

    sessions.sort((a, b) => b.date.localeCompare(a.date));

    sessions.forEach(s => {
        const opt = document.createElement('div');
        opt.className = 'custom-select-option';
        opt.dataset.value = s.name;
        opt.textContent = `${s.date} (${s.ap_count} APs)`;
        optionsContainer.appendChild(opt);
    });

    // Toggle open/close
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        selectEl.classList.toggle('open');
    });

    // Option selection
    optionsContainer.addEventListener('click', (e) => {
        const option = e.target.closest('.custom-select-option');
        if (!option) return;

        optionsContainer.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');

        label.textContent = option.textContent;
        hiddenInput.value = option.dataset.value;
        selectEl.classList.remove('open');
        updateMapFilters();
    });

    // Close on outside click
    document.addEventListener('click', () => {
        selectEl.classList.remove('open');
    });
}

// ============================================================
// INTERACTIONS
// ============================================================
function initInteractions() {
    const clickLayers = ['points-default', 'points-security', 'points-signal', 'points-open'];

    map.on('mouseenter', clickLayers, () => map.getCanvas().style.cursor = 'pointer');
    map.on('mouseleave', clickLayers, () => map.getCanvas().style.cursor = '');

    map.on('click', clickLayers, (e) => {
        const p = e.features[0].properties;

        let secColor = '#10b981';
        if (p.AuthMode.includes('OPEN') || p.AuthMode === '') secColor = '#ef4444';
        else if (p.AuthMode.includes('WPA3')) secColor = '#10b981';
        else if (p.AuthMode.includes('WPA2')) secColor = '#f59e0b';
        else secColor = '#94a3b8';

        new mapboxgl.Popup({ closeButton: false, maxWidth: '300px', className: 'tactical-popup' })
            .setLngLat(e.features[0].geometry.coordinates)
            .setHTML(`
                <div style="font-family: monospace; line-height: 1.5; color: #eee; font-size: 12px;">
                    <div style="font-size: 14px; font-weight: bold; color: #fff; margin-bottom: 2px;">
                        ${p.SSID}
                    </div>
                    <div style="color: #aaa; margin-bottom: 8px; font-size: 10px;">${p.MAC}</div>
                    <div style="border-top: 1px solid #444; margin: 4px 0; padding-top: 4px;"></div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:#888;">Vendor:</span>
                        <span>${p.Vendor || 'Unknown'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:#888;">Signal:</span>
                        <span style="color:#8b5cf6;">${p.best_rssi} dBm</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:#888;">Channel:</span>
                        <span style="color:#3b82f6;">${p.Channel || 'N/A'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:#888;">Security:</span>
                        <span style="color:${secColor};">${p.AuthMode || 'Open'}</span>
                    </div>
                    <div style="border-top: 1px solid #333; margin: 8px 0 4px 0; padding-top: 4px;"></div>
                    <div style="display:flex; justify-content:space-between; font-size: 10px;">
                        <span style="color:#666;">First Seen:</span>
                        <span style="color:#888;">${p.first_seen || 'Unknown'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size: 10px;">
                        <span style="color:#666;">Last Seen:</span>
                        <span style="color:#888;">${p.last_seen || 'Unknown'}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top: 4px; font-size: 10px;">
                        <span style="color:#666;">Encounters:</span>
                        <span style="color:#8b5cf6; font-weight: bold;">${p.count}x</span>
                    </div>
                </div>
            `)
            .addTo(map);
    });
}

// ============================================================
// FILTERING
// ============================================================
function updateMapFilters() {
    if (!map.getSource('wardrive')) return;

    const searchText = document.getElementById('global-search').value.toLowerCase();
    const selectedSession = document.getElementById('session-filter')?.value || 'all';

    const rssiEl = document.getElementById('rssi-slider');
    const rssiVal = rssiEl ? parseInt(rssiEl.value) : -100;
    if (document.getElementById('rssi-disp')) {
        document.getElementById('rssi-disp').innerText = rssiVal + " dBm";
    }

    const filtered = allFeatures.filter(f => {
        const p = f.properties;
        const signal = p.best_rssi || -100;

        if (signal < rssiVal) return false;

        // Session filter
        if (selectedSession !== 'all') {
            const apSessions = (p.sessions || '').split(',');
            if (!apSessions.includes(selectedSession)) return false;
        }

        // Vendor filter
        if (activeVendorFilter && p.Vendor !== activeVendorFilter) return false;

        if (searchText) {
            return p.SSID.toLowerCase().includes(searchText) ||
                   p.MAC.toLowerCase().includes(searchText) ||
                   (p.Vendor && p.Vendor.toLowerCase().includes(searchText));
        }

        return true;
    });

    map.getSource('wardrive').setData({
        type: "FeatureCollection",
        features: filtered
    });

    const statsEl = document.getElementById('stats-val');
    if (statsEl) statsEl.textContent = filtered.length;
}

// ============================================================
// ROUTE VISIBILITY TOGGLE
// ============================================================
let routeVisible = localStorage.getItem('netstalker-route') !== 'false';

function toggleRoute() {
    routeVisible = !routeVisible;
    localStorage.setItem('netstalker-route', routeVisible);
    const newVis = routeVisible ? 'visible' : 'none';

    map.setLayoutProperty('route-line', 'visibility', newVis);
    map.setLayoutProperty('route-glow', 'visibility', newVis);

    const btn = document.getElementById('toggle-route');
    if (btn) {
        btn.classList.toggle('active', routeVisible);
        btn.textContent = routeVisible ? '🗺️ Route: ON' : '🗺️ Route: OFF';
    }
}

// ============================================================
// THEME SWITCHER
// ============================================================
function toggleTheme() {
    const btn = document.getElementById('toggle-theme');
    if (currentStyle === 'dark') {
        currentStyle = 'light';
        map.setStyle('mapbox://styles/mapbox/light-v11');
        document.body.classList.add('light-theme');
        if (btn) btn.textContent = '🌙 Dark';
    } else {
        currentStyle = 'dark';
        map.setStyle('mapbox://styles/mapbox/dark-v11');
        document.body.classList.remove('light-theme');
        if (btn) btn.textContent = '☀️ Light';
    }
    localStorage.setItem('netstalker-theme', currentStyle);

    // Re-add layers after style change
    map.once('style.load', () => {
        // Re-add sources
        map.addSource('wardrive', {
            type: 'geojson',
            data: { type: "FeatureCollection", features: allFeatures }
        });

        const routeFeatures = [];
        // Reconstruct route source from original data
        map.addSource('routes', {
            type: 'geojson',
            data: { type: "FeatureCollection", features: routeFeatures }
        });

        // Fetch routes again
        fetch('data/wardrive.geojson').then(r => r.json()).then(data => {
            const rf = data.features.filter(f => f.properties.layer === 'route');
            map.getSource('routes').setData({ type: "FeatureCollection", features: rf });
        });

        initLayers();
        setViewMode(currentMode);
        if (openHighlight) {
            map.setLayoutProperty('points-open', 'visibility', 'visible');
            map.setLayoutProperty('points-open-glow', 'visibility', 'visible');
        }
        if (!routeVisible) {
            map.setLayoutProperty('route-line', 'visibility', 'none');
            map.setLayoutProperty('route-glow', 'visibility', 'none');
        }
        updateMapFilters();
    });
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Restore button states from localStorage
    const themeBtn = document.getElementById('toggle-theme');
    if (themeBtn) {
        themeBtn.textContent = currentStyle === 'light' ? '🌙 Dark' : '☀️ Light';
    }

    const routeBtn2 = document.getElementById('toggle-route');
    if (routeBtn2) {
        routeBtn2.classList.toggle('active', routeVisible);
        routeBtn2.textContent = routeVisible ? '🗺️ Route: ON' : '🗺️ Route: OFF';
    }

    // Filter inputs
    const inputs = ['global-search', 'rssi-slider'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const eventType = (id === 'rssi-slider' || id === 'global-search') ? 'input' : 'change';
            el.addEventListener(eventType, updateMapFilters);
        }
    });

    // View mode buttons
    document.querySelectorAll('.heatmap-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setViewMode(btn.dataset.mode);
        });
    });

    // Route toggle
    const routeBtn = document.getElementById('toggle-route');
    if (routeBtn) routeBtn.addEventListener('click', toggleRoute);

    // Open networks toggle
    const openBtn = document.getElementById('toggle-open');
    if (openBtn) openBtn.addEventListener('click', toggleOpenNetworks);

    // Theme toggle
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
});
