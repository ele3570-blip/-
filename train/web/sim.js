'use strict';
// 전국 기차역 경영 — 시뮬레이션 (화면 없이도 돌아감: node에서 밸런스 점검용)
// 수요: 실제 역별 하루 평균 승차(2025, 코레일) × 시간대 비율 ÷ 10
(function (root) {
const D = root.GAME_DATA;

// ───────────────────────── 밸런스 설정 ─────────────────────────
const CFG = {
  startMoney: 45_000_000,
  startRegion: 'daegu',
  demandScale: 1 / 5,           // 실제 5명 = 게임 승객 1명
  sellRatio: 0.5,
  // 열차 종류 × 등급. cap = 정원(게임 승객), vmax = 최고속도(km/h)
  // stopLoss = 정차 1번에 가감속으로 잃는 시간(분), perKm = 운행 1km 비용, perDay = 운행 중일 때 하루 고정비
  // fare = [최저 요금, km당 요금], upgrade = 아래 등급에서 올리는 비용, elec = 전철화된 선로만
  kinds: {
    // 완행: 모든 역에 서는 옛 보통열차 계열. 싸고 느림. 비전철 선로 OK
    local: { name: '완행열차', icon: '🚂', price: 1_500_000, tracks: ['conv'], levels: [
      { name: '비둘기호', cap: 64, vmax: 110, stopLoss: 1.8, perKm: 80,  perDay: 12_000, fare: [1_500, 50], comfort: 0,  upgrade: 0,         color: '#64748b' },
      { name: '통일호',   cap: 72, vmax: 130, stopLoss: 2.0, perKm: 120, perDay: 20_000, fare: [2_000, 58], comfort: 5,  upgrade: 1_500_000, color: '#b45309' },
      { name: '무궁화호', cap: 80, vmax: 150, stopLoss: 2.5, perKm: 180, perDay: 30_000, fare: [2_600, 66], comfort: 10, upgrade: 2_500_000, color: '#2563eb' },
    ] },
    // 일반(특급): 새마을호(객차·비전철 OK) → 누리로부터는 전동차라 전철화 선로만
    general: { name: '일반열차', icon: '🚆', price: 6_000_000, tracks: ['conv'], levels: [
      { name: '새마을호',   cap: 72, vmax: 150, stopLoss: 2.2, perKm: 260, perDay: 45_000, fare: [3_200, 98], comfort: 15, upgrade: 0,         color: '#16a34a' },
      { name: '누리로',     cap: 80, vmax: 160, stopLoss: 1.6, perKm: 220, perDay: 42_000, fare: [3_200, 98], comfort: 16, upgrade: 3_000_000, color: '#ea580c', elec: true },
      { name: 'ITX-새마을', cap: 90, vmax: 180, stopLoss: 1.5, perKm: 200, perDay: 40_000, fare: [3_200, 98], comfort: 20, upgrade: 3_500_000, color: '#dc2626', elec: true },
      { name: 'ITX-마음',   cap: 100, vmax: 200, stopLoss: 1.4, perKm: 160, perDay: 35_000, fare: [3_200, 98], comfort: 25, upgrade: 4_000_000, color: '#7c3aed', elec: true },
    ] },
    metro: { name: '광역열차', icon: '🚈', price: 2_500_000, tracks: ['conv'], elec: true, levels: [
      { name: '광역전철 4량', cap: 120, vmax: 110, stopLoss: 1.0, perKm: 150, perDay: 40_000, fare: [1_500, 40], comfort: 0, upgrade: 0,         color: '#0d9488' },
      { name: '광역전철 6량', cap: 180, vmax: 130, stopLoss: 1.0, perKm: 210, perDay: 50_000, fare: [1_500, 40], comfort: 3, upgrade: 2_000_000, color: '#0891b2' },
      { name: '광역전철 8량', cap: 250, vmax: 150, stopLoss: 1.0, perKm: 270, perDay: 60_000, fare: [1_500, 40], comfort: 5, upgrade: 2_500_000, color: '#0369a1' },
    ] },
    ktx: { name: '고속열차', icon: '🚄', price: 40_000_000, tracks: ['hs', 'conv'], elec: true, levels: [
      { name: 'KTX',      cap: 72,  vmax: 280, stopLoss: 3.8, perKm: 1_800, perDay: 700_000, fare: [8_400, 145], comfort: 20, upgrade: 0,          color: '#334155' },
      { name: 'KTX-산천', cap: 82,  vmax: 300, stopLoss: 3.3, perKm: 1_650, perDay: 650_000, fare: [8_400, 150], comfort: 27, upgrade: 15_000_000, color: '#1e3a8a' },
      { name: 'KTX-이음', cap: 92,  vmax: 310, stopLoss: 2.2, perKm: 1_400, perDay: 560_000, fare: [8_400, 150], comfort: 32, upgrade: 20_000_000, color: '#0f766e' },
      { name: 'KTX-청룡', cap: 110, vmax: 330, stopLoss: 2.0, perKm: 1_700, perDay: 650_000, fare: [8_400, 155], comfort: 38, upgrade: 30_000_000, color: '#be185d' },
    ] },
  },
  hsTrackFeePerKm: 300,         // 고속선 선로 사용료(열차 1km당)
  dwellBase: 1.0, dwellPerPax: 0.02, // 역 정차 시간(분)
  avgSpeedFactor: { conv: 0.72, hs: 0.8 }, // 최고속도 대비 평균 속도
  // 선로 용량: 한 시간에 지나갈 수 있는 열차 수(양방향 합). 넘치면 그만큼 느려짐
  capSingle: 4, capDouble: 16, capHs: 24,
  // 선로 개량 비용(km당)
  elecPerKm: 100_000, dblPerKm: 150_000, speedPerKm: 80_000, speedStep: 30, speedMax: 200, speedMaxHs: 330, speedHsMul: 2, // 고속선도 고속화(330km/h까지, 비용 2배)
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
  // 시간표: 첫차·막차, 종착역 돌아서는 시간, 승객이 기다려 줄 수 있는 최대 시간(일반·통근), 역에 오는 시각(출발 몇 분 전), 늦은 편을 결행으로 보는 시간
  tt: { first: 330, last: 1380, turnMin: 5, maxWait: 150, maxWaitCommute: 45, appearBefore: 10, lateGrace: 20, onTimeMin: 5 },
  // 통근 수요(광역열차 전용): 코레일 승하차 자료에 거의 없는 짧은 출퇴근 이동을 더함
  //  두 역 하루(게임) 통근 = k × √(승차A × 승차B) × e^(−거리/decayKm) × 배차 배율(0.1 + 0.9·e^(−배차/freqMin))
  //  minKm~maxKm 사이만. 출퇴근 시간(7~9시, 17~19시)에 몰림
  //  승하차 자료에 거의 안 잡히는 도시 역 보정: 통근 계산에서만 광역시 구(○○구)에 있는 역은 최소 cityFloor, 그 밖은 townFloor
  commute: { k: 0.05, decayKm: 25, minKm: 4, maxKm: 70, freqMin: 30, cityFloor: 2000, townFloor: 300,
    hourly: [0.01, 0.04, 0.12, 0.16, 0.10, 0.04, 0.035, 0.035, 0.035, 0.035, 0.04, 0.05, 0.10, 0.13, 0.06, 0.03, 0.02, 0.01, 0.005] },
  // 회사 레벨: 누적 운임 수입으로 오르고, 레벨마다 열차·지역·공사가 풀림
  levels: [
    { need: 0,                desc: '비둘기호 · 광역전철 4량 · 대구권·경북 동해안·경북 북부·경남 지역' },
    { need: 150_000_000,      desc: '부산·울산 지역 · 통일호' },
    { need: 400_000_000,      desc: '전철화 공사 · 무궁화호 · 새마을호' },
    { need: 1_000_000_000,    desc: '광역전철 6량 · 복선화 공사 · 충북 지역 · 누리로' },
    { need: 2_500_000_000,    desc: '대전·충남·세종 지역' },
    { need: 5_000_000_000,    desc: 'KTX(전철화된 일반선만) · ITX-새마을' },
    { need: 10_000_000_000,   desc: '고속선 구간 구입 · KTX-산천' },
    { need: 20_000_000_000,   desc: '수도권 지역 · KTX-이음' },
    { need: 40_000_000_000,   desc: 'ITX-마음 · 고속화 공사 · 강원 지역' },
    { need: 70_000_000_000,   desc: '광역전철 8량 · 전북 지역' },
    { need: 120_000_000_000,  desc: '광주·전남 지역' },
    { need: 200_000_000_000,  desc: 'KTX-청룡' },
  ],
  // 필요한 레벨(1부터). 열차는 '종류:등급'
  gate: {
    train: { 'local:0': 1, 'local:1': 2, 'local:2': 3, 'general:0': 3, 'general:1': 4, 'general:2': 6, 'general:3': 9,
             'metro:0': 1, 'metro:1': 4, 'metro:2': 10, 'ktx:0': 6, 'ktx:1': 7, 'ktx:2': 8, 'ktx:3': 12 },
    region: { daegu: 1, gyeongbuk_e: 1, gyeongbuk_n: 1, gyeongnam: 1, busan: 2, chungbuk: 4, chungcheong: 5, capital: 8, gangwon: 9, jeonbuk: 10, jeonnam: 11 },
    work: { elec: 3, dbl: 4, speed: 9 },
    hs: 7,
  },
  loanLevelMul: [0.5, 0.6, 0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.7, 1.9, 2.1, 2.3], // 대출 한도 × 레벨 배율
  startDate: [2026, 1, 1], // 1일째 = 2026년 1월 1일. 실제 달력(달마다 28~31일), 달이 끝나면 월 결산
  // 은행 대출. 한도 = (기본 + 자산 × 비율) × 등급 배율, 이자는 하루 결산 때 남은 빚 × 하루 이자율
  loan: {
    base: 30_000_000, assetRatio: 0.5, step: 10_000_000,
    grades: {
      A: { rate: 0.002, limitMul: 1.2, desc: '최근 7일 흑자, 만족도 70% 이상' },
      B: { rate: 0.003, limitMul: 1.0, desc: '최근 7일 흑자' },
      C: { rate: 0.0045, limitMul: 0.8, desc: '기록이 없거나 적자지만 만족도 50% 이상' },
      D: { rate: 0.007, limitMul: 0, desc: '적자에 만족도 50% 미만, 또는 자금이 마이너스' },
    },
    graceDays: 3, // 자금이 마이너스인 채로 이만큼 하루를 마치면 강제 매각
  },
  // 지역을 연 뒤에도 쓰려는 선로 구간과 역을 따로 사야 함
  unlockCost: { gyeongbuk_e: 8_000_000, gyeongbuk_n: 5_000_000, busan: 15_000_000, gyeongnam: 8_000_000,
                chungcheong: 40_000_000, chungbuk: 20_000_000, capital: 120_000_000, gangwon: 30_000_000,
                jeonbuk: 30_000_000, jeonnam: 40_000_000 },
  // 선로 구간(노선 × 지역) 가격 = km × 단가. 개량을 마친 노선이면 개량비도 함께
  secPerKm: { conv: 60_000, hs: 150_000 }, secMin: 500_000,
  // 역 가격 = 기본 + 실제 하루 승차 × 단가 (10만원 단위)
  stationBase: 300_000, stationPerRider: 500,
  // 환승: 갈아타는 데 걸리는 시간(분)과 수요 배율
  transferMin: 10, transferQuality: 0.8, maxTransferOpts: 3,
  // 건설 중·계획 노선(추후 업데이트 예정)
  future: [
    { name: '충청권 광역철도 1단계', where: '계룡–대전–신탄진', state: '공사 중' },
    { name: '부전–마산 복선전철', where: '부산 부전–창원 마산', state: '공사 중' },
    { name: '남부내륙철도', where: '김천–진주–거제', state: '공사 중' },
    { name: '대구산업선', where: '서대구–대구국가산단', state: '공사 중' },
    { name: '광주–나주 광역철도', where: '광주–나주', state: '계획' },
  ],
  // 시작: 동대구역 + 경부선 대구권 구간 + 차량기지에 무궁화호 1대. 노선은 없음
  starter: { stations: ['동대구'], sections: ['gyeongbu@daegu'], depot: ['local'] }, // 시작: 동대구역 + 비둘기호 1대
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
    // 화면용 모양(km 좌표, a → b). 실제 선로가 없으면 직선. len[i] = 시작점부터 i번째 점까지 길이
    const A = stations[e.a], B = stations[e.b];
    e.P = l.geom && l.geom[k] ? l.geom[k].map(([lon, lat]) => toKm(lon, lat)) : [[A.x, A.y], [B.x, B.y]];
    e.len = [0]; for (let i = 1; i < e.P.length; i++) e.len.push(e.len[i - 1] + Math.hypot(e.P[i][0] - e.P[i - 1][0], e.P[i][1] - e.P[i - 1][1]));
    edges.push(e); l.edges.push(e);
    adj[e.a].push(e); adj[e.b].push(e);
  }
  l.totalKm = l.km.reduce((a, b) => a + b, 0);
}
// 선로 구간 = 노선 × 지역. 지역 경계를 넘는 엣지는 양쪽 구간에 함께 속하고, 둘 다 사야 쓸 수 있음
const sections = [], secById = new Map();
for (const l of lines) {
  l.sections = [];
  for (const e of l.edges) {
    const regs = [...new Set([stations[e.a].region, stations[e.b].region])];
    e.secs = regs.map(rg => {
      const id = `${l.id}@${rg}`;
      let sec = secById.get(id);
      if (!sec) { sec = { id, line: l, region: rg, edges: [], km: 0 }; secById.set(id, sec); sections.push(sec); l.sections.push(sec); }
      sec.edges.push(e); sec.km += e.km / regs.length;
      return sec;
    });
  }
}

// ───────────────────────── 상태 ─────────────────────────
// 새 게임 상태(처음 값). resetGame()에서도 씀
const freshState = () => ({
  money: CFG.startMoney, day: 1, t: CFG.dayStartMin, speed: 3, paused: false,
  unlocked: new Set([CFG.startRegion]),
  ownedSecs: new Set(), ownedSt: new Set(), // 산 선로 구간, 산 역
  lineUp: {},            // lineId → { elec, dbl, speed(+km/h) }
  routes: [], trains: [], depot: [], nextRouteNo: 1, nextTrainId: 1,
  waiting: new Map(),    // stationId → [passenger] (역에 와서 기다리는 승객)
  pend: [],              // 예매하고 아직 역에 안 온 승객
  today: null, rep: CFG.repStart, history: [],
  debt: 0, negDays: 0, over: false, // 빚, 자금이 마이너스로 끝난 날 수, 파산
  totalRev: 0, shownLevel: 1, // 누적 운임 수입(레벨), 화면에서 알린 레벨
  mon: null, // 이번 달 누계(월 결산)
});
const G = freshState();
// 회사 레벨
function levelOf(rev = G.totalRev) { let lv = 1; CFG.levels.forEach((x, i) => { if (rev >= x.need) lv = i + 1; }); return lv; }
const level = () => levelOf();
const levelNeed = lv => CFG.levels[lv - 1]?.need;
const needTrain = (kind, lvl) => CFG.gate.train[`${kind}:${lvl}`] || 1;
const lvErr = need => level() < need ? `회사 레벨 ${need}부터 할 수 있습니다 (지금 Lv${level()})` : null;
function newToday() { return { soldOut: 0, noRun: 0, cancel: 0, runsDone: 0, onTime: 0, delaySum: 0, commute: 0, commuteSpawned: 0, interest: 0, pax: 0, transfers: 0, revenue: 0, cost: 0, potential: 0, spawned: 0, satSum: 0, satN: 0, gaveUp: 0, leftBehind: 0, trainKm: 0, bought: 0 }; }
G.today = newToday();
// 달력: 실제 달력. day 1 = CFG.startDate
const WEEK = '일월화수목금토';
function dateOf(day = G.day) {
  const [y0, m0, d0] = CFG.startDate;
  const t = new Date(Date.UTC(y0, m0 - 1, d0 + day - 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: WEEK[t.getUTCDay()] };
}
const isMonthEnd = (day = G.day) => dateOf(day + 1).d === 1;
function newMonth() {
  return { startDay: G.day, days: 0, pax: 0, transfers: 0, gaveUp: 0, leftBehind: 0, potential: 0, revenue: 0, opCost: 0, fixed: 0,
    interest: 0, pso: 0, bought: 0, trainKm: 0, satSum: 0, satDays: 0, repStart: G.rep, moneyStart: G.money, debtStart: G.debt, sold: [], negMax: 0 };
}
G.mon = newMonth();

const isOpen = s => G.unlocked.has(s.region);
const lineElec = l => l.elec || !!G.lineUp[l.id]?.elec;
const lineDbl = l => l.dbl || !!G.lineUp[l.id]?.dbl;
const lineVmax = l => l.vmax + (G.lineUp[l.id]?.speed || 0);
const edgeOpen = e => isOpen(stations[e.a]) && isOpen(stations[e.b]);
const edgeOwned = e => e.secs.every(sc => G.ownedSecs.has(sc.id));
const stOwned = s => G.ownedSt.has(typeof s === 'number' ? s : s.id);
// 구간 평균 속도(km/h): 최고속도 그대로 계속 달리지는 못함(곡선·분기기·신호)
function edgeSpeed(e, vmax) { return Math.min(vmax, lineVmax(e.line)) * CFG.avgSpeedFactor[e.line.kind]; }
function edgeCap(e) { return e.line.kind === 'hs' ? CFG.capHs : lineDbl(e.line) ? CFG.capDouble : CFG.capSingle; }

const kindOf = t => CFG.kinds[t.kind];
const tierOf = t => kindOf(t).levels[t.lvl];
const needsElec = (kind, lvl) => !!(CFG.kinds[kind].elec || CFG.kinds[kind].levels[lvl].elec);
function edgeAllowed(e, kind, lvl = 0) {
  const K = CFG.kinds[kind];
  if (!K.tracks.includes(e.line.kind)) return false;
  if (e.line.kind === 'hs' && level() < CFG.gate.hs && !edgeOwned(e)) return false;
  if (needsElec(kind, lvl) && !lineElec(e.line)) return false;
  return true;
}

// ───────────────────────── 경로 찾기 ─────────────────────────
// 열차 종류가 다닐 수 있는 선로로 가장 빠른 길. 반환: { nodes:[역…], edges:[엣지…], km }
// any = true: 아직 안 산 구간도 지나감(살 구간을 알려 줄 때) / 'all': 안 연 지역까지 지나감(열어야 할 지역을 알려 줄 때)
function findPath(from, to, kind, any = false) {
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
      if ((any !== 'all' && !edgeOpen(e)) || !edgeAllowed(e, kind) || (!any && !edgeOwned(e))) continue;
      const w = e.a === u ? e.b : e.a;
      const nd = d + e.km / edgeSpeed(e, v) + 0.02; // 역을 지날 때 작은 벌점: 같은 시간이면 역이 적은 길
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
  if (stops.some(id => !stOwned(id))) return null;
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
function routeOpen(r) { return r.legs.every(l => l.edges.every(e => edgeOpen(e) && edgeOwned(e))); }
const routeTrains = r => G.trains.filter(t => t.route === r);

// 다리(leg) 소요 시간(분): 구간별 속도 = min(열차, 선로) ÷ 혼잡 + 가감속 손실
function legMinutes(leg, tier) {
  let m = 0;
  for (const e of leg.edges) m += e.km / edgeSpeed(e, tier.vmax) * 60 * (edgeLoadFactor.get(e.id) || 1);
  return m + tier.stopLoss;
}
function refTier(r) { const ts = routeTrains(r); return ts.length ? tierOf(ts[0]) : CFG.kinds[r.kind].levels[0]; }
// 한 바퀴(왕복) 시간과 한 방향 배차 간격
function cycleMinutes(r, tier = refTier(r)) {
  let m = 0;
  for (const leg of r.legs) m += legMinutes(leg, tier);
  return 2 * m + 2 * r.stops.length * (CFG.dwellBase + 0.3);
}
// 한 방향 배차 간격: 시간표의 평균 간격(열차 없으면 ∞)
function headway(r) {
  const n = routeTrains(r).length; if (!n) return Infinity;
  const d = r.T?.deps?.[0]; if (!d || d.length < 2) return d && d.length ? 240 : Infinity;
  return Math.min(240, (d[d.length - 1] - d[0]) / (d.length - 1));
}

// ───────────────────────── 시간표 ─────────────────────────
// 시간대(새벽·출근·낮·퇴근·밤)마다 배차 간격(분, 0 = 운행 안 함). 자동이면 열차 수에 맞춰 모든 시간대 같은 간격
const TT_BANDS = [
  { id: 'dawn', name: '새벽', from: 300, to: 420 }, { id: 'am', name: '출근', from: 420, to: 540 },
  { id: 'day', name: '낮', from: 540, to: 1020 }, { id: 'pm', name: '퇴근', from: 1020, to: 1140 }, { id: 'night', name: '밤', from: 1140, to: 1440 },
];
const NICE_HW = [5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240];
const defaultTT = () => ({ auto: true, first: CFG.tt.first, last: CFG.tt.last, hw: { dawn: 60, am: 60, day: 60, pm: 60, night: 60 } });
const ttOf = r => r.tt || (r.tt = defaultTT());
// 한쪽 종착역 출발 → 반대쪽 도착(분). 참고 열차 기준
function oneWayMin(r, tier = refTier(r)) { let m = 0; for (const l of r.legs) m += legMinutes(l, tier); return m + CFG.dwellBase * Math.max(0, r.stops.length - 2); }
function autoHw(r, n) { const raw = 2 * (oneWayMin(r) + CFG.tt.turnMin) / Math.max(1, n); return NICE_HW.find(x => x >= raw - 0.01) || 240; }
function bandAt(t) { return TT_BANDS.find(b => t >= b.from && t < b.to) || TT_BANDS[TT_BANDS.length - 1]; }
function depsOf(tt) {
  const out = []; let t = tt.first;
  while (t <= tt.last) { const b = bandAt(t), h = tt.hw[b.id]; if (!h) { t = b.to; continue; } out.push(Math.round(t)); t += h; }
  return out;
}
// 시간표를 돌리는 데 필요한 열차: 출발 순서대로 그 종착역에 준비된 열차를 쓰고, 없으면 한 대 더. starts = 열차마다 첫 편
function planTrains(deps, oneWay) {   // deps = [가는 방향 출발표, 오는 방향 출발표]
  const runs = [];
  for (let d = 0; d < 2; d++) deps[d].forEach((t, idx) => runs.push({ t, d, idx }));
  runs.sort((a, b) => a.t - b.t || a.d - b.d);
  const pool = [[], []], starts = [];
  for (const run of runs) {
    const p = pool[run.d], k = p.findIndex(x => x <= run.t + 1);   // 1분 여유(반올림·작은 지연)
    if (k >= 0) p.splice(k, 1); else starts.push(run);
    pool[1 - run.d].push(run.t + oneWay + CFG.tt.turnMin);
  }
  return { need: starts.length, starts };
}
// 노선 시간표 계산(바뀐 게 없으면 그대로 두어 예매·배정을 지킴)
let ttVer = 0;
function ttBuild(r) {
  const tt = ttOf(r), n = routeTrains(r).length;
  if (tt.auto) { const h = autoHw(r, n); for (const b of TT_BANDS) tt.hw[b.id] = h; }
  const tier = refTier(r), ow = oneWayMin(r, tier);
  const sig = JSON.stringify([tt, n, Math.round(ow), r.stops, tier.name]);
  if (r.T && r.T.sig === sig) return false;
  const L = r.legs.length, off = [[0], []];
  r.legs.forEach((l, k) => off[0].push(off[0][k] + legMinutes(l, tier) + CFG.dwellBase));
  off[1][L] = 0; for (let k = L - 1; k >= 0; k--) off[1][k] = off[1][k + 1] + legMinutes(r.legs[k], tier) + CFG.dwellBase;
  // 반대쪽 종착역 출발은 '도착 + 돌아서는 시간'만큼 밀어서, 열차가 왕복하며 빈틈없이 맞물리게
  const d0 = depsOf(tt), h0 = d0.length > 1 ? d0[1] - d0[0] : 60, shift = (ow + CFG.tt.turnMin) % h0;
  const d1 = d0.map(x => Math.round(x + shift)).filter(x => x <= Math.max(tt.last + shift, tt.last));
  const deps = [d0, d1], plan = planTrains(deps, ow);
  r.T = { sig, ver: ++ttVer, deps, off, oneWay: ow, need: plan.need, starts: plan.starts,
    taken: [new Set(), new Set()], cancel: [new Set(), new Set()], past: [new Set(), new Set()], load: [[], []] };
  // 하루 중간에 바뀌었으면 이미 지난 편은 결행으로 세지 않음
  for (let d = 0; d < 2; d++) deps[d].forEach((x, idx) => { if (x < G.t - 0.01 && G.t > CFG.dayStartMin) { r.T.cancel[d].add(idx); r.T.past[d].add(idx); } });
  // 이 노선 열차들: 가던 편은 시간표 없이 끝까지 가고, 서 있던 열차는 새 편 배정
  for (const t of routeTrains(r)) { if (t.run) t.run = { d: t.run.d, idx: -1 }; if (t.legDur == null && isTerminal(t)) t.run = null; }
  return true;
}
const isTerminal = t => t.i === 0 || t.i === t.route.stops.length - 1;
// 종착역에 선 열차에게 다음 편 주기(그 종착역에서 아직 아무도 안 맡은 가장 이른 편). 없으면 쉼
function assignNext(t, minGap = 0) {
  const r = t.route, T = r.T; if (!T || !isTerminal(t)) { t.run = null; return false; }
  const d = t.i === 0 ? 0 : 1;
  const D = T.deps[d];
  for (let idx = 0; idx < D.length; idx++) {
    if (T.taken[d].has(idx) || T.cancel[d].has(idx)) continue;
    if (D[idx] < G.t - CFG.tt.lateGrace) continue;             // 이미 한참 지난 편은 건너뜀(결행 처리됨)
    T.taken[d].add(idx);
    // 늦게 들어왔으면 최소한만 돌아서고 바로 출발(지연 운행)
    Object.assign(t, { run: { d, idx }, dir: d === 0 ? 1 : -1, dwell: Math.max(minGap ? Math.min(minGap, 2) : 0.01, D[idx] - G.t), legDur: null, legT: 0 });
    return true;
  }
  t.run = null; t.dwell = 0; return false;
}
// 하루 시작: 계획대로 열차를 종착역에 두고 첫 편 배정
function layoutRoute(r) {
  const T = r.T; if (!T) return;
  T.taken = [new Set(), new Set()]; T.cancel = [new Set(), new Set()]; T.load = [[], []];
  const ts = routeTrains(r), L = r.stops.length - 1;
  ts.forEach((t, k) => {
    const st = T.starts[k];
    Object.assign(t, { pax: [], legT: 0, legDur: null, run: null, dwell: 0 });
    if (!st) { t.i = 0; t.dir = 1; return; }        // 남는 열차: 1번 역에서 대기(빈 편이 생기면 나감)
    t.i = st.d === 0 ? 0 : L; t.dir = st.d === 0 ? 1 : -1;
    T.taken[st.d].add(st.idx);
    t.run = { d: st.d, idx: st.idx }; t.dwell = Math.max(0.01, T.deps[st.d][st.idx] - G.t);
  });
}
// 승객 예매: opts 중 희망 시각 t0 이후 가장 이른, 자리 남은 편. 반환 { r, d, idx, dep(이 역 출발), j, x, r2, a, b }
function bookRun(sid, dest, opts, t0, maxWait = CFG.tt.maxWait) {
  let best = null, sold = false;
  for (const o of opts) {
    const r = o.r; if (!r || !r.active || !r.T) continue;
    const i = r.idxOf.get(sid), j = r.idxOf.get(o.x ?? dest); if (i == null || j == null || i === j) continue;
    const d = j > i ? 0 : 1, T = r.T, off = T.off[d][i], cap = refTier(r).cap, a = Math.min(i, j), b = Math.max(i, j);
    for (let idx = 0; idx < T.deps[d].length; idx++) {
      const dep = T.deps[d][idx] + off; if (dep < t0) continue; if (best && dep >= best.dep) break;
      if (T.cancel[d].has(idx)) continue;
      const Ld = T.load[d][idx] || (T.load[d][idx] = new Uint16Array(r.legs.length));
      let ok = true; for (let k = a; k < b; k++) if (Ld[k] >= cap) { ok = false; break; }
      if (!ok) { sold = true; continue; }
      best = { r, ver: T.ver, d, idx, dep, j, a, b, x: o.x ?? null, r2: o.r2 ?? null }; break;
    }
  }
  if (sold) G.today.soldOut++;
  if (!best || best.dep - t0 > maxWait) return null;
  const Ld = best.r.T.load[best.d][best.idx]; for (let k = best.a; k < best.b; k++) Ld[k]++;
  return best;
}
function unbook(run) {
  if (!run || !run.r.T || run.r.T.ver !== run.ver) return;
  const Ld = run.r.T.load[run.d][run.idx]; if (Ld) for (let k = run.a; k < run.b; k++) if (Ld[k]) Ld[k]--;
}
// 예매한 승객을 출발 몇 분 전에 역에 나타나게(그 전에는 대기 목록에만)
function pend(sid, p) { p.sid = sid; p.since = Math.max(G.t, p.run.dep - CFG.tt.appearBefore); G.pend.push(p); }

// ───────────────────────── 네트워크 계산 ─────────────────────────
let edgeLoad = new Map();       // 엣지 → 시간당 열차 수(양방향)
let edgeLoadFactor = new Map(); // 엣지 → 느려지는 배율(≥1)
let servedBy = new Map();       // 역 → [노선]
let destTable = new Map();      // 출발역 → { list:[역], cum:[], total, served } (served = 이어진 목적지 비율 × 서비스 질)
let commuteTable = new Map();   // 출발역 → { list, cum, total(하루 통근 승객), map: d → { w, opts } }
const commuteSum = CFG.commute.hourly.reduce((a, b) => a + b, 0);
const spawnAccC = new Map();
const baseWeight = new Map();   // 출발역 → { d → 끌림 } (열린 역 전부)

function computeLoads() {
  edgeLoad = new Map(); edgeLoadFactor = new Map();
  for (const r of G.routes) {
    const n = routeTrains(r).length;
    if (!n) continue;
    // 혼잡 없는 상태로 한 바퀴 시간을 잼
    let m = 0; const tier = refTier(r);
    for (const leg of r.legs) for (const e of leg.edges) m += e.km / edgeSpeed(e, tier.vmax) * 60;
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
    // 역 i → j 시간 = |cumMin[j] - cumMin[i]| - 정차시간 (참고 열차 기준)
    const tier = refTier(r);
    r.cumMin = [0]; r.legs.forEach((l, k) => r.cumMin.push(r.cumMin[k] + legMinutes(l, tier) + CFG.dwellBase));
    ttBuild(r);
    r.hw = headway(r);
    for (const id of r.stops) { if (!servedBy.has(id)) servedBy.set(id, []); servedBy.get(id).push(r); }
  }
  const ride = (r, i, j) => Math.abs(r.cumMin[j] - r.cumMin[i]) - CFG.dwellBase;
  const kmOf = (r, i, j) => Math.abs(r.cumKm[j] - r.cumKm[i]);
  for (const [oid, rs] of servedBy) {
    const o = stations[oid];
    // 바로 가는 곳: d → { min, km, invH, opts:[{r}] }
    const best = new Map();
    for (const r of rs) {
      const i = r.idxOf.get(oid);
      r.stops.forEach((did, j) => {
        if (j === i) return;
        const b = best.get(did) || { min: Infinity, invH: 0, km: kmOf(r, i, j), opts: [] };
        b.min = Math.min(b.min, ride(r, i, j)); b.invH += 1 / r.hw; b.opts.push({ r });
        best.set(did, b);
      });
    }
    // 한 번 갈아타서 가는 곳: o →(r)→ x →(r2)→ d. 바로 가는 노선이 없는 목적지만
    const via = new Map();
    for (const r of rs) {
      const i = r.idxOf.get(oid);
      r.stops.forEach((x, j) => {
        if (j === i) return;
        const t1 = ride(r, i, j), km1 = kmOf(r, i, j);
        for (const r2 of servedBy.get(x)) {
          if (r2 === r) continue;
          const k = r2.idxOf.get(x), wait2 = CFG.transferMin + Math.min(r2.hw, 120) / 2;
          r2.stops.forEach((did, l) => {
            if (l === k || did === oid || best.has(did)) return;
            const tm = t1 + wait2 + ride(r2, k, l);
            const b = via.get(did);
            if (!b || tm < b.min) {
              const keep = b ? b.opts.filter(op => op.t < tm * 1.15) : [];
              via.set(did, { min: tm, km: km1 + kmOf(r2, k, l), invH: 1 / r.hw, transfer: true,
                opts: [{ r, x, r2, t: tm }, ...keep].slice(0, CFG.maxTransferOpts) });
            } else if (tm < b.min * 1.15 && b.opts.length < CFG.maxTransferOpts && !b.opts.some(op => op.r === r && op.r2 === r2)) {
              b.opts.push({ r, x, r2, t: tm });
            }
          });
        }
      });
    }
    for (const [d, b] of via) best.set(d, b);
    const W = destWeights(o), list = [], cum = []; let acc = 0;
    for (const [did, b] of best) {
      const w = W.get(did); if (!w) continue;
      acc += w * quality(b.min, b.km, 1 / b.invH) * (b.transfer ? CFG.transferQuality : 1);
      list.push(did); cum.push(acc);
    }
    const tot = weightTotal(o);
    destTable.set(oid, { list, cum, total: acc, served: tot ? acc / tot : 0, best });
  }
  // 통근 표: 광역열차 노선 위 역 쌍마다 하루 통근 승객(게임 승객 수)
  commuteTable = new Map();
  { const C = CFG.commute, add = (o, d, w, r) => {
      let T = commuteTable.get(o); if (!T) commuteTable.set(o, T = new Map());
      const e = T.get(d) || { w: 0, opts: [] }; e.w += w; if (!e.opts.some(x => x.r === r)) e.opts.push({ r }); T.set(d, e);
    };
    for (const r of G.routes) {
      if (!r.active || r.kind !== 'metro') continue;
      const q = 0.1 + 0.9 * Math.exp(-r.hw / C.freqMin);
      for (let i = 0; i < r.stops.length; i++) for (let j = i + 1; j < r.stops.length; j++) {
        const km = Math.abs(r.cumKm[j] - r.cumKm[i]); if (km < C.minKm || km > C.maxKm) continue;
        const A = stations[r.stops[i]], B = stations[r.stops[j]];
        const fl = x => Math.max(x.on, /구$/.test(x.si) ? C.cityFloor : C.townFloor);
        const w = C.k * Math.sqrt(fl(A) * fl(B)) * Math.exp(-km / C.decayKm) * q;
        add(A.id, B.id, w, r); add(B.id, A.id, w, r);
      }
    }
    for (const [o, T] of commuteTable) { const list = [], cum = []; let acc = 0; for (const [d, e] of T) { acc += e.w; list.push(d); cum.push(acc); } commuteTable.set(o, { list, cum, total: acc, map: T }); }
  }
  // 기다리는(또는 예매한) 승객: 시간표가 바뀐 노선이면 다시 예매, 갈 수 없으면 돌려보냄
  const rebook = (sid, p) => {
    if (p.run && G.routes.includes(p.run.r) && p.run.r.active && p.run.r.T && p.run.r.T.ver === p.run.ver) return true;
    if (p.fixed && G.routes.includes(p.fixed) && p.fixed.active && p.fixed.idxOf.has(sid) && p.fixed.idxOf.has(p.dest)) p.opts = [{ r: p.fixed }];
    else { p.fixed = null; p.opts = p.commute ? (commuteTable.get(sid)?.map.get(p.dest)?.opts || []) : planFrom(sid, p.dest); }
    if (!p.opts.length) return false;
    p.run = bookRun(sid, p.dest, p.opts, G.t, p.commute ? CFG.tt.maxWaitCommute : CFG.tt.maxWait);
    return !!p.run;
  };
  for (const [sid, q] of G.waiting) G.waiting.set(sid, q.filter(p => rebook(sid, p)));
  G.pend = G.pend.filter(p => rebook(p.sid, p) && (p.since = Math.max(G.t, p.run.dep - CFG.tt.appearBefore), true));
}
// 출발역에서 목적지까지 방법: [{ r, x?, r2? }] (x = 갈아타는 역)
function planFrom(sid, dest) { return destTable.get(sid)?.best.get(dest)?.opts || []; }

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
      // 시간표에서 가장 이른 탈 수 있는 편을 예매하고, 출발 몇 분 전에 역에 옴
      const opts = T.best.get(dest).opts, run = bookRun(s.id, dest, opts, G.t + 5);
      if (!run) { G.today.noRun++; continue; }
      pend(s.id, { dest, opts, run, start: G.t, patience: patience() });
    }
    spawnAcc.set(s.id, a);
  }
  // 통근 승객(광역열차 전용)
  const h = Math.floor(G.t / 60) - HOUR0, cs = (CFG.commute.hourly[Math.max(0, Math.min(CFG.commute.hourly.length - 1, h))] || 0) / commuteSum / 60 * dt;
  for (const [oid, T] of commuteTable) {
    if (!T.total) continue;
    let a = (spawnAccC.get(oid) ?? Math.random()) + T.total * cs * G.rep;
    while (a >= 1) {
      a -= 1;
      const x = Math.random() * T.total;
      let lo = 0, hi = T.cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (T.cum[m] < x) lo = m + 1; else hi = m; }
      const dest = T.list[lo];
      G.today.spawned++; G.today.commuteSpawned++;
      const opts = T.map.get(dest).opts, run = bookRun(oid, dest, opts, G.t + 5, CFG.tt.maxWaitCommute);
      if (!run) { G.today.noRun++; continue; }
      pend(oid, { dest, opts, run, start: G.t, patience: Math.min(40, patience()), commute: true });
    }
    spawnAccC.set(oid, a);
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
// 역에 도착: 내릴 승객 내리고(갈아탈 사람은 다음 편 예매), 탈 승객 태우고, 시간표보다 일찍 떠나지 않게 기다림
function arrive(t) {
  const r = t.route, sid = r.stops[t.i];
  let moved = 0;
  const stay = [];
  for (const p of t.pax) {
    if (p.j !== t.i) { stay.push(p); continue; }
    moved++;
    if (p.next) {
      const n = p.next;
      const ok = G.routes.includes(n) && n.active && n.idxOf.has(sid) && n.idxOf.has(p.dest);
      const opts = ok ? [{ r: n }] : planFrom(sid, p.dest).filter(o => !o.x);
      const run = opts.length ? bookRun(sid, p.dest, opts, G.t + 3) : null;
      if (!run) { G.today.gaveUp++; continue; }
      G.today.transfers++;
      pend(sid, { dest: p.dest, opts, run, fixed: ok ? n : null, start: p.start, patience: patience(), paid: true, transfer: true, commute: p.commute });
    } else { G.today.pax++; r.paxToday = (r.paxToday || 0) + 1; }
  }
  t.pax = stay;
  moved += board(t);
  t.dwell = CFG.dwellBase + moved * CFG.dwellPerPax;
  const end = t.run && ((t.run.d === 0 && t.i === r.stops.length - 1) || (t.run.d === 1 && t.i === 0));
  if (end) { // 편 끝: 정시 기록, 돌아서서 다음 편
    if (t.run.idx >= 0 && r.T) {
      const sched = r.T.deps[t.run.d][t.run.idx] + r.T.off[t.run.d][t.i] - CFG.dwellBase, late = G.t - sched;
      G.today.runsDone++; G.today.delaySum += Math.max(0, late); if (late <= CFG.tt.onTimeMin) G.today.onTime++;
    }
    t.dwell = 0; assignNext(t, CFG.tt.turnMin);
  } else if (t.run && t.run.idx >= 0 && r.T) {
    const sched = r.T.deps[t.run.d][t.run.idx] + r.T.off[t.run.d][t.i];
    t.dwell = Math.max(t.dwell, sched - G.t);               // 시간표보다 일찍 떠나지 않음
  }
}
// 이 역에서 이 열차(편)로 갈 승객 태우기. 태운 수를 돌려줌
function board(t) {
  const r = t.route, sid = r.stops[t.i], tier = tierOf(t), q = G.waiting.get(sid);
  if (!q || !q.length || !t.run) return 0;
  const dir = t.run.d === 0 ? 1 : -1;
  let moved = 0; const left = [];
  for (const p of q) {
    let j = null, x = null, r2 = null;
    if (p.run && p.run.r === r) {
      // 예매한 편이거나, 그 편이 결행·지연돼 같은 방향 뒷 편이 온 경우
      if (p.run.d === t.run.d && (p.run.idx <= t.run.idx || t.run.idx < 0 || p.run.ver !== r.T?.ver)) { j = p.run.j; x = p.run.x; r2 = p.run.r2; }
    } else if (!p.run) {
      for (const o of p.opts) { if (o.r !== r) continue; const jj = r.idxOf.get(o.x ?? p.dest); if (jj !== undefined && (jj - t.i) * dir > 0) { j = jj; x = o.x ?? null; r2 = o.r2 ?? null; break; } }
    }
    if (j == null || (j - t.i) * dir <= 0) { left.push(p); continue; }
    if (t.pax.length >= tier.cap) {
      stat(r, st => st.full++);
      if (!p.leftBehind) { p.leftBehind = true; G.today.leftBehind++; r.leftToday = (r.leftToday || 0) + 1; stat(r, st => st.leftU++); }
      left.push(p); continue;
    }
    const fare = fareFor(tier, rideKm(r, t.i, j));
    G.money += fare; G.today.revenue += fare; G.totalRev += fare; r.revToday = (r.revToday || 0) + fare;
    if (!p.paid) { p.paid = true; recordSat(G.t - p.start, tier.comfort); if (p.commute) G.today.commute++; }
    stat(r, st => { st.board++; st.waitSum += G.t - p.since; });
    t.pax.push({ dest: p.dest, j, next: x != null ? r2 : null, start: p.start, commute: p.commute });
    moved++;
  }
  G.waiting.set(sid, left);
  return moved;
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
      if (!t.run) { if (!assignNext(t)) break; }            // 맡은 편이 없으면 종착역에서 쉼(빈 편이 생기면 나감)
      if (t.dwell > 0) { const u = Math.min(t.dwell, rem); t.dwell -= u; rem -= u; if (t.dwell <= 0) { board(t); startLeg(t); } continue; }
      if (t.legDur == null) { board(t); startLeg(t); }
      const need = t.legDur - t.legT;
      if (need > rem) { t.legT += rem; rem = 0; }
      else {
        rem -= need;
        const { j, dir } = nextIdx(t);
        const leg = t.route.legs[Math.min(t.i, j)], tier = tierOf(t);
        let c = leg.km * tier.perKm;
        for (const e of leg.edges) if (e.line.kind === 'hs') c += e.km * CFG.hsTrackFeePerKm;
        G.money -= c; G.today.cost += c; G.today.trainKm += leg.km; t.route.costToday = (t.route.costToday || 0) + c;
        stat(t.route, st => { st.seatKm += leg.km * tier.cap; st.paxKm += leg.km * t.pax.length; st.peakLoad = Math.max(st.peakLoad, t.pax.length / tier.cap); });
        t.i = j; t.dir = dir; t.legT = 0; t.legDur = null;
        arrive(t);
      }
    }
  }
}
// 예매하고 기다리는 승객: 탈 편이 출발 예정보다 한참(참을성) 지나도 안 오면 포기. 예매 없는 승객은 기다린 시간으로
function giveUps() {
  for (const [sid, q] of G.waiting) {
    if (!q.length) continue;
    const keep = [];
    for (const p of q) {
      const limit = p.run ? p.run.dep + Math.max(CFG.tt.lateGrace, p.patience) : p.since + p.patience;
      if (G.t <= limit) { keep.push(p); continue; }
      unbook(p.run); const r = p.run?.r || p.opts?.[0]?.r; if (r) stat(r, st => st.gave++);
      G.today.gaveUp++; G.today.satN++;
    }
    G.waiting.set(sid, keep);
  }
}
// 예매한 승객이 역에 나타남(출발 몇 분 전)
function arrivePend() {
  if (!G.pend.length) return;
  const keep = [];
  for (const p of G.pend) {
    if (p.since > G.t) { keep.push(p); continue; }
    if (!G.waiting.has(p.sid)) G.waiting.set(p.sid, []);
    G.waiting.get(p.sid).push(p);
  }
  G.pend = keep;
}
// 출발 시각이 한참 지나도 맡은 열차가 없는 편 = 결행
function checkCancels() {
  for (const r of G.routes) {
    const T = r.T; if (!r.active || !T) continue;
    for (let d = 0; d < 2; d++) for (let idx = 0; idx < T.deps[d].length; idx++) {
      if (T.deps[d][idx] >= G.t - CFG.tt.lateGrace) break;
      if (T.taken[d].has(idx) || T.cancel[d].has(idx)) continue;
      T.cancel[d].add(idx); G.today.cancel++; r.cancelToday = (r.cancelToday || 0) + 1;
    }
  }
}
function tick(dt) {
  spawn(dt);
  arrivePend();
  stepTrains(dt);
  giveUps();
  checkCancels();
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
  // 대출 이자
  const grade = creditGrade();
  const interest = Math.round(G.debt * CFG.loan.grades[grade].rate);
  G.money -= interest; T.interest = interest;
  // 자금이 마이너스면 경고 → 강제 매각 → 파산
  const sold = [];
  if (G.money < 0) {
    G.negDays++;
    if (G.negDays >= CFG.loan.graceDays) {
      const pool = [...G.depot, ...G.trains].sort((a, b) => trainValue(b) - trainValue(a));
      for (const t of pool) {
        if (G.money >= 0) break;
        if (G.trains.includes(t)) recall(t);
        const dep = G.depot.find(x => x.id === t.id);
        sold.push({ label: `${CFG.kinds[dep.kind].icon} ${dep.no}호 ${CFG.kinds[dep.kind].levels[dep.lvl].name}`, value: sellValue(dep) });
        sellTrain(dep);
      }
      if (G.money < 0) G.over = true;
      else G.negDays = 0;
    }
  } else G.negDays = 0;
  const repBefore = G.rep;
  if (sat != null) {
    const target = CFG.repMin + (CFG.repMax - CFG.repMin) * (sat / 100);
    G.rep = Math.max(CFG.repMin, Math.min(CFG.repMax, G.rep + (target - G.rep) * CFG.repSpeed));
  }
  const res = { day: G.day, ...T, sat, profit, pso, grade, sold, negDays: G.negDays, over: G.over, debt: G.debt, cover: T.potential ? T.pax / T.potential * 100 : 0, repBefore, rep: G.rep, money: G.money };
  G.history.push({ day: G.day, pax: T.pax, revenue: T.revenue, cost: T.cost, pso, interest, sat });
  if (G.history.length > 60) G.history.shift();
  // 이번 달 누계
  const M = G.mon;
  M.days++; M.commute = (M.commute || 0) + T.commute; for (const k of ['runsDone', 'onTime', 'cancel', 'soldOut', 'noRun']) M[k] = (M[k] || 0) + (T[k] || 0); M.pax += T.pax; M.transfers += T.transfers; M.gaveUp += T.gaveUp; M.leftBehind += T.leftBehind; M.potential += T.potential;
  M.revenue += T.revenue; M.opCost += T.cost - fixed; M.fixed += fixed; M.interest += interest; M.pso += pso; M.bought += T.bought; M.trainKm += T.trainKm;
  if (sat != null) { M.satSum += sat; M.satDays++; }
  M.sold.push(...sold); M.negMax = Math.max(M.negMax, G.negDays);
  for (const r of G.routes) {
    const m = r.mon = r.mon || { pax: 0, rev: 0, cost: 0, left: 0 };
    m.pax += r.paxToday || 0; m.rev += r.revToday || 0; m.cost += r.costToday || 0; m.left += r.leftToday || 0;
  }
  res.monthEnd = isMonthEnd();
  return res;
}
// 월 결산 요약(달이 끝난 뒤 보여 주고 startMonth로 넘어감)
function monthReport() {
  const M = G.mon;
  const profit = M.revenue - M.opCost - M.fixed - M.interest + M.pso;
  const routes = G.routes.map(r => ({ r, ...(r.mon || { pax: 0, rev: 0, cost: 0, left: 0 }) })).sort((a, b) => (b.rev - b.cost) - (a.rev - a.cost));
  return { ...M, profit, sat: M.satDays ? M.satSum / M.satDays : null, cover: M.potential ? M.pax / M.potential * 100 : 0,
    rep: G.rep, money: G.money, debt: G.debt, grade: creditGrade(), routes, date: dateOf(M.startDay) };
}
function startMonth() { G.mon = newMonth(); G.mon.startDay = G.day; for (const r of G.routes) r.mon = { pax: 0, rev: 0, cost: 0, left: 0 }; }
function startNextDay() {
  G.day++; G.t = CFG.dayStartMin; G.today = newToday();
  G.waiting = new Map(); spawnAcc.clear();
  G.pend = [];
  for (const t of G.trains) t.pax = [];
  for (const r of G.routes) { r.yest = r.st; r.st = null; r.yestB = r.stB; r.stB = null; r.yestRev = r.revToday || 0; r.yestCost = r.costToday || 0; r.paxToday = 0; r.revToday = 0; r.costToday = 0; r.leftToday = 0; r.cancelToday = 0; r.lastDep = {}; }
  layoutAll();
}
// 모든 노선 열차를 시간표 첫 편에 맞춰 종착역에 배치
function layoutAll() { for (const r of G.routes) { if (r.active && r.T) layoutRoute(r); else for (const t of routeTrains(r)) Object.assign(t, { i: 0, dir: 1, run: null, dwell: 0, legDur: null, legT: 0, pax: [] }); } }

