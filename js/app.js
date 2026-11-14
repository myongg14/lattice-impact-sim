/* =====================================================================
 * app.js — 화면 연결: 입력 → 계산 → 그래프·표·경고·애니메이션
 * ===================================================================== */
(function (root) {
  'use strict';
  const NS = root.ImpactSim;
  const KEYS = NS.STRUCT_KEYS;
  const LABEL = { gyroid: 'Gyroid', octet: 'Octet', honeycomb: 'Honeycomb' };
  const $ = (id) => document.getElementById(id);
  const CFG_STORE = 'impactSim.config.v1';

  if (typeof Chart === 'undefined') {
    document.querySelector('.main').innerHTML = '<div class="card"><h3>그래프 라이브러리를 불러오지 못했어요</h3><p>이 시뮬레이터는 Chart.js와 Three.js를 인터넷(CDN)에서 받아 와요. 인터넷에 연결한 뒤 새로고침해 주세요.</p></div>';
    return;
  }

  /* ---------------- 설정(config) ---------------- */
  let cfg = NS.cloneConfig(NS.DEFAULT_CONFIG);
  try { NS.mergeConfig(cfg, JSON.parse(localStorage.getItem(CFG_STORE) || 'null')); } catch (e) { /* 무시 */ }
  const saveCfg = () => { try { localStorage.setItem(CFG_STORE, JSON.stringify(cfg)); } catch (e) { /* 무시 */ } };

  /* ---------------- 입력 상태 ---------------- */
  const DEF = { massG: 500, heightCm: 22, rhoMode: 'common', rhoCommon: 30, rhoEach: { gyroid: 30, octet: 30, honeycomb: 30 }, cellMm: 10, sizeMm: 60, tolMm: 0.5 };
  const S = JSON.parse(JSON.stringify(DEF));
  function params() {
    const rho = {};
    for (const k of KEYS) rho[k] = (S.rhoMode === 'common' ? S.rhoCommon : S.rhoEach[k]) / 100;
    return { massG: S.massG, heightCm: S.heightCm, rho, cellMm: S.cellMm, sizeMm: S.sizeMm, tolMm: S.tolMm };
  }

  let results = null, lastSweep = null;
  let sweepVar = 'height', sweepDirty = true;
  let activeTab = 'result';

  /* 슬라이더와 숫자칸을 짝지어 묶기 */
  function bindPair(rangeId, numId, get, set) {
    const r = $(rangeId), n = $(numId);
    const apply = (v, src) => {
      const min = +n.min, max = +n.max;
      if (!isFinite(v)) return;
      v = Math.min(max, Math.max(min, v));
      set(v);
      if (src !== r) r.value = v;
      if (src !== n) n.value = v;
      schedule();
    };
    r.addEventListener('input', () => apply(+r.value, r));
    n.addEventListener('change', () => apply(+n.value, null));
    return () => { r.value = get(); n.value = get(); };
  }
  const syncers = [
    bindPair('massR', 'massN', () => S.massG, (v) => { S.massG = v; }),
    bindPair('heightR', 'heightN', () => S.heightCm, (v) => { S.heightCm = v; }),
    bindPair('rhoR', 'rhoN', () => S.rhoCommon, (v) => { S.rhoCommon = v; }),
    bindPair('cellR', 'cellN', () => S.cellMm, (v) => { S.cellMm = v; }),
    ...KEYS.map((k) => bindPair('rhoR_' + k, 'rhoN_' + k, () => S.rhoEach[k], (v) => { S.rhoEach[k] = v; })),
  ];
  $('sizeN').addEventListener('change', (e) => { S.sizeMm = clampNum(e.target, 20, 120); schedule(); });
  $('tolN').addEventListener('change', (e) => { S.tolMm = clampNum(e.target, 0, 5); schedule(); });
  function clampNum(el, a, b) { let v = parseFloat(el.value); if (!isFinite(v)) v = a; v = Math.min(b, Math.max(a, v)); el.value = v; return v; }

  function setRhoMode(m) {
    S.rhoMode = m;
    $('rhoCommon').classList.toggle('on', m === 'common');
    $('rhoEach').classList.toggle('on', m === 'each');
    $('rhoCommonBox').hidden = m !== 'common';
    $('rhoEachBox').hidden = m !== 'each';
    if (m === 'each') for (const k of KEYS) { S.rhoEach[k] = S.rhoCommon; }
    syncers.forEach((f) => f());
    schedule();
  }
  $('rhoCommon').addEventListener('click', () => setRhoMode('common'));
  $('rhoEach').addEventListener('click', () => setRhoMode('each'));

  $('btnReset').addEventListener('click', () => {
    Object.assign(S, JSON.parse(JSON.stringify(DEF)));
    $('sizeN').value = S.sizeMm; $('tolN').value = S.tolMm;
    setRhoMode('common');
  });

  /* ---------------- 계산 예약(입력 중 너무 자주 계산하지 않게) ---------------- */
  let timer = 0;
  function schedule() { clearTimeout(timer); timer = setTimeout(recompute, 60); }

  function recompute() {
    const p = params();
    results = NS.runAll(p, cfg);
    sweepDirty = true;
    renderAll(p);
  }

  function renderAll(p) {
    const r = results;
    // 입력 안내
    const v0 = Math.sqrt(2 * cfg.g * p.heightCm / 100);
    $('speedHint').textContent = `충돌 속도 v = √(2gh) = ${v0.toFixed(2)} m/s · 충돌 에너지 mgh = ${(p.massG / 1000 * cfg.g * p.heightCm / 100).toFixed(2)} J`;
    $('massHint').textContent = 'PETG 시험편 질량: ' + KEYS.map((k) => `${LABEL[k]} ${(p.rho[k] * cfg.material.density * Math.pow(p.sizeMm / 1000, 3) * 1000).toFixed(0)}g`).join(' · ');

    NS.Charts.updateForce(r, $('showRaw').checked);
    NS.Charts.updateBars(r);
    renderTable(r, p);
    renderWarnings(r, p);
    renderCaptions(r, p);
    NS.Charts.updateSS(r);
    NS.Charts.updateHyst(r);
    NS.Charts.updateForce(r, false, NS.Charts.charts.anim);
    NS.Anim.setResults(r, p);
    NS.Viewer.set({ rho: p.rho[currentViewerKey], cellMm: p.cellMm, sizeMm: p.sizeMm });
    NS.Experiment.compare(p, cfg);
    if (activeTab === 'sweep') runSweep();
  }

  /* ---------------- 요약 표 ---------------- */
  function renderTable(r, p) {
    const best = (f, low) => { const v = KEYS.map((k) => f(r[k])); const t = low ? Math.min(...v) : Math.max(...v); return KEYS.filter((k, i) => v[i] === t)[0]; };
    const bPeak = best((x) => x.peak, true), bDur = best((x) => x.duration, false), bAbs = best((x) => x.absorbed, false);
    const state = (x) => x.bottomedOut ? '바닥 닿음' : x.densified ? '치밀화' : x.enteredPlateau ? '고원(소성 붕괴)' : '탄성';
    const rng = (a, d, s) => (a ? `<span class="sub">${(a[0] * s).toFixed(d)} ~ ${(a[1] * s).toFixed(d)}</span>` : '');
    const rows = KEYS.map((k) => {
      const x = r[k], P = x.props;
      return `<tr>
        <td><span class="name-cell"><span class="dot ${k}"></span>${LABEL[k]}</span><span class="sub">${cfg.structures[k].kind}</span></td>
        <td>${(P.E / 1e6).toFixed(1)}<span class="sub">σ ${(P.sigPk / 1e6).toFixed(2)} MPa</span></td>
        <td class="${k === bPeak ? 'best' : ''}">${(x.peak / 1e3).toFixed(2)}${rng(x.tol && x.tol.peak, 2, 1e-3)}<span class="sub">연속 ${(x.peakRaw / 1e3).toFixed(2)}</span></td>
        <td class="${k === bDur ? 'best' : ''}">${(x.duration * 1e3).toFixed(2)}${rng(x.tol && x.tol.duration, 2, 1e3)}<span class="sub">연속 ${(x.rawDuration * 1e3).toFixed(2)}</span></td>
        <td>${x.impulse.toFixed(3)}<span class="sub">Δp ${x.momentum.toFixed(3)}</span></td>
        <td class="${k === bAbs ? 'best' : ''}">${x.absorbed.toFixed(3)}<span class="sub">${(x.absorbed / x.E0 * 100).toFixed(0)}% · 반발 ${x.reboundE.toFixed(2)} J</span></td>
        <td>${(x.epsMax * p.sizeMm).toFixed(2)}<span class="sub">ε ${(x.epsMax * 100).toFixed(1)}% · 잔류 ${(x.residualStrain * p.sizeMm).toFixed(2)} mm</span></td>
        <td>${state(x)}</td></tr>`;
    }).join('');
    $('summaryTable').innerHTML = `<thead><tr><th>구조</th><th>탄성계수 E (MPa)</th><th>최대 충격력 (kN)</th><th>지속시간 (ms)</th><th>충격량 (N·s)</th><th>흡수 에너지 (J)</th><th>최대 압축 (mm)</th><th>변형 단계</th></tr></thead><tbody>${rows}</tbody>`;
    $('summaryCap').textContent = `굵은 글씨: 최대 충격력이 가장 작은 구조, 지속시간·흡수 에너지가 가장 큰 구조. 위 값은 ${cfg.sim.sampleRate / 1000} kHz로 샘플링한 측정값이고, 아래 '연속'은 샘플링 전 실제 힘이에요.` +
      (p.tolMm > 0 ? ` 작은 글씨 범위는 시험편 크기 ${p.sizeMm}±${p.tolMm} mm일 때의 결과 범위예요.` : '') +
      ` 지속시간 기준: 최대값의 ${(cfg.sim.durationThreshold * 100).toFixed(0)}%.`;
  }

  /* ---------------- 경고 ---------------- */
  function renderWarnings(r, p) {
    const w = [];
    for (const k of KEYS) {
      const x = r[k];
      if (x.bottomedOut) w.push(['bad', `${LABEL[k]}: 바닥 닿음(완전 압축)! 시험편이 거의 끝까지 눌려서 힘이 급격히 커졌어요. 질량이나 높이를 줄여 보세요.`]);
      else if (x.densified) w.push(['', `${LABEL[k]}: 치밀화 구간에 들어갔어요(ε ${(x.epsMax * 100).toFixed(0)}% > ε_D ${(x.props.epsD * 100).toFixed(0)}%). 힘이 빠르게 커지는 중이에요.`]);
      const g = x.props.geometry;
      if (g.thicknessMm < cfg.model.nozzleMm) w.push(['', `${LABEL[k]}: ${g.label} ${g.thicknessMm.toFixed(2)} mm로 노즐(${cfg.model.nozzleMm} mm)보다 얇아 실제로 출력하기 어려워요.`]);
      const miss = (x.peakRaw - x.peak) / x.peakRaw;
      if (miss > 0.05) w.push(['', `${LABEL[k]}: 펄스가 짧아서 ${cfg.sim.sampleRate / 1000} kHz 샘플링이 실제 최대값을 ${(miss * 100).toFixed(0)}% 놓쳤어요.`]);
      if (x.duration * cfg.sim.sampleRate < 6) w.push(['', `${LABEL[k]}: 충격 동안 측정점이 ${Math.max(0, Math.round(x.duration * cfg.sim.sampleRate))}개뿐이라 지속시간 오차가 커요. 샘플링 속도를 높여 보세요.`]);
      if (x.durationOpen) w.push(['', `${LABEL[k]}: 계산 시간 안에 힘이 기준 아래로 떨어지지 않았어요.`]);
    }
    $('warnings').innerHTML = w.map(([c, t]) => `<div class="warn ${c}" role="${c ? 'alert' : 'status'}"><span class="ic">${c ? '⛔' : '⚠'}</span>${t}</div>`).join('');
  }

  /* ---------------- 그래프 설명 문장 ---------------- */
  function renderCaptions(r, p) {
    const sorted = KEYS.slice().sort((a, b) => r[a].peak - r[b].peak);
    const lo = sorted[0], hi = sorted[2];
    const anyPlateau = KEYS.some((k) => r[k].enteredPlateau);
    $('forceCap').textContent = `최대 충격력이 가장 작은 구조는 ${LABEL[lo]}(${(r[lo].peak / 1e3).toFixed(2)} kN), 가장 큰 구조는 ${LABEL[hi]}(${(r[hi].peak / 1e3).toFixed(2)} kN)로 약 ${(r[hi].peak / r[lo].peak).toFixed(1)}배 차이예요. ` +
      (anyPlateau ? '고원 구간에 들어간 구조는 힘이 평평하게 유지되면서 에너지를 흡수해요. ' : `이 조건(${(r[lo].E0).toFixed(2)} J)에서는 세 구조 모두 탄성 범위 안에서 눌렸다 돌아와요. 질량이나 높이를 키우거나 상대밀도를 낮추면 고원 구간이 나타나요. `) +
      '점 하나가 로드셀 측정 한 번이에요.';
    $('hystCap').textContent = '누를 때와 돌아올 때의 곡선이 만드는 고리 안 넓이가 시험편이 흡수한 에너지예요. 이번 계산: ' +
      KEYS.map((k) => `${LABEL[k]} ${r[k].absorbed.toFixed(2)} J(${(r[k].absorbed / r[k].E0 * 100).toFixed(0)}%)`).join(', ') + '.';
    $('impulseCap').textContent = '이번 계산의 충격량 / 지속시간: ' + KEYS.map((k) => `${LABEL[k]} ${r[k].impulse.toFixed(2)} N·s / ${(r[k].duration * 1e3).toFixed(2)} ms`).join(', ') +
      `. 충격량은 비슷한데 지속시간이 길수록 최대힘이 작아지는 것을 확인할 수 있어요.`;
    $('animCap').textContent = `세 구조에 같은 ${p.massG} g 충격체를 ${p.heightCm} cm에서 떨어뜨렸어요. 변형은 눈에 보이도록 확대해서 그렸고, 아래 그래프의 점선이 지금 시점이에요. 슬라이더로 원하는 시점을 볼 수 있어요.`;
  }

  /* ---------------- 변인 스윕 ---------------- */
  function setSweepVar(v) {
    sweepVar = v;
    $('swHeight').classList.toggle('on', v === 'height');
    $('swMass').classList.toggle('on', v === 'mass');
    $('swUnit').textContent = v === 'height' ? 'cm' : 'g';
    $('swFrom').value = v === 'height' ? 5 : 100;
    $('swTo').value = v === 'height' ? 100 : 2000;
    runSweep();
  }
  function runSweep() {
    const p = params();
    let a = +$('swFrom').value, b = +$('swTo').value, n = Math.round(+$('swCount').value);
    const lim = sweepVar === 'height' ? [1, 300] : [10, 10000];
    a = Math.max(lim[0], Math.min(lim[1], a || lim[0])); b = Math.max(lim[0], Math.min(lim[1], b || lim[1]));
    if (b <= a) b = a + 1;
    n = Math.max(3, Math.min(60, n || 20));
    $('swFrom').value = a; $('swTo').value = b; $('swCount').value = n;
    lastSweep = NS.sweep(p, sweepVar, a, b, n, cfg);
    NS.Charts.updateSweep(lastSweep, $('swMetric').value, NS.Experiment.sweepPoints(sweepVar, p));
    const fixed = sweepVar === 'height' ? `질량 ${p.massG} g` : `높이 ${p.heightCm} cm`;
    const bott = KEYS.filter((k) => lastSweep.series[k].some((q) => q.bottomedOut));
    $('sweepCap').textContent = `${fixed}, 상대밀도·셀 크기는 왼쪽 패널 값으로 고정했어요. 실험값 탭의 데이터 중 ${fixed}인 점은 ◆로 겹쳐 보여요.` +
      (bott.length ? ` ▲ 표시는 바닥 닿음(완전 압축)이 일어난 조건이에요: ${bott.map((k) => LABEL[k]).join(', ')}.` : '');
    sweepDirty = false;
  }
  $('swHeight').addEventListener('click', () => setSweepVar('height'));
  $('swMass').addEventListener('click', () => setSweepVar('mass'));
  $('swRun').addEventListener('click', runSweep);
  $('swMetric').addEventListener('change', () => lastSweep && NS.Charts.updateSweep(lastSweep, $('swMetric').value, NS.Experiment.sweepPoints(sweepVar, params())));

  /* ---------------- 탭 ---------------- */
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  function showTab(name) {
    activeTab = name;
    document.querySelectorAll('.tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.tab === name); b.setAttribute('aria-selected', b.dataset.tab === name); });
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + name));
    if (name === 'viewer') NS.Viewer.start(); else NS.Viewer.stop();
    if (name !== 'anim') NS.Anim.pause();
    if (name === 'anim') NS.Anim.draw();
    if (name === 'sweep' && sweepDirty) runSweep();
    Object.values(NS.Charts.charts).forEach((c) => c.resize());
    try { localStorage.setItem('impactSim.tab', name); } catch (e) { /* 무시 */ }
  }

  /* ---------------- 3D 뷰어 선택 ---------------- */
  let currentViewerKey = 'gyroid';
  document.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => {
    currentViewerKey = b.dataset.v;
    document.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
    NS.Viewer.set({ key: currentViewerKey, rho: params().rho[currentViewerKey] });
  }));
  document.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('on', x === b));
    NS.Viewer.set({ scope: b.dataset.scope });
  }));

  /* ---------------- 내보내기 ---------------- */
  document.querySelectorAll('[data-png]').forEach((b) => b.addEventListener('click', () => NS.Charts.savePNG(b.dataset.png)));
  const csvBlob = (text) => URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const condLine = () => { const p = params(); return `# 조건: 질량 ${p.massG} g, 높이 ${p.heightCm} cm, 상대밀도 ${KEYS.map((k) => LABEL[k] + ' ' + (p.rho[k] * 100).toFixed(0) + '%').join(' / ')}, 셀 ${p.cellMm} mm, 시험편 ${p.sizeMm} mm, 샘플링 ${cfg.sim.sampleRate} Hz`; };
  $('csvForce').addEventListener('click', () => {
    const r = results; const n = Math.max(...KEYS.map((k) => r[k].sampled.t.length));
    const lines = [condLine(), '시간(ms),' + KEYS.map((k) => LABEL[k] + '(N)').join(',')];
    for (let i = 0; i < n; i++) {
      const t = KEYS.map((k) => r[k].sampled.t[i]).find((v) => v != null);
      lines.push([(t * 1e3).toFixed(4), ...KEYS.map((k) => (r[k].sampled.F[i] != null ? r[k].sampled.F[i].toFixed(2) : ''))].join(','));
    }
    NS.Charts.download(csvBlob(lines.join('\n')), '힘-시간.csv');
  });
  $('csvSummary').addEventListener('click', () => {
    const r = results;
    const lines = [condLine(), '구조,탄성계수(MPa),붕괴응력(MPa),최대충격력_측정(N),최대충격력_연속(N),지속시간_측정(ms),지속시간_연속(ms),충격량(N·s),운동량변화(N·s),흡수에너지(J),반발에너지(J),최대압축(mm),변형단계'];
    for (const k of KEYS) {
      const x = r[k];
      lines.push([LABEL[k], (x.props.E / 1e6).toFixed(2), (x.props.sigPk / 1e6).toFixed(3), x.peak.toFixed(1), x.peakRaw.toFixed(1), (x.duration * 1e3).toFixed(3), (x.rawDuration * 1e3).toFixed(3),
        x.impulse.toFixed(4), x.momentum.toFixed(4), x.absorbed.toFixed(4), x.reboundE.toFixed(4), (x.epsMax * params().sizeMm).toFixed(3),
        x.bottomedOut ? '바닥 닿음' : x.densified ? '치밀화' : x.enteredPlateau ? '고원' : '탄성'].join(','));
    }
    NS.Charts.download(csvBlob(lines.join('\n')), '결과요약.csv');
  });
  $('csvSweep').addEventListener('click', () => {
    if (!lastSweep) runSweep();
    const s = lastSweep, u = s.variable === 'height' ? '높이(cm)' : '질량(g)';
    const lines = [condLine(), [u, ...KEYS.map((k) => LABEL[k] + ' 최대힘(N)'), ...KEYS.map((k) => LABEL[k] + ' 지속시간(ms)')].join(',')];
    s.xs.forEach((x, i) => lines.push([x.toFixed(2), ...KEYS.map((k) => s.series[k][i].peak.toFixed(1)), ...KEYS.map((k) => (s.series[k][i].duration * 1e3).toFixed(3))].join(',')));
    NS.Charts.download(csvBlob(lines.join('\n')), '변인스윕.csv');
  });
  $('showRaw').addEventListener('change', () => NS.Charts.updateForce(results, $('showRaw').checked));

  /* ---------------- 화면 모드 ---------------- */
  $('btnFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });
  document.addEventListener('fullscreenchange', () => { $('btnFull').textContent = document.fullscreenElement ? '전체화면 끝내기' : '전체화면'; });
  $('btnPresent').addEventListener('click', () => {
    const on = document.documentElement.classList.toggle('present');
    $('btnPresent').classList.toggle('primary', on);
    restyle();
  });
  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  }
  $('btnTheme').addEventListener('click', () => {
    document.documentElement.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('impactSim.theme', document.documentElement.dataset.theme); } catch (e) { /* 무시 */ }
    restyle();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restyle);
  function restyle() {
    $('btnTheme').textContent = isDark() ? '밝은 화면' : '어두운 화면';
    NS.Charts.applyTheme();
    NS.Viewer.applyTheme();
    if (results) renderAll(params());
  }

  /* ---------------- 모델 설정 탭 ---------------- */
  // [설정 경로, 이름, 단위, 표시배율(SI→화면), 설명]
  const MAIN_FIELDS = [
    ['sim.sampleRate', '로드셀 샘플링 속도', 'Hz', 1, '실제 측정 장비의 초당 측정 횟수'],
    ['sim.durationThreshold', '지속시간 기준', '%', 100, '힘이 최대값의 몇 %를 넘는 동안을 지속시간으로 볼지'],
    ['sim.antiAliasHz', '저역통과 필터', 'Hz', 1, '샘플링 전 필터(0이면 끔)'],
    ['sim.samplePhase', '샘플 위상', '주기', 1, '첫 측정이 충돌 순간보다 얼마나 늦게 찍히는지(0~1)'],
    ['sim.dt', '수치적분 간격 dt', 'μs', 1e6, 'RK4 한 스텝(10μs 이하)'],
  ];
  const RIG_FIELDS = [
    ['material.Es', 'PETG 영률 E_s', 'GPa', 1e-9, ''],
    ['material.sigmaY', 'PETG 항복강도 σ_s', 'MPa', 1e-6, ''],
    ['material.density', 'PETG 밀도', 'g/cm³', 1e-3, ''],
    ['rig.topPlateMass', '상판 질량', 'g', 1e3, ''],
    ['rig.bottomPlateMass', '하판 질량', 'g', 1e3, ''],
    ['rig.loadCellStiffness', '로드셀 강성', 'MN/m', 1e-6, ''],
    ['rig.contactStiffness', '충격체-상판 접촉 강성', 'MN/m', 1e-6, ''],
    ['model.specimenDampingRatio', '시험편 감쇠비 ζ', '', 1, '재료 점성에 의한 작은 에너지 손실'],
    ['model.densificationA', '치밀화 계수 A', '', 1, 'ε_D = 1 − A·ρ*'],
    ['model.unloadSecantFactor', '제하 기울기 배수', '', 1, '클수록 소성 후 잔류 변형이 커짐'],
    ['model.sizeEffectAlpha', '가장자리 셀 효과 α', '', 1, '물성 × (1 − α·셀/시편)'],
    ['model.nozzleMm', '노즐 지름(경고 기준)', 'mm', 1, ''],
  ];
  const COEF = [['C_E', 'C_E'], ['n_E', 'n_E'], ['C_pk', 'C_σ'], ['n_pk', 'n_σ'], ['plateauRatio', '고원비'], ['dropStrain', '피크→고원 ε'], ['hardening', '고원 기울기'], ['wave', '출렁임']];
  const getP = (o, path) => path.split('.').reduce((a, k) => a[k], o);
  const setP = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
  const fmtNum = (v) => +(+v).toPrecision(5);

  function renderSettings() {
    const field = ([path, name, unit, sc, hint]) => `<label class="setting"><span>${name}${hint ? `<small>${hint}</small>` : ''}</span>
      <span><input type="number" step="any" data-path="${path}" data-sc="${sc}" value="${fmtNum(getP(cfg, path) * sc)}"> ${unit}</span></label>`;
    $('settingsMain').innerHTML = MAIN_FIELDS.map(field).join('');
    $('settingsRig').innerHTML = RIG_FIELDS.map(field).join('');
    $('coefTable').innerHTML = `<thead><tr><th>구조</th>${COEF.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>` +
      KEYS.map((k) => `<tr><td><span class="name-cell"><span class="dot ${k}"></span>${LABEL[k]}</span></td>${COEF.map(([f]) => `<td><input type="number" step="any" data-path="structures.${k}.${f}" data-sc="1" value="${fmtNum(cfg.structures[k][f])}" aria-label="${LABEL[k]} ${f}"></td>`).join('')}</tr>`).join('') + '</tbody>';
    document.querySelectorAll('#tab-settings [data-path]').forEach((el) => el.addEventListener('change', () => {
      const v = parseFloat(el.value) / +el.dataset.sc;
      if (!isFinite(v) || v < 0) { el.value = fmtNum(getP(cfg, el.dataset.path) * +el.dataset.sc); return; }
      let val = v;
      if (el.dataset.path === 'sim.dt') val = Math.min(1e-5, Math.max(2.5e-7, v));
      if (el.dataset.path === 'sim.sampleRate') val = Math.min(1e6, Math.max(100, v));
      if (el.dataset.path === 'sim.durationThreshold') val = Math.min(0.9, Math.max(0.01, v));
      if (el.dataset.path === 'sim.samplePhase') val = Math.min(0.999, v);
      setP(cfg, el.dataset.path, val);
      el.value = fmtNum(val * +el.dataset.sc);
      saveCfg(); schedule();
    }));
  }
  $('cfgReset').addEventListener('click', () => {
    cfg = NS.cloneConfig(NS.DEFAULT_CONFIG);
    try { localStorage.removeItem(CFG_STORE); } catch (e) { /* 무시 */ }
    renderSettings(); schedule();
  });

  /* ---------------- 시작 ---------------- */
  try { const th = localStorage.getItem('impactSim.theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* 무시 */ }
  $('btnTheme').textContent = isDark() ? '밝은 화면' : '어두운 화면';
  NS.Charts.init();
  NS.Viewer.init();
  NS.Anim.init((tMs) => NS.Charts.setPlayhead(tMs));
  NS.Experiment.init(() => { if (results) { NS.Experiment.compare(params(), cfg); if (activeTab === 'sweep') runSweep(); else sweepDirty = true; } });
  renderSettings();
  recompute();
  let startTab = 'result';
  try { startTab = localStorage.getItem('impactSim.tab') || 'result'; } catch (e) { /* 무시 */ }
  if (document.querySelector(`[data-tab="${startTab}"]`)) showTab(startTab);
})(window);
