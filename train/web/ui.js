'use strict';
// 전국 철도 경영 — 화면·조작
const S = window.SIM;
const { CFG, G, stations, edges, lines } = S;

// ───────────────────────── 도우미 ─────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const won = n => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e8) return s + (a / 1e8).toFixed(a >= 1e9 ? 1 : 2).replace(/\.?0+$/, '') + '억원';
  if (a >= 1e4) return s + fmt(a / 1e4) + '만원';
  return s + fmt(a) + '원';
};
const hhmm = t => `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const minTxt = m => m >= 60 ? `${Math.floor(m / 60)}시간 ${Math.round(m % 60)}분` : `${Math.round(m)}분`;
let toastTimer;
function toast(msg, bg = '#b91c1c') { const t = $('toast'); t.textContent = msg; t.style.background = bg; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.display = 'none', 2400); }
function showModal(html) { $('modalBox').innerHTML = html; $('modal').style.display = 'flex'; }
function hideModal() { $('modal').style.display = 'none'; }
// 확인창(브라우저 confirm 대신: 임베드된 페이지에서는 confirm이 막힘). Promise<boolean>
function ask(msg, yes = '확인') {
  return new Promise(res => {
    showModal(`<p style="white-space:pre-line;line-height:1.7;margin:0 0 16px">${esc(msg)}</p>
      <div style="display:flex;gap:8px"><button id="askNo" style="flex:1">취소</button><button class="primary" id="askYes" style="flex:1">${esc(yes)}</button></div>`);
    $('askYes').onclick = () => { hideModal(); res(true); };
    $('askNo').onclick = () => { hideModal(); res(false); };
  });
}
function check(res, okMsg) { if (res && res.err) { toast(res.err); return false; } if (okMsg) toast(okMsg, '#15803d'); refreshAll(); return true; }
const kindIcon = k => CFG.kinds[k].icon;
const trainLabel = t => `${kindIcon(t.kind)} ${t.id}호 ${S.tierOf(t).name}`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ───────────────────────── 화면 좌표 ─────────────────────────
const cv = $('cv'), ctx = cv.getContext('2d');
const cam = { x: 0, y: 0, z: 2 }; // z = px per km
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
window.addEventListener('resize', resize);
const sx = x => (x - cam.x) * cam.z + W / 2;
const sy = y => (y - cam.y) * cam.z + H / 2;
const wx = px => (px - W / 2) / cam.z + cam.x;
const wy = py => (py - H / 2) / cam.z + cam.y;
function fitStations(ss, pad = 80) {
  const xs = ss.map(s => s.x), ys = ss.map(s => s.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  cam.x = (x0 + x1) / 2; cam.y = (y0 + y1) / 2;
  cam.z = Math.max(0.6, Math.min(40, Math.min((W - pad * 2) / Math.max(5, x1 - x0), (H - pad * 2 - 80) / Math.max(5, y1 - y0))));
}
const land = S.D.land.map(ring => ring.map(([lon, lat]) => S.toKm(lon, lat)));
// 선로 종류 색: 고속선 파랑, 전철 일반선 초록, 비전철 일반선 갈색 점선
const TRACK = {
  hs: { name: '고속선', color: '#2563eb', dash: [] },
  elec: { name: '일반선(전철)', color: '#15803d', dash: [] },
  diesel: { name: '일반선(비전철)', color: '#a16207', dash: [6, 4] },
};
const trackType = e => e.line.kind === 'hs' ? 'hs' : S.lineElec(e.line) ? 'elec' : 'diesel';
// 지역 모양(km 좌표)과 색. 열린 지역은 지역마다 다른 옅은 색, 닫힌 지역은 회색 빗금
const REGION_COLOR = { daegu: '#fde2e4', gyeongbuk_e: '#fff1c1', gyeongbuk_n: '#e2f0cb', busan: '#cde7f0', gyeongnam: '#d8f3dc',
  chungcheong: '#ffe5d0', chungbuk: '#e4dcf5', capital: '#fbd6e8', gangwon: '#d3f0e8', jeonbuk: '#f6eac2', jeonnam: '#dbe7fb' };
const REGION_INK = { daegu: '#be123c', gyeongbuk_e: '#a16207', gyeongbuk_n: '#4d7c0f', busan: '#0e7490', gyeongnam: '#15803d',
  chungcheong: '#c2410c', chungbuk: '#6d28d9', capital: '#be185d', gangwon: '#0f766e', jeonbuk: '#a16207', jeonnam: '#1d4ed8' };
const regionShapes = S.D.regions.filter(r => r.shape).map(r => ({ id: r.id, name: r.name,
  rings: r.shape.map(ring => ring.map(([lon, lat]) => S.toKm(lon, lat))), label: S.toKm(...r.label) }));
const hatch = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 10;
  const g = c.getContext('2d'); g.fillStyle = '#e5e7eb'; g.fillRect(0, 0, 10, 10);
  g.strokeStyle = '#d1d5db'; g.lineWidth = 2; g.beginPath(); g.moveTo(-2, 12); g.lineTo(12, -2); g.stroke();
  return ctx.createPattern(c, 'repeat');
})();
// 조각(ring) 하나라도 안에 있으면 그 지역(조각끼리 겹칠 수 있음)
function pointInRings(x, y, rings) {
  return rings.some(ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
function regionAt(px, py) { const x = wx(px), y = wy(py); return regionShapes.find(r => pointInRings(x, y, r.rings)) || null; }
const canUnlock = id => !G.unlocked.has(id) && S.regionReachable(id);

// ───────────────────────── 노선 겹침: 구간마다 나란히 ─────────────────────────
let edgeSlots = new Map(); // edgeId → [routeNo…]
function assignSlots() {
  edgeSlots = new Map();
  for (const r of G.routes) for (const leg of r.legs) for (const e of leg.edges) {
    if (!edgeSlots.has(e.id)) edgeSlots.set(e.id, []);
    const L = edgeSlots.get(e.id); if (!L.includes(r.no)) L.push(r.no);
  }
}
const slotGap = () => Math.max(3, Math.min(6, cam.z / 2.5));
function edgeOffset(e, r) {
  const L = edgeSlots.get(e.id) || [r.no];
  return (L.indexOf(r.no) - (L.length - 1) / 2) * slotGap();
}
// 구간 e의 화면 좌표 점들(e.a → e.b, 실제 선로 모양). off만큼 옆으로 어긋나게(진행 방향 왼쪽이 +)
// 화면에서 2px보다 가까운 점은 건너뜀
function edgeScreen(e, off) {
  const out = [];
  let lx = -1e9, ly = -1e9;
  for (let i = 0; i < e.P.length; i++) {
    const X = sx(e.P[i][0]), Y = sy(e.P[i][1]);
    if (i && i < e.P.length - 1 && Math.abs(X - lx) + Math.abs(Y - ly) < 2) continue;
    out.push([X, Y]); lx = X; ly = Y;
  }
  if (!off || out.length < 2) return out;
  return out.map(([X, Y], i) => {
    const p = out[Math.max(0, i - 1)], n = out[Math.min(out.length - 1, i + 1)];
    const dx = n[0] - p[0], dy = n[1] - p[1], L = Math.hypot(dx, dy) || 1;
    return [X - dy / L * off, Y + dx / L * off];
  });
}
function strokePts(pts) { ctx.beginPath(); pts.forEach(([X, Y], i) => i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y)); ctx.stroke(); }
function edgeVisible(e) {
  const A = stations[e.a], B = stations[e.b], pad = Math.hypot(A.x - B.x, A.y - B.y) * cam.z * 0.6 + 40;
  const X = sx((A.x + B.x) / 2), Y = sy((A.y + B.y) / 2);
  return X > -pad && Y > -pad && X < W + pad && Y < H + pad;
}

// ───────────────────────── 그리기 ─────────────────────────
let hoverStation = null, hoverTrain = null, selected = null, drawing = null, editing = null, mouse = { x: 0, y: 0 };
const stationR = s => Math.max(2.5, Math.min(11, 2 + Math.sqrt(s.on) / 14)) * Math.min(1.6, Math.max(0.7, Math.sqrt(cam.z / 3)));

function trainPos(t) {
  const r = t.route, { j } = S.nextIdx(t);
  if (t.legDur == null || t.dwell > 0) { const s = stations[r.stops[t.i]]; return { x: s.x, y: s.y, e: null, at: true }; }
  const leg = r.legs[Math.min(t.i, j)];
  const forward = j > t.i;
  let d = Math.min(1, t.legT / t.legDur) * leg.km;
  const es = forward ? leg.edges : [...leg.edges].reverse();
  let cur = forward ? leg.nodes[0] : leg.nodes[leg.nodes.length - 1];
  for (const e of es) {
    const nxt = e.a === cur ? e.b : e.a;
    if (d <= e.km) {
      // 실제 선로 모양 위 위치: e.a 기준 비율로 바꿔서 찾음
      const fwd = cur === e.a, f = fwd ? d / e.km : 1 - d / e.km;
      const L = e.len[e.len.length - 1] * f;
      let i = 1; while (i < e.len.length - 1 && e.len[i] < L) i++;
      const p = e.P[i - 1], q = e.P[i], g = (L - e.len[i - 1]) / ((e.len[i] - e.len[i - 1]) || 1);
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + (fwd ? 0 : Math.PI);
      return { x: p[0] + (q[0] - p[0]) * g, y: p[1] + (q[1] - p[1]) * g, e, ang, nx: -(q[1] - p[1]), ny: q[0] - p[0] };
    }
    d -= e.km; cur = nxt;
  }
  const s = stations[cur]; return { x: s.x, y: s.y, e: null };
}
function trainScreen(t) {
  const p = trainPos(t);
  let X = sx(p.x), Y = sy(p.y);
  if (p.e) {
    const off = edgeOffset(p.e, t.route), L = Math.hypot(p.nx, p.ny) || 1;
    X += p.nx / L * off; Y += p.ny / L * off;
  }
  return { X, Y, ang: p.ang || 0 };
}

function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = '#dfe9f3'; ctx.fillRect(0, 0, W, H);
  // 땅(지역에 안 속한 곳: 제주 등)
  ctx.fillStyle = '#eef1f4'; ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
  for (const ring of land) {
    ctx.beginPath();
    ring.forEach(([x, y], k) => k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  // 지역: 열린 곳은 색, 닫힌 곳은 회색 빗금. 경계는 흰 선
  const selRegion = selected?.type === 'region' ? selected.id : null;
  for (const r of regionShapes) {
    const open = G.unlocked.has(r.id);
    // 조각마다 따로 칠함(한 경로로 칠하면 겹친 조각이 서로 지워짐)
    ctx.fillStyle = open ? REGION_COLOR[r.id] || '#f1f5f9' : hatch;
    for (const ring of r.rings) { ctx.beginPath(); ring.forEach(([x, y], k) => k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))); ctx.closePath(); ctx.fill(); }
    ctx.beginPath();
    for (const ring of r.rings) { ring.forEach(([x, y], k) => k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))); ctx.closePath(); }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
    if (selRegion === r.id || (!open && canUnlock(r.id))) {
      ctx.setLineDash(selRegion === r.id ? [] : [6, 5]);
      ctx.strokeStyle = selRegion === r.id ? '#111827' : '#16a34a'; ctx.lineWidth = selRegion === r.id ? 2.5 : 1.8; ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // 지역 이름과 잠금 표시(확대하면 흐려짐)
  const la = Math.max(0, Math.min(1, (14 - cam.z) / 8));
  if (la > 0) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const r of regionShapes) {
      const open = G.unlocked.has(r.id), X = sx(r.label[0]), Y = sy(r.label[1]);
      if (X < -100 || Y < -60 || X > W + 100 || Y > H + 60) continue;
      ctx.globalAlpha = la;
      ctx.font = '800 15px "Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.85)';
      const title = open ? r.name : `🔒 ${r.name}`;
      ctx.strokeText(title, X, Y); ctx.fillStyle = open ? REGION_INK[r.id] || '#374151' : '#6b7280'; ctx.fillText(title, X, Y);
      if (!open) {
        const c = CFG.unlockCost[r.id], reach = S.regionReachable(r.id), ok = reach && G.money >= c;
        const t2 = `${won(c)}${reach ? (ok ? ' · 열 수 있음' : '') : ' · 이어진 지역 먼저'}`;
        ctx.font = '700 12px "Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
        const w = ctx.measureText(t2).width + 14;
        ctx.fillStyle = ok ? '#16a34a' : reach ? '#ffffff' : 'rgba(255,255,255,.8)';
        ctx.beginPath(); ctx.roundRect(X - w / 2, Y + 11, w, 20, 10); ctx.fill();
        if (!ok) { ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1; ctx.stroke(); }
        ctx.fillStyle = ok ? '#ffffff' : '#4b5563'; ctx.fillText(t2, X, Y + 21);
      }
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  // 선로
  const load = S.edgeLoad;
  for (const e of edges) {
    const open = S.edgeOpen(e), own = S.edgeOwned(e), hs = e.line.kind === 'hs', el = S.lineElec(e.line), dbl = S.lineDbl(e.line);
    if (!edgeVisible(e)) continue;
    const pts = edgeScreen(e, 0);
    ctx.globalAlpha = !open ? 0.3 : own ? 1 : 0.55;
    const T = TRACK[hs ? 'hs' : el ? 'elec' : 'diesel'];
    ctx.setLineDash(T.dash);
    ctx.strokeStyle = T.color;
    ctx.lineWidth = (hs ? 3.2 : dbl ? 2.4 : 1.6) * (own ? 1 : 0.6);
    strokePts(pts);
    const l = load.get(e.id) || 0, cap = S.edgeCap(e);
    if (open && l > cap * 0.8) {
      ctx.setLineDash([]);
      ctx.strokeStyle = l > cap ? 'rgba(220,38,38,.55)' : 'rgba(245,158,11,.5)'; ctx.lineWidth = 9;
      strokePts(pts);
    }
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  // 선택한 선로 구간 강조
  // 일반선 = 노랑(구간)·주황(누른 곳), 고속선 = 굵은 파랑
  if (selected?.type === 'track') {
    const hs = selected.e.line.kind === 'hs';
    ctx.strokeStyle = hs ? 'rgba(37,99,235,.45)' : 'rgba(250,204,21,.75)'; ctx.lineWidth = hs ? 14 : 12; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const sc of selected.e.secs) for (const e of sc.edges) if (edgeVisible(e)) strokePts(edgeScreen(e, 0));
    ctx.strokeStyle = hs ? '#1d4ed8' : 'rgba(234,88,12,.9)'; ctx.lineWidth = hs ? 7 : 5;
    if (hs) { for (const sc of selected.e.secs) for (const e of sc.edges) if (edgeVisible(e)) strokePts(edgeScreen(e, 0)); }
    else strokePts(edgeScreen(selected.e, 0));
    ctx.lineCap = 'butt';
  }
  // 노선
  const selRoute = selected?.type === 'route' ? selected.r : null;
  if (selRoute) { // 선택한 노선 밑에 선로 종류 색을 넓게 깔아 어디가 고속선·전철·비전철인지 보이게
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = 0.55;
    for (const leg of selRoute.legs) for (const e of leg.edges) {
      if (!edgeVisible(e)) continue;
      const T = TRACK[trackType(e)];
      ctx.strokeStyle = T.color; ctx.lineWidth = 13; ctx.setLineDash(T.dash.length ? [10, 6] : []);
      strokePts(edgeScreen(e, edgeOffset(e, selRoute)));
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  for (const r of G.routes) {
    const dim = selRoute && selRoute !== r;
    ctx.globalAlpha = dim ? 0.25 : r.active ? 1 : 0.5;
    ctx.strokeStyle = r.color; ctx.lineWidth = selRoute === r ? 5 : 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const leg of r.legs) for (const e of leg.edges) if (edgeVisible(e)) strokePts(edgeScreen(e, edgeOffset(e, r)));
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'butt';
  // 그리는 중인 노선 미리보기
  const plan = drawing || editing;
  if (plan) {
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 3; ctx.setLineDash([7, 5]);
    for (const leg of plan.legs) for (const e of leg.edges) strokePts(edgeScreen(e, 0));
    if (drawing && hoverStation && drawing.stops.length) {
      const a = drawing.stops[drawing.stops.length - 1];
      let P = S.findPath(a, hoverStation.id, drawing.kind);
      ctx.strokeStyle = '#2563eb';
      if (!P) { P = S.findPath(a, hoverStation.id, drawing.kind, true); ctx.strokeStyle = '#f59e0b'; }
      if (P) for (const e of P.edges) strokePts(edgeScreen(e, 0));
    }
    ctx.setLineDash([]);
  }
  // 역
  const stopSet = new Set(plan ? plan.stops : []);
  const showAll = cam.z > 7;
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const labels = [];
  for (const s of stations) {
    const open = S.isOpen(s), X = sx(s.x), Y = sy(s.y);
    if (X < -40 || Y < -40 || X > W + 40 || Y > H + 40) continue;
    const rad = stationR(s);
    const served = S.servedBy.has(s.id), own = S.stOwned(s);
    ctx.beginPath(); ctx.arc(X, Y, rad, 0, Math.PI * 2);
    ctx.fillStyle = !open ? '#e5e7eb' : stopSet.has(s.id) ? '#fde68a' : own ? '#ffffff' : '#f1f5f9';
    ctx.fill();
    ctx.setLineDash(open && !own ? [2, 2] : []);
    ctx.lineWidth = s === hoverStation || selected?.s === s ? 3 : served ? 2 : 1.3;
    ctx.strokeStyle = !open ? '#9ca3af' : s === hoverStation ? '#2563eb' : '#1f2937';
    ctx.stroke(); ctx.setLineDash([]);
    if (showAll || s.on > 6000 / Math.max(0.4, cam.z) || s === hoverStation || stopSet.has(s.id)) labels.push({ s, X, Y, rad, open });
  }
  ctx.font = '600 12px "Pretendard","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
  labels.sort((a, b) => b.s.on - a.s.on);
  const boxes = [];
  for (const L of labels) {
    const w = ctx.measureText(L.s.name).width + 6, box = [L.X - w / 2, L.Y - L.rad - 17, w, 15];
    if (boxes.some(b => box[0] < b[0] + b[2] && b[0] < box[0] + box[2] && box[1] < b[1] + b[3] && b[1] < box[1] + box[3])) continue;
    boxes.push(box);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(L.s.name, L.X, L.Y - L.rad - 3);
    ctx.fillStyle = L.open ? '#111827' : '#9ca3af'; ctx.fillText(L.s.name, L.X, L.Y - L.rad - 3);
  }
  // 기다리는 승객
  ctx.font = '700 11px sans-serif'; ctx.textBaseline = 'middle';
  for (const [sid, q] of G.waiting) {
    if (!q.length) continue;
    const s = stations[sid], X = sx(s.x) + stationR(s) + 9, Y = sy(s.y) + 2;
    const txt = String(q.length), w = Math.max(18, ctx.measureText(txt).width + 8);
    const many = q.length > 150;
    ctx.fillStyle = many ? '#dc2626' : '#4f46e5';
    ctx.beginPath(); ctx.roundRect(X - w / 2, Y - 8, w, 16, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(txt, X, Y);
  }
  // 열차
  for (const t of G.trains) {
    const { X, Y, ang } = trainScreen(t);
    const tier = S.tierOf(t), full = t.pax.length / tier.cap;
    ctx.save(); ctx.translate(X, Y); ctx.rotate(ang);
    const w = t.kind === 'ktx' ? 18 : 14, h = 8;
    ctx.fillStyle = tier.color; ctx.strokeStyle = t === hoverTrain || selected?.t === t ? '#111827' : '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, t.kind === 'ktx' ? [2, 5, 5, 2] : 2); ctx.fill(); ctx.stroke();
    // 승차율
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-w / 2 + 2, -1, (w - 4) * Math.min(1, full), 2);
    ctx.restore();
  }
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  // 선택한 역: 승객이 가고 싶은 곳
  if (selected?.type === 'station') {
    const s = selected.s;
    ctx.strokeStyle = 'rgba(124,58,237,.55)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
    for (const d of topDests(s, 6)) { ctx.beginPath(); ctx.moveTo(sx(s.x), sy(s.y)); ctx.lineTo(sx(stations[d.id].x), sy(stations[d.id].y)); ctx.stroke(); }
    ctx.setLineDash([]);
  }
}

// ───────────────────────── 정보 ─────────────────────────
function topDests(s, n) {
  const W = S.destWeights(s), tot = S.weightTotal(s);
  return [...W].map(([id, w]) => ({ id, share: w / tot })).sort((a, b) => b.share - a.share).slice(0, n);
}
function stationHtml(s) {
  const open = S.isOpen(s), q = G.waiting.get(s.id) || [];
  const rs = S.servedBy.get(s.id) || [];
  const T = S.destTable.get(s.id);
  let h = `<div><b style="font-size:15px">${esc(s.name)}역</b> <span class="tag gray">${esc(S.regionName[s.region])}</span> ${open ? '' : '<span class="tag warn">미개방</span>'}</div>
    <div class="muted">${esc(s.si)} · 실제 하루 승차 ${fmt(s.on)}명 · 하차 ${fmt(s.off)}명${s.ktx ? ` · KTX ${Math.round(s.ktx * 100)}%` : ''}</div>`;
  if (open && !S.stOwned(s)) h += `<div style="margin-top:6px"><button class="primary" data-buyst="${s.id}" ${G.money < S.stationPrice(s) ? 'disabled' : ''}>🏷 역 사기 ${won(S.stationPrice(s))}</button> <span class="muted">사야 열차를 세울 수 있습니다</span></div>`;
  if (open) {
    h += `<div style="margin-top:6px">🧍 기다리는 승객 <b>${fmt(q.length)}</b>명 · 지나는 노선 ${rs.length}개${T ? ` · 이어진 수요 ${Math.round(T.served * 100)}%` : ''}</div>`;
    if (q.length) {
      const cnt = new Map(); for (const p of q) cnt.set(p.dest, (cnt.get(p.dest) || 0) + 1);
      const top = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 6), nx = q.filter(p => p.transfer).length;
      if (nx) h += `<div class="muted">그중 갈아타는 승객 ${fmt(nx)}명</div>`;
      h += `<div class="wbox"><div class="wsub">기다리는 승객의 목적지</div>${top.map(([d, c]) => `<div class="wrow"><span class="wlab">${esc(stations[d].name)}</span><span class="wbar"><i style="width:${c / top[0][1] * 100}%;background:#6366f1"></i></span><span class="wnum">${c}명</span></div>`).join('')}</div>`;
    }
  }
  const td = topDests(s, 8);
  h += `<div class="wbox"><div class="wsub">이 역 사람들이 가고 싶은 곳 (보라 점선)</div>${td.map(d => {
    const t = stations[d.id], o = S.isOpen(t), b = T?.best?.get(d.id), served = !!b;
    return `<div class="wrow"><span class="wlab">${esc(t.name)} ${b ? (b.transfer ? `<span class="tag ok">환승 ${esc(stations[b.opts[0].x].name)}</span>` : '<span class="tag ok">직통</span>') : o ? '' : '<span class="tag gray">미개방</span>'}</span><span class="wbar"><i style="width:${d.share / td[0].share * 100}%;background:${served ? '#16a34a' : o ? '#a78bfa' : '#cbd5e1'}"></i></span><span class="wnum">${(d.share * 100).toFixed(1)}%</span></div>`;
  }).join('')}</div>`;
  return h;
}
function routeStopsHtml(r) {
  const stopSet = new Set(r.stops), seq = [r.stops[0]];
  for (const leg of r.legs) seq.push(...leg.nodes.slice(1));
  return `<div class="stops">${seq.map(id => `<span class="${stopSet.has(id) ? '' : 'pass'}">${esc(stations[id].name)}</span>`).join('')}</div>`;
}
// 노선이 지나는 선로: 종류별 km 막대와 선로 순서(예: 경부선 전철 45km → 경부고속선 120km)
// 노선 진단 상자: 열차가 더 필요한지
const DIAG_BG = { more: '#fef2f2', less: '#fefce8', low: '#fefce8', ok: '#f0fdf4', none: '#f8fafc', wait: '#f8fafc' };
function diagHtml(r) {
  const x = S.routeDiag(r);
  const nums = x.occ != null ? `<div class="muted" style="font-size:12px;margin-top:3px">${x.from} 기준 · 승차율 ${Math.round(x.occ * 100)}% · 평균 대기 ${Math.round(x.wait)}분 · 기다리다 떠남 ${Math.round(x.gaveRate * 100)}% · 만석 ${Math.round(x.fullRate * 100)}%</div>` : '';
  const btn = x.level === 'more' ? `<button class="primary" data-${G.depot.some(t => t.kind === r.kind) ? 'add' : 'buyadd'}="${r.no}" style="margin-top:6px">＋ 1대 더 넣기</button>`
    : x.level === 'less' ? `<button data-recall="${S.routeTrains(r).slice(-1)[0].id}" style="margin-top:6px">－ 1대 빼기</button>` : '';
  return `<div style="background:${DIAG_BG[x.level]};border:1px solid var(--line);border-radius:8px;padding:7px 9px;margin:6px 0">
    <b>${x.icon} ${x.label}</b> <span style="font-size:12px">${esc(x.advice)}</span>${nums}${btn}</div>`;
}
function trackTags(r) {
  const has = new Set(); for (const leg of r.legs) for (const e of leg.edges) has.add(trackType(e));
  return ['hs', 'elec', 'diesel'].filter(k => has.has(k)).map(k => `<span style="color:${TRACK[k].color};font-weight:700">${{ hs: '고속', elec: '전철', diesel: '비전철' }[k]}</span>`).join('/');
}
function routeTracksHtml(r) {
  const km = { hs: 0, elec: 0, diesel: 0 }, runs = [];
  for (const leg of r.legs) for (const e of leg.edges) {
    const t = trackType(e); km[t] += e.km;
    const last = runs[runs.length - 1];
    if (last && last.line === e.line) last.km += e.km; else runs.push({ line: e.line, t, km: e.km });
  }
  const tot = km.hs + km.elec + km.diesel || 1;
  const bar = Object.keys(km).filter(k => km[k] > 0).map(k => `<i style="width:${km[k] / tot * 100}%;background:${TRACK[k].color}${k === 'diesel' ? `;background-image:repeating-linear-gradient(90deg,transparent 0 6px,rgba(255,255,255,.55) 6px 9px)` : ''}"></i>`).join('');
  const legend = Object.keys(km).filter(k => km[k] > 0).map(k => `<span style="white-space:nowrap"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${TRACK[k].color};vertical-align:-1px"></span> ${TRACK[k].name} ${fmt(km[k])}km</span>`).join(' · ');
  return `<div style="margin:6px 0 2px;display:flex;height:10px;border-radius:5px;overflow:hidden;background:#e5e7eb">${bar}</div>
    <div style="font-size:12px">${legend}</div>
    <div class="muted" style="font-size:12px;margin-top:2px">${runs.map(x => `<span style="color:${TRACK[x.t].color};font-weight:600">${esc(x.line.name)}</span> ${fmt(x.km)}km`).join(' → ')}</div>`;
}
function routeHtml(r) {
  const ts = S.routeTrains(r), K = CFG.kinds[r.kind];
  const oneWay = S.rideMinutes(r, 0, r.stops.length - 1), hw = S.headway(r);
  const waiting = r.stops.reduce((a, id) => a + (G.waiting.get(id) || []).filter(p => r.idxOf?.has(p.dest)).length, 0);
  const profit = (r.revToday || 0) - (r.costToday || 0);
  let h = `<div><span class="sw" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${r.color};vertical-align:-1px"></span>
    <b style="font-size:15px">${K.icon} ${esc(S.routeTitle(r))}</b> <span class="tag gray">${K.name}</span></div>
    <div class="muted">${fmt(S.routeKm(r))}km · 정차 ${r.stops.length}역 · 편도 ${minTxt(oneWay)} · ${ts.length ? `배차 ${minTxt(hw)}마다` : '열차 없음'}</div>
    ${diagHtml(r)}
    ${routeTracksHtml(r)}
    ${routeStopsHtml(r)}
    <div>오늘 승객 <b>${fmt(r.paxToday || 0)}</b>명 · 수입 ${won(r.revToday || 0)} · 운행비 ${won(r.costToday || 0)} · <span class="${profit >= 0 ? 'pos' : 'neg'}">${won(profit)}</span></div>
    <div>기다리는 승객 ${fmt(waiting)}명${r.leftToday ? ` · <span class="neg">만석으로 못 탄 승객 ${fmt(r.leftToday)}명</span>` : ''}</div>`;
  if (!S.routeOpen(r)) h += `<div class="neg">열리지 않은 지역을 지나 운행할 수 없습니다</div>`;
  h += `<div class="wsub">열차 ${ts.length}대</div>`;
  for (const t of ts) h += `<div class="bus">${trainLabel(t)} · ${t.pax.length}/${S.tierOf(t).cap}명<div class="btns">${upBtn(t)}<button data-recall="${t.id}">회수</button></div></div>`;
  const cand = G.depot.filter(t => t.kind === r.kind);
  h += `<div class="btns" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
    ${cand.length ? `<button class="primary" data-add="${r.no}">＋ 차량기지에서 배차 (${cand.length}대)</button>` : `<button data-buyadd="${r.no}">＋ ${K.name} 사서 배차 (${won(K.price)})</button>`}
    <button data-edit="${r.no}">✏️ 정차역 수정</button><button data-del="${r.no}">🗑 삭제</button></div>`;
  return h;
}
function trainHtml(t) {
  const r = t.route, tier = S.tierOf(t);
  const { j } = S.nextIdx(t);
  return `<div><b style="font-size:15px">${trainLabel(t)}</b></div>
    <div class="muted">${esc(S.routeTitle(r))} · 다음 역 ${esc(stations[r.stops[j]].name)} · 최고 ${tier.vmax}km/h</div>
    <div>승객 <b>${t.pax.length}</b> / ${tier.cap}명</div>
    <div class="btns" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${upBtn(t)}<button data-recall="${t.id}">차량기지로 회수</button><button data-selroute="${r.no}">노선 보기</button></div>`;
}
// 선로 구간 카드: 누른 곳이 속한 구간(지역 경계면 두 구간)
function trackHtml(e) {
  const l = e.line, A = stations[e.a], B = stations[e.b];
  let h = `<div><b style="font-size:15px">${esc(l.name)}</b>
    <span class="tag ${l.kind === 'hs' ? '' : 'gray'}">${l.kind === 'hs' ? '고속선' : '일반선'}</span>
    <span class="tag ${S.lineElec(l) ? 'ok' : 'warn'}">${S.lineElec(l) ? '전철화' : '비전철'}</span>
    <span class="tag gray">${l.kind === 'hs' ? '고속 복선' : S.lineDbl(l) ? '복선' : '단선'}</span>
    <span class="tag gray">${S.lineVmax(l)}km/h</span></div>
    <div class="muted">누른 곳: ${esc(A.name)}–${esc(B.name)} ${fmt(e.km)}km${l.kind === 'hs' ? ' · KTX만 다님' : S.lineElec(l) ? '' : ' · 광역열차·KTX·ITX-마음은 못 다님'}</div>`;
  for (const sc of e.secs) {
    const open = G.unlocked.has(sc.region), own = S.secOwned(sc), price = S.sectionPrice(sc);
    const ends = sc.edges.flatMap(x => [x.a, x.b]);
    const names = [...new Set(ends)].map(i => stations[i].name);
    h += `<div class="wbox"><div><b>${esc(S.regionName[sc.region])} 구간</b> · ${fmt(sc.km)}km ${own ? '<span class="tag ok">보유</span>' : ''}</div>
      <div class="muted">${esc(names[0])} … ${esc(names[names.length - 1])} (역 ${names.length}개)</div>`;
    if (own) h += '';
    else if (!open) {
      const c = CFG.unlockCost[sc.region], reach = S.regionReachable(sc.region);
      h += `<div style="margin-top:6px">아직 열지 않은 지역입니다.</div>
        <div class="btns" style="display:flex;gap:4px;margin-top:6px"><button data-unlock="${sc.region}" ${!reach || G.money < c ? 'disabled' : ''}>🗺️ ${esc(S.regionName[sc.region])} 열기 ${won(c)}</button></div>`;
    } else h += `<div class="btns" style="display:flex;gap:4px;margin-top:6px"><button class="primary" data-buysec="${sc.id}" ${G.money < price ? 'disabled' : ''}>🏷 이 구간 사기 ${won(price)}</button></div>`;
    h += '</div>';
  }
  const btn = (what, label) => { const c = S.upgradeCost(l, what); return c == null ? '' : `<button data-lup="${l.id}:${what}" ${G.money < c ? 'disabled' : ''}>${label} ${won(c)}</button>`; };
  if (S.ownedKm(l) > 0) {
    const load = S.edgeLoad.get(e.id) || 0;
    h += `<div style="margin-top:6px">이 구간 열차 시간당 ${load.toFixed(1)}대 / 용량 ${S.edgeCap(e)}대 ${load > S.edgeCap(e) ? '<span class="tag warn">초과 → 감속</span>' : ''}</div>
      <div class="wsub">${esc(l.name)} 개량 (산 구간 ${fmt(S.ownedKm(l))}km)</div>
      <div class="btns" style="display:flex;flex-wrap:wrap;gap:4px">${btn('elec', '⚡ 전철화') + btn('dbl', '🛤 복선화') + btn('speed', '🚀 고속화') || '<span class="muted">할 수 있는 개량이 없습니다</span>'}</div>`;
  }
  return h;
}
function regionHtml(id) {
  const name = S.regionName[id], open = G.unlocked.has(id), c = CFG.unlockCost[id], reach = S.regionReachable(id);
  const ss = stations.filter(s => s.region === id).sort((a, b) => b.on - a.on);
  const on = ss.reduce((a, s) => a + s.on, 0);
  const ls = [...new Set(S.sections.filter(sc => sc.region === id).map(sc => sc.line.name))];
  const owned = ss.filter(s => S.stOwned(s)).length;
  let h = `<div><span class="sw" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${REGION_COLOR[id] || '#eee'};border:1px solid ${REGION_INK[id] || '#999'};vertical-align:-1px"></span>
    <b style="font-size:15px">${esc(name)}</b> ${open ? '<span class="tag ok">개방</span>' : '<span class="tag gray">🔒 미개방</span>'}</div>
    <div class="muted">역 ${ss.length}개${open ? ` (보유 ${owned})` : ''} · 실제 하루 승차 ${fmt(on)}명</div>
    <div class="muted">지나는 선로: ${ls.map(esc).join(', ')}</div>`;
  if (!open) h += `<div class="btns" style="display:flex;gap:6px;align-items:center;margin-top:8px">
      <button class="primary" data-unlock="${id}" ${!reach || G.money < c ? 'disabled' : ''}>🗺️ 지역 열기 ${won(c)}</button>
      ${reach ? '' : '<span class="muted">열린 지역과 선로로 이어져야 합니다</span>'}</div>
      <div class="muted" style="margin-top:4px">연 뒤에 쓸 역과 선로 구간을 따로 삽니다</div>`;
  h += `<div class="wbox"><div class="wsub">큰 역</div>${ss.slice(0, 6).map(s => `<div class="wrow"><span class="wlab">${esc(s.name)}${open && !S.stOwned(s) ? ` <span class="muted">${won(S.stationPrice(s))}</span>` : ''}</span><span class="wbar"><i style="width:${s.on / ss[0].on * 100}%;background:${REGION_INK[id] || '#6366f1'}"></i></span><span class="wnum">${fmt(s.on)}명</span></div>`).join('')}</div>`;
  return h;
}
function renderInfo() {
  const card = $('infoCard');
  if (!selected) { card.hidden = true; return; }
  card.hidden = false;
  if (selected.type === 'station') { $('infoTitle').textContent = '🚉 역'; $('info').innerHTML = stationHtml(selected.s); }
  else if (selected.type === 'route') {
    if (!G.routes.includes(selected.r)) { selected = null; card.hidden = true; return; }
    $('infoTitle').textContent = '🛤️ 노선'; $('info').innerHTML = routeHtml(selected.r);
  } else if (selected.type === 'train') {
    if (!G.trains.includes(selected.t)) { selected = null; card.hidden = true; return; }
    $('infoTitle').textContent = '🚆 열차'; $('info').innerHTML = trainHtml(selected.t);
  } else if (selected.type === 'track') { $('infoTitle').textContent = '🛤 선로'; $('info').innerHTML = trackHtml(selected.e); }
  else if (selected.type === 'region') { $('infoTitle').textContent = '🗺️ 지역'; $('info').innerHTML = regionHtml(selected.id); }
}

