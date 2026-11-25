'use strict';
// 대구 버스 경영 게임 프로토타입
// 수요: 실제 정류소별 하루 평균 승차(2024~2025) × 시간대 비율 × DEMAND_SCALE

const D = window.GAME_DATA;

// ───────────────────────── 밸런스 설정 ─────────────────────────
const CFG = {
  startMoney: 5_000_000,
  fare: 1_500,               // 승차 1회 요금(환승 무료)
  demandScale: 1 / 10,       // 실제 승객 10명 = 게임 승객 1명
  busSellRatio: 0.5,
  // 차종. 정원은 현대차 공식 제원의 승차정원(좌석+운전석+입석)에서 운전석을 뺀 값
  //  저상 시내버스(에어로시티 CNG) 47인승, 전기 시내버스(일렉시티) 50인승, 마을버스(카운티) 23인승
  // upgrade = 그 등급으로 올리는 비용
  // 차종별 Lv1~3. 정원은 게임용으로 20명부터 5명씩(마을 20~30, 시내 35~45, 고속 50~60)
  // upgrade = 아래 레벨에서 이 레벨로 올리는 비용. 업그레이드·매각은 차고지에서만
  busTypes: {
    town: { name: '마을버스', icon: '🚐', price: 1_800_000, w: 10, h: 8, levels: [
      { name: '마을버스',          cap: 20, speedMul: 0.95, costPerHour: 6_000,  dwellPerPax: 0.03,  comfort: 0,  upgrade: 0,         color: '#fbbf24' },
      { name: '전기 마을버스',     cap: 25, speedMul: 1.0,  costPerHour: 3_500,  dwellPerPax: 0.03,  comfort: 8,  upgrade: 2_000_000, color: '#a3e635' },
      { name: '대형 전기 마을버스', cap: 30, speedMul: 1.0,  costPerHour: 4_500,  dwellPerPax: 0.025, comfort: 10, upgrade: 2_500_000, color: '#84cc16' },
    ] },
    city: { name: '시내버스', icon: '🚌', price: 4_000_000, w: 14, h: 10, levels: [
      { name: '일반 시내버스', cap: 35, speedMul: 1.0,  costPerHour: 12_000, dwellPerPax: 0.03,  comfort: 0,  upgrade: 0,         color: '#e5e7eb' },
      { name: '저상 시내버스', cap: 40, speedMul: 1.0,  costPerHour: 12_000, dwellPerPax: 0.016, comfort: 8,  upgrade: 1_500_000, color: '#60a5fa' },
      { name: '전기 시내버스', cap: 45, speedMul: 1.05, costPerHour: 7_000,  dwellPerPax: 0.016, comfort: 15, upgrade: 4_000_000, color: '#4ade80' },
    ] },
    express: { name: '고속버스', icon: '🚍', price: 7_000_000, w: 17, h: 11, levels: [
      { name: '고속버스',          cap: 50, speedMul: 1.35, costPerHour: 15_000, dwellPerPax: 0.04, comfort: 20, upgrade: 0,         color: '#f472b6' },
      { name: '우등 고속버스',     cap: 55, speedMul: 1.35, costPerHour: 16_000, dwellPerPax: 0.04, comfort: 28, upgrade: 4_000_000, color: '#c084fc' },
      { name: '프리미엄 고속버스', cap: 60, speedMul: 1.4,  costPerHour: 17_000, dwellPerPax: 0.04, comfort: 35, upgrade: 6_000_000, color: '#fb7185' },
    ] },
  },
  stopPriceBase: 300_000, stopPricePerRider: 400, // 정류장 가격 = 기본 + 실제 하루 승차 × 단가
  // 시작할 때 주어지는 노선(중구)
  starterRoutes: [
    ['대구역', '대구콘서트하우스', '경상감영공원', '약령시', '약령시입구', '남문시장', '명덕역(6번출구)'],
    ['서문시장', '계명대학교대구동산병원', '곽병원', '약령시', '2.28기념중앙공원', '삼덕성당', '경북대학교병원'],
    ['달성공원역3번출구', '섬유회관', '곽병원', '경상감영공원', '대구역', '태평상가', '동인찜갈비골목', '중구청'],
  ],
  busSpeedKmPerMin: 0.3,     // 약 18km/h
  detour: 1.25,              // 직선거리 → 도로거리 보정
  dwellBase: 0.3, dwellPerPax: 0.03, // 정차 시간(분)
  walkKm: 0.4,               // 목적지까지 걸어갈 수 있는 거리
  minTripKm: 0.7,
  tripDecayKm: 5,
  // 출퇴근 피크: 실제 시간대 비율에 곱하는 배율. 앞뒤 30분은 서서히 올라가고 내려감
  peaks: [
    { name: '출근', icon: '🌅', from: 7 * 60, to: 9 * 60, mult: 3.2 },
    { name: '퇴근', icon: '🌆', from: 17 * 60, to: 19 * 60 + 30, mult: 2.7 },
  ],
  offPeakMult: 0.75, peakRampMin: 30,
  maxWaitMin: 40,            // 만족도 0이 되는 대기 시간
  patienceMin: 8, patienceExtraMean: 12, patienceMax: 45, // 참을성(분) = 최소 + 무작위(평균 extra)
  freqBase: 0.45, freqBonus: 0.85, freqScaleMin: 12, // 배차 간격 h분 → 수요 배율 = base + bonus·e^(-h/scale)
  holdRatio: 0.7, holdStep: 0.25, maxHoldMin: 3, // 앞차와 너무 가까우면 정류장에서 대기(배차 간격 조정)
  repStart: 1.0, repMin: 0.6, repMax: 1.4, repSpeed: 0.35, // 평판(다음 날 수요 배율)
  subsidyMinSat: 60, subsidyRatio: 0.5,
  dayStartMin: 5 * 60, dayEndMin: 23 * 60,
  startGu: '중구',
  unlockCost: { '남구': 12_000_000, '서구': 15_000_000, '동구': 30_000_000, '북구': 30_000_000,
                '수성구': 40_000_000, '달서구': 50_000_000, '달성군': 45_000_000, '군위군': 20_000_000 },
};
const PALETTE = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#eab308', '#6366f1'];

