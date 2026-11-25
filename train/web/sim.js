'use strict';
// 전국 기차역 경영 — 시뮬레이션 (화면 없이도 돌아감: node에서 밸런스 점검용)
// 수요: 실제 역별 하루 평균 승차(2025, 코레일) × 시간대 비율 ÷ 10
(function (root) {
const D = root.GAME_DATA;

// ───────────────────────── 밸런스 설정 ─────────────────────────
const CFG = {
  startMoney: 30_000_000,
  startRegion: 'daegu',
  demandScale: 1 / 5,           // 실제 5명 = 게임 승객 1명
  sellRatio: 0.5,
  // 열차 종류 × 등급. cap = 정원(게임 승객), vmax = 최고속도(km/h)
  // stopLoss = 정차 1번에 가감속으로 잃는 시간(분), perKm = 운행 1km 비용, perDay = 운행 중일 때 하루 고정비
  // fare = [최저 요금, km당 요금], upgrade = 아래 등급에서 올리는 비용, elec = 전철화된 선로만
  kinds: {
    general: { name: '일반열차', icon: '🚃', price: 3_000_000, tracks: ['conv'], levels: [
      { name: '무궁화호',   cap: 72, vmax: 150, stopLoss: 2.5, perKm: 300, perDay: 60_000, fare: [2_600, 66], comfort: 0,  upgrade: 0,         color: '#2563eb' },
      { name: 'ITX-새마을', cap: 76, vmax: 150, stopLoss: 2.0, perKm: 340, perDay: 70_000, fare: [2_600, 98], comfort: 12, upgrade: 3_000_000, color: '#dc2626' },
      { name: 'ITX-마음',   cap: 84, vmax: 150, stopLoss: 1.4, perKm: 260, perDay: 65_000, fare: [2_600, 98], comfort: 18, upgrade: 4_000_000, color: '#7c3aed', elec: true },
    ] },
    metro: { name: '광역열차', icon: '🚈', price: 2_500_000, tracks: ['conv'], elec: true, levels: [
      { name: '광역전철 4량', cap: 120, vmax: 120, stopLoss: 1.0, perKm: 150, perDay: 40_000, fare: [1_500, 40], comfort: 0, upgrade: 0,         color: '#0d9488' },
      { name: '광역전철 6량', cap: 180, vmax: 120, stopLoss: 1.0, perKm: 210, perDay: 50_000, fare: [1_500, 40], comfort: 3, upgrade: 2_000_000, color: '#0891b2' },
      { name: '광역전철 8량', cap: 240, vmax: 120, stopLoss: 1.0, perKm: 270, perDay: 60_000, fare: [1_500, 40], comfort: 5, upgrade: 2_500_000, color: '#0369a1' },
    ] },
    ktx: { name: '고속열차', icon: '🚄', price: 40_000_000, tracks: ['hs', 'conv'], elec: true, levels: [
      { name: 'KTX-이음', cap: 76,  vmax: 260, stopLoss: 3.0, perKm: 1_500, perDay: 600_000, fare: [8_400, 140], comfort: 25, upgrade: 0,          color: '#0f766e' },
      { name: 'KTX-산천', cap: 80,  vmax: 300, stopLoss: 3.5, perKm: 1_700, perDay: 650_000, fare: [8_400, 150], comfort: 28, upgrade: 20_000_000,  color: '#1e3a8a' },
      { name: 'KTX-청룡', cap: 104, vmax: 320, stopLoss: 3.2, perKm: 1_900, perDay: 700_000, fare: [8_400, 150], comfort: 35, upgrade: 30_000_000, color: '#be185d' },
    ] },
  },
  hsTrackFeePerKm: 300,         // 고속선 선로 사용료(열차 1km당)
  dwellBase: 1.0, dwellPerPax: 0.02, // 역 정차 시간(분)
  // 선로 용량: 한 시간에 지나갈 수 있는 열차 수(양방향 합). 넘치면 그만큼 느려짐
  capSingle: 4, capDouble: 16, capHs: 24,
  // 선로 개량 비용(km당)
  elecPerKm: 100_000, dblPerKm: 150_000, speedPerKm: 80_000, speedStep: 30, speedMax: 200,
  minTripKm: 8,
  // 목적지 끌림 = 하차 인원 × (e^(-거리/decay) + floor + local·e^(-거리/localKm)). local = 통근·통학 같은 가까운 이동
  tripDecayKm: 200, tripFloor: 0.1, tripLocal: 1.5, tripLocalKm: 30,
  carKmh: 75, carExtraMin: 15,       // 경쟁: 자동차로 가는 시간
  // 시간대 비율(5시~23시). 출퇴근과 오후에 많음
  hourly: [0.012, 0.04, 0.075, 0.08, 0.066, 0.057, 0.056, 0.057, 0.058, 0.058, 0.06, 0.066, 0.075, 0.078, 0.068, 0.048, 0.032, 0.02, 0.01],
  peaks: [{ name: '출근', icon: '🌅', from: 7 * 60, to: 9 * 60 }, { name: '퇴근', icon: '🌆', from: 17 * 60, to: 19 * 60 }],
  maxWaitMin: 90, okWaitMin: 15,
  patienceMin: 20, patienceExtraMean: 40, patienceMax: 150,
  holdRatio: 0.75, maxHoldMin: 40, // 종착역에서 앞차와 간격이 좁으면 대기
  repStart: 1.0, repMin: 0.6, repMax: 1.4, repSpeed: 0.35,
  psoMinSat: 60, psoRatio: 0.5,    // 공익서비스 보상: 적자라도 만족도가 높으면 적자의 50%
  dayStartMin: 5 * 60, dayEndMin: 24 * 60,
  unlockCost: { gyeongbuk_e: 12_000_000, gyeongbuk_n: 8_000_000, busan: 25_000_000, gyeongnam: 10_000_000,
                chungcheong: 80_000_000, chungbuk: 40_000_000, capital: 250_000_000, gangwon: 50_000_000,
                jeonbuk: 60_000_000, jeonnam: 80_000_000 },
  starter: { kind: 'metro', name: '대경선', stops: ['구미', '왜관', '서대구', '대구', '동대구', '경산'] },
  starterDepot: ['general'],
};
const HOUR0 = 5;
const hourSum = CFG.hourly.reduce((a, b) => a + b, 0);

// ───────────────────────── 지도 좌표 ─────────────────────────
const LAT0 = 36.2, LON0 = 127.8, KX = 111.32 * Math.cos(LAT0 * Math.PI / 180), KY = 110.54;
const toKm = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
const stations = D.stations.map((s, id) => { const [x, y] = toKm(s.lon, s.lat); return { ...s, id, x, y }; });
const byName = new Map(stations.map(s => [s.name, s]));
const distKm = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const regionName = Object.fromEntries(D.regions.map(r => [r.id, r.name]));

// 선로 구간(엣지): 노선 이웃 역 사이
const lines = D.lines.map(l => ({ ...l }));
const edges = [];
const adj = stations.map(() => []);
for (const l of lines) {
  l.edges = [];
  for (let k = 0; k + 1 < l.stations.length; k++) {
    const e = { id: edges.length, a: l.stations[k], b: l.stations[k + 1], km: l.km[k], line: l };
    edges.push(e); l.edges.push(e);
    adj[e.a].push(e); adj[e.b].push(e);
  }
  l.totalKm = l.km.reduce((a, b) => a + b, 0);
}

// ───────────────────────── 상태 ─────────────────────────
const G = {
  money: CFG.startMoney, day: 1, t: CFG.dayStartMin, speed: 3, paused: false,
  unlocked: new Set([CFG.startRegion]),
  lineUp: {},            // lineId → { elec, dbl, speed(+km/h) }
  routes: [], trains: [], depot: [], nextRouteNo: 1, nextTrainId: 1,
  waiting: new Map(),    // stationId → [passenger]
  today: null, rep: CFG.repStart, history: [],
};
function newToday() { return { pax: 0, revenue: 0, cost: 0, potential: 0, spawned: 0, satSum: 0, satN: 0, gaveUp: 0, leftBehind: 0, trainKm: 0, bought: 0 }; }
G.today = newToday();

const isOpen = s => G.unlocked.has(s.region);
const lineElec = l => l.elec || !!G.lineUp[l.id]?.elec;
const lineDbl = l => l.dbl || !!G.lineUp[l.id]?.dbl;
const lineVmax = l => l.vmax + (G.lineUp[l.id]?.speed || 0);
const edgeOpen = e => isOpen(stations[e.a]) && isOpen(stations[e.b]);
function edgeCap(e) { return e.line.kind === 'hs' ? CFG.capHs : lineDbl(e.line) ? CFG.capDouble : CFG.capSingle; }

const kindOf = t => CFG.kinds[t.kind];
const tierOf = t => kindOf(t).levels[t.lvl];
const needsElec = (kind, lvl) => !!(CFG.kinds[kind].elec || CFG.kinds[kind].levels[lvl].elec);
function edgeAllowed(e, kind, lvl = 0) {
  const K = CFG.kinds[kind];
  if (!K.tracks.includes(e.line.kind)) return false;
  if (needsElec(kind, lvl) && !lineElec(e.line)) return false;
  return true;
}

// ───────────────────────── 경로 찾기 ─────────────────────────
// 열차 종류가 다닐 수 있는 선로로 가장 빠른 길. 반환: { nodes:[역…], edges:[엣지…], km }
function findPath(from, to, kind) {
  if (from === to) return null;
  const v = CFG.kinds[kind].levels[CFG.kinds[kind].levels.length - 1].vmax;
  const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
  const heap = [[0, from]];
  while (heap.length) {
    let bi = 0; for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[bi][0]) bi = k;
    const [d, u] = heap.splice(bi, 1)[0];
    if (done.has(u)) continue; done.add(u);
    if (u === to) break;
    for (const e of adj[u]) {
      if (!edgeOpen(e) || !edgeAllowed(e, kind)) continue;
      const w = e.a === u ? e.b : e.a;
      const nd = d + e.km / Math.min(v, lineVmax(e.line)) + 0.02; // 역을 지날 때 작은 벌점: 같은 시간이면 역이 적은 길
      if (nd < (dist.get(w) ?? Infinity)) { dist.set(w, nd); prev.set(w, e); heap.push([nd, w]); }
    }
  }
  if (!prev.has(to)) return null;
  const nodes = [to], es = [];
  let u = to;
  while (u !== from) { const e = prev.get(u); es.push(e); u = e.a === u ? e.b : e.a; nodes.push(u); }
  nodes.reverse(); es.reverse();
  return { nodes, edges: es, km: es.reduce((a, e) => a + e.km, 0) };
}

// ───────────────────────── 노선 ─────────────────────────
const PALETTE = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#eab308', '#6366f1'];
// 노선: { no, kind, color, stops:[역], legs:[{nodes, edges, km}] } — legs[i] = stops[i] → stops[i+1]
function buildLegs(kind, stops) {
  const legs = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const P = findPath(stops[i], stops[i + 1], kind);
    if (!P) return null;
    legs.push(P);
  }
  return legs;
}
function addRoute(kind, stops, name) {
  const legs = buildLegs(kind, stops);
  if (!legs) return null;
  const used = new Set(G.routes.map(r => r.color));
  const color = PALETTE.find(c => !used.has(c)) || PALETTE[G.routes.length % PALETTE.length];
  const r = { no: G.nextRouteNo++, kind, color, stops, legs, name: name || '' };
  G.routes.push(r);
  rebuildNetwork();
  return r;
}
function routeTitle(r) { return r.name || `${stations[r.stops[0]].name}–${stations[r.stops[r.stops.length - 1]].name}`; }
function routeKm(r) { return r.legs.reduce((a, l) => a + l.km, 0); }
function routeHasNonElec(r) { return r.legs.some(l => l.edges.some(e => !lineElec(e.line))); }
function routeOpen(r) { return r.legs.every(l => l.edges.every(edgeOpen)); }
const routeTrains = r => G.trains.filter(t => t.route === r);

