'use strict';
// 전국 철도 경영 — 화면·조작
const S = window.SIM;
const { CFG, G, stations, edges, lines } = S;

// ───────────────────────── 도우미 ─────────────────────────
const $ = id => document.getElementById(id);
const narrow = window.matchMedia('(max-width: 640px)'); // 폰 화면
// 안드로이드: 이모지와 숫자가 한 글자 덩어리에 있으면 숫자까지 이모지 글꼴로 그려져 간격이 벌어짐
// → 화면에 들어오는 글자 중 '이모지 + 숫자'가 함께 있으면 이모지만 <span class="em">으로 떼어 냄
const EMOJI = /(\p{Extended_Pictographic}\uFE0F?)/u;
function splitEmoji(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const todo = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.nodeValue;
    if (/\d/.test(t) && EMOJI.test(t) && !n.parentNode.classList?.contains('em')) todo.push(n);
  }
  for (const n of todo) {
    const frag = document.createDocumentFragment();
    for (const part of n.nodeValue.split(EMOJI)) {
      if (!part) continue;
      if (EMOJI.test(part)) { const sp = document.createElement('span'); sp.className = 'em'; sp.textContent = part; frag.appendChild(sp); }
      else frag.appendChild(document.createTextNode(part));
    }
    n.parentNode.replaceChild(frag, n);
  }
}
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) splitEmoji(n); else if (n.nodeType === 3 && n.parentNode) splitEmoji(n.parentNode); })
  .observe(document.body, { childList: true, subtree: true });
