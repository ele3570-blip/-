// 밸런스 점검(화면 없이): node train/scripts/sim_check.js [일수] [base|gen|more|busan] [광역 추가] [일반 추가]
const fs = require('fs'), vm = require('vm');
const ctx = { console, Math, JSON, Map, Set, Object, Array, Number, Infinity };
ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of ['data.js', 'sim.js']) vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'web', f), 'utf8').replace('window.GAME_DATA', 'globalThis.GAME_DATA'), ctx);
const S = ctx.SIM;
S.setupNewGame();
const scen = process.argv[3] || 'base';
if (scen === 'gen') { // 일반열차 김천-청도 노선
  const r = S.addRoute('general', ['김천','구미','왜관','대구','동대구','경산','청도'].map(n => S.byName.get(n).id));
  S.dispatch(S.G.depot[0], r);
}
if (scen === 'more') {
  S.G.money += 1e9;
  const m = S.G.routes[0];
  for (let k = 0; k < +(process.argv[4]||2); k++) S.dispatch(S.buyTrain('metro').t, m);
  const r = S.addRoute('general', ['김천','구미','왜관','대구','동대구','경산','청도'].map(n => S.byName.get(n).id));
  S.dispatch(S.G.depot[0], r);
  for (let k = 0; k < +(process.argv[5]||1); k++) S.dispatch(S.buyTrain('general').t, r);
  S.G.money = 0;
}
if (scen === 'busan') {
  S.G.money += 1e9;
  for (const r of ['busan','gyeongnam','gyeongbuk_e']) S.unlockRegion(r);
  const m = S.G.routes[0];
  for (let k = 0; k < 2; k++) S.dispatch(S.buyTrain('metro').t, m);
  const id = n => S.byName.get(n).id;
  const r = S.addRoute('general', ['동대구','경산','청도','밀양','삼랑진','물금','구포','부산'].map(id));
  S.dispatch(S.G.depot[0], r); S.dispatch(S.buyTrain('general').t, r);
  const k = S.addRoute('ktx', ['동대구','경주','울산','부산'].map(id));
  S.dispatch(S.buyTrain('ktx').t, k); S.dispatch(S.buyTrain('ktx').t, k);
  S.G.money = 0;
}
const days = +process.argv[2] || 3;
for (let d = 0; d < days; d++) {
  while (S.G.t < S.CFG.dayEndMin) S.tick(0.25);
  const res = S.closeDay();
  console.log(`day ${res.day}: pax ${res.pax} spawned ${res.spawned} gaveUp ${res.gaveUp} left ${res.leftBehind} pot ${res.potential.toFixed(0)} sat ${res.sat?.toFixed(0)} rev ${Math.round(res.revenue)} cost ${Math.round(res.cost)} money ${Math.round(res.money)} rep ${res.rep.toFixed(2)}`);
  for (const r of S.G.routes) console.log('   ', S.routeTitle(r), 'pax', r.paxToday, 'rev', r.revToday, 'cost', Math.round(r.costToday), 'cycle', S.cycleMinutes(r).toFixed(0), 'trains', S.routeTrains(r).length);
  S.startNextDay();
}
const T = S.destTable;
for (const [o, t] of T) console.log(S.stations[o].name, 'served', t.served.toFixed(3));
const snap = S.serialize(); S.deserialize(snap);
console.log('reload ok', S.G.routes.length, 'routes', S.G.trains.length, 'trains', S.G.depot.length, 'depot', S.serialize() === snap ? 'identical' : 'differs');
