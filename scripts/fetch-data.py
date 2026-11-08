#!/usr/bin/env python3
"""
fetch-data.py: download real map data for the Firewatch district into data/*.geojson.

Area: a box of about 25 x 25 miles around the Cottonwood Creek district
(fire start 37.166 N, 98.609 W, south of Medicine Lodge, Barber County, Kansas),
plus a 40-mile radius for towns.

Run from the project folder (Python 3.8+, standard library only, no installs):
    python scripts/fetch-data.py
It overwrites the files in data/ and prints a report: features per file, file
sizes, and which downloads failed (with what to try).

SOURCES (all free and public; please keep the attribution when you show the data)
  - OpenStreetMap via the Overpass API (roads, power lines, buildings, towns,
    fire stations; water and creeks only if USGS fails)
      https://overpass-api.de/api/interpreter  (mirrors tried if it is busy)
      Data (c) OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright
  - USGS National Hydrography Dataset (NHD), The National Map ArcGIS service
      https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer
      layer 12 "Waterbody - Large Scale" (lakes, ponds, reservoirs)
      layer 6  "Flowline - Large Scale" (named streams)
      Public domain (U.S. Government).
  - HIFLD Electric Power Transmission Lines (ArcGIS Online feature service)
      https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0
      Public (HIFLD Open). Optional: skipped with a warning if unavailable.
  - Microsoft Global ML Building Footprints (successor of "US Building
    Footprints"; the old per-state Kansas file is no longer public)
      tile index: https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv
      ODbL 1.0: https://github.com/microsoft/GlobalMLBuildingFootprints
      Used only when OpenStreetMap has fewer than ~50 buildings in the box.

OUTPUT (GeoJSON, WGS84 lon/lat, coordinates rounded to ~1 m, shapes simplified)
  data/water.geojson       Polygon     name, type (lake|pond|reservoir), acres, source
  data/creeks.geojson      LineString / MultiLineString   name, type, source
  data/powerlines.geojson  LineString / MultiLineString   kind (line|minor_line|transmission), voltage, operator, source
  data/roads.geojson       LineString / MultiLineString   name, type (OSM highway value), ref, surface, source
                           (junctions are never simplified away, so the network can be routed)
  data/buildings.geojson   Point (centroid)   kind (house|barn|other, null if unknown), source
  data/towns.geojson       Point       name, kind (city|town|village|fire_station), population, source
Lines are clipped to the box; ponds/lakes touching the box are kept whole.
"""
import csv
import gzip
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------- settings

# District box (about 25 x 25 mi). Matches story.js: the fire start
# (ORIGIN 37.16610 N, 98.60898 W) and -11.5..13.5 mi east, -17..8 mi north of it,
# which holds the fire, the station at Stubbs and the planned-burn site.
BOX = {'south': 36.920, 'west': -98.818, 'north': 37.282, 'east': -98.364}
# Towns and fire stations: 40 miles around the district center.
CENTER = (37.101, -98.591)            # lat, lon
TOWN_RADIUS_M = 40 * 1609.344

MAX_TOTAL_BYTES = 3_000_000           # all files together
MIN_OSM_BUILDINGS = 50                # below this, add Microsoft footprints
COORD_DECIMALS = 5                    # ~1.1 m
# Douglas-Peucker tolerances in degrees, tried in order until the total fits.
TOLERANCES = [0.00003, 0.00006, 0.00012, 0.00025, 0.0005]

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
USER_AGENT = 'firewatch-data-fetch/1.0 (wildfire dashboard hackathon project)'

OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
NHD_URL = 'https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer'
NHD_WATERBODY_LAYER = 12
NHD_FLOWLINE_LAYER = 6
HIFLD_URL = ('https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/'
             'Electric_Power_Transmission_Lines/FeatureServer/0')
MS_INDEX_URL = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv'