splitEmoji(document.body);
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
// 버튼 여러 개 확인창: [{ key, label, primary }] → 누른 key (닫으면 null)
function askChoice(msg, buttons) {
  return new Promise(res => {
    showModal(`<p style="white-space:pre-line;line-height:1.7;margin:0 0 16px">${esc(msg)}</p>
      <div style="display:flex;flex-direction:column;gap:8px">${buttons.map(b => `<button data-choice="${b.key}" class="${b.primary ? 'primary' : ''}">${esc(b.label)}</button>`).join('')}
      <button id="askNo">취소</button></div>`);
    $('modalBox').querySelectorAll('[data-choice]').forEach(el => el.onclick = () => { hideModal(); res(el.dataset.choice); });
    $('askNo').onclick = () => { hideModal(); res(null); };
  });
}
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
// 조사: 받침 있으면 a, 없으면 b (예: josa('경북선', '이', '가') → '경북선이')
const josa = (w, a, b) => { const t = String(w).replace(/\s*\([^)]*\)\s*$/, ''), c = t.charCodeAt(t.length - 1) - 0xAC00; return w + (c >= 0 && c < 11172 && c % 28 ? a : b); }; // 끝의 (괄호)는 빼고 받침 판단
const trainLabel = t => `${kindIcon(t.kind)} ${t.no}호 ${S.tierOf(t).name}`;
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
const regionLv = id => CFG.gate.region[id] || 1;
const lvLocked = need => S.level() < need;
const lockTag = need => `🔒 Lv${need}`;
const canUnlock = id => !G.unlocked.has(id) && S.regionReachable(id) && !lvLocked(regionLv(id));

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
// 역 규모 5단계(실제 하루 승차): 점 → 동그라미 → 두 줄 동그라미 → 네모 → 두 줄 네모. r = 반지름(네모는 한 변의 절반)
const STATION_TIERS = [
  { min: 0, name: '간이역', shape: 'dot', r: 3 },
  { min: 200, name: '소형역', shape: 'circle', r: 5 },
  { min: 1000, name: '중형역', shape: 'circle2', r: 7 },
  { min: 4000, name: '대형역', shape: 'square', r: 8 },
  { min: 12000, name: '초대형역', shape: 'square2', r: 10.5 },
];
const tierOfStation = s => { let t = STATION_TIERS[0]; for (const x of STATION_TIERS) if (s.on >= x.min) t = x; return t; };
const zoomMul = () => Math.min(1.6, Math.max(0.7, Math.sqrt(cam.z / 3)));
const stationR = s => tierOfStation(s).r * zoomMul();
// 역 모양 경로: 동그라미 또는 모서리 둥근 네모
function stationPath(shape, X, Y, r) {
  ctx.beginPath();
  if (shape === 'square' || shape === 'square2') ctx.roundRect(X - r, Y - r, r * 2, r * 2, r * 0.3);
  else ctx.arc(X, Y, r, 0, Math.PI * 2);
}
// 역 그리기: fill·stroke·선 굵기·점선은 상태(미개방·미보유·정차역·선택)에 따라
function drawStation(s, X, Y, fill, stroke, lw, dash) {
  const t = tierOfStation(s), r = t.r * zoomMul();
  stationPath(t.shape, X, Y, r);
  ctx.fillStyle = fill; ctx.fill();
  ctx.setLineDash(dash); ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke();
  if (t.shape === 'circle2' || t.shape === 'square2') { // 안쪽 두 번째 줄
    stationPath(t.shape, X, Y, r * 0.5);
    ctx.setLineDash([]); ctx.lineWidth = Math.max(1, lw * 0.7); ctx.stroke();
  }
  ctx.setLineDash([]);
}

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
        const need = regionLv(r.id), c = CFG.unlockCost[r.id], reach = S.regionReachable(r.id), ok = reach && G.money >= c && !lvLocked(need);
        const t2 = lvLocked(need) ? `회사 레벨 ${need} 필요 · ${won(c)}` : `${won(c)}${reach ? (ok ? ' · 열 수 있음' : '') : ' · 이어진 지역 먼저'}`;
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
      if (!P) { P = S.findPath(a, hoverStation.id, drawing.kind, true) || S.findPath(a, hoverStation.id, drawing.kind, 'all'); ctx.strokeStyle = '#f59e0b'; }
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
    drawStation(s, X, Y,
      !open ? '#e5e7eb' : stopSet.has(s.id) ? '#fde68a' : own ? '#ffffff' : '#f1f5f9',
      !open ? '#9ca3af' : s === hoverStation ? '#2563eb' : '#1f2937',
      s === hoverStation || selected?.s === s ? 3 : served ? 2 : 1.3,
      open && !own ? [2, 2] : []);
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
  // 고른 노선(또는 그리는 중인 노선)의 정차 순서 번호
  const numRoute = selected?.type === 'route' ? selected.r.stops : plan ? plan.stops : null;
  if (numRoute) {
    ctx.font = '800 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    numRoute.forEach((id, i) => {
      const st = stations[id], X = sx(st.x) - stationR(st) - 9, Y = sy(st.y) - stationR(st) - 4;
      ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(X, Y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), X, Y + 0.5);
    });
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
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
  let h = `<div><b style="font-size:15px">${esc(s.name)}역</b> <span class="tag">${tierOfStation(s).name}</span> <span class="tag gray">${esc(S.regionName[s.region])}</span> ${open ? '' : '<span class="tag warn">미개방</span>'}</div>
    <div class="muted">${esc(s.si)} · 실제 하루 승차 ${fmt(s.on)}명 · 하차 ${fmt(s.off)}명${s.ktx ? ` · KTX ${Math.round(s.ktx * 100)}%` : ''}</div>`;
  if (open && !S.stOwned(s)) h += `<div style="margin-top:6px"><button class="primary" data-buyst="${s.id}" ${G.money < S.stationPrice(s) ? 'disabled' : ''}>🏷 역 사기 ${won(S.stationPrice(s))}</button> <span class="muted">사야 열차를 세울 수 있습니다</span></div>`;
  if (open) {
    h += `<div style="margin-top:6px">🧍 기다리는 승객 <b>${fmt(q.length)}</b>명 · 지나는 노선 ${rs.length}개${T ? ` · 이어진 수요 ${Math.round(T.served * 100)}%` : ''}</div>`;
    h += boardHtml(s);
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
// 정차 순서: ① 정차역 → (사이에 지나치는 역은 작게 '통과') → ② 다음 정차역 …
const circled = n => n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
function routeStopsHtml(r) {
  let h = `<div class="wsub" style="margin-top:6px">정차 순서 (${r.stops.length}역)</div><div class="stopseq">`;
  r.stops.forEach((id, i) => {
    h += `<span class="stopno"><b>${circled(i + 1)}</b> ${esc(stations[id].name)}</span>`;
    const leg = r.legs[i];
    if (leg) {
      const mid = leg.nodes.slice(1, -1).map(x => stations[x].name);
      h += `<span class="stoparrow">→${mid.length ? ` <span class="muted">${esc(mid.join('·'))} 통과</span> →` : ''}</span>`;
    }
  });
  return h + '</div>';
}
// 노선이 지나는 선로: 종류별 km 막대와 선로 순서(예: 경부선 전철 45km → 경부고속선 120km)
// ───────── 시간표 ─────────
const tmin = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const hwTxt = h => !h ? '운행 안 함' : h >= 60 ? `${h / 60 === Math.floor(h / 60) ? h / 60 + '시간' : Math.floor(h / 60) + '시간 ' + (h % 60) + '분'}` : `${h}분`;
function ttSummaryHtml(r) {
  const tt = S.ttOf(r), T = r.T, n = S.routeTrains(r).length;
  if (!T || !n) return `<div class="wsub">🕐 시간표</div><div class="muted" style="font-size:12px">열차를 배차하면 시간표가 생깁니다 <button data-ttedit="${r.no}" style="padding:2px 8px;font-size:12px">시간표 편집</button></div>`;
  const bands = S.TT_BANDS.map(b => `${b.name} ${hwTxt(tt.hw[b.id])}`).join(' · ');
  const short = !tt.auto && n < T.need;
  return `<div class="wsub">🕐 시간표 ${tt.auto ? '<span class="tag gray">자동</span>' : '<span class="tag">직접</span>'}</div>
    <div style="font-size:12px;line-height:1.6">첫차 <b>${tmin(tt.first)}</b> · 막차 <b>${tmin(tt.last)}</b> · 하루 ${T.deps[0].length + T.deps[1].length}편 (편도 ${minTxt(T.oneWay)})<br>
      <span class="muted">${bands}</span><br>
      필요 열차 <b>${T.need}대</b> · 지금 ${n}대 ${short ? `<span class="tag warn">${T.need - n}대 부족 → 결행</span>` : ''}${r.cancelToday ? ` · <span class="neg">오늘 결행 ${r.cancelToday}편</span>` : ''}</div>
    <div class="btns" style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 6px"><button data-ttedit="${r.no}">✏️ 시간표 편집</button><button data-ttview="${r.no}">📋 시간표 보기</button>
      ${short ? `<button class="primary" data-setn="${r.no}:${T.need}">＋ 필요한 만큼 열차 넣기</button>` : ''}</div>`;
}
// 시간표 편집 창: 자동/직접, 첫차·막차, 시간대별 간격. 고치는 대로 필요 열차 수 계산
function openTTEdit(r) {
  const tt = JSON.parse(JSON.stringify(S.ttOf(r)));
  const times = (a, b, step) => { const o = []; for (let m = a; m <= b; m += step) o.push(m); return o; };
  const sel = (id, opts, v, fmtf) => `<select id="${id}" style="font:inherit;padding:4px;border:1px solid #d1d5db;border-radius:6px">${opts.map(x => `<option value="${x}" ${x === v ? 'selected' : ''}>${fmtf(x)}</option>`).join('')}</select>`;
  const draw = () => {
    const deps0 = S.depsOf(tt), ow = r.T ? r.T.oneWay : S.oneWayMin(r), h0 = deps0.length > 1 ? deps0[1] - deps0[0] : 60;
    const shift = (ow + CFG.tt.turnMin) % h0, deps1 = deps0.map(x => Math.round(x + shift));
    const need = deps0.length ? S.planTrains([deps0, deps1], ow).need : 0, n = S.routeTrains(r).length;
    showModal(`<h3 style="margin:0 0 6px">🕐 ${esc(S.routeTitle(r))} 시간표</h3>
      <label style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><input type="checkbox" id="ttAuto" ${tt.auto ? 'checked' : ''}> 열차 수에 맞춰 자동 (지금 ${n}대 → ${hwTxt(S.autoHw(r, Math.max(1, n)))} 간격)</label>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;opacity:${tt.auto ? .45 : 1}">
        <span>첫차</span>${sel('ttFirst', times(300, 540, 10), tt.first, tmin)}
        <span>막차</span>${sel('ttLast', times(1080, 1430, 10), tt.last, tmin)}
        ${S.TT_BANDS.map(b => `<span>${b.name} <span class="muted" style="font-size:11px">${tmin(b.from)}~${tmin(b.to)}</span></span>${sel('tt_' + b.id, [0, ...S.NICE_HW], tt.hw[b.id], hwTxt)}`).join('')}
      </div>
      <div class="slot" style="margin-top:10px">하루 <b>${deps0.length * 2}</b>편 · 편도 ${minTxt(ow)} · 필요 열차 <b>${need}대</b> (지금 ${n}대)
        ${need > n ? `<br><span class="neg">${need - n}대 부족: 열차를 더 넣지 않으면 결행이 생깁니다</span>` : need < n ? `<br><span class="muted">${n - need}대는 쉬게 됩니다(빈 편이 생기면 대신 나감)</span>` : ''}</div>
      <div style="display:flex;gap:8px;margin-top:10px"><button id="askNo" style="flex:1">취소</button><button class="primary" id="ttSave" style="flex:1">저장</button></div>`);
    $('ttAuto').onchange = e => { tt.auto = e.target.checked; draw(); };
    ['ttFirst', 'ttLast'].forEach(id => $(id).onchange = e => { tt[id === 'ttFirst' ? 'first' : 'last'] = +e.target.value; tt.auto = false; draw(); });
    S.TT_BANDS.forEach(b => $('tt_' + b.id).onchange = e => { tt.hw[b.id] = +e.target.value; tt.auto = false; draw(); });
    $('askNo').onclick = hideModal;
    $('ttSave').onclick = () => { r.tt = tt; S.rebuildNetwork(); S.respaceRoute(r); hideModal(); toast('시간표를 바꿨습니다', '#15803d'); refreshAll(); };
  };
  draw();
}
// 시간표 보기: 방향마다 출발·도착 시각, 결행·지난 편 표시
function openTTView(r) {
  const T = r.T; if (!T) return toast('열차를 배차하면 시간표가 생깁니다');
  const L = r.stops.length - 1, A = stations[r.stops[0]].name, B = stations[r.stops[L]].name;
  const col = d => T.deps[d].map((t0, idx) => {
    const st = T.past[d].has(idx) || (t0 + T.off[d][d === 0 ? L : 0] < G.t) ? 'past' : T.cancel[d].has(idx) ? 'cancel' : T.taken[d].has(idx) ? 'run' : 'wait';
    const arr = t0 + T.off[d][d === 0 ? L : 0] - CFG.dwellBase;
    const Ld = T.load[d][idx], booked = Ld ? Math.max(...Ld) : 0, cap = S.tierOf(S.routeTrains(r)[0] || { kind: r.kind, lvl: 0 }).cap;
    return `<tr style="opacity:${st === 'past' ? .45 : 1}"><td>${tmin(t0)}</td><td>→ ${tmin(arr)}</td><td style="text-align:right">${st === 'cancel' ? '<span class="neg">결행</span>' : booked >= cap ? '<span class="neg">매진</span>' : booked ? `예매 ${booked}/${cap}` : ''}</td></tr>`;
  }).join('');
  showModal(`<h3 style="margin:0 0 6px">📋 ${esc(S.routeTitle(r))} 시간표</h3>
    <div style="max-height:60vh;overflow-y:auto;display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div><b>${esc(A)} → ${esc(B)}</b><table style="font-size:13px;width:100%;white-space:nowrap">${col(0)}</table></div>
      <div><b>${esc(B)} → ${esc(A)}</b><table style="font-size:13px;width:100%;white-space:nowrap">${col(1)}</table></div>
    </div><button class="primary" id="askNo" style="width:100%;margin-top:10px">닫기</button>`);
  $('askNo').onclick = hideModal;
}
// 역 출발 안내판: 이 역에서 다음에 떠나는 열차들
function boardHtml(s) {
  const rows = [];
  for (const r of S.servedBy.get(s.id) || []) {
    const T = r.T; if (!T) continue; const i = r.idxOf.get(s.id), L = r.stops.length - 1;
    for (let d = 0; d < 2; d++) {
      if ((d === 0 && i === L) || (d === 1 && i === 0)) continue;
      const to = stations[r.stops[d === 0 ? L : 0]].name;
      for (let idx = 0; idx < T.deps[d].length; idx++) {
        const t = T.deps[d][idx] + T.off[d][i]; if (t < G.t - 1) continue;
        rows.push({ t, r, to, cancel: T.cancel[d].has(idx) && !T.past[d].has(idx) }); break;
      }
      // 같은 방향 다음 한 편 더
      let c = 0; for (let idx = 0; idx < T.deps[d].length && c < 2; idx++) { const t = T.deps[d][idx] + T.off[d][i]; if (t < G.t - 1) continue; if (c === 1) rows.push({ t, r, to, cancel: T.cancel[d].has(idx) && !T.past[d].has(idx) }); c++; }
    }
  }
  rows.sort((a, b) => a.t - b.t);
  if (!rows.length) return '';
  return `<div class="wbox"><div class="wsub">🚉 출발 안내</div>${rows.slice(0, 8).map(x => `<div class="wrow" style="grid-template-columns:auto minmax(0,1fr) auto"><b style="font-variant-numeric:tabular-nums">${tmin(x.t)}</b>
    <span class="wlab"><span class="sw" style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${x.r.color}"></span> ${kindIcon(x.r.kind)} ${esc(x.to)}행</span>
    <span class="wnum">${x.cancel ? '<span class="neg">결행</span>' : ''}</span></div>`).join('')}</div>`;
}
// 노선 진단 상자: 열차가 더 필요한지
const DIAG_BG = { more: '#fef2f2', less: '#fefce8', low: '#fefce8', ok: '#f0fdf4', none: '#f8fafc', wait: '#f8fafc' };
function diagHtml(r) {
  const x = S.routeDiag(r);
  const nums = x.occ != null ? `<div class="muted" style="font-size:12px;margin-top:3px">${x.from} 기준 · 승차율 ${Math.round(x.occ * 100)}% · 평균 대기 ${Math.round(x.wait)}분 · 기다리다 떠남 ${Math.round(x.gaveRate * 100)}% · 만석 ${Math.round(x.fullRate * 100)}%</div>` : '';
  let rec = '', btn = '';
  if (x.rec != null) {
    const d = x.rec - x.n, K = CFG.kinds[r.kind];
    const free = G.depot.filter(t => t.kind === r.kind && !S.canDispatch(t, r)).length, buyN = Math.max(0, d - free);
    rec = `<div style="margin-top:4px">🚆 추천 열차 수 <b>약 ${x.rec}대</b> <span class="muted">(${x.peakBand ? `가장 붐비는 ${x.peakBand} 시간대 기준 · ` : '하루 기준 · '}지금 ${x.n}대${x.capped ? ` · 선로 용량 한계 ${x.nMax}대` : ''})</span></div>`;
    if (d > 0) btn = `<button class="primary" data-setn="${r.no}:${x.rec}" style="margin-top:6px" ${buyN && G.money < buyN * K.price ? 'disabled' : ''}>＋ 추천대로 ${d}대 더 넣기${buyN ? ` (${buyN}대 구입 ${won(buyN * K.price)})` : ''}</button>`;
    else if (d < 0) btn = `<button data-setn="${r.no}:${x.rec}" style="margin-top:6px">－ 추천대로 ${-d}대 빼기 (차량기지로)</button>`;
  }
  return `<div style="background:${DIAG_BG[x.level]};border:1px solid var(--line);border-radius:8px;padding:7px 9px;margin:6px 0">
    <b>${x.icon} ${x.label}</b> <span style="font-size:12px">${esc(x.advice)}</span>${rec}${nums}${btn}</div>`;
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
  let h = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><span class="sw" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${r.color}"></span>
    <b style="font-size:15px">${K.icon} ${esc(S.routeTitle(r))}</b> <span class="tag gray">${K.name}</span>
    <button data-edit="${r.no}" style="margin-left:auto;padding:3px 9px;font-size:12px">✏️ 정차역 수정</button></div>
    <div class="muted">${fmt(S.routeKm(r))}km · 정차 ${r.stops.length}역 · 편도 ${minTxt(oneWay)} · ${ts.length ? `배차 ${minTxt(hw)}마다` : '열차 없음'}</div>
    ${diagHtml(r)}
    ${routeTracksHtml(r)}
    ${routeStopsHtml(r)}
    <div>오늘 승객 <b>${fmt(r.paxToday || 0)}</b>명 · 수입 ${won(r.revToday || 0)} · 운행비 ${won(r.costToday || 0)} · <span class="${profit >= 0 ? 'pos' : 'neg'}">${won(profit)}</span></div>
    <div>기다리는 승객 ${fmt(waiting)}명${r.leftToday ? ` · <span class="neg">만석으로 못 탄 승객 ${fmt(r.leftToday)}명</span>` : ''}</div>`;
  if (!S.routeOpen(r)) h += `<div class="neg">열리지 않은 지역을 지나 운행할 수 없습니다</div>`;
  h += ttSummaryHtml(r);
  h += `<div class="wsub">열차 ${ts.length}대</div>${upAllHtml(r)}`;
  for (const t of ts) h += `<div class="bus">${trainLabel(t)} · ${t.pax.length}/${S.tierOf(t).cap}명<div class="btns">${upBtn(t)}<button data-recall="${t.id}">회수</button></div></div>`;
  const cand = G.depot.filter(t => t.kind === r.kind);
  h += `<div class="btns" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
    ${cand.length ? `<button class="primary" data-add="${r.no}">＋ 차량기지에서 배차 (${cand.length}대)</button>` : `<button data-buyadd="${r.no}">＋ ${K.name} 사서 배차 (${won(K.price)})</button>`}
    <button data-del="${r.no}">🗑 노선 삭제</button></div>`;
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
        <div class="btns" style="display:flex;gap:4px;margin-top:6px"><button data-unlock="${sc.region}" ${!reach || G.money < c || lvLocked(regionLv(sc.region)) ? 'disabled' : ''}>${lvLocked(regionLv(sc.region)) ? lockTag(regionLv(sc.region)) + ' ' : '🗺️ '}${esc(S.regionName[sc.region])} 열기 ${won(c)}</button></div>`;
    } else if (l.kind === 'hs' && lvLocked(CFG.gate.hs)) h += `<div class="btns" style="display:flex;gap:4px;margin-top:6px"><button disabled>${lockTag(CFG.gate.hs)} 고속선 구간 ${won(price)}</button></div><div class="muted" style="font-size:12px">고속선은 회사 레벨 ${CFG.gate.hs}부터 살 수 있습니다</div>`;
    else h += `<div class="btns" style="display:flex;gap:4px;margin-top:6px"><button class="primary" data-buysec="${sc.id}" ${G.money < price ? 'disabled' : ''}>🏷 이 구간 사기 ${won(price)}</button></div>`;
    h += '</div>';
  }
  const btn = (what, label) => { const c = S.upgradeCost(l, what), need = CFG.gate.work[what]; return c == null ? '' : lvLocked(need) ? `<button disabled>${lockTag(need)} ${label}</button>` : `<button data-lup="${l.id}:${what}" ${G.money < c ? 'disabled' : ''}>${label} ${won(c)}</button>`; };
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
      <button class="primary" data-unlock="${id}" ${!reach || G.money < c || lvLocked(regionLv(id)) ? 'disabled' : ''}>${lvLocked(regionLv(id)) ? lockTag(regionLv(id)) : '🗺️'} 지역 열기 ${won(c)}</button>
      ${lvLocked(regionLv(id)) ? `<span class="muted">회사 레벨 ${regionLv(id)}부터</span>` : ''}
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