// 다리(leg) 소요 시간(분): 구간별 속도 = min(열차, 선로) ÷ 혼잡 + 가감속 손실
function legMinutes(leg, tier) {
  let m = 0;
  for (const e of leg.edges) m += e.km / Math.min(tier.vmax, lineVmax(e.line)) * 60 * (edgeLoadFactor.get(e.id) || 1);
  return m + tier.stopLoss;
}
function refTier(r) { const ts = routeTrains(r); return ts.length ? tierOf(ts[0]) : CFG.kinds[r.kind].levels[0]; }
// 한 바퀴(왕복) 시간과 한 방향 배차 간격
function cycleMinutes(r, tier = refTier(r)) {
  let m = 0;
  for (const leg of r.legs) m += legMinutes(leg, tier);
  return 2 * m + 2 * r.stops.length * (CFG.dwellBase + 0.3);
}
function headway(r) { const n = routeTrains(r).length; return n ? cycleMinutes(r) / n : Infinity; }

// ───────────────────────── 네트워크 계산 ─────────────────────────
let edgeLoad = new Map();       // 엣지 → 시간당 열차 수(양방향)
let edgeLoadFactor = new Map(); // 엣지 → 느려지는 배율(≥1)
let servedBy = new Map();       // 역 → [노선]
let destTable = new Map();      // 출발역 → { list:[역], cum:[], total, served } (served = 이어진 목적지 비율 × 서비스 질)
const baseWeight = new Map();   // 출발역 → { d → 끌림 } (열린 역 전부)