OSM_ATTRIB = 'Data (c) OpenStreetMap contributors, ODbL 1.0'
NHD_ATTRIB = 'USGS National Hydrography Dataset (public domain)'
HIFLD_ATTRIB = 'HIFLD Electric Power Transmission Lines (public)'
MS_ATTRIB = 'Microsoft Global ML Building Footprints, ODbL 1.0'

# ---------------------------------------------------------------- report

report = {'failed': [], 'notes': []}


def fail(what, err, todo):
    report['failed'].append((what, str(err)[:300], todo))
    print(f'  !! {what} failed: {str(err)[:200]}')


def note(text):
    report['notes'].append(text)
    print('  - ' + text)

# ---------------------------------------------------------------- http


def http_get(url, params=None, data=None, timeout=180, tries=3):
    if params:
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params)
    body = urllib.parse.urlencode(data).encode() if data else None
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            code = getattr(e, 'code', None)
            if code and code not in (429, 500, 502, 503, 504):
                break                       # not worth retrying
            time.sleep(5 * (i + 1))
    raise last


def overpass(query):
    """Run an Overpass QL query, trying mirrors if one is busy."""
    errors = []
    for url in OVERPASS_URLS:
        try:
            out = json.loads(http_get(url, data={'data': query}, timeout=240, tries=2))
            if out.get('remark') and 'error' in out['remark'].lower():
                raise RuntimeError(out['remark'])
            return out['elements']
        except Exception as e:                     # noqa: BLE001 (report and try the next mirror)
            errors.append(f'{url}: {e}')
            time.sleep(3)
    raise RuntimeError(' | '.join(errors))


def arcgis_query(layer_url, where, out_fields):
    """All features of an ArcGIS layer inside BOX, as GeoJSON features (paged)."""
    feats, offset = [], 0
    while True:
        params = {
            'where': where, 'outFields': out_fields, 'f': 'geojson', 'outSR': 4326,
            'geometry': f"{BOX['west']},{BOX['south']},{BOX['east']},{BOX['north']}",
            'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
            'spatialRel': 'esriSpatialRelIntersects', 'returnGeometry': 'true',
            'resultOffset': offset, 'resultRecordCount': 1000,
        }
        out = json.loads(http_get(layer_url + '/query', params=params))
        if 'error' in out:
            raise RuntimeError(out['error'])
        batch = out.get('features', [])
        feats += batch
        exceeded = out.get('exceededTransferLimit') or out.get('properties', {}).get('exceededTransferLimit')
        if not batch or not exceeded:
            return feats
        offset += len(batch)

# ---------------------------------------------------------------- geometry


def in_box(lon, lat):
    return BOX['west'] <= lon <= BOX['east'] and BOX['south'] <= lat <= BOX['north']


def bbox_of(coords):
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return min(xs), min(ys), max(xs), max(ys)


def bbox_touches_box(b):
    return not (b[2] < BOX['west'] or b[0] > BOX['east'] or b[3] < BOX['south'] or b[1] > BOX['north'])


def clip_line(coords):
    """Clip a polyline to BOX (Liang-Barsky per segment). Returns a list of parts."""
    x0, y0, x1, y1 = BOX['west'], BOX['south'], BOX['east'], BOX['north']
    parts, cur = [], []
    for a, b in zip(coords, coords[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t0, t1, ok = 0.0, 1.0, True
        for p, q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
            if p == 0:
                if q < 0:
                    ok = False
                    break
            else:
                t = q / p
                if p < 0:
                    t0 = max(t0, t)
                else:
                    t1 = min(t1, t)
        if not ok or t0 > t1:
            if len(cur) > 1:
                parts.append(cur)
            cur = []
            continue
        pa = [a[0] + t0 * dx, a[1] + t0 * dy]
        pb = [a[0] + t1 * dx, a[1] + t1 * dy]
        if not cur:
            cur = [pa]
        elif t0 > 0:                       # re-entered the box: start a new part
            if len(cur) > 1:
                parts.append(cur)
            cur = [pa]
        cur.append(pb)
        if t1 < 1:                         # left the box
            if len(cur) > 1:
                parts.append(cur)
            cur = []
    if len(cur) > 1:
        parts.append(cur)
    return parts


def simplify(pts, tol, fixed=None):
    """Douglas-Peucker (iterative). Points in `fixed` (coordinate tuples) are
    always kept, e.g. road junctions, so lines stay connected for routing."""
    if len(pts) < 3 or tol <= 0:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    if fixed:
        for k, p in enumerate(pts):
            if (p[0], p[1]) in fixed:
                keep[k] = True
        cuts = [k for k, f in enumerate(keep) if f]
        out = [pts[0]]
        for a, b in zip(cuts, cuts[1:]):
            out += simplify(pts[a:b + 1], tol)[1:]
        return out
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy)
        best, idx = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L if L else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, k
        if best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep) if k]