// ───────────────────────── 좌표 ─────────────────────────
const LAT0 = 35.87, LON0 = 128.6, KX = 111.32 * Math.cos(LAT0 * Math.PI / 180), KY = 110.54;
const toKm = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
const distKm = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const stops = D.stops.map(s => { const [x, y] = toKm(s.lon, s.lat); return { ...s, x, y, attract: s.on + 2 * s.off + 1 }; });
const dongs = D.dongs.map(d => {
  const rings = d.rings.map(r => r.map(([lon, lat]) => toKm(lon, lat)));
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9, cx = 0, cy = 0, n = 0;
  for (const r of rings) for (const [x, y] of r) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); cx += x; cy += y; n++; }
  return { ...d, rings, bbox: [minx, miny, maxx, maxy], cx: cx / n, cy: cy / n };
});
const guList = [...new Set(dongs.map(d => d.gu))];
const guCenter = {};
for (const g of guList) {
  const ds = dongs.filter(d => d.gu === g);
  guCenter[g] = [ds.reduce((a, d) => a + d.cx, 0) / ds.length, ds.reduce((a, d) => a + d.cy, 0) / ds.length];
}
// 도로(OpenStreetMap): 등급·차선 수별로 묶어 Path2D 하나씩 (km 좌표)
const ROAD_STYLE = [ // 등급 0 고속도로 ~ 4 집산도로. case: 테두리, fill: 속
  { name: '고속도로',      case: '#e39a45', fill: '#fcd6a4', minZ: 0 },
  { name: '도시고속·국도', case: '#d8b25a', fill: '#fbeab4', minZ: 0 },
  { name: '간선도로',      case: '#b8bfca', fill: '#ffffff', minZ: 0 },
  { name: '보조간선',      case: '#c6ccd5', fill: '#ffffff', minZ: 40 },
  { name: '집산도로',      case: '#d0d5dc', fill: '#ffffff', minZ: 90 },
];
// ── 도로망 그래프 ──
const RN = window.ROADNET || { nodes: [], edges: [] };
const rnNodes = [];
for (let k = 0; k < RN.nodes.length; k += 2) { const [x, y] = toKm(RN.nodes[k], RN.nodes[k + 1]); rnNodes.push({ x, y, adj: [] }); }
const rnEdges = RN.edges.map(([a, b, c, l, tagged, oneway, lenM, flat], id) => {
  const pts = [[rnNodes[a].x, rnNodes[a].y]];
  for (let k = 0; k < flat.length; k += 2) pts.push(toKm(flat[k], flat[k + 1]));
  pts.push([rnNodes[b].x, rnNodes[b].y]);
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  rnNodes[a].adj.push(id); rnNodes[b].adj.push(id);
  return { id, a, b, c, l, o: !!oneway, pts, cum, len: cum[cum.length - 1] }; // o: 일방통행(a→b만)
});
// 그리기: 등급·차선 수별로 묶어 Path2D 하나씩 (km 좌표)
const roadLayers = (() => {
  const m = new Map();
  for (const e of rnEdges) {
    const key = e.c * 100 + e.l;
    if (!m.has(key)) m.set(key, { c: e.c, l: e.l, path: new Path2D() });
    const P = m.get(key).path;
    e.pts.forEach(([x, y], i) => i ? P.lineTo(x, y) : P.moveTo(x, y));
  }
  return [...m.values()].sort((a, b) => (b.c - a.c) || (a.l - b.l)); // 좁은 길 먼저, 넓은 길이 위에
})();
// 정류장 → 가장 가까운 도로 위 점 (선분 격자로 찾기)
const SEG_GRID = 0.25, segGrid = new Map();
for (const e of rnEdges) for (let k = 0; k + 1 < e.pts.length; k++) {
  const [x1, y1] = e.pts[k], [x2, y2] = e.pts[k + 1];
  for (let gx = Math.floor(Math.min(x1, x2) / SEG_GRID); gx <= Math.floor(Math.max(x1, x2) / SEG_GRID); gx++)
    for (let gy = Math.floor(Math.min(y1, y2) / SEG_GRID); gy <= Math.floor(Math.max(y1, y2) / SEG_GRID); gy++) {
      const key = gx + ',' + gy;
      if (!segGrid.has(key)) segGrid.set(key, []);
      segGrid.get(key).push([e, k]);
    }
}
// 정류장 근처 도로 후보들: 가장 가까운 도로 + 그보다 50m 안쪽으로 더 먼 도로들
// (양방향 정류장을 합쳐 놓아서, 일방통행 차로가 둘로 나뉜 길이면 양쪽 차로가 모두 후보)
const snapCache = new Map();
function snapStop(s) {
  if (snapCache.has(s.id)) return snapCache.get(s.id);
  const byEdge = new Map();
  for (let rad = 1; rad <= 4 && !byEdge.size; rad++) { // 약 250m씩 넓혀가며
    const gx = Math.floor(s.x / SEG_GRID), gy = Math.floor(s.y / SEG_GRID);
    for (let i = gx - rad; i <= gx + rad; i++) for (let j = gy - rad; j <= gy + rad; j++) {
      for (const [e, k] of segGrid.get(i + ',' + j) || []) {
        const [x1, y1] = e.pts[k], [x2, y2] = e.pts[k + 1];
        const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((s.x - x1) * dx + (s.y - y1) * dy) / L2)) : 0;
        const px = x1 + dx * t, py = y1 + dy * t, d = Math.hypot(s.x - px, s.y - py);
        const cur = byEdge.get(e.id);
        if (!cur || d < cur.d) byEdge.set(e.id, { e, d, x: px, y: py, along: e.cum[k] + Math.sqrt(L2) * t, tx: dx / (Math.sqrt(L2) || 1), ty: dy / (Math.sqrt(L2) || 1) });
      }
    }
  }
  const all = [...byEdge.values()].sort((a, b) => a.d - b.d);
  const cands = all.length ? all.filter(c => c.d <= all[0].d + 0.05).slice(0, 6) : [];
  snapCache.set(s.id, cands);
  return cands;
}
// 도로 구간 e에서 along 위치 from → to 사이 점들 (방향 상관없이)
function edgePart(e, from, to) {
  const out = [];
  if (from <= to) { for (let k = 0; k < e.pts.length; k++) if (e.cum[k] > from && e.cum[k] < to) out.push(e.pts[k]); }
  else { for (let k = e.pts.length - 1; k >= 0; k--) if (e.cum[k] < from && e.cum[k] > to) out.push(e.pts[k]); }
  return out;
}
// pts의 모든 점이 line에서 tol(km) 안쪽인지
function nearPolyline(pts, line, tol) {
  if (!line) return false;
  return pts.every(([px, py]) => {
    for (let k = 1; k < line.length; k++) {
      const [x1, y1] = line[k - 1], [x2, y2] = line[k], dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L2)) : 0;
      if (Math.hypot(px - x1 - dx * t, py - y1 - dy * t) <= tol) return true;
    }
    return false;
  });
}
function polyLen(pts) { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return L; }
// 정류장 사이 도로를 따라가는 최단 경로 → { pts, km }. 일방통행을 지키므로 방향마다 다를 수 있음
const pathCache = new Map();
const heapPush = (h, item) => { h.push(item); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } };
const heapPop = h => { const top = h[0], last = h.pop(); if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } } return top; };
function roadPath(id1, id2) {
  const key = id1 + '>' + id2;
  if (pathCache.has(key)) return pathCache.get(key);
  const s1 = stops[id1], s2 = stops[id2];
  let res = { pts: [[s1.x, s1.y], [s2.x, s2.y]], km: distKm(s1, s2) * CFG.detour, road: false };
  const As = snapStop(s1), Bs = snapStop(s2);
  if (As.length && Bs.length) {
    let best = null; // { cost, pts }
    // 1) 같은 도로 구간 위에서 바로 가는 경우
    for (const A of As) for (const B of Bs) {
      if (A.e !== B.e || (A.e.o && B.along < A.along)) continue;
      const cost = A.d + B.d + Math.abs(B.along - A.along);
      if (!best || cost < best.cost) best = { cost, pts: [[A.x, A.y], ...edgePart(A.e, A.along, B.along), [B.x, B.y]] };
    }
    // 2) 다익스트라: 출발 후보 도로의 끝 노드들에서 시작 (일방통행이면 진행 방향 끝만)
    const dist = new Map(), prev = new Map(), heap = [];
    const relax = (n, d, via) => { if (d < (dist.get(n) ?? Infinity)) { dist.set(n, d); prev.set(n, via); heapPush(heap, [d, n]); } };
    for (const A of As) {
      if (!A.e.o) relax(A.e.a, A.d + A.along, { src: A, end: 'a' });
      relax(A.e.b, A.d + A.e.len - A.along, { src: A, end: 'b' });
    }
    const goals = new Set(); for (const B of Bs) { goals.add(B.e.a); if (!B.e.o) goals.add(B.e.b); }
    const limit = distKm(s1, s2) * 4 + 3;
    let left = goals.size;
    while (heap.length && left > 0) {
      const [d, n] = heapPop(heap);
      if (d > (dist.get(n) ?? Infinity)) continue;
      if (d > limit) break;
      if (goals.has(n)) left--;
      for (const eid of rnNodes[n].adj) {
        const e = rnEdges[eid];
        if (e.o && e.a !== n) continue; // 일방통행 역방향 금지
        relax(e.a === n ? e.b : e.a, d + e.len, { eid });
      }
    }
    for (const B of Bs) {
      const ends = B.e.o ? [['a', B.along]] : [['a', B.along], ['b', B.e.len - B.along]];
      for (const [end, extra] of ends) {
        const node = end === 'a' ? B.e.a : B.e.b, d = dist.get(node);
        if (d == null) continue;
        const cost = d + extra + B.d;
        if (best && cost >= best.cost) continue;
        // 경로 복원
        const edges = []; let n = node, via = prev.get(n);
        while (via && via.eid != null) { const e = rnEdges[via.eid]; edges.unshift([e, e.b === n]); n = e.b === n ? e.a : e.b; via = prev.get(n); }
        const A = via.src;
        const pts = [[A.x, A.y], ...edgePart(A.e, A.along, via.end === 'a' ? 0 : A.e.len)];
        pts.push([rnNodes[n].x, rnNodes[n].y]);
        for (const [e, fwd] of edges) pts.push(...(fwd ? e.pts : e.pts.slice().reverse()).slice(1));
        pts.push(...edgePart(B.e, end === 'a' ? 0 : B.e.len, B.along), [B.x, B.y]);
        best = { cost, pts };
      }
    }
    if (best) {
      const pts = [[s1.x, s1.y], ...best.pts, [s2.x, s2.y]];
      const km = polyLen(pts);
      if (km < distKm(s1, s2) * 4 + 1) res = { pts, km, road: true }; // 너무 돌아가면 직선으로
    }
  }
  pathCache.set(key, res);
  return res;
}
// 경로 위 거리 d(km) 지점의 좌표와 진행 방향
function pointAlongDir(pts, d) {
  for (let k = 1; k < pts.length; k++) {
    const dx = pts[k][0] - pts[k - 1][0], dy = pts[k][1] - pts[k - 1][1], L = Math.hypot(dx, dy);
    if (d <= L || k === pts.length - 1) {
      const f = L ? Math.max(0, Math.min(1, d / L)) : 0;
      return [pts[k - 1][0] + dx * f, pts[k - 1][1] + dy * f, dx, dy];
    }
    d -= L;
  }
  return [pts[0][0], pts[0][1], 1, 0];
}
function pointAlong(pts, d) {
  for (let k = 1; k < pts.length; k++) {
    const L = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (d <= L || k === pts.length - 1) {
      const f = L ? Math.max(0, Math.min(1, d / L)) : 0;
      return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f];
    }
    d -= L;
  }
  return pts[0];
}

// 정류장을 도로 가운데로 옮긴다. 상·하행이 따로 그려진 큰길(마주 보는 일방통행 두 줄)이면 그 사이 가운데
for (const s of stops) {
  const cs = snapStop(s);
  if (!cs.length || cs[0].d > 0.08) continue;
  const a = cs[0];
  const pair = a.e.o && cs.find(c => c !== a && c.e.o && c.tx * a.tx + c.ty * a.ty < -0.7 && Math.hypot(c.x - a.x, c.y - a.y) < 0.045);
  s.x = pair ? (a.x + pair.x) / 2 : a.x;
  s.y = pair ? (a.y + pair.y) / 2 : a.y;
}
snapCache.clear();

const dongDemand = {};
for (const s of stops) dongDemand[s.gu + ' ' + s.dong] = (dongDemand[s.gu + ' ' + s.dong] || 0) + s.on;

// 근접 탐색용 격자
const GRID = 0.5;
const grid = new Map();
for (const s of stops) {
  const k = Math.floor(s.x / GRID) + ',' + Math.floor(s.y / GRID);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(s);
}
function stopsNear(x, y, r) {
  const out = [], gx = Math.floor(x / GRID), gy = Math.floor(y / GRID), n = Math.ceil(r / GRID);
  for (let i = gx - n; i <= gx + n; i++) for (let j = gy - n; j <= gy + n; j++) {
    const c = grid.get(i + ',' + j);
    if (c) for (const s of c) if (Math.hypot(s.x - x, s.y - y) <= r) out.push(s);
  }
  return out;
}

// ───────────────────────── 게임 상태 ─────────────────────────
const G = {
  money: CFG.startMoney, day: 1, t: CFG.dayStartMin, speed: 1, paused: false,
  unlocked: new Set([CFG.startGu]),
  routes: [], buses: [], nextRouteNo: 1,
  waiting: new Map(), // stopId → [passenger]
  today: null, satHistory: [], rep: 1.0,
  owned: new Set(), // 보유한 정류장
  depot: [], nextBusId: 1, // 차고지에 있는 버스
};
function newToday() { return { pax: 0, revenue: 0, cost: 0, potential: 0, spawned: 0, satSum: 0, satN: 0, gaveUp: 0, busBought: 0, leftBehind: 0, peakPax: 0 }; }
G.today = newToday();

const isOpen = s => G.unlocked.has(s.gu);
let openStops = stops.filter(isOpen);

// ───────────────────────── 네트워크 계산 ─────────────────────────
let servedBy = new Map();   // stopId → [route]
let destCache = new Map();  // originId → {list, cum}

let covered = new Set(); // 노선에서 걸어갈 수 있는 정류장
function rebuildNetwork() {
  servedBy = new Map();
  destCache = new Map();
  for (const r of G.routes) {
    r.idxOf = new Map(r.stops.map((id, i) => [id, i]));
    // 정류장 사이: 도로를 따라가는 경로와 길이
    // geom[i]/segLen[i]: 정류장 i → i+1, geomB[i]/segLenB[i]: i+1 → i (왕복 노선의 돌아오는 길. 일방통행이면 다를 수 있음)
    r.geom = []; r.geomB = []; r.segLenB = [];
    r.segLen = r.stops.map((id, i) => {
      const j = r.loop ? (i + 1) % r.stops.length : i + 1;
      if (j >= r.stops.length) { r.geom.push(null); r.geomB.push(null); r.segLenB.push(0); return 0; }
      const P = roadPath(id, r.stops[j]);
      r.geom.push(P.pts);
      if (!r.loop) { const Q = roadPath(r.stops[j], id); r.geomB.push(Q.pts); r.segLenB.push(Q.km); }
      return P.km;
    });
    // 돌아오는 길이 가는 길과 60m 안쪽으로 나란하면(상·하행이 두 줄로 그려진 큰길) 그리지 않고 한 줄로 보이게
    r.drawB = r.geomB.map((Q, k) => !!Q && !nearPolyline(Q, r.geom[k], 0.06));
    // near: 목적지 정류장 → 내릴 정류장 인덱스 (걸어서 갈 수 있는 거리 안에서 가장 가까운 곳)
    r.near = new Map();
    r.stops.forEach((id, i) => {
      const s = stops[id];
      for (const t of stopsNear(s.x, s.y, CFG.walkKm)) {
        if (!isOpen(t)) continue;
        const d = distKm(s, t), cur = r.near.get(t.id);
        if (!cur || d < cur.d) r.near.set(t.id, { i, d });
      }
    });
    for (const id of r.stops) {
      if (!servedBy.has(id)) servedBy.set(id, []);
      servedBy.get(id).push(r);
    }
  }
  covered = new Set();
  for (const r of G.routes) for (const id of r.near.keys()) covered.add(id);
  assignRouteSlots();
  // 승객 계획 다시 짜기(노선이 바뀌었을 수 있음)
  for (const [sid, q] of G.waiting) {
    const keep = [];
    for (const p of q) { p.options = planFrom(sid, p.dest); if (p.options.length) keep.push(p); }
    G.waiting.set(sid, keep);
  }
  for (const b of G.buses) b.pax = b.pax.filter(p => G.routes.includes(b.route));
}

function rebuildDestinations() { openStops = stops.filter(isOpen); destCache = new Map(); }

