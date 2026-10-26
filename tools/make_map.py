#!/usr/bin/env python3
"""Generate the "Light up Armenia" grid from Natural Earth data (public domain).

Usage: python3 tools/make_map.py NATURAL_EARTH_GEOJSON_DIR
Writes site/assets/data/map.json (frontend) and supabase/migrations/0004_cells_seed.sql (database).
A plot is a 2x2 km square inside Armenia's borders, excluding Lake Sevan.
"""
import json, math, sys
from pathlib import Path

NE = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parent.parent
CELL_KM = 2.0

PROVINCES = {  # Natural Earth name -> (code, hy, en, ru)
    "Erevan": ("yer", "Երևան", "Yerevan", "Ереван"), "Ararat": ("ara", "Արարատ", "Ararat", "Арарат"),
    "Armavir": ("arm", "Արմավիր", "Armavir", "Армавир"), "Aragatsotn": ("ag", "Արագածոտն", "Aragatsotn", "Арагацотн"),
    "Kotayk": ("kt", "Կոտայք", "Kotayk", "Котайк"), "Gegharkunik": ("gr", "Գեղարքունիք", "Gegharkunik", "Гегаркуник"),
    "Shirak": ("sh", "Շիրակ", "Shirak", "Ширак"), "Lori": ("lo", "Լոռի", "Lori", "Лори"),
    "Tavush": ("tv", "Տավուշ", "Tavush", "Тавуш"), "Vayots Dzor": ("vd", "Վայոց ձոր", "Vayots Dzor", "Вайоц Дзор"),
    "Syunik": ("su", "Սյունիք", "Syunik", "Сюник"),
}
TOWNS = [  # lat, lon, hy, en, ru  (approximate centres, used only for "near ..." labels)
    (40.1792, 44.4991, "Երևան", "Yerevan", "Ереван"), (40.7894, 43.8475, "Գյումրի", "Gyumri", "Гюмри"),
    (40.8128, 44.4883, "Վանաձոր", "Vanadzor", "Ванадзор"), (40.1658, 44.2925, "Վաղարշապատ", "Vagharshapat", "Вагаршапат"),
    (40.4972, 44.7667, "Հրազդան", "Hrazdan", "Раздан"), (40.2739, 44.6256, "Աբովյան", "Abovyan", "Абовян"),
    (39.2075, 46.4058, "Կապան", "Kapan", "Капан"), (40.1547, 44.0383, "Արմավիր", "Armavir", "Армавир"),
    (39.9539, 44.5506, "Արտաշատ", "Artashat", "Арташат"), (40.8756, 45.1492, "Իջևան", "Ijevan", "Иджеван"),
    (40.3589, 45.1267, "Գավառ", "Gavar", "Гавар"), (39.5111, 46.3411, "Գորիս", "Goris", "Горис"),
    (40.4031, 44.6417, "Չարենցավան", "Charentsavan", "Чаренцаван"), (39.8306, 44.7056, "Արարատ", "Ararat", "Арарат"),
    (40.0647, 44.4356, "Մասիս", "Masis", "Масис"), (40.5486, 44.9486, "Սևան", "Sevan", "Севан"),
    (40.2992, 44.3628, "Աշտարակ", "Ashtarak", "Аштарак"), (40.7417, 44.8636, "Դիլիջան", "Dilijan", "Дилижан"),
    (39.5208, 46.0322, "Սիսիան", "Sisian", "Сисиан"), (41.0975, 44.6731, "Ալավերդի", "Alaverdi", "Алаверди"),
    (41.0094, 44.3878, "Ստեփանավան", "Stepanavan", "Степанаван"), (40.1400, 45.3064, "Մարտունի", "Martuni", "Мартуни"),
    (40.8322, 44.2672, "Սպիտակ", "Spitak", "Спитак"), (40.1817, 45.7303, "Վարդենիս", "Vardenis", "Варденис"),
    (39.7611, 45.3333, "Եղեգնաձոր", "Yeghegnadzor", "Ехегнадзор"), (39.9106, 44.7275, "Վեդի", "Vedi", "Веди"),
    (40.6172, 43.9758, "Արթիկ", "Artik", "Артик"), (40.8808, 45.3906, "Բերդ", "Berd", "Берд"),
    (38.9031, 46.2453, "Մեղրի", "Meghri", "Мегри"), (39.8417, 45.6694, "Ջերմուկ", "Jermuk", "Джермук"),
    (40.3917, 43.8722, "Թալին", "Talin", "Талин"), (40.5933, 44.3589, "Ապարան", "Aparan", "Апаран"),
    (40.5328, 44.7203, "Ծաղկաձոր", "Tsaghkadzor", "Цахкадзор"), (41.1725, 44.9997, "Նոյեմբերյան", "Noyemberyan", "Ноемберян"),
    (41.1206, 44.2847, "Տաշիր", "Tashir", "Ташир"), (40.1189, 44.7339, "Գառնի", "Garni", "Гарни"),
    (39.3803, 46.2500, "Տաթև", "Tatev", "Татев"), (39.7208, 45.1847, "Արենի", "Areni", "Арени"),
    (40.3383, 44.2700, "Բյուրական", "Byurakan", "Бюракан"), (38.8633, 46.1847, "Ագարակ", "Agarak", "Агарак"),
]