// ───────────────────────── 설정창 ─────────────────────────
const PANELS = { routes: '🛤️ 노선', depot: '🚉 차량기지', regions: '🗺️ 지역 개방', tracks: '🔧 선로', bank: '🏦 은행', help: '❓ 도움말' };
let openPanelName = null, panelBeforeMap = null;
function openPanel(name) {
  openPanelName = name;
  $('panel').hidden = !name;
  document.querySelectorAll('#dock button').forEach(b => b.classList.toggle('on', b.dataset.panel === name));
  document.querySelectorAll('.pbody').forEach(p => p.classList.toggle('on', p.dataset.p === name));
  if (name) { $('panelTitle').textContent = PANELS[name]; renderPanel(); }
}
function hidePanelForMap() { if (openPanelName) { panelBeforeMap = openPanelName; openPanel(null); } }
function restorePanel() { if (panelBeforeMap) { openPanel(panelBeforeMap); panelBeforeMap = null; } }

function renderRoutes() {
  $('newRouteBtns').innerHTML = Object.entries(CFG.kinds).map(([k, K]) =>
    `<button data-newroute="${k}">${K.icon} 새 ${K.name}<br><span class="muted">${k === 'general' ? '일반선' : k === 'metro' ? '전철화 선로' : '고속선·전철화 선로'}</span></button>`).join('');
  $('routes').innerHTML = G.routes.map(r => {
    const ts = S.routeTrains(r), p = (r.revToday || 0) - (r.costToday || 0);
    return `<div class="route" data-route="${r.no}"><span class="sw" style="background:${r.color}"></span>
      <span class="nm"><b>${kindIcon(r.kind)} ${esc(S.routeTitle(r))}</b> <span style="font-size:12px">${(d => `${d.icon} ${d.label}`)(S.routeDiag(r))}</span><br>
      <span class="meta">${fmt(S.routeKm(r))}km ${trackTags(r)} · ${r.stops.length}역 · 열차 ${ts.length}대 · 오늘 ${fmt(r.paxToday || 0)}명 · <span class="${p >= 0 ? 'pos' : 'neg'}">${won(p)}</span></span></span></div>`;
  }).join('') || '<p class="muted">노선이 없습니다.</p>';
}
let depotRouteNo = null;
function renderDepot() {
  const sel = $('depotRoute');
  sel.innerHTML = '<option value="">(노선 선택)</option>' + G.routes.map(r => `<option value="${r.no}" ${r.no === depotRouteNo ? 'selected' : ''}>${kindIcon(r.kind)} ${esc(S.routeTitle(r))}</option>`).join('');
  $('buyTrain').innerHTML = Object.entries(CFG.kinds).map(([k, K]) =>
    `<button data-buy="${k}" ${G.money < K.price ? 'disabled' : ''}>${K.icon} ${K.levels[0].name}<br><b>${won(K.price)}</b><br><span class="muted">${K.levels[0].cap}명 · ${K.levels[0].vmax}km/h</span></button>`).join('');
  const r = G.routes.find(x => x.no === depotRouteNo);
  $('depot').innerHTML = (G.depot.length ? '' : '<p class="muted">차량기지가 비어 있습니다.</p>') + G.depot.map(t => {
    const L = CFG.kinds[t.kind].levels, nx = L[t.lvl + 1], tier = S.tierOf(t);
    const err = r ? S.canDispatch(t, r) : '노선을 먼저 고르세요';
    return `<div class="bus"><b>${trainLabel(t)}</b> <span class="muted">Lv${t.lvl + 1} · ${tier.cap}명 · ${tier.vmax}km/h${tier.elec || CFG.kinds[t.kind].elec ? ' · 전철화 선로만' : ''}</span>
      <div class="btns">
        <button class="primary" data-dispatch="${t.id}" ${err ? `disabled title="${esc(err)}"` : ''}>배차</button>
        ${nx ? upBtn(t) : ''}
        <button data-sell="${t.id}">매각 ${won(S.sellValue(t))}</button>
      </div></div>`;
  }).join('');
  const running = G.trains.slice().sort((a, b) => a.route.no - b.route.no);
  if (running.length) $('depot').innerHTML += `<h3>운행 중 (${running.length}대)</h3>` + running.map(t => {
    const tier = S.tierOf(t);
    return `<div class="bus">${trainLabel(t)} <span class="muted">· ${esc(S.routeTitle(t.route))} · Lv${t.lvl + 1} · ${tier.cap}명 · ${tier.vmax}km/h</span>
      <div class="btns">${upBtn(t)}<button data-recall="${t.id}">회수</button></div></div>`;
  }).join('');
}
// 등급 올리기 버튼(차량기지·운행 중·열차 카드 공용)
function upBtn(t) {
  const nx = CFG.kinds[t.kind].levels[t.lvl + 1];
  if (!nx) return '<span class="muted" style="font-size:12px;align-self:center">최고 등급</span>';
  const why = S.upgradeBlock(t);
  return `<button data-up="${t.id}" ${why || G.money < nx.upgrade ? 'disabled' : ''} title="${esc(why || '')}">⬆ ${nx.name} (${won(nx.upgrade)})</button>${why ? `<span class="muted" style="font-size:11px;flex-basis:100%">${esc(why)}</span>` : ''}`;
}
function renderRegions() {
  $('regions').innerHTML = S.D.regions.map(rg => {
    const ss = stations.filter(s => s.region === rg.id), on = ss.reduce((a, s) => a + s.on, 0);
    const open = G.unlocked.has(rg.id), c = CFG.unlockCost[rg.id], reach = S.regionReachable(rg.id);
    return `<div class="gu ${open ? 'open' : ''}" data-region="${rg.id}"><span><b>${esc(rg.name)}</b><br><span class="muted">역 ${ss.length}개 · 하루 승차 ${fmt(on)}명</span></span>
      ${open ? '<span class="tag ok">개방</span>' : `<button data-unlock="${rg.id}" ${!reach || G.money < c ? 'disabled' : ''} title="${reach ? '' : '열린 지역과 선로로 이어져야 합니다'}">${won(c)}</button>`}</div>`;
  }).join('');
}
function renderTracks() {
  const ls = lines.filter(l => S.openKm(l) > 0);
  ls.sort((a, b) => S.ownedKm(b) - S.ownedKm(a));
  $('tracks').innerHTML = ls.map(l => {
    let maxLoad = 0; for (const e of l.edges) maxLoad = Math.max(maxLoad, (S.edgeLoad.get(e.id) || 0) / S.edgeCap(e));
    const own = S.ownedKm(l) > 0;
    const btn = (what, label) => { const c = S.upgradeCost(l, what); return !own || c == null ? '' : `<button data-lup="${l.id}:${what}" ${G.money < c ? 'disabled' : ''}>${label} ${won(c)}</button>`; };
    const secs = l.sections.filter(sc => G.unlocked.has(sc.region)).map(sc => S.secOwned(sc)
      ? `<span class="tag ok">${esc(S.regionName[sc.region])} ${fmt(sc.km)}km</span>`
      : `<button data-buysec="${sc.id}" ${G.money < S.sectionPrice(sc) ? 'disabled' : ''}>🏷 ${esc(S.regionName[sc.region])} ${fmt(sc.km)}km ${won(S.sectionPrice(sc))}</button>`).join(' ');
    return `<div class="line"><b>${esc(l.name)}</b>
      <span class="tag ${l.kind === 'hs' ? '' : 'gray'}">${l.kind === 'hs' ? '고속선' : '일반선'}</span>
      <span class="tag ${S.lineElec(l) ? 'ok' : 'warn'}">${S.lineElec(l) ? '전철화' : '비전철'}</span>
      <span class="tag gray">${l.kind === 'hs' ? '고속 복선' : S.lineDbl(l) ? '복선' : '단선'}</span>
      <span class="tag gray">${S.lineVmax(l)}km/h</span>
      <div class="btns">${secs}</div>
      ${own ? `<div class="muted">가장 붐비는 구간 ${Math.round(maxLoad * 100)}% ${maxLoad > 1 ? '<span class="tag warn">용량 초과 → 감속</span>' : ''}</div>
      <div class="btns">${btn('elec', '⚡ 전철화')}${btn('dbl', '🛤 복선화')}${btn('speed', '🚀 고속화')}</div>` : ''}</div>`;
  }).join('') + `<h3>🚧 건설 중·계획 노선 (추후 업데이트 예정)</h3>` + CFG.future.map(f =>
    `<div class="line" style="opacity:.75"><b>${esc(f.name)}</b> <span class="tag gray">${esc(f.state)}</span><br><span class="muted">${esc(f.where)}</span></div>`).join('');
}
function renderBank() {
  const L = CFG.loan, g = S.creditGrade(), G0 = L.grades[g], lim = S.loanLimit(), can = S.canBorrow();
  const h = G.history.slice(-7);
  const prof = h.reduce((a, x) => a + x.revenue - x.cost + (x.pso || 0) - (x.interest || 0), 0);
  const step = L.step;
  $('bank').innerHTML = `
    <div class="line" style="display:flex;align-items:center"><span class="grade ${g}">${g}</span>
      <span>신용등급 <b>${g}</b> · 하루 이자 <b>${(G0.rate * 100).toFixed(2)}%</b><br><span class="muted">${esc(G0.desc)}</span></span></div>
    <div class="bankgrid">
      <span>빌린 돈</span><span>${won(G.debt)}</span>
      <span>내일 낼 이자</span><span>${won(Math.round(G.debt * G0.rate))}</span>
      <span>대출 한도</span><span>${won(lim)}</span>
      <span>더 빌릴 수 있는 돈</span><span>${won(can)}</span>
      <span class="muted">회사 자산 (열차·역·선로)</span><span class="muted">${won(S.assetValue())}</span>
      <span class="muted">최근 ${h.length}일 손익 (이자 포함)</span><span class="${prof >= 0 ? 'pos' : 'neg'}">${h.length ? won(prof) : '-'}</span>
    </div>
    ${G.negDays ? `<p class="neg" style="margin:0 0 8px">⚠️ 자금 마이너스 ${G.negDays}일째. ${L.graceDays}일이 되면 열차를 강제로 팝니다.</p>` : ''}
    <div class="wsub">빌리기</div>
    <div class="bankbtns">
      <button data-borrow="${step}" ${can < 1 ? 'disabled' : ''}>+${won(step)}</button>
      <button data-borrow="${step * 5}" ${can < 1 ? 'disabled' : ''}>+${won(step * 5)}</button>
      <button class="primary" data-borrow="max" ${can < 1 ? 'disabled' : ''}>한도까지</button>
    </div>
    <div class="wsub">갚기</div>
    <div class="bankbtns">
      <button data-repay="${step}" ${!G.debt || G.money <= 0 ? 'disabled' : ''}>-${won(step)}</button>
      <button data-repay="${step * 5}" ${!G.debt || G.money <= 0 ? 'disabled' : ''}>-${won(step * 5)}</button>
      <button data-repay="max" ${!G.debt || G.money <= 0 ? 'disabled' : ''}>${G.money >= G.debt ? '전부 갚기' : '가진 돈만큼'}</button>
    </div>
    <div class="legend">· 한도 = (${won(L.base)} + 자산 × ${L.assetRatio * 100}%) × 등급 배율<br>
      ${Object.entries(L.grades).map(([k, v]) => `· <b>${k}</b>: 하루 ${(v.rate * 100).toFixed(2)}% · 한도 ×${v.limitMul} — ${esc(v.desc)}`).join('<br>')}</div>`;
}
function renderHelp() {
  $('helpText').innerHTML = `
    · 드래그: 지도 이동 / 휠: 확대·축소 / Space: 일시정지<br>
    · 확장 순서: 🗺️ 지역 열기 → 🔧 선로 구간 사기 → 역 사기 → 노선 만들기<br>
    &nbsp;&nbsp;노선을 그리다 안 산 역·구간을 누르면 바로 살 수 있습니다<br>
    · 점선 테두리 역 = 아직 안 산 역 / 흐린 선로 = 아직 안 산 구간. 선로를 누르면 그 구간을 사거나 개량할 수 있습니다<br>
    · 새 노선: 종류 선택 → 정차할 역을 순서대로 클릭 → Enter(완료)<br>
    &nbsp;&nbsp;사이에 있는 역은 통과합니다(급행). Backspace: 마지막 역 취소 / Esc: 취소<br>
    · ✏️ 정차역 수정: 정차역 클릭 → 빼기, 다른 역 클릭 → 넣기, Enter 적용<br>
    · 🚃 일반열차: 무궁화호 → ITX-새마을 → ITX-마음(전철화 선로만)<br>
    · 🚈 광역열차: 대경선 같은 지역 통근열차. 싸고 많이 타지만 요금이 낮음. 전철화 선로만<br>
    · 🚄 고속열차: KTX-이음 → KTX-산천 → KTX-청룡. 고속선과 전철화된 일반선<br>
    · 선로 색: 파랑 = 고속선(KTX만), 초록 = 전철 일반선, 갈색 점선 = 비전철 일반선(무궁화·새마을만). 노선을 누르면 지나는 선로 종류가 색 띠와 km로 나옵니다<br>
    · 선로마다 시간당 다닐 수 있는 열차 수가 정해져 있습니다(단선 ${CFG.capSingle} · 복선 ${CFG.capDouble} · 고속선 ${CFG.capHs}). 넘치면 빨갛게 표시되고 느려집니다<br>
    · 역 크기 = 실제 하루 승차 인원(2025, 코레일). 게임 승객 1명 = 실제 ${Math.round(1 / CFG.demandScale)}명<br>
    · 역을 누르면 그 역 사람들이 가고 싶은 곳이 나옵니다. 아직 안 열린 지역으로 가려는 사람이 많으면 지역을 여세요<br>
    · 열차가 더 필요한지: 노선 카드 맨 위 판정을 보세요. 🔴 만석 = 열차 추가나 큰 등급, 🟠 배차 간격이 김 = 열차 추가, 🟡 남음 = 1대 빼도 됨, 🟢 적당<br>
    · 빠를수록(자동차보다), 자주 다닐수록 승객이 늘고, 오래 기다리면 떠납니다<br>
    · 승객은 한 번까지 갈아탑니다(예: 대경선 → 동대구 → KTX). 요금은 탄 열차마다 냅니다<br>
    · 🚧 건설 중인 노선(충청권 광역철도, 부전–마산 등)은 추후 업데이트로 추가됩니다<br>
    · 요금은 거리 비례(일반 ${CFG.kinds.general.levels[0].fare[1]}원/km~, KTX ${CFG.kinds.ktx.levels[0].fare[1]}원/km~). 운행비는 달린 거리만큼, 고정비는 하루 단위<br>
    · 결산은 달이 끝날 때마다(실제 달력, 2026년 1월부터) 합니다. 날짜가 넘어갈 때는 멈추지 않고, 자금 경고·강제 매각은 알림으로 알려 줍니다<br>
    · 🏦 은행: 회사 자산과 신용등급만큼 빌릴 수 있고, 이자는 날마다 자정에 빠져나갑니다. 흑자·만족도가 좋으면 등급이 올라 이자가 싸집니다<br>
    · 자금이 마이너스인 채로 ${CFG.loan.graceDays}일을 마치면 은행이 비싼 열차부터 강제로 팔고, 그래도 모자라면 파산합니다<br>
    · 적자여도 만족도 ${CFG.psoMinSat}% 이상이면 공익서비스 보상금(적자의 ${CFG.psoRatio * 100}%)`;
}
function renderPanel() {
  if (openPanelName === 'routes') renderRoutes();
  else if (openPanelName === 'depot') renderDepot();
  else if (openPanelName === 'regions') renderRegions();
  else if (openPanelName === 'tracks') renderTracks();
  else if (openPanelName === 'bank') renderBank();
  else if (openPanelName === 'help') renderHelp();
}
function renderBadges() {
  $('bRoutes').textContent = G.routes.length || '';
  $('bDepot').textContent = G.depot.length || '';
  const can = S.D.regions.filter(r => !G.unlocked.has(r.id) && S.regionReachable(r.id) && G.money >= CFG.unlockCost[r.id]).length;
  $('bRegions').textContent = can || '';
}
function renderTop() {
  $('day').textContent = dateTxt();
  $('clock').textContent = hhmm(G.t);
  $('money').textContent = won(G.money);
  $('money').style.color = G.money < 0 ? '#dc2626' : '';
  $('debtStat').style.display = G.debt > 0 ? '' : 'none'; $('debt').textContent = won(G.debt);
  const sat = S.satPct(); $('sat').textContent = sat == null ? '-' : Math.round(sat) + '%';
  $('rep').textContent = Math.round(G.rep * 100) + '%';
  $('cover').textContent = G.today.potential ? (G.today.pax / G.today.potential * 100).toFixed(1) + '%' : '-';
  const pk = S.peakAt(G.t), el = $('peak');
  el.style.display = pk ? '' : 'none'; if (pk) el.textContent = `${pk.icon} ${pk.name} 시간`;
  const M = G.mon, mp = M.revenue - M.opCost - M.fixed - M.interest + M.pso + G.today.revenue - G.today.cost;
  $('todayStat').textContent = `오늘 ${fmt(G.today.pax)}명 · 이번 달 ${fmt(M.pax + G.today.pax)}명 · 이번 달 손익 ${won(mp)}`;
}
function refreshAll() { assignSlots(); renderPanel(); renderInfo(); renderBadges(); renderTop(); save(); }

