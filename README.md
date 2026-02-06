# NetStalker v2.0 - Enhanced Wardriving Visualization

## 🚀 What's New

### 1. 🗓️ Timeline / Session Tracking
- **Session Dropdown**: Filter by specific wardriving sessions
- **Date-based Organization**: See which APs were detected in each session
- **Multi-session Tracking**: APs detected in multiple sessions show all sessions

### 2. 🗺️ Heatmap Switcher (Strava-style)
Switch between different visualization modes:
- **📊 Density**: Shows AP concentration (default)
- **🔒 Security**: Red = insecure (open/WEP), Green = secure (WPA3)
- **📡 Signal**: Shows signal strength zones (red = strong, blue = weak)
- **📻 Channel**: Visualizes Wi-Fi channel congestion/interference
- **⭕ None**: Turn off heatmap, show only points

### 3. 🚗 Route Visualization
- **Purple Line**: Shows your actual driving path
- **Toggle ON/OFF**: Click "Route" button to show/hide
- **Session-based**: Routes are separated by wardriving session

## 📋 Setup Instructions

### Step 1: Generate Enhanced GeoJSON

Run the **new** Python script:

```bash
python wardrive_processor_v2.py
```

This will create `wardrive.geojson` with:
- Access point data (with timestamps and session tracking)
- Your driving route (GPS track)
- Session metadata

### Step 2: Update Your Web Files

Replace your old files with the new v2 versions:

```bash
# Rename new files to replace old ones
mv app_v2.js app.js
mv index_v2.html index.html
mv style_v2.css style.css
```

### Step 3: Open in Browser

```bash
open index.html
# or
python -m http.server 8000
# then visit http://localhost:8000
```

## 🎮 How to Use

### Heatmap Modes

**Density Mode** (default):
- Blue/cyan = low AP density
- Yellow/red = high AP density
- Great for finding crowded areas

**Security Mode**:
- Green = secure areas (WPA2/WPA3)
- Yellow = moderate security
- Orange/Red = insecure (open networks, WEP)
- **Use case**: Find areas with vulnerable networks

**Signal Mode**:
- Blue = weak signals
- Green = good signals  
- Yellow/Red = strong signals
- **Use case**: Understand coverage areas

**Channel Mode**:
- Blue = low interference
- Red = high congestion
- **Use case**: Find the best Wi-Fi channel for your router

### Timeline Filtering

1. Click the **SESSION** dropdown
2. Select a specific date/session
3. Map shows only APs detected in that session
4. **Use case**: Compare different days, track AP changes over time

### Route Visualization

1. Click **"Route: ON"** to show your driving path
2. Purple line shows where you drove
3. Useful for:
   - Identifying coverage gaps (areas you didn't drive through)
   - Planning future wardriving routes
   - Showing which streets you covered

## 📊 Data Structure

The enhanced GeoJSON now contains:

```json
{
  "type": "FeatureCollection",
  "features": [
    // AP points with properties:
    {
      "properties": {
        "MAC": "...",
        "SSID": "...",
        "AuthMode": "WPA2_PSK",
        "first_seen": "Feb 04, 2026 16:41",
        "last_seen": "Feb 05, 2026 19:46",
        "sessions": "260204_164121,260205_194604",
        "layer": "access_points"
      }
    },
    // Route lines:
    {
      "geometry": {
        "type": "LineString",
        "coordinates": [[lon, lat], ...]
      },
      "properties": {
        "session": "260204_164121",
        "layer": "route"
      }
    }
  ],
  "metadata": {
    "sessions": [
      {
        "name": "260204_164121",
        "date": "2026-02-04",
        "ap_count": 345,
        "duration_minutes": 45
      }
    ]
  }
}
```

## 🔧 Customization

### Adjust RSSI Thresholds (for Signal Heatmap)

Edit `stats.js`, lines 77-81:

```javascript
if (rssi >= -60) rssiRanges.excellent++;      // Change -60
else if (rssi >= -70) rssiRanges.good++;      // Change -70
else if (rssi >= -80) rssiRanges.fair++;      // Change -80
else if (rssi >= -90) rssiRanges.weak++;      // Change -90
else rssiRanges.poor++;
```

### Change Route Color

Edit `app_v2.js`, line 82:

```javascript
"line-color": "#8b5cf6",  // Change to any hex color
```

### Adjust Heatmap Colors

Each heatmap mode has a `heatmap-color` property in `app_v2.js`:
- Density: Lines 62-70
- Security: Lines 91-98  
- Signal: Lines 116-123
- Channel: Lines 142-147

## 🐛 Troubleshooting

**Route not showing?**
- Make sure Python script v2 was run
- Check that GeoJSON has "route" features
- Verify "Route: ON" button is active

**Sessions not appearing?**
- Run Python script v2 (generates metadata)
- Check browser console for errors
- Verify CSV files have timestamps

**Heatmaps look wrong?**
- Try different modes (some work better at different zoom levels)
- Adjust your RSSI slider
- Zoom in/out (heatmaps fade at high zoom)

## 📈 Performance Tips

- Large datasets (10k+ APs): Heatmaps perform better than points
- Many sessions: Filter by session to improve performance
- Route visualization: Minimal performance impact

## 🎯 Next Steps

Possible future enhancements:
- Date range slider (filter by time period)
- Animate route with playback controls
- Compare two sessions side-by-side
- Export filtered data to CSV
- Add clustering for dense areas

---

**Version**: 2.0  
**Last Updated**: February 2026  
**License**: MIT
