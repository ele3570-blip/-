"""게임용 데이터(web/data.js)를 만든다.

- 행정동 경계: 단순화(Douglas-Peucker)해서 용량을 줄인다.
- 정류장: 길 양쪽(앞/건너) 등 120m 안의 같은 구 정류소를 하나의 '게임 정류장'으로 묶는다.
- 시간대 비율: 24개월 평균 승차 비율(05~23시).
"""
import csv, json, math, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
CLUSTER_M = 120
PAIR_M = 400  # 이름이 같은 양방향 정류장(앞/건너 등)은 이 거리 안이면 하나로
ROAD_M = 40   # 큰 도로(집산도로 이상)에서 이보다 먼 정류장은 작은 길 정류장으로 보고 뺀다
SIMPLIFY_DEG = 0.00015  # 약 15m


def dist_m(a, b):
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians(35.87))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def simplify(pts, tol):
    if len(pts) < 4:
        return pts
    a, b = pts[0], pts[-1]
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        if a == b:
            d = math.hypot(p[0] - a[0], p[1] - a[1])
        else:
            d = abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / math.hypot(b[0] - a[0], b[1] - a[1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return simplify(pts[: idx + 1], tol)[:-1] + simplify(pts[idx:], tol)
    return [a, b]


def ring_simplify(ring):
    # 닫힌 고리는 두 점으로 나눠 단순화
    half = len(ring) // 2
    s = simplify(ring[: half + 1], SIMPLIFY_DEG)[:-1] + simplify(ring[half:], SIMPLIFY_DEG)
    return [[round(x, 5), round(y, 5)] for x, y, *_ in s]


def base_name(n):
    """표시용 이름: '약령시건너(동성로입구)' → '약령시(동성로입구)', '대구역앞' → '대구역'"""
    n = re.sub(r"\s+", "", n)
    n = re.sub(r"(건너|앞|맞은편)(?=\(|\d*$)", "", n)
    n = re.sub(r"(?<=[^\d])\d$", "", n) if not re.search(r"\d+(번|리|가|동|단지|차)", n) else n
    return n or "정류장"


def pair_key(n):
    """양방향 짝 찾기용: 괄호·공백·앞/건너·끝 번호를 모두 뗀 이름"""
    n = re.sub(r"\(.*?\)", "", n)
    n = re.sub(r"\s+", "", n)
    n = re.sub(r"(건너|앞|맞은편|방면)?\d*$", "", n)
    n = re.sub(r"(건너|앞)$", "", n)
    return n


def road_distance_fn():
    """도로망(web/roads.js)에서 가장 가까운 도로까지 거리(m)를 재는 함수. 파일이 없으면 None"""
    path = P("web/roads.js")
    if not os.path.exists(path):
        return None
    txt = open(path, encoding="utf-8").read()
    rn = json.loads(txt.split("window.ROADNET = ", 1)[1].rstrip(";\n"))
    kx, ky = 111320 * math.cos(math.radians(35.87)), 110540
    N, G, grid = rn["nodes"], 300.0, {}
    for a, b, *_rest, flat in rn["edges"]:
        pts = [(N[2 * a], N[2 * a + 1])] + [(flat[k], flat[k + 1]) for k in range(0, len(flat), 2)] + [(N[2 * b], N[2 * b + 1])]
        pts = [(x * kx, y * ky) for x, y in pts]
        for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
            for gx in range(int(min(x1, x2) // G), int(max(x1, x2) // G) + 1):
                for gy in range(int(min(y1, y2) // G), int(max(y1, y2) // G) + 1):
                    grid.setdefault((gx, gy), []).append((x1, y1, x2, y2))

    def dist(lon, lat):
        px, py = lon * kx, lat * ky
        best = 1e9
        gx, gy = int(px // G), int(py // G)
        for i in range(gx - 1, gx + 2):
            for j in range(gy - 1, gy + 2):
                for x1, y1, x2, y2 in grid.get((i, j), []):
                    dx, dy = x2 - x1, y2 - y1
                    L2 = dx * dx + dy * dy
                    t = 0 if not L2 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / L2))
                    best = min(best, math.hypot(px - x1 - dx * t, py - y1 - dy * t))
        return best
    return dist


def main():
    dongs = []
    for f in json.load(open(P("data/daegu_dong.geojson"), encoding="utf-8"))["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        _, gu, dong = f["properties"]["adm_nm"].split(" ", 2)
        rings = [ring_simplify(poly[0]) for poly in polys]
        dongs.append({"gu": gu, "name": dong, "code": f["properties"]["adm_cd2"], "rings": rings})

    rows = list(csv.DictReader(open(P("data/stops_geo.csv"), encoding="utf-8-sig")))
    rows.sort(key=lambda r: -(float(r["하루평균승차"]) + float(r["하루평균하차"])))
    clusters = []
    for r in rows:
        pt = (float(r["경도"]), float(r["위도"]))
        on, off = float(r["하루평균승차"]), float(r["하루평균하차"])
        best = None
        for c in clusters:
            if c["gu"] == r["구군"] and dist_m(c["pt"], pt) <= CLUSTER_M:
                best = c
                break
        if best is None:
            clusters.append({"pt": pt, "gu": r["구군"], "dong": r["행정동"], "name": base_name(r["정류소명"]),
                             "on": on, "off": off, "n": 1, "sx": pt[0] * (on + off + 1), "sy": pt[1] * (on + off + 1),
                             "w": on + off + 1})
        else:
            w = on + off + 1
            best["on"] += on
            best["off"] += off
            best["n"] += 1
            best["sx"] += pt[0] * w
            best["sy"] += pt[1] * w
            best["w"] += w

    # 2단계: 이름이 같은 양방향 정류장 합치기 (같은 구, PAIR_M 안)
    for c in clusters:
        c["key"] = pair_key(c["name"])
        c["pt"] = (c["sx"] / c["w"], c["sy"] / c["w"])
    merged = []
    for c in sorted(clusters, key=lambda c: -c["w"]):
        tgt = next((m for m in merged if m["gu"] == c["gu"] and m["key"] == c["key"] and c["key"]
                    and dist_m(m["pt"], c["pt"]) <= PAIR_M), None)
        if tgt is None:
            merged.append(c)
            continue
        # 승객 수만 더하고 위치는 승객이 더 많은 쪽(tgt) 그대로: 가운데로 잡으면 도로 밖이 될 수 있음
        for k in ("on", "off", "n"):
            tgt[k] += c[k]
    clusters = merged

    # 3단계: 작은 길 정류장 빼기 (web/roads.js 도로망 기준)
    near_road = road_distance_fn()
    for c in clusters:
        c["pt"] = (c["sx"] / c["w"], c["sy"] / c["w"])  # 합친 뒤 실제 위치
    if near_road:
        before = len(clusters)
        removed_on = sum(c["on"] for c in clusters if near_road(*c["pt"]) > ROAD_M)
        clusters = [c for c in clusters if near_road(*c["pt"]) <= ROAD_M]
        print(f"작은 길 정류장 {before - len(clusters)}개 제외 (하루 승차 {round(removed_on)}명)")

    stops = []
    for i, c in enumerate(clusters):
        stops.append({"id": i, "name": c["name"], "gu": c["gu"], "dong": c["dong"],
                      "lon": round(c["sx"] / c["w"], 6), "lat": round(c["sy"] / c["w"], 6),
                      "on": round(c["on"]), "off": round(c["off"]), "n": c["n"]})

    prof = list(csv.DictReader(open(P("data/hourly_profile.csv"), encoding="utf-8-sig")))
    hours = [f"{h:02d}시" for h in range(5, 24)]
    hourly = [round(sum(float(p[h]) for p in prof) / len(prof) / 100, 4) for h in hours]

    os.makedirs(P("web"), exist_ok=True)
    with open(P("web/data.js"), "w", encoding="utf-8") as f:
        f.write("// scripts/build_game_data.py 로 생성됨. 직접 수정하지 마세요.\n")
        f.write("window.GAME_DATA = ")
        json.dump({"dongs": dongs, "stops": stops, "hourly": hourly, "hourStart": 5},
                  f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"행정동 {len(dongs)}개, 정류장 {len(rows)}개 → 게임 정류장 {len(stops)}개, "
          f"data.js {os.path.getsize(P('web/data.js')) // 1024}KB")
    by = {}
    for s in stops:
        by[s["gu"]] = by.get(s["gu"], 0) + 1
    print(by)


if __name__ == "__main__":
    main()