function computeLoads() {
  edgeLoad = new Map(); edgeLoadFactor = new Map();
  for (const r of G.routes) {
    const n = routeTrains(r).length;
    if (!n) continue;
    // 혼잡 없는 상태로 한 바퀴 시간을 잼
    let m = 0; const tier = refTier(r);
    for (const leg of r.legs) for (const e of leg.edges) m += e.km / Math.min(tier.vmax, lineVmax(e.line)) * 60;
    m = 2 * (m + r.legs.length * tier.stopLoss) + 2 * r.stops.length * (CFG.dwellBase + 0.3);
    const perHour = 2 * n * 60 / m;
    for (const leg of r.legs) for (const e of leg.edges) edgeLoad.set(e.id, (edgeLoad.get(e.id) || 0) + perHour);
  }
  for (const [id, load] of edgeLoad) { const c = edgeCap(edges[id]); if (load > c) edgeLoadFactor.set(id, load / c); }
}

function destWeights(o) {
  let w = baseWeight.get(o.id);
  if (w) return w;
  w = new Map();
  for (const d of stations) {
    if (d === o) continue;
    const km = distKm(o, d);
    if (km < CFG.minTripKm) continue;
    w.set(d.id, (d.off + 1) * (Math.exp(-km / CFG.tripDecayKm) + CFG.tripFloor + CFG.tripLocal * Math.exp(-km / CFG.tripLocalKm)));
  }
  baseWeight.set(o.id, w);
  return w;
}
// 전국 모든 역 기준: 아직 열지 않은 지역으로 가려는 수요는 놓친 수요
function weightTotal(o) { let s = 0; for (const w of destWeights(o).values()) s += w; return s; }