function pickDestination(o) {
  let c = destCache.get(o.id);
  if (!c) {
    const list = [], cum = [];
    let acc = 0;
    for (const id of covered) {
      const t = stops[id];
      const d = distKm(o, t);
      if (d < CFG.minTripKm) continue;
      acc += t.attract * Math.exp(-d / CFG.tripDecayKm);
      list.push(t.id); cum.push(acc);
    }
    c = { list, cum, total: acc };
    destCache.set(o.id, c);
  }
  if (!c.total) return null;
  const x = Math.random() * c.total;
  let lo = 0, hi = c.cum.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (c.cum[m] < x) lo = m + 1; else hi = m; }
  return c.list[lo];
}

// 출발 정류장에서 목적지까지 가는 방법: [{route, alight, next?}] (직행 우선, 없으면 1회 환승)
function planFrom(oid, dest) {
  const rs = servedBy.get(oid) || [];
  const direct = [];
  for (const r of rs) { const n = r.near.get(dest); if (n && n.i !== r.idxOf.get(oid)) direct.push({ route: r, alight: n.i, alightId: r.stops[n.i] }); }
  if (direct.length) return direct;
  const via = [];
  for (const r1 of rs) {
    for (const r2 of G.routes) {
      if (r2 === r1) continue;
      const n2 = r2.near.get(dest);
      if (!n2) continue;
      let best = null;
      for (const sid of r1.stops) {
        if (sid === oid || !r2.idxOf.has(sid)) continue;
        const i2 = r2.idxOf.get(sid);
        if (i2 === n2.i) continue;
        const cost = Math.abs(r1.idxOf.get(sid) - r1.idxOf.get(oid)) + Math.abs(n2.i - i2);
        if (!best || cost < best.cost) best = { cost, sid };
      }
      if (best) via.push({ route: r1, alight: r1.idxOf.get(best.sid), alightId: best.sid, next: { route: r2, alight: n2.i, alightId: r2.stops[n2.i] } });
    }
  }
  return via;
}

// ───────────────────────── 시뮬레이션 ─────────────────────────
const spawnAcc = new Map();

// 지금 시각의 피크 배율과 피크 정보
function peakAt(t) {
  let best = { mult: CFG.offPeakMult, peak: null };
  for (const pk of CFG.peaks) {
    const R = CFG.peakRampMin;
    let f = 0;
    if (t >= pk.from && t <= pk.to) f = 1;
    else if (t > pk.from - R && t < pk.from) f = (t - (pk.from - R)) / R;
    else if (t > pk.to && t < pk.to + R) f = 1 - (t - pk.to) / R;
    const m = CFG.offPeakMult + (pk.mult - CFG.offPeakMult) * f;
    if (m > best.mult) best = { mult: m, peak: f >= 1 ? pk : null };
  }
  return best;
}
function hourShare(t) {
  const h = Math.floor(t / 60) - D.hourStart;
  return D.hourly[Math.max(0, Math.min(D.hourly.length - 1, h))] || 0;
}

// 노선의 방향별 배차 간격(분). 왕복 노선은 한 방향 기준
function headway(r) {
  const n = G.buses.filter(b => b.route === r).length;
  if (!n) return Infinity;
  const km = r.segLen.reduce((a, b) => a + b, 0) + (r.loop ? 0 : r.segLenB.reduce((a, b) => a + b, 0));
  const cycle = km / CFG.busSpeedKmPerMin + r.stops.length * (r.loop ? 1 : 2) * (CFG.dwellBase + 0.1);
  return cycle / n;
}
// 정류장 수요 배율: 지나는 노선들의 배차가 잦을수록 높음
function stopFreqMult(sid) {
  const rs = servedBy.get(sid);
  if (!rs) return 0;
  let f = 0;
  for (const r of rs) { const h = headway(r); if (h < Infinity) f += 1 / h; }
  if (!f) return 0;
  return CFG.freqBase + CFG.freqBonus * Math.exp(-(1 / f) / CFG.freqScaleMin);
}
function patience() {
  const x = CFG.patienceMin - Math.log(1 - Math.random()) * CFG.patienceExtraMean;
  return Math.min(CFG.patienceMax, x);
}

function spawn(dt) {
  const share = hourShare(G.t) * peakAt(G.t).mult;
  const mult = new Map();
  for (const sid of servedBy.keys()) mult.set(sid, stopFreqMult(sid) * G.rep);
  for (const s of openStops) {
    const base = s.on * CFG.demandScale * share / 60 * dt; // 이번 프레임 기대 승객 수(기준)
    G.today.potential += base;
    if (!servedBy.has(s.id)) continue;
    const rate = base * mult.get(s.id);
    let a = (spawnAcc.get(s.id) || Math.random()) + rate;
    while (a >= 1) {
      a -= 1;
      const dest = pickDestination(s);
      if (dest == null) continue;
      const options = planFrom(s.id, dest);
      if (!options.length) continue; // 연결 안 된 목적지 → 놓친 수요
      G.today.spawned++;
      if (!G.waiting.has(s.id)) G.waiting.set(s.id, []);
      G.waiting.get(s.id).push({ dest, options, since: G.t, start: G.t, paid: false, patience: patience() });
    }
    spawnAcc.set(s.id, a);
  }
}

function busNextIndex(b) {
  const n = b.route.stops.length;
  if (b.route.loop) return { j: (b.i + 1) % n, dir: 1 };
  let dir = b.dir;
  if (b.i + dir < 0 || b.i + dir >= n) dir = -dir;
  return { j: b.i + dir, dir };
}

function heading(b, from, to) {
  if (b.route.loop) return true;
  const { dir } = busNextIndex(b);
  return (to - from) * dir > 0;
}

function recordSat(waitMin, comfort = 0) {
  const s = Math.min(100, comfort + (waitMin <= 8 ? 100 : Math.max(0, 100 - (waitMin - 8) * (100 / (CFG.maxWaitMin - 8)))));
  G.today.satSum += s; G.today.satN++;
}

function arrive(b) {
  const sid = b.route.stops[b.i];
  let moved = 0;
  b.held = 0;
  // 하차
  const stay = [];
  for (const p of b.pax) {
    if (p.plan.alight !== b.i) { stay.push(p); continue; }
    moved++;
    if (p.plan.next) {
      const r2 = p.plan.next.route;
      const ai = G.routes.includes(r2) ? r2.idxOf.get(p.plan.next.alightId) : undefined;
      p.options = ai !== undefined && r2.idxOf.has(sid) ? [{ route: r2, alight: ai, alightId: p.plan.next.alightId }] : planFrom(sid, p.dest);
      p.since = G.t;
      if (!p.options.length) continue;
      if (!G.waiting.has(sid)) G.waiting.set(sid, []);
      G.waiting.get(sid).push(p);
    } else {
      G.today.pax++;
    }
  }
  b.pax = stay;
  // 승차
  const q = G.waiting.get(sid);
  if (q && q.length) {
    const left = [];
    for (const p of q) {
      if (b.pax.length >= busTier(b).cap) {
        // 만차: 이 버스를 타려던 승객은 못 타고 남음
        if (!p.leftBehind && p.options.some(o => o.route === b.route && heading(b, b.i, o.alight))) { p.leftBehind = true; G.today.leftBehind++; b.route.leftToday = (b.route.leftToday || 0) + 1; }
        left.push(p); continue;
      }
      const opt = p.options.find(o => o.route === b.route && heading(b, b.i, o.alight));
      if (!opt) { left.push(p); continue; }
      p.plan = opt;
      if (!p.paid) { p.paid = true; G.money += CFG.fare; G.today.revenue += CFG.fare; recordSat(G.t - p.start, busTier(b).comfort); }
      b.pax.push(p);
      moved++;
    }
    G.waiting.set(sid, left);
  }
  b.dwell = CFG.dwellBase + moved * busTier(b).dwellPerPax;
}

function shouldHold(b) {
  if ((b.held || 0) >= CFG.maxHoldMin) return false;
  const peers = G.buses.filter(o => o.route === b.route);
  if (peers.length < 2) return false;
  const ci = cycleInfo(b.route), my = busCyclePos(b, ci);
  let ahead = Infinity;
  for (const o of peers) {
    if (o === b) continue;
    const g = ((busCyclePos(o, ci) - my) % ci.C + ci.C) % ci.C;
    if (g < ahead) ahead = g;
  }
  return ahead < CFG.holdRatio * ci.C / peers.length;
}

function stepBuses(dt) {
  for (const b of G.buses) {
    let rem = dt;
    while (rem > 0) {
      if (b.dwell > 0) { const u = Math.min(b.dwell, rem); b.dwell -= u; rem -= u; continue; }
      if (b.d === 0 && shouldHold(b)) { b.dwell = CFG.holdStep; b.held = (b.held || 0) + CFG.holdStep; continue; }
      const { j, dir } = busNextIndex(b);
      const len = segInfo(b.route, b.i, j).len;
      const sp = CFG.busSpeedKmPerMin * busTier(b).speedMul;
      const need = (len - b.d) / sp;
      if (need > rem) { b.d += rem * sp; rem = 0; }
      else { rem -= need; b.d = 0; b.i = j; b.dir = dir; arrive(b); }
    }
  }
}

function giveUps() {
  for (const [sid, q] of G.waiting) {
    if (!q.length) continue;
    const keep = q.filter(p => G.t - p.since <= p.patience);
    const n = q.length - keep.length;
    if (n) { G.today.gaveUp += n; G.today.satN += n; } // 포기 = 만족도 0
    G.waiting.set(sid, keep);
  }
}

function tick(dtMin) {
  let perHour = 0; for (const b of G.buses) perHour += busTier(b).costPerHour;
  const opCost = perHour / 60 * dtMin;
  G.money -= opCost; G.today.cost += opCost;
  spawn(dtMin);
  stepBuses(dtMin);
  giveUps();
  G.t += dtMin;
  if (G.t >= CFG.dayEndMin) endDay();
}

function satPct() { return G.today.satN ? G.today.satSum / G.today.satN : null; }

function endDay() {
  G.paused = true;
  const T = G.today;
  const sat = satPct();
  const profit = T.revenue - T.cost;
  let subsidy = 0;
  if (profit < 0 && sat != null && sat >= CFG.subsidyMinSat) subsidy = Math.round(-profit * CFG.subsidyRatio);
  G.money += subsidy;
  const cover = T.potential ? T.pax / T.potential * 100 : 0;
  const repBefore = G.rep;
  if (sat != null) {
    const target = CFG.repMin + (CFG.repMax - CFG.repMin) * (sat / 100);
    G.rep = Math.max(CFG.repMin, Math.min(CFG.repMax, G.rep + (target - G.rep) * CFG.repSpeed));
  }
  const repDiff = (G.rep - repBefore) * 100;
  showModal(`
    <h2 style="margin:0">${G.day}일차 결산</h2>
    <table>
      <tr><td>수송 승객</td><td>${fmt(T.pax)}명</td></tr>
      <tr><td>포기한 승객</td><td>${fmt(T.gaveUp)}명</td></tr>
      <tr><td>만차로 못 탄 승객</td><td class="${T.leftBehind ? 'neg' : ''}">${fmt(T.leftBehind)}명</td></tr>
      <tr><td>수요 충족률</td><td>${cover.toFixed(1)}%</td></tr>
      <tr><td>만족도</td><td>${sat == null ? '-' : sat.toFixed(0) + '%'}</td></tr>
      <tr><td>평판 (내일 수요)</td><td>${(G.rep * 100).toFixed(0)}% <span class="${repDiff >= 0 ? 'pos' : 'neg'}">(${repDiff >= 0 ? '+' : ''}${repDiff.toFixed(1)})</span></td></tr>
      <tr><td colspan=2><hr style="border-color:#333"></td></tr>
      <tr><td>요금 수입</td><td class="pos">+${won(T.revenue)}</td></tr>
      <tr><td>운영비 (${G.buses.length}대)</td><td class="neg">-${won(T.cost)}</td></tr>
      <tr><td>준공영제 보조금</td><td class="pos">+${won(subsidy)}</td></tr>
      <tr><td><b>순이익</b></td><td class="${profit + subsidy >= 0 ? 'pos' : 'neg'}"><b>${won(profit + subsidy)}</b></td></tr>
      <tr><td>보유 자금</td><td>${won(G.money)}</td></tr>
    </table>
    ${T.leftBehind > 30 ? `<p class="muted">출퇴근 피크에 만차로 못 탄 승객이 많았습니다. 붐비는 노선에 버스를 더 넣거나 큰 버스로 업그레이드하세요.</p>` : ''}
    ${profit < 0 && !subsidy ? `<p class="muted">적자인데 만족도가 ${CFG.subsidyMinSat}% 미만이라 보조금을 받지 못했습니다.</p>` : ''}
    <button class="primary" id="nextDay" style="width:100%">${G.day + 1}일차 시작</button>`);
  document.getElementById('nextDay').onclick = () => {
    hideModal();
    G.day++; G.t = CFG.dayStartMin; G.today = newToday();
    G.waiting = new Map(); spawnAcc.clear();
    for (const b of G.buses) b.pax = [];
    for (const r of G.routes) r.leftToday = 0;
    G.paused = false; setSpeedUI();
    save();
  };
}