def rnd(pts):
    out = []
    for x, y in pts:
        p = [round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)]
        if not out or p != out[-1]:
            out.append(p)
    return out


def line_geometry(parts, tol, fixed=None):
    parts = [rnd(simplify(p, tol, fixed)) for p in parts]
    parts = [p for p in parts if len(p) > 1]
    if not parts:
        return None
    if len(parts) == 1:
        return {'type': 'LineString', 'coordinates': parts[0]}
    return {'type': 'MultiLineString', 'coordinates': parts}


def polygon_geometry(rings, tol):
    out = []
    for r in rings:
        s = rnd(simplify(r, tol))
        if s[0] != s[-1]:
            s.append(s[0])
        if len(s) >= 4:
            out.append(s)
        elif not out:
            return None                    # outer ring collapsed: drop the polygon
    return {'type': 'Polygon', 'coordinates': out} if out else None


def ring_area_acres(ring):
    """Approximate area of a lon/lat ring in acres (equirectangular)."""
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    kx, ky = 111320 * math.cos(lat0), 110574
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return abs(a) / 2 / 4046.856


def ring_centroid(ring):
    pts = ring[:-1] if ring[0] == ring[-1] else ring
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def merge_lines(lines):
    """Join line pieces that share end points (used per stream name)."""
    lines = [list(l) for l in lines]
    merged = True
    while merged:
        merged = False
        for i in range(len(lines)):
            for j in range(len(lines)):
                if i == j or not lines[i] or not lines[j]:
                    continue
                a, b = lines[i], lines[j]
                if a[-1] == b[0]:
                    lines[i] = a + b[1:]
                elif a[-1] == b[-1]:
                    lines[i] = a + b[::-1][1:]
                elif a[0] == b[-1]:
                    lines[i] = b + a[1:]
                elif a[0] == b[0]:
                    lines[i] = b[::-1] + a[1:]
                else:
                    continue
                lines[j] = None
                merged = True
        lines = [l for l in lines if l]
    return lines


def osm_way_coords(el):
    return [[g['lon'], g['lat']] for g in el.get('geometry', []) if g]

# ---------------------------------------------------------------- layers
# Each layer returns raw records; geometry is simplified later (so the size
# budget can be met by re-simplifying without downloading again).