// 노선 r에서 i번째 역 → j번째 역 시간(분, 대기 제외)
function rideMinutes(r, i, j, tier = refTier(r)) {
  const a = Math.min(i, j), b = Math.max(i, j);
  let m = 0;
  for (let k = a; k < b; k++) m += legMinutes(r.legs[k], tier) + (k > a ? CFG.dwellBase : 0);
  return m;
}
function rideKm(r, i, j) { const a = Math.min(i, j), b = Math.max(i, j); let s = 0; for (let k = a; k < b; k++) s += r.legs[k].km; return s; }

// 서비스 질: 자동차보다 빠를수록, 자주 다닐수록 승객이 많음
function quality(minutes, km, hw) {
  const car = km / CFG.carKmh * 60 + CFG.carExtraMin;
  const ratio = (minutes + Math.min(hw, 240) / 2) / car;
  const speed = Math.max(0.25, Math.min(1.4, 1.7 - 0.7 * ratio));
  const freq = 0.35 + 0.85 * Math.exp(-hw / 90);
  return speed * freq;
}

function rebuildNetwork() {
  computeLoads();
  servedBy = new Map(); destTable = new Map();
  for (const r of G.routes) {
    r.idxOf = new Map(r.stops.map((id, i) => [id, i]));
    r.cumKm = [0]; for (const l of r.legs) r.cumKm.push(r.cumKm[r.cumKm.length - 1] + l.km);
    r.active = routeTrains(r).length > 0 && routeOpen(r);
    if (!r.active) continue;
    for (const id of r.stops) { if (!servedBy.has(id)) servedBy.set(id, []); servedBy.get(id).push(r); }
  }
  for (const [oid, rs] of servedBy) {
    const o = stations[oid];
    const best = new Map(); // d → { min, invH }
    for (const r of rs) {
      const i = r.idxOf.get(oid), hw = headway(r);
      r.stops.forEach((did, j) => {
        if (j === i) return;
        const m = rideMinutes(r, i, j);
        const b = best.get(did) || { min: Infinity, invH: 0, km: rideKm(r, i, j) };
        b.min = Math.min(b.min, m); b.invH += 1 / hw;
        best.set(did, b);
      });
    }
    const W = destWeights(o), list = [], cum = []; let acc = 0;
    for (const [did, b] of best) {
      const w = W.get(did); if (!w) continue;
      acc += w * quality(b.min, b.km, 1 / b.invH);
      list.push(did); cum.push(acc);
    }
    const tot = weightTotal(o);
    destTable.set(oid, { list, cum, total: acc, served: tot ? acc / tot : 0, best });
  }
  // 기다리는 승객: 더는 갈 수 없는 사람은 돌려보냄
  for (const [sid, q] of G.waiting) G.waiting.set(sid, q.filter(p => canRide(sid, p.dest)));
}
function canRide(sid, dest) {
  for (const r of servedBy.get(sid) || []) if (r.idxOf.has(dest)) return true;
  return false;
}