const foldedKinds = new Set(); // 노선 목록에서 접은 열차 종류
const foldedDepot = new Set();  // 차량기지에서 접은 열차 종류
// 열차 종류 전체(대기 + 운행 중) 등급 올리기 버튼. 운행 중 열차가 전철화 때문에 못 올라가면 건너뜀
function kindTargets(k, L) { return [...G.depot, ...G.trains].filter(t => t.kind === k && t.lvl < L); }
function kindUpCost(k, L) {
  const lv = CFG.kinds[k].levels; let n = 0, c = 0, skip = 0;
  for (const t of kindTargets(k, L)) {
    if (G.trains.includes(t) && S.needsElec(k, L) && S.routeHasNonElec(t.route)) { skip++; continue; }
    n++; for (let x = t.lvl + 1; x <= L; x++) c += lv[x].upgrade;
  }
  return { n, c, skip };
}
function kindUpHtml(k) {
  const K = CFG.kinds[k], all = [...G.depot, ...G.trains].filter(t => t.kind === k);
  if (!all.length) return '';
  const minLv = Math.min(...all.map(t => t.lvl)), out = [];
  for (let L = minLv + 1; L < K.levels.length; L++) {
    const need = S.needTrain(k, L), name = K.levels[L].name;
    if (lvLocked(need)) { out.push(`<button disabled>${lockTag(need)} 모두 ${name}</button>`); break; }
    const { n, c, skip } = kindUpCost(k, L); if (!n && !skip) continue;
    out.push(`<button data-kindup="${k}:${L}" ${!n || G.money < c ? 'disabled' : ''}>⬆ 모두 ${name} <span class="muted">${n}대 · ${won(c)}${skip ? ` · 비전철 노선 ${skip}대 제외` : ''}</span></button>`);
  }
  return out.length ? `<div class="btns" style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0">${out.join('')}</div>` : '';
}
function renderRoutes() {
  $('newRouteBtns').innerHTML = Object.entries(CFG.kinds).map(([k, K]) => { const need = S.needTrain(k, 0);
    return `<button data-newroute="${k}" ${lvLocked(need) ? 'disabled' : ''}>${lvLocked(need) ? lockTag(need) : K.icon} 새 ${K.name}<br><span class="muted">${k === 'local' ? '일반선(모든 선로)' : k === 'general' ? '일반선(누리로부터 전철화)' : k === 'metro' ? '전철화 선로' : S.level() < CFG.gate.hs ? `전철화 선로(고속선 Lv${CFG.gate.hs})` : '고속선·전철화 선로'}</span></button>`; }).join('');
  // 열차 종류별로 묶음(일반 · 광역 · 고속). 머리줄을 누르면 접기/펴기
  const card = r => {
    const ts = S.routeTrains(r), p = (r.revToday || 0) - (r.costToday || 0);
    return `<div class="route" data-route="${r.no}"><span class="sw" style="background:${r.color}"></span>
      <span class="nm"><b>${esc(S.routeTitle(r))}</b> <span style="font-size:12px">${(d => `${d.icon} ${d.label}`)(S.routeDiag(r))}</span><br>
      <span class="meta">${fmt(S.routeKm(r))}km ${trackTags(r)} · ${r.stops.length}역 · 열차 ${ts.length}대 · 오늘 ${fmt(r.paxToday || 0)}명 · <span class="${p >= 0 ? 'pos' : 'neg'}">${won(p)}</span></span></span></div>`;
  };
  $('routes').innerHTML = Object.entries(CFG.kinds).map(([k, K]) => {
    const rs = G.routes.filter(r => r.kind === k);
    if (!rs.length) return '';
    const pax = rs.reduce((a, r) => a + (r.paxToday || 0), 0), p = rs.reduce((a, r) => a + (r.revToday || 0) - (r.costToday || 0), 0);
    const nt = rs.reduce((a, r) => a + S.routeTrains(r).length, 0), shut = foldedKinds.has(k);
    return `<div class="kindhead" data-fold="${k}"><span>${shut ? '▸' : '▾'} ${K.icon} <b>${K.name}</b> <span class="muted">노선 ${rs.length} · 열차 ${nt}대</span></span>
      <span class="muted" style="font-size:12px">오늘 ${fmt(pax)}명 · <span class="${p >= 0 ? 'pos' : 'neg'}">${won(p)}</span></span></div>
      ${shut ? '' : rs.map(card).join('')}`;
  }).join('') || '<p class="muted">노선이 없습니다.</p>';
}
let depotRouteNo = null;
// 열차 등급표: 종류별 등급마다 레벨·값·속도·정원·비용. 이전 등급보다 오른 값은 초록 ▲
function openTierTable() {
  const up = (v, p, lowerBetter) => p == null || v === p ? '' : (lowerBetter ? v < p : v > p) ? ' <span class="pos" style="font-size:11px">▲</span>' : ' <span class="neg" style="font-size:11px">▼</span>';
  const body = Object.entries(CFG.kinds).map(([k, K]) => `
    <div style="margin:10px 0 4px"><b>${K.icon} ${K.name}</b> <span class="muted" style="font-size:12px">새로 사면 ${won(K.price)} · ${K.tracks.includes('hs') ? '고속선·전철화 일반선' : K.elec ? '전철화 선로만' : '일반선'}</span></div>
    <div style="overflow-x:auto"><table class="tiers" style="width:100%;font-size:12px;border-collapse:collapse;white-space:nowrap">
      <tr class="muted"><th>등급</th><th>레벨</th><th>올리는 값</th><th>최고속도</th><th>정원</th><th>정차 손실</th><th>운행비/km</th><th>하루 고정비</th><th>100km 운임</th><th>승차감</th></tr>
      ${K.levels.map((L, i) => { const P = K.levels[i - 1] || null, need = S.needTrain(k, i), lock = lvLocked(need);
        return `<tr style="${lock ? 'opacity:.55' : ''}"><td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${L.color}"></span> <b>${L.name}</b>${L.elec && !K.elec ? ' ⚡' : ''}</td>
          <td>${lock ? '🔒' : ''}Lv${need}</td><td>${i ? won(L.upgrade) : '-'}</td>
          <td>${L.vmax}km/h${up(L.vmax, P?.vmax)}</td><td>${L.cap}명${up(L.cap, P?.cap)}</td><td>${L.stopLoss}분${up(L.stopLoss, P?.stopLoss, true)}</td>
          <td>${fmt(L.perKm)}원</td><td>${won(L.perDay)}</td><td>${fmt(S.fareFor(L, 100))}원</td><td>${L.comfort}</td></tr>`; }).join('')}
    </table></div>`).join('');
  showModal(`<h3 style="margin:0 0 4px">📊 열차 등급표</h3>
    <div class="muted" style="font-size:12px">등급을 올릴수록 최고속도·정원이 오릅니다. 최고속도는 선로 속도를 넘지 못합니다(일반선 고속화 최대 ${CFG.speedMax}, 고속선 최대 ${CFG.speedMaxHs}km/h). 정차 손실 = 역에 한 번 설 때 잃는 시간. ⚡ = 전철화 선로만</div>
    <div style="max-height:62vh;overflow-y:auto">${body}</div>
    <button class="primary" id="askNo" style="width:100%;margin-top:10px">닫기</button>`);
  $('askNo').onclick = hideModal;
}
function renderDepot() {
  const sel = $('depotRoute');
  sel.innerHTML = '<option value="">(노선 선택)</option>' + Object.entries(CFG.kinds).map(([k, K]) => {
    const rs = G.routes.filter(r => r.kind === k);
    return rs.length ? `<optgroup label="${K.icon} ${K.name}">${rs.map(r => `<option value="${r.no}" ${r.no === depotRouteNo ? 'selected' : ''}>${esc(S.routeTitle(r))}</option>`).join('')}</optgroup>` : '';
  }).join('');
  $('buyTrain').innerHTML = `<button data-tiers="1" style="grid-column:1/-1">📊 열차 등급표 (속도·정원·비용)</button>` + Object.entries(CFG.kinds).map(([k, K]) => { const need = S.needTrain(k, 0); return `<button data-buy="${k}" ${G.money < K.price || lvLocked(need) ? 'disabled' : ''}>${lvLocked(need) ? lockTag(need) : K.icon} ${K.levels[0].name}<br><b>${won(K.price)}</b><br><span class="muted">${K.levels[0].cap}명 · ${K.levels[0].vmax}km/h</span></button>`; }).join('');
  const r = G.routes.find(x => x.no === depotRouteNo);
  const waitCard = t => {
    const L = CFG.kinds[t.kind].levels, nx = L[t.lvl + 1], tier = S.tierOf(t);
    const err = r ? S.canDispatch(t, r) : '노선을 먼저 고르세요';
    return `<div class="bus"><b>${trainLabel(t)}</b> <span class="muted">Lv${t.lvl + 1} · ${tier.cap}명 · ${tier.vmax}km/h${tier.elec || CFG.kinds[t.kind].elec ? ' · 전철화 선로만' : ''}</span>
      <div class="btns">
        <button class="primary" data-dispatch="${t.id}" ${err ? `disabled title="${esc(err)}"` : ''}>배차</button>
        ${nx ? upBtn(t) : ''}
        <button data-sell="${t.id}">매각 ${won(S.sellValue(t))}</button>
      </div></div>`;
  };
  const runCard = t => { const tier = S.tierOf(t);
    return `<div class="bus">${trainLabel(t)} <span class="muted">· ${esc(S.routeTitle(t.route))} · Lv${t.lvl + 1} · ${tier.cap}명 · ${tier.vmax}km/h</span>
      <div class="btns">${upBtn(t)}<button data-recall="${t.id}">회수</button></div></div>`; };
  // 열차 종류별로 묶음: 머리줄(대수) + 종류 전체 등급 올리기 + 대기 열차 + 운행 중 열차
  const html = Object.entries(CFG.kinds).map(([k, K]) => {
    const wait = G.depot.filter(t => t.kind === k).sort((a, b) => a.no - b.no);
    const run = G.trains.filter(t => t.kind === k).sort((a, b) => a.route.no - b.route.no || a.no - b.no);
    if (!wait.length && !run.length) return '';
    const shut = foldedDepot.has(k);
    return `<div class="kindhead" data-dfold="${k}"><span>${shut ? '▸' : '▾'} ${K.icon} <b>${K.name}</b> <span class="muted">대기 ${wait.length} · 운행 ${run.length}</span></span></div>
      ${shut ? '' : `${kindUpHtml(k)}
      ${wait.length ? `<div class="wsub">차량기지 대기 (${wait.length}대)</div>${wait.map(waitCard).join('')}` : ''}
      ${run.length ? `<div class="wsub">운행 중 (${run.length}대)</div>${run.map(runCard).join('')}` : ''}`}`;
  }).join('');
  $('depot').innerHTML = html || '<p class="muted">열차가 없습니다. 위에서 사세요.</p>';
}
// 노선 열차 한꺼번에 등급 올리기: 목표 등급마다 버튼(몇 대 · 합계 비용). 레벨·전철화로 막히면 이유
function upAllCost(r, L) {
  const lv = CFG.kinds[r.kind].levels;
  let n = 0, c = 0;
  for (const t of S.routeTrains(r)) if (t.lvl < L) { n++; for (let k = t.lvl + 1; k <= L; k++) c += lv[k].upgrade; }
  return { n, c };
}
function upAllHtml(r) {
  const ts = S.routeTrains(r); if (!ts.length) return '';
  const K = CFG.kinds[r.kind], minLv = Math.min(...ts.map(t => t.lvl)), out = [];
  for (let L = minLv + 1; L < K.levels.length; L++) {
    const { n, c } = upAllCost(r, L); if (!n) continue;
    const need = S.needTrain(r.kind, L), name = K.levels[L].name;
    if (lvLocked(need)) { out.push(`<button disabled>${lockTag(need)} 모두 ${name}</button>`); break; }
    if (S.needsElec(r.kind, L) && S.routeHasNonElec(r)) { out.push(`<button disabled title="노선에 비전철 구간이 있습니다">모두 ${name} (전철화 필요)</button>`); break; }
    out.push(`<button data-upall="${r.no}:${L}" ${G.money < c ? 'disabled' : ''}>⬆ 모두 ${name} <span class="muted">${n}대 · ${won(c)}</span></button>`);
  }
  return out.length ? `<div class="btns" style="display:flex;flex-wrap:wrap;gap:4px;margin:2px 0 6px">${out.join('')}</div>` : '';
}
// 등급 올리기 버튼(차량기지·운행 중·열차 카드 공용)
function upBtn(t) {
  const nx = CFG.kinds[t.kind].levels[t.lvl + 1];
  if (!nx) return '<span class="muted" style="font-size:12px;align-self:center">최고 등급</span>';
  const need = S.needTrain(t.kind, t.lvl + 1);
  if (lvLocked(need)) return `<button disabled>${lockTag(need)} ${nx.name}</button>`;
  const why = S.upgradeBlock(t);
  return `<button data-up="${t.id}" ${why || G.money < nx.upgrade ? 'disabled' : ''} title="${esc(why || '')}">⬆ ${nx.name} (${won(nx.upgrade)})</button>${why ? `<span class="muted" style="font-size:11px;flex-basis:100%">${esc(why)}</span>` : ''}`;
}
function renderRegions() {
  $('regions').innerHTML = S.D.regions.map(rg => {
    const ss = stations.filter(s => s.region === rg.id), on = ss.reduce((a, s) => a + s.on, 0);
    const open = G.unlocked.has(rg.id), c = CFG.unlockCost[rg.id], reach = S.regionReachable(rg.id);
    return `<div class="gu ${open ? 'open' : ''}" data-region="${rg.id}"><span><b>${esc(rg.name)}</b><br><span class="muted">역 ${ss.length}개 · 하루 승차 ${fmt(on)}명</span></span>
      ${open ? '<span class="tag ok">개방</span>' : lvLocked(regionLv(rg.id)) ? `<button disabled>${lockTag(regionLv(rg.id))} · ${won(c)}</button>` : `<button data-unlock="${rg.id}" ${!reach || G.money < c ? 'disabled' : ''} title="${reach ? '' : '열린 지역과 선로로 이어져야 합니다'}">${won(c)}</button>`}</div>`;
  }).join('');
}
function renderTracks() {
  const ls = lines.filter(l => S.openKm(l) > 0);
  ls.sort((a, b) => S.ownedKm(b) - S.ownedKm(a));
  $('tracks').innerHTML = ls.map(l => {
    let maxLoad = 0; for (const e of l.edges) maxLoad = Math.max(maxLoad, (S.edgeLoad.get(e.id) || 0) / S.edgeCap(e));
    const own = S.ownedKm(l) > 0;
    const btn = (what, label) => { const c = S.upgradeCost(l, what), need = CFG.gate.work[what]; return !own || c == null ? '' : lvLocked(need) ? `<button disabled>${lockTag(need)} ${label}</button>` : `<button data-lup="${l.id}:${what}" ${G.money < c ? 'disabled' : ''}>${label} ${won(c)}</button>`; };
    const secs = l.sections.filter(sc => G.unlocked.has(sc.region)).map(sc => S.secOwned(sc)
      ? `<span class="tag ok">${esc(S.regionName[sc.region])} ${fmt(sc.km)}km</span>`
      : l.kind === 'hs' && lvLocked(CFG.gate.hs) ? `<button disabled>${lockTag(CFG.gate.hs)} ${esc(S.regionName[sc.region])} ${fmt(sc.km)}km</button>`
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
    <div class="legend">· 한도 = (${won(L.base)} + 자산 × ${L.assetRatio * 100}%) × 등급 배율 × 회사 레벨 배율(지금 Lv${S.level()} ×${CFG.loanLevelMul[S.level() - 1]})<br>
      ${Object.entries(L.grades).map(([k, v]) => `· <b>${k}</b>: 하루 ${(v.rate * 100).toFixed(2)}% · 한도 ×${v.limitMul} — ${esc(v.desc)}`).join('<br>')}</div>`;
}
function renderHelp() {
  $('helpText').innerHTML = `
    · 드래그: 지도 이동 / 휠: 확대·축소 / Space: 일시정지<br>
    · 🏢 회사 레벨: 누적 운임 수입으로 오릅니다. 레벨마다 열차 등급·지역·공사·고속선이 풀립니다(위쪽 Lv 배지를 누르면 표). KTX는 Lv${S.needTrain('ktx', 0)}, 고속선은 Lv${CFG.gate.hs}부터<br>
    · 확장 순서: 🗺️ 지역 열기 → 🔧 선로 구간 사기 → 역 사기 → 노선 만들기<br>
    &nbsp;&nbsp;노선을 그리다 안 산 역·구간을 누르면 바로 살 수 있습니다<br>
    · 점선 테두리 역 = 아직 안 산 역 / 흐린 선로 = 아직 안 산 구간. 선로를 누르면 그 구간을 사거나 개량할 수 있습니다<br>
    · 새 노선: 종류 선택 → 정차할 역 클릭 → Enter(완료). 기본은 완료할 때 선로를 따라 가장 짧은 순서로 정리하고, 그리는 중 '🔀 짧은 순서' 버튼을 누르면 '👆 누른 순서' 그대로 씁니다<br>
    &nbsp;&nbsp;사이에 있는 역은 통과합니다(급행). Backspace: 마지막 역 취소 / Esc: 취소<br>
    · ✏️ 정차역 수정: 정차역 클릭 → 빼기, 다른 역 클릭 → 넣기, Enter 적용<br>
    · 📊 열차 등급표: 차량기지 맨 위 버튼(<button data-tiers="1" style="padding:1px 6px;font-size:12px">열기</button>)<br>
    · 🚂 완행열차: 비둘기호 → 통일호 → 무궁화호 (싸고 느림, 모든 선로)<br>
    · 🚆 일반열차: 새마을호 → 누리로 → ITX-새마을 → ITX-마음 (누리로부터 전철화 선로만)<br>
    · 🚈 광역열차: 대경선 같은 지역 통근열차. 전철화 선로만. 광역열차만 태우는 <b>통근 승객</b>(4~70km, 출퇴근 7~9시·17~19시에 몰림)이 따로 있고, 배차가 잦을수록(10~20분) 크게 늘어납니다. 대도시 주변(대구·대전·수도권)에서 유리<br>
    · 🚄 고속열차: KTX → KTX-산천 → KTX-이음 → KTX-청룡. 고속선과 전철화된 일반선<br>
    · 선로 색: 파랑 = 고속선(KTX만), 초록 = 전철 일반선, 갈색 점선 = 비전철 일반선(완행열차·새마을호만). 노선을 누르면 지나는 선로 종류가 색 띠와 km로 나옵니다<br>
    · 선로마다 시간당 다닐 수 있는 열차 수가 정해져 있습니다(단선 ${CFG.capSingle} · 복선 ${CFG.capDouble} · 고속선 ${CFG.capHs}). 넘치면 빨갛게 표시되고 느려집니다<br>
    · 역 모양 = 실제 하루 승차 인원(2025, 코레일): 점 간이역(200명 미만) · 동그라미 소형(200~) · 두 줄 동그라미 중형(1,000~) · 네모 대형(4,000~) · 두 줄 네모 초대형(12,000~). 게임 승객 1명 = 실제 ${Math.round(1 / CFG.demandScale)}명<br>
    · 역을 누르면 그 역 사람들이 가고 싶은 곳이 나옵니다. 아직 안 열린 지역으로 가려는 사람이 많으면 지역을 여세요<br>
    · 🕐 시간표: 노선마다 첫차·막차와 시간대(새벽·출근·낮·퇴근·밤) 배차 간격. 기본은 열차 수에 맞춘 자동. 승객은 원하는 시각에 가까운 편을 예매하고 출발 10분 전에 옵니다. 편이 꽉 차면 매진이라 다음 편, 열차가 모자라면 결행<br>
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
// 지도 범례 두 번째 줄: 역 규모 모양
(function stationLegend() {
  const svg = t => {
    const r = t.r * 0.8, c = 11, sq = t.shape.startsWith('square');
    const one = k => sq ? `<rect x="${c - r * k}" y="${c - r * k}" width="${2 * r * k}" height="${2 * r * k}" rx="${r * k * 0.3}"/>` : `<circle cx="${c}" cy="${c}" r="${r * k}"/>`;
    return `<svg width="22" height="22" viewBox="0 0 22 22" fill="#fff" stroke="#1f2937" stroke-width="1.3">${one(1)}${t.shape.endsWith('2') ? one(0.5) : ''}</svg>`;
  };
  const row = document.createElement('div'); row.className = 'lgrow';
  row.innerHTML = STATION_TIERS.map(t => `<span title="하루 승차 ${t.min.toLocaleString()}명 이상">${svg(t)}${t.name.replace('역', '')}</span>`).join('');
  $('legend').appendChild(row);
})();
// 회사 레벨: 위쪽 배지(진행 막대), 누르면 레벨 표
function levelHtml() {
  const lv = S.level();
  return `<h2 style="margin:0 0 4px">🏢 회사 레벨 ${lv}</h2>
    <p class="muted" style="margin:0 0 10px">누적 운임 수입 ${won(G.totalRev)}${lv < CFG.levels.length ? ` · 다음 레벨까지 ${won(S.levelNeed(lv + 1) - G.totalRev)}` : ' · 최고 레벨'}</p>
    <div style="max-height:60vh;overflow-y:auto">${CFG.levels.map((x, i) => `<div class="slot" style="opacity:${i + 1 <= lv ? 1 : .75}">
      <b>${i + 1 <= lv ? '✅' : '🔒'} Lv${i + 1}</b> <span class="muted">누적 ${won(x.need)}</span><br><span style="font-size:13px">${esc(x.desc)}</span></div>`).join('')}</div>
    <button class="primary" id="askNo" style="width:100%;margin-top:8px">닫기</button>`;
}
function showLevels() { showModal(levelHtml()); $('askNo').onclick = hideModal; }
function checkLevelUp() {
  const lv = S.level();
  if (lv <= (G.shownLevel || 1) || $('modal').style.display === 'flex' || homeOpen()) return;
  const gained = CFG.levels.slice(G.shownLevel, lv);
  G.shownLevel = lv; save();
  showModal(`<div style="text-align:center"><div style="font-size:48px">🎉</div><h2 style="margin:4px 0">회사 레벨 ${lv} 달성!</h2>
    <p class="muted" style="margin:0 0 10px">누적 운임 수입 ${won(G.totalRev)}</p></div>
    ${gained.map((x, i) => `<div class="slot"><b>새로 풀림 (Lv${G.shownLevel - gained.length + i + 1})</b><br>${esc(x.desc)}</div>`).join('')}
    <button class="primary" id="askNo" style="width:100%;margin-top:8px">좋아요</button>`);
  $('askNo').onclick = () => { hideModal(); refreshAll(); };
}
function renderTop() {
  { const lv = S.level(), a = S.levelNeed(lv), b = S.levelNeed(lv + 1);
    $('lvTxt').textContent = `Lv${lv}`;
    $('lvBar').style.width = (b == null ? 100 : Math.min(100, (G.totalRev - a) / (b - a) * 100)) + '%'; }
  { const d = S.dateOf(); $('day').textContent = narrow.matches ? `${String(d.y).slice(2)}.${d.m}.${d.d}(${d.w})` : dateTxt(); }
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
// 역 순서: 기본은 '짧은 순서'(완료할 때 선로를 따라 가장 짧게 이어지게 다시 늘어놓음), 원하면 '누른 순서' 그대로
let autoOrder = (() => { try { return localStorage.getItem('korea-rail-order') !== 'click'; } catch (e) { return true; } })();
function drawHint() {
  const K = CFG.kinds[drawing.kind];
  setHint(`${kindIcon(drawing.kind)} <b>새 ${K.name} 노선</b>: 정차할 역을 누르세요(다시 누르면 빼기) ${autoOrder ? '(완료하면 짧은 순서로 정리)' : '(누른 순서대로)'}
    <div class="hintbtns"><button data-draw="order" title="역 순서 정하는 방법 바꾸기">${autoOrder ? '🔀 짧은 순서' : '👆 누른 순서'}</button><button data-draw="undo" title="Backspace">↩ 되돌리기</button><button data-draw="cancel" title="Esc">취소</button><button class="primary" data-draw="done" title="Enter">완료</button></div>`);
}
function startDrawing(kind) {
  cancelEdit();
  drawing = { kind, stops: [], legs: [] };
  cv.classList.add('drawing'); hidePanelForMap(); selected = null; renderInfo();
  drawHint();
}
// 고른 역들을 이미 산 선로로 가장 짧게 잇는 순서(열린 경로). 못 잇는 순서는 버림
function shortestOrder(ids, kind) {
  const n = ids.length; if (n < 3) return ids;
  const D = ids.map(() => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const P = S.findPath(ids[i], ids[j], kind); D[i][j] = D[j][i] = P ? P.km : Infinity; }
  const len = ord => { let t = 0; for (let k = 1; k < ord.length; k++) t += D[ord[k - 1]][ord[k]]; return t; };
  let best = null, bl = Infinity;
  if (n <= 7) { // 모든 순서 따져 보기
    const perm = (a, used) => {
      if (a.length === n) { const l = len(a); if (l < bl) { bl = l; best = a.slice(); } return; }
      for (let i = 0; i < n; i++) if (!used[i]) { used[i] = true; a.push(i); if (len(a) < bl) perm(a, used); a.pop(); used[i] = false; }
    };
    perm([], []);
  } else { // 많으면: 가장 먼 두 역을 양 끝으로 놓고 가까운 순서로 채운 뒤 2-opt로 다듬기
    let s0 = 0, s1 = 1; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (D[i][j] < Infinity && D[i][j] > D[s0][s1]) { s0 = i; s1 = j; }
    const rest = [...Array(n).keys()].filter(i => i !== s0 && i !== s1).sort((a, b) => D[s0][a] - D[s0][b]);
    let ord = [s0, ...rest, s1];
    for (let improved = true, guard = 0; improved && guard < 50; guard++) {
      improved = false;
      for (let i = 1; i < n - 1; i++) for (let j = i + 1; j < n; j++) {
        const cand = [...ord.slice(0, i), ...ord.slice(i, j + 1).reverse(), ...ord.slice(j + 1)];
        if (len(cand) < len(ord) - 0.01) { ord = cand; improved = true; }
      }
    }
    best = ord; bl = len(ord);
  }
  return bl < Infinity ? best.map(i => ids[i]) : ids;
}
// 안 산 역이면 살지 묻고 삼. 샀으면 true
async function ensureStation(s) {
  if (S.stOwned(s)) return true;
  if (!S.isOpen(s)) { toast('아직 열지 않은 지역의 역입니다'); return false; }
  const c = S.stationPrice(s);
  if (!await ask(`${s.name}역은 아직 사지 않았습니다.\n${won(c)}에 사서 정차역으로 넣을까요?`, `${won(c)}에 사기`)) return false;
  return check(S.buyStation(s), `${s.name}역을 샀습니다`);
}
// a → b 를 잇는 데 필요한 것: 열어야 할 지역(지나는 순서대로), 사야 할 선로 구간, 도착역
function planLink(a, b, kind) {
  const B = stations[b];
  const P = S.findPath(a, b, kind);
  // 이미 산 선로로만 가면 크게 돌아가는데, 조금 사면 훨씬 짧아지는 경우: 짧은 길을 제안하고 돌아가는 길은 따로 선택지로
  const Qbuy = S.findPath(a, b, kind, true) || S.findPath(a, b, kind, 'all');
  const detour = P && Qbuy && P.km > Qbuy.km * 1.3 + 5 ? P : null;
  if (P && !detour && S.stOwned(b)) return { path: P, cost: 0, regions: [], secs: [], buySt: false };
  let Q = (detour ? Qbuy : P) || Qbuy;
  let elec = [];
  // 전철화가 필요한 열차(광역·KTX·ITX-마음)인데 비전철 선로 때문에 막히면: 일반열차 길로 잇고 그 선로를 전철화까지 함께 제안
  if (!Q && (CFG.kinds[kind].elec || kind === 'ktx')) {
    const Qg = S.findPath(a, b, 'local', true) || S.findPath(a, b, 'local', 'all');
    if (Qg && !(kind === 'ktx' && Qg.edges.some(e => e.line.kind === 'hs' && lvLocked(CFG.gate.hs)))) {
      elec = [...new Set(Qg.edges.filter(e => !S.lineElec(e.line)).map(e => e.line))];
      if (elec.length) {
        if (lvLocked(CFG.gate.work.elec)) return { err: `${josa(elec.map(l => l.name).join(', '), '이', '가')} 전철화되지 않았습니다. 전철화 공사는 회사 레벨 ${CFG.gate.work.elec}부터 할 수 있습니다` };
        Q = Qg;
      }
    }
  }
  if (!Q) return { err: whyNoLink(a, b, kind) };
  const regions = [];
  for (const id of Q.nodes) { const rg = stations[id].region; if (!G.unlocked.has(rg) && !regions.includes(rg)) regions.push(rg); }
  for (const rg of regions) if (lvLocked(regionLv(rg))) return { err: `${S.regionName[rg]} 지역을 지나야 하는데, 이 지역은 회사 레벨 ${regionLv(rg)}부터 열 수 있습니다` };
  const secs = S.missingSections(Q);
  const buySt = !S.stOwned(B);
  // 전철화비: 이 노선에서 (이미 산 + 이번에 살) 구간 km × km당 전철화비 (실제 공사와 같은 계산)
  const elecCost = elec.map(l => {
    const km = S.ownedKm(l) + secs.filter(sc => sc.line === l).reduce((x, sc) => x + sc.km, 0);
    return { line: l, km, cost: Math.round(km * CFG.elecPerKm / 100_000) * 100_000 };
  });
  const cost = regions.reduce((x, rg) => x + CFG.unlockCost[rg], 0) + secs.reduce((x, sc) => x + S.sectionPrice(sc), 0) + (buySt ? S.stationPrice(B) : 0)
    + elecCost.reduce((x, e) => x + e.cost, 0);
  return { path: Q, regions, secs, buySt, elec: elecCost, cost, detour };
}
// 왜 못 가는지: 전철화·고속선 레벨·선로 없음
function whyNoLink(a, b, kind) {
  const K = CFG.kinds[kind];
  if (kind === 'ktx' && S.level() < CFG.gate.hs) {
    if (S.findPath(a, b, 'local', 'all')) return `KTX는 회사 레벨 ${CFG.gate.hs} 전까지 고속선을 못 쓰고, 전철화된 일반선으로는 이 두 역이 이어지지 않습니다`;
  }
  const G2 = S.findPath(a, b, 'local', 'all');
  if (G2 && (K.elec || kind === 'ktx')) {
    const bad = [...new Set(G2.edges.filter(e => !S.lineElec(e.line)).map(e => e.line.name))];
    if (bad.length) return `${josa(bad.join(', '), '이', '가')} 전철화되지 않아 ${josa(K.name, '이', '가')} 다닐 수 없습니다. 🔧 선로에서 전철화하거나 일반열차를 쓰세요`;
  }
  return `${josa(K.name, '이', '가')} 다닐 수 있는 선로로 두 역이 이어지지 않습니다`;
}
// 여러 연결 계획 합치기(겹치는 지역·구간·전철화는 한 번만). b = 새로 넣는 역
function mergePlans(parts, b) {
  const regions = [], secs = new Map(), elecLines = new Set();
  for (const x of parts) {
    for (const rg of x.regions || []) if (!regions.includes(rg)) regions.push(rg);
    for (const sc of x.secs || []) secs.set(sc.id, sc);
    for (const e of x.elec || []) elecLines.add(e.line);
  }
  const sl = [...secs.values()], B = stations[b], buySt = !S.stOwned(B);
  const elec = [...elecLines].map(l => { const km = S.ownedKm(l) + sl.filter(sc => sc.line === l).reduce((a, sc) => a + sc.km, 0); return { line: l, km, cost: Math.round(km * CFG.elecPerKm / 100_000) * 100_000 }; });
  const cost = regions.reduce((a, rg) => a + CFG.unlockCost[rg], 0) + sl.reduce((a, sc) => a + S.sectionPrice(sc), 0) + (buySt ? S.stationPrice(B) : 0) + elec.reduce((a, e) => a + e.cost, 0);
  // 돌아가는 길 정보도 합침(어느 한쪽이라도 '사면 짧아지는' 경우)
  const detour = parts.some(x => x.detour) ? { km: parts.reduce((a, x) => a + (x.detour || x.path).km, 0) } : null;
  return { regions, secs: sl, buySt, elec, cost, detour, path: { km: parts.reduce((a, x) => a + x.path.km, 0) } };
}
async function buyLink(plan, b) {
  const B = stations[b];
  if (!plan.cost) return true;
  const lines = [
    ...plan.regions.map(rg => `· 🗺️ ${S.regionName[rg]} 지역 열기  ${won(CFG.unlockCost[rg])}`),
    ...plan.secs.map(sc => `· 🛤 ${sc.line.name} ${S.regionName[sc.region]} 구간 ${fmt(sc.km)}km  ${won(S.sectionPrice(sc))}`),
    ...(plan.buySt ? [`· 🏷 ${B.name}역  ${won(S.stationPrice(B))}`] : []),
    ...(plan.elec || []).map(x => `· ⚡ ${x.line.name} 전철화 (산 구간 ${fmt(x.km)}km)  ${won(x.cost)}`),
  ];
  if (plan.detour) {
    // 사면 짧고, 안 사면 이미 산 선로로 돌아감
    const can = G.money >= plan.cost;
    const pick = await askChoice(`${B.name}까지 이미 산 선로로는 ${fmt(plan.detour.km)}km를 돌아갑니다.\n아래를 사면 ${fmt(plan.path.km)}km로 바로 갈 수 있습니다.\n${lines.join('\n')}`,
      [{ key: 'buy', label: can ? `${won(plan.cost)}에 사서 짧게 (${fmt(plan.path.km)}km)` : `돈 부족 (필요 ${won(plan.cost)})`, primary: can },
       { key: 'detour', label: `사지 않고 돌아가기 (${fmt(plan.detour.km)}km)` }]);
    if (pick === 'detour') return 'detour';
    if (pick !== 'buy' || !can) return false;
  } else {
    if (G.money < plan.cost) { toast(`돈이 부족합니다 (필요 ${won(plan.cost)}, 가진 돈 ${won(G.money)})`); return false; }
    if (!await ask(`${B.name}까지 이으려면 아래가 필요합니다.\n${lines.join('\n')}\n\n모두 ${won(plan.cost)}에 살까요?`, `${won(plan.cost)}에 사기`)) return false;
  }
  for (const rg of plan.regions) if (!check(S.unlockRegion(rg))) return false;
  if (plan.buySt && !check(S.buyStation(B))) return false;
  if (plan.secs.length && !check(S.buySections(plan.secs))) return false;
  for (const x of plan.elec || []) if (!check(S.upgradeLine(x.line, 'elec'))) return false;
  toast(`${B.name}까지 이었습니다${(plan.elec || []).length ? ' (전철화 완료)' : ''}`, '#15803d');
  return true;
}
// 첫 역: 안 산 역이면 사고, 안 연 지역이면 지역도 함께
async function ensureFirst(s) {
  if (S.stOwned(s)) return true;
  if (!S.isOpen(s)) {
    const rg = s.region, c = CFG.unlockCost[rg] + S.stationPrice(s);
    if (lvLocked(regionLv(rg))) { toast(`${S.regionName[rg]} 지역은 회사 레벨 ${regionLv(rg)}부터 열 수 있습니다`); return false; }
    if (!S.regionReachable(rg)) { toast(`${S.regionName[rg]} 지역은 아직 열린 지역과 이어지지 않습니다. 가까운 역부터 고르세요`); return false; }
    if (G.money < c) { toast(`돈이 부족합니다 (필요 ${won(c)})`); return false; }
    if (!await ask(`${s.name}역은 아직 안 연 ${S.regionName[rg]} 지역입니다.\n· 🗺️ 지역 열기 ${won(CFG.unlockCost[rg])}\n· 🏷 ${s.name}역 ${won(S.stationPrice(s))}\n\n모두 ${won(c)}에 살까요?`, `${won(c)}에 사기`)) return false;
    if (!check(S.unlockRegion(rg))) return false;
  }
  return ensureStation(s);
}
let busy = false; // 확인창을 기다리는 중에는 다른 클릭 무시
async function drawClick(s) {
  const st = drawing.stops, kind = drawing.kind;
  const k = st.indexOf(s.id);
  if (k >= 0) { // 넣은 역을 다시 누르면 빼기(앞뒤 역을 다시 이음)
    st.splice(k, 1);
    if (k === 0) drawing.legs.splice(0, 1);
    else if (k === st.length) drawing.legs.splice(k - 1, 1);
    else { const P = S.findPath(st[k - 1], st[k], kind); if (P) drawing.legs.splice(k - 1, 2, P); else { st.splice(k, 0, s.id); return toast('이 역을 빼면 앞뒤 역을 이을 수 없습니다'); } }
    toast(`${s.name}역을 뺐습니다`, '#475569'); return;
  }
  if (!st.length) { if (await ensureFirst(s) && drawing) st.push(s.id); return; }
  const a = st[st.length - 1], plan = planLink(a, s.id, kind);
  if (plan.err) return toast(plan.err);
  if (!await buyLink(plan, s.id) || !drawing) return;
  const P = S.findPath(a, s.id, kind);
  if (!P) return toast('이을 수 없습니다');
  drawing.legs.push(P); st.push(s.id);
}
function finishDrawing() {
  if (!drawing) return;
  if (drawing.stops.length < 2) { toast('역을 2개 이상 고르세요'); return; }
  let stops = drawing.stops, reordered = false;
  if (autoOrder) {
    const o = shortestOrder(stops, drawing.kind);
    if (o.join() !== stops.join() && o.slice().reverse().join() !== stops.join()) {
      // 누른 첫 역이 되도록 방향만 맞춤(가능하면)
      stops = o[o.length - 1] === stops[0] ? o.reverse() : o; reordered = true;
    }
  }
  const r = S.addRoute(drawing.kind, stops);
  drawing = null; cv.classList.remove('drawing'); setHint('');
  if (!r) return toast('노선을 만들 수 없습니다');
  selected = { type: 'route', r }; depotRouteNo = r.no;
  toast(`${S.routeTitle(r)} 노선을 만들었습니다${reordered ? ' (짧은 순서로 정리)' : ''}. 열차를 배차하세요`, '#15803d');
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
    // 끼워 넣을 자리마다 (앞 역 → 이 역, 이 역 → 뒤 역)을 잇는 데 필요한 것을 계산해
    // 노선이 가장 덜 늘어나는 자리(늘어나는 km)를 고름. 거리가 거의 같을 때만 싼 쪽
    // (돈 우선으로 고르면 이미 산 선로로 크게 돌아가는 자리를 고르는 문제가 있었음)
    let best = null, lastErr = null;
    for (let i = 0; i <= st.length; i++) {
      const prev = st[i - 1], next = st[i], parts = [];
      if (prev != null) parts.push(planLink(prev, s.id, editing.kind));
      if (next != null) parts.push(planLink(s.id, next, editing.kind));
      const bad = parts.find(x => x.err); if (bad) { lastErr = bad.err; continue; }
      const plan = mergePlans(parts, s.id);
      const direct = prev != null && next != null ? (editing.legs[i - 1]?.km || 0) : 0; // 원래 앞역→뒤역 거리
      const km = parts.reduce((a, x) => a + (x.path ? x.path.km : 0), 0) - direct;      // 늘어나는 거리
      if (!best || km < best.km - 2 || (Math.abs(km - best.km) <= 2 && plan.cost < best.plan.cost)) best = { plan, km, i };
    }
    if (!best) return toast(lastErr || '이 역은 노선과 이어지지 않습니다');
    if (!await buyLink(best.plan, s.id) || !editing) return;
    const cand = [...st.slice(0, best.i), s.id, ...st.slice(best.i)];
    if (!S.buildLegs(editing.kind, cand)) return toast('이을 수 없습니다');
    st.splice(0, st.length, ...cand);
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
  // 새 손짓의 첫 손가락(또는 마우스)이면 남아 있던 기록을 비움: 손가락 떼기를 놓쳐 한 손가락 끌기가 두 손가락 확대로 잡히던 문제
  if (e.isPrimary || e.pointerType !== 'touch') { pointers.clear(); pinch = null; }
  pointers.set(e.pointerId, { x, y, touch: e.pointerType === 'touch' });
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 이미 떨어진 손가락 */ }
  if (pointers.size === 2 && [...pointers.values()].every(p => p.touch)) {
    const [p1, p2] = [...pointers.values()];
    pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), z: cam.z, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2, wx: wx((p1.x + p2.x) / 2), wy: wy((p1.y + p2.y) / 2) };
    drag = null;
  } else if (pointers.size === 1) { drag = { x, y, cx: cam.x, cy: cam.y, moved: false }; cv.style.cursor = 'grabbing'; }
});
cv.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  const [x, y] = localXY(e);
  pointers.set(e.pointerId, { ...pointers.get(e.pointerId), x, y });
  if (pinch && pointers.size === 2) {
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
cv.addEventListener('lostpointercapture', e => { if (pointers.has(e.pointerId)) { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; } });
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
        const pl = planLink(drawing.stops[drawing.stops.length - 1], s.id, drawing.kind);
        txt += pl.err ? ' · <span class="neg">연결 안 됨</span>' : `${pl.path ? ` · +${fmt(pl.path.km)}km` : ''}${pl.cost ? ` · <span class="neg">${pl.regions.length ? '지역·' : ''}구입 필요 ${won(pl.cost)}</span>` : ''}`;
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
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (homeOpen() && $('modal').style.display !== 'flex') return;
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
    else if (d.draw === 'order' && drawing) { autoOrder = !autoOrder; try { localStorage.setItem('korea-rail-order', autoOrder ? 'short' : 'click'); } catch (err) { /* 저장 불가 */ } drawHint(); }
    else if (d.draw === 'undo' && drawing) { drawing.stops.pop(); drawing.legs.splice(Math.max(0, drawing.stops.length - 1)); }
  }
  else if (d.panel) openPanel(openPanelName === d.panel ? null : d.panel);
  else if (d.newroute) startDrawing(d.newroute);
  else if (d.route && !e.target.closest('button')) { const r = findR(d.route); selected = { type: 'route', r }; depotRouteNo = r.no; if (narrow.matches) openPanel(null); focusRoute(r); renderInfo(); }
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
  else if (d.kindup) {
    const [k, L] = [d.kindup.split(':')[0], +d.kindup.split(':')[1]];
    let n = 0, skip = 0, err = null;
    for (const t of kindTargets(k, L)) {
      if (G.trains.includes(t) && S.needsElec(k, L) && S.routeHasNonElec(t.route)) { skip++; continue; }
      while (t.lvl < L) { const res = S.upgradeTrain(t); if (res.err) { err = res.err; break; } }
      if (err) break; n++;
    }
    if (err) toast(err); else toast(`${CFG.kinds[k].name} ${n}대를 ${CFG.kinds[k].levels[L].name}(으)로 올렸습니다${skip ? ` (비전철 노선 ${skip}대 제외)` : ''}`, '#15803d');
    refreshAll();
  }
  else if (d.tiers) openTierTable();
  else if (d.ttedit) openTTEdit(findR(d.ttedit));
  else if (d.ttview) openTTView(findR(d.ttview));
  else if (d.respace) { const r = findR(d.respace); check(S.respaceRoute(r), `${S.routeTitle(r)}: 열차 ${S.routeTrains(r).length}대를 같은 간격으로 놓았습니다`); }
  else if (d.upall) {
    const [no, L] = d.upall.split(':').map(Number), r = findR(no);
    let n = 0, err = null;
    for (const t of S.routeTrains(r)) while (t.lvl < L) { const res = S.upgradeTrain(t); if (res.err) { err = res.err; break; } n++; }
    if (err) toast(err); else toast(`${S.routeTitle(r)}: ${CFG.kinds[r.kind].levels[L].name}(으)로 올렸습니다`, '#15803d');
    refreshAll();
  }
  else if (d.setn) {
    const [no, want] = d.setn.split(':').map(Number), r = findR(no);
    let ts = S.routeTrains(r), added = 0, bought = 0;
    while (ts.length > want) { S.recall(ts[ts.length - 1]); ts = S.routeTrains(r); }
    while (ts.length < want) {
      let t = G.depot.find(x => x.kind === r.kind && !S.canDispatch(x, r));
      if (!t) { const res = S.buyTrain(r.kind); if (res.err) { toast(res.err); break; } t = res.t; bought++; }
      if (S.dispatch(t, r).err) break;
      added++; ts = S.routeTrains(r);
    }
    toast(`${S.routeTitle(r)}: 열차 ${ts.length}대${bought ? ` (${bought}대 새로 삼)` : ''}`, '#15803d'); refreshAll();
  }
  else if (d.buyst) { const st = stations[+d.buyst]; check(S.buyStation(st), `${st.name}역을 샀습니다`); }
  else if (d.buysec) { const sc = S.secById.get(d.buysec); check(S.buySection(sc), `${sc.line.name} ${S.regionName[sc.region]} 구간을 샀습니다`); }
  else if (d.borrow) { const r = S.borrow(d.borrow === 'max' ? Infinity : +d.borrow); check(r, r.amount ? `${won(r.amount)}을 빌렸습니다` : ''); }
  else if (d.repay) { const r = S.repay(d.repay === 'max' ? Infinity : +d.repay); check(r, r.amount ? `${won(r.amount)}을 갚았습니다` : ''); }
  else if (d.newgame) { showHome(); renderSlots('new'); }
  else if (d.lup) { const [id, what] = d.lup.split(':'); check(S.upgradeLine(lines.find(l => l.id === id), what), '공사를 마쳤습니다'); }
});
$('depot').addEventListener('click', e => {
  const h = e.target.closest('[data-dfold]'); if (!h) return;
  const k = h.dataset.dfold; foldedDepot.has(k) ? foldedDepot.delete(k) : foldedDepot.add(k); renderDepot();
});
$('routes').addEventListener('click', e => {
  const h = e.target.closest('[data-fold]'); if (!h) return;
  const k = h.dataset.fold; foldedKinds.has(k) ? foldedKinds.delete(k) : foldedKinds.add(k); renderRoutes();
});
$('depotRoute').addEventListener('change', e => { depotRouteNo = +e.target.value || null; renderDepot(); });
$('panelClose').onclick = () => openPanel(null);
$('infoClose').onclick = () => { selected = null; renderInfo(); };
function focusRoute(r) { fitStations(r.stops.map(id => stations[id])); }