def get_water():
    """Lakes, ponds and reservoirs: USGS NHD first, OpenStreetMap if that fails."""
    try:
        feats = arcgis_query(f'{NHD_URL}/{NHD_WATERBODY_LAYER}', 'FTYPE IN (390, 436)',
                             'GNIS_NAME,FTYPE,FCODE,AREASQKM')
        recs = []
        for f in feats:
            g, p = f.get('geometry'), {k.lower(): v for k, v in (f.get('properties') or {}).items()}
            if not g:
                continue
            polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
            for rings in polys:
                if not bbox_touches_box(bbox_of(rings[0])):
                    continue
                acres = (p.get('areasqkm') or 0) * 247.105 or ring_area_acres(rings[0])
                kind = 'reservoir' if p.get('ftype') == 436 else ('lake' if acres >= 10 else 'pond')
                recs.append({'rings': rings, 'props': {'name': p.get('gnis_name'), 'type': kind,
                             'acres': round(acres, 1), 'fcode': p.get('fcode'), 'source': 'usgs-nhd'}})
        note(f'water: {len(recs)} waterbodies from USGS NHD (ftype 390 lake/pond, 436 reservoir; '
             '"lake" = 10 acres or more)')
        return recs, NHD_ATTRIB
    except Exception as e:                          # noqa: BLE001
        fail('USGS NHD waterbodies', e, 'Using OpenStreetMap natural=water instead. Re-run later; '
             'the USGS service is sometimes down for maintenance.')
    els = overpass(f'[out:json][timeout:180];(way["natural"="water"]{bbox_ql()};'
                   f'relation["natural"="water"]{bbox_ql()};);out geom;')
    recs = []
    for el in els:
        rings = []
        if el['type'] == 'way':
            rings = [osm_way_coords(el)]
        elif el['type'] == 'relation':          # multipolygons: keep closed outer member ways
            rings = [[[g['lon'], g['lat']] for g in m.get('geometry', [])]
                     for m in el.get('members', []) if m.get('role') == 'outer' and m.get('geometry')]
            rings = [r for r in rings if len(r) > 3 and r[0] == r[-1]]
        tags = el.get('tags', {})
        for r in rings:
            if len(r) < 4 or r[0] != r[-1]:
                continue
            w = tags.get('water', '')
            kind = 'reservoir' if w in ('reservoir', 'basin') else ('pond' if w == 'pond' else 'lake' if ring_area_acres(r) >= 10 else 'pond')
            recs.append({'rings': [r], 'props': {'name': tags.get('name'), 'type': kind,
                         'acres': round(ring_area_acres(r), 1), 'source': 'osm'}})
    note(f'water: {len(recs)} waterbodies from OpenStreetMap')
    return recs, OSM_ATTRIB


def get_creeks():
    """Named streams: USGS NHD flowlines with a name, OpenStreetMap if that fails."""
    try:
        feats = arcgis_query(f'{NHD_URL}/{NHD_FLOWLINE_LAYER}', "gnis_name IS NOT NULL AND gnis_name <> ''",
                             'gnis_name,ftype,fcode')
        by_name = {}
        for f in feats:
            g, p = f.get('geometry'), {k.lower(): v for k, v in (f.get('properties') or {}).items()}
            if not g:
                continue
            lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
            for l in lines:
                for part in clip_line([c[:2] for c in l]):
                    by_name.setdefault(p['gnis_name'], []).append(part)
        recs = []
        for name, parts in sorted(by_name.items()):
            low = name.lower()
            kind = 'river' if 'river' in low else 'creek' if 'creek' in low else 'stream'
            recs.append({'parts': merge_lines([[[round(x, 7), round(y, 7)] for x, y in p] for p in parts]),
                         'props': {'name': name, 'type': kind, 'source': 'usgs-nhd'}})
        note(f'creeks: {len(recs)} named streams from USGS NHD ({len(feats)} flowline pieces merged by name)')
        return recs, NHD_ATTRIB
    except Exception as e:                          # noqa: BLE001
        fail('USGS NHD flowlines', e, 'Using OpenStreetMap waterway=stream/river with a name instead.')
    els = overpass(f'[out:json][timeout:180];way["waterway"~"^(stream|river)$"]["name"]{bbox_ql()};out geom;')
    by_name = {}
    for el in els:
        for part in clip_line(osm_way_coords(el)):
            by_name.setdefault(el['tags']['name'], []).append(part)
    recs = [{'parts': merge_lines(parts), 'props': {'name': n, 'type': 'river' if 'river' in n.lower() else 'creek' if 'creek' in n.lower() else 'stream', 'source': 'osm'}}
            for n, parts in sorted(by_name.items())]
    note(f'creeks: {len(recs)} named streams from OpenStreetMap')
    return recs, OSM_ATTRIB


