import os
import json
import csv
import random
import time
import subprocess
from datetime import datetime, timedelta
from collections import defaultdict

# ============================================================================
# CONFIGURATION
# ============================================================================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data") 
OUTPUT_FILE = os.path.join(DATA_DIR, "wardrive.geojson")
JITTER_AMOUNT = 0.0002  # Amount to randomize AP coordinates (privacy/anti-tracking)

OUI_URL = "https://standards-oui.ieee.org/oui/oui.csv"
OUI_CACHE = os.path.join(DATA_DIR, "oui.csv")

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def normalize_headers(headers):
    """
    Create a mapping from lowercase header names to original header names.
    This allows case-insensitive header lookups.
    """
    return {h.strip().lower(): h.strip() for h in headers}

def find_value(row, normalized_headers, keys, default):
    """
    Find a value in a CSV row using multiple possible key names.
    Tries each key in order and returns the first non-empty value found.
    """
    for key in keys:
        if key.lower() in normalized_headers:
            val = row.get(normalized_headers[key.lower()], '').strip()
            if val:
                return val
    return default

def parse_timestamp(timestamp_str):
    """
    Parse timestamp string into datetime object.
    Handles multiple common formats.
    """
    if not timestamp_str:
        return None
    
    formats = [
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d %H:%M:%S.%f',
    ]
    
    for fmt in formats:
        try:
            return datetime.strptime(timestamp_str, fmt)
        except ValueError:
            continue
    
    return None

def format_timestamp(dt):
    """Format datetime object into human-readable string."""
    if not dt:
        return "Unknown"
    return dt.strftime("%b %d, %Y %H:%M")

def format_time(seconds):
    """Format seconds into human-readable time string."""
    if seconds < 60:
        return f"{seconds:.1f}s"
    return str(timedelta(seconds=int(seconds)))

# ============================================================================
# OUI VENDOR LOOKUP
# ============================================================================