// 속도
const SPEEDS = [0, 1, 3, 10, 30, 100];
function setSpeedUI() {
  SPEEDS.forEach((v, i) => $('sp' + i).classList.toggle('on', G.paused ? i === 0 : v === G.speed));
  const c = $('spCycle'); c.textContent = `${G.speed}x ▸`; c.classList.toggle('on', !G.paused);
}
// 폰: 속도 버튼 하나를 누를 때마다 1→3→10→30→100→1 (멈춰 있었으면 지금 속도로 다시 출발)
$('spCycle').onclick = () => {
  if (G.paused) { G.paused = false; setSpeedUI(); return; }
  const k = SPEEDS.indexOf(G.speed); G.speed = SPEEDS[k + 1 < SPEEDS.length ? k + 1 : 1]; setSpeedUI();
};
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
      ${M.commute ? `<tr><td>통근 승객 (광역열차)</td><td>${fmt(M.commute)}명</td></tr>` : ''}
      <tr><td>기다리다 떠난 승객</td><td>${fmt(M.gaveUp)}명</td></tr>
      <tr><td>만석으로 못 탄 승객</td><td class="${M.leftBehind ? 'neg' : ''}">${fmt(M.leftBehind)}명</td></tr>
      <tr><td>정시율 (5분 이내 도착)</td><td>${M.runsDone ? Math.round(M.onTime / M.runsDone * 100) + '%' : '-'} <span class="muted">(${fmt(M.runsDone || 0)}편)</span></td></tr>
      <tr><td>결행</td><td class="${M.cancel ? 'neg' : ''}">${fmt(M.cancel || 0)}편</td></tr>
      <tr><td>매진으로 다음 편 예매</td><td>${fmt(M.soldOut || 0)}번</td></tr>
      <tr><td>시간표가 안 맞아 안 탄 승객</td><td>${fmt(M.noRun || 0)}명</td></tr>
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

// ───────────────────────── 저장: 칸 3개 + 백업 ─────────────────────────
const SLOTS = 3, META_KEY = 'korea-rail-meta';
const slotKey = n => `korea-rail-slot-${n}`;
let curSlot = null; // 지금 하고 있는 저장 칸(홈에서 고르기 전엔 없음)
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del: k => { try { localStorage.removeItem(k); } catch (e) { /* 없음 */ } },
};
const meta = () => { try { return JSON.parse(store.get(META_KEY)) || {}; } catch (e) { return {}; } };
const slotInfo = n => { try { return JSON.parse(store.get(slotKey(n) + '-info')); } catch (e) { return null; } };
function save() {
  if (curSlot == null) return;
  const d = S.dateOf();
  store.set(slotKey(curSlot), S.serialize());
  store.set(slotKey(curSlot) + '-info', JSON.stringify({ date: `${d.y}년 ${d.m}월 ${d.d}일`, money: G.money, debt: G.debt,
    routes: G.routes.length, trains: G.trains.length + G.depot.length, regions: G.unlocked.size, over: G.over, savedAt: Date.now() }));
  store.set(META_KEY, JSON.stringify({ ...meta(), last: curSlot }));
}
// 예전 저장(한 칸) → 1번 칸으로 옮김
(function migrate() {
  const old = store.get(S.SAVE_KEY);
  if (!old || store.get(slotKey(1))) return;
  try { S.deserialize(old); curSlot = 1; save(); curSlot = null; store.del(S.SAVE_KEY); } catch (e) { /* 깨진 저장 */ }
  S.resetGame();
})();
function afterSwitch() { // 새 게임·불러오기 뒤 화면 정리
  selected = null; drawing = null; editing = null; cv.classList.remove('drawing'); setHint('');
  openPanel(null); hideModal();
  S.rebuildNetwork(); assignSlots();
  fitStations(stations.filter(s => G.unlocked.has(s.region)).length > 15 ? stations.filter(s => S.stOwned(s)) : stations.filter(s => s.region === CFG.startRegion));
  refreshAll(); setSpeedUI();
}
function startNew(n) {
  S.resetGame(); S.setupNewGame(); curSlot = n; save();
  hideHome(); afterSwitch();
  G.paused = true; setSpeedUI(); showIntro();
}
function loadSlot(n) {
  const data = store.get(slotKey(n));
  if (!data) return toast('빈 칸입니다');
  try { S.resetGame(); S.deserialize(data); } catch (e) { S.resetGame(); return toast('저장을 읽지 못했습니다'); }
  curSlot = n; store.set(META_KEY, JSON.stringify({ ...meta(), last: n }));
  hideHome(); afterSwitch();
  if (G.over) { G.paused = true; showModal(`<h2 style="margin:0 0 8px">파산</h2><p>이 저장은 파산으로 끝났습니다.</p><button class="primary" data-gohome="1" style="width:100%">홈으로</button>`); }
  else { G.paused = false; setSpeedUI(); toast(`${n}번 칸을 불러왔습니다`, '#15803d'); }
}
function showIntro() {
  showModal(`<h2 style="margin:0 0 8px">🚄 새 게임</h2>
    <p style="line-height:1.7"><b>동대구역</b> 하나와 차량기지의 <b>비둘기호 1대</b>로 시작합니다. 경부선 대구권 구간도 가지고 있습니다.</p>
    <p style="line-height:1.7">첫 노선을 만들어 보세요. 🛤️ 노선 → 🚂 새 완행열차 → 동대구와 다른 역을 차례로 누르면, 아직 안 산 역은 그 자리에서 살 수 있습니다. 그다음 노선 카드에서 비둘기호를 배차합니다.</p>
    <p style="line-height:1.7">역을 눌러 사람들이 어디로 가고 싶은지 보세요. 대구 사람들은 대부분 서울·부산으로 갑니다.</p>
    <p style="line-height:1.7">넓히는 순서: 🗺️ <b>지역 열기</b> → 🔧 <b>선로 구간 사기</b> → <b>역 사기</b> → 노선 만들기. 승객은 한 번까지 갈아탑니다.</p>
    <p class="muted">수요: 한국철도공사 역별 승하차(2025)를 하루 평균으로 나눈 값. 2026년 1월 1일부터 시작해 달이 끝날 때마다 결산하고, 진행은 하루 단위로 ${curSlot}번 칸에 저장됩니다.</p>
    <button class="primary" id="startBtn" style="width:100%">시작</button>`);
  $('startBtn').onclick = () => { hideModal(); G.paused = false; setSpeedUI(); save(); };
}

// 홈 화면
const homeOpen = () => !$('home').hidden;
function slotLine(n) {
  const i = slotInfo(n);
  if (!i) return '<span class="muted">빈 칸</span>';
  const when = new Date(i.savedAt);
  return `<b>${esc(i.date)}</b>${i.over ? ' <span class="tag warn">파산</span>' : ''}<br>
    <span class="muted">💰 ${won(i.money)}${i.debt ? ` · 빚 ${won(i.debt)}` : ''} · 노선 ${i.routes} · 열차 ${i.trains} · 지역 ${i.regions}<br>
    저장 ${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}</span>`;
}
function renderHome() {
  const last = meta().last, li = last && slotInfo(last);
  const cont = curSlot != null ? { n: curSlot, label: '계속하기' } : li ? { n: last, label: '이어하기' } : null;
  $('homeMain').innerHTML = `
    ${cont ? `<button class="primary homebtn" data-home="continue">▶ ${cont.label}<small>${cont.n}번 칸 · ${esc((slotInfo(cont.n) || {}).date || '')}</small></button>` : ''}
    <button class="${cont ? '' : 'primary '}homebtn" data-home="new">＋ 새 게임<small>동대구역 · 비둘기호 1대 · 4,500만원</small></button>
    <button class="homebtn" data-home="load">📂 불러오기<small>저장 칸 ${SLOTS}개 · 백업 복사·붙여넣기</small></button>`;
  $('homeMain').hidden = false; $('homeSlots').hidden = true;
}
function renderSlots(mode) { // mode: 'new' | 'load'
  let h = `<h3 style="text-align:left">${mode === 'new' ? '새 게임을 저장할 칸' : '불러올 칸'}</h3>`;
  for (let n = 1; n <= SLOTS; n++) {
    const has = !!slotInfo(n);
    h += `<div class="slot"><div><b>${n}번 칸</b>${n === curSlot ? ' <span class="tag ok">지금 게임</span>' : ''}</div><div>${slotLine(n)}</div><div class="btns">
      ${mode === 'new' ? `<button class="primary" data-slotnew="${n}">${has ? '덮어쓰고 ' : ''}새 게임</button>`
        : has ? `<button class="primary" data-slotload="${n}">불러오기</button><button data-slotcopy="${n}">백업 복사</button><button data-slotdel="${n}">지우기</button>` : ''}
      ${mode === 'load' ? `<button data-slotpaste="${n}">백업 붙여넣기</button>` : ''}
    </div></div>`;
  }
  h += `<button class="homebtn" data-home="back" style="text-align:center">← 뒤로</button>`;
  $('homeSlots').innerHTML = h; $('homeSlots').hidden = false; $('homeMain').hidden = true;
}
function showHome() {
  if (drawing) cancelDrawing(); if (editing) cancelEdit();
  save(); G.paused = true; setSpeedUI();
  hideModal(); renderHome(); $('home').hidden = false;
}
function hideHome() { $('home').hidden = true; }
$('homeBtn').onclick = () => showHome();
$('lvBtn').onclick = () => showLevels();
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.home === 'continue') {
    if (curSlot != null) { hideHome(); G.paused = false; setSpeedUI(); }
    else loadSlot(meta().last);
  } else if (d.home === 'new') renderSlots('new');
  else if (d.home === 'load') renderSlots('load');
  else if (d.home === 'back') renderHome();
  else if (d.gohome) showHome();
  else if (d.slotnew) {
    const n = +d.slotnew;
    if (slotInfo(n)) ask(`${n}번 칸의 저장을 지우고 새 게임을 시작할까요?\n(${slotInfo(n).date})`, '덮어쓰고 시작').then(ok => { if (ok) startNew(n); else renderSlots('new'); });
    else startNew(n);
  } else if (d.slotload) loadSlot(+d.slotload);
  else if (d.slotdel) {
    const n = +d.slotdel;
    ask(`${n}번 칸의 저장을 지울까요? 되돌릴 수 없습니다.`, '지우기').then(ok => {
      if (ok) { store.del(slotKey(n)); store.del(slotKey(n) + '-info'); if (curSlot === n) curSlot = null; }
      renderSlots('load');
    });
  } else if (d.slotcopy) {
    const n = +d.slotcopy, text = 'KRAIL1:' + store.get(slotKey(n));
    showModal(`<h3 style="margin:0 0 8px">${n}번 칸 백업</h3>
      <p class="muted" style="margin:0 0 8px">아래 글자를 통째로 복사해 메모장 등에 보관하세요. 나중에 '백업 붙여넣기'로 되살릴 수 있습니다.</p>
      <textarea id="bkText" readonly></textarea>
      <div style="display:flex;gap:8px;margin-top:10px"><button id="askNo" style="flex:1">닫기</button><button class="primary" id="bkCopy" style="flex:1">복사</button></div>`);
    $('bkText').value = text;
    $('askNo').onclick = () => { hideModal(); };
    $('bkCopy').onclick = () => {
      const ta = $('bkText'); ta.focus(); ta.select();
      (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => toast('복사했습니다', '#15803d'))
        .catch(() => { try { document.execCommand('copy'); toast('복사했습니다', '#15803d'); } catch (e2) { toast('자동 복사가 안 됩니다. 글자를 길게 눌러 직접 복사하세요'); } });
    };
  } else if (d.slotpaste) {
    const n = +d.slotpaste;
    showModal(`<h3 style="margin:0 0 8px">${n}번 칸에 백업 붙여넣기</h3>
      <p class="muted" style="margin:0 0 8px">보관해 둔 백업 글자(KRAIL1:로 시작)를 붙여넣으세요.${slotInfo(n) ? ' 이 칸의 지금 저장은 지워집니다.' : ''}</p>
      <textarea id="bkIn" placeholder="KRAIL1:..."></textarea>
      <div style="display:flex;gap:8px;margin-top:10px"><button id="askNo" style="flex:1">취소</button><button class="primary" id="bkOk" style="flex:1">넣기</button></div>`);
    $('askNo').onclick = () => hideModal();
    $('bkOk').onclick = () => {
      const v = $('bkIn').value.trim().replace(/^KRAIL1:/, '');
      try { JSON.parse(v); } catch (e2) { return toast('백업 글자가 올바르지 않습니다'); }
      const keep = curSlot; // 검사용으로 읽어 보고 원래 게임으로 되돌림
      try { S.resetGame(); S.deserialize(v); } catch (e2) { toast('읽을 수 없는 백업입니다'); }
      curSlot = n; save(); curSlot = keep;
      if (keep != null) { S.resetGame(); S.deserialize(store.get(slotKey(keep))); afterSwitch(); } else S.resetGame();
      hideModal(); renderSlots('load'); toast(`${n}번 칸에 넣었습니다`, '#15803d');
    };
  }
});