// ───────────────────────── 노선 그리기·수정 ─────────────────────────
function setHint(t) { const h = $('hint'); h.innerHTML = t; h.style.display = t ? 'block' : 'none'; }
function startDrawing(kind) {
  cancelEdit();
  drawing = { kind, stops: [], legs: [] };
  cv.classList.add('drawing'); hidePanelForMap(); selected = null; renderInfo();
  setHint(`${kindIcon(kind)} <b>새 ${CFG.kinds[kind].name} 노선</b>: 정차할 역을 순서대로 누르세요
    <div class="hintbtns"><button data-draw="undo" title="Backspace">↩ 되돌리기</button><button data-draw="cancel" title="Esc">취소</button><button class="primary" data-draw="done" title="Enter">완료</button></div>`);
}
// 안 산 역이면 살지 묻고 삼. 샀으면 true
async function ensureStation(s) {
  if (S.stOwned(s)) return true;
  if (!S.isOpen(s)) { toast('아직 열지 않은 지역의 역입니다'); return false; }
  const c = S.stationPrice(s);
  if (!await ask(`${s.name}역은 아직 사지 않았습니다.\n${won(c)}에 사서 정차역으로 넣을까요?`, `${won(c)}에 사기`)) return false;
  return check(S.buyStation(s), `${s.name}역을 샀습니다`);
}
// a → b 길: 산 선로로 안 이어지면 필요한 구간을 사겠냐고 물음
async function pathOrBuy(a, b, kind) {
  let P = S.findPath(a, b, kind);
  if (P) return P;
  const Q = S.findPath(a, b, kind, true);
  if (!Q) { toast(`${CFG.kinds[kind].name}이(가) 다닐 수 있는 선로로 이어지지 않습니다 (열린 지역·전철화 확인)`); return null; }
  const need = S.missingSections(Q), total = need.reduce((x, sc) => x + S.sectionPrice(sc), 0);
  if (!await ask(`이 구간 선로를 아직 사지 않았습니다.\n${need.map(sc => `· ${sc.line.name} ${S.regionName[sc.region]} 구간 ${fmt(sc.km)}km  ${won(S.sectionPrice(sc))}`).join('\n')}\n\n모두 ${won(total)}에 살까요?`, `${won(total)}에 사기`)) return null;
  if (!check(S.buySections(need), '선로 구간을 샀습니다')) return null;
  return S.findPath(a, b, kind);
}
let busy = false; // 확인창을 기다리는 중에는 다른 클릭 무시
async function drawClick(s) {
  const st = drawing.stops;
  if (st.includes(s.id)) return toast('이미 넣은 역입니다');
  if (!await ensureStation(s) || !drawing) return;
  if (st.length) {
    const P = await pathOrBuy(st[st.length - 1], s.id, drawing.kind);
    if (!P || !drawing) return;
    drawing.legs.push(P);
  }
  st.push(s.id);
}
function finishDrawing() {
  if (!drawing) return;
  if (drawing.stops.length < 2) { toast('역을 2개 이상 고르세요'); return; }
  const r = S.addRoute(drawing.kind, drawing.stops);
  drawing = null; cv.classList.remove('drawing'); setHint('');
  if (!r) return toast('노선을 만들 수 없습니다');
  selected = { type: 'route', r }; depotRouteNo = r.no;
  toast(`${S.routeTitle(r)} 노선을 만들었습니다. 열차를 배차하세요`, '#15803d');
  refreshAll();
}
function cancelDrawing() { drawing = null; cv.classList.remove('drawing'); setHint(''); restorePanel(); }

