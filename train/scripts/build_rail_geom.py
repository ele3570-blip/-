"""OpenStreetMap 철도 선로(GeoJSON) → 역과 역 사이 실제 선로 모양·길이 (train/data/rail_geom.json)

사용법: python3 train/scripts/build_rail_geom.py <export.geojson>

export.geojson 은 overpass-turbo.eu 에서 아래 쿼리로 받은 파일(railway=rail 본선·지선·고속선):
  [out:json][timeout:300];
  area["ISO3166-1"="KR"][admin_level=2]->.kr;
  ( way["railway"="rail"]["usage"~"main|branch"](area.kr);
    way["railway"="rail"]["highspeed"="yes"](area.kr); );
  out geom;

방법
- 선로 조각의 꼭짓점 좌표가 같으면 같은 점으로 보고 그래프를 만든다(OSM에서 이어진 선로는 노드를 공유)
- build_train_data.py 의 LINES 에 적힌 역 순서대로, 이웃 역 사이를 선로 그래프에서 최단 경로로 찾는다
  같은 이름의 선로(예: 경부선)를 우선 쓰고, 다른 선로를 지나면 길이에 벌점(OTHER_PENALTY)
- 결과: "노선id|역A|역B" → { km, pts:[[lon,lat]…] } (점은 약 30m 간격으로 단순화)
데이터: © OpenStreetMap 기여자, ODbL
"""
import heapq, json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_train_data as B  # LINES, 좌표 처리 재사용

ROOT = B.ROOT
OUT = os.path.join(ROOT, 'data', 'rail_geom.json')
# 우리 노선 id → OSM 선로 이름(name)
OSM_NAMES = {
    'gyeongbu': ['경부선'], 'gyeongbu_hs': ['경부고속선'], 'honam_hs': ['호남고속선'], 'honam': ['호남선'],
    'gwangju': ['광주선'], 'jeolla': ['전라선'], 'janghang': ['장항선'], 'seohae': ['서해선'],
    'chungbuk': ['충북선'], 'jungang': ['중앙선'], 'daegu': ['대구선', '중앙선'], 'gangneung': ['경강선'],
    'jungbu': ['중부내륙선', '경강선'], 'gyeongbuk': ['경북선'], 'yeongdong': ['영동선'], 'taebaek': ['태백선'],
    'samcheok': ['삼척선'], 'donghae_s': ['동해선'], 'donghae_n': ['동해선'], 'bujeon': ['가야선'],
    'gyeongjeon_e': ['경전선'], 'gyeongjeon_m': ['경전선'], 'gyeongjeon_w': ['경전선'], 'namhae': ['목포보성선'],
    'gyeongui': ['경의선'], 'gyooe': ['교외선'], 'gyeongwon': ['경원선'], 'gyeongchun': ['경춘선'],
}
OTHER_PENALTY = 3.0   # 다른 이름 선로를 지날 때 길이 배율
SNAP_KM = 2.0         # 역에서 이 안의 선로 점에 붙임
SIMPLIFY_KM = 0.03
ALLOW_DETOUR = {'honam|대전|서대전'}  # 실제로 대전조차장을 돌아가는 구간


