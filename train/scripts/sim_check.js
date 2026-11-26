// 밸런스 점검(화면 없이): 새 게임에서 시작해 지역을 열고 노선을 만든 뒤 며칠 돌려 봄
// 사용법: node train/scripts/sim_check.js <일수> [+지역…] [종류:역,역,…*대수 …]
//   예) node train/scripts/sim_check.js 3 동대구,구미
//       node train/scripts/sim_check.js 5 +gyeongnam +busan general:동대구,밀양,부산 ktx:동대구,울산,부산*2
//   종류 생략 = general. 필요한 역·구간은 자동으로 사고, 첫 일반열차는 차량기지의 무궁화호를 씀
//   loan=40000000 → 그 시점에 대출. MONEY=1e9 처럼 시작 자금, REV=5e8 처럼 누적 수입(회사 레벨)을 바꿀 수 있음
const fs = require('fs'), vm = require('vm'), path = require('path');
const ctx = { console, Math, JSON, Map, Set, Object, Array, Number, Infinity }; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', f), 'utf8').replace('window.GAME_DATA', 'globalThis.GAME_DATA'), ctx);
const S = ctx.SIM, G = S.G;
const [days = '3', ...plan] = process.argv.slice(2);
S.setupNewGame();
if (process.env.MONEY) G.money = +process.env.MONEY;
if (process.env.REV) G.totalRev = +process.env.REV; // 누적 수입(레벨) 미리 채우기
const m = x => (x / 1e4).toFixed(0) + '만';
console.log(`시작 자금 ${m(G.money)}`);
for (const a of plan) {
  if (a.startsWith('loan=')) { const r = S.borrow(+a.slice(5)); console.log(`대출 ${m(r.amount || 0)} ${r.err || ''} (등급 ${S.creditGrade()}, 한도 ${m(S.loanLimit())})`); continue; }
  if (a.startsWith('+')) { const r = S.unlockRegion(a.slice(1)); console.log(`지역 ${a.slice(1)}: ${r.err || '개방'}`); continue; }
  const [, kind = 'general', list, n = '1'] = a.match(/^(?:(\w+):)?([^*]+)(?:\*(\d+))?$/);
  const ids = list.split(',').map(s => { const st = S.byName.get(s); if (!st) throw new Error('역 없음: ' + s); return st.id; });
  for (const id of ids) { const r = S.buyStation(S.stations[id]); if (r.err && !r.err.startsWith('이미')) console.log(r.err); }
  for (let k = 0; k + 1 < ids.length; k++) { const P = S.findPath(ids[k], ids[k + 1], kind, true); if (P) { const r = S.buySections(S.missingSections(P)); if (r.err) console.log('구간', r.err); } }
  const r = S.addRoute(kind, ids);
  if (!r) { console.log('노선을 못 만듦:', a); continue; }
  for (let k = 0; k < +n; k++) {
    const t = G.depot.find(x => x.kind === kind) || S.buyTrain(kind).t;
    if (!t) { console.log('열차 살 돈 부족'); break; }
    const d = S.dispatch(t, r); if (d.err) console.log(d.err);
  }
}
console.log(`투자 후 자금 ${m(G.money)} · 노선 ${G.routes.length} · 열차 ${G.trains.length}`);
for (let d = 0; d < +days; d++) {
  while (G.t < S.CFG.dayEndMin) S.tick(0.25);
  const R = S.closeDay();
  console.log(`${R.day}일차: 승객 ${R.pax} (환승 ${R.transfers}, 떠남 ${R.gaveUp}, 만석 ${R.leftBehind}) 만족 ${R.sat == null ? '-' : R.sat.toFixed(0)}% 수입 ${m(R.revenue)} 비용 ${m(R.cost)} 이익 ${m(R.profit + R.pso - R.interest)} (이자 ${m(R.interest)}) 자금 ${m(R.money)} 빚 ${m(G.debt)} 등급 ${S.creditGrade()}${R.negDays ? ' 마이너스 ' + R.negDays + '일' : ''}${R.sold.length ? ' 강제매각 ' + R.sold.length : ''}${R.over ? ' 파산' : ''}`);
  for (const r of G.routes) console.log(`   ${S.routeTitle(r)}: 승객 ${r.paxToday || 0} 수입 ${m(r.revToday || 0)} 운행비 ${m(r.costToday || 0)} 열차 ${S.routeTrains(r).length}`);
  S.startNextDay();
}
const snap = S.serialize(); S.deserialize(snap);
console.log('저장·불러오기', S.serialize() === snap ? '같음' : '다름!');