// ───────────────────────── 시뮬레이션 ─────────────────────────
function hourShare(t) { const h = Math.floor(t / 60) - HOUR0; return (CFG.hourly[Math.max(0, Math.min(CFG.hourly.length - 1, h))] || 0) / hourSum; }
function peakAt(t) { return CFG.peaks.find(p => t >= p.from && t < p.to) || null; }
function patience() { return Math.min(CFG.patienceMax, CFG.patienceMin - Math.log(1 - Math.random()) * CFG.patienceExtraMean); }
const spawnAcc = new Map();

function spawn(dt) {
  const share = hourShare(G.t) / 60 * dt;
  for (const s of stations) {
    if (!isOpen(s)) continue;
    const base = s.on * CFG.demandScale * share;
    G.today.potential += base;
    const T = destTable.get(s.id);
    if (!T || !T.total) continue;
    let a = (spawnAcc.get(s.id) ?? Math.random()) + base * Math.min(1.5, T.served) * G.rep;
    while (a >= 1) {
      a -= 1;
      const x = Math.random() * T.total;
      let lo = 0, hi = T.cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (T.cum[m] < x) lo = m + 1; else hi = m; }
      const dest = T.list[lo];
      G.today.spawned++;
      if (!G.waiting.has(s.id)) G.waiting.set(s.id, []);
      G.waiting.get(s.id).push({ dest, start: G.t, patience: patience() });
    }
    spawnAcc.set(s.id, a);
  }
}

function fareFor(tier, km) { return Math.max(tier.fare[0], Math.round(km * tier.fare[1] / 100) * 100); }
function recordSat(waitMin, comfort) {
  const s = Math.min(100, comfort + (waitMin <= CFG.okWaitMin ? 100 : Math.max(0, 100 - (waitMin - CFG.okWaitMin) * 100 / (CFG.maxWaitMin - CFG.okWaitMin))));
  G.today.satSum += s; G.today.satN++;
}