function startEdit(r) {
  cancelDrawing();
  editing = { r, kind: r.kind, stops: r.stops.slice(), legs: r.legs.slice() };
  cv.classList.add('drawing'); hidePanelForMap();
  setHint(`✏️ <b>${esc(S.routeTitle(r))}</b> 정차역 수정: 정차역 누르면 빼기 · 다른 역 누르면 넣기
    <div class="hintbtns"><button data-draw="cancel" title="Esc">취소</button><button class="primary" data-draw="done" title="Enter">적용</button></div>`);
}
async function editClick(s) {
  const st = editing.stops, k = st.indexOf(s.id);
  if (k >= 0) {
    if (st.length <= 2) return toast('정차역은 2개 이상이어야 합니다');
    st.splice(k, 1);
  } else {
    if (!await ensureStation(s) || !editing) return;
    // 가장 덜 돌아가는 자리에 끼워 넣기
    let best = null;
    for (let i = 0; i <= st.length; i++) {
      const cand = [...st.slice(0, i), s.id, ...st.slice(i)];
      const legs = S.buildLegs(editing.kind, cand);
      if (!legs) continue;
      const km = legs.reduce((a, l) => a + l.km, 0);
      if (!best || km < best.km) best = { km, cand };
    }
    if (!best) return toast('이 역은 산 선로로 노선과 이어지지 않습니다. 🔧 선로에서 구간을 먼저 사세요');
    st.splice(0, st.length, ...best.cand);
  }
  editing.legs = S.buildLegs(editing.kind, st) || [];
}
function applyEdit() {
  const res = S.setRouteStops(editing.r, editing.stops);
  const r = editing.r;
  cancelEdit();
  if (check(res, '정차역을 바꿨습니다')) selected = { type: 'route', r };
  refreshAll();
}
function cancelEdit() { if (!editing) return; editing = null; cv.classList.remove('drawing'); setHint(''); restorePanel(); }

