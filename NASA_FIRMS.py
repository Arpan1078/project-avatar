import os, io, random
from datetime import datetime, timedelta, timezone
import pandas as pd

KANSAS = (-102.05, 36.99, -94.59, 40.00)  # west, south, east, north
CONF_MAP = {"l": 0.3, "n": 0.6, "h": 0.9}
COLS = ["latitude","longitude","bright_ti4","scan","track","acq_date","acq_time",
        "satellite","instrument","confidence","version","bright_ti5","frp","daynight"]


def fetch_live(sat="VIIRS_SNPP_NRT", days=1, bbox=KANSAS):
    key = os.environ["FIRMS_KEY"]
    url = (f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{sat}/"
           f"{','.join(map(str, bbox))}/{days}")
    return pd.read_csv(url)


def fetch_sim(lat=38.45, lon=-96.55, n=4, now=None):
    """Fake FIRMS rows in the exact live format: a growing fire near the Flint Hills."""
    now = now or datetime.now(timezone.utc)
    rows = []
    for i in range(n):
        t = now - timedelta(minutes=10 * (n - i))
        rows.append({
            "latitude": lat + random.uniform(-0.005, 0.005),
            "longitude": lon + random.uniform(-0.005, 0.005),
            "bright_ti4": 330 + 5 * i, "scan": 0.4, "track": 0.4,
            "acq_date": t.strftime("%Y-%m-%d"), "acq_time": t.strftime("%H%M"),
            "satellite": "N", "instrument": "VIIRS",
            "confidence": "nh"[min(i // 2, 1)], "version": "2.0NRT",
            "bright_ti5": 290, "frp": 5.0 + 4 * i, "daynight": "N",
        })
    return pd.DataFrame(rows, columns=COLS)


def to_records(df):
    """Convert FIRMS rows into the shared record format used by the rest of the pipeline."""
    out = []
    for _, r in df.iterrows():
        ts = datetime.strptime(f"{r.acq_date} {int(r.acq_time):04d}", "%Y-%m-%d %H%M")
        out.append({
            "source": "firms_viirs",
            "lat": float(r.latitude), "lon": float(r.longitude),
            "timestamp": ts.replace(tzinfo=timezone.utc).isoformat(),
            "strength": CONF_MAP.get(str(r.confidence), 0.5),
            "raw": {"frp": float(r.frp), "daynight": r.daynight},
        })
    return out


def get_firms(mode="sim"):
    df = fetch_live() if mode == "live" else fetch_sim()
    return to_records(df)


if __name__ == "__main__":
    import json, sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "sim"
    for rec in get_firms(mode):
        print(json.dumps(rec))