// 열차: { id, kind, lvl, route, i(지금/마지막 역 번호), dir(±1), legT, legDur, dwell, pax:[{dest, j}] }
function nextIdx(t) {
  let dir = t.dir;
  const n = t.route.stops.length;
  if (t.i + dir < 0 || t.i + dir >= n) dir = -dir;
  return { j: t.i + dir, dir };
}
function arrive(t) {
  const r = t.route, sid = r.stops[t.i], tier = tierOf(t);
  let moved = 0;
  const stay = [];
  for (const p of t.pax) { if (p.j === t.i) { moved++; G.today.pax++; r.paxToday = (r.paxToday || 0) + 1; } else stay.push(p); }
  t.pax = stay;
  const { dir } = nextIdx(t);
  const q = G.waiting.get(sid);
  if (q && q.length) {
    const left = [];
    for (const p of q) {
      const j = r.idxOf.get(p.dest);
      if (j === undefined || (j - t.i) * dir <= 0) { left.push(p); continue; }
      if (t.pax.length >= tier.cap) {
        if (!p.leftBehind) { p.leftBehind = true; G.today.leftBehind++; r.leftToday = (r.leftToday || 0) + 1; }
        left.push(p); continue;
      }
      const fare = fareFor(tier, rideKm(r, t.i, j));
      G.money += fare; G.today.revenue += fare; r.revToday = (r.revToday || 0) + fare;
      recordSat(G.t - p.start, tier.comfort);
      t.pax.push({ dest: p.dest, j });
      moved++;
    }
    G.waiting.set(sid, left);
  }
  t.dwell = CFG.dwellBase + moved * CFG.dwellPerPax;
  // 종착역: 앞차가 방금 떠났으면 간격을 맞추려고 기다림
  if (t.i === 0 || t.i === r.stops.length - 1) {
    const n = routeTrains(r).length;
    if (n > 1) {
      r.lastDep = r.lastDep || {};
      const last = r.lastDep[t.i];
      const want = CFG.holdRatio * cycleMinutes(r) / n;
      if (last != null && G.t - last < want) t.dwell += Math.min(CFG.maxHoldMin, want - (G.t - last));
      r.lastDep[t.i] = G.t + t.dwell;
    }
  }
}
function startLeg(t) {
  const { j } = nextIdx(t);
  const leg = t.route.legs[Math.min(t.i, j)];
  t.legDur = legMinutes(leg, tierOf(t));
  t.legT = 0;
}
function stepTrains(dt) {
  for (const t of G.trains) {
    let rem = dt;
    while (rem > 0) {
      if (t.dwell > 0) { const u = Math.min(t.dwell, rem); t.dwell -= u; rem -= u; if (t.dwell <= 0) startLeg(t); continue; }
      if (t.legDur == null) startLeg(t);
      const need = t.legDur - t.legT;
      if (need > rem) { t.legT += rem; rem = 0; }
      else {
        rem -= need;
        const { j, dir } = nextIdx(t);
        const leg = t.route.legs[Math.min(t.i, j)], tier = tierOf(t);
        // 운행비: km당 + 고속선 사용료
        let c = leg.km * tier.perKm;
        for (const e of leg.edges) if (e.line.kind === 'hs') c += e.km * CFG.hsTrackFeePerKm;
        G.money -= c; G.today.cost += c; G.today.trainKm += leg.km; t.route.costToday = (t.route.costToday || 0) + c;
        t.i = j; t.dir = dir; t.legT = 0; t.legDur = null;
        arrive(t);
      }
    }
  }
}
function giveUps() {
  for (const [sid, q] of G.waiting) {
    if (!q.length) continue;
    const keep = q.filter(p => G.t - p.start <= p.patience);
    const n = q.length - keep.length;
    if (n) { G.today.gaveUp += n; G.today.satN += n; }
    G.waiting.set(sid, keep);
  }
}
function tick(dt) {
  spawn(dt);
  stepTrains(dt);
  giveUps();
  G.t += dt;
}
function satPct() { return G.today.satN ? G.today.satSum / G.today.satN : null; }

// 하루 마감: 고정비, 보상금, 평판. 결과 요약을 돌려줌
function closeDay() {
  const T = G.today;
  let fixed = 0;
  for (const t of G.trains) fixed += tierOf(t).perDay;
  G.money -= fixed; T.cost += fixed; T.fixed = fixed;
  const sat = satPct();
  const profit = T.revenue - T.cost;
  let pso = 0;
  if (profit < 0 && sat != null && sat >= CFG.psoMinSat) pso = Math.round(-profit * CFG.psoRatio);
  G.money += pso;
  const repBefore = G.rep;
  if (sat != null) {
    const target = CFG.repMin + (CFG.repMax - CFG.repMin) * (sat / 100);
    G.rep = Math.max(CFG.repMin, Math.min(CFG.repMax, G.rep + (target - G.rep) * CFG.repSpeed));
  }
  const res = { day: G.day, ...T, sat, profit, pso, cover: T.potential ? T.pax / T.potential * 100 : 0, repBefore, rep: G.rep, money: G.money };
  G.history.push({ day: G.day, pax: T.pax, revenue: T.revenue, cost: T.cost, pso, sat });
  if (G.history.length > 60) G.history.shift();
  return res;
}
function startNextDay() {
  G.day++; G.t = CFG.dayStartMin; G.today = newToday();
  G.waiting = new Map(); spawnAcc.clear();
  for (const t of G.trains) t.pax = [];
  for (const r of G.routes) { r.paxToday = 0; r.revToday = 0; r.costToday = 0; r.leftToday = 0; r.lastDep = {}; }
}