def load(name):
    return json.load(open(NE / name, encoding="utf-8"))


def rings_of(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [p[0] for p in geom["coordinates"]]


countries = load("ne_10m_admin_0_countries.geojson")
arm = next(f for f in countries["features"] if f["properties"].get("ADM0_A3") == "ARM")
main = max(rings_of(arm["geometry"]), key=len)
lakes = load("ne_10m_lakes.geojson")
sevan = max(rings_of(next(f for f in lakes["features"] if "Sevan" in (f["properties"].get("name") or ""))["geometry"]), key=len)
adm1 = load("ne_10m_admin_1_states_provinces.geojson")
provs = [(PROVINCES[f["properties"]["name"]], rings_of(f["geometry"])) for f in adm1["features"] if f["properties"].get("adm0_a3") == "ARM"]

lons = [p[0] for p in main]; lats = [p[1] for p in main]
LON0, LAT_TOP = min(lons), max(lats)
LAT_MID = (min(lats) + max(lats)) / 2
KX, KY = math.cos(math.radians(LAT_MID)) * 111.32, 110.57


def proj(lon, lat):
    return ((lon - LON0) * KX, (LAT_TOP - lat) * KY)


def inside(x, y, poly):
    ins, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            ins = not ins
        j = i
    return ins


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    def rdp(a, b):
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1e-9
        best, idx = 0, -1
        for i in range(a + 1, b):
            d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L
            if d > best: best, idx = d, i
        if best > tol:
            return rdp(a, idx)[:-1] + rdp(idx, b)
        return [pts[a], pts[b]]
    # A closed ring starts and ends on the same point: split it at the vertex farthest from the start.
    far = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
    if far in (0, len(pts) - 1):
        return rdp(0, len(pts) - 1)
    return rdp(0, far)[:-1] + rdp(far, len(pts) - 1)


P = [proj(*p) for p in main]
S = [proj(*p) for p in sevan]
PROV_P = [(meta, [[proj(*p) for p in ring] for ring in rings]) for meta, rings in provs]
W = max(p[0] for p in P); H = max(p[1] for p in P)
COLS, ROWS = int(W / CELL_KM) + 1, int(H / CELL_KM) + 1
towns_p = [(proj(lon, lat), hy, en, ru) for lat, lon, hy, en, ru in TOWNS]
prov_codes = [m[0] for m, _ in PROV_P]

cells = []  # (id, col, row, province_index, town_index)
for r in range(ROWS):
    for c in range(COLS):
        x, y = (c + 0.5) * CELL_KM, (r + 0.5) * CELL_KM
        if not inside(x, y, P) or inside(x, y, S):
            continue
        pi = next((i for i, (_, rings) in enumerate(PROV_P) if any(inside(x, y, ring) for ring in rings)), None)
        if pi is None:  # border slivers: nearest province by vertex distance
            pi = min(range(len(PROV_P)), key=lambda i: min(math.hypot(x - px, y - py) for ring in PROV_P[i][1] for px, py in ring[::5]))
        ti, td = min(((i, math.hypot(x - t[0][0], y - t[0][1])) for i, t in enumerate(towns_p)), key=lambda z: z[1])
        cells.append((r * COLS + c, c, r, pi, ti if td <= 14 else -1))

r1 = lambda v: round(v, 2)
data = {
    "cell_km": CELL_KM, "cols": COLS, "rows": ROWS, "width_km": r1(W), "height_km": r1(H),
    "outline": [[r1(x), r1(y)] for x, y in simplify(P, 0.25)],
    "sevan": [[r1(x), r1(y)] for x, y in simplify(S, 0.2)],
    "provinces": [{"code": m[0], "hy": m[1], "en": m[2], "ru": m[3],
                   "rings": [[[r1(x), r1(y)] for x, y in simplify(ring, 0.35)] for ring in rings if len(ring) > 20]} for m, rings in PROV_P],
    "towns": [{"x": r1(p[0]), "y": r1(p[1]), "hy": hy, "en": en, "ru": ru} for p, hy, en, ru in towns_p],
    # cells as flat array: id, province index, town index (-1 = none)
    "cells": [v for cell in cells for v in (cell[0], cell[3], cell[4])],
}
out = ROOT / "site" / "assets" / "data" / "map.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

sql = ["-- Generated by tools/make_map.py from Natural Earth (public domain). Do not edit by hand.",
       f"-- {len(cells)} plots of {CELL_KM}x{CELL_KM} km inside Armenia (Lake Sevan excluded). id = row * {COLS} + col.",
       "insert into public.map_cells (id, province, town_index) values"]
rows = [f"({cid},'{prov_codes[pi]}',{ti})" for cid, _, _, pi, ti in cells]
sql.append(",\n".join(",".join(rows[i:i + 20]) for i in range(0, len(rows), 20)) + "\non conflict (id) do nothing;")
(ROOT / "supabase" / "migrations" / "0004_cells_seed.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
print(f"{len(cells)} plots, grid {COLS}x{ROWS}, map.json {out.stat().st_size // 1024} KB")
from collections import Counter
print(Counter(prov_codes[c[3]] for c in cells))