// ───────────────────────── 노선/버스 조작 ─────────────────────────
// 버스: { id, type, lvl } — 차고지(G.depot)에 있거나, 노선에서 운행 중(G.buses, route·위치 등 포함)
function addRoute(stopIds, loop) {
  const used = new Set(G.routes.map(r => r.color));
  const color = PALETTE.find(c => !used.has(c)) || PALETTE[G.routes.length % PALETTE.length];
  const r = { no: G.nextRouteNo++, color, stops: stopIds, loop };
  G.routes.push(r);
  rebuildNetwork();
  return r;
}

// 흰 바탕에서 잘 안 보이는 연한 등급 색은 진하게
const ink = c => ({ '#e5e7eb': '#6b7280', '#fbbf24': '#d97706', '#a3e635': '#65a30d' })[c] || c;
const busType = b => CFG.busTypes[b.type];
const busTier = b => busType(b).levels[b.lvl];
const busLabel = b => `${busType(b).icon} ${b.id}호 ${busTier(b).name}`;
function busValue(b) { // 구입가 + 업그레이드 비용 합
  let v = busType(b).price;
  for (let l = 1; l <= b.lvl; l++) v += busType(b).levels[l].upgrade;
  return v;
}
const sellValue = b => Math.round(busValue(b) * CFG.busSellRatio);

function buyBus(type, free = false) {
  const T = CFG.busTypes[type];
  if (!free) {
    if (G.money < T.price) { toast('자금이 부족합니다'); return null; }
    G.money -= T.price; G.today.busBought++;
  }
  const b = { id: G.nextBusId++, type, lvl: 0 };
  G.depot.push(b);
  if (!free) { toast(`${T.name}를 구입했습니다 (차고지)`, '#15803d'); renderSide(); save(); }
  return b;
}
function upgradeBus(b) {
  if (!G.depot.includes(b)) { toast('업그레이드는 차고지에서만 할 수 있습니다'); return; }
  const next = busType(b).levels[b.lvl + 1];
  if (!next) return;
  if (G.money < next.upgrade) { toast('자금이 부족합니다'); return; }
  G.money -= next.upgrade;
  b.lvl += 1;
  toast(`${b.id}호를 ${next.name}로 업그레이드했습니다`, '#15803d');
  renderSide(); save();
}
function sellBus(b) {
  const k = G.depot.indexOf(b);
  if (k < 0) return;
  G.depot.splice(k, 1);
  G.money += sellValue(b);
  toast(`${b.id}호를 ${won(sellValue(b))}에 매각했습니다`, '#15803d');
  renderSide(); save();
}
// 차고지 → 노선
function dispatch(b, r, quiet = false) {
  const k = G.depot.indexOf(b);
  if (k < 0 || !G.routes.includes(r)) return;
  G.depot.splice(k, 1);
  const pos = placeBus(r);
  G.buses.push(Object.assign(b, { route: r, i: pos.i, dir: pos.dir, d: 0, dwell: 0, pax: [], held: 0 }));
  if (!quiet) { renderSide(); save(); }
}
// 노선 → 차고지 (타고 있던 승객은 현재 정류장에 내려 다시 기다림)
function recall(b, quiet = false) {
  const k = G.buses.indexOf(b);
  if (k < 0) return;
  const r = b.route, sid = r.stops[b.i];
  if (!G.waiting.has(sid)) G.waiting.set(sid, []);
  for (const p of b.pax) { p.options = planFrom(sid, p.dest); p.since = G.t; if (p.options.length) G.waiting.get(sid).push(p); }
  G.buses.splice(k, 1);
  G.depot.push({ id: b.id, type: b.type, lvl: b.lvl });
  if (!quiet) { renderSide(); save(); }
}

function deleteRoute(r) {
  for (const b of G.buses.filter(b => b.route === r)) recall(b, true);
  G.routes = G.routes.filter(x => x !== r);
  rebuildNetwork();
  renderSide();
}

function stopPrice(s) { return Math.round((CFG.stopPriceBase + s.on * CFG.stopPricePerRider) / 100_000) * 100_000; }
function buyStop(s) {
  if (G.owned.has(s.id)) return;
  if (!isOpen(s)) { toast(`${s.gu}를 먼저 개방하세요`); return; }
  const c = stopPrice(s);
  if (G.money < c) { toast('자금이 부족합니다'); return; }
  G.money -= c;
  G.owned.add(s.id);
  toast(`${s.name} 정류장을 구입했습니다`, '#15803d');
  renderSide(); save();
}

// 노선 한 바퀴 위에서 버스 위치(km). 왕복 노선은 갔다 오는 길이 전체가 한 바퀴
// 정류장 i에서 j로 갈 때의 경로와 길이
function segInfo(r, i, j) {
  if (r.loop || j > i) return { pts: r.geom[i], len: r.segLen[i] };
  return { pts: r.geomB[j], len: r.segLenB[j] };
}
function cycleInfo(r) {
  const n = r.stops.length, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + r.segLen[i - 1]);
  const L = r.loop ? cum[n - 1] + r.segLen[n - 1] : cum[n - 1];
  if (r.loop) return { cum, L, C: L };
  // bcum[i]: 끝 정류장에서 돌아와 i까지 온 거리
  const bcum = new Array(n).fill(0);
  for (let i = n - 2; i >= 0; i--) bcum[i] = bcum[i + 1] + r.segLenB[i];
  return { cum, bcum, L, C: L + bcum[0] };
}
function busCyclePos(b, ci) {
  if (b.route.loop) return ci.cum[b.i] + b.d;
  const { dir } = busNextIndex(b);
  return dir > 0 ? ci.cum[b.i] + b.d : ci.L + ci.bcum[b.i] + b.d;
}
// 새 버스를 기존 버스 사이 가장 큰 빈틈의 가운데 정류장에 둔다
function placeBus(r) {
  const ci = cycleInfo(r), n = r.stops.length;
  const slots = [];
  for (let i = 0; i < (r.loop ? n : n - 1); i++) slots.push({ i, dir: 1, p: ci.cum[i] });
  if (!r.loop) for (let i = n - 1; i >= 1; i--) slots.push({ i, dir: -1, p: ci.L + ci.bcum[i] });
  const pos = G.buses.filter(b => b.route === r).map(b => busCyclePos(b, ci) % ci.C).sort((a, b) => a - b);
  let target = 0;
  if (pos.length) {
    let gap = -1;
    pos.forEach((p, k) => {
      const q = k + 1 < pos.length ? pos[k + 1] : pos[0] + ci.C;
      if (q - p > gap) { gap = q - p; target = (p + gap / 2) % ci.C; }
    });
  }
  const cd = p => { const x = Math.abs(p - target) % ci.C; return Math.min(x, ci.C - x); };
  const best = slots.reduce((a, b) => cd(b.p) < cd(a.p) ? b : a);
  return { i: best.i, dir: best.dir };
}

function askDelete(r) {
  const wasPaused = G.paused;
  G.paused = true; setSpeedUI();
  const n = G.buses.filter(b => b.route === r).length;
  showModal(`<h3 style="margin:0 0 10px;text-transform:none;font-size:17px;color:#e8eaed">${r.no}번 노선을 삭제할까요?</h3>
    <p class="muted">운행 중인 버스 ${n}대는 차고지로 돌아갑니다. 정류장은 계속 보유합니다.</p>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button id="delNo">취소</button><button class="primary" id="delYes" style="background:#b91c1c;border-color:#b91c1c">삭제</button></div>`);
  const close = () => { hideModal(); G.paused = wasPaused; setSpeedUI(); };
  $('delNo').onclick = close;
  $('delYes').onclick = () => { deleteRoute(r); if (selected && selected.r === r) selected = null; close(); save(); };
}

function unlock(gu) {
  const c = CFG.unlockCost[gu];
  if (G.money < c) { toast('자금이 부족합니다'); return; }
  G.money -= c;
  G.unlocked.add(gu);
  rebuildDestinations(); rebuildNetwork();
  renderSide();
  toast(`${gu} 개방!`, '#15803d');
  save();
}

// ───────────────────────── 저장 ─────────────────────────
const SAVE_KEY = 'daegu-bus-save-v5'; // v5: 작은 길 정류장 제외로 정류장 번호가 바뀜
function save() {
  const bus = b => ({ id: b.id, type: b.type, lvl: b.lvl });
  const s = { rep: G.rep, money: G.money, day: G.day, unlocked: [...G.unlocked], nextRouteNo: G.nextRouteNo, nextBusId: G.nextBusId,
    owned: [...G.owned], depot: G.depot.map(bus),
    routes: G.routes.map(r => ({ no: r.no, color: r.color, stops: r.stops, loop: r.loop, buses: G.buses.filter(b => b.route === r).map(bus) })) };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* 저장 불가 환경 */ }
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    G.rep = s.rep ?? CFG.repStart; G.money = s.money; G.day = s.day; G.unlocked = new Set(s.unlocked);
    G.nextRouteNo = s.nextRouteNo; G.nextBusId = s.nextBusId || 1;
    G.owned = new Set(s.owned || []);
    G.depot = (s.depot || []).map(b => ({ ...b }));
    rebuildDestinations();
    const pending = [];
    for (const rs of s.routes) {
      const r = { no: rs.no, color: rs.color, stops: rs.stops, loop: rs.loop };
      G.routes.push(r);
      pending.push([r, rs.buses || []]);
    }
    rebuildNetwork();
    for (const [r, bs] of pending) for (const b of bs) { const o = { ...b }; G.depot.push(o); dispatch(o, r, true); }
    return true;
  } catch (e) { return false; }
}

// ───────────────────────── 화면 ─────────────────────────
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const cam = { x: 0, y: 0, z: 120 }; // z = px per km
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1;
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = W * DPR; cv.height = H * DPR;
}
const sx = x => (x - cam.x) * cam.z + W / 2;
const sy = y => (y - cam.y) * cam.z + H / 2;
const wx = px => (px - W / 2) / cam.z + cam.x;
const wy = py => (py - H / 2) / cam.z + cam.y;

function fitGu(g) {
  const ds = dongs.filter(d => d.gu === g);
  const minx = Math.min(...ds.map(d => d.bbox[0])), maxx = Math.max(...ds.map(d => d.bbox[2]));
  const miny = Math.min(...ds.map(d => d.bbox[1])), maxy = Math.max(...ds.map(d => d.bbox[3]));
  cam.x = (minx + maxx) / 2; cam.y = (miny + maxy) / 2;
  cam.z = Math.min(W / (maxx - minx), H / (maxy - miny)) * 0.85;
}

