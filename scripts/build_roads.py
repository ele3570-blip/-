"""OpenStreetMap 한국 데이터(.osm.pbf)에서 대구 도로망을 골라 web/roads.js를 만든다.

사용법: python3 scripts/build_roads.py <south-korea.osm.pbf>

- 대상: 고속도로·간선·보조간선·집산도로(+연결로). 버스가 다니는 큰 길 위주
- 경로 찾기용 그래프로 만든다: 교차로(두 도로 이상이 만나는 점)와 도로 끝점이 '노드',
  노드 사이 도로 구간이 '엣지'. 엣지마다 모양(좌표)·길이·등급·차선 수가 있다
- 차선 수(lanes)가 없으면 도로 등급별 기본값(그리기 굵기용)
- 대구 경계 상자 안 전체를 넣되, 대구 행정동과 전혀 닿지 않는 엣지는 뺀다
"""
import json, math, os, sys
import osmium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLASSES = {  # 등급: (코드, 차선 기본값)
    'motorway': (0, 4), 'motorway_link': (0, 1),
    'trunk': (1, 4), 'trunk_link': (1, 1),
    'primary': (2, 4), 'primary_link': (2, 1),
    'secondary': (3, 2), 'secondary_link': (3, 1),
    'tertiary': (4, 2), 'tertiary_link': (4, 1),
}
BBOX = (128.30, 35.57, 128.95, 36.36)
SIMPLIFY_DEG = 0.00005  # 약 5m
NEAR_DEG = 0.01         # 대구 행정동에서 이 정도(약 1km) 안의 엣지만


def load_dongs():
    polys = []
    for f in json.load(open(os.path.join(ROOT, 'data/daegu_dong.geojson'), encoding='utf-8'))['features']:
        g = f['geometry']
        for poly in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]):
            ring = poly[0]
            xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
            polys.append((min(xs), min(ys), max(xs), max(ys), ring))
    return polys


def near_daegu(polys, x, y):
    for x0, y0, x1, y1, ring in polys:
        if x0 - NEAR_DEG <= x <= x1 + NEAR_DEG and y0 - NEAR_DEG <= y <= y1 + NEAR_DEG:
            c = False
            j = len(ring) - 1
            for i in range(len(ring)):
                xi, yi = ring[i][:2]; xj, yj = ring[j][:2]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                    c = not c
                j = i
            if c:
                return True
    return False


def simplify(pts, tol):
    if len(pts) < 3:
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


def dist_m(a, b):
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians(35.87))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def parse_lanes(v):
    try:
        return max(1, min(12, int(float(v.split(';')[0]))))
    except (ValueError, AttributeError):
        return None


class Ways(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []  # (등급, 차선, 실제태그여부, 일방, 이름, [(노드id, lon, lat)])

    def way(self, w):
        hw = w.tags.get('highway')
        if hw not in CLASSES:
            return
        try:
            pts = [(n.ref, n.lon, n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        x0, y0, x1, y1 = BBOX
        if not any(x0 <= x <= x1 and y0 <= y <= y1 for _, x, y in pts):
            return
        cls, default = CLASSES[hw]
        lanes = parse_lanes(w.tags.get('lanes'))
        oneway = w.tags.get('oneway') == 'yes' or hw.startswith('motorway')
        self.ways.append((cls, lanes or default, 1 if lanes else 0, 1 if oneway else 0, w.tags.get('name', ''), pts))


def main(src):
    h = Ways()
    h.apply_file(src, locations=True, idx='flex_mem')
    polys = load_dongs()

    # 교차로 찾기: 두 번 이상 쓰인 노드, 그리고 도로 끝점
    use = {}
    for *_, pts in h.ways:
        for k, (nid, _, _) in enumerate(pts):
            use[nid] = use.get(nid, 0) + (2 if k in (0, len(pts) - 1) else 1)
    node_idx, nodes = {}, []

    def nid_of(nid, x, y):
        if nid not in node_idx:
            node_idx[nid] = len(nodes)
            nodes.append((round(x, 5), round(y, 5)))
        return node_idx[nid]

    edges = []
    for cls, lanes, tagged, oneway, name, pts in h.ways:
        start = 0
        for k in range(1, len(pts)):
            if use[pts[k][0]] >= 2 or k == len(pts) - 1:
                seg = pts[start:k + 1]
                coords = [(x, y) for _, x, y in seg]
                # 대구 근처 엣지만
                probe = coords[:: max(1, len(coords) // 4)] + [coords[-1]]
                if any(near_daegu(polys, x, y) for x, y in probe):
                    length = sum(dist_m(coords[i], coords[i + 1]) for i in range(len(coords) - 1))
                    a = nid_of(seg[0][0], *coords[0]); b = nid_of(seg[-1][0], *coords[-1])
                    if a != b or length > 1:
                        geom = simplify(coords, SIMPLIFY_DEG)
                        flat = [v for x, y in geom[1:-1] for v in (round(x, 5), round(y, 5))]
                        edges.append([a, b, cls, lanes, tagged, oneway, round(length), flat])
                start = k

    out = {'nodes': [v for p in nodes for v in p], 'edges': edges,
           'names': sorted({w[4] for w in h.ways if w[4]})}
    path = os.path.join(ROOT, 'web/roads.js')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('// scripts/build_roads.py 로 생성됨 (© OpenStreetMap contributors, ODbL)\n')
        f.write('// nodes: [lon,lat,...]  edges: [시작노드, 끝노드, 등급(0 고속~4 집산), 차선, 차선태그있음, 일방, 길이m, 중간좌표[lon,lat,...]]\n')
        f.write('window.ROADNET = ')
        json.dump({'nodes': out['nodes'], 'edges': out['edges']}, f, separators=(',', ':'))
        f.write(';\n')
    by = {}
    for e in edges:
        by[e[2]] = by.get(e[2], 0) + 1
    print(f"노드 {len(nodes)}개, 엣지 {len(edges)}개 (등급별 {by}), 총 {sum(e[6] for e in edges) / 1000:.0f}km, "
          f"roads.js {os.path.getsize(path) // 1024}KB")


if __name__ == '__main__':
    main(sys.argv[1])
