import random
from datetime import datetime, timedelta, timezone
import numpy as np

KANSAS = (-102.05, 36.99, -94.59, 40.00)  # west, south, east, north
BUCKET = "noaa-goes19"          # GOES-East, covers Kansas
PRODUCT = "ABI-L2-FDCC"         # Fire Detection, CONUS scan every 5 min

# FDC mask codes -> strength (10-15 instantaneous, 30-35 temporally filtered)
MASK_MAP = {10: 0.7, 11: 0.7, 12: 0.5, 13: 0.5, 14: 0.4, 15: 0.3,
            30: 0.7, 31: 0.7, 32: 0.5, 33: 0.5, 34: 0.4, 35: 0.3}


# ---------- LIVE ----------
def _latest_file(fs, now):
    for back in range(3):  # look back up to 2 hours
        t = now - timedelta(hours=back)
        prefix = f"{BUCKET}/{PRODUCT}/{t:%Y}/{t.timetuple().tm_yday:03d}/{t:%H}/"
        try:
            files = sorted(fs.ls(prefix))
        except FileNotFoundError:
            continue
        if files:
            return files[-1]
    return None


def _xy_to_latlon(x, y, proj):
    """Convert GOES fixed-grid scan angles (radians) to lat/lon (degrees)."""
    r_eq, r_pol = proj.semi_major_axis, proj.semi_minor_axis
    H = proj.perspective_point_height + r_eq
    lon0 = np.radians(proj.longitude_of_projection_origin)
    a = np.sin(x)**2 + np.cos(x)**2 * (np.cos(y)**2 + (r_eq**2 / r_pol**2) * np.sin(y)**2)
    b = -2 * H * np.cos(x) * np.cos(y)
    c = H**2 - r_eq**2
    rs = (-b - np.sqrt(b**2 - 4 * a * c)) / (2 * a)
    sx, sy, sz = rs * np.cos(x) * np.cos(y), -rs * np.sin(x), rs * np.cos(x) * np.sin(y)
    lat = np.degrees(np.arctan((r_eq**2 / r_pol**2) * sz / np.sqrt((H - sx)**2 + sy**2)))
    lon = np.degrees(lon0 - np.arctan(sy / (H - sx)))
    return lat, lon


def fetch_live(bbox=KANSAS):
    import s3fs, xarray as xr
    fs = s3fs.S3FileSystem(anon=True)
    path = _latest_file(fs, datetime.now(timezone.utc))
    if not path:
        return []
    with fs.open(path) as f:
        ds = xr.open_dataset(f, engine="h5netcdf")
        mask = ds["Mask"].values
        frp = ds["Power"].values
        rows, cols = np.where(np.isin(mask, list(MASK_MAP)))
        if len(rows) == 0:
            return []
        x, y = ds["x"].values[cols], ds["y"].values[rows]
        lat, lon = _xy_to_latlon(x, y, ds["goes_imager_projection"])
        ts = datetime.strptime(ds.attrs["time_coverage_start"][:19], "%Y-%m-%dT%H:%M:%S")
    w, s, e, n = bbox
    out = []
    for i in range(len(rows)):
        if w <= lon[i] <= e and s <= lat[i] <= n:
            code = int(mask[rows[i], cols[i]])
            out.append(_record(lat[i], lon[i], ts.replace(tzinfo=timezone.utc),
                               MASK_MAP[code], code, frp[rows[i], cols[i]]))
    return out


# ---------- SIMULATED ----------
def fetch_sim(lat=38.45, lon=-96.55, now=None):
    """Scripted scenario: a real fire seen every 5 min with growing confidence,
    plus one uncorroborated blip at the El Dorado refinery (false positive)."""
    now = now or datetime.now(timezone.utc)
    ignition = now - timedelta(minutes=60)
    codes = [15, 15, 14, 14, 13, 13, 12, 10, 10, 10]  # low -> processed fire
    out = []
    for i, code in enumerate(codes):
        t = ignition + timedelta(minutes=10 + 5 * i)
        if t > now:
            break
        out.append(_record(lat + random.uniform(-0.01, 0.01),   # ~1 km jitter (2 km pixels)
                           lon + random.uniform(-0.01, 0.01),
                           t, MASK_MAP[code], code, 2.0 + 3 * i))
    out.append(_record(37.81, -96.86, now - timedelta(minutes=25),
                       MASK_MAP[15], 15, 1.5))  # single-frame false positive
    return out


def _record(lat, lon, ts, strength, code, frp):
    return {"source": "goes_fdc", "lat": float(lat), "lon": float(lon),
            "timestamp": ts.isoformat(), "strength": strength,
            "raw": {"mask": code, "frp": None if np.isnan(frp) else float(frp)}}


def get_goes(mode="sim"):
    return fetch_live() if mode == "live" else fetch_sim()


if __name__ == "__main__":
    import json, sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "sim"
    for rec in get_goes(mode):
        print(json.dumps(rec))