let hoverStop = null, selected = null, drawing = null, mouse = { x: 0, y: 0 };

// 버스 위치 [x, y, 진행방향 dx, dy, 돌아오는 길인지]
function busPos(b) {
  const r = b.route, a = stops[r.stops[b.i]];
  const { j } = busNextIndex(b);
  const { pts, len } = segInfo(r, b.i, j);
  if (!pts) return [a.x, a.y, 1, 0, false];
  const back = !r.loop && j < b.i;
  return [...pointAlongDir(pts, Math.min(len, b.d) * (polyLenCached(pts) / (len || 1))), back];
}
function polyLenCached(pts) { return pts._len ?? (pts._len = polyLen(pts)); }

// 정류장 순서대로 도로 경로를 이어 현재 패스로 만든다(그리기 미리 보기용)
function tracePath(ids, loop) {
  ctx.beginPath();
  if (!ids.length) return;
  ctx.moveTo(sx(stops[ids[0]].x), sy(stops[ids[0]].y));
  const n = ids.length, last = loop ? n : n - 1;
  for (let k = 0; k < last; k++) for (const [x, y] of roadPath(ids[k], ids[(k + 1) % n]).pts) ctx.lineTo(sx(x), sy(y));
}

// ── 겹치는 노선 나란히 그리기 ──
// 노선마다 '차선 번호'를 정한다: 같은 도로 점을 공유하는 노선끼리는 서로 다른 번호
function assignRouteSlots() {
  const keyOf = ([x, y]) => Math.round(x * 2000) + ',' + Math.round(y * 2000); // 0.5m 격자
  const sets = G.routes.map(r => {
    const set = new Set();
    for (const g of [...r.geom, ...(r.geomB || [])]) if (g) for (const p of g) set.add(keyOf(p));
    return set;
  });
  const order = [0, 1, -1, 2, -2, 3, -3, 4, -4];
  G.routes.forEach((r, i) => {
    const taken = new Set();
    for (let k = 0; k < i; k++) {
      let shared = 0;
      for (const key of sets[k]) if (sets[i].has(key) && ++shared >= 3) break;
      if (shared >= 3) taken.add(G.routes[k].slot);
    }
    r.slot = order.find(o => !taken.has(o)) ?? 0;
  });
}
function routeOffsetPx(r) { return (r.slot || 0) * Math.max(3, Math.min(6, cam.z / 60)); }
// 화면 좌표에서 진행 방향 왼쪽으로 off(px)만큼 띄운 선을 현재 패스에 잇는다
function traceOffset(pts, off) {
  const P = pts.map(([x, y]) => [sx(x), sy(y)]);
  for (let i = 0; i < P.length; i++) {
    let nx = 0, ny = 0;
    for (const [a, b] of [[i - 1, i], [i, i + 1]]) {
      if (a < 0 || b >= P.length) continue;
      const dx = P[b][0] - P[a][0], dy = P[b][1] - P[a][1], L = Math.hypot(dx, dy);
      if (L > 0.01) { nx += -dy / L; ny += dx / L; }
    }
    const L = Math.hypot(nx, ny);
    const X = L ? P[i][0] + nx / L * off : P[i][0], Y = L ? P[i][1] + ny / L * off : P[i][1];
    i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
  }
}

function stopRadius(s) { return Math.max(4, Math.min(13, 3 + Math.sqrt(s.on) / 8)) * Math.min(1.5, Math.max(0.75, cam.z / 140)); }

// 배경(행정동·도로·지역 이름)은 화면이 바뀔 때만 다시 그린다
const bgCanvas = document.createElement('canvas');
let bgKey = '';
function drawStatic(ctx) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#eef0f3';
  ctx.fillRect(0, 0, W, H);

  // 행정동
  const maxDem = 8000;
  for (const d of dongs) {
    const open = G.unlocked.has(d.gu);
    ctx.beginPath();
    for (const r of d.rings) { r.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))); ctx.closePath(); }
    if (open) {
      const v = Math.min(1, Math.sqrt((dongDemand[d.gu + ' ' + d.name] || 0) / maxDem)); // 수요가 많을수록 푸르게
      ctx.fillStyle = `rgb(${Math.round(252 - 32 * v)}, ${Math.round(253 - 18 * v)}, ${Math.round(255 - 4 * v)})`;
    } else ctx.fillStyle = '#e2e5ea';
    ctx.fill();
    ctx.strokeStyle = open ? '#cfd5de' : '#d6dae0';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // 도로
  if (roadLayers.length) {
    ctx.save();
    ctx.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * (W / 2 - cam.x * cam.z), DPR * (H / 2 - cam.y * cam.z));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const zf = Math.max(0.35, Math.min(3, cam.z / 160)); // 확대할수록 굵게
    const widthPx = L => Math.max(0.8, (0.5 + L.l * 0.85) * zf); // 차선 수 → 픽셀 굵기
    for (const L of roadLayers) { // 1) 테두리
      const st = ROAD_STYLE[L.c];
      if (cam.z < st.minZ) continue;
      ctx.strokeStyle = st.case; ctx.lineWidth = (widthPx(L) + 1.6) / cam.z; ctx.stroke(L.path);
    }
    for (const L of roadLayers) { // 2) 속
      const st = ROAD_STYLE[L.c];
      if (cam.z < st.minZ || widthPx(L) < 1.6) continue;
      ctx.strokeStyle = st.fill; ctx.lineWidth = widthPx(L) / cam.z; ctx.stroke(L.path);
    }
    ctx.restore();
  }
  // 구 경계 강조 + 이름
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const g of guList) {
    const [x, y] = guCenter[g];
    const open = G.unlocked.has(g);
    ctx.font = `bold ${open ? 13 : 14}px sans-serif`;
    ctx.fillStyle = open ? 'rgba(100,116,139,.35)' : '#6b7280';
    ctx.fillText(open ? g : `🔒 ${g}`, sx(x), sy(y) - (open ? 0 : 8));
    if (!open) { ctx.font = '12px sans-serif'; ctx.fillText(won(CFG.unlockCost[g]), sx(x), sy(y) + 10); }
  }
  // 동 이름 (확대 시)
  if (cam.z > 160) {
    ctx.font = '11px sans-serif'; ctx.fillStyle = 'rgba(100,116,139,.55)';
    for (const d of dongs) if (G.unlocked.has(d.gu)) ctx.fillText(d.name, sx(d.cx), sy(d.cy));
  }

}

