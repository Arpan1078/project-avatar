import json, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

KANSAS = (-102.05, 36.99, -94.59, 40.00)  # west, south, east, north
URL = ("https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
       "WFIGS_Incident_Locations_Current/FeatureServer/0/query")


# ---------- LIVE ----------
def fetch_live(bbox=KANSAS):
    """Known, reported fires from NIFC (WFIGS current incident locations). No key needed."""
    params = {
        "where": "1=1",
        "geometry": ",".join(map(str, bbox)),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "f": "geojson",
    }
    with urllib.request.urlopen(f"{URL}?{urllib.parse.urlencode(params)}", timeout=30) as r:
        data = json.load(r)
    out = []
    for feat in data.get("features", []):
        p = feat.get("properties", {})
        lon, lat = feat["geometry"]["coordinates"][:2]
        disc = p.get("FireDiscoveryDateTime")
        ts = (datetime.fromtimestamp(disc / 1000, timezone.utc) if disc
              else datetime.now(timezone.utc))
        if ts < datetime.now(timezone.utc) - timedelta(days=7):
            continue
        out.append(_record(lat, lon, ts, p.get("IncidentName"),
                           p.get("IncidentTypeCategory"), p.get("IncidentSize"),
                           p.get("PercentContained")))
    return out


# ---------- SIMULATED ----------
def fetch_sim(now=None):
    """One already-reported prescribed burn near Hutchinson. The Flint Hills fire
    is deliberately NOT here, so the system treats it as a new ignition."""
    now = now or datetime.now(timezone.utc)
    return [_record(38.06, -97.93, now - timedelta(hours=6),
                    "Sand Hills RX", "RX", 120.0, 40.0)]


def _record(lat, lon, ts, name, inc_type, acres, contained):
    return {"source": "nifc", "lat": float(lat), "lon": float(lon),
            "timestamp": ts.isoformat(), "strength": 1.0,
            "raw": {"name": name, "type": inc_type,   # WF = wildfire, RX = prescribed
                    "acres": acres, "contained_pct": contained}}


def get_nifc(mode="sim"):
    return fetch_live() if mode == "live" else fetch_sim()


if __name__ == "__main__":
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "sim"
    for rec in get_nifc(mode):
        print(json.dumps(rec))
