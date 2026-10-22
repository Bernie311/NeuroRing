/* Optical instruments share the scene clock. Decorative signals never enter live metrics. */
(() => {
  'use strict';
const nrColor = globalThis.NeuroTheme?.color || (value => value);
  const root = document.querySelector('.instruments');
  if (!root) return;
  const TAU = Math.PI * 2;
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const fract = n => n - Math.floor(n);
  const rand = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
  const safe = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = value => new Date(value * 1000).toLocaleTimeString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false});
  const shades = Array.from({length:16}, (_, i) => nrColor(`rgba(237,236,213,${(.06 + i * .058).toFixed(3)})`));
  const panels = ['particle-field', 'waveform-field', 'activation-field'].map(id => {
    const element = document.getElementById(id);
    return {element, ctx:element.getContext('2d', {alpha:false}), width:0, height:0, ratio:1};
  });
  const particles = Array.from({length:148}, (_, i) => ({
    x:rand(i + 1), y:rand(i + 201), phase:rand(i + 401) * TAU,
    speed:.025 + rand(i + 601) * .025, size:rand(i + 801),
  }));
  let dirty = true, lastClock = 0, lastPaint = -Infinity, lastPaintAt = -Infinity, lastLogKey = null;
  let logBorn = -Infinity, lastStale = false, liveLogRows = [];

  function resize(panel) {
    const box = panel.element.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
    if (panel.width === box.width && panel.height === box.height && panel.ratio === ratio) return;
    panel.width = box.width; panel.height = box.height; panel.ratio = ratio;
    panel.element.width = Math.max(1, Math.round(box.width * ratio));
    panel.element.height = Math.max(1, Math.round(box.height * ratio));
    dirty = true;
  }
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) { const panel = panels.find(p => p.element === entry.target); if (panel) resize(panel); }
  });
  panels.forEach(panel => { resize(panel); observer.observe(panel.element); });

  function begin(panel) {
    const p = panel.ctx;
    p.setTransform(panel.ratio, 0, 0, panel.ratio, 0, 0);
    p.globalAlpha = 1; p.fillStyle = nrColor('#060708'); p.fillRect(0, 0, panel.width, panel.height);
    return p;
  }
  function noise(x, seed) {
    const cell = Math.floor(x), fraction = fract(x), smooth = fraction * fraction * (3 - 2 * fraction);
    return rand(cell + seed) * (1 - smooth) + rand(cell + seed + 1) * smooth;
  }
  function wave(x, seed) {
    return (noise(x, seed) - .5) * .64 + (noise(x * 2.27, seed + 173) - .5) * .27 + (noise(x * 5.19, seed + 417) - .5) * .09;
  }
  function particleField(panel, at) {
    const p = begin(panel), w = panel.width, h = panel.height, top = 5, fieldHeight = Math.max(8, h - 18);
    p.strokeStyle = nrColor('#77786a22'); p.lineWidth = .5;
    for (let y = 14; y < fieldHeight; y += 21) { p.beginPath(); p.moveTo(10, y); p.lineTo(w - 10, y); p.stroke(); }
    for (const point of particles) {
      const x = 12 + fract(point.x + Math.sin(at * point.speed + point.phase) * .027) * Math.max(1, w - 24);
      const y = top + (point.y * .8 + .10 + Math.sin(at * .16 + point.phase) * .07) * fieldHeight;
      const depth = .38 + .62 * (.5 + .5 * Math.sin(point.phase + at * .11));
      p.fillStyle = shades[Math.round(depth * 12)];
      const size = point.size > .9 ? 1.65 : point.size > .42 ? 1.1 : .65;
      p.fillRect(x, y, size, size);
      if (point.size > .86) { p.fillStyle = nrColor('#e5e2c81c'); p.fillRect(x - 2.5, y - .5, 5, .5); }
    }
    const stripY = h - 7;
    p.fillStyle = nrColor('#34362f'); p.fillRect(12, stripY, Math.max(1, w - 24), 2);
    const segment = Math.max(10, w * .16), x = 12 + fract(at * .042) * Math.max(1, w - 24 + segment) - segment;
    p.save(); p.beginPath(); p.rect(12, stripY - 1, Math.max(1, w - 24), 4); p.clip();
    p.fillStyle = nrColor('#bcbda797'); p.fillRect(x, stripY, segment, 2); p.restore();
  }
  function waveformField(panel, at) {
    const p = begin(panel), w = panel.width, h = panel.height, left = Math.min(43, w * .2), right = w - 12;
    const labels = ['PATH', 'PHASE', 'DECAY'];
    p.font = '7px Consolas, monospace';
    for (let row = 0; row < 3; row++) {
      const y = h * (.18 + row * .31), amplitude = Math.min(23, h * .25), phase = at * (.95 + row * .19);
      p.fillStyle = nrColor('#aaa991'); p.fillText(labels[row], 12, y + 3);
      p.strokeStyle = nrColor('#85867021'); p.lineWidth = .5; p.beginPath(); p.moveTo(left, y); p.lineTo(right, y); p.stroke();
      p.beginPath();
      for (let x = left; x <= right; x += 1.75) {
        const value = wave((x - left) / 16 + phase, 71 + row * 347);
        const py = y + value * amplitude;
        if (x === left) p.moveTo(x, py); else p.lineTo(x, py);
      }
      p.lineWidth = 3; p.strokeStyle = nrColor('#e8e6c919'); p.stroke();
      p.lineWidth = 1.05; p.strokeStyle = row === 1 ? nrColor('#c7bca8') : nrColor('#d6d9bf'); p.stroke();
    }
  }
  function activationField(panel, at) {
    const p = begin(panel), w = panel.width, h = panel.height;
    const cols = Math.min(150, Math.max(18, Math.floor((w - 24) / 4.5))), rows = Math.max(10, Math.floor((h - 21) / 3.8));
    const stepX = Math.max(1, (w - 24) / cols), stepY = Math.max(1, (h - 21) / rows);
    const ox = .48 + Math.sin(at * .20) * .25, oy = .46 + Math.cos(at * .16) * .18;
    const buckets = Array.from({length:16}, () => []);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const nx = x / cols, ny = y / rows;
      const well = Math.exp(-((nx - ox) ** 2 * 50 + (ny - oy) ** 2 * 24));
      const ripple = Math.sin(nx * 12 + ny * 5 - at * 1.1) * .08;
      const value = clamp(.73 + ripple - well * .65 + (rand(x * 91 + y + 1) - .5) * .12);
      buckets[Math.round(value * 15)].push([12 + x * stepX, 4 + y * stepY]);
    }
    buckets.forEach((cells, level) => { p.fillStyle = shades[level]; for (const [x,y] of cells) p.fillRect(x, y, Math.max(.8, stepX - 1.5), Math.max(.8, stepY - 1.5)); });
    const base = h - 4;
    for (let i = 0; i < 44; i++) {
      const value = .18 + .7 * Math.abs(wave(i * .48 + at * .83, 903));
      p.fillStyle = nrColor('#cfceaf9e');
      p.fillRect(12 + i / 44 * Math.max(1, w - 24), base - value * 12, Math.max(1, (w - 24) / 44 - 1.4), value * 12);
    }
  }
  function update({data, visible = []} = {}) {
    if (!data) return;
    const ids = new Set(visible.map(thread => thread.id));
    const events = (data.events || []).filter(event => ids.has(event.threadId)).slice(0, 6);
    const key = events.map(event => [event.at, event.threadId, event.kind, event.label].join('|')).join('\n');
    if (key !== lastLogKey) {
      const initial = lastLogKey === null;
      lastLogKey = key;
      const log = document.getElementById('instrument-log');
      log.innerHTML = events.length ? events.map((event, index) => `<div class="instrument-log-row" title="${safe(event.threadName)}"><span class="line-no">${String(index + 1).padStart(3,'0')}</span><time>${safe(stamp(event.at))}</time><span class="log-label">${safe(event.label)}</span></div>`).join('') : '<div class="instrument-empty">当前筛选暂无已观测事件</div>';
      liveLogRows = [...log.querySelectorAll('.instrument-log-row')];
      logBorn = initial ? -Infinity : lastClock;
      dirty = true;
    }
    root.dataset.records = String(visible.length);
  }
  function draw({clock = 0, paused = false, stale = false, now = performance.now()} = {}) {
    if (!Number.isFinite(clock)) return;
    lastClock = clock;
    root.dataset.paused = String(paused);
    if (stale !== lastStale) { lastStale = stale; dirty = true; }
    // A single shared clock gives pause, speed, and reduced-motion identical semantics to the ring.
    if (!dirty && (clock === lastPaint || (!paused && now - lastPaintAt < 1000 / 30))) return;
    lastPaint = clock; lastPaintAt = now; dirty = false;
    particleField(panels[0], clock);
    waveformField(panels[1], clock);
    activationField(panels[2], clock);
    root.dataset.motionTime = clock.toFixed(3);
    root.dataset.paused = String(paused);
    root.dataset.stale = String(stale);
    if (liveLogRows[0]) liveLogRows[0].style.backgroundColor = nrColor(`rgba(221,218,188,${(clamp(1 - (clock - logBorn) / 1.7) * .09).toFixed(3)})`);
  }
  window.NeuroInstruments = {update, draw, invalidate() {dirty = true;}, destroy() {observer.disconnect();}};
})();