function draw() {
  const key = [cam.x, cam.y, cam.z, W, H, DPR, [...G.unlocked].join()].join('|');
  if (key !== bgKey) {
    bgKey = key;
    if (bgCanvas.width !== cv.width || bgCanvas.height !== cv.height) { bgCanvas.width = cv.width; bgCanvas.height = cv.height; }
    drawStatic(bgCanvas.getContext('2d'));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bgCanvas, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  // 노선
  for (const r of G.routes) {
    // 같은 도로를 지나는 노선끼리는 옆으로 나란히 (돌아오는 길은 진행 방향이 반대라 부호를 바꿔 같은 쪽에)
    const off = routeOffsetPx(r);
    ctx.beginPath();
    for (const pts of r.geom) if (pts) traceOffset(pts, off);
    (r.geomB || []).forEach((pts, k) => { if (pts && r.drawB[k]) traceOffset(pts, -off); });
    const w = selected && selected.type === 'route' && selected.r === r ? 7 : 4;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = w + 3; ctx.stroke();
    ctx.strokeStyle = r.color; ctx.lineWidth = w; ctx.stroke();
  }
  // 그리는 중인 노선
  if (editing) {
    tracePath(editing.stops, editing.r.loop);
    ctx.setLineDash([8, 6]); ctx.strokeStyle = '#111827'; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
    // 마우스를 올린 정류장이 들어갈 자리 미리 보기
    if (hoverStop && !editing.stops.includes(hoverStop.id)) {
      const L = editing.stops, k = insertPos(L, hoverStop.id, editing.r.loop);
      const a = k > 0 ? L[k - 1] : (editing.r.loop ? L[L.length - 1] : null);
      const b = k < L.length ? L[k] : (editing.r.loop ? L[0] : null);
      tracePath([a, hoverStop.id, b].filter(v => v != null), false);
      ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 4; ctx.stroke();
    } else if (hoverStop && editing.stops.length > (editing.r.loop ? 3 : 2)) {
      ctx.beginPath(); ctx.arc(sx(hoverStop.x), sy(hoverStop.y), stopRadius(hoverStop) + 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 3; ctx.stroke();
    }
  }
  if (drawing && drawing.length) {
    const ids = hoverStop && !drawing.includes(hoverStop.id) ? [...drawing, hoverStop.id] : drawing;
    tracePath(ids, false);
    if (!hoverStop) ctx.lineTo(mouse.x, mouse.y);
    ctx.setLineDash([8, 6]); ctx.strokeStyle = '#111827'; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
  }

  // 선택한 정류장에서 기다리는 승객들의 목적지 (점선, 많을수록 굵게)
  if (selected && selected.type === 'stop' && G.waiting.get(selected.s.id)?.length) {
    const s0 = selected.s, W = stopWaitSummary(s0.id);
    ctx.save(); ctx.setLineDash([5, 5]); ctx.lineCap = 'round';
    for (const [did, n] of W.byDest) {
      const d = stops[did];
      ctx.beginPath(); ctx.moveTo(sx(s0.x), sy(s0.y)); ctx.lineTo(sx(d.x), sy(d.y));
      ctx.strokeStyle = 'rgba(124,58,237,.55)'; ctx.lineWidth = Math.min(7, 1.2 + n * 0.8); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [did, n] of W.byDest) {
      const d = stops[did], X = sx(d.x), Y = sy(d.y);
      ctx.fillStyle = '#7c3aed'; ctx.beginPath(); ctx.arc(X, Y - 14, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(n, X, Y - 13.5);
    }
    ctx.restore();
  }

  // 정류장: 흰 원 + 진한 테두리. 미보유 = 회색 테두리, 보유 = 진회색, 운행 중 = 노선 색 굵은 테두리
  const picked = id => (drawing && drawing.includes(id)) || (editing && editing.stops.includes(id));
  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,.28)'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
  for (const s of openStops) {
    const X = sx(s.x), Y = sy(s.y);
    if (X < -20 || Y < -20 || X > W + 20 || Y > H + 20) continue;
    const served = servedBy.get(s.id), own = G.owned.has(s.id), rad = stopRadius(s);
    ctx.beginPath(); ctx.arc(X, Y, rad, 0, Math.PI * 2);
    ctx.fillStyle = picked(s.id) ? '#fde047' : own ? '#ffffff' : '#f3f4f6';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (served) { ctx.lineWidth = 3; ctx.strokeStyle = served[0].color; ctx.stroke(); }
    else { ctx.lineWidth = own ? 2.2 : 1.6; ctx.strokeStyle = own ? '#334155' : '#9ca3af'; if (!own) ctx.setLineDash([2.5, 2]); ctx.stroke(); ctx.setLineDash([]); }
    if (own && rad >= 6) { ctx.beginPath(); ctx.arc(X, Y, Math.max(1.6, rad * 0.28), 0, Math.PI * 2); ctx.fillStyle = served ? served[0].color : '#334155'; ctx.fill(); }
    ctx.shadowColor = 'rgba(15,23,42,.28)';
    if (s === hoverStop) { ctx.lineWidth = 2.5; ctx.strokeStyle = '#f59e0b'; ctx.beginPath(); ctx.arc(X, Y, rad + 4, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.restore();
  // 기다리는 승객: 빨간 숫자 배지
  ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [sid, q] of G.waiting) {
    if (!q.length) continue;
    const s = stops[sid], rad = stopRadius(s), X = sx(s.x) + rad + 7, Y = sy(s.y) - rad - 5;
    if (X < -20 || Y < -20 || X > W + 20 || Y > H + 20) continue;
    const label = String(q.length), bw = Math.max(16, ctx.measureText(label).width + 8);
    ctx.fillStyle = q.length > 20 ? '#dc2626' : '#f97316';
    ctx.beginPath(); ctx.roundRect(X - bw / 2, Y - 8, bw, 16, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(label, X, Y + 0.5);
  }
  // 정류장 이름: 흰 테두리를 두른 진한 글씨
  if (cam.z > 110) {
    const minOn = cam.z > 400 ? 0 : cam.z > 250 ? 300 : cam.z > 170 ? 1000 : 2500;
    ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    for (const s of openStops) {
      if (s.on < minOn && !servedBy.has(s.id)) continue;
      const X = sx(s.x) + stopRadius(s) + 4, Y = sy(s.y) + 1;
      if (X < 0 || Y < 0 || X > W || Y > H) continue;
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(s.name, X, Y);
      ctx.fillStyle = G.owned.has(s.id) ? '#111827' : '#6b7280'; ctx.fillText(s.name, X, Y);
    }
    ctx.textAlign = 'center';
  }

  // 버스
  for (const b of G.buses) {
    const [x, y, dx, dy, back] = busPos(b);
    const nl = Math.hypot(dx, dy) || 1, o = routeOffsetPx(b.route) * (back ? -1 : 1);
    const X = sx(x) - dy / nl * o, Y = sy(y) + dx / nl * o;
    ctx.fillStyle = b.route.color;
    const tier = busTier(b);
    const K = busType(b), hw = K.w / 2, hh = K.h / 2;
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.roundRect(X - hw, Y - hh, K.w, K.h, 2.5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = tier.color === '#e5e7eb' ? '#9ca3af' : tier.color; // 지붕 띠 = 등급 색
    ctx.fillRect(X - hw + 1.5, Y - hh + 1.5, K.w - 3, 2.5);
    const f = b.pax.length / tier.cap;
    ctx.fillStyle = f > 0.9 ? '#fecaca' : '#fff';
    ctx.fillRect(X - hw + 2, Y + hh - 4, (K.w - 4) * f, 2.5);
  }
}

// ───────────────────────── UI ─────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const won = n => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e8) return s + (a / 1e8).toFixed(2).replace(/\.?0+$/, '') + '억원';
  if (a >= 1e5) return s + fmt(a / 1e4) + '만원';
  if (a >= 1e4) return s + (a / 1e4).toFixed(1).replace(/\.0$/, '') + '만원';
  return s + fmt(a) + '원';
};
let toastTimer;
function toast(msg, bg = '#b91c1c') { const t = $('toast'); t.textContent = msg; t.style.background = bg; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.display = 'none', 2200); }
function showModal(html) { $('modalBox').innerHTML = html; $('modal').style.display = 'flex'; }
function hideModal() { $('modal').style.display = 'none'; }

function routeName(r) {
  const a = stops[r.stops[0]].name, b = stops[r.stops[r.stops.length - 1]].name;
  return r.loop ? `${a} 순환` : `${a} ↔ ${b}`;
}
function routeKm(r) { return r.segLen.reduce((a, b) => a + b, 0); }

function renderSide() {
  const el = $('routes');
  el.innerHTML = '';
  if (!G.routes.length) el.innerHTML = '<div class="muted" style="margin-bottom:8px">아직 노선이 없습니다.</div>';
  for (const r of G.routes) {
    const bs = G.buses.filter(b => b.route === r), n = bs.length;
    const mix = Object.entries(CFG.busTypes).flatMap(([k, T]) => T.levels.map((l, i) => [T, l, i, bs.filter(b => b.type === k && b.lvl === i).length]))
      .filter(x => x[3]).map(([T, l, i, c]) => `<span style="color:${ink(l.color)}">${T.icon}Lv${i + 1}×${c}</span>`).join(' ');
    const d = document.createElement('div');
    d.className = 'route';
    d.innerHTML = `<span class="sw" style="background:${r.color}"></span>
      <span class="nm"><b>${r.no}번</b> <span class="meta">${routeName(r)}<br>${r.stops.length}개 정류장 · ${routeKm(r).toFixed(1)}km<br>${n ? '운행 ' + n + '대 ' + mix : '<span class="neg">운행 버스 없음</span>'}${(() => { const w = routeWaiting(r).total, l = r.leftToday || 0; return w || l ? `<br><span class="${w >= 12 * Math.max(1, n) || l >= 20 ? 'neg' : ''}">대기 ${w}명${l ? ` · 만차 ${l}명` : ''}</span>` : ''; })()}</span></span>`;
    const disp = document.createElement('button'); disp.textContent = '🚌 배차/회수'; disp.title = '이 노선을 선택해 차고지 버스를 배차하거나 회수'; disp.onclick = () => { selected = { type: 'route', r }; renderSide(); };
    const edit = document.createElement('button'); edit.textContent = '✏️'; edit.title = '노선 수정'; edit.onclick = () => startEdit(r);
    const del = document.createElement('button'); del.textContent = '🗑'; del.title = '노선 삭제'; del.onclick = () => askDelete(r);
    d.onclick = e => { if (e.target.tagName !== 'BUTTON') { selected = { type: 'route', r }; renderSide(); } };
    if (selected && selected.r === r) d.style.outline = `2px solid ${r.color}`;
    const btns = document.createElement('div'); btns.className = 'btns';
    btns.append(disp, edit, del);
    d.append(btns);
    el.append(d);
  }
  renderDepot();
  renderBadges();
  const gl = $('gus');
  gl.innerHTML = '';
  for (const g of guList) {
    const d = document.createElement('div');
    const open = G.unlocked.has(g);
    d.className = 'gu' + (open ? ' open' : '');
    const nStops = stops.filter(s => s.gu === g).length;
    const dem = stops.filter(s => s.gu === g).reduce((a, s) => a + s.on, 0);
    d.innerHTML = `<span>${open ? '✅' : '🔒'} <b>${g}</b> <span class="muted">· 하루 ${fmt(dem)}명</span></span>`;
    if (!open) {
      const b = document.createElement('button');
      b.textContent = won(CFG.unlockCost[g]);
      b.disabled = G.money < CFG.unlockCost[g];
      b.onclick = () => unlock(g);
      d.append(b);
    }
    d.title = `정류장 ${nStops}개`;
    gl.append(d);
  }
  renderInfo();
}

$('info').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn || !selected) return;
  if (btn.dataset.act === 'buy' && selected.type === 'stop') buyStop(selected.s);
  const id = +btn.dataset.id;
  if (btn.dataset.act === 'recall') { const b = G.buses.find(x => x.id === id); if (b) recall(b); }
  if (btn.dataset.act === 'dispatch' && selected.type === 'route') { const b = G.depot.find(x => x.id === id); if (b) dispatch(b, selected.r); }
});

// ── 차고지 ──
function busStats(b) {
  const t = busTier(b);
  return `정원 ${t.cap} · 운영비 ${won(t.costPerHour)}/시간 · 쾌적 ${t.comfort}`;
}
// 차고지에서 배차할 노선: 위쪽 선택 상자 (노선을 고르면 그 노선으로 맞춰짐)
let depotRouteNo = null, lastPickedRoute = null;
function depotTarget() { return G.routes.find(r => r.no === depotRouteNo) || null; }
function renderDepotRoutes() {
  const sel = $('depotRoute');
  const picked = selected && selected.type === 'route' ? selected.r : null;
  if (picked && picked !== lastPickedRoute) depotRouteNo = picked.no; // 지도·목록에서 노선을 새로 고른 경우만
  lastPickedRoute = picked;
  if (!depotTarget()) depotRouteNo = G.routes[0] ? G.routes[0].no : null;
  sel.innerHTML = G.routes.length ? G.routes.map(r => `<option value="${r.no}" ${r.no === depotRouteNo ? 'selected' : ''}>${r.no}번 · ${routeName(r)} (운행 ${G.buses.filter(b => b.route === r).length}대)</option>`).join('')
    : '<option>노선이 없습니다</option>';
  sel.disabled = !G.routes.length;
}
$('depotRoute').addEventListener('change', e => { depotRouteNo = +e.target.value; renderDepot(); });

function renderDepot() {
  renderDepotRoutes();
  const buy = $('buyBus');
  if (!buy.dataset.built) {
    buy.dataset.built = '1';
    buy.innerHTML = Object.entries(CFG.busTypes).map(([k, T]) => `<button data-buy="${k}" title="정원 ${T.levels[0].cap} · 운영비 ${won(T.levels[0].costPerHour)}/시간 · 쾌적 ${T.levels[0].comfort}">
      ${T.icon} ${T.name}<br><span class="muted">${won(T.price)}</span></button>`).join('');
  }
  for (const btn of buy.querySelectorAll('button')) btn.disabled = G.money < CFG.busTypes[btn.dataset.buy].price;
  const route = depotTarget();
  const el = $('depot');
  if (!G.depot.length) { el.innerHTML = '<div class="muted">차고지가 비어 있습니다.</div>'; return; }
  el.innerHTML = G.depot.slice().sort((a, b) => a.id - b.id).map(b => {
    const t = busTier(b), next = busType(b).levels[b.lvl + 1];
    return `<div class="bus">
      <div><span style="color:${ink(t.color)}">■</span> ${busType(b).icon} <b>${b.id}호</b> ${t.name} <span class="muted">Lv${b.lvl + 1}</span><br><span class="muted">${busStats(b)}</span></div>
      <div class="btns">
        <button data-act="dispatch" data-id="${b.id}" ${route ? '' : 'disabled'} title="${route ? route.no + '번 노선에 배차' : '노선을 먼저 선택하세요'}">${route ? `→ ${route.no}번 배차` : '배차'}</button>
        ${next ? `<button data-act="up" data-id="${b.id}" ${G.money < next.upgrade ? 'disabled' : ''} title="${next.name} · 정원 ${next.cap} · 운영비 ${won(next.costPerHour)}/시간 · 쾌적 ${next.comfort}">Lv${b.lvl + 2} ${won(next.upgrade)}</button>` : '<span class="muted" style="align-self:center">최고 레벨</span>'}
        <button data-act="sell" data-id="${b.id}" title="투자금의 50%">매각 ${won(sellValue(b))}</button>
      </div></div>`;
  }).join('');
}
$('buyBus').addEventListener('click', e => { const btn = e.target.closest('button[data-buy]'); if (btn) buyBus(btn.dataset.buy); });
$('depot').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const b = G.depot.find(x => x.id === +btn.dataset.id);
  if (!b) return;
  if (btn.dataset.act === 'up') upgradeBus(b);
  if (btn.dataset.act === 'sell') sellBus(b);
  if (btn.dataset.act === 'dispatch' && depotTarget()) dispatch(b, depotTarget());
});