// ───────────────────────── 노선 진단: 열차가 더 필요한가 ─────────────────────────
// 노선 하루 기록: 좌석km·승객km(승차율), 탄 승객·대기 시간, 만석으로 못 탄 횟수, 기다리다 떠난 승객
const newSt = () => ({ seatKm: 0, paxKm: 0, peakLoad: 0, board: 0, waitSum: 0, full: 0, gave: 0, leftU: 0 });
function rs(r) { return r.st || (r.st = newSt()); }
// 하루 기록 + 시간대(새벽·출근·낮·퇴근·밤)별 기록. 추천 열차 수는 가장 붐비는 시간대 기준
function stat(r, f) { f(rs(r)); const B = r.stB || (r.stB = {}), id = bandAt(G.t).id; f(B[id] || (B[id] = newSt())); }
// 추천 열차 수: 이익이 가장 큰 대수
//  타려던 사람 D = 탄 + 만석으로 놓친 + 기다리다 떠난. 자주 다닐수록 D가 늘어남(수요 식의 배차 배율)
//  m대일 때 태울 수 있는 사람 = 지금 탄 사람 × (m/n) × (실제로 찰 수 있는 승차율 / 지금 승차율)
//  이익 = 태운 사람 × 1인 평균 운임 − m × 1대 비용. 선로 용량(다른 노선 몫 제외)을 넘지 않게
const FULL_OCC = 0.7;
function recommendTrains(r, n, occ, st, rev, cost) {
  const C = cycleMinutes(r);
  // 배차 배율: 광역열차는 통근 승객이 대부분이라 배차에 훨씬 민감(통근 식), 나머지는 일반 수요 식
  const fq = r.kind === 'metro' ? (h => 0.1 + 0.9 * Math.exp(-Math.min(h, 240) / CFG.commute.freqMin)) : (h => 0.35 + 0.85 * Math.exp(-Math.min(h, 240) / 90));
  const D = st.board + (st.leftU || 0) + st.gave;
  let nMax = Infinity;
  for (const leg of r.legs) for (const e of leg.edges) {
    const other = Math.max(0, (edgeLoad.get(e.id) || 0) - 2 * n * 60 / C);
    nMax = Math.min(nMax, Math.floor((edgeCap(e) - other) * C / 120));
  }
  nMax = Math.max(1, nMax);
  const fare = rev / Math.max(1, st.board), c1 = cost / n;
  let best = { m: 1, p: -Infinity };
  for (let m = 1; m <= Math.min(300, nMax); m++) {
    const want = D * fq(C / m) / fq(C / n);
    const seats = st.board * (m / n) * (FULL_OCC / Math.max(0.05, occ));
    const p = Math.min(want, seats) * fare - m * c1;
    if (p > best.p + 1) best = { m, p };
  }
  return { rec: best.m, nMax, recProfit: best.p, capped: best.m >= nMax };
}
// 판정: 오늘 기록이 적으면(오전) 어제 기록으로
function routeDiag(r) {
  const n = routeTrains(r).length;
  if (!n) return { level: 'none', label: '열차 없음', icon: '⚪', advice: '열차를 배차하세요' };
  // 직접 짠 시간표인데 열차가 모자라면: 결행이 생김
  if (r.tt && !r.tt.auto && r.T && n < r.T.need)
    return { level: 'more', icon: '🔴', label: '열차 부족(결행)', advice: `이 시간표는 열차 ${r.T.need}대가 필요한데 ${n}대뿐이라 결행이 생깁니다. 열차를 늘리거나 시간표 간격을 넓히세요`, n, rec: r.T.need, nMax: Infinity };
  const today = r.st, useY = (!today || today.board < 20) && r.yest && r.yest.board >= 20;
  const st = useY ? r.yest : today;
  if (!st || st.board < 5) return { level: 'wait', label: '집계 중', icon: '⏳', advice: '운행 기록이 쌓이면 알려 드립니다', n };
  const occ = st.seatKm ? st.paxKm / st.seatKm : 0, wait = st.board ? st.waitSum / st.board : 0;
  const gaveRate = st.gave / Math.max(1, st.gave + st.board), fullRate = st.full / Math.max(1, st.board);
  const hw = headway(r), hw1 = cycleMinutes(r) / (n + 1), hwm = n > 1 ? cycleMinutes(r) / (n - 1) : Infinity;
  // 운임·비용: 같은 날 기록(오늘이면 지금까지, 어제면 하루치). 고정비는 지난 시간 비율만큼
  const dayFrac = useY ? 1 : Math.max(0.05, (G.t - CFG.dayStartMin) / (CFG.dayEndMin - CFG.dayStartMin));
  const rv = useY ? (r.yestRev || 0) : (r.revToday || 0), cs = (useY ? (r.yestCost || 0) : (r.costToday || 0)) + routeTrains(r).reduce((a, t) => a + tierOf(t).perDay, 0) * dayFrac;
  const base = { n, occ, wait, gaveRate, fullRate, st, hw, hw1, hwm, from: useY ? '어제' : '오늘', ...recommendTrains(r, n, occ, st, rv, cs) };
  // 하루 중 가장 많이 필요한 시간대 기준(어제 하루 + 오늘 지금까지). 시간대마다 그 시간대 몫의 비용으로 이익이 가장 큰 대수
  { const hasY = r.yest && r.yest.board >= 20; // 운임·하루 비용은 하루를 다 채운 어제 기록이 있으면 그것으로(아침 기록은 비용이 덜 잡힘)
    const fare = hasY ? (r.yestRev || 0) / r.yest.board : rv / Math.max(1, st.board);
    const dayCost = hasY ? (r.yestCost || 0) + routeTrains(r).reduce((a, t) => a + tierOf(t).perDay, 0) : cs / dayFrac, dayLen = CFG.dayEndMin - CFG.dayStartMin, cur = bandAt(G.t).id;
    let peak = null;
    for (const [B, isT] of [[r.yestB, false], [r.stB, true]]) if (B) for (const b of TT_BANDS) {
      const x = B[b.id]; if (!x || x.board < (isT && b.id === cur ? 20 : 10)) continue;
      const bl = Math.max(30, Math.min(b.to, CFG.dayEndMin) - Math.max(b.from, CFG.dayStartMin));
      const o = recommendTrains(r, n, x.seatKm ? x.paxKm / x.seatKm : occ, x, fare * x.board, dayCost * bl / dayLen);
      if (!peak || o.rec > peak.rec) peak = { ...o, band: b.name };
    }
    if (peak && peak.rec > base.rec) Object.assign(base, { rec: peak.rec, capped: peak.capped, peakBand: peak.band }); }
  // 판정은 추천 대수와 같은 방향으로: 추천이 지금보다 많으면 부족, 적으면 남음
  const { rec } = base, diff = rec - n, near = Math.abs(diff) <= Math.max(1, Math.round(n * 0.15));
  const lossy = base.recProfit < 0;
  if (!near && diff > 0)
    return fullRate > 0.05
      ? { ...base, level: 'more', icon: '🔴', label: '열차 부족(만석)', advice: `만석이라 못 탄 승객이 있습니다. 약 ${rec}대로 늘리면 이익이 가장 큽니다(배차 ${Math.round(hw)}분 → ${Math.round(cycleMinutes(r) / rec)}분)` }
      : { ...base, level: 'more', icon: '🟠', label: '배차 간격이 김', advice: `기다리다 떠나는 승객이 ${Math.round(gaveRate * 100)}%입니다. 약 ${rec}대로 늘리면 배차 ${Math.round(hw)}분 → ${Math.round(cycleMinutes(r) / rec)}분` };
  if (!near && diff < 0)
    return { ...base, level: 'less', icon: '🟡', label: '열차가 남음', advice: `승차율이 ${Math.round(occ * 100)}%입니다. 약 ${rec}대로 줄여도 승객은 거의 그대로고 비용이 줄어듭니다` };
  if (lossy)
    return { ...base, level: 'low', icon: '🟡', label: '적자 노선', advice: `열차 수를 바꿔도 적자입니다. 큰 역까지 늘리거나 정차역을 바꿔 보세요` };
  return { ...base, level: 'ok', icon: '🟢', label: '적당', advice: `지금 열차 수가 알맞습니다(추천 약 ${rec}대)` };
}