def get_powerlines():
    recs = []
    els = overpass(f'[out:json][timeout:180];way["power"~"^(line|minor_line)$"]{bbox_ql()};out geom;')
    for el in els:
        t = el.get('tags', {})
        parts = clip_line(osm_way_coords(el))
        if parts:
            recs.append({'parts': parts, 'props': {'kind': t.get('power'), 'voltage': t.get('voltage'),
                         'operator': t.get('operator'), 'source': 'osm'}})
    note(f'powerlines: {len(recs)} OpenStreetMap power=line/minor_line ways')
    attrib = OSM_ATTRIB
    try:
        feats = arcgis_query(HIFLD_URL, '1=1', 'VOLTAGE,VOLT_CLASS,OWNER,STATUS,TYPE')
        n = 0
        for f in feats:
            g, p = f.get('geometry'), f.get('properties') or {}
            if not g:
                continue
            lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
            parts = [pt for l in lines for pt in clip_line([c[:2] for c in l])]
            if parts:
                v = p.get('VOLTAGE')
                recs.append({'parts': parts, 'props': {'kind': 'transmission',
                             'voltage': None if v in (None, -999) else v, 'volt_class': p.get('VOLT_CLASS'),
                             'operator': p.get('OWNER'), 'status': p.get('STATUS'), 'source': 'hifld'}})
                n += 1
        note(f'powerlines: {n} HIFLD transmission lines')
        attrib += '; ' + HIFLD_ATTRIB
    except Exception as e:                          # noqa: BLE001
        fail('HIFLD transmission lines (optional)', e, 'The file still has the OpenStreetMap lines. '
             'Re-run later, or skip: HIFLD is optional.')
    return recs, attrib


def get_roads():
    # 'residential' is included because many rural county roads here are tagged that way.
    els = overpass(f'[out:json][timeout:180];way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|track)$"]'
                   f'{bbox_ql()};out geom;')
    # Junctions: points used by more than one way (or twice by one). Kept exactly
    # through simplification so the road network stays connected (routing).
    seen, fixed = set(), set()
    for el in els:
        for c in osm_way_coords(el):
            k = (c[0], c[1])
            (fixed if k in seen else seen).add(k)
    recs = []
    for el in els:
        t = el.get('tags', {})
        parts = clip_line(osm_way_coords(el))
        if parts:
            recs.append({'parts': parts, 'fixed': fixed, 'props': {'name': t.get('name'), 'type': t.get('highway'), 'ref': t.get('ref'),
                         'surface': t.get('surface'), 'source': 'osm'}})
    note(f'roads: {len(recs)} OpenStreetMap ways (trunk/primary/secondary/tertiary/unclassified/residential/track), '
         f'{len(fixed)} junctions kept')
    return recs, OSM_ATTRIB


HOUSE = {'house', 'detached', 'residential', 'farm', 'bungalow', 'cabin', 'semidetached_house',
         'static_caravan', 'apartments', 'terrace', 'dormitory'}
BARN = {'barn', 'farm_auxiliary', 'cowshed', 'stable', 'sty', 'shed', 'silo', 'greenhouse', 'hangar'}


def building_kind(tag):
    if tag in HOUSE:
        return 'house'
    if tag in BARN:
        return 'barn'
    if tag in (None, '', 'yes'):
        return None                       # unknown
    return 'other'