// ───────────────────────── 입력 ─────────────────────────
function stationAt(px, py) {
  let best = null, bd = 14;
  for (const s of stations) { const d = Math.hypot(sx(s.x) - px, sy(s.y) - py) - stationR(s); if (d < bd) { bd = d; best = s; } }
  return best;
}
function trainAt(px, py) {
  let best = null, bd = 10;
  for (const t of G.trains) { const p = trainScreen(t), d = Math.hypot(p.X - px, p.Y - py); if (d < bd) { bd = d; best = t; } }
  return best;
}
// 화면 점들(선)과 점 사이 거리
function distToPts(pts, px, py) {
  let bd = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
    const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
    const u = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / L2));
    bd = Math.min(bd, Math.hypot(x1 + u * (x2 - x1) - px, y1 + u * (y2 - y1) - py));
  }
  return bd;
}
// 선로 구간(엣지) 누르기
function edgeAt(px, py, tol = 8) {
  let best = null, bd = tol;
  for (const e of edges) {
    if (!edgeVisible(e)) continue;
    const d = distToPts(edgeScreen(e, 0), px, py);
    if (d < bd) { bd = d; best = e; }
  }
  edgeAt.d = bd;
  return best;
}
const stationDist = (s, px, py) => Math.hypot(sx(s.x) - px, sy(s.y) - py) - stationR(s);
function routeAt(px, py) {
  let best = null, bd = 6;
  for (const r of G.routes) for (const leg of r.legs) for (const e of leg.edges) {
    if (!edgeVisible(e)) continue;
    const pts = edgeScreen(e, edgeOffset(e, r));
    for (let k = 1; k < pts.length; k++) {
      const [x1, y1] = pts[k - 1], [x2, y2] = pts[k];
      const L2 = (x2 - x1) ** 2 + (y2 - y1) ** 2 || 1;
      const u = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / L2));
      const d = Math.hypot(x1 + u * (x2 - x1) - px, y1 + u * (y2 - y1) - py);
      if (d < bd) { bd = d; best = r; }
    }
  }
  return best;
}
// 마우스·터치 공통(포인터). 한 손가락/마우스 = 끌어서 이동·누르기, 두 손가락 = 확대·축소
let drag = null;
const pointers = new Map(); // pointerId → {x, y}
let pinch = null;
const localXY = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
cv.style.touchAction = 'none';
cv.addEventListener('pointerdown', e => {
  const [x, y] = localXY(e);
  pointers.set(e.pointerId, { x, y });
  cv.setPointerCapture?.(e.pointerId);
  if (pointers.size === 2) {
    const [p1, p2] = [...pointers.values()];
    pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), z: cam.z, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2, wx: wx((p1.x + p2.x) / 2), wy: wy((p1.y + p2.y) / 2) };
    drag = null;
  } else if (pointers.size === 1) { drag = { x, y, cx: cam.x, cy: cam.y, moved: false }; cv.style.cursor = 'grabbing'; }
});
cv.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const [x, y] = localXY(e);
  pointers.set(e.pointerId, { x, y });
  if (pinch && pointers.size >= 2) {
    const [p1, p2] = [...pointers.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y), mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    cam.z = Math.max(0.5, Math.min(60, pinch.z * d / (pinch.d || 1)));
    cam.x = pinch.wx - (mx - W / 2) / cam.z; cam.y = pinch.wy - (my - H / 2) / cam.z;
  }
});
function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
  cv.style.cursor = '';
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved || e.type === 'pointercancel') return;
  const [px, py] = localXY(e);
  const s = stationAt(px, py);
  if (drawing || editing) {
    if (s && !busy) { busy = true; (drawing ? drawClick(s) : editClick(s)).finally(() => { busy = false; }); }
    return;
  }
  const t = trainAt(px, py), tol = e.pointerType === 'touch' ? 16 : 8;
  // 역보다 선로에 확실히 더 가까우면 선로를 고름(축소했을 때 역이 촘촘해서)
  const ed0 = s ? edgeAt(px, py, tol) : null;
  if (t) selected = { type: 'train', t };
  else if (ed0 && edgeAt.d < stationDist(s, px, py) - 3) selected = { type: 'track', e: ed0 };
  else if (s) selected = { type: 'station', s };
  else {
    const r = routeAt(px, py);
    if (r) selected = { type: 'route', r };
    else {
      const ed = edgeAt(px, py, e.pointerType === 'touch' ? 16 : 8);
      if (ed) selected = { type: 'track', e: ed };
      else { const rg = regionAt(px, py); selected = rg ? { type: 'region', id: rg.id } : null; }
    }
  }
  renderInfo();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointermove', e => {
  mouse = { x: e.offsetX, y: e.offsetY };
  if (pinch) return;
  if (drag) {
    if (Math.hypot(e.offsetX - drag.x, e.offsetY - drag.y) > (e.pointerType === 'touch' ? 10 : 4)) drag.moved = true;
    if (!drag.moved) return;
    cam.x = drag.cx - (e.offsetX - drag.x) / cam.z; cam.y = drag.cy - (e.offsetY - drag.y) / cam.z;
    return;
  }
  if (e.pointerType === 'touch') return; // 터치에는 마우스 올리기가 없음
  hoverStation = stationAt(e.offsetX, e.offsetY);
  hoverTrain = hoverStation ? null : trainAt(e.offsetX, e.offsetY);
  const tip = $('tooltip');
  if (hoverStation || hoverTrain) {
    let txt;
    if (hoverStation) {
      const s = hoverStation, q = (G.waiting.get(s.id) || []).length;
      txt = `<b>${esc(s.name)}</b> · 실제 하루 ${fmt(s.on)}명 승차${q ? ` · 대기 ${q}명` : ''}${!S.isOpen(s) ? ' · 미개방' : S.stOwned(s) ? '' : ` · 미보유 ${won(S.stationPrice(s))}`}`;
      if (drawing && drawing.stops.length) {
        const a = drawing.stops[drawing.stops.length - 1], P = S.findPath(a, s.id, drawing.kind);
        const Q = P ? null : S.findPath(a, s.id, drawing.kind, true);
        txt += P ? ` · +${fmt(P.km)}km` : Q ? ` · <span class="neg">선로 구간 구입 필요 ${won(S.missingSections(Q).reduce((x, sc) => x + S.sectionPrice(sc), 0))}</span>` : ' · <span class="neg">연결 안 됨</span>';
      }
    } else {
      const t = hoverTrain; txt = `${trainLabel(t)} · ${t.pax.length}/${S.tierOf(t).cap}명`;
    }
    tip.innerHTML = txt; tip.style.display = 'block'; tip.style.left = (e.offsetX + 14) + 'px'; tip.style.top = (e.offsetY + 12) + 'px';
  } else if (!drawing && !editing) {
    const ed = edgeAt(e.offsetX, e.offsetY);
    if (ed) {
      const sc = ed.secs.find(x => !S.secOwned(x)) || ed.secs[0];
      tip.innerHTML = `<b>${esc(ed.line.name)}</b> · ${esc(S.regionName[sc.region])} 구간 ${fmt(sc.km)}km · ${S.secOwned(sc) ? '보유' : G.unlocked.has(sc.region) ? `${won(S.sectionPrice(sc))} (눌러서 사기)` : '미개방 지역'}`;
      tip.style.display = 'block'; tip.style.left = (e.offsetX + 14) + 'px'; tip.style.top = (e.offsetY + 12) + 'px';
      cv.style.cursor = 'pointer';
    } else { tip.style.display = 'none'; cv.style.cursor = ''; }
  } else tip.style.display = 'none';
});
cv.addEventListener('wheel', e => {
  e.preventDefault();
  const k = Math.exp(-e.deltaY * 0.0015), bx = wx(e.offsetX), by = wy(e.offsetY);
  cam.z = Math.max(0.5, Math.min(60, cam.z * k));
  cam.x = bx - (e.offsetX - W / 2) / cam.z; cam.y = by - (e.offsetY - H / 2) / cam.z;
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if ($('modal').style.display === 'flex') {
    if (e.key === 'Enter') $('modalBox').querySelector('button.primary')?.click();
    else if (e.key === 'Escape') $('askNo')?.click();
    return;
  }
  if (drawing) {
    if (e.key === 'Enter') finishDrawing();
    else if (e.key === 'Escape') cancelDrawing();
    else if (e.key === 'Backspace') { e.preventDefault(); drawing.stops.pop(); drawing.legs.splice(Math.max(0, drawing.stops.length - 1)); }
    return;
  }
  if (editing) { if (e.key === 'Enter') applyEdit(); else if (e.key === 'Escape') cancelEdit(); return; }
  if (e.key === ' ') { e.preventDefault(); G.paused = !G.paused; setSpeedUI(); }
  else if (e.key === 'Escape') { if (openPanelName) openPanel(null); else { selected = null; renderInfo(); } }
  else if ('123456'.includes(e.key)) { const n = Object.keys(PANELS)[+e.key - 1]; openPanel(openPanelName === n ? null : n); }
});

