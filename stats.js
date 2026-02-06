// ============================================================================
// CHART.JS PLUGIN: Extra Legend Spacing
// ============================================================================
const extraLegendSpacingModel = {
  id: 'extraLegendSpacing',
  beforeInit(chart) {
    const originalFit = chart.legend.fit;
    chart.legend.fit = function fit() {
      originalFit.bind(chart.legend)();
      this.height += 30; 
    };
  }
};

// ============================================================================
// MAIN FUNCTION: Load and Process Data
// ============================================================================
async function updateStatsPage() {
  try {
    const res = await fetch("data/wardrive.geojson");
    
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Could not load wardrive.geojson`);
    }
    
    const data = await res.json();
    const features = data.features;

    if (!features || features.length === 0) {
      console.warn("⚠️ No features found in data");
      showNoDataMessage();
      return;
    }

    console.log(`✅ Loaded ${features.length} access points for stats`);

    // Initialize counters
    let totalWifi = features.length; // All devices are Wi-Fi
    const security = { wpa3: 0, wpa2: 0, legacy: 0, open: 0 };
    const channelCounts = {}; // Stores counts for Channels 1-14 (2.4GHz)
    const rssiRanges = { 
      excellent: 0,  // -30 to -60 dBm (Very strong - close to AP)
      good: 0,       // -61 to -70 dBm (Strong - good signal)
      fair: 0,       // -71 to -80 dBm (Moderate - typical wardriving)
      weak: 0,       // -81 to -90 dBm (Weak but usable)
      poor: 0        // -91 to -100 dBm (Very weak - edge of range)
    };

    // Initialize all 2.4GHz channels (1-14)
    for (let i = 1; i <= 14; i++) {
      channelCounts[i] = 0;
    }

    // Process each access point
    features.forEach(f => {
      const p = f.properties;
      const auth = (p.AuthMode || "").toUpperCase();
      const rssi = p.best_rssi || -100;

      // ====================================
      // SECURITY CLASSIFICATION
      // ====================================
      if (auth.includes("WPA3")) {
        security.wpa3++;
      } else if (auth.includes("WPA2")) {
        security.wpa2++;
      } else if (auth.includes("OPEN") || auth === "" || auth === "[]") {
        security.open++;
      } else {
        security.legacy++; // WEP, WPA1, etc.
      }

      // ====================================
      // SIGNAL STRENGTH CLASSIFICATION
      // (Adjusted for wardriving - you're often far from APs)
      // ====================================
      if (rssi >= -60) rssiRanges.excellent++;      // Very strong
      else if (rssi >= -70) rssiRanges.good++;      // Strong
      else if (rssi >= -80) rssiRanges.fair++;      // Moderate (typical)
      else if (rssi >= -90) rssiRanges.weak++;      // Weak but usable
      else rssiRanges.poor++;                       // Very weak

      // ====================================
      // CHANNEL DISTRIBUTION (2.4GHz only)
      // ====================================
      const ch = parseInt(p.Channel || 0);
      if (ch >= 1 && ch <= 14) {
        channelCounts[ch]++;
      }
    });

    // ====================================
    // VENDOR DISTRIBUTION
    // ====================================
    const vendorCounts = {};
    features.forEach(f => {
      const vendor = f.properties.Vendor || 'Unknown';
      vendorCounts[vendor] = (vendorCounts[vendor] || 0) + 1;
    });

    const sortedVendors = Object.entries(vendorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const vendorLabels = sortedVendors.map(v => v[0]);
    const vendorData = sortedVendors.map(v => v[1]);

    // ====================================
    // TOP SSIDs TABLE
    // ====================================
    const ssidCounts = {};
    const ssidVendors = {};
    features.forEach(f => {
      const ssid = f.properties.SSID || '';
      const vendor = f.properties.Vendor || 'Unknown';
      ssidCounts[ssid] = (ssidCounts[ssid] || 0) + 1;
      if (!ssidVendors[ssid]) ssidVendors[ssid] = {};
      ssidVendors[ssid][vendor] = (ssidVendors[ssid][vendor] || 0) + 1;
    });

    const topSSIDs = Object.entries(ssidCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    const tbody = document.getElementById('ssid-table-body');
    if (tbody) {
      tbody.innerHTML = topSSIDs.map(([ssid, count], i) => {
        const vendorMap = ssidVendors[ssid];
        const topVendor = Object.entries(vendorMap).sort((a, b) => b[1] - a[1])[0][0];
        const displaySSID = ssid
          ? ssid
          : '<span style="color:#666;font-style:italic">&lt;hidden&gt;</span>';
        return `<tr>
          <td style="color:#666">${i + 1}</td>
          <td class="ssid-name">${displaySSID}</td>
          <td>${topVendor}</td>
          <td class="ssid-count">${count}</td>
        </tr>`;
      }).join('');
    }

    // ====================================
    // UPDATE UI TEXT VALUES
    // ====================================
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val.toLocaleString();
    };
    
    setVal("total-wifi", totalWifi);

    // ====================================
    // RENDER ALL CHARTS
    // ====================================
    renderCharts(rssiRanges, security, channelCounts, vendorLabels, vendorData);

  } catch (err) {
    console.error("❌ Stats Error:", err);
    showErrorMessage(err.message);
  }
}

// ============================================================================
// CHART RENDERING
// ============================================================================
function renderCharts(rssi, sec, channels, vendorLabels, vendorData) {

  const light = isLightTheme();
  const gridColor = light ? '#ddd' : '#333';
  const tickColor = light ? '#666' : '#888';
  const labelColor = light ? '#555' : '#aaa';
  const legendColor = light ? '#555' : '#a1a1aa';

  // Common Chart.js options
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: { padding: { top: 0, bottom: 20 } },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: legendColor,
          font: { size: 11, weight: 'bold' },
          padding: 15,
          usePointStyle: true
        }
      }
    }
  };

  // ====================================
  // 1. SIGNAL STRENGTH DISTRIBUTION
  // ====================================
  const ctx1 = document.getElementById("chart");
  if (ctx1) {
    if (Chart.getChart("chart")) Chart.getChart("chart").destroy();
    
    new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: ['Excellent', 'Good', 'Fair', 'Weak', 'Poor'],
        datasets: [{
          data: [
            rssi.excellent,
            rssi.good,
            rssi.fair,
            rssi.weak,
            rssi.poor
          ],
          backgroundColor: [
            '#10b981', // Green
            '#22c55e', // Light Green
            '#fbbf24', // Amber
            '#f97316', // Orange
            '#ef4444'  // Red
          ],
          borderWidth: 0,
          cutout: '72%'
        }]
      },
      options: commonOptions,
      plugins: [extraLegendSpacingModel]
    });
  }

  // ====================================
  // 2. SECURITY DISTRIBUTION
  // ====================================
  const ctx2 = document.getElementById("protectionChart");
  if (ctx2) {
    if (Chart.getChart("protectionChart")) Chart.getChart("protectionChart").destroy();
    
    new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['WPA3', 'WPA2', 'Legacy', 'Open'],
        datasets: [{
          data: [sec.wpa3, sec.wpa2, sec.legacy, sec.open],
          backgroundColor: [
            '#4ade80', // Green (WPA3)
            '#fbbf24', // Amber (WPA2)
            '#94a3b8', // Gray (Legacy)
            '#f87171'  // Red (Open)
          ],
          borderWidth: 0,
          cutout: '72%'
        }]
      },
      options: commonOptions,
      plugins: [extraLegendSpacingModel]
    });
  }

  // ====================================
  // 3. CHANNEL CONGESTION (2.4GHz)
  // ====================================
  const ctx3 = document.getElementById("channelChart");
  if (ctx3) {
    if (Chart.getChart("channelChart")) Chart.getChart("channelChart").destroy();
    
    new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: Object.keys(channels),
        datasets: [{
          label: 'Wi-Fi Networks',
          data: Object.values(channels),
          backgroundColor: '#3b82f6',
          borderRadius: 4,
          maxBarThickness: 50
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.parsed.y} networks`;
              }
            }
          }
        },
        scales: {
          y: {
            grid: { color: gridColor },
            ticks: { color: tickColor, precision: 0 },
            title: { display: true, text: 'Network Count', color: labelColor }
          },
          x: {
            grid: { display: false },
            ticks: { color: labelColor },
            title: { display: true, text: 'Channel', color: labelColor }
          }
        }
      }
    });
  }

  // ====================================
  // 4. VENDOR DISTRIBUTION (Horizontal Bar)
  // ====================================
  const ctx4 = document.getElementById("vendorChart");
  if (ctx4 && vendorLabels && vendorLabels.length > 0) {
    if (Chart.getChart("vendorChart")) Chart.getChart("vendorChart").destroy();

    new Chart(ctx4, {
      type: 'bar',
      data: {
        labels: vendorLabels,
        datasets: [{
          label: 'Networks',
          data: vendorData,
          backgroundColor: '#a855f7',
          borderRadius: 4,
          maxBarThickness: 30
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                return `${context.parsed.x} networks`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: tickColor, precision: 0 },
            title: { display: true, text: 'Network Count', color: labelColor }
          },
          y: {
            grid: { display: false },
            ticks: { color: labelColor, font: { size: 11 } }
          }
        }
      }
    });
  }
}

// ============================================================================
// ERROR HANDLING UI
// ============================================================================
function showNoDataMessage() {
  document.body.innerHTML = `
    <div style="display: flex; justify-content: center; align-items: center; height: 100vh; flex-direction: column; color: #888;">
      <div style="font-size: 48px; margin-bottom: 20px;">📡</div>
      <div style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">No Wardriving Data Found</div>
      <div style="font-size: 14px;">Run the Python script to generate wardrive.geojson</div>
    </div>
  `;
}

function showErrorMessage(msg) {
  const container = document.querySelector('.stats-container');
  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #ef4444;">
        <div style="font-size: 24px; margin-bottom: 10px;">⚠️ Error Loading Data</div>
        <div style="font-size: 14px; color: #888;">${msg}</div>
      </div>
    `;
  }
}

// ============================================================================
// THEME PERSISTENCE
// ============================================================================
function applyTheme() {
  const saved = localStorage.getItem('netstalker-theme') || 'dark';
  if (saved === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
}

function isLightTheme() {
  return document.body.classList.contains('light-theme');
}

// ============================================================================
// INIT
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  updateStatsPage();
});