// ───────────────────────── 루프 ─────────────────────────
let last = performance.now(), uiTimer = 0;
const touchedAt = new WeakMap();
for (const id of ['infoCard', 'panel']) $(id).addEventListener('pointerdown', () => touchedAt.set($(id), performance.now()), true);
const busyEl = el => el.matches(':hover') || performance.now() - (touchedAt.get(el) || -1e9) < 2000;
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
  // 카드·패널을 만지는 중(마우스를 올렸거나, 누른 지 2초 안)에는 다시 그리지 않음: 누르던 버튼이 바뀌어 눌림이 사라지지 않게
  if (uiTimer > 0.3) { uiTimer = 0; renderTop(); checkLevelUp(); if (selected && !busyEl($('infoCard'))) renderInfo(); if (openPanelName === 'routes' && !busyEl($('panel'))) renderRoutes(); }
  requestAnimationFrame(frame);
}

resize();
S.setupNewGame(); // 홈 뒤에 보이는 지도용(아직 저장 칸 없음)
S.rebuildNetwork(); assignSlots();
fitStations(stations.filter(s => s.region === CFG.startRegion));
renderTop(); renderBadges();
G.paused = true; setSpeedUI();
showHome();
requestAnimationFrame(frame);
// 안드로이드 앱용: 뒤로 가기 = 열린 창부터 닫기(닫았으면 true), 앱을 내리면 멈추고 저장
window.__back = () => {
  if ($('modal').style.display === 'flex') { const no = $('askNo'); if (no) no.click(); return true; }
  if (homeOpen()) { if (!$('homeSlots').hidden) { renderHome(); return true; } return false; }
  if (drawing) { cancelDrawing(); return true; }
  if (editing) { cancelEdit(); return true; }
  if (openPanelName) { openPanel(null); return true; }
  if (selected) { selected = null; renderInfo(); return true; }
  return false;
};
window.__pauseSave = () => { if ($('modal').style.display !== 'flex') { G.paused = true; setSpeedUI(); } save(); };
window.__UI = { G, S, cam, sx, sy, fitStations, planLink }; // 디버그·자동 점검용