// 버튼(위임)
document.addEventListener('click', e => {
  const b = e.target.closest('button, .route, .gu'); if (!b) return;
  const d = b.dataset;
  const findT = id => G.trains.find(t => t.id === +id) || G.depot.find(t => t.id === +id);
  const findR = no => G.routes.find(r => r.no === +no);
  if (d.draw) {
    if (busy) return;
    if (d.draw === 'done') { if (drawing) finishDrawing(); else if (editing) applyEdit(); }
    else if (d.draw === 'cancel') { if (drawing) cancelDrawing(); else cancelEdit(); }
    else if (d.draw === 'undo' && drawing) { drawing.stops.pop(); drawing.legs.splice(Math.max(0, drawing.stops.length - 1)); }
  }
  else if (d.panel) openPanel(openPanelName === d.panel ? null : d.panel);
  else if (d.newroute) startDrawing(d.newroute);
  else if (d.route && !e.target.closest('button')) { const r = findR(d.route); selected = { type: 'route', r }; depotRouteNo = r.no; focusRoute(r); renderInfo(); }
  else if (d.buy) { const res = S.buyTrain(d.buy); if (check(res, `${CFG.kinds[d.buy].levels[0].name}을(를) 샀습니다`)) refreshAll(); }
  else if (d.up) { const t = findT(d.up); check(S.upgradeTrain(t), `${S.tierOf(t).name}(으)로 올렸습니다`); }
  else if (d.sell) { const t = findT(d.sell); ask(`${trainLabel(t)}을(를) ${won(S.sellValue(t))}에 팔까요?`, '팔기').then(ok => { if (ok) { S.sellTrain(t); refreshAll(); } }); }
  else if (d.dispatch) { const r = findR(depotRouteNo); if (r) check(S.dispatch(findT(d.dispatch), r), `${S.routeTitle(r)}에 배차했습니다`); }
  else if (d.recall) { const t = G.trains.find(x => x.id === +d.recall); if (t) { S.recall(t); if (selected?.t === t) selected = null; refreshAll(); } }
  else if (d.add) { const r = findR(d.add); const t = G.depot.find(x => x.kind === r.kind && !S.canDispatch(x, r)) || G.depot.find(x => x.kind === r.kind); check(S.dispatch(t, r), '배차했습니다'); }
  else if (d.buyadd) {
    const r = findR(d.buyadd), res = S.buyTrain(r.kind);
    if (res.err) return toast(res.err);
    check(S.dispatch(res.t, r), `${CFG.kinds[r.kind].levels[0].name}을(를) 사서 배차했습니다`);
  }
  else if (d.edit) startEdit(findR(d.edit));
  else if (d.del) { const r = findR(d.del); ask(`${S.routeTitle(r)} 노선을 지울까요?\n열차는 차량기지로 돌아갑니다.`, '지우기').then(ok => { if (ok) { S.deleteRoute(r); selected = null; refreshAll(); } }); }
  else if (d.selroute) { selected = { type: 'route', r: findR(d.selroute) }; renderInfo(); }
  else if (d.unlock) { const id = d.unlock; if (check(S.unlockRegion(id), `${S.regionName[id]}을(를) 열었습니다`)) fitStations(stations.filter(s => s.region === id || G.unlocked.has(s.region))); }
  else if (d.region && !e.target.closest('button')) fitStations(stations.filter(s => s.region === d.region));
  else if (d.buyst) { const st = stations[+d.buyst]; check(S.buyStation(st), `${st.name}역을 샀습니다`); }
  else if (d.buysec) { const sc = S.secById.get(d.buysec); check(S.buySection(sc), `${sc.line.name} ${S.regionName[sc.region]} 구간을 샀습니다`); }
  else if (d.borrow) { const r = S.borrow(d.borrow === 'max' ? Infinity : +d.borrow); check(r, r.amount ? `${won(r.amount)}을 빌렸습니다` : ''); }
  else if (d.repay) { const r = S.repay(d.repay === 'max' ? Infinity : +d.repay); check(r, r.amount ? `${won(r.amount)}을 갚았습니다` : ''); }
  else if (d.newgame) { try { localStorage.removeItem(S.SAVE_KEY); } catch (e) { /* 없음 */ } location.reload(); }
  else if (d.lup) { const [id, what] = d.lup.split(':'); check(S.upgradeLine(lines.find(l => l.id === id), what), '공사를 마쳤습니다'); }
});
$('depotRoute').addEventListener('change', e => { depotRouteNo = +e.target.value || null; renderDepot(); });
$('panelClose').onclick = () => openPanel(null);
$('infoClose').onclick = () => { selected = null; renderInfo(); };
function focusRoute(r) { fitStations(r.stops.map(id => stations[id])); }