// ───────────────────────── 조작 ─────────────────────────
function trainValue(t) { const K = CFG.kinds[t.kind]; let v = K.price; for (let k = 1; k <= t.lvl; k++) v += K.levels[k].upgrade; return v; }
const sellValue = t => Math.round(trainValue(t) * CFG.sellRatio);
// 차량 번호(호차): 열차 종류별로 1호부터. 판 번호는 비워 두었다가 다음에 산 열차가 씀(가장 작은 빈 번호)
function freeNo(kind) {
  const used = new Set([...G.trains, ...G.depot].filter(t => t.kind === kind).map(t => t.no));
  let n = 1; while (used.has(n)) n++; return n;
}
// 예전 저장처럼 번호가 없는 열차에 종류별로 번호 매기기(구입 순서대로)
function numberTrains() {
  const all = [...G.trains, ...G.depot].sort((a, b) => a.id - b.id);
  for (const t of all) if (!t.no) t.no = freeNo(t.kind);
}
function buyTrain(kind, free = false) {
  const K = CFG.kinds[kind];
  if (!free) { const e = lvErr(needTrain(kind, 0)); if (e) return { err: `${K.levels[0].name}: ${e}` }; }
  if (!free) { if (G.money < K.price) return { err: '돈이 부족합니다' }; G.money -= K.price; G.today.bought += K.price; }
  const t = { id: G.nextTrainId++, kind, lvl: 0, no: freeNo(kind) };
  G.depot.push(t);
  return { t };
}
// 등급 올리기: 차량기지에서도, 운행 중에도. 운행 중이면 다음 등급이 노선을 다닐 수 있어야 함
function upgradeBlock(t) {
  const L = CFG.kinds[t.kind].levels;
  if (t.lvl + 1 >= L.length) return '최고 등급입니다';
  { const e = lvErr(needTrain(t.kind, t.lvl + 1)); if (e) return `${L[t.lvl + 1].name}: ${e}`; }
  if (G.trains.includes(t) && needsElec(t.kind, t.lvl + 1) && routeHasNonElec(t.route))
    return `${L[t.lvl + 1].name}은(는) 전철화된 선로만 다닙니다. 노선에 비전철 구간이 있어 운행 중에는 올릴 수 없습니다`;
  return null;
}
function upgradeTrain(t) {
  const why = upgradeBlock(t); if (why) return { err: why };
  const c = CFG.kinds[t.kind].levels[t.lvl + 1].upgrade;
  if (G.money < c) return { err: '돈이 부족합니다' };
  G.money -= c; G.today.bought += c; t.lvl++;
  if (G.trains.includes(t)) rebuildNetwork(); // 운행 중: 속도·정원이 바뀜 → 수요 다시 계산 (지금 달리는 구간은 다음 역부터 새 속도)
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
// ── 노선 한 바퀴 위의 위치(분) ──
// 한 바퀴 = 가는 구간 0..L-1, 오는 구간 L-1..0. 구간 길이 = 그 구간 달리는 시간 + 정차
function cycleSegs(r, tier) {
  const L = r.legs.length, segs = [];
  for (let k = 0; k < L; k++) segs.push({ k, dir: 1, d: legMinutes(r.legs[k], tier) + CFG.dwellBase });
  for (let k = L - 1; k >= 0; k--) segs.push({ k, dir: -1, d: legMinutes(r.legs[k], tier) + CFG.dwellBase });
  return segs;
}
function cyclePos(t, segs) {
  const L = t.route.legs.length, { j, dir } = nextIdx(t);
  const k = Math.min(t.i, j), idx = dir === 1 ? k : L + (L - 1 - k);
  let p = 0; for (let x = 0; x < idx; x++) p += segs[x].d;
  return p + (t.legDur == null ? 0 : Math.min(t.legT, segs[idx].d));
}
function placeAt(t, r, p, segs) {
  const C = segs.reduce((a, x) => a + x.d, 0);
  p = ((p % C) + C) % C;
  let idx = 0; while (idx < segs.length - 1 && p >= segs[idx].d) { p -= segs[idx].d; idx++; }
  const sg = segs[idx], leg = r.legs[sg.k];
  const dur = legMinutes(leg, tierOf(t));
  Object.assign(t, { route: r, i: sg.dir === 1 ? sg.k : sg.k + 1, dir: sg.dir, legDur: dur, legT: Math.min(p, dur - 0.01), dwell: 0 });
}
function dispatch(t, r) {
  const err = canDispatch(t, r); if (err) return { err };
  G.depot = G.depot.filter(x => x !== t);
  Object.assign(t, { route: r, pax: [], legT: 0, legDur: null, dwell: 0, run: null, i: 0, dir: 1 });
  G.trains.push(t);
  rebuildNetwork();                 // 시간표 다시(자동이면 간격이 촘촘해짐)
  // 아직 아무도 안 맡은 가장 이른 편이 있는 종착역에 세움
  const T = r.T, L = r.stops.length - 1;
  if (T) {
    let best = null;
    for (let d = 0; d < 2; d++) for (let idx = 0; idx < T.deps[d].length; idx++) {
      if (T.taken[d].has(idx) || T.cancel[d].has(idx) || T.deps[d][idx] < G.t) continue;
      if (!best || T.deps[d][idx] < best.t) best = { d, t: T.deps[d][idx] }; break;
    }
    if (best) { t.i = best.d === 0 ? 0 : L; t.dir = best.d === 0 ? 1 : -1; }
    assignNext(t);
  }
  return {};
}
// 노선 열차들을 시간표에 맞춰 종착역에 다시 배치(타고 있던 승객은 도착 처리)
function respaceRoute(r) {
  for (const t of routeTrains(r)) { G.today.pax += t.pax.length; t.pax = []; }
  if (r.T) { const keepCancel = r.T.cancel, keepPast = r.T.past; layoutRoute(r); r.T.cancel = keepCancel; r.T.past = keepPast; }
  return {};
}
// 노선 열차 간격이 얼마나 고른지: 가장 긴 간격 ÷ 고른 간격 (1 = 완전히 고름)
function spacingRatio(r) {
  const ts = routeTrains(r); if (ts.length < 2) return 1;
  const segs = cycleSegs(r, refTier(r)), C = segs.reduce((a, x) => a + x.d, 0);
  const ps = ts.map(o => cyclePos(o, segs)).sort((a, b) => a - b);
  let mx = 0; ps.forEach((p, k) => { mx = Math.max(mx, (k + 1 < ps.length ? ps[k + 1] : ps[0] + C) - p); });
  return mx / (C / ts.length);
}
function recall(t) {
  G.trains = G.trains.filter(x => x !== t);
  const keep = { id: t.id, kind: t.kind, lvl: t.lvl, no: t.no };
  G.depot.push(keep);
  for (const p of t.pax) { G.today.pax++; }       // 타고 있던 승객은 도착 처리
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
  if (stops.some(id => !stOwned(id))) return { err: '사지 않은 역이 있습니다' };
  const legs = buildLegs(r.kind, stops);
  if (!legs) return { err: '이을 수 없는 역이 있습니다' };
  r.stops = stops; r.legs = legs;
  for (const t of routeTrains(r)) { t.i = Math.min(t.i, stops.length - 1); t.dir = t.i === stops.length - 1 ? -1 : t.dir; t.legT = 0; t.legDur = null; t.pax = []; }
  rebuildNetwork();
  return {};
}

// 역·선로 구간 구입
const r100k = x => Math.round(x / 100_000) * 100_000;
function stationPrice(s) { return r100k(CFG.stationBase + s.on * CFG.stationPerRider); }
function buyStation(s, free = false) {
  if (stOwned(s)) return { err: '이미 산 역입니다' };
  if (!isOpen(s)) return { err: '아직 열지 않은 지역의 역입니다' };
  const c = free ? 0 : stationPrice(s);
  if (G.money < c) return { err: `돈이 부족합니다 (${s.name}역 ${Math.round(c / 1e4).toLocaleString()}만원)` };
  G.money -= c; G.today.bought += c; G.ownedSt.add(s.id);
  return {};
}
function sectionPrice(sec) {
  const l = sec.line, u = G.lineUp[l.id] || {};
  let per = CFG.secPerKm[l.kind];
  if (u.elec && !l.elec) per += CFG.elecPerKm;           // 이미 개량한 노선이면 이 구간 개량비도
  if (u.dbl && !l.dbl) per += CFG.dblPerKm;
  if (u.speed) per += u.speed / CFG.speedStep * CFG.speedPerKm * (l.kind === 'hs' ? CFG.speedHsMul : 1);
  return Math.max(CFG.secMin, r100k(sec.km * per));
}
const secOwned = sec => G.ownedSecs.has(sec.id);
function buySection(sec, free = false) {
  if (secOwned(sec)) return { err: '이미 산 구간입니다' };
  if (!G.unlocked.has(sec.region)) return { err: '아직 열지 않은 지역입니다' };
  if (!free && sec.line.kind === 'hs') { const e = lvErr(CFG.gate.hs); if (e) return { err: `고속선: ${e}` }; }
  const c = free ? 0 : sectionPrice(sec);
  if (G.money < c) return { err: '돈이 부족합니다' };
  G.money -= c; G.today.bought += c; G.ownedSecs.add(sec.id);
  for (const r of G.routes) r.legs = buildLegs(r.kind, r.stops) || r.legs;
  rebuildNetwork();
  return {};
}
// 경로에서 아직 안 산 구간
function missingSections(path) {
  const need = new Map();
  for (const e of path.edges) for (const sc of e.secs) if (!secOwned(sc)) need.set(sc.id, sc);
  return [...need.values()];
}
function buySections(list) {
  const total = list.reduce((a, sc) => a + sectionPrice(sc), 0);
  if (list.some(sc => !G.unlocked.has(sc.region))) return { err: '아직 열지 않은 지역을 지나야 합니다' };
  if (list.some(sc => sc.line.kind === 'hs')) { const e = lvErr(CFG.gate.hs); if (e) return { err: `고속선: ${e}` }; }
  if (G.money < total) return { err: '돈이 부족합니다' };
  for (const sc of list) { G.money -= sectionPrice(sc); G.today.bought += sectionPrice(sc); G.ownedSecs.add(sc.id); }
  for (const r of G.routes) r.legs = buildLegs(r.kind, r.stops) || r.legs;
  rebuildNetwork();
  return {};
}

// ───────── 은행 ─────────
// 자산 = 열차(구입+등급) + 산 역 + 산 선로 구간 (지금 가격)
function assetValue() {
  let v = 0;
  for (const t of [...G.trains, ...G.depot]) v += trainValue(t);
  for (const id of G.ownedSt) v += stationPrice(stations[id]);
  for (const id of G.ownedSecs) v += sectionPrice(secById.get(id));
  return v;
}
// 신용등급: 최근 7일 손익(이자 포함)과 만족도
function creditGrade() {
  if (G.money < 0 || G.negDays > 0) return 'D';
  const h = G.history.slice(-7);
  if (!h.length) return 'C';
  const profit = h.reduce((a, x) => a + x.revenue - x.cost + (x.pso || 0) - (x.interest || 0), 0);
  const sats = h.filter(x => x.sat != null), sat = sats.length ? sats.reduce((a, x) => a + x.sat, 0) / sats.length : 0;
  if (profit > 0) return sat >= 70 ? 'A' : 'B';
  return sat >= 50 ? 'C' : 'D';
}
function loanLimit() {
  const L = CFG.loan;
  const lvMul = CFG.loanLevelMul[level() - 1] ?? 1;
  return Math.floor((L.base + assetValue() * L.assetRatio) * L.grades[creditGrade()].limitMul * lvMul / 1_000_000) * 1_000_000;
}
const canBorrow = () => Math.max(0, loanLimit() - G.debt);
function borrow(amount) {
  amount = Math.min(amount, canBorrow());
  if (amount <= 0) return { err: creditGrade() === 'D' ? '신용등급 D: 지금은 빌릴 수 없습니다' : '대출 한도를 다 썼습니다' };
  G.debt += amount; G.money += amount;
  return { amount };
}
function repay(amount) {
  amount = Math.min(amount, G.debt, Math.max(0, G.money));
  if (amount <= 0) return { err: G.debt ? '갚을 돈이 없습니다' : '갚을 빚이 없습니다' };
  G.debt -= amount; G.money -= amount;
  return { amount };
}

// 지역 개방
function unlockRegion(id) {
  const c = CFG.unlockCost[id];
  if (G.unlocked.has(id)) return { err: '이미 열린 지역입니다' };
  { const e = lvErr(CFG.gate.region[id] || 1); if (e) return { err: e }; }
  if (G.money < c) return { err: '돈이 부족합니다' };
  G.money -= c; G.today.bought += c; G.unlocked.add(id);
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
function ownedKm(l) { let s = 0; for (const sc of l.sections) if (secOwned(sc)) s += sc.km; return s; }
function upgradeCost(l, what) {
  const km = ownedKm(l);
  if (what === 'elec') return lineElec(l) ? null : Math.round(km * CFG.elecPerKm / 100_000) * 100_000;
  if (what === 'dbl') return l.kind === 'hs' || lineDbl(l) ? null : Math.round(km * CFG.dblPerKm / 100_000) * 100_000;
  if (what === 'speed') { const hs = l.kind === 'hs'; return lineVmax(l) + CFG.speedStep > (hs ? CFG.speedMaxHs : CFG.speedMax) ? null : Math.round(km * CFG.speedPerKm * (hs ? CFG.speedHsMul : 1) / 100_000) * 100_000; }
  return null;
}
function upgradeLine(l, what) {
  const c = upgradeCost(l, what);
  if (c == null) return { err: '할 수 없는 개량입니다' };
  { const e = lvErr(CFG.gate.work[what] || 1); if (e) return { err: e }; }
  if (!ownedKm(l)) return { err: '산 구간이 없습니다' };
  if (G.money < c) return { err: '돈이 부족합니다' };
  G.money -= c; G.today.bought += c;
  const u = G.lineUp[l.id] = G.lineUp[l.id] || {};
  if (what === 'speed') u.speed = (u.speed || 0) + CFG.speedStep; else u[what] = true;
  for (const r of G.routes) r.legs = buildLegs(r.kind, r.stops) || r.legs; // 더 빠른 길이 생겼을 수 있음
  rebuildNetwork();
  return {};
}

// ───────────────────────── 저장 ─────────────────────────
const SAVE_KEY = 'korea-rail-save-v3'; // v3: 동대구역 + 무궁화 1대로 시작
function serialize() {
  return JSON.stringify({
    kindsVer: 2, money: G.money, totalRev: G.totalRev, shownLevel: G.shownLevel, debt: G.debt, negDays: G.negDays, over: G.over, day: G.day, rep: G.rep, unlocked: [...G.unlocked], lineUp: G.lineUp, ownedSecs: [...G.ownedSecs], ownedSt: [...G.ownedSt],
    nextRouteNo: G.nextRouteNo, nextTrainId: G.nextTrainId, history: G.history,
    mon: G.mon,
    routes: G.routes.map(r => ({ no: r.no, kind: r.kind, color: r.color, stops: r.stops, name: r.name, mon: r.mon, tt: r.tt })),
    trains: G.trains.map(t => ({ id: t.id, no: t.no, kind: t.kind, lvl: t.lvl, route: t.route.no, i: t.i, dir: t.dir })),
    depot: G.depot.map(t => ({ id: t.id, no: t.no, kind: t.kind, lvl: t.lvl })),
  });
}
// 예전 열차 체계(일반: 무궁화·ITX-새마을·ITX-마음 / 고속: 이음·산천·청룡) → 지금 체계(완행·일반·고속 4단계)
function migrateKinds(o) {
  if (o.kindsVer >= 2) return;
  const map = { general: [['local', 2], ['general', 2], ['general', 3]], ktx: [['ktx', 2], ['ktx', 1], ['ktx', 3]] };
  const conv = t => { const m = map[t.kind]?.[t.lvl]; if (m && (m[0] !== t.kind || m[1] !== t.lvl)) { if (m[0] !== t.kind) delete t.no; t.kind = m[0]; t.lvl = m[1]; } };
  o.trains.forEach(conv); o.depot.forEach(conv);
  for (const r of o.routes) {
    if (r.kind !== 'general') continue;
    const ts = o.trains.filter(t => t.route === r.no);
    if (ts.every(t => t.kind === 'local')) r.kind = 'local';                     // 무궁화만 다니던 노선 → 완행 노선
    else for (const t of ts) if (t.kind !== r.kind) delete t.route;              // 섞여 있으면 종류가 다른 열차는 차량기지로
  }
  o.kindsVer = 2;
}
function deserialize(s) {
  const o = JSON.parse(s);
  migrateKinds(o);
  // 누적 수입이 없는 예전 저장: 남아 있는 결산 기록으로 어림
  const estRev = (o.history || []).reduce((a, h) => a + (h.revenue || 0), 0) + (o.mon?.revenue || 0);
  Object.assign(G, { money: o.money, totalRev: o.totalRev ?? estRev, shownLevel: o.shownLevel ?? levelOf(o.totalRev ?? estRev), debt: o.debt || 0, negDays: o.negDays || 0, over: !!o.over, day: o.day, rep: o.rep, unlocked: new Set(o.unlocked), lineUp: o.lineUp || {},
    ownedSecs: new Set(o.ownedSecs || []), ownedSt: new Set(o.ownedSt || []),
    nextRouteNo: o.nextRouteNo, nextTrainId: o.nextTrainId, history: o.history || [], t: CFG.dayStartMin, today: newToday(), waiting: new Map() });
  G.mon = o.mon || newMonth();
  G.routes = [];
  for (const r of o.routes) { const legs = buildLegs(r.kind, r.stops); if (legs) G.routes.push({ ...r, legs }); }
  G.trains = [];
  for (const t of o.trains) {
    const r = G.routes.find(x => x.no === t.route);
    if (r) G.trains.push({ id: t.id, no: t.no, kind: t.kind, lvl: t.lvl, route: r, i: Math.min(t.i, r.stops.length - 1), dir: t.dir, legT: 0, legDur: null, dwell: 0.5, pax: [] });
    else G.depot.push({ id: t.id, no: t.no, kind: t.kind, lvl: t.lvl });
  }
  G.depot = o.depot.map(t => ({ ...t })).concat(G.depot.filter(x => !o.depot.some(y => y.id === x.id)));
  numberTrains(); // 예전 저장: 번호 없는 열차에 종류별 번호
  G.pend = [];
  rebuildNetwork();
  layoutAll();    // 불러오면 그날 아침: 시간표 첫 편에 맞춰 배치
}
// 게임을 처음 상태로(새 게임·불러오기 전에)
function resetGame() {
  Object.assign(G, freshState());
  G.today = newToday(); G.mon = newMonth();
  spawnAcc.clear(); baseWeight.clear();
  rebuildNetwork();
}
function setupNewGame() {
  const st = CFG.starter;
  for (const n of st.stations) buyStation(byName.get(n), true);
  for (const id of st.sections) G.ownedSecs.add(id);
  for (const k of st.depot) buyTrain(k, true);
  rebuildNetwork();
}

root.SIM = { TT_BANDS, NICE_HW, ttOf, depsOf, planTrains, oneWayMin, autoHw, ttBuild, layoutAll, respaceRoute, spacingRatio, get commuteTable() { return commuteTable; }, CFG, D, G, level, levelOf, levelNeed, needTrain, lvErr, resetGame, routeDiag, upgradeBlock, dateOf, isMonthEnd, monthReport, startMonth, assetValue, creditGrade, loanLimit, canBorrow, borrow, repay, stations, byName, lines, edges, adj, sections, secById, edgeOwned, stOwned, secOwned, stationPrice, buyStation,
  sectionPrice, buySection, missingSections, buySections, ownedKm, regionName, toKm, distKm, isOpen, lineElec, lineDbl, lineVmax, edgeOpen, edgeCap,
  kindOf, tierOf, needsElec, edgeAllowed, findPath, buildLegs, addRoute, routeTitle, routeKm, routeHasNonElec, routeOpen, routeTrains,
  legMinutes, edgeSpeed, cycleMinutes, headway, rideMinutes, rideKm, rebuildNetwork, planFrom, hourShare, peakAt, tick, satPct, closeDay, startNextDay,
  trainValue, sellValue, buyTrain, upgradeTrain, sellTrain, canDispatch, dispatch, recall, deleteRoute, setRouteStops, unlockRegion,
  regionReachable, openKm, upgradeCost, upgradeLine, fareFor, nextIdx, SAVE_KEY, serialize, deserialize, setupNewGame,
  get edgeLoad() { return edgeLoad; }, get edgeLoadFactor() { return edgeLoadFactor; }, get servedBy() { return servedBy; }, get destTable() { return destTable; },
  destWeights, weightTotal, PALETTE };
})(typeof window !== 'undefined' ? window : globalThis);