// ───────────────────────── 조작 ─────────────────────────
function trainValue(t) { const K = CFG.kinds[t.kind]; let v = K.price; for (let k = 1; k <= t.lvl; k++) v += K.levels[k].upgrade; return v; }
const sellValue = t => Math.round(trainValue(t) * CFG.sellRatio);
function buyTrain(kind, free = false) {
  const K = CFG.kinds[kind];
  if (!free) { if (G.money < K.price) return { err: '돈이 부족합니다' }; G.money -= K.price; G.today.bought += K.price; }
  const t = { id: G.nextTrainId++, kind, lvl: 0 };
  G.depot.push(t);
  return { t };
}
function upgradeTrain(t) {
  const L = CFG.kinds[t.kind].levels;
  if (t.lvl + 1 >= L.length) return { err: '최고 등급입니다' };
  const c = L[t.lvl + 1].upgrade;
  if (G.money < c) return { err: '돈이 부족합니다' };
  G.money -= c; t.lvl++;
  return {};
}
function sellTrain(t) { G.depot = G.depot.filter(x => x !== t); G.money += sellValue(t); }
// 배차 가능? 전철화가 필요한 등급인데 노선에 비전철 구간이 있으면 불가
function canDispatch(t, r) {
  if (t.kind !== r.kind) return `${CFG.kinds[r.kind].name} 노선에는 ${CFG.kinds[r.kind].name}만 넣을 수 있습니다`;
  if (needsElec(t.kind, t.lvl) && routeHasNonElec(r)) return `${tierOf(t).name}은(는) 전철화된 선로만 다닙니다`;
  if (!routeOpen(r)) return '노선에 아직 열지 않은 구간이 있습니다';
  return null;
}
function dispatch(t, r) {
  const err = canDispatch(t, r); if (err) return { err };
  G.depot = G.depot.filter(x => x !== t);
  // 운행 중인 열차와 가장 먼 종착역에서 출발
  const ts = routeTrains(r);
  const atEnd = ts.filter(o => o.dir === 1).length > ts.filter(o => o.dir === -1).length;
  Object.assign(t, { route: r, i: atEnd ? r.stops.length - 1 : 0, dir: atEnd ? -1 : 1, legT: 0, legDur: null, dwell: 0.5, pax: [] });
  G.trains.push(t);
  rebuildNetwork();
  return {};
}
function recall(t) {
  G.trains = G.trains.filter(x => x !== t);
  const keep = { id: t.id, kind: t.kind, lvl: t.lvl };
  G.depot.push(keep);
  rebuildNetwork();
  return keep;
}
function deleteRoute(r) {
  for (const t of routeTrains(r)) recall(t);
  G.routes = G.routes.filter(x => x !== r);
  rebuildNetwork();
}
// 정차역 바꾸기: 새 정차역 목록으로 경로 다시 계산
function setRouteStops(r, stops) {
  const legs = buildLegs(r.kind, stops);
  if (!legs) return { err: '이을 수 없는 역이 있습니다' };
  r.stops = stops; r.legs = legs;
  for (const t of routeTrains(r)) { t.i = Math.min(t.i, stops.length - 1); t.dir = t.i === stops.length - 1 ? -1 : t.dir; t.legT = 0; t.legDur = null; t.pax = []; }
  rebuildNetwork();
  return {};
}

// 지역 개방
function unlockRegion(id) {
  const c = CFG.unlockCost[id];
  if (G.unlocked.has(id)) return { err: '이미 열린 지역입니다' };
  if (G.money < c) return { err: '돈이 부족합니다' };
  G.money -= c; G.unlocked.add(id);
  rebuildNetwork();
  return {};
}
// 지역이 열린 지역과 선로로 이어져 있는지
function regionReachable(id) {
  for (const e of edges) {
    const ra = stations[e.a].region, rb = stations[e.b].region;
    if ((ra === id && G.unlocked.has(rb)) || (rb === id && G.unlocked.has(ra))) return true;
  }
  return false;
}