// 속도
const SPEEDS = [0, 1, 3, 10, 30, 100];
function setSpeedUI() { SPEEDS.forEach((v, i) => $('sp' + i).classList.toggle('on', G.paused ? i === 0 : v === G.speed)); }
SPEEDS.forEach((v, i) => $('sp' + i).onclick = () => { if (!v) G.paused = !G.paused; else { G.speed = v; G.paused = false; } setSpeedUI(); });

// ───────────────────────── 하루 마감 ─────────────────────────
const dateTxt = (day = G.day) => { const d = S.dateOf(day); return `${d.y}년 ${d.m}월 ${d.d}일 (${d.w})`; };
const monthTxt = dt => `${dt.y}년 ${dt.m}월`;
// 하루 마감: 날마다 조용히 넘어가고, 달이 끝나면 월 결산을 보여 줌
function endDay() {
  const R = S.closeDay();
  if (R.over) {
    G.paused = true; setSpeedUI(); save();
    showModal(`<h2 style="margin:0 0 8px">파산</h2>
      <p class="neg">자금이 ${CFG.loan.graceDays}일 넘게 마이너스였고, 은행이 열차를 모두 팔아도 모자랐습니다.</p>
      <p>빚 ${won(G.debt)} · 자금 ${won(G.money)}</p>
      <button class="primary" data-newgame="1" style="width:100%">새 게임</button>`);
    return;
  }
  if (R.sold.length) toast(`🏦 은행이 열차를 강제로 팔았습니다: ${R.sold.map(x => x.label).join(', ')}`);
  else if (R.negDays) toast(`⚠️ 자금 마이너스 ${R.negDays}일째 — ${CFG.loan.graceDays}일이면 열차 강제 매각`);
  if (!R.monthEnd) { S.startNextDay(); refreshAll(); return; }
  // 월 결산
  G.paused = true; setSpeedUI();
  const M = S.monthReport();
  const repDiff = (M.rep - M.repStart) * 100, cash = M.money - M.moneyStart;
  const rows = M.routes.slice(0, 8).map(x => { const p = x.rev - x.cost; return `<tr><td>${kindIcon(x.r.kind)} ${esc(S.routeTitle(x.r))} <span class="muted">${fmt(x.pax)}명</span></td><td class="${p >= 0 ? 'pos' : 'neg'}">${won(p)}</td></tr>`; }).join('');
  showModal(`
    <h2 style="margin:0">${monthTxt(M.date)} 결산 <span class="muted" style="font-size:14px;font-weight:400">${M.days}일</span></h2>
    <div style="max-height:62vh;overflow-y:auto">
    <table>
      <tr><td>수송 승객</td><td>${fmt(M.pax)}명 <span class="muted">(실제 ${fmt(M.pax / CFG.demandScale)}명)</span></td></tr>
      <tr><td>하루 평균</td><td>${fmt(M.pax / Math.max(1, M.days))}명</td></tr>
      <tr><td>갈아탄 승객</td><td>${fmt(M.transfers)}명</td></tr>
      <tr><td>기다리다 떠난 승객</td><td>${fmt(M.gaveUp)}명</td></tr>
      <tr><td>만석으로 못 탄 승객</td><td class="${M.leftBehind ? 'neg' : ''}">${fmt(M.leftBehind)}명</td></tr>
      <tr><td>수요 충족률</td><td>${M.cover.toFixed(1)}%</td></tr>
      <tr><td>평균 만족도</td><td>${M.sat == null ? '-' : M.sat.toFixed(0) + '%'}</td></tr>
      <tr><td>평판 (수요 배율)</td><td>${(M.rep * 100).toFixed(0)}% <span class="${repDiff >= 0 ? 'pos' : 'neg'}">(${repDiff >= 0 ? '+' : ''}${repDiff.toFixed(1)})</span></td></tr>
      <tr><td colspan=2><hr></td></tr>
      <tr><td>운임 수입</td><td class="pos">+${won(M.revenue)}</td></tr>
      <tr><td>운행비 (${fmt(M.trainKm)}열차km)</td><td class="neg">-${won(M.opCost)}</td></tr>
      <tr><td>차량 고정비</td><td class="neg">-${won(M.fixed)}</td></tr>
      ${M.interest ? `<tr><td>대출 이자</td><td class="neg">-${won(M.interest)}</td></tr>` : ''}
      <tr><td>공익서비스 보상금</td><td class="pos">+${won(M.pso)}</td></tr>
      <tr><td><b>영업 순이익</b></td><td class="${M.profit >= 0 ? 'pos' : 'neg'}"><b>${won(M.profit)}</b></td></tr>
      <tr><td>투자 (지역·역·선로·열차·개량)</td><td class="muted">${won(M.bought)}</td></tr>
      <tr><td>보유 자금</td><td>${won(M.money)} <span class="${cash >= 0 ? 'pos' : 'neg'}">(${cash >= 0 ? '+' : ''}${won(cash)})</span></td></tr>
      ${M.debt || M.debtStart ? `<tr><td>은행 빚 (등급 ${M.grade})</td><td>${won(M.debt)}</td></tr>` : ''}
      ${rows ? `<tr><td colspan=2><hr></td></tr><tr><td colspan=2><b>노선별 이달 손익</b> <span class="muted">(운임 − 운행비)</span></td></tr>${rows}` : ''}
    </table>
    ${M.sold.length ? `<p class="neg">🏦 이달 강제 매각: ${M.sold.map(x => `${esc(x.label)} (${won(x.value)})`).join(', ')}</p>` : ''}
    ${M.leftBehind > M.pax * 0.05 ? '<p class="muted">만석으로 못 탄 승객이 많았습니다. 붐비는 노선에 열차를 더 넣거나 등급을 올리세요.</p>' : ''}
    ${M.gaveUp > M.pax * 0.3 ? '<p class="muted">기다리다 떠난 승객이 많습니다. 배차 간격을 줄이세요.</p>' : ''}
    </div>
    <button class="primary" id="nextDay" style="width:100%;margin-top:10px">${monthTxt(S.dateOf(G.day + 1))} 시작</button>`);
  $('nextDay').onclick = () => { hideModal(); S.startNextDay(); S.startMonth(); G.paused = false; setSpeedUI(); refreshAll(); };
  save();
}