def get_buildings():
    els = overpass(f'[out:json][timeout:180];(node["building"]{bbox_ql()};way["building"]{bbox_ql()};'
                   f'relation["building"]{bbox_ql()};);out center tags;')
    pts = []
    for el in els:
        c = el if el['type'] == 'node' else el.get('center')
        if not c or not in_box(c['lon'], c['lat']):
            continue
        pts.append({'xy': (c['lon'], c['lat']), 'props': {'kind': building_kind(el.get('tags', {}).get('building')), 'source': 'osm'}})
    note(f'buildings: {len(pts)} from OpenStreetMap')
    attrib = OSM_ATTRIB
    if len(pts) < MIN_OSM_BUILDINGS:
        try:
            ms = microsoft_buildings()
            # Skip footprints already mapped in OSM (centroid within ~20 m).
            cell = 0.0002
            taken = {(int(p['xy'][0] / cell), int(p['xy'][1] / cell)) for p in pts}
            added = 0
            for x, y in ms:
                k = (int(x / cell), int(y / cell))
                if any((k[0] + i, k[1] + j) in taken for i in (-1, 0, 1) for j in (-1, 0, 1)):
                    continue
                pts.append({'xy': (x, y), 'props': {'kind': None, 'source': 'microsoft'}})
                added += 1
            note(f'buildings: OSM had fewer than {MIN_OSM_BUILDINGS}, added {added} Microsoft footprints '
                 f'({len(ms) - added} skipped as already in OSM)')
            attrib += '; ' + MS_ATTRIB
        except Exception as e:                      # noqa: BLE001
            fail('Microsoft building footprints', e, 'buildings.geojson has only the OpenStreetMap buildings. '
                 'Re-run later; if the tile index moved, check https://github.com/microsoft/GlobalMLBuildingFootprints '
                 'for the current dataset-links.csv URL and update MS_INDEX_URL.')
    return pts, attrib


def quadkey(lat, lon, z):
    x = (lon + 180) / 360
    s = math.sin(math.radians(lat))
    y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    n = 2 ** z
    tx, ty = min(n - 1, int(x * n)), min(n - 1, int(y * n))
    return ''.join(str((1 if tx & (1 << (i - 1)) else 0) + (2 if ty & (1 << (i - 1)) else 0)) for i in range(z, 0, -1))


def microsoft_buildings():
    """Building centroids inside BOX from the Microsoft zoom-9 tiles that cover it."""
    keys = set()
    steps = 6
    for i in range(steps + 1):
        for j in range(steps + 1):
            lat = BOX['south'] + (BOX['north'] - BOX['south']) * i / steps
            lon = BOX['west'] + (BOX['east'] - BOX['west']) * j / steps
            keys.add(quadkey(lat, lon, 9))
    index = http_get(MS_INDEX_URL, timeout=300).decode('utf-8')
    urls = [r['Url'] for r in csv.DictReader(io.StringIO(index)) if r['Location'] == 'UnitedStates' and r['QuadKey'] in keys]
    if not urls:
        raise RuntimeError(f'no UnitedStates tiles for quadkeys {sorted(keys)} in the index')
    out = []
    for u in urls:
        raw = gzip.decompress(http_get(u, timeout=300))
        for line in raw.decode('utf-8').splitlines():
            line = line.strip()
            if not line:
                continue
            f = json.loads(line)
            g = f.get('geometry') or {}
            ring = g['coordinates'][0] if g.get('type') == 'Polygon' else g['coordinates'][0][0] if g.get('type') == 'MultiPolygon' else None
            if not ring:
                continue
            x, y = ring_centroid(ring)
            if in_box(x, y):
                out.append((x, y))
    note(f'buildings: {len(out)} Microsoft footprints in the box from {len(urls)} tile(s) {sorted(keys)}')
    return out


def get_towns():
    lat, lon = CENTER
    r = int(TOWN_RADIUS_M)
    els = overpass(f'[out:json][timeout:180];(node["place"~"^(city|town|village)$"](around:{r},{lat},{lon});'
                   f'nwr["amenity"="fire_station"](around:{r},{lat},{lon}););out center tags;')
    pts = []
    for el in els:
        c = el if el['type'] == 'node' else el.get('center')
        if not c:
            continue
        t = el.get('tags', {})
        kind = 'fire_station' if t.get('amenity') == 'fire_station' else t.get('place')
        pop = t.get('population')
        try:
            pop = int(str(pop).replace(',', '')) if pop else None
        except ValueError:
            pop = None
        pts.append({'xy': (c['lon'], c['lat']), 'props': {'name': t.get('name'), 'kind': kind, 'population': pop,
                    'source': 'osm'}})
    n_fs = sum(1 for p in pts if p['props']['kind'] == 'fire_station')
    note(f'towns: {len(pts) - n_fs} places and {n_fs} fire stations within 40 mi (OpenStreetMap)')
    return pts, OSM_ATTRIB


