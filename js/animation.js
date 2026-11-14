/* =====================================================================
 * animation.js — 충돌 슬로모션 (세 구조 나란히, 그래프 시점과 동기화)
 * ===================================================================== */
(function (root) {
  'use strict';
  const NS = root.ImpactSim;
  const KEYS = NS.STRUCT_KEYS;
  const LABEL = { gyroid: 'Gyroid', octet: 'Octet', honeycomb: 'Honeycomb' };

  let canvas, ctx, results = null, params = null;
  let playing = false, tSim = -1, lastFrame = 0, onTime = null;
  let tFall = 0.2, tWin = 0.003, exag = 1;
  const FALL_SLOW = 4; // 낙하 구간은 실제 속도의 1/4

  function init(cb) {
    canvas = document.getElementById('animCanvas');
    ctx = canvas.getContext('2d');
    onTime = cb;
    document.getElementById('animPlay').addEventListener('click', toggle);
    document.getElementById('animScrub').addEventListener('input', (e) => {
      pause();
      tSim = (e.target.value / 1000) * tWin;
      draw();
    });
    document.getElementById('animExag').addEventListener('change', () => { computeExag(); draw(); });
    window.addEventListener('resize', () => draw());
  }

  function setResults(r, p) {
    results = r; params = p;
    tFall = Math.sqrt((2 * p.heightCm / 100) / 9.81);
    tWin = Math.max(...KEYS.map((k) => r[k].tEndPulse)) * 1.4 + 0.0002;
    tWin = Math.min(tWin, Math.max(...KEYS.map((k) => r[k].raw.t[r[k].raw.t.length - 1])));
    computeExag();
    if (!playing) tSim = tSim < 0 ? -tFall : Math.min(tSim, tWin); // 처음에는 충격체가 떨어지기 전 모습
    draw();
  }

  function computeExag() {
    const sel = document.getElementById('animExag').value;
    if (sel !== 'auto') { exag = +sel; return; }
    if (!results) return;
    const maxStrain = Math.max(...KEYS.map((k) => results[k].epsMax));
    let e = 0.3 / Math.max(maxStrain, 1e-4);
    const nice = [1, 2, 5, 10, 20, 50, 100];
    exag = nice.filter((n) => n <= Math.max(1, e)).pop() || 1;
  }

  function toggle() { playing ? pause() : play(); }
  function play() {
    if (!results) return;
    if (tSim >= tWin - 1e-9) tSim = -tFall; // 끝났으면 처음(낙하)부터
    playing = true; lastFrame = performance.now();
    document.getElementById('animPlay').textContent = '❚❚ 일시정지';
    requestAnimationFrame(frame);
  }
  function pause() {
    playing = false;
    document.getElementById('animPlay').textContent = '▶ 재생';
  }

  function frame(now) {
    if (!playing) return;
    const dtReal = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
    const slow = +document.getElementById('animSpeed').value;
    if (tSim < 0) tSim = Math.min(0, tSim + dtReal / FALL_SLOW); // 낙하 구간이 끝나면 충돌 순간(0)에서 멈춰 슬로모션으로 넘어감
    else tSim += dtReal / slow;
    if (tSim >= tWin) { tSim = tWin; pause(); }
    draw();
    if (playing) requestAnimationFrame(frame);
  }

  /* 원시 기록에서 시간 t의 값 보간 */
  function at(r, arr, t) {
    const T = r.raw.t;
    if (t <= 0) return arr[0];
    if (t >= T[T.length - 1]) return arr[arr.length - 1];
    let lo = 0, hi = T.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    const u = (t - T[lo]) / (T[hi] - T[lo]);
    return arr[lo] + (arr[hi] - arr[lo]) * u;
  }

  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  function draw() {
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!results) return;

    const ink = css('--ink'), ink2 = css('--ink-2'), ink3 = css('--ink-3'), surf = css('--surface'), border = css('--border');
    const fs = parseFloat(css('--fs')) || 16;
    const colW = W / 3;
    const ground = H - 58;
    const lcH = 34, bpH = 10, tpH = 8, impH = 46;
    const Lmm = params.sizeMm;
    // 시편 높이(px): 낙하 높이까지 그릴 공간을 남기고 정함
    const Lpx = Math.min(120, (ground - lcH - bpH - tpH - impH - 60) * 0.42);
    const pxPerMm = Lpx / Lmm;
    const fallSpace = ground - lcH - bpH - Lpx - tpH - impH - 34;
    const dropPx = Math.min(fallSpace, params.heightCm * 10 * pxPerMm);
    const peakMax = Math.max(...KEYS.map((k) => results[k].peakRaw));

    KEYS.forEach((k, ci) => {
      const r = results[k], color = css('--c-' + k);
      const cx = ci * colW + colW / 2;
      const w = Math.min(colW * 0.5, 150);
      const t = Math.max(0, tSim);
      const x1 = at(r, r.raw.x1, t), x2 = at(r, r.raw.x2, t), x3 = at(r, r.raw.x3, t);
      const eps = Math.max(0, at(r, r.raw.eps, t));
      const F = tSim < 0 ? 0 : at(r, r.raw.Fl, t);
      const s = 1000 * pxPerMm * exag; // m → px (확대 포함)

      // 로드셀
      ctx.fillStyle = border;
      roundRect(cx - w * 0.35, ground - lcH, w * 0.7, lcH, 4); ctx.fill();
      ctx.fillStyle = ink2; ctx.font = `${fs * 0.7}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('로드셀', cx, ground - lcH / 2);
      // 바닥
      ctx.strokeStyle = ink3; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ci * colW + 12, ground); ctx.lineTo((ci + 1) * colW - 12, ground); ctx.stroke();

      // 하판(로드셀이 눌린 만큼 내려감)
      const bpTop = ground - lcH - bpH + x3 * s;
      ctx.fillStyle = ink3; roundRect(cx - w * 0.6, bpTop, w * 1.2, bpH, 2); ctx.fill();
      // 시편
      const specH = Math.max(2, Lpx * (1 - eps * exag));
      const specTop = bpTop - specH;
      drawSpecimen(k, cx - w / 2, specTop, w, specH, Lpx, color, surf, eps, r.props);
      // 상판
      const tpTop = specTop - tpH;
      ctx.fillStyle = ink3; roundRect(cx - w * 0.6, tpTop, w * 1.2, tpH, 2); ctx.fill();
      // 충격체
      let impBottom;
      if (tSim < 0) impBottom = tpTop - dropPx * (tSim * tSim) / (tFall * tFall);
      else impBottom = tpTop - Math.max(0, (x2 - x1)) * s;
      ctx.fillStyle = ink; roundRect(cx - w * 0.32, impBottom - impH, w * 0.64, impH, 6); ctx.fill();
      ctx.fillStyle = surf; ctx.font = `600 ${fs * 0.72}px system-ui, sans-serif`;
      ctx.fillText(`${params.massG} g`, cx, impBottom - impH / 2);

      // 힘 막대(오른쪽)
      const gx = cx + w * 0.75, gTop = 60, gH = ground - lcH - 70;
      ctx.fillStyle = border; ctx.fillRect(gx, gTop, 10, gH);
      const fh = gH * Math.max(0, F) / peakMax;
      ctx.fillStyle = color; ctx.fillRect(gx, gTop + gH - fh, 10, fh);

      // 이름과 현재 힘
      ctx.fillStyle = ink; ctx.font = `700 ${fs * 0.95}px system-ui, sans-serif`; ctx.textBaseline = 'alphabetic';
      ctx.fillText(LABEL[k], cx, 46);
      ctx.fillStyle = ink2; ctx.font = `${fs * 0.8}px system-ui, sans-serif`;
      ctx.fillText(`힘 ${(Math.max(0, F) / 1000).toFixed(2)} kN · 변형 ${(eps * Lmm).toFixed(2)} mm`, cx, H - 32);
      ctx.fillStyle = ink3; ctx.font = `${fs * 0.72}px system-ui, sans-serif`;
      ctx.fillText(`최대 ${(r.peak / 1000).toFixed(2)} kN`, cx, H - 12);
    });

    // 위쪽 안내
    ctx.fillStyle = ink3; ctx.font = `${fs * 0.72}px system-ui, sans-serif`; ctx.textAlign = 'left';
    const phase = tSim < 0 ? `낙하 중 (실제의 1/${FALL_SLOW} 속도, 높이는 축소해서 그림)` : `충돌 (1/${document.getElementById('animSpeed').value}배 슬로모션)`;
    ctx.textBaseline = 'top';
    ctx.fillText(`${phase} · 변형 ×${exag} 확대 · 오른쪽 막대 = 로드셀 힘`, 10, 8);

    // 시간 표시·동기화
    document.getElementById('animTime').textContent = tSim < 0 ? `t = ${(tSim * 1000).toFixed(1)} ms (충돌 전)` : `t = ${(tSim * 1000).toFixed(3)} ms`;
    if (tSim >= 0) document.getElementById('animScrub').value = Math.round((tSim / tWin) * 1000);
    if (onTime) onTime(tSim >= 0 ? tSim * 1000 : null);
  }

  /* 구조별 무늬. 눌린 만큼 세로로 납작하게 그림 */
  function drawSpecimen(k, x, y, w, h, h0, color, surf, eps, P) {
    ctx.save();
    ctx.fillStyle = color; ctx.globalAlpha = 0.18; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    const sy = h / h0; // 세로 압축 비율
    const cells = 6, c = w / cells;
    const buck = eps > P.epsY ? Math.min(1, (eps - P.epsY) / 0.05) : 0; // 좌굴 정도
    if (k === 'gyroid') {
      for (let r = 0; r <= cells; r++) {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const xx = x + (w * i) / 60;
          const yy = y + (r * c + Math.sin((i / 60) * cells * 2 * Math.PI + r) * c * 0.35) * sy;
          i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        }
        ctx.stroke();
      }
    } else if (k === 'octet') {
      const rows = Math.round(h0 / c);
      for (let r = 0; r < rows; r++) for (let i = 0; i < cells; i++) {
        const x0 = x + i * c, y0 = y + r * c * sy, y1 = y + (r + 1) * c * sy;
        const bow = buck * c * 0.15;
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + c / 2 + bow, (y0 + y1) / 2, x0 + c, y1);
        ctx.moveTo(x0 + c, y0); ctx.quadraticCurveTo(x0 + c / 2 - bow, (y0 + y1) / 2, x0, y1);
        ctx.moveTo(x0, y0); ctx.lineTo(x0 + c, y0);
        ctx.stroke();
      }
    } else {
      // 세로 벽: 좌굴하면 물결 모양으로 접힘
      for (let i = 0; i <= cells; i++) {
        ctx.beginPath();
        for (let j = 0; j <= 40; j++) {
          const yy = y + (h * j) / 40;
          const xx = x + i * c + Math.sin((j / 40) * Math.PI * 8) * c * 0.25 * buck * (i % 2 ? 1 : -1);
          j ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  NS.Anim = { init, setResults, draw, pause };
})(window);