// ── 대기 승객 분석: 어느 노선·방향으로, 어디로 가려는지 ──
function dirLabel(r, fromIdx, alightIdx) {
  if (r.loop) return '순환';
  const end = alightIdx > fromIdx ? r.stops[r.stops.length - 1] : r.stops[0];
  return stops[end].name + ' 방면';
}
function stopWaitSummary(sid) {
  const q = G.waiting.get(sid) || [];
  const byLine = new Map(), byDong = new Map(), byDest = new Map();
  let waitSum = 0, transfer = 0, left = 0;
  for (const p of q) {
    waitSum += G.t - p.since;
    if (p.paid) transfer++;
    if (p.leftBehind) left++;
    // 탈 수 있는 노선·방향 (여러 개면 똑같이 나눠 셈)
    const seen = new Set();
    for (const o of p.options) {
      const i = o.route.idxOf.get(sid);
      if (i == null) continue;
      const key = o.route.no + '|' + dirLabel(o.route, i, o.alight);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    for (const key of seen) byLine.set(key, (byLine.get(key) || 0) + 1 / seen.size);
    const d = stops[p.dest];
    byDong.set(d.dong, (byDong.get(d.dong) || 0) + 1);
    byDest.set(p.dest, (byDest.get(p.dest) || 0) + 1);
  }
  const lines = [...byLine.entries()].map(([k, v]) => { const [no, dir] = k.split('|'); return { r: G.routes.find(x => x.no === +no), dir, n: v }; })
    .filter(x => x.r).sort((a, b) => b.n - a.n);
  const dongs = [...byDong.entries()].sort((a, b) => b[1] - a[1]);
  return { n: q.length, avgWait: q.length ? waitSum / q.length : 0, transfer, left, lines, dongs, byDest };
}
// 노선을 기다리는 승객 수(정류장별)
function routeWaiting(r) {
  let total = 0; const at = [];
  for (const sid of r.stops) {
    const q = G.waiting.get(sid) || [];
    let n = 0;
    for (const p of q) if (p.options.some(o => o.route === r)) n++;
    total += n;
    if (n) at.push([sid, n]);
  }
  at.sort((a, b) => b[1] - a[1]);
  return { total, at };
}
function routeAdvice(r) {
  const n = G.buses.filter(b => b.route === r).length, w = routeWaiting(r).total, left = r.leftToday || 0;
  if (!n) return '<span class="neg">운행 버스가 없습니다. 차고지에서 배차하세요.</span>';
  if (left >= 20) return `<span class="neg">오늘 만차로 ${left}명이 못 탔습니다. 버스를 더 넣거나 큰 버스로 바꾸세요.</span>`;
  if (w >= 12 * n) return `<span class="neg">기다리는 승객이 많습니다. 버스 추가를 추천합니다.</span>`;
  return '';
}

// ── 설정창(노선 · 차고지 · 지역 개방 · 도움말) ──
const PANELS = { routes: '🚌 노선', depot: '🅿️ 차고지', regions: '🗺️ 지역 개방', help: '❓ 도움말' };
let openPanelName = null, panelBeforeMapMode = null;
function openPanel(name) {
  openPanelName = name;
  $('panel').hidden = !name;
  if (name) $('panelTitle').textContent = PANELS[name];
  for (const el of document.querySelectorAll('#panel .pbody')) el.classList.toggle('on', el.dataset.p === name);
  for (const b of document.querySelectorAll('#dock button')) b.classList.toggle('on', b.dataset.panel === name);
}
function togglePanel(name) { openPanel(openPanelName === name ? null : name); }
for (const b of document.querySelectorAll('#dock button')) b.onclick = () => togglePanel(b.dataset.panel);
$('panelClose').onclick = () => openPanel(null);
$('infoClose').onclick = () => { selected = null; renderSide(); };
// 지도에서 노선을 그리거나 고칠 때는 설정창을 잠시 닫았다가 끝나면 다시 연다
function hidePanelForMap() { if (openPanelName) { panelBeforeMapMode = openPanelName; openPanel(null); } }
function restorePanel() { if (panelBeforeMapMode) { openPanel(panelBeforeMapMode); panelBeforeMapMode = null; } }
function renderBadges() {
  $('bRoutes').textContent = G.routes.length || '';
  $('bDepot').textContent = G.depot.length || '';
  const can = guList.filter(g => !G.unlocked.has(g) && G.money >= CFG.unlockCost[g]).length;
  $('bRegions').textContent = can ? '+' + can : '';
}

function waitHtml(sid) {
  const W = stopWaitSummary(sid);
  if (!W.n) return '<div class="wbox muted">기다리는 승객이 없습니다.</div>';
  const max = W.lines.length ? W.lines[0].n : 1;
  return `<div class="wbox">
    <div><b>기다리는 승객 ${W.n}명</b> <span class="muted">· 평균 ${Math.round(W.avgWait)}분째${W.transfer ? ` · 환승 ${W.transfer}명` : ''}${W.left ? ` · <span class="neg">만차로 못 탐 ${W.left}명</span>` : ''}</span></div>
    <div class="wsub">타려는 노선 · 방향</div>
    ${W.lines.map(x => `<div class="wrow"><span class="wlab"><b style="color:${x.r.color}">${x.r.no}번</b> ${x.dir}</span>
      <span class="wbar"><i style="width:${Math.max(6, x.n / max * 100)}%;background:${x.r.color}"></i></span><span class="wnum">${Math.round(x.n)}명</span></div>`).join('')}
    <div class="wsub">가려는 곳 (동)</div>
    <div class="wdong">${W.dongs.slice(0, 5).map(([d, n]) => `<span>${d} <b>${n}</b></span>`).join('')}${W.dongs.length > 5 ? `<span class="muted">외 ${W.dongs.length - 5}곳</span>` : ''}</div>
    <div class="muted" style="font-size:11px;margin-top:4px">지도의 점선 = 승객들이 가려는 목적지</div>
  </div>`;
}

function renderInfo() {
  const el = $('info');
  $('infoCard').hidden = !selected;
  if (!selected) { el.innerHTML = ''; return; }
  if (selected.type === 'stop') {
    const s = selected.s, rs = servedBy.get(s.id) || [], own = G.owned.has(s.id), price = stopPrice(s);
    el.innerHTML = `<b>${s.name}</b> ${own ? '<span class="pos">보유</span>' : '<span class="muted">미보유</span>'}<br><span class="muted">${s.gu} ${s.dong}${s.n > 1 ? ` · 정류소 ${s.n}곳 묶음` : ''}</span><br>
      실제 하루 평균 승차 <b>${fmt(s.on)}</b>명 / 하차 ${fmt(s.off)}명<br>
      ${own ? `경유 노선: ${rs.length ? rs.map(r => `<span style="color:${r.color}">${r.no}번</span>`).join(', ') : '<span class="muted">없음 (노선에 넣어야 승객이 생깁니다)</span>'}
      ${waitHtml(s.id)}`
      : isOpen(s) ? `<button class="primary" data-act="buy" style="margin-top:6px;width:100%" ${G.money < price ? 'disabled' : ''}>정류장 구입 · ${won(price)}</button>`
      : `<span class="muted">${s.gu}를 먼저 개방해야 합니다</span>`}`;
  } else if (selected.type === 'route') {
    const r = selected.r, bs = G.buses.filter(b => b.route === r);
    const load = bs.reduce((a, b) => a + b.pax.length, 0);
    const seats = bs.reduce((a, b) => a + busTier(b).cap, 0);
    const h = headway(r);
    el.innerHTML = `<b style="color:${r.color}">${r.no}번</b> ${routeName(r)}<br>
      ${r.loop ? '순환' : '왕복'} · ${r.stops.length}개 정류장 · ${routeKm(r).toFixed(1)}km<br>
      버스 ${bs.length}대 · 탑승 ${load}명 / ${seats}석${h < Infinity ? ` · 배차 약 ${Math.round(h)}분` : ''}
      ${(() => { const RW = routeWaiting(r), adv = routeAdvice(r); return `<div class="wbox">
        <b>이 노선을 기다리는 승객 ${RW.total}명</b>${r.leftToday ? ` <span class="neg">· 오늘 만차로 못 탐 ${r.leftToday}명</span>` : ''}
        ${RW.at.length ? `<div class="wdong">${RW.at.slice(0, 4).map(([sid, n]) => `<span>${stops[sid].name} <b>${n}</b></span>`).join('')}</div>` : ''}
        ${adv ? `<div style="margin-top:4px">${adv}</div>` : ''}</div>`; })()}
      <div style="margin-top:8px"><b>운행 중</b>${bs.length ? '' : ' <span class="muted">없음</span>'}</div>
      ${bs.map(b => { const t = busTier(b); return `<div style="display:flex;align-items:center;gap:6px;margin:4px 0">
          <span style="flex:1"><span style="color:${ink(t.color)}">■</span> ${busType(b).icon} ${b.id}호 ${t.name} <span class="muted">${b.pax.length}/${t.cap}</span></span>
          <button data-act="recall" data-id="${b.id}" title="차고지로 회수 (타고 있던 승객은 내림)">회수</button></div>`; }).join('')}
      <div style="margin-top:8px"><b>차고지에서 배차</b>${G.depot.length ? '' : ' <span class="muted">차고지가 비어 있습니다. 아래에서 버스를 사세요</span>'}</div>
      ${G.depot.slice().sort((a, b) => a.id - b.id).map(b => { const t = busTier(b); return `<div style="display:flex;align-items:center;gap:6px;margin:4px 0">
          <span style="flex:1"><span style="color:${ink(t.color)}">■</span> ${busType(b).icon} ${b.id}호 ${t.name} <span class="muted">정원 ${t.cap}</span></span>
          <button data-act="dispatch" data-id="${b.id}">배차</button></div>`; }).join('')}`;
  } else if (selected.type === 'gu') {
    const g = selected.g;
    const open = G.unlocked.has(g);
    const ss = stops.filter(s => s.gu === g);
    el.innerHTML = `<b>${g}</b> ${open ? '(개방됨)' : '🔒'}<br>정류장 ${ss.length}개 · 실제 하루 승차 ${fmt(ss.reduce((a, s) => a + s.on, 0))}명<br>
      ${open ? '' : `개방 비용 <b>${won(CFG.unlockCost[g])}</b><br><button class="primary" id="unlockBtn" ${G.money < CFG.unlockCost[g] ? 'disabled' : ''}>개방하기</button>`}`;
    const b = $('unlockBtn'); if (b) b.onclick = () => unlock(g);
  }
}

function renderTop() {
  $('day').textContent = `${G.day}일차`;
  const t = Math.floor(G.t);
  $('clock').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  $('money').textContent = won(G.money);
  $('money').className = G.money < 0 ? 'neg' : '';
  const s = satPct();
  $('sat').textContent = s == null ? '-' : s.toFixed(0) + '%';
  $('rep').textContent = (G.rep * 100).toFixed(0) + '%';
  const pk = peakAt(G.t).peak, pe = $('peak');
  pe.textContent = pk ? `${pk.icon} ${pk.name} 피크` : '';
  pe.style.display = pk ? '' : 'none';
  $('cover').textContent = G.today.potential > 1 ? (G.today.pax / G.today.potential * 100).toFixed(0) + '%' : '-';
  let waiting = 0; for (const q of G.waiting.values()) waiting += q.length;
  $('todayStat').textContent = `오늘 수송 ${fmt(G.today.pax)}명 · 대기 ${fmt(waiting)}명 · 수입 ${won(G.today.revenue)} · 운영비 ${won(G.today.cost)}`;
}

const SPEEDS = [0, 1, 2, 3, 10];
function setSpeedUI() { SPEEDS.forEach((v, i) => $('sp' + i).classList.toggle('on', G.paused ? i === 0 : v === G.speed)); }
SPEEDS.forEach((v, i) => $('sp' + i).onclick = () => { if (i === 0) G.paused = !G.paused; else { G.speed = v; G.paused = false; } setSpeedUI(); });

function setHint(t) { const h = $('hint'); h.innerHTML = t; h.style.display = t ? 'block' : 'none'; }

function startDrawing() {
  hidePanelForMap();
  drawing = [];
  cv.classList.add('drawing');
  setHint('정류장을 순서대로 클릭하세요 · <b>Enter</b> 완료 · <b>Backspace</b> 되돌리기 · <b>Esc</b> 취소');
}
function finishDrawing(loop = false) {
  const ids = drawing;
  cancelDrawing();
  if (!ids || ids.length < 2) { if (ids && ids.length) toast('정류장을 2개 이상 선택하세요'); return; }
  const r = addRoute(ids, loop && ids.length >= 3);
  selected = { type: 'route', r };
  renderSide();
  save();
  toast(`${r.no}번 노선을 만들었습니다. 차고지에서 버스를 배차하세요`, '#15803d');
}
function cancelDrawing() { drawing = null; cv.classList.remove('drawing'); setHint(''); restorePanel(); }
$('newRoute').onclick = () => { if (editing) cancelEdit(); drawing ? finishDrawing() : startDrawing(); };

// ── 노선 수정 ──
let editing = null; // { r, stops }
function startEdit(r) {
  if (drawing) cancelDrawing();
  hidePanelForMap();
  editing = { r, stops: r.stops.slice() };
  selected = { type: 'route', r };
  cv.classList.add('drawing');
  setHint(`<b style="color:${r.color}">${r.no}번</b> 수정 중 · 새 정류장 클릭: 추가 · 노선 정류장 클릭: 빼기 · <b>Enter</b> 적용 · <b>Esc</b> 취소`);
  renderInfo();
}
function cancelEdit() { editing = null; cv.classList.remove('drawing'); setHint(''); restorePanel(); }
function editClick(s) {
  const L = editing.stops, loop = editing.r.loop;
  const k = L.indexOf(s.id);
  if (k >= 0) {
    if (L.length <= (loop ? 3 : 2)) { toast(`정류장이 ${loop ? 3 : 2}개보다 적을 수 없습니다`); return; }
    L.splice(k, 1);
    return;
  }
  L.splice(insertPos(L, s.id, loop), 0, s.id);
}
// 가장 적게 돌아가는 위치
function insertPos(L, id, loop) {
  const s = { id };
  const d = (a, b) => distKm(stops[a], stops[b]);
  let best = { pos: L.length, cost: loop ? Infinity : d(L[L.length - 1], s.id) };
  if (!loop) { const c0 = d(s.id, L[0]); if (c0 < best.cost) best = { pos: 0, cost: c0 }; }
  const last = loop ? L.length : L.length - 1;
  for (let i = 1; i <= last; i++) {
    const a = L[i - 1], b = L[i % L.length];
    const c = d(a, s.id) + d(s.id, b) - d(a, b);
    if (c < best.cost) best = { pos: i, cost: c };
  }
  return best.pos;
}
function applyEdit() {
  const { r, stops: next } = editing;
  cancelEdit();
  const old = r.stops;
  if (old.length === next.length && old.every((v, i) => v === next[i])) return;
  r.stops = next;
  rebuildNetwork();
  for (const b of G.buses) {
    if (b.route !== r) continue;
    let i = r.idxOf.get(old[b.i]);
    if (i === undefined) { // 버스가 있던 정류장이 빠짐 → 가장 가까운 정류장으로
      const [x, y] = [stops[old[b.i]].x, stops[old[b.i]].y];
      i = 0; let bd = 1e9;
      r.stops.forEach((id, j) => { const dd = Math.hypot(stops[id].x - x, stops[id].y - y); if (dd < bd) { bd = dd; i = j; } });
    }
    b.i = i; b.d = 0;
    const sid = r.stops[b.i], keep = [];
    for (const p of b.pax) {
      const a = r.idxOf.get(p.plan.alightId);
      if (a !== undefined && a !== b.i) { p.plan.alight = a; keep.push(p); continue; }
      // 내릴 정류장이 사라짐 → 지금 정류장에서 다시 경로 찾기
      p.options = planFrom(sid, p.dest); p.since = G.t;
      if (p.options.length) { if (!G.waiting.has(sid)) G.waiting.set(sid, []); G.waiting.get(sid).push(p); }
    }
    b.pax = keep;
  }
  renderSide();
  save();
  toast(`${r.no}번 노선을 수정했습니다`, '#15803d');
}

function stopAt(px, py) {
  let best = null, bd = 1e9;
  for (const s of openStops) {
    const d = Math.hypot(sx(s.x) - px, sy(s.y) - py);
    if (d < Math.max(9, stopRadius(s) + 3) && d < bd) { best = s; bd = d; }
  }
  return best;
}
function dongAt(x, y) {
  for (const d of dongs) {
    const [a, b, c, e] = d.bbox;
    if (x < a || x > c || y < b || y > e) continue;
    for (const r of d.rings) {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return d;
    }
  }
  return null;
}

// 마우스
let drag = null;
cv.addEventListener('mousedown', e => { drag = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y, moved: false }; });
window.addEventListener('mouseup', e => {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  if (wasDrag || e.target !== cv) return;
  const s = stopAt(e.offsetX, e.offsetY);
  const notOwned = s && !G.owned.has(s.id);
  if ((editing || drawing) && notOwned) {
    selected = { type: 'stop', s }; renderInfo();
    toast('미보유 정류장입니다. 오른쪽 정보창에서 구입하세요', '#b45309');
    return;
  }
  if (editing) { if (s) editClick(s); return; }
  if (drawing) {
    if (!s) return;
    if (drawing.length >= 3 && s.id === drawing[0]) { finishDrawing(true); return; }
    if (drawing.includes(s.id)) { toast('이미 넣은 정류장입니다'); return; }
    drawing.push(s.id);
    return;
  }
  if (s) { selected = { type: 'stop', s }; renderInfo(); return; }
  const d = dongAt(wx(e.offsetX), wy(e.offsetY));
  selected = d ? { type: 'gu', g: d.gu } : null;
  renderInfo();
});
cv.addEventListener('mousemove', e => {
  mouse = { x: e.offsetX, y: e.offsetY };
  if (drag) {
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) { cam.x = drag.cx - dx / cam.z; cam.y = drag.cy - dy / cam.z; }
  }
  hoverStop = stopAt(e.offsetX, e.offsetY);
  const tt = $('tooltip');
  if (hoverStop && !drag?.moved) {
    const q = (G.waiting.get(hoverStop.id) || []).length;
    tt.innerHTML = `<b>${hoverStop.name}</b> <span class="muted">${hoverStop.dong}</span><br>실제 하루 승차 ${fmt(hoverStop.on)}명${q ? ` · 대기 ${q}명` : ''}${G.owned.has(hoverStop.id) ? '' : `<br><span class="muted">미보유 · ${won(stopPrice(hoverStop))}</span>`}`;
    tt.style.left = e.offsetX + 14 + 'px'; tt.style.top = e.offsetY + 14 + 'px'; tt.style.display = 'block';
  } else tt.style.display = 'none';
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const mx = wx(e.offsetX), my = wy(e.offsetY);
  cam.z = Math.max(15, Math.min(1500, cam.z * Math.exp(-e.deltaY * 0.0015)));
  cam.x = mx - (e.offsetX - W / 2) / cam.z; cam.y = my - (e.offsetY - H / 2) / cam.z;
}, { passive: false });
window.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (editing) {
    if (e.key === 'Enter') applyEdit();
    else if (e.key === 'Escape') cancelEdit();
    return;
  }
  if (drawing) {
    if (e.key === 'Enter') finishDrawing();
    else if (e.key === 'Escape') cancelDrawing();
    else if (e.key === 'Backspace') { e.preventDefault(); drawing.pop(); }
    return;
  }
  if (e.key === ' ') { e.preventDefault(); $('sp0').click(); }
  else if (e.key === 'Escape') { if (openPanelName) openPanel(null); else if (selected) { selected = null; renderSide(); } }
  else if ('1234'.includes(e.key) && e.key.length === 1) togglePanel(Object.keys(PANELS)[+e.key - 1]);
});
window.addEventListener('resize', resize);