def bbox_ql():
    return f"({BOX['south']},{BOX['west']},{BOX['north']},{BOX['east']})"

# ---------------------------------------------------------------- output


def collection(features, attrib, description):
    return {
        'type': 'FeatureCollection',
        'metadata': {
            'description': description, 'attribution': attrib,
            'bbox_wsen': [BOX['west'], BOX['south'], BOX['east'], BOX['north']],
            'fetched_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'generator': 'scripts/fetch-data.py',
        },
        'features': features,
    }


def build_features(name, recs, tol):
    feats = []
    for r in recs:
        if 'rings' in r:
            g = polygon_geometry(r['rings'], tol)
        elif 'parts' in r:
            g = line_geometry(r['parts'], tol, r.get('fixed'))
        else:
            x, y = r['xy']
            g = {'type': 'Point', 'coordinates': [round(x, COORD_DECIMALS), round(y, COORD_DECIMALS)]}
        if g:
            props = {k: v for k, v in r['props'].items() if v is not None or k == 'kind'}
            feats.append({'type': 'Feature', 'properties': props, 'geometry': g})
    return feats


def dumps(obj):
    return json.dumps(obj, separators=(',', ':'), ensure_ascii=False)


LAYERS = [
    ('water', get_water, 'Lakes, ponds and reservoirs (polygons)'),
    ('creeks', get_creeks, 'Named streams (lines), clipped to the box'),
    ('powerlines', get_powerlines, 'Power lines (OSM power=line/minor_line; HIFLD transmission), clipped to the box'),
    ('roads', get_roads, 'Roads and tracks with name and type, clipped to the box'),
    ('buildings', get_buildings, 'Building points (centroids)'),
    ('towns', get_towns, 'Towns, cities, villages and fire stations within 40 miles'),
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f'Box: {BOX}  (towns: 40 mi around {CENTER})')
    raw = {}
    for name, fn, desc in LAYERS:
        print(f'\n[{name}]')
        try:
            recs, attrib = fn()
            raw[name] = (recs, attrib, desc)
        except Exception as e:                      # noqa: BLE001
            fail(f'{name}.geojson (OpenStreetMap / Overpass)', e,
                 'The existing data/' + name + '.geojson was left unchanged. Overpass is often busy: wait a few '
                 'minutes and re-run. If it keeps failing, the error above names the server and reason.')
        time.sleep(2)                                # be gentle with Overpass

    # Simplify until everything fits in the size budget.
    for tol in TOLERANCES:
        out = {n: dumps(collection(build_features(n, r, tol), a, d)) for n, (r, a, d) in raw.items()}
        total = sum(len(s.encode('utf-8')) for s in out.values())
        if total <= MAX_TOTAL_BYTES:
            break
        print(f'  total {total / 1e6:.2f} MB with tolerance {tol}; simplifying more')
    for n, s in out.items():
        with open(os.path.join(OUT_DIR, n + '.geojson'), 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(s + '\n')

    print('\n================ REPORT ================')
    print(f'Simplification tolerance: {tol} degrees (~{tol * 111000:.0f} m); coordinates rounded to {COORD_DECIMALS} decimals')
    total = 0
    for name, _, _ in LAYERS:
        path = os.path.join(OUT_DIR, name + '.geojson')
        if name in out:
            n = len(json.loads(out[name])['features'])
            size = os.path.getsize(path)
            total += size
            print(f'  {name + ".geojson":20s} {n:6d} features  {size / 1024:8.1f} KB')
        else:
            print(f'  {name + ".geojson":20s}  NOT UPDATED (download failed)')
    print(f'  {"total":20s} {"":15s} {total / 1024:8.1f} KB')
    if report['failed']:
        print('\nFAILED:')
        for what, err, todo in report['failed']:
            print(f'  - {what}\n      error: {err}\n      what to do: {todo}')
    else:
        print('\nNo downloads failed.')
    return 1 if any(n not in out for n, _, _ in LAYERS) else 0


if __name__ == '__main__':
    sys.exit(main())