def hav(a, b):
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def simplify(pts, tol):
    """Douglas-Peucker (경위도 → 대략 km 평면)"""
    if len(pts) < 3: return pts
    kx = 111.32 * math.cos(math.radians(pts[0][1])); ky = 110.54
    P = [(p[0] * kx, p[1] * ky) for p in pts]
    keep = [False] * len(P); keep[0] = keep[-1] = True
    stack = [(0, len(P) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = P[i], P[j]
        L = math.hypot(x2 - x1, y2 - y1) or 1e-9
        best, bk = 0, -1
        for k in range(i + 1, j):
            d = abs((x2 - x1) * (y1 - P[k][1]) - (x1 - P[k][0]) * (y2 - y1)) / L
            if d > best: best, bk = d, k
        if best > tol:
            keep[bk] = True; stack += [(i, bk), (bk, j)]
    return [p for p, k in zip(pts, keep) if k]


def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    feats = json.load(open(sys.argv[1], encoding='utf-8'))['features']
    # 그래프: 점 id ← 좌표(소수 7자리)
    pid, coords = {}, []
    adj = []  # 점 → [(이웃, km, 이름)]

    def node(c):
        k = (round(c[0], 7), round(c[1], 7))
        i = pid.get(k)
        if i is None:
            i = pid[k] = len(coords); coords.append(k); adj.append([])
        return i

    for f in feats:
        if f['geometry']['type'] != 'LineString': continue
        name = f['properties'].get('name', '')
        cs = f['geometry']['coordinates']
        ids = [node(c) for c in cs]
        for a, b in zip(ids, ids[1:]):
            if a == b: continue
            d = hav(coords[a], coords[b])
            adj[a].append((b, d, name)); adj[b].append((a, d, name))
    print(f'선로 점 {len(coords):,}개', file=sys.stderr)

    # 격자로 가까운 점 찾기
    G = 0.02
    grid = {}
    for i, (x, y) in enumerate(coords):
        grid.setdefault((int(x / G), int(y / G)), []).append(i)

    def near_nodes(lon, lat, names):
        """역 근처 선로 점: 이름이 맞는 선로 위의 점을 우선"""
        out = []
        gx, gy = int(lon / G), int(lat / G)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in grid.get((gx + dx, gy + dy), []):
                    d = hav((lon, lat), coords[i])
                    if d <= SNAP_KM:
                        match = any(n in names for _, _, n in adj[i])
                        out.append((d + (0 if match else 1.0), i))
        out.sort()
        return [i for _, i in out[:30]]

    def path(src, dst, names, start, goal):
        """역 A → 역 B: 근처 선로 점들로 들어가고 나오는 A*. 역과 선로 점 사이 거리도 길이에 넣음
        반환 (점 목록, 실제 km)"""
        targets = set(dst)
        h = lambda i: hav(coords[i], goal)
        dist, real, prev = {}, {}, {}
        pq = []
        for s0 in src:
            d0 = hav(start, coords[s0])
            dist[s0] = 2 * d0; real[s0] = d0
            pq.append((dist[s0] + h(s0), 0, s0))
        heapq.heapify(pq)
        done = set()
        while pq:
            f, goal_flag, u = heapq.heappop(pq)
            if goal_flag:  # 도착 역까지 마무리한 경로가 가장 짧음
                seq = [u]
                while seq[-1] in prev: seq.append(prev[seq[-1]])
                return seq[::-1], real[u] + hav(coords[u], goal)
            if u in done: continue
            done.add(u)
            if u in targets:
                heapq.heappush(pq, (dist[u] + 2 * hav(coords[u], goal), 1, u))
            if len(done) > 400_000: break
            for v, d, n in adj[u]:
                w = d * (1 if n in names else OTHER_PENALTY)
                nd = dist[u] + w
                if nd < dist.get(v, 1e18):
                    dist[v] = nd; real[v] = real[u] + d; prev[v] = u
                    heapq.heappush(pq, (nd + h(v), 0, v))
        return None, None

    # 역 좌표(build_train_data 와 같은 방법)
    coord = B.station_coords()
    out, bad = {}, []
    for lid, lname, kind, *_rest, seq in B.LINES:
        names = OSM_NAMES.get(lid, [lname])
        ss = seq.split()
        for a, b in zip(ss, ss[1:]):
            A, Bc = coord[a], coord[b]
            src, dst = near_nodes(*A, names), near_nodes(*Bc, names)
            straight = hav(A, Bc)
            seqn, km = (path(src, dst, names, A, Bc) if src and dst else (None, None))
            key = f'{lid}|{a}|{b}'
            if not seqn or (km > straight * 2.2 + 3 and key not in ALLOW_DETOUR):
                bad.append(f'{lname} {a}-{b}: ' + ('경로 없음' if not seqn else f'{km:.0f}km (직선 {straight:.0f}km)'))
                continue
            pts = [list(coords[i]) for i in seqn]
            pts = [list(A)] + pts + [list(Bc)]
            pts = simplify(pts, SIMPLIFY_KM)
            out[key] = {'km': round(km, 2), 'pts': [[round(p[0], 5), round(p[1], 5)] for p in pts]}
    for x in bad: print('  !', x, file=sys.stderr)
    print(f'구간 {len(out)}개 성공, {len(bad)}개 실패(직선으로 그림)', file=sys.stderr)
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'→ {OUT} ({os.path.getsize(OUT):,} bytes)', file=sys.stderr)


if __name__ == '__main__':
    main()
