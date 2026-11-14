/* =====================================================================
 * config.js — 시뮬레이터의 모든 보정용 상수를 한 곳에 모은 파일
 * ---------------------------------------------------------------------
 * 실험 데이터가 생기면 이 파일의 숫자(특히 structures 안의 C 계수)만
 * 바꾸면 된다. 화면의 [모델 설정] 탭에서도 같은 값을 바꿀 수 있고,
 * 거기서 바꾼 값은 이 브라우저에만 기억된다(파일은 그대로).
 *
 * 단위: 길이 m, 질량 kg, 시간 s, 힘 N, 응력 Pa (화면 표시는 mm·g·ms·kN)
 * ===================================================================== */
(function (root) {
  'use strict';

  const DEFAULT_CONFIG = {
    g: 9.81, // 중력가속도 (m/s²)

    // ---- 모재(PETG) 물성 -------------------------------------------
    material: {
      name: 'PETG',
      Es: 2.0e9,      // 영률 E_s (Pa)
      sigmaY: 50e6,   // 항복강도 σ_s (Pa)
      density: 1270,  // 밀도 (kg/m³) = 1.27 g/cm³
    },

    // ---- 실험 장치(상판·하판·로드셀) ---------------------------------
    rig: {
      // 실제 실험은 나무판을 씀. 무게는 측정 전이라 추정값(합판 약 0.6 g/cm³, 100×100×10mm ≈ 60g)
      topPlateMass: 0.06,      // 상판(나무) 질량 (kg) — 측정하면 바꿀 것
      bottomPlateMass: 0.06,   // 하판(나무) 질량 (kg) — 측정하면 바꿀 것
      contactStiffness: 3e7,   // 충격체↔나무 상판 접촉 강성 (N/m). 나무는 결 수직 방향이 무르므로 금속끼리(≈2e8)보다 작게
      contactDampingRatio: 0.05,
      loadCellStiffness: 1e8,  // 로드셀 강성 (N/m) — 압축형 로드셀의 대표값
      loadCellDampingRatio: 0.2,
    },

    // ---- 구조별 Gibson–Ashby 계수 ------------------------------------
    // E   = C_E  · E_s · ρ*^n_E        (초기 탄성계수)
    // σ_pk = C_pk · σ_s · ρ*^n_pk      (초기 붕괴(항복) 응력)
    // σ_pl = plateauRatio · σ_pk       (고원 응력)
    structures: {
      gyroid: {
        label: 'Gyroid',
        kind: '굽힘 지배형에 가까움',
        color: '#2a78d6',
        C_E: 0.25, n_E: 2.0,     // 문헌상 시트 자이로이드 E/E_s ≈ 0.2~0.3·ρ*²
        C_pk: 0.30, n_pk: 1.5,   // Gibson–Ashby 굽힘형 σ/σ_s ≈ 0.3·ρ*^1.5
        plateauRatio: 1.0,       // 피크 뒤 힘이 거의 떨어지지 않음
        dropStrain: 0.0,         // 피크 → 고원까지 걸리는 변형률
        hardening: 0.6,          // 고원 구간 기울기(σ_pl에 대한 비율/변형률)
        wave: 0.0,               // 고원 구간 힘의 출렁임(층별 붕괴)
      },
      octet: {
        label: 'Octet',
        kind: '신장 지배형',
        color: '#eb6834',
        C_E: 1 / 9, n_E: 1.0,    // Deshpande–Fleck–Ashby(2001): E/E_s ≈ ρ*/9
        C_pk: 0.30, n_pk: 1.0,   // σ/σ_s ≈ 0.3·ρ*
        plateauRatio: 0.80,      // 신장 지배형은 항복 후 지주 좌굴로 약간 연화
        dropStrain: 0.04,
        hardening: 0.3,
        wave: 0.0,
      },
      honeycomb: {
        label: 'Honeycomb',
        kind: '면외 압축(벽 좌굴)',
        color: '#1baf7a',
        C_E: 1.0, n_E: 1.0,      // 면외 압축: E ≈ E_s·ρ* (벽이 기둥처럼 버팀)
        C_pk: 2.0, n_pk: 5 / 3,  // 벽 소성 좌굴: σ ∝ σ_s·(t/l)^(5/3)
        plateauRatio: 0.50,      // 기준 셀(10mm)에서 좌굴 뒤 피크의 50%로 떨어짐
        dropStrain: 0.03,
        hardening: 0.2,
        wave: 0.12,              // 접힘(progressive folding)마다 힘이 출렁임
        // 셀 크기 효과: 셀이 클수록 벽이 길어져 좌굴 뒤 힘이 더 많이 떨어짐
        cellDropPer10mm: 0.12,   // 셀이 10mm 커질 때 plateauRatio 감소량
        refCellMm: 10,
      },
    },

    // ---- 모든 구조에 공통인 모델 상수 --------------------------------
    model: {
      densificationA: 1.4,   // ε_D = 1 − A·ρ*
      densePower: 3,         // 치밀화 구간 σ = σ_pl,end + E_s·x^p
      bottomOutStrain: 0.5,  // ε가 ε_D + 이 값×(1−ε_D)를 넘으면 '바닥 닿음' 경고
      bottomOutStressRatio: 5, // 또는 치밀화 후 응력이 붕괴응력의 이 배수를 넘으면 경고
      specimenDampingRatio: 0.05, // 재료 점성(작은 탄성 히스테리시스)
      unloadSecantFactor: 3, // 제하 기울기 = max(E, 이 값 × 할선기울기)
      sizeEffectAlpha: 0.5,  // 가장자리 셀 효과: 물성 × (1 − α·셀크기/시편크기)
      nozzleMm: 0.4,         // 출력 가능 최소 두께 경고 기준
    },

    // ---- 수치해석·측정 ----------------------------------------------
    sim: {
      dt: 2e-6,              // RK4 시간 간격 (s) — 10μs 이하
      tMax: 0.08,            // 최대 계산 시간 (s)
      tailAfterSeparation: 0.002, // 충격체가 떨어진 뒤 더 계산할 시간 (s)
      preTrigger: 0.0003,    // 그래프에서 충돌 전 보여 줄 시간 (s)
      sampleRate: 10000,     // 로드셀 샘플링 속도 (Hz)
      antiAliasHz: 4000,     // 샘플링 전 저역통과 필터(0이면 끔)
      durationThreshold: 0.10, // 충격 지속시간 기준(최대값의 10%)
      samplePhase: 0,        // 첫 샘플이 충돌 순간에서 몇 주기 뒤에 찍히는지(0~1)
    },
  };

  // 깊은 복사(설정을 바꿔도 기본값은 그대로 두기 위해)
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 저장된 사용자 설정을 기본값 위에 덮어쓰기
  function merge(base, over) {
    if (!over || typeof over !== 'object') return base;
    for (const k of Object.keys(over)) {
      if (!(k in base)) continue;
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], over[k]);
      else if (typeof base[k] === typeof over[k]) base[k] = over[k];
    }
    return base;
  }

  root.ImpactSim = root.ImpactSim || {};
  root.ImpactSim.DEFAULT_CONFIG = DEFAULT_CONFIG;
  root.ImpactSim.cloneConfig = clone;
  root.ImpactSim.mergeConfig = merge;
  root.ImpactSim.STRUCT_KEYS = ['gyroid', 'octet', 'honeycomb'];
})(typeof window !== 'undefined' ? window : globalThis);
