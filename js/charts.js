/* =====================================================================
 * charts.js — Chart.js 그래프 만들기·갱신, PNG 저장
 * ===================================================================== */
(function (root) {
  'use strict';
  const NS = root.ImpactSim;
  const KEYS = NS.STRUCT_KEYS;
  const LABEL = { gyroid: 'Gyroid', octet: 'Octet', honeycomb: 'Honeycomb' };
  const charts = {};
  let T = {}; // 현재 화면 색

  /* CSS 변수에서 색 읽기(밝은/어두운 화면 모두) */
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    T = {
      surface: v('--surface'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), grid: v('--grid'),
      color: { gyroid: v('--c-gyroid'), octet: v('--c-octet'), honeycomb: v('--c-honeycomb') },
      fs: parseFloat(v('--fs')) || 16,
    };
    return T;
  }
  NS.colorOf = (k) => T.color[k];

  /* ---- 플러그인: PNG 저장 시 배경 채우기 ---- */
  const bgPlugin = {
    id: 'bg',
    beforeDraw(c) {
      const ctx = c.ctx; ctx.save(); ctx.fillStyle = T.surface; ctx.fillRect(0, 0, c.width, c.height); ctx.restore();
    },
  };
  /* ---- 플러그인: 애니메이션과 맞춘 현재 시점 세로선 ---- */
  const playheadPlugin = {
    id: 'playhead',
    afterDatasetsDraw(c, args, opts) {
      const t = c.$playhead;
      if (t == null || !c.scales.x) return;
      const x = c.scales.x.getPixelForValue(t);
      if (x < c.chartArea.left || x > c.chartArea.right) return;
      const ctx = c.ctx; ctx.save();
      ctx.strokeStyle = T.ink; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, c.chartArea.top); ctx.lineTo(x, c.chartArea.bottom); ctx.stroke();
      ctx.restore();
    },
  };
  /* ---- 플러그인: 막대 위 값 표시 + 오차 범위 수염 ---- */
  const barLabelPlugin = {
    id: 'barLabel',
    afterDatasetsDraw(c, args, opts) {
      if (!opts || !opts.enabled) return;
      const ctx = c.ctx; const meta = c.getDatasetMeta(0); const ds = c.data.datasets[0];
      ctx.save();
      ctx.font = `600 ${Math.round(T.fs * 0.8)}px system-ui, sans-serif`;
      ctx.fillStyle = T.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      meta.data.forEach((bar, i) => {
        const range = ds.ranges && ds.ranges[i];
        let top = bar.y;
        if (range) {
          const y0 = c.scales.y.getPixelForValue(range[0]), y1 = c.scales.y.getPixelForValue(range[1]);
          ctx.strokeStyle = T.ink2; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(bar.x, y0); ctx.lineTo(bar.x, y1);
          ctx.moveTo(bar.x - 6, y0); ctx.lineTo(bar.x + 6, y0); ctx.moveTo(bar.x - 6, y1); ctx.lineTo(bar.x + 6, y1); ctx.stroke();
          top = Math.min(top, y1);
        }
        ctx.fillText(ds.labelsText[i], bar.x, top - 4);
      });
      ctx.restore();
    },
  };
  Chart.register(bgPlugin, playheadPlugin, barLabelPlugin);

  /* 표본 시각이 같은 점끼리 모아 툴팁에 함께 보여 주는 상호작용 */
  Chart.Interaction.modes.sameX = function (chart, e) {
    const items = [];
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (!meta.visible || ds.noTip) return;
      let best = -1, bd = Infinity;
      meta.data.forEach((el, i) => { const d = Math.abs(el.x - e.x); if (d < bd) { bd = d; best = i; } });
      if (best >= 0 && bd < 30) items.push({ element: meta.data[best], datasetIndex: di, index: best });
    });
    return items;
  };

  function baseOptions(xTitle, yTitle) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      layout: { padding: { top: 6, right: 8 } },
      interaction: { mode: 'sameX', intersect: false },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { color: T.ink2, usePointStyle: true, boxWidth: 10, font: { size: T.fs * 0.85 } } },
        tooltip: {
          backgroundColor: T.surface, titleColor: T.ink, bodyColor: T.ink2, borderColor: T.grid, borderWidth: 1,
          titleFont: { size: T.fs * 0.8 }, bodyFont: { size: T.fs * 0.8 }, padding: 10, usePointStyle: true,
        },
        barLabel: { enabled: false },
      },
      scales: {
        x: { type: 'linear', title: { display: !!xTitle, text: xTitle, color: T.ink2, font: { size: T.fs * 0.85 } },
          grid: { color: T.grid }, border: { color: T.grid }, ticks: { color: T.ink3, font: { size: T.fs * 0.78 } } },
        y: { title: { display: !!yTitle, text: yTitle, color: T.ink2, font: { size: T.fs * 0.85 } },
          grid: { color: T.grid }, border: { display: false }, ticks: { color: T.ink3, font: { size: T.fs * 0.78 } }, beginAtZero: true },
      },
    };
  }

  function lineDs(key, data, extra = {}) {
    return Object.assign({
      label: LABEL[key], data, key, parsing: false,
      borderColor: T.color[key], backgroundColor: T.color[key],
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0, showLine: true,
    }, extra);
  }

  /* ================= 차트 만들기 ================= */
  function init() {
    readTheme();
    const fmtN = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + ' kN' : v.toFixed(0) + ' N');

    // 1. 힘-시간
    const of = baseOptions('시간 (ms)', '로드셀 힘 (kN)');
    of.plugins.tooltip.callbacks = {
      title: (it) => it.length ? `t = ${it[0].parsed.x.toFixed(2)} ms` : '',
      label: (it) => `${it.dataset.label}: ${fmtN(it.parsed.y * 1000)}`,
    };
    charts.force = new Chart(document.getElementById('chartForce'), { type: 'scatter', data: { datasets: [] }, options: of });

    // 2. 막대 4개
    const barDefs = { barPeak: 'peak', barDur: 'duration', barImp: 'impulse', barAbs: 'absorbed' };
    for (const id of Object.keys(barDefs)) {
      const o = baseOptions('', '');
      o.interaction = { mode: 'index', intersect: false };
      o.plugins.legend.display = false;
      o.plugins.barLabel.enabled = true;
      o.layout.padding.top = 22;
      o.scales.x = { type: 'category', grid: { display: false }, border: { color: T.grid }, ticks: { color: T.ink2, font: { size: T.fs * 0.75 }, maxRotation: 0, autoSkip: false } };
      o.plugins.tooltip.callbacks = { label: (it) => it.dataset.labelsText[it.dataIndex] };
      charts[id] = new Chart(document.getElementById(id), {
        type: 'bar',
        data: { labels: KEYS.map((k) => LABEL[k]), datasets: [{ data: [0, 0, 0], backgroundColor: [], borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 56, labelsText: [] }] },
        options: o,
      });
      charts[id].metric = barDefs[id];
    }

    // 3. 변인 스윕
    const osw = baseOptions('낙하 높이 (cm)', '최대 충격력 (kN)');
    osw.interaction = { mode: 'sameX', intersect: false };
    charts.sweep = new Chart(document.getElementById('chartSweep'), { type: 'scatter', data: { datasets: [] }, options: osw });

    // 5. 애니메이션용 힘-시간
    const oa = baseOptions('시간 (ms)', '로드셀 힘 (kN)');
    oa.plugins.tooltip.callbacks = of.plugins.tooltip.callbacks;
    charts.anim = new Chart(document.getElementById('chartAnim'), { type: 'scatter', data: { datasets: [] }, options: oa });

    // 6. 응력-변형률 / 이력곡선
    const oss = baseOptions('변형률 ε', '응력 σ (MPa)');
    oss.plugins.tooltip.callbacks = { title: (it) => it.length ? `ε = ${it[0].parsed.x.toFixed(3)}` : '', label: (it) => `${it.dataset.label}: ${it.parsed.y.toFixed(2)} MPa` };
    charts.ss = new Chart(document.getElementById('chartSS'), { type: 'scatter', data: { datasets: [] }, options: oss });
    const oh = baseOptions('시험편 압축량 (mm)', '시험편이 받는 힘 (kN)');
    oh.interaction = { mode: 'nearest', intersect: false };
    oh.plugins.tooltip.callbacks = { label: (it) => `${it.dataset.label}: ${it.parsed.x.toFixed(3)} mm, ${it.parsed.y.toFixed(2)} kN` };
    charts.hyst = new Chart(document.getElementById('chartHyst'), { type: 'scatter', data: { datasets: [] }, options: oh });

    // 7. 실험 비교(패리티)
    for (const [id, name, unit] of [['parityF', '최대 충격력', 'N'], ['parityT', '충격 지속시간', 'ms']]) {
      const o = baseOptions(`실험 ${name} (${unit})`, `시뮬레이션 ${name} (${unit})`);
      o.interaction = { mode: 'nearest', intersect: true };
      o.plugins.tooltip.callbacks = { label: (it) => it.raw.tip || '' };
      charts[id] = new Chart(document.getElementById('chart' + id[0].toUpperCase() + id.slice(1)), { type: 'scatter', data: { datasets: [] }, options: o });
    }
  }

  /* ================= 갱신 ================= */
  function updateForce(results, showRaw, chart = charts.force) {
    const ds = [];
    for (const k of KEYS) {
      const r = results[k];
      ds.push(lineDs(k, r.sampled.t.map((t, i) => ({ x: t * 1e3, y: r.sampled.F[i] / 1e3 })), {
        label: `${LABEL[k]} (측정 ${(r.sampled.t.length > 1 ? Math.round(1 / (r.sampled.t[1] - r.sampled.t[0]) / 1000) : '?')} kHz)`,
        pointRadius: 3, pointHoverRadius: 6,
      }));
    }
    if (showRaw) {
      for (const k of KEYS) {
        const r = results[k];
        ds.push(lineDs(k, r.raw.t.map((t, i) => ({ x: t * 1e3, y: r.raw.Fl[i] / 1e3 })), {
          label: `${LABEL[k]} 연속`, borderWidth: 1.5, borderDash: [5, 4], noTip: true, pointHoverRadius: 0,
        }));
      }
    }
    chart.data.datasets = ds;
    const tEnd = Math.max(...KEYS.map((k) => results[k].tEndPulse)) * 1e3;
    const tStart = results[KEYS[0]].sampled.t[0] * 1e3;
    chart.options.scales.x.min = Math.min(0, tStart);
    chart.options.scales.x.max = niceCeil(tEnd * 1.35 + 0.1);
    chart.update();
  }

  function niceCeil(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function updateBars(results) {
    const fmt = {
      peak: (r) => [r.peak / 1e3, r.tol ? r.tol.peak.map((x) => x / 1e3) : null, (r.peak / 1e3).toFixed(2)],
      duration: (r) => [r.duration * 1e3, r.tol ? r.tol.duration.map((x) => x * 1e3) : null, (r.duration * 1e3).toFixed(2)],
      impulse: (r) => [r.impulse, null, r.impulse.toFixed(3)],
      absorbed: (r) => [r.absorbed, null, r.absorbed.toFixed(3)],
    };
    for (const id of ['barPeak', 'barDur', 'barImp', 'barAbs']) {
      const c = charts[id], f = fmt[c.metric];
      const d = c.data.datasets[0];
      const vals = KEYS.map((k) => f(results[k]));
      d.data = vals.map((v) => v[0]);
      d.ranges = vals.map((v) => v[1]);
      d.labelsText = vals.map((v) => v[2]);
      d.backgroundColor = KEYS.map((k) => T.color[k]);
      const mx = Math.max(...vals.map((v) => (v[1] ? v[1][1] : v[0])));
      c.options.scales.y.max = niceCeil(mx * 1.12 || 1);
      c.update();
    }
  }

  function updateSweep(sw, metric, expPts) {
    const isH = sw.variable === 'height';
    const c = charts.sweep;
    const ds = KEYS.map((k) => lineDs(k, sw.series[k].map((p) => ({
      x: p.x, y: metric === 'peak' ? p.peak / 1e3 : p.duration * 1e3, warn: p.bottomedOut,
    })), {
      pointRadius: sw.series[k].map((p) => (p.bottomedOut ? 7 : 3)),
      pointStyle: sw.series[k].map((p) => (p.bottomedOut ? 'triangle' : 'circle')),
    }));
    for (const k of KEYS) {
      const pts = (expPts || []).filter((p) => p.key === k);
      if (!pts.length) continue;
      ds.push({
        label: `${LABEL[k]} 실험`, key: k, data: pts.map((p) => ({ x: p.x, y: metric === 'peak' ? p.peak / 1e3 : p.duration })),
        parsing: false, showLine: false, pointStyle: 'rectRot', pointRadius: 8, pointHoverRadius: 10,
        backgroundColor: T.color[k], borderColor: T.surface, borderWidth: 2,
      });
    }
    c.data.datasets = ds;
    c.options.scales.x.title.text = isH ? '낙하 높이 (cm)' : '충격체 질량 (g)';
    c.options.scales.y.title.text = metric === 'peak' ? '최대 충격력 (kN)' : '충격 지속시간 (ms)';
    c.options.scales.x.min = sw.xs[0]; c.options.scales.x.max = sw.xs[sw.xs.length - 1];
    c.options.plugins.tooltip.callbacks = {
      title: (it) => it.length ? (isH ? `높이 ${it[0].parsed.x.toFixed(1)} cm` : `질량 ${it[0].parsed.x.toFixed(0)} g`) : '',
      label: (it) => `${it.dataset.label}: ${metric === 'peak' ? it.parsed.y.toFixed(2) + ' kN' : it.parsed.y.toFixed(2) + ' ms'}${it.raw.warn ? ' (바닥 닿음)' : ''}`,
    };
    c.update();
  }

  function updateSS(results) {
    const c = charts.ss; const ds = []; let ymax = 0;
    for (const k of KEYS) {
      const P = results[k].props;
      ymax = Math.max(ymax, P.sigPk / 1e6);
      ds.push(lineDs(k, NS.stressStrainCurve(P, 0.9, 450).map((p) => ({ x: p.x, y: p.y / 1e6 }))));
    }
    for (const k of KEYS) {
      const r = results[k];
      ds.push({
        label: `${LABEL[k]} 이번 충돌 최대 변형`, key: k, parsing: false, showLine: false,
        data: [{ x: r.epsMax, y: NS.envelope(r.epsMax, r.props) / 1e6 }],
        pointRadius: 8, pointStyle: 'rectRot', backgroundColor: T.color[k], borderColor: T.surface, borderWidth: 2,
      });
    }
    c.data.datasets = ds;
    c.options.scales.y.max = niceCeil(ymax * 2.2);
    c.options.scales.x.min = 0; c.options.scales.x.max = 0.9;
    c.update();
  }

  function updateHyst(results) {
    const c = charts.hyst;
    c.data.datasets = KEYS.map((k) => {
      const r = results[k], L = r.input.sizeM;
      // 시험편이 힘을 받는 동안만 그림(충격 뒤 상판이 떠오른 구간은 제외)
      let last = 0;
      r.raw.Fs.forEach((f, i) => { if (f > 0) last = i; });
      const pts = [];
      for (let i = 0; i <= Math.min(last + 1, r.raw.t.length - 1); i++) pts.push({ x: Math.max(0, r.raw.eps[i]) * L * 1e3, y: r.raw.Fs[i] / 1e3 });
      return lineDs(k, pts, { pointHoverRadius: 3 });
    });
    c.update();
  }

  function updateParity(id, rows, unit) {
    const c = charts[id]; const ds = []; let mx = 0;
    for (const k of KEYS) {
      const pts = rows.filter((r) => r.key === k && isFinite(r.exp) && isFinite(r.sim));
      pts.forEach((p) => { mx = Math.max(mx, p.exp, p.sim); });
      ds.push({
        label: LABEL[k], key: k, parsing: false, showLine: false,
        data: pts.map((p) => ({ x: p.exp, y: p.sim, tip: `${LABEL[k]} ${p.mass}g·${p.height}cm: 실험 ${p.exp.toFixed(unit === 'ms' ? 2 : 0)} / 시뮬 ${p.sim.toFixed(unit === 'ms' ? 2 : 0)} ${unit} (오차 ${(((p.sim - p.exp) / p.exp) * 100).toFixed(0)}%)` })),
        pointRadius: 7, pointHoverRadius: 9, backgroundColor: T.color[k], borderColor: T.surface, borderWidth: 2,
      });
    }
    mx = niceCeil((mx || 1) * 1.1);
    ds.push({ label: '실험 = 시뮬레이션', data: [{ x: 0, y: 0 }, { x: mx, y: mx }], parsing: false, showLine: true, borderColor: T.ink3, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, noTip: true });
    c.data.datasets = ds;
    c.options.scales.x.min = 0; c.options.scales.x.max = mx; c.options.scales.y.max = mx;
    c.update();
  }

  function setPlayhead(tMs) {
    for (const c of [charts.anim, charts.force]) {
      if (!c) continue;
      if (c.$playhead === tMs) continue;
      c.$playhead = tMs;
      c.draw();
    }
  }

  /* 화면 색이 바뀌면 모든 차트 다시 칠하기 */
  function applyTheme() {
    readTheme();
    for (const c of Object.values(charts)) {
      const o = c.options;
      o.plugins.legend.labels.color = T.ink2;
      Object.assign(o.plugins.tooltip, { backgroundColor: T.surface, titleColor: T.ink, bodyColor: T.ink2, borderColor: T.grid });
      for (const ax of Object.values(o.scales)) {
        if (ax.grid && ax.grid.color) ax.grid.color = T.grid;
        if (ax.border) ax.border.color = T.grid;
        if (ax.ticks) ax.ticks.color = ax.type === 'category' ? T.ink2 : T.ink3;
        if (ax.title) ax.title.color = T.ink2;
        for (const part of ['title', 'ticks']) if (ax[part]) ax[part].font = { size: T.fs * (part === 'title' ? 0.85 : 0.78) };
      }
      o.plugins.legend.labels.font = { size: T.fs * 0.85 };
      for (const d of c.data.datasets) {
        if (d.key && c.config.type !== 'bar') {
          d.borderColor = d.pointStyle === 'rectRot' ? T.surface : T.color[d.key];
          d.backgroundColor = T.color[d.key];
        }
      }
      c.update();
    }
  }

  function savePNG(name) {
    const map = { force: 'force', sweep: 'sweep', ss: 'ss', hyst: 'hyst', parityF: 'parityF', parityT: 'parityT' };
    if (name === 'bars') return saveBarsPNG();
    const c = charts[map[name]];
    if (!c) return;
    download(c.toBase64Image('image/png', 1), `${name}.png`);
  }
  // 막대그래프 4개를 한 장으로 합쳐 저장
  function saveBarsPNG() {
    const ids = ['barPeak', 'barDur', 'barImp', 'barAbs'];
    const titles = ['최대 충격력 (kN)', '충격 지속시간 (ms)', '충격량 (N·s)', '흡수 에너지 (J)'];
    const w = charts[ids[0]].canvas.width, h = charts[ids[0]].canvas.height;
    const head = Math.round(T.fs * 2.2 * (w / charts[ids[0]].width));
    const out = document.createElement('canvas'); out.width = w * 4; out.height = h + head;
    const ctx = out.getContext('2d'); ctx.fillStyle = T.surface; ctx.fillRect(0, 0, out.width, out.height);
    ctx.fillStyle = T.ink; ctx.font = `600 ${Math.round(head * 0.45)}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ids.forEach((id, i) => { ctx.fillText(titles[i], w * i + w / 2, head * 0.7); ctx.drawImage(charts[id].canvas, w * i, head); });
    download(out.toDataURL('image/png'), 'summary-bars.png');
  }
  function download(url, name) {
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  NS.Charts = { init, updateForce, updateBars, updateSweep, updateSS, updateHyst, updateParity, setPlayhead, applyTheme, savePNG, download, charts, niceCeil };
})(window);
