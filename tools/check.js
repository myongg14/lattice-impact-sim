// node tools/check.js — 기본값에서 세 구조의 결과를 출력하는 검사 스크립트
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = { console, Math, JSON, Float64Array, Object, Array };
vm.createContext(ctx);
for (const f of ['config.js', 'physics.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx);
const NS = ctx.ImpactSim, cfg = NS.cloneConfig(NS.DEFAULT_CONFIG);
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')).map(([k, v]) => [k, +v]));
const p = { massG: args.m || 500, heightCm: args.h || 22, cellMm: args.cell || 10, sizeMm: 60, tolMm: 0.5,
  rho: { gyroid: args.rho || 0.3, octet: args.rho || 0.3, honeycomb: args.rho || 0.3 } };
const t0 = Date.now(); const R = NS.runAll(p, cfg);
console.log(`m=${p.massG}g h=${p.heightCm}cm rho=${p.rho.gyroid} cell=${p.cellMm}mm  (${Date.now() - t0}ms)`);
const r = R.gyroid;
console.log(`v0=${r.v0.toFixed(3)} m/s, E0=${r.E0.toFixed(3)} J, 시편질량=${(p.rho.gyroid * 1270 * 0.06 ** 3 * 1000).toFixed(1)} g`);
for (const k of NS.STRUCT_KEYS) {
  const r = R[k], P = r.props;
  console.log(`${k.padEnd(10)} E=${(P.E / 1e6).toFixed(1)}MPa σpk=${(P.sigPk / 1e6).toFixed(2)}MPa σpl=${(P.sigPl / 1e6).toFixed(2)} εY=${P.epsY.toFixed(3)} εD=${P.epsD.toFixed(2)} | ` +
    `Fmax(샘플)=${r.peak.toFixed(0)}N Fmax(연속)=${r.peakRaw.toFixed(0)}N 지속=${(r.duration * 1e3).toFixed(3)}ms(연속 ${(r.rawDuration * 1e3).toFixed(3)}) ` +
    `I=${r.impulse.toFixed(3)}Ns Δp=${r.momentum.toFixed(3)} 흡수=${r.absorbed.toFixed(3)}J 반발=${r.reboundE.toFixed(3)}J εmax=${r.epsMax.toFixed(4)} ` +
    `${r.enteredPlateau ? '고원' : '탄성'}${r.densified ? '+치밀화' : ''}${r.bottomedOut ? ' 바닥!' : ''} steps=${r.steps} tol=${JSON.stringify(r.tol && r.tol.peak.map(x => Math.round(x)))}`);
}