// ───────────────────────── 저장 ─────────────────────────
function save() { try { localStorage.setItem(S.SAVE_KEY, S.serialize()); } catch (e) { /* 저장 공간 없음 */ } }
function load() {
  let s = null;
  try { s = localStorage.getItem(S.SAVE_KEY); } catch (e) { return false; } // 저장소를 못 쓰는 환경
  if (!s) return false;
  try { S.deserialize(s); return true; } catch (e) { console.warn('저장 불러오기 실패', e); return false; }
}

// ───────────────────────── 루프 ─────────────────────────
let last = performance.now(), uiTimer = 0;
function frame(now) {
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!G.paused && $('modal').style.display !== 'flex') {
    let dt = dtReal * G.speed; // 1x = 1초에 게임 1분
    while (dt > 0 && !G.paused) {
      const step = Math.min(dt, 0.25);
      S.tick(step); dt -= step;
      if (G.t >= CFG.dayEndMin) { endDay(); break; }
    }
  }
  draw();
  uiTimer += dtReal;
  if (uiTimer > 0.3) { uiTimer = 0; renderTop(); if (selected && !$('info').matches(':hover')) renderInfo(); if (openPanelName === 'routes' && !$('panel').matches(':hover')) renderRoutes(); }
  requestAnimationFrame(frame);
}

resize();
const loaded = load();
if (!loaded) S.setupNewGame();
if (G.over) setTimeout(() => { G.paused = true; showModal(`<h2 style="margin:0 0 8px">파산</h2><p>지난 게임은 파산으로 끝났습니다.</p><button class="primary" data-newgame="1" style="width:100%">새 게임</button>`); }, 0);
S.rebuildNetwork(); assignSlots();
fitStations(stations.filter(s => s.region === CFG.startRegion));
renderTop(); renderBadges(); setSpeedUI();
if (!loaded) {
  G.paused = true; setSpeedUI();
  showModal(`<h2 style="margin:0 0 8px">🚄 전국 철도 경영</h2>
    <p style="line-height:1.7"><b>동대구역</b> 하나와 차량기지의 <b>무궁화호 1대</b>로 시작합니다. 경부선 대구권 구간도 가지고 있습니다.</p>
    <p style="line-height:1.7">첫 노선을 만들어 보세요. 🛤️ 노선 → 🚃 새 일반열차 → 동대구와 다른 역을 차례로 누르면, 아직 안 산 역은 그 자리에서 살 수 있습니다. 그다음 노선 카드에서 무궁화호를 배차합니다.</p>
    <p style="line-height:1.7">역을 눌러 사람들이 어디로 가고 싶은지 보세요. 대구 사람들은 대부분 서울·부산으로 갑니다.</p>
    <p style="line-height:1.7">넓히는 순서: 🗺️ <b>지역 열기</b> → 🔧 <b>선로 구간 사기</b> → <b>역 사기</b> → 노선 만들기. 노선을 그리다 안 산 역이나 구간을 누르면 바로 살 수 있습니다. 승객은 한 번까지 갈아탑니다.</p>
    <p class="muted">수요: 한국철도공사 역별 승하차(2025)를 하루 평균으로 나눈 값. 2026년 1월 1일부터 시작해 달이 끝날 때마다 결산하고, 진행은 브라우저에 하루 단위로 저장됩니다.</p>
    <button class="primary" id="startBtn" style="width:100%">시작</button>`);
  $('startBtn').onclick = () => { hideModal(); G.paused = false; setSpeedUI(); save(); };
}
requestAnimationFrame(frame);
window.__UI = { G, S, cam, sx, sy, fitStations }; // 디버그·자동 점검용