// 선로 개량
function openKm(l) { let s = 0; for (const e of l.edges) if (edgeOpen(e)) s += e.km; return s; }
function upgradeCost(l, what) {
  const km = openKm(l);
  if (what === 'elec') return lineElec(l) ? null : Math.round(km * CFG.elecPerKm / 100_000) * 100_000;
  if (what === 'dbl') return l.kind === 'hs' || lineDbl(l) ? null : Math.round(km * CFG.dblPerKm / 100_000) * 100_000;
  if (what === 'speed') return l.kind === 'hs' || lineVmax(l) + CFG.speedStep > CFG.speedMax ? null : Math.round(km * CFG.speedPerKm / 100_000) * 100_000;
  return null;
}
function upgradeLine(l, what) {
  const c = upgradeCost(l, what);
  if (c == null) return { err: '할 수 없는 개량입니다' };
  if (!openKm(l)) return { err: '열린 구간이 없습니다' };
  if (G.money < c) return { err: '돈이 부족합니다' };
  G.money -= c;
  const u = G.lineUp[l.id] = G.lineUp[l.id] || {};
  if (what === 'speed') u.speed = (u.speed || 0) + CFG.speedStep; else u[what] = true;
  for (const r of G.routes) r.legs = buildLegs(r.kind, r.stops) || r.legs; // 더 빠른 길이 생겼을 수 있음
  rebuildNetwork();
  return {};
}

// ───────────────────────── 저장 ─────────────────────────
const SAVE_KEY = 'korea-rail-save-v1';
function serialize() {
  return JSON.stringify({
    money: G.money, day: G.day, rep: G.rep, unlocked: [...G.unlocked], lineUp: G.lineUp,
    nextRouteNo: G.nextRouteNo, nextTrainId: G.nextTrainId, history: G.history,
    routes: G.routes.map(r => ({ no: r.no, kind: r.kind, color: r.color, stops: r.stops, name: r.name })),
    trains: G.trains.map(t => ({ id: t.id, kind: t.kind, lvl: t.lvl, route: t.route.no, i: t.i, dir: t.dir })),
    depot: G.depot.map(t => ({ id: t.id, kind: t.kind, lvl: t.lvl })),
  });
}
function deserialize(s) {
  const o = JSON.parse(s);
  Object.assign(G, { money: o.money, day: o.day, rep: o.rep, unlocked: new Set(o.unlocked), lineUp: o.lineUp || {},
    nextRouteNo: o.nextRouteNo, nextTrainId: o.nextTrainId, history: o.history || [], t: CFG.dayStartMin, today: newToday(), waiting: new Map() });
  G.routes = [];
  for (const r of o.routes) { const legs = buildLegs(r.kind, r.stops); if (legs) G.routes.push({ ...r, legs }); }
  G.trains = [];
  for (const t of o.trains) {
    const r = G.routes.find(x => x.no === t.route);
    if (r) G.trains.push({ id: t.id, kind: t.kind, lvl: t.lvl, route: r, i: Math.min(t.i, r.stops.length - 1), dir: t.dir, legT: 0, legDur: null, dwell: 0.5, pax: [] });
    else G.depot.push({ id: t.id, kind: t.kind, lvl: t.lvl });
  }
  G.depot = o.depot.concat(G.depot.filter(x => !o.depot.some(y => y.id === x.id)));
  rebuildNetwork();
}
function setupNewGame() {
  const st = CFG.starter;
  const r = addRoute(st.kind, st.stops.map(n => byName.get(n).id), st.name);
  dispatch(buyTrain(st.kind, true).t, r);
  for (const k of CFG.starterDepot) buyTrain(k, true);
}

root.SIM = { CFG, D, G, stations, byName, lines, edges, adj, regionName, toKm, distKm, isOpen, lineElec, lineDbl, lineVmax, edgeOpen, edgeCap,
  kindOf, tierOf, needsElec, edgeAllowed, findPath, buildLegs, addRoute, routeTitle, routeKm, routeHasNonElec, routeOpen, routeTrains,
  legMinutes, cycleMinutes, headway, rideMinutes, rideKm, rebuildNetwork, canRide, hourShare, peakAt, tick, satPct, closeDay, startNextDay,
  trainValue, sellValue, buyTrain, upgradeTrain, sellTrain, canDispatch, dispatch, recall, deleteRoute, setRouteStops, unlockRegion,
  regionReachable, openKm, upgradeCost, upgradeLine, fareFor, nextIdx, SAVE_KEY, serialize, deserialize, setupNewGame,
  get edgeLoad() { return edgeLoad; }, get edgeLoadFactor() { return edgeLoadFactor; }, get servedBy() { return servedBy; }, get destTable() { return destTable; },
  destWeights, weightTotal, PALETTE };
})(typeof window !== 'undefined' ? window : globalThis);
