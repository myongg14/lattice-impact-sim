/* =====================================================================
 * viewer3d.js — Three.js 3D 구조 뷰어
 *   Gyroid : 삼중주기 최소곡면 sin x cos y + sin y cos z + sin z cos x = t
 *            (시트형: |f| ≤ t 인 얇은 벽, 상대밀도에 맞춰 t를 정함)
 *   Octet  : FCC 격자의 옥텟 트러스(지주 지름은 상대밀도로 계산)
 *   Honeycomb : 하중 방향(세로)으로 뻗은 정육각 벌집 벽
 * ===================================================================== */
(function (root) {
  'use strict';
  const NS = root.ImpactSim;
  let renderer, scene, camera, controls, group, canvas, running = false, needsBuild = true;
  let state = { key: 'gyroid', scope: 'whole', rho: 0.3, cellMm: 10, sizeMm: 60 };
  let lastKey = '';

  function init() {
    canvas = document.getElementById('viewer3d');
    if (typeof THREE === 'undefined') {
      document.getElementById('viewerMsg').textContent = '3D 라이브러리(Three.js)를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
      return false;
    }
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, 1, 2000);
    camera.position.set(120, 95, 140);
    controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.autoRotate = true; controls.autoRotateSpeed = 1.2;
    canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; });
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 0.75));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.75); d1.position.set(1, 2, 1.5); scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.3); d2.position.set(-1.5, -0.5, -1); scene.add(d2);
    group = new THREE.Group(); scene.add(group);
    applyTheme();
    return true;
  }

  function applyTheme() {
    if (!scene) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim();
    scene.background = new THREE.Color(bg || '#efeeea');
    needsBuild = true;
  }

  function set(p) { Object.assign(state, p); needsBuild = true; }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
  }

  function start() {
    if (!renderer || running) return;
    running = true;
    const loop = () => {
      if (!running) return;
      if (needsBuild) build();
      resize();
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  function stop() { running = false; }

  function clearGroup() {
    while (group.children.length) {
      const o = group.children.pop();
      o.traverse((m) => { if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
    }
  }

  function material(key) {
    const c = NS.colorOf(key) || '#888';
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(c), roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
  }

  /* 빌드: 지금 상태로 형상 다시 만들기 */
  function build() {
    needsBuild = false;
    clearGroup();
    const { key, scope, rho, cellMm, sizeMm } = state;
    // 단위셀 보기면 2×2×2 셀만, 전체면 시편 크기
    const n = Math.max(1, Math.round(sizeMm / cellMm));
    const a = scope === 'cell' ? cellMm : sizeMm / n;         // 실제 셀 크기(시편에 정수 개가 들어가도록 맞춤)
    const L = scope === 'cell' ? 2 * cellMm : sizeMm;
    let mesh, info;
    if (key === 'gyroid') ({ mesh, info } = buildGyroid(L, a, rho, scope));
    else if (key === 'octet') ({ mesh, info } = buildOctet(L, a, rho));
    else ({ mesh, info } = buildHoneycomb(L, a, rho));
    group.add(mesh);

    // 하중 방향 화살표 + 바닥판 윤곽
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, L / 2 + L * 0.45, 0), L * 0.32,
      new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim() || '#555'), L * 0.1, L * 0.06);
    group.add(arrow);
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, L, L)),
      new THREE.LineBasicMaterial({ color: new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim() || '#999'), transparent: true, opacity: 0.5 }));
    group.add(box);

    // 시점은 구조나 범위를 바꿨을 때만 다시 맞춤
    const camKey = key + scope;
    if (camKey !== lastKey) {
      const s = L / 60;
      camera.position.set(120 * s, 95 * s, 140 * s);
      controls.target.set(0, 0, 0);
      lastKey = camKey;
    }
    const g = NS.geometryInfo(key, rho, cellMm);
    const warn = g.thicknessMm < 0.4 ? ` · ⚠ ${g.label} ${g.thicknessMm.toFixed(2)}mm: 노즐(0.4mm)보다 얇아 출력이 어려워요` : '';
    document.getElementById('viewerMsg').textContent = `${info} · 드래그로 회전, 휠로 확대${warn}`;
    document.getElementById('viewerCap').textContent =
      `${label(key)} — 상대밀도 ${(rho * 100).toFixed(0)}%, 셀 ${cellMm}mm → ${g.label} 약 ${g.thicknessMm.toFixed(2)}mm` +
      (key === 'octet' ? `, 지주 길이 ${g.strutLengthMm.toFixed(2)}mm` : '') +
      `. 화살표는 충격체가 누르는 방향이에요.` + (scope === 'whole' && key === 'gyroid' ? ' (전체 보기에서는 자이로이드 벽의 중간면을 그려요. 실제 두께는 단위셀 보기에서 볼 수 있어요.)' : '');
  }
  const label = (k) => ({ gyroid: 'Gyroid', octet: 'Octet', honeycomb: 'Honeycomb' })[k];

  /* ---------------- Gyroid ---------------- */
  const gyr = (x, y, z) => Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);

  // 상대밀도 ρ가 되도록 시트 두께 t 찾기(|f| ≤ t 인 부피 비율 = ρ)
  let tCache = null;
  function sheetLevel(rho) {
    if (!tCache) {
      const N = 40, vals = [];
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
        const s = (2 * Math.PI) / N;
        vals.push(Math.abs(gyr((i + 0.5) * s, (j + 0.5) * s, (k + 0.5) * s)));
      }
      tCache = vals.sort((p, q) => p - q);
    }
    return tCache[Math.min(tCache.length - 1, Math.floor(rho * tCache.length))];
  }

  function buildGyroid(L, a, rho, scope) {
    const t = sheetLevel(rho);
    const w = (2 * Math.PI) / a;
    const periods = L / a;
    let field;
    if (scope === 'whole') {
      // 전체 보기: 중간면 f = 0 (가볍고 매끈함)
      const N = Math.min(110, Math.max(48, Math.round(periods * 14)));
      field = sampleField(N, L, (x, y, z) => gyr(w * x, w * y, w * z));
      const geo = surfaceNets(field, N, L, 0);
      return { mesh: new THREE.Mesh(geo, material('gyroid')), info: `Gyroid 중간면 (주기 ${a.toFixed(1)}mm × ${periods.toFixed(0)}개)` };
    }
    // 단위셀 보기: 진짜 두께가 있는 시트, 바깥 경계는 막아서 단면이 보이게
    const N = 96;
    const capScale = w * 0.9;
    field = sampleField(N, L, (x, y, z) => {
      const s = t - Math.abs(gyr(w * x, w * y, w * z));
      const d = Math.min(L / 2 - Math.abs(x), L / 2 - Math.abs(y), L / 2 - Math.abs(z)) * capScale;
      return Math.min(s, d);
    }, 1.04);
    const geo = surfaceNets(field, N, L * 1.04, 0);
    return { mesh: new THREE.Mesh(geo, material('gyroid')), info: `Gyroid 시트 (등위값 t = ${t.toFixed(3)})` };
  }

  function sampleField(N, L, fn, pad = 1) {
    const f = new Float32Array(N * N * N);
    const h = (L * pad) / (N - 1), o = -(L * pad) / 2;
    let p = 0;
    for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) f[p++] = fn(o + i * h, o + k * h, o + j * h);
    return f;
  }

  /* Surface Nets: 부호가 바뀌는 칸마다 꼭짓점 하나, 부호가 바뀌는 모서리마다 사각형 하나 */
  function surfaceNets(f, N, L, iso) {
    const h = L / (N - 1), o = -L / 2;
    const idx = (i, j, k) => i + N * (j + N * k);
    const cellId = new Int32Array((N - 1) ** 3).fill(-1);
    const cid = (i, j, k) => i + (N - 1) * (j + (N - 1) * k);
    const pos = [];
    const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const v = new Float32Array(8);
    for (let k = 0; k < N - 1; k++) for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const cc = corners[c];
        v[c] = f[idx(i + cc[0], j + cc[1], k + cc[2])] - iso;
        if (v[c] > 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (const [a, b] of edges) {
        if ((v[a] > 0) === (v[b] > 0)) continue;
        const u = v[a] / (v[a] - v[b]);
        const A = corners[a], B = corners[b];
        sx += A[0] + (B[0] - A[0]) * u; sy += A[1] + (B[1] - A[1]) * u; sz += A[2] + (B[2] - A[2]) * u; cnt++;
      }
      cellId[cid(i, j, k)] = pos.length / 3;
      // 격자 (i,j,k) → 화면 좌표: x=i, 높이(y)=k, 깊이(z)=j  (sampleField와 같은 배치)
      pos.push(o + (i + sx / cnt) * h, o + (k + sz / cnt) * h, o + (j + sy / cnt) * h);
    }
    const indices = [];
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) indices.push(a, c, b, a, d, c); else indices.push(a, b, c, a, c, d);
    };
    for (let k = 1; k < N - 1; k++) for (let j = 1; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      // x 방향 모서리
      const p0 = f[idx(i, j, k)] > iso, p1 = f[idx(i + 1, j, k)] > iso;
      if (p0 !== p1) quad(cellId[cid(i, j - 1, k - 1)], cellId[cid(i, j, k - 1)], cellId[cid(i, j, k)], cellId[cid(i, j - 1, k)], p0);
    }
    for (let k = 1; k < N - 1; k++) for (let j = 0; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const p0 = f[idx(i, j, k)] > iso, p1 = f[idx(i, j + 1, k)] > iso;
      if (p0 !== p1) quad(cellId[cid(i - 1, j, k - 1)], cellId[cid(i - 1, j, k)], cellId[cid(i, j, k)], cellId[cid(i, j, k - 1)], p0);
    }
    for (let k = 0; k < N - 1; k++) for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const p0 = f[idx(i, j, k)] > iso, p1 = f[idx(i, j, k + 1)] > iso;
      if (p0 !== p1) quad(cellId[cid(i - 1, j - 1, k)], cellId[cid(i, j - 1, k)], cellId[cid(i, j, k)], cellId[cid(i - 1, j, k)], p0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /* ---------------- Octet 트러스 ---------------- */
  function buildOctet(L, a, rho) {
    const n = Math.max(1, Math.round(L / a));
    const g = NS.geometryInfo('octet', rho, a);
    const r = g.thicknessMm / 2;
    const o = -L / 2;
    const seen = new Set(), segs = [];
    const key = (p) => p.map((v) => Math.round(v * 100)).join(',');
    const add = (p, q) => {
      const k1 = key(p), k2 = key(q), k = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
      if (seen.has(k)) return; seen.add(k); segs.push([p, q]);
    };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      const c = (x, y, z) => [o + (i + x) * a, o + (j + y) * a, o + (k + z) * a];
      // 6개 면 중심
      const faces = [c(0.5, 0.5, 0), c(0.5, 0.5, 1), c(0.5, 0, 0.5), c(0.5, 1, 0.5), c(0, 0.5, 0.5), c(1, 0.5, 0.5)];
      const faceCorners = [
        [c(0, 0, 0), c(1, 0, 0), c(1, 1, 0), c(0, 1, 0)], [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
        [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], [c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)],
        [c(0, 0, 0), c(0, 1, 0), c(0, 1, 1), c(0, 0, 1)], [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
      ];
      faces.forEach((f, fi) => faceCorners[fi].forEach((p) => add(f, p)));  // 면 대각선(사면체 쪽)
      // 면 중심끼리: 팔면체 모서리 (서로 마주 보지 않는 면끼리)
      for (let p = 0; p < 6; p++) for (let q = p + 1; q < 6; q++) {
        if (Math.floor(p / 2) === Math.floor(q / 2)) continue;
        add(faces[p], faces[q]);
      }
    }
    const cyl = new THREE.CylinderGeometry(r, r, 1, 8, 1, false);
    const mesh = new THREE.InstancedMesh(cyl, material('octet'), segs.length);
    const m = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), qn = new THREE.Quaternion();
    segs.forEach(([p, q], i) => {
      // 시뮬레이션의 z(세로)를 화면의 y로
      const P = new THREE.Vector3(p[0], p[2], p[1]), Q = new THREE.Vector3(q[0], q[2], q[1]);
      const d = Q.clone().sub(P), len = d.length();
      qn.setFromUnitVectors(up, d.normalize());
      m.compose(P.clone().add(Q).multiplyScalar(0.5), qn, new THREE.Vector3(1, len, 1));
      mesh.setMatrixAt(i, m);
    });
    // 마디(노드) 구
    const grp = new THREE.Group(); grp.add(mesh);
    const nodes = new Map();
    segs.forEach(([p, q]) => { nodes.set(key(p), p); nodes.set(key(q), q); });
    const sph = new THREE.InstancedMesh(new THREE.SphereGeometry(r * 1.25, 10, 8), material('octet'), nodes.size);
    let ni = 0;
    nodes.forEach((p) => { m.makeTranslation(p[0], p[2], p[1]); sph.setMatrixAt(ni++, m); });
    grp.add(sph);
    return { mesh: grp, info: `Octet 트러스 (지주 ${segs.length}개, 지름 ${(2 * r).toFixed(2)}mm)` };
  }

  /* ---------------- Honeycomb ---------------- */
  function buildHoneycomb(L, D, rho) {
    // D = 맞변 거리(셀 크기), 변 길이 s = D/√3, 벽 두께 t = ρ·D/2
    const s = D / Math.sqrt(3), t = (rho * D) / 2, half = L / 2;
    const segs = [], seen = new Set();
    const key = (x, y) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
    const cols = Math.ceil(L / (1.5 * s)) + 2, rows = Math.ceil(L / D) + 2;
    for (let ci = -cols; ci <= cols; ci++) for (let ri = -rows; ri <= rows; ri++) {
      const cx = ci * 1.5 * s, cy = ri * D + (ci & 1 ? D / 2 : 0);
      if (Math.abs(cx) > half + 2 * s || Math.abs(cy) > half + D) continue;
      for (let e = 0; e < 6; e++) {
        const a0 = (Math.PI / 3) * e, a1 = (Math.PI / 3) * (e + 1);
        let x0 = cx + s * Math.cos(a0), y0 = cy + s * Math.sin(a0), x1 = cx + s * Math.cos(a1), y1 = cy + s * Math.sin(a1);
        const k1 = key(x0, y0), k2 = key(x1, y1), k = k1 < k2 ? k1 + k2 : k2 + k1;
        if (seen.has(k)) continue; seen.add(k);
        const c = clipSeg(x0, y0, x1, y1, -half, half);
        if (c) segs.push(c);
      }
    }
    // 바깥 둘레 벽(실제 출력에서 테두리가 생김)
    segs.push([-half, -half, half, -half], [half, -half, half, half], [half, half, -half, half], [-half, half, -half, -half]);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(box, material('honeycomb'), segs.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    segs.forEach(([x0, y0, x1, y1], i) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      q.setFromAxisAngle(up, -Math.atan2(y1 - y0, x1 - x0));
      m.compose(new THREE.Vector3((x0 + x1) / 2, 0, (y0 + y1) / 2), q, new THREE.Vector3(len + t, L, t));
      mesh.setMatrixAt(i, m);
    });
    return { mesh, info: `Honeycomb (셀 ${D}mm, 벽 두께 ${t.toFixed(2)}mm, 세로 방향 벽)` };
  }

  // 선분을 정사각형 [lo,hi]² 안으로 자르기 (Liang–Barsky)
  function clipSeg(x0, y0, x1, y1, lo, hi) {
    let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
    const p = [-dx, dx, -dy, dy], q = [x0 - lo, hi - x0, y0 - lo, hi - y0];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; continue; }
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    if (t1 - t0 < 1e-6) return null;
    return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
  }

  NS.Viewer = { init, set, start, stop, applyTheme, canvas: () => canvas };
})(window);
