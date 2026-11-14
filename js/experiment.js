/* =====================================================================
 * experiment.js — 실험 데이터 표 입력, CSV 불러오기, 시뮬레이션과 비교
 * ===================================================================== */
(function (root) {
  'use strict';
  const NS = root.ImpactSim;
  const STORE = 'impactSim.experiments.v1';
  const NAMES = { gyroid: 'Gyroid', octet: 'Octet', honeycomb: 'Honeycomb' };
  let rows = [];
  let onChange = () => {};

  function load() {
    try { rows = JSON.parse(localStorage.getItem(STORE) || '[]') || []; } catch (e) { rows = []; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(rows)); } catch (e) { /* 저장 불가(사생활 모드 등)면 무시 */ }
  }

  // "gyroid", "자이로이드", "G" 등 여러 표기를 구조 키로
  function parseKey(s) {
    s = String(s || '').trim().toLowerCase();
    if (/^g|자이로/.test(s)) return 'gyroid';
    if (/^o|옥텟/.test(s)) return 'octet';
    if (/^h|허니|벌집/.test(s)) return 'honeycomb';
    return null;
  }

  function parseCSV(text) {
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const c = line.split(/[,;\t]/).map((x) => x.trim().replace(/^"|"$/g, ''));
      const key = parseKey(c[0]);
      const nums = c.slice(1, 5).map(Number);
      if (!key || !isFinite(nums[0]) || !isFinite(nums[1])) continue; // 제목 줄 등은 건너뜀
      out.push({ key, mass: nums[0], height: nums[1], peak: nums[2], duration: nums[3] });
    }
    return out;
  }

  function init(cb) {
    onChange = cb;
    load();
    render();
    document.getElementById('expAdd').addEventListener('click', () => {
      const last = rows[rows.length - 1];
      rows.push(last ? { ...last, peak: NaN, duration: NaN } : { key: 'gyroid', mass: 500, height: 22, peak: NaN, duration: NaN });
      changed();
    });
    document.getElementById('expClear').addEventListener('click', () => {
      if (rows.length && !confirm('입력한 실험 데이터를 모두 지울까요?')) return;
      rows = []; changed();
    });
    document.getElementById('expFile').addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const add = parseCSV(String(rd.result));
        if (!add.length) alert('읽을 수 있는 행이 없어요. 열 순서(구조, 질량 g, 높이 cm, 최대힘 N, 지속시간 ms)를 확인해 주세요.');
        rows = rows.concat(add); changed();
      };
      rd.readAsText(f, 'utf-8');
      e.target.value = '';
    });
    document.getElementById('expSample').addEventListener('click', () => {
      const csv = '구조,질량(g),높이(cm),최대힘(N),지속시간(ms)\nGyroid,500,22,,\nOctet,500,22,,\nHoneycomb,500,22,,\n';
      NS.Charts.download(URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), '실험데이터_양식.csv');
    });
  }

  function changed() { save(); render(); onChange(); }

  function render(simRows) {
    const tb = document.getElementById('expTable');
    const head = '<thead><tr><th>구조</th><th>질량 (g)</th><th>높이 (cm)</th><th>최대힘 (N)</th><th>지속시간 (ms)</th><th>시뮬 최대힘 (N)</th><th>시뮬 지속시간 (ms)</th><th></th></tr></thead>';
    if (!rows.length) {
      tb.innerHTML = head + '<tbody><tr><td colspan="8" style="text-align:center;color:var(--ink-3)">아직 데이터가 없어요. [+ 행 추가]나 [CSV 불러오기]를 눌러 주세요.</td></tr></tbody>';
      return;
    }
    const fmt = (v, d) => (isFinite(v) ? (+v).toFixed(d) : '');
    tb.innerHTML = head + '<tbody>' + rows.map((r, i) => {
      const s = simRows && simRows[i];
      const err = (a, b) => (s && isFinite(a) && isFinite(b) && a ? ` <span class="sub">${(((b - a) / a) * 100).toFixed(0)}%</span>` : '');
      return `<tr data-i="${i}">
        <td><select data-f="key">${Object.keys(NAMES).map((k) => `<option value="${k}"${k === r.key ? ' selected' : ''}>${NAMES[k]}</option>`).join('')}</select></td>
        <td><input type="number" data-f="mass" value="${fmt(r.mass, 0)}" aria-label="질량"></td>
        <td><input type="number" data-f="height" value="${fmt(r.height, 1)}" aria-label="높이"></td>
        <td><input type="number" data-f="peak" value="${fmt(r.peak, 0)}" aria-label="최대힘"></td>
        <td><input type="number" data-f="duration" value="${fmt(r.duration, 3)}" step="0.01" aria-label="지속시간"></td>
        <td>${s ? s.peak.toFixed(0) + err(r.peak, s.peak) : ''}</td>
        <td>${s ? (s.duration * 1e3).toFixed(2) + err(r.duration, s.duration * 1e3) : ''}</td>
        <td class="del"><button class="btn small ghost" data-del="${i}" type="button" aria-label="행 삭제">삭제</button></td></tr>`;
    }).join('') + '</tbody>';
    tb.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', (e) => {
      const i = +e.target.closest('tr').dataset.i, f = e.target.dataset.f;
      rows[i][f] = f === 'key' ? e.target.value : parseFloat(e.target.value);
      changed();
    }));
    tb.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => { rows.splice(+el.dataset.del, 1); changed(); }));
  }

  /* 각 행을 그 행의 질량·높이로 시뮬레이션해서 비교 */
  function compare(params, cfg) {
    const sims = rows.map((r) => (isFinite(r.mass) && isFinite(r.height) && r.mass > 0 && r.height > 0)
      ? NS.simulate({ key: r.key, massKg: r.mass / 1000, heightM: r.height / 100, rho: params.rho[r.key], cellMm: params.cellMm, sizeM: params.sizeMm / 1000 }, cfg, { record: false })
      : null);
    render(sims);
    const F = [], D = [];
    rows.forEach((r, i) => {
      const s = sims[i]; if (!s) return;
      F.push({ key: r.key, mass: r.mass, height: r.height, exp: r.peak, sim: s.peak });
      D.push({ key: r.key, mass: r.mass, height: r.height, exp: r.duration, sim: s.duration * 1e3 });
    });
    NS.Charts.updateParity('parityF', F, 'N');
    NS.Charts.updateParity('parityT', D, 'ms');
  }

  /* 변인 스윕 그래프에 겹칠 점: 고정된 변인이 왼쪽 패널 값과 같은 행만 */
  function sweepPoints(variable, params) {
    return rows.filter((r) => isFinite(r.mass) && isFinite(r.height)).filter((r) => variable === 'height'
      ? Math.abs(r.mass - params.massG) <= Math.max(1, params.massG * 0.01)
      : Math.abs(r.height - params.heightCm) <= Math.max(0.2, params.heightCm * 0.01))
      .map((r) => ({ key: r.key, x: variable === 'height' ? r.height : r.mass, peak: r.peak, duration: r.duration }))
      .filter((p) => isFinite(p.peak) || isFinite(p.duration));
  }

  NS.Experiment = { init, compare, sweepPoints, parseCSV, rows: () => rows };
})(window);