// ───────────────────────── 루프 ─────────────────────────
let last = performance.now(), uiTimer = 0;
function frame(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!G.paused && $('modal').style.display !== 'flex') {
    // 1x = 실제 1초에 게임 1분. 큰 dt는 잘게 나눠 계산
    let dt = dtReal * G.speed;
    while (dt > 0 && !G.paused) { const step = Math.min(dt, 0.25); tick(step); dt -= step; }
  }
  draw();
  uiTimer += dtReal;
  if (uiTimer > 0.2) { uiTimer = 0; renderTop(); if (selected && selected.type !== 'gu' && !$('info').matches(':hover')) renderInfo(); }
  requestAnimationFrame(frame);
}

resize();
const loaded = load();
fitGu(CFG.startGu);
function setupNewGame() {
  // 기본 노선: 이름이 같은 정류장이 여럿이면 승객이 가장 많은 곳
  // 양방향 정류장을 합치면서 이름이 바뀌었을 수 있어 앞/건너·괄호를 뗀 이름으로 비교
  const key = n => n.replace(/\(.*?\)/g, '').replace(/\s+/g, '').replace(/(건너|앞|맞은편)$/, '');
  const find = name => stops.filter(s => s.gu === CFG.startGu && (s.name === name || key(s.name) === key(name))).sort((x, y) => y.on - x.on)[0];
  for (const names of CFG.starterRoutes) {
    const ids = names.map(find).filter(Boolean).map(s => s.id);
    ids.forEach(id => G.owned.add(id));
    const r = addRoute(ids, false);
    dispatch(buyBus('city', true), r, true);
  }
  buyBus('town', true); // 차고지에 마을버스 1대
}
if (!loaded) setupNewGame();
renderSide(); renderTop(); setSpeedUI();
if (!loaded) {
  G.paused = true; setSpeedUI();
  const nOwned = G.owned.size;
  showModal(`<h2 style="margin:0 0 8px">대구 버스 경영</h2>
    <p style="line-height:1.7">대구 시내버스 회사를 인수했습니다.<br>
    첫 영업 지역은 <b>중구</b>. 기본 노선 <b>${G.routes.length}개</b>(시내버스 각 1대 운행), 차고지에 마을버스 1대, 정류장 <b>${nOwned}곳</b>이 있습니다.<br><br>
    1. 기본 노선으로 돈을 버세요. 노선을 고르고 차고지 버스를 <b>배차</b>하면 배차 간격이 짧아져 승객이 늘어납니다.<br>
    2. 반월당역·CGV대구한일·2.28기념중앙공원처럼 <b>큰 정류장을 구입</b>해 노선에 넣으세요. 속이 빈 원이 미보유 정류장입니다.<br>
    3. 버스는 <b>마을버스 · 시내버스 · 고속버스</b> 세 종류이고, 차고지에서 Lv3까지 업그레이드합니다. 운영비는 운행 중인 버스만 냅니다.<br>
    4. 돈을 모아 다른 구를 개방하세요.<br><br>
    <span class="muted">정류장 위치와 수요는 실제 대구 버스 데이터(2024~2025)를 바탕으로 했습니다. 기본 노선은 게임용으로 만든 것입니다.</span></p>
    <p>시작 자금: <b>${won(G.money)}</b></p>
    <button class="primary" id="startBtn" style="width:100%">시작</button>`);
  $('startBtn').onclick = () => { hideModal(); G.paused = false; setSpeedUI(); save(); };
}
window.__G = G; // 디버그/테스트용
window.__api = { busCap: b => busTier(b).cap, roadPath, buyBus, dispatch, recall, sellBus, buyStop, upgradeBus, stopPrice, setupNewGame, startEdit, editClick, applyEdit, addRoute, unlock, tick, stops, endDay, toScreen: s => [sx(s.x), sy(s.y)] };
requestAnimationFrame(frame);