def load_oui_database():
    """Load IEEE OUI database for MAC vendor lookups. Downloads if not cached."""
    oui_map = {}

    def download_oui():
        subprocess.run(
            ['curl', '-sL', '-o', OUI_CACHE, OUI_URL],
            check=True, timeout=60
        )

    if not os.path.exists(OUI_CACHE):
        print("   Downloading IEEE OUI database...")
        try:
            download_oui()
            print("   Downloaded OUI database successfully")
        except Exception as e:
            print(f"   WARNING: Could not download OUI database: {e}")
            print("   Vendor lookups will show 'Unknown'")
            return oui_map
    else:
        age_days = (time.time() - os.path.getmtime(OUI_CACHE)) / 86400
        if age_days > 30:
            print("   OUI database is older than 30 days, re-downloading...")
            try:
                download_oui()
                print("   Updated OUI database")
            except Exception:
                print("   WARNING: Could not update, using cached version")

    try:
        with open(OUI_CACHE, 'r', encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                assignment = row.get('Assignment', '').strip().upper()
                org_name = row.get('Organization Name', '').strip()
                if len(assignment) == 6 and org_name:
                    prefix = f"{assignment[0:2]}:{assignment[2:4]}:{assignment[4:6]}"
                    oui_map[prefix] = org_name
        print(f"   Loaded {len(oui_map):,} OUI entries")
    except Exception as e:
        print(f"   WARNING: Could not parse OUI database: {e}")

    return oui_map

def lookup_vendor(mac, oui_map):
    """Look up vendor from MAC address using OUI prefix (first 3 octets)."""
    if not mac or not oui_map:
        return "Unknown"

    prefix = mac.upper()[:8]  # "C0:A3:6E"

    # Check for locally administered (randomized) MAC
    try:
        first_byte = int(prefix[:2], 16)
        if first_byte & 0x02:
            return "Randomized"
    except ValueError:
        pass

    return oui_map.get(prefix, "Unknown")

# ============================================================================
# MAIN PROCESSING FUNCTION
# ============================================================================

def process_files():
    """
    Process all CSV files and generate:
    1. AP points (unique access points)
    2. Route lines (your driving path)
    3. Session metadata
    """
    
    start_time = time.time()
    
    # Data structures
    devices = {}  # MAC -> device data
    route_points = []  # List of [timestamp, lat, lon, session_name]
    sessions = {}  # session_name -> {date, ap_count, start_time, end_time}
    
    # Counters
    total_rows = 0
    total_files = 0
    skipped_bluetooth = 0
    skipped_invalid = 0
    
    # ========================================================================
    # STEP 1: Validate data directory
    # ========================================================================
    if not os.path.exists(DATA_DIR):
        print(f"❌ ERROR: Data directory not found at {DATA_DIR}")
        return

    csv_files = [f for f in os.listdir(DATA_DIR) if f.lower().endswith(".csv")]
    
    if not csv_files:
        print(f"❌ No CSV files found in {DATA_DIR}")
        return
    
    print(f"\n{'='*70}")
    print(f"🚗 WARDRIVE DATA PROCESSOR v2.0")
    print(f"{'='*70}")
    print(f"📁 Data directory: {DATA_DIR}")
    print(f"📊 Found {len(csv_files)} CSV file(s)")
    print(f"{'='*70}\n")

    # Load OUI database for vendor lookups
    oui_map = load_oui_database()

    # ========================================================================
    # STEP 2: Process each CSV file
    # ========================================================================
    for file_idx, filename in enumerate(csv_files, 1):
        filepath = os.path.join(DATA_DIR, filename)
        file_start = time.time()
        file_rows = 0
        
        # Extract session name from filename (remove .csv extension)
        session_name = filename.replace('.csv', '').replace('_wardriving', '')
        
        print(f"📄 [{file_idx}/{len(csv_files)}] Processing: {filename}")
        print(f"   📅 Session: {session_name}")
        
        # Track session data
        session_aps = set()
        session_start = None
        session_end = None
        
        try:
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                lines = f.readlines()
            
            # Find header row
            header_line = None
            data_start_idx = 0
            
            for idx, line in enumerate(lines):
                if 'MAC' in line and 'SSID' in line:
                    header_line = line
                    data_start_idx = idx + 1
                    print(f"   📋 Found headers at line {idx + 1}")
                    break
            
            if header_line is None:
                print(f"   ⚠️  No header row found")
                continue
            
            headers = [h.strip() for h in header_line.split(',')]
            normalized_headers = normalize_headers(headers)
            reader = csv.DictReader(lines[data_start_idx:], fieldnames=headers)
            
            # Process each row
            for row in reader:
                file_rows += 1
                total_rows += 1
                
                if file_rows % 100 == 0:
                    elapsed = time.time() - file_start
                    rate = file_rows / elapsed if elapsed > 0 else 0
                    print(f"   ⚡ {file_rows} rows ({rate:.0f}/sec)", end='\r')
                
                try:
                    # Filter Bluetooth
                    dev_type = find_value(row, normalized_headers, ['Type'], 'WIFI').upper()
                    if 'BLE' in dev_type or 'BLUETOOTH' in dev_type:
                        skipped_bluetooth += 1
                        continue
                    
                    # Extract MAC
                    mac = find_value(row, normalized_headers, ['MAC', 'BSSID'], '')
                    if not mac:
                        skipped_invalid += 1
                        continue
                    
                    # Extract GPS coordinates (YOUR position)
                    try:
                        lat = float(find_value(row, normalized_headers, 
                            ['CurrentLatitude', 'Latitude', 'lat'], '0'))
                        lon = float(find_value(row, normalized_headers, 
                            ['CurrentLongitude', 'Longitude', 'lon'], '0'))
                    except ValueError:
                        skipped_invalid += 1
                        continue
                    
                    if lat == 0 and lon == 0:
                        skipped_invalid += 1
                        continue
                    
                    # Extract timestamp
                    timestamp_str = find_value(row, normalized_headers, 
                        ['FirstSeen', 'Timestamp', 'Time', 'DateTime'], '')
                    timestamp = parse_timestamp(timestamp_str)
                    
                    # Track session time range
                    if timestamp:
                        if session_start is None or timestamp < session_start:
                            session_start = timestamp
                        if session_end is None or timestamp > session_end:
                            session_end = timestamp
                    
                    # Add route point (YOUR GPS track)
                    if timestamp:
                        route_points.append({
                            'timestamp': timestamp,
                            'lat': lat,
                            'lon': lon,
                            'session': session_name
                        })
                    
                    # Extract AP data
                    try:
                        channel = int(find_value(row, normalized_headers, ['Channel'], '0'))
                    except ValueError:
                        channel = 0
                    
                    try:
                        rssi = int(find_value(row, normalized_headers, ['RSSI', 'Signal'], '-100'))
                    except ValueError:
                        rssi = -100
                    
                    ssid = find_value(row, normalized_headers, ['SSID'], '')
                    auth = find_value(row, normalized_headers, ['AuthMode', 'Encryption'], '')
                    auth = auth.replace('[', '').replace(']', '')
                    vendor = find_value(row, normalized_headers, ['MfgrId', 'Vendor'], '')
                    if not vendor or vendor == 'Unknown':
                        vendor = lookup_vendor(mac, oui_map)
                    
                    # Track which APs were in this session
                    session_aps.add(mac)
                    
                    # Aggregate device data
                    if mac not in devices:
                        devices[mac] = {
                            "best_rssi": rssi,
                            "lat": lat,
                            "lon": lon,
                            "SSID": ssid,
                            "AuthMode": auth,
                            "Vendor": vendor,
                            "Channel": channel,
                            "count": 1,
                            "first_seen": timestamp,
                            "last_seen": timestamp,
                            "sessions": [session_name]  # Track which sessions saw this AP
                        }
                    else:
                        d = devices[mac]
                        d["count"] += 1
                        
                        # Add session if not already tracked
                        if session_name not in d["sessions"]:
                            d["sessions"].append(session_name)
                        
                        # Update timestamps
                        if timestamp and d["first_seen"]:
                            if timestamp < d["first_seen"]:
                                d["first_seen"] = timestamp
                        elif timestamp and not d["first_seen"]:
                            d["first_seen"] = timestamp
                        
                        if timestamp and d["last_seen"]:
                            if timestamp > d["last_seen"]:
                                d["last_seen"] = timestamp
                        elif timestamp and not d["last_seen"]:
                            d["last_seen"] = timestamp
                        
                        # Update if better signal
                        if rssi > d["best_rssi"]:
                            d["best_rssi"] = rssi
                            d["lat"] = lat
                            d["lon"] = lon
                            d["Channel"] = channel
                            if vendor != "Unknown":
                                d["Vendor"] = vendor
                            if ssid and ssid != '""':
                                d["SSID"] = ssid
                
                except Exception:
                    skipped_invalid += 1
                    continue
            
            # Save session metadata
            sessions[session_name] = {
                'date': session_start.strftime('%Y-%m-%d') if session_start else 'Unknown',
                'start_time': session_start,
                'end_time': session_end,
                'ap_count': len(session_aps),
                'duration': (session_end - session_start).total_seconds() if (session_start and session_end) else 0
            }
            
            file_time = time.time() - file_start
            print(f"   ✓ {file_rows} rows, {len(session_aps)} APs in {format_time(file_time)}" + " "*20)
            total_files += 1
            
        except Exception as e:
            print(f"   ❌ Error: {e}")
            continue
    
    # ========================================================================
    # STEP 3: Build GeoJSON with layers
    # ========================================================================
    print(f"\n{'='*70}")
    print(f"🗺️  Building GeoJSON with route data...")
    
    # Sort route points by timestamp
    route_points.sort(key=lambda x: x['timestamp'])
    
    # Build AP features
    ap_features = []
    for idx, (mac, data) in enumerate(devices.items(), 1):
        if idx % 1000 == 0:
            print(f"   Building features: {idx}/{len(devices)}", end='\r')
        
        ssid = data["SSID"].replace('"', '') or "(Hidden)"
        lat_jittered = data["lat"] + random.uniform(-JITTER_AMOUNT, JITTER_AMOUNT)
        lon_jittered = data["lon"] + random.uniform(-JITTER_AMOUNT, JITTER_AMOUNT)
        
        ap_features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [lon_jittered, lat_jittered]
            },
            "properties": {
                "MAC": mac,
                "SSID": ssid,
                "AuthMode": data["AuthMode"],
                "Vendor": data["Vendor"],
                "Channel": data["Channel"],
                "best_rssi": data["best_rssi"],
                "count": data["count"],
                "first_seen": format_timestamp(data["first_seen"]),
                "last_seen": format_timestamp(data["last_seen"]),
                "sessions": ','.join(data["sessions"]),  # Which sessions detected this AP
                "layer": "access_points"
            }
        })
    
    # Build route features (one LineString per session)
    route_features = []
    sessions_with_routes = defaultdict(list)
    
    # Group route points by session
    for point in route_points:
        sessions_with_routes[point['session']].append([point['lon'], point['lat']])
    
    # Create a LineString for each session
    for session_name, coordinates in sessions_with_routes.items():
        if len(coordinates) > 1:  # Need at least 2 points for a line
            route_features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates
                },
                "properties": {
                    "session": session_name,
                    "layer": "route",
                    "point_count": len(coordinates)
                }
            })
    
    print(f"   ✓ Created {len(route_features)} route line(s)" + " "*30)
    
    # Combine all features
    all_features = ap_features + route_features
    
    # Add session metadata as a special feature
    session_list = []
    for name, data in sessions.items():
        session_list.append({
            'name': name,
            'date': data['date'],
            'ap_count': data['ap_count'],
            'duration_minutes': int(data['duration'] / 60) if data['duration'] else 0
        })
    
    # ========================================================================
    # STEP 4: Write output
    # ========================================================================
    print(f"   💾 Writing to file...")
    
    output_data = {
        "type": "FeatureCollection",
        "features": all_features,
        "metadata": {
            "sessions": session_list,
            "total_aps": len(devices),
            "total_routes": len(route_features),
            "generated": datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
    }
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2)
    
    # ========================================================================
    # STEP 5: Summary
    # ========================================================================
    total_time = time.time() - start_time
    
    print(f"\n{'='*70}")
    print(f"✅ PROCESSING COMPLETE!")
    print(f"{'='*70}")
    print(f"⏱️  Total time: {format_time(total_time)}")
    print(f"📊 Files processed: {total_files}/{len(csv_files)}")
    print(f"📡 Total Wi-Fi packets: {total_rows:,}")
    print(f"🎯 Unique APs: {len(devices):,}")
    print(f"🗺️  Route segments: {len(route_features)}")
    print(f"📅 Sessions: {len(sessions)}")
    
    if total_time > 0:
        print(f"⚡ Processing rate: {total_rows/total_time:.0f} rows/sec")
    
    print(f"🗑️  Skipped (Bluetooth): {skipped_bluetooth:,}")
    print(f"🗑️  Skipped (Invalid): {skipped_invalid:,}")
    print(f"💾 Output: {OUTPUT_FILE}")
    
    if os.path.exists(OUTPUT_FILE):
        print(f"📦 File size: {os.path.getsize(OUTPUT_FILE) / 1024:.1f} KB")
    
    print(f"\n📅 SESSION SUMMARY:")
    for name, data in sorted(sessions.items()):
        duration_str = f"{int(data['duration']/60)}min" if data['duration'] else "N/A"
        print(f"   • {name}: {data['ap_count']} APs, {duration_str}")

    # Vendor distribution summary
    vendor_counts = defaultdict(int)
    for mac, data in devices.items():
        vendor_counts[data["Vendor"]] += 1
    top_vendors = sorted(vendor_counts.items(), key=lambda x: -x[1])[:10]

    print(f"\n📱 TOP VENDORS:")
    for name, count in top_vendors:
        pct = count / len(devices) * 100
        print(f"   • {name}: {count} ({pct:.1f}%)")

    print(f"{'='*70}\n")

if __name__ == "__main__":
    process_files()