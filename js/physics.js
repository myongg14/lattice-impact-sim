/* =====================================================================
 * physics.js — 물성 계산(Gibson–Ashby), 응력-변형률 모델, 충돌 수치해석
 * ---------------------------------------------------------------------
 * 화면 코드(DOM, Chart.js, Three.js)는 하나도 쓰지 않는다.
 * 그래서 node로도 그대로 돌려서 결과를 검사할 수 있다(tools/check.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const NS = root.ImpactSim;

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };

  /* -------------------------------------------------------------------
   * 1) 구조별 물성 계산
   *    rho: 상대밀도(0~1), cellMm: 셀 크기(mm), sizeM: 시편 한 변(m)
   * ------------------------------------------------------------------- */
  function structureProps(key, rho, cellMm, sizeM, cfg) {
    const s = cfg.structures[key];
    const M = cfg.material;
    const md = cfg.model;
    const sizeMm = sizeM * 1000;

    // 가장자리 셀 효과: 셀이 시편에 비해 클수록 끝이 잘린 셀이 많아 약해짐
    const sizeFactor = clamp(1 - md.sizeEffectAlpha * cellMm / sizeMm, 0.5, 1);

    const E = s.C_E * M.Es * Math.pow(rho, s.n_E) * sizeFactor;
    // 초기 붕괴 응력. 꽉 찬 재료가 눌리는 응력(σ_s·ρ*)을 넘을 수는 없게 제한
    const sigPk = Math.min(s.C_pk * M.sigmaY * Math.pow(rho, s.n_pk), M.sigmaY * rho) * sizeFactor;

    // 고원 응력 비율(Honeycomb은 셀이 클수록 좌굴 뒤 더 떨어짐)
    let pr = s.plateauRatio;
    if (key === 'honeycomb') pr -= s.cellDropPer10mm * (cellMm - s.refCellMm) / 10;
    pr = clamp(pr, 0.2, 1.0);
    const sigPl = pr * sigPk;

    const epsY = sigPk / E;                       // 탄성 한계 변형률
    let epsD = 1 - md.densificationA * rho;       // 치밀화 시작 변형률
    epsD = Math.max(epsD, epsY + s.dropStrain + 0.05);

    // 접힘 파장(Honeycomb): Wierzbicki 반파장 H = 0.821·(l²t)^(1/3)
    let waveStrain = 0;
    const g = geometryInfo(key, rho, cellMm);
    if (key === 'honeycomb') {
      const l = cellMm / Math.sqrt(3);
      const H = 0.821 * Math.cbrt(l * l * g.thicknessMm);
      waveStrain = (2 * H) / sizeMm;
    }

    return {
      key, rho, cellMm, sizeM, sizeFactor,
      E, sigPk, sigPl, plateauRatio: pr, epsY, epsD,
      dropStrain: s.dropStrain, hardening: s.hardening,
      wave: s.wave, waveStrain,
      Es: M.Es, densePower: md.densePower,
      epsBottom: epsD + md.bottomOutStrain * (1 - epsD),
      unloadSecantFactor: md.unloadSecantFactor,
      geometry: g,
    };
  }

  /* 3D 모양·출력 가능성 확인용 치수 (mm) */
  function geometryInfo(key, rho, cellMm) {
    if (key === 'gyroid') {
      // 시트 자이로이드: 단위셀 부피당 표면적 ≈ 3.09/a → 두께 ≈ ρ·a/3.09
      return { thicknessMm: rho * cellMm / 3.09, label: '벽 두께' };
    }
    if (key === 'octet') {
      // 지주 길이 l = a/√2, ρ ≈ 6√2·π·(r/l)²
      const l = cellMm / Math.SQRT2;
      const r = l * Math.sqrt(rho / (6 * Math.SQRT2 * Math.PI));
      return { thicknessMm: 2 * r, strutLengthMm: l, label: '지주 지름' };
    }
    // 정육각 벌집: 맞변 거리 D, ρ = 2t/D
    return { thicknessMm: rho * cellMm / 2, label: '벽 두께' };
  }

  /* -------------------------------------------------------------------
   * 2) 응력-변형률 곡선
   *    처음 누를 때 따라가는 '포락선(envelope)'
   *    ① 선형 탄성 → ② 붕괴 고원(피크 후 감소·출렁임 포함) → ③ 치밀화
   * ------------------------------------------------------------------- */
  function plateauStress(eps, P) {
    const e0 = P.epsY + P.dropStrain;
    let s = P.sigPl * (1 + P.hardening * Math.max(0, eps - e0));
    if (P.wave > 0 && P.waveStrain > 0) {
      // 접힘마다 생기는 출렁임. 고원 시작·끝에서는 부드럽게 0으로
      const ramp = Math.min(1, (eps - e0) / 0.02, (P.epsD - eps) / 0.02);
      if (ramp > 0) s *= 1 + P.wave * ramp * Math.sin(2 * Math.PI * (eps - e0) / P.waveStrain);
    }
    return s;
  }

  function envelope(eps, P) {
    if (eps <= 0) return 0;
    if (eps <= P.epsY) return P.E * eps;                         // ① 탄성
    const e0 = P.epsY + P.dropStrain;
    if (eps < e0) {                                              // 피크 → 고원
      const u = smooth((eps - P.epsY) / P.dropStrain);
      return P.sigPk + (plateauStress(e0, P) - P.sigPk) * u;
    }
    if (eps < P.epsD) return plateauStress(eps, P);              // ② 고원
    // ③ 치밀화: 셀 벽끼리 맞닿아 모재(E_s)에 가깝게 단단해짐
    const x = Math.min((eps - P.epsD) / (1 - P.epsD), 0.999);
    return P.sigPl * (1 + P.hardening * (P.epsD - e0)) + P.Es * Math.pow(x, P.densePower);
  }

  /* 이력(히스테리시스)을 가진 응력: 지금까지의 최대 변형률 emax를 기억
   * - 처음 가는 변형률이면 포락선을 따라감
   * - 되돌아올 때(제하)는 단단한 직선으로 내려와 잔류 변형률에서 0이 됨
   *   → 누를 때와 뺄 때 곡선이 달라서 그 사이 넓이만큼 에너지가 흡수됨 */
  function unloadLine(emax, P) {
    if (emax <= P.epsY) return { Eu: P.E, eRes: 0 };              // 탄성 범위면 같은 길로 복귀
    const smax = envelope(emax, P);
    let Eu = Math.max(P.E, P.unloadSecantFactor * smax / emax);
    // 제하 직선이 포락선보다 위로 올라가면 에너지가 '생겨나는' 오류가 나므로,
    // 직선이 항상 포락선 아래에 있도록 기울기를 키움(치밀화 구간에서 중요)
    if (emax > P.epsD) for (let i = 1; i <= 80; i++) {
      const e = emax * (1 - Math.pow(i / 80, 2));
      if (emax - e < 1e-6) continue;
      const need = (smax - envelope(e, P)) / (emax - e);
      if (need > Eu) Eu = need;
    }
    return { Eu, eRes: Math.max(0, emax - smax / Eu) };
  }

  function stressWithHistory(eps, emax, line, P) {
    if (eps >= emax) return envelope(eps, P);
    if (emax <= P.epsY) return eps > 0 ? P.E * eps : 0;
    return Math.max(0, line.Eu * (eps - line.eRes));
  }

  /* 설명 탭에서 쓰는 곡선 데이터 */
  function stressStrainCurve(P, epsMax = 0.95, n = 400) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const e = (epsMax * i) / n;
      pts.push({ x: e, y: envelope(e, P) });
    }
    return pts;
  }

  /* -------------------------------------------------------------------
   * 3) 충돌 수치해석 (RK4)
   *
   *   충격체 m1 ─접촉 스프링─ 상판 m2 ─시험편(비선형)─ 하판 m3 ─로드셀─ 바닥
   *   x는 아래쪽이 +, t=0은 충돌 순간(판들은 자기 무게로 정지), 충격체만 속도 v0
   *
   *   input = { key, massKg, heightM, rho, cellMm, sizeM }
   *   opts  = { record: true/false }
   * ------------------------------------------------------------------- */
  function simulate(input, cfg, opts = {}) {
    const record = opts.record !== false;
    const P = structureProps(input.key, input.rho, input.cellMm, input.sizeM, cfg);
    const R = cfg.rig, S = cfg.sim, g = cfg.g;

    const m1 = input.massKg, m2 = R.topPlateMass, m3 = R.bottomPlateMass;
    const L = input.sizeM, A = L * L;
    const v0 = Math.sqrt(2 * g * input.heightM);
    const E0 = m1 * g * input.heightM;

    const kc = R.contactStiffness;
    const cc = 2 * R.contactDampingRatio * Math.sqrt(kc * (m1 * m2) / (m1 + m2));
    const k0 = P.E * A / L;                                   // 시험편 초기 강성
    const cs = 2 * cfg.model.specimenDampingRatio * Math.sqrt(k0 * (m1 + m2));
    const kl = R.loadCellStiffness;
    const cl = 2 * R.loadCellDampingRatio * Math.sqrt(kl * m3);

    const dt = Math.min(S.dt, 1e-5);                          // dt ≤ 10μs 보장
    const nMax = Math.ceil(S.tMax / dt);

    // 이력 변수 (한 스텝 동안은 고정)
    let emax = 0;
    let line = unloadLine(0, P);

    // 힘 계산
    const F = { c: 0, s: 0, l: 0 };
    function forces(y) {
      const dc = y[0] - y[2], vc = y[1] - y[3];
      F.c = dc > 0 ? Math.max(0, kc * dc + cc * vc) : 0;
      const ds = y[2] - y[4], vs = y[3] - y[5];
      const eps = ds / L;
      const touching = emax <= P.epsY ? eps > 0 : eps > line.eRes;
      F.s = touching ? Math.max(0, stressWithHistory(eps, emax, line, P) * A + cs * vs) : 0;
      F.l = kl * y[4] + cl * y[5] - tare;   // 로드셀은 판 무게를 영점(0)으로 맞춘 값
    }
    function deriv(y, out) {
      forces(y);
      out[0] = y[1]; out[1] = g - F.c / m1;
      out[2] = y[3]; out[3] = g + (F.c - F.s) / m2;
      out[4] = y[5]; out[5] = g + (F.s - F.l - tare) / m3;
    }

    // 시작 상태: 상판·하판이 자기 무게로 정지해 있는 평형 위치(영점 조정된 로드셀)
    const tare = (m2 + m3) * g;
    const x3s = tare / kl, ds0 = (m2 * g) / k0;
    const y = new Float64Array([x3s + ds0, v0, x3s + ds0, 0, x3s, 0]);
    const k1 = new Float64Array(6), k2 = new Float64Array(6), k3 = new Float64Array(6), k4 = new Float64Array(6);
    const tmp = new Float64Array(6);

    // 원시 기록(애니메이션·연속 그래프용)
    const stride = record ? Math.max(1, Math.round(5e-6 / dt)) : 0; // 약 5μs 간격으로 저장
    const raw = record ? { t: [], x1: [], x2: [], x3: [], Fl: [], Fs: [], eps: [] } : null;

    // 로드셀 샘플링(실제 측정처럼 fs마다 한 점)
    const fs = S.sampleRate, Ts = 1 / fs;
    const phase = (S.samplePhase || 0) * Ts;
    const sampT = [], sampF = [];
    for (let t = -Math.floor(S.preTrigger / Ts) * Ts + phase; t < 0; t += Ts) { sampT.push(t); sampF.push(0); }
    let nextSample = phase;
    const aa = S.antiAliasHz > 0 ? 1 / (2 * Math.PI * S.antiAliasHz) : 0; // RC
    let filt = 0, filtPrev = 0;

    // 결과 지표
    let t = 0, peakRaw = 0, peakSpec = 0, tPeakRaw = 0;
    let Wspec = 0, dsPrev = ds0, FsPrev = m2 * g;
    let tSep = -1, everContact = false, n = 0;
    let lastVc = v0;

    forces(y);
    if (record) pushRaw();

    function pushRaw() {
      raw.t.push(t); raw.x1.push(y[0]); raw.x2.push(y[2]); raw.x3.push(y[4]);
      raw.Fl.push(F.l); raw.Fs.push(F.s); raw.eps.push((y[2] - y[4]) / L);
    }

    for (n = 1; n <= nMax; n++) {
      // --- RK4 한 스텝 ---
      deriv(y, k1);
      for (let i = 0; i < 6; i++) tmp[i] = y[i] + 0.5 * dt * k1[i];
      deriv(tmp, k2);
      for (let i = 0; i < 6; i++) tmp[i] = y[i] + 0.5 * dt * k2[i];
      deriv(tmp, k3);
      for (let i = 0; i < 6; i++) tmp[i] = y[i] + dt * k3[i];
      deriv(tmp, k4);
      for (let i = 0; i < 6; i++) y[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      t = n * dt;

      // --- 이력 갱신(최대 변형률) ---
      const ds = y[2] - y[4];
      const eps = ds / L;
      if (eps > emax) { emax = eps; line = unloadLine(emax, P); }

      forces(y);

      // 시험편이 받은 일(흡수 에너지) — 사다리꼴 적분
      Wspec += 0.5 * (F.s + FsPrev) * (ds - dsPrev);
      dsPrev = ds; FsPrev = F.s;

      if (F.l > peakRaw) { peakRaw = F.l; tPeakRaw = t; }
      if (F.s > peakSpec) peakSpec = F.s;

      // 저역통과 필터 → 샘플링(두 스텝 사이를 선형 보간)
      filtPrev = filt;
      filt = aa > 0 ? filt + (dt / (aa + dt)) * (F.l - filt) : F.l;
      while (nextSample <= t) {
        const u = (nextSample - (t - dt)) / dt;
        sampT.push(nextSample); sampF.push(filtPrev + (filt - filtPrev) * u);
        nextSample += Ts;
      }

      if (record && n % stride === 0) pushRaw();

      // --- 끝내기 판단 ---
      const dc = y[0] - y[2], vc = y[1] - y[3];
      if (F.c > 0) everContact = true;
      if (everContact && tSep < 0 && dc < 0 && y[1] < 0 && F.s < 1e-3 * peakSpec) tSep = t; // 충격체가 위로 떠난 순간
      if (tSep > 0 && t > tSep + S.tailAfterSeparation) break;
      // 튀어 오르지 않고 멈춘 경우(완전 소성)
      if (everContact && t > tPeakRaw + 0.003 && Math.abs(y[1]) < 0.005 && Math.abs(y[3]) < 0.005 && Math.abs(lastVc) < 0.005 &&
        Math.abs(F.l - m1 * g) < 0.02 * peakRaw) break;
      lastVc = vc;
    }

    const rebound = -y[1];   // 위로 튀어 오르는 속도(+)
    const out = {
      input, props: P,
      v0, E0,
      sampled: { t: sampT, F: sampF },
      raw,
      peakRaw, tPeakRaw, peakSpec,
      absorbed: Wspec,
      reboundV: rebound,
      reboundE: 0.5 * m1 * Math.max(0, rebound) * Math.max(0, rebound),
      momentum: m1 * (v0 + rebound),
      epsMax: emax,
      residualStrain: unloadLine(emax, P).eRes,
      densified: emax > P.epsD,
      // 바닥 닿음: 치밀화가 많이 진행됐거나, 힘이 고원보다 훨씬(기본 5배) 커졌을 때
      bottomedOut: emax > P.epsBottom || (emax > P.epsD && peakSpec / A > cfg.model.bottomOutStressRatio * P.sigPk),
      enteredPlateau: emax > P.epsY,
      tEnd: t,
      steps: n,
      dt,
    };
    Object.assign(out, pulseMetrics(sampT, sampF, S.durationThreshold));
    if (raw) {
      const rm = pulseMetrics(raw.t, raw.Fl, S.durationThreshold);
      out.rawDuration = rm.duration;
    }
    return out;
  }

  /* 측정 신호에서 최대힘·지속시간·충격량 계산
   * 지속시간 = 힘이 (기준×최대값)을 처음 넘은 시점 ~ 최대값 이후 처음 그 아래로 떨어진 시점 */
  function pulseMetrics(T, Fv, thrRatio) {
    let ip = 0;
    for (let i = 1; i < Fv.length; i++) if (Fv[i] > Fv[ip]) ip = i;
    const peak = Fv[ip] || 0;
    const thr = thrRatio * peak;
    let tStart = NaN, tEndP = NaN, endFound = false;
    for (let i = 1; i <= ip; i++) {
      if (Fv[i] >= thr) { tStart = cross(T, Fv, i - 1, i, thr); break; }
    }
    for (let j = ip + 1; j < Fv.length; j++) {
      if (Fv[j] < thr) { tEndP = cross(T, Fv, j - 1, j, thr); endFound = true; break; }
    }
    if (!endFound) tEndP = T[T.length - 1];
    let impulse = 0;
    for (let i = 1; i < Fv.length; i++) impulse += 0.5 * (Fv[i] + Fv[i - 1]) * (T[i] - T[i - 1]);
    return { peak, tPeak: T[ip], tStart, tEndPulse: tEndP, duration: tEndP - tStart, impulse, durationOpen: !endFound };
  }
  function cross(T, Fv, a, b, thr) {
    const fa = Fv[a], fb = Fv[b];
    if (fb === fa) return T[b];
    return T[a] + (T[b] - T[a]) * (thr - fa) / (fb - fa);
  }

  /* -------------------------------------------------------------------
   * 4) 묶음 계산: 세 구조 × (기준 크기, −오차, +오차)
   * ------------------------------------------------------------------- */
  function runAll(params, cfg) {
    const res = {};
    for (const key of NS.STRUCT_KEYS) {
      const base = {
        key,
        massKg: params.massG / 1000,
        heightM: params.heightCm / 100,
        rho: params.rho[key],
        cellMm: params.cellMm,
        sizeM: params.sizeMm / 1000,
      };
      const main = simulate(base, cfg, { record: true });
      if (params.tolMm > 0) {
        const lo = simulate({ ...base, sizeM: (params.sizeMm - params.tolMm) / 1000 }, cfg, { record: false });
        const hi = simulate({ ...base, sizeM: (params.sizeMm + params.tolMm) / 1000 }, cfg, { record: false });
        main.tol = {
          peak: [Math.min(lo.peak, hi.peak, main.peak), Math.max(lo.peak, hi.peak, main.peak)],
          duration: [Math.min(lo.duration, hi.duration, main.duration), Math.max(lo.duration, hi.duration, main.duration)],
        };
      }
      res[key] = main;
    }
    return res;
  }

  /* 변인 스윕: variable = 'height' | 'mass' */
  function sweep(params, variable, from, to, count, cfg) {
    const xs = [];
    for (let i = 0; i < count; i++) xs.push(from + (to - from) * (count === 1 ? 0 : i / (count - 1)));
    const out = { variable, xs, series: {} };
    for (const key of NS.STRUCT_KEYS) {
      const pts = [];
      for (const x of xs) {
        const r = simulate({
          key,
          massKg: (variable === 'mass' ? x : params.massG) / 1000,
          heightM: (variable === 'height' ? x : params.heightCm) / 100,
          rho: params.rho[key],
          cellMm: params.cellMm,
          sizeM: params.sizeMm / 1000,
        }, cfg, { record: false });
        pts.push({ x, peak: r.peak, duration: r.duration, bottomedOut: r.bottomedOut, densified: r.densified });
      }
      out.series[key] = pts;
    }
    return out;
  }

  NS.structureProps = structureProps;
  NS.geometryInfo = geometryInfo;
  NS.envelope = envelope;
  NS.stressStrainCurve = stressStrainCurve;
  NS.simulate = simulate;
  NS.pulseMetrics = pulseMetrics;
  NS.runAll = runAll;
  NS.sweep = sweep;
})(typeof window !== 'undefined' ? window : globalThis);
