// file_name: ember.js
//
// "Уголёк" — живой индикатор состояния проекта.
// Один rAF-цикл: update() -> applyVariables() -> requestAnimationFrame.
// Все случайные эффекты идут через единый менеджер с приоритетом и
// лимитом в 2 одновременных эффекта (со взаимным вытеснением слотов).

const Ember = (() => {
  'use strict';

  const LIFE = 7 * 24 * 60 * 60 * 1000;
  const STORAGE_KEY = 'ember-state';
  const BROADCAST_KEY = 'ember-sync';

  // --- приоритет эффектов: меньше число = выше приоритет ---
  // typing и hover — не "события" из пула, а постоянные модификаторы,
  // они всегда применяются и ничего не вытесняют и не вытесняются.
  const PRIORITY = { sigh: 1, calmBurn: 2, wiggle: 3, tilt: 4, microShift: 5 };
  const MAX_EFFECTS = 2;

  let state = null;
  let root = null;
  let segments = [];
  let zones = [];
  let glowEl = null;
  let ringEl = null;
  let coreEl = null;

  let hover = false;
  let hoverVal = 0;

  let intensity = 1;

  // дыхание
  let breathPhase = 0;

  // блуждание горячей точки
  let heatOffsetX = 0, heatOffsetY = 0;
  let heatTargetX = 0, heatTargetY = 0;
  let nextHeatShift = 0;
  let heatPhase = 0;
  const heatPhaseSpeed = 0.0009;

  // реакция на печать
  let typedChars = 0;
  let heatBoost = 0;
  let resetTimer = null;

  // сегменты (часы активности)
  let prevRemaining = 12;

  // спавн при загрузке страницы
  let spawnStart = 0;

  // активные эффекты пула: Map<type, {phase, durMs, ...extra}>
  const active = new Map();
  let nextDue = {}; // type -> timestamp когда можно пробовать запустить снова

  let tiltCurrent = 0;
  let tiltTarget = 0;

  let channel = null;
  let rafId = null;
  let lastFrame = 0;

  // ---------- утилиты ----------

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function easeOutQuad(t) { return t * (2 - t); }
  function easeInQuad(t) { return t * t; }
  // плавный треугольный импульс 0->1->0 по фазе t∈[0,1]
  function bump(t, riseEnd, holdEnd) {
    if (t < riseEnd) return easeOutQuad(t / riseEnd);
    if (t < holdEnd) return 1;
    return 1 - easeInQuad((t - holdEnd) / (1 - holdEnd));
  }

  // ---------- состояние / синхронизация между вкладками ----------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.lastEditTime === 'number') return parsed;
      }
    } catch {}
    return { lastEditTime: Date.now() };
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  function broadcast() {
    try { channel && channel.postMessage({ type: 'update', state }); } catch {}
  }

  function setupBroadcast() {
    try {
      channel = new BroadcastChannel(BROADCAST_KEY);
      channel.onmessage = (e) => {
        if (e.data?.type === 'update' && e.data?.state) state = e.data.state;
      };
    } catch {}
  }

  function notifyEdit() {
    state.lastEditTime = Date.now();
    saveState();
    broadcast();
  }

  // ---------- расчёт жизни угля ----------

  function calcIntensity() {
    const age = Date.now() - state.lastEditTime;
    const t = clamp(age / LIFE, 0, 1);
    return Math.pow(1 - t, 1.7);
  }

  function hoursWithoutActivity() {
    return (Date.now() - state.lastEditTime) / 3_600_000;
  }

  function remainingSegments() {
    return clamp(12 - Math.floor(hoursWithoutActivity() / 2), 0, 12);
  }

  function isSleeping() {
    return hoursWithoutActivity() > 5 * 24;
  }

  // 1x обычный темп, до 2x медленнее в глубоком сне (5-7 дней)
  function sleepSlowdown() {
    if (!isSleeping()) return 1;
    const h = hoursWithoutActivity();
    const t = clamp((h - 5 * 24) / (2 * 24), 0, 1);
    return 1 + t; // 1 -> 2
  }

  // ---------- DOM ----------

  function createDOM() {
    root = document.createElement('div');
    root.className = 'ember';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', 'Индикатор состояния проекта');
    root.tabIndex = 0;

    ringEl = document.createElement('div');
    ringEl.className = 'ember-ring';
    for (let i = 0; i < 12; i++) {
      const seg = document.createElement('div');
      seg.className = 'segment';
      seg.style.setProperty('--i', i);
      ringEl.appendChild(seg);
      segments.push(seg);
    }

    coreEl = document.createElement('div');
    coreEl.className = 'ember-core';
    ['zone1', 'zone2', 'zone3'].forEach((cls) => {
      const z = document.createElement('div');
      z.className = `heat-zone ${cls}`;
      coreEl.appendChild(z);
      zones.push(z);
    });

    glowEl = document.createElement('div');
    glowEl.className = 'ember-glow';
    coreEl.appendChild(glowEl);

    root.appendChild(ringEl);
    root.appendChild(coreEl);
    return root;
  }

  // ---------- сегменты: каскадное появление ----------

  function applySegments() {
    const remaining = remainingSegments();

    if (remaining > prevRemaining) {
      // новая активность открыла дополнительные сегменты — зажигаем
      // их по очереди в окне 300-500мс, а не все мгновенно
      const added = remaining - prevRemaining;
      const totalWindow = clamp(300 + added * 20, 300, 500);
      const step = totalWindow / added;
      for (let i = prevRemaining; i < remaining; i++) {
        const delay = (i - prevRemaining) * step;
        segments[i].style.setProperty('--reveal-delay', delay.toFixed(0));
      }
    }

    segments.forEach((seg, i) => {
      seg.classList.toggle('active', i < remaining);
    });

    prevRemaining = remaining;
  }

  // ---------- блуждание тепловых зон ----------

  function updateHeatZones(dt) {
    if (Date.now() > nextHeatShift) {
      heatTargetX = rand(-3, 3);
      heatTargetY = rand(-3, 3);
      nextHeatShift = Date.now() + rand(2000, 4000);
    }
    heatOffsetX += (heatTargetX - heatOffsetX) * clamp(0.003 * dt, 0, 1);
    heatOffsetY += (heatTargetY - heatOffsetY) * clamp(0.003 * dt, 0, 1);
    heatPhase += heatPhaseSpeed * dt;

    const cxBase = 50 + heatOffsetX * 3;
    const cyBase = 50 + heatOffsetY * 3;
    // примерные опорные точки из задания: 30/35, 55/50, 45/70 — но они "блуждают"
    const wander = [
      { dx: -20, dy: -15, fx: 2.1, fy: 1.7 },
      { dx: 5, dy: 0, fx: 1.4, fy: 2.3 },
      { dx: -5, dy: 20, fx: 1.9, fy: 1.1 },
    ];
    zones.forEach((zone, i) => {
      const w = wander[i];
      const cx = cxBase + w.dx + Math.sin(heatPhase * w.fx + i) * 8;
      const cy = cyBase + w.dy + Math.cos(heatPhase * w.fy + i) * 8;
      zone.style.setProperty('--cx', clamp(cx, 15, 85).toFixed(1) + '%');
      zone.style.setProperty('--cy', clamp(cy, 15, 85).toFixed(1) + '%');
    });
  }

  // ---------- менеджер случайных эффектов (приоритет + вытеснение слотов) ----------

  function rescheduleDue(type) {
    const ranges = {
      calmBurn: [45, 90],
      sigh: [60, 120],
      wiggle: [45, 90],
      tilt: [60, 120],
      microShift: [60, 120],
    };
    const slow = sleepSlowdown();
    const [a, b] = ranges[type];
    nextDue[type] = Date.now() + rand(a, b) * 1000 * slow;
  }

  function tryStart(type, probability, durRangeMs, extra) {
    const now = Date.now();
    if (active.has(type)) return;
    if ((nextDue[type] ?? 0) > now) return;

    if (Math.random() >= probability) {
      rescheduleDue(type); // не повезло — не спамим проверку каждый кадр
      return;
    }

    if (active.size >= MAX_EFFECTS) {
      // вытесняем активный эффект с худшим (большим) приоритетом, если он есть
      let worstType = null, worstPriority = -1;
      for (const t of active.keys()) {
        if (PRIORITY[t] > worstPriority) { worstPriority = PRIORITY[t]; worstType = t; }
      }
      if (worstType === null || PRIORITY[worstType] <= PRIORITY[type]) {
        rescheduleDue(type);
        return;
      }
      active.delete(worstType);
      rescheduleDue(worstType);
    }

    active.set(type, { phase: 0, durMs: rand(durRangeMs[0], durRangeMs[1]), ...extra });
  }

  function advanceEffect(type, dt, onEnd) {
    const eff = active.get(type);
    if (!eff) return null;
    eff.phase = clamp(eff.phase + dt / eff.durMs, 0, 1);
    if (eff.phase >= 1) {
      active.delete(type);
      rescheduleDue(type);
      onEnd && onEnd();
      return null;
    }
    return eff;
  }

  // ---------- основной кадр ----------

  function update(now, dt) {
    intensity = calcIntensity();

    // спавн страницы: ядро -> свечение -> контур -> полное состояние
    const since = now - spawnStart;
    const spawnCore = clamp(since / 500, 0, 1);
    const spawnGlow = clamp((since - 400) / 500, 0, 1);
    const spawnRing = clamp((since - 800) / 600, 0, 1);

    // hover
    const hoverStep = clamp(dt / 300, 0, 1);
    hoverVal += hover ? (1 - hoverVal) * hoverStep : (0 - hoverVal) * hoverStep;

    // дыхание: быстрее при hover, тише при низкой intensity, медленнее во сне
    const speedMult = (1 + hoverVal * 0.8) / sleepSlowdown();
    const breathBase = intensity > 0.3 ? 0.0009 : 0.00035;
    breathPhase += breathBase * speedMult * dt;
    const hoverBreath = hover ? Math.sin(breathPhase * 2.5) * 0.05 * hoverVal : 0;
    const breathScale = 1 + Math.sin(breathPhase * 2.5) * 0.012 * intensity + hoverBreath;

    updateHeatZones(dt);

    if (heatBoost > 0) heatBoost = Math.max(0, heatBoost - 0.00025 * dt);

    // --- попытки запустить эффекты пула ---
    // приоритет проверок не важен (он важен при вытеснении слотов),
    // но порядок ниже соответствует приоритету: вздох > горение > поёживание > поворот > микросмещение
    tryStart('sigh', 0.35, [4000, 5000]);
    tryStart('calmBurn', 0.7, [2000, 3000]);
    if (intensity > 0.5) tryStart('wiggle', 0.2, [700, 1000]);
    tryStart('tilt', 0.15, [2000, 2000], { target: rand(-1, 1) });
    tryStart('microShift', 0.1, [1000, 2000], { dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) });

    const sigh = advanceEffect('sigh', dt);
    const calmBurn = advanceEffect('calmBurn', dt);
    const wiggle = advanceEffect('wiggle', dt);
    advanceEffect('tilt', dt, () => { tiltTarget = 0; });
    const tilt = active.get('tilt');
    const microShift = advanceEffect('microShift', dt);

    // --- композиция итоговых переменных ---

    // поёживание: scaleX/scaleY по контрольным точкам
    let scaleX = 1, scaleY = 1;
    if (wiggle) {
      const pts = [[1, 1], [0.98, 1.02], [1.01, 0.99], [1, 1]];
      const seg = wiggle.phase * (pts.length - 1);
      const i0 = Math.floor(seg), i1 = Math.min(i0 + 1, pts.length - 1);
      const lt = seg - i0;
      scaleX = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * lt;
      scaleY = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * lt;
    }

    // спокойное горение: scale 1->1.02->1, brightness +0.1
    const calmMult = calmBurn ? 1 + bump(calmBurn.phase, 0.3, 0.7) * 0.02 : 1;
    const calmBright = calmBurn ? bump(calmBurn.phase, 0.3, 0.7) * 0.1 : 0;

    // вздох: scale 1->1.015->1, brightness +0.06, glow +10%
    const sighMult = sigh ? 1 + bump(sigh.phase, 0.25, 0.75) * 0.015 : 1;
    const sighBright = sigh ? bump(sigh.phase, 0.25, 0.75) * 0.06 : 0;
    const sighGlow = sigh ? bump(sigh.phase, 0.25, 0.75) * 0.1 : 0;

    // поворот ±1°: 0 -> target -> 0 за время эффекта
    if (tilt) tiltTarget = tilt.target * (1 - Math.abs(2 * tilt.phase - 1));
    tiltCurrent += (tiltTarget - tiltCurrent) * clamp(0.08 * (dt / 16.7), 0, 1);

    // микросмещение: 0 -> ~0.5px -> 0
    const microShiftPx = microShift ? bump(microShift.phase, 0.5, 0.5) * (microShift.dx ?? 0.5) : 0;

    const finalScaleX = breathScale * scaleX * calmMult * sighMult;
    const finalScaleY = breathScale * scaleY * calmMult * sighMult;

    const heat = clamp(intensity + heatBoost * 0.25, 0, 1);
    const glow = clamp(intensity + heatBoost * 0.3 + sighGlow + hoverVal * 0.15, 0, 1.2);

    const brightness = clamp(
      0.7 + intensity * 0.3 + calmBright + sighBright + heatBoost * 0.4 + hoverVal * 0.15,
      0.35,
      1.5
    );

    const shiftX = heatOffsetX * 0.6 + microShiftPx;
    const shiftY = heatOffsetY * 0.6 - hoverVal * 0.5; // hover слегка приподнимает

    // --- запись переменных (только transform/opacity/filter-источники) ---
    root.style.setProperty('--heat', heat.toFixed(3));
    root.style.setProperty('--glow', glow.toFixed(3));
    root.style.setProperty('--intensity', intensity.toFixed(3));
    root.style.setProperty('--hover', hoverVal.toFixed(3));
    root.style.setProperty('--shiftX', shiftX.toFixed(2) + 'px');
    root.style.setProperty('--shiftY', shiftY.toFixed(2) + 'px');
    root.style.setProperty('--breathScale', breathScale.toFixed(4));
    root.style.setProperty('--rotation', tiltCurrent.toFixed(2) + 'deg');
    root.style.setProperty('--tiltX', (microShiftPx * 1.5).toFixed(2) + 'deg');
    root.style.setProperty('--tiltY', (tiltCurrent * 0.6).toFixed(2) + 'deg');

    root.style.setProperty('--scaleX', finalScaleX.toFixed(4));
    root.style.setProperty('--scaleY', finalScaleY.toFixed(4));
    root.style.setProperty('--brightness', brightness.toFixed(3));
    root.style.setProperty('--glowOpacity', (1 + hoverVal * 0.15).toFixed(3));
    root.style.setProperty('--glowBlur', (5 + hoverVal * 1.5).toFixed(2) + 'px');
    root.style.setProperty('--glowScale', (1 + hoverVal * 0.08).toFixed(3));
    root.style.setProperty('--ringOpacity', clamp(intensity * 0.6 + 0.4, 0, 1).toFixed(3));

    root.style.setProperty('--spawnCore', spawnCore.toFixed(3));
    root.style.setProperty('--spawnGlow', spawnGlow.toFixed(3));
    root.style.setProperty('--spawnRing', spawnRing.toFixed(3));

    applySegments();
  }

  function animate(timestamp) {
    if (!root) return;
    if (lastFrame === 0) lastFrame = timestamp;
    const dt = Math.min(timestamp - lastFrame, 50);
    lastFrame = timestamp;
    update(timestamp, dt);
    rafId = requestAnimationFrame(animate);
  }

  // ---------- реакция на печать ----------

  function handleInput() {
    typedChars++;
    heatBoost = Math.min(typedChars / 150, 0.25);
    notifyEdit();
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { typedChars = 0; }, 2000);
  }

  function setupEventListeners() {
    root.addEventListener('mouseenter', () => { hover = true; });
    root.addEventListener('mouseleave', () => { hover = false; });
    root.addEventListener('focus', () => { hover = true; });
    root.addEventListener('blur', () => { hover = false; });

    const isEditable = (el) =>
      el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);

    document.addEventListener('input', (e) => {
      if (isEditable(e.target)) handleInput();
    });
  }

  // ---------- инициализация ----------

  function init(mountEl) {
    state = loadState();
    createDOM();
    setupBroadcast();
    setupEventListeners();

    const container = mountEl || document.getElementById('ember-slot');
    if (container) container.appendChild(root);
    else document.body.appendChild(root);

    prevRemaining = remainingSegments();
    spawnStart = performance.now();
    lastFrame = 0;
    rafId = requestAnimationFrame(animate);
  }

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    if (channel) { try { channel.close(); } catch {} }
    clearTimeout(resetTimer);
  }

  // notifyEdit() — публичный метод, чтобы дёргать "уголёк" из кастомных
  // редакторов (contenteditable-блоки и т.п.), если автослушатель не подходит
  return { init, destroy, notifyEdit };
})();
