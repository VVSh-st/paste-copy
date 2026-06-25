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
  const PRIORITY = {
    sigh: 1, calmBurn: 2, wiggle: 3, tilt: 4, microShift: 5,
  };
  const MAX_EFFECTS = 3;

  // сегментные эффекты — отдельный пул, не конфликтует с ядром

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
  let nextDue = {};

  let tiltCurrent = 0;
  let tiltTarget = 0;

  // --- сегментные эффекты ---
  // Каждый сегментный эффект — это {type, segIdx, phase, durMs}
  let segmentEffects = [];
  let nextSegDue = {};

  let channel = null;
  let rafId = null;
  let lastFrame = 0;

  // ---------- утилиты ----------

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function easeOutQuad(t) { return t * (2 - t); }
  function easeInQuad(t) { return t * t; }
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

  function sleepSlowdown() {
    if (!isSleeping()) return 1;
    const h = hoursWithoutActivity();
    const t = clamp((h - 5 * 24) / (2 * 24), 0, 1);
    return 1 + t;
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

  // ---------- менеджер случайных эффектов (ядро) ----------

  function rescheduleDue(type) {
    const ranges = {
      calmBurn: [15, 30],
      sigh: [20, 40],
      wiggle: [15, 30],
      tilt: [20, 40],
      microShift: [20, 40],
      crackle: [30, 60],      // 30–60с
      stretch: [40, 80],      // 40–80с
      glint: [50, 90],        // 50–90с
      sleepySag: [60, 120],   // 60–120с
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
      rescheduleDue(type);
      return;
    }

    if (active.size >= MAX_EFFECTS) {
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

  // ---------- менеджер сегментных эффектов ----------

  function rescheduleSegDue(type) {
    const ranges = {
      segTremor: [15, 30],       // 15–30с
      segTryIgnite: [20, 40],    // 20–40с
      segHeatRipple: [30, 50],   // 30–50с
      segFlicker: [10, 25],      // 10–25с
      segHeatWave: [25, 45],     // 25–45с
    };
    const slow = sleepSlowdown();
    const [a, b] = ranges[type];
    nextSegDue[type] = Date.now() + rand(a, b) * 1000 * slow;
  }

  function getActiveSegIndices() {
    const rem = remainingSegments();
    const arr = [];
    for (let i = 0; i < rem; i++) arr.push(i);
    return arr;
  }

  function getOffSegIndices() {
    const rem = remainingSegments();
    const arr = [];
    for (let i = rem; i < 12; i++) arr.push(i);
    return arr;
  }

  function tryStartSeg(type, probability, durRangeMs, pickSeg) {
    const now = Date.now();
    if (segmentEffects.some(e => e.type === type)) return;
    if ((nextSegDue[type] ?? 0) > now) return;

    if (Math.random() >= probability) {
      rescheduleSegDue(type);
      return;
    }

    const segIdx = pickSeg();
    if (segIdx === null || segIdx === undefined) {
      rescheduleSegDue(type);
      return;
    }

    segmentEffects.push({
      type, segIdx,
      phase: 0,
      durMs: rand(durRangeMs[0], durRangeMs[1]),
    });
  }

  function advanceSegEffects(dt) {
    for (let i = segmentEffects.length - 1; i >= 0; i--) {
      const e = segmentEffects[i];
      e.phase = clamp(e.phase + dt / e.durMs, 0, 1);
      if (e.phase >= 1) {
        segmentEffects.splice(i, 1);
        rescheduleSegDue(e.type);
      }
    }
  }

  function applySegEffects() {
    // сброс всех стилей сегментов
    segments.forEach(seg => {
      seg.style.removeProperty('--seg-tilt');
      seg.style.removeProperty('--seg-flash');
      seg.style.removeProperty('--seg-dim');
      seg.style.removeProperty('--seg-brightness');
    });

    for (const e of segmentEffects) {
      const seg = segments[e.segIdx];
      if (!seg) continue;

      switch (e.type) {
        case 'segTremor': {
          // дрожание: ±3° за 300-500мс
          const tilt = Math.sin(e.phase * Math.PI) * 3;
          seg.style.setProperty('--seg-tilt', tilt.toFixed(2) + 'deg');
          break;
        }
        case 'segTryIgnite': {
          // попытка зажечься: вспышка и затухание
          const flash = e.phase < 0.3
            ? easeOutQuad(e.phase / 0.3)
            : 1 - easeInQuad((e.phase - 0.3) / 0.7);
          seg.style.setProperty('--seg-flash', flash.toFixed(3));
          break;
        }
        case 'segHeatRipple': {
          // тепловая рябь: волна яркости
          const wave = Math.sin(e.phase * Math.PI);
          seg.style.setProperty('--seg-brightness', (1 + wave * 0.6).toFixed(3));
          break;
        }
        case 'segFlicker': {
          // мерцание: быстрое затухание-вспышка
          const flick = 0.5 + 0.5 * Math.sin(e.phase * Math.PI * 6) * (1 - e.phase);
          seg.style.setProperty('--seg-dim', flick.toFixed(3));
          break;
        }
        case 'segHeatWave': {
          // волна тепла: пульс яркости проходит через все активные
          const activeIdx = getActiveSegIndices();
          const pos = e.phase * activeIdx.length;
          const localPhase = pos - Math.floor(pos);
          const wave = Math.sin(localPhase * Math.PI);
          const dist = Math.abs(e.segIdx - Math.floor(pos));
          if (dist <= 1) {
            seg.style.setProperty('--seg-brightness', (1 + wave * 0.4 * (1 - dist)).toFixed(3));
          }
          break;
        }
      }
    }
  }

  // ---------- основной кадр ----------

  function update(now, dt) {
    intensity = calcIntensity();

    // спавн страницы
    const since = now - spawnStart;
    const spawnCore = clamp(since / 500, 0, 1);
    const spawnGlow = clamp((since - 400) / 500, 0, 1);
    const spawnRing = clamp((since - 800) / 600, 0, 1);

    // hover
    const hoverStep = clamp(dt / 300, 0, 1);
    hoverVal += hover ? (1 - hoverVal) * hoverStep : (0 - hoverVal) * hoverStep;

    // дыхание
    const speedMult = (1 + hoverVal * 0.8) / sleepSlowdown();
    const breathBase = intensity > 0.3 ? 0.00055 : 0.0002;
    breathPhase += breathBase * speedMult * dt;
    const hoverBreath = hover ? Math.sin(breathPhase * 2.5) * 0.05 * hoverVal : 0;
    const breathScale = 1 + Math.sin(breathPhase * 2.5) * 0.012 * intensity + hoverBreath;

    updateHeatZones(dt);

    if (heatBoost > 0) heatBoost = Math.max(0, heatBoost - 0.00025 * dt);

    // --- эффекты ядра ---
    tryStart('sigh', 0.5, [4000, 5000]);
    tryStart('calmBurn', 0.8, [2000, 3000]);
    if (intensity > 0.5) tryStart('wiggle', 0.3, [700, 1000]);
    tryStart('tilt', 0.25, [2000, 2000], { target: rand(-1, 1) });
    tryStart('microShift', 0.2, [1000, 2000], { dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) });

    // новые эффекты ядра — высокие вероятности для видимости
    tryStart('crackle', 0.4, [80, 150]);          // потрескивание
    tryStart('stretch', 0.35, [3000, 4000]);      // растяжка/зевок
    tryStart('glint', 0.3, [2000, 3000]);         // отблеск
    if (intensity < 0.4) tryStart('sleepySag', 0.25, [3000, 5000]); // сонная просадка

    const sigh = advanceEffect('sigh', dt);
    const calmBurn = advanceEffect('calmBurn', dt);
    const wiggle = advanceEffect('wiggle', dt);
    advanceEffect('tilt', dt, () => { tiltTarget = 0; });
    const tilt = active.get('tilt');
    const microShift = advanceEffect('microShift', dt);
    const crackle = advanceEffect('crackle', dt);
    const stretch = advanceEffect('stretch', dt);
    const glint = advanceEffect('glint', dt);
    const sleepySag = advanceEffect('sleepySag', dt);

    // --- композиция ---

    // поёживание
    let scaleX = 1, scaleY = 1;
    if (wiggle) {
      const pts = [[1, 1], [0.98, 1.02], [1.01, 0.99], [1, 1]];
      const seg = wiggle.phase * (pts.length - 1);
      const i0 = Math.floor(seg), i1 = Math.min(i0 + 1, pts.length - 1);
      const lt = seg - i0;
      scaleX = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * lt;
      scaleY = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * lt;
    }

    // растяжка/зевок: scaleY 1→1.03→0.98→1
    if (stretch) {
      const pts = [[1, 1], [1.03, 1], [0.98, 1], [1, 1]];
      const seg = stretch.phase * (pts.length - 1);
      const i0 = Math.floor(seg), i1 = Math.min(i0 + 1, pts.length - 1);
      const lt = seg - i0;
      scaleY *= pts[i0][1] + (pts[i1][1] - pts[i0][1]) * lt;
    }

    // спокойное горение
    const calmMult = calmBurn ? 1 + bump(calmBurn.phase, 0.3, 0.7) * 0.02 : 1;
    const calmBright = calmBurn ? bump(calmBurn.phase, 0.3, 0.7) * 0.1 : 0;

    // вздох
    const sighMult = sigh ? 1 + bump(sigh.phase, 0.25, 0.75) * 0.015 : 1;
    const sighBright = sigh ? bump(sigh.phase, 0.25, 0.75) * 0.06 : 0;
    const sighGlow = sigh ? bump(sigh.phase, 0.25, 0.75) * 0.1 : 0;

    // потрескивание: резкий блик яркости ~100мс
    const crackleBright = crackle ? bump(crackle.phase, 0.3, 0.5) * 0.8 : 0;

    // отблеск: hue-rotate/saturate сдвиг
    const glintHue = glint ? bump(glint.phase, 0.3, 0.7) * 15 : 0;
    const glintSat = glint ? bump(glint.phase, 0.3, 0.7) * 0.25 : 0;

    // сонная просадка: оседание scaleY + приглушение
    const sleepyMult = sleepySag ? 1 - bump(sleepySag.phase, 0.3, 0.7) * 0.035 : 1;
    const sleepyBright = sleepySag ? -bump(sleepySag.phase, 0.3, 0.7) * 0.15 : 0;

    // поворот
    if (tilt) tiltTarget = tilt.target * (1 - Math.abs(2 * tilt.phase - 1));
    tiltCurrent += (tiltTarget - tiltCurrent) * clamp(0.08 * (dt / 16.7), 0, 1);

    // микросмещение
    const microShiftPx = microShift ? bump(microShift.phase, 0.5, 0.5) * (microShift.dx ?? 0.5) : 0;

    const finalScaleX = breathScale * scaleX * calmMult * sighMult * sleepyMult;
    const finalScaleY = breathScale * scaleY * calmMult * sighMult * sleepyMult;

    const heat = clamp(intensity + heatBoost * 0.25, 0, 1);
    const glow = clamp(intensity + heatBoost * 0.3 + sighGlow + hoverVal * 0.15, 0, 1.2);

    const brightness = clamp(
      0.7 + intensity * 0.3 + calmBright + sighBright + crackleBright + sleepyBright
      + heatBoost * 0.4 + hoverVal * 0.15,
      0.35, 1.8
    );

    const shiftX = heatOffsetX * 0.6 + microShiftPx;
    const shiftY = heatOffsetY * 0.6 - hoverVal * 0.5;

    // --- запись переменных ---
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

    // отблеск: фильтр на core
    if (glintHue || glintSat) {
      coreEl.style.filter = `hue-rotate(${glintHue.toFixed(1)}deg) saturate(${(1 + glintSat).toFixed(3)})`;
    } else {
      coreEl.style.filter = '';
    }

    applySegments();

    // --- сегментные эффекты ---
    tryStartSeg('segTremor', 0.35, [300, 500], () => {
      const active = getActiveSegIndices();
      return active.length ? active[Math.floor(Math.random() * active.length)] : null;
    });
    tryStartSeg('segTryIgnite', 0.3, [200, 400], () => {
      const off = getOffSegIndices();
      return off.length ? off[0] : null;
    });
    tryStartSeg('segHeatRipple', 0.25, [400, 600], () => {
      const active = getActiveSegIndices();
      if (active.length < 2) return null;
      return active[Math.floor(Math.random() * (active.length - 1))];
    });
    tryStartSeg('segFlicker', 0.4, [300, 500], () => {
      const active = getActiveSegIndices();
      return active.length ? active[Math.floor(Math.random() * active.length)] : null;
    });
    tryStartSeg('segHeatWave', 0.25, [600, 900], () => {
      const active = getActiveSegIndices();
      return active.length >= 3 ? 0 : null;
    });
    tryStartSeg('segTryIgnite', 0.1, [200, 400], () => {
      const off = getOffSegIndices();
      return off.length ? off[0] : null; // первый выключенный (граничный)
    });
    tryStartSeg('segHeatRipple', 0.08, [400, 600], () => {
      const active = getActiveSegIndices();
      if (active.length < 2) return null;
      return active[Math.floor(Math.random() * (active.length - 1))]; // 시작점
    });
    tryStartSeg('segFlicker', 0.15, [300, 500], () => {
      const active = getActiveSegIndices();
      return active.length ? active[Math.floor(Math.random() * active.length)] : null;
    });
    tryStartSeg('segHeatWave', 0.08, [600, 900], () => {
      const active = getActiveSegIndices();
      return active.length >= 3 ? 0 : null; // начинается с 0, проходит через все
    });

    advanceSegEffects(dt);
    applySegEffects();
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

    // инициализация расписаний сегментных эффектов
    ['segTremor', 'segTryIgnite', 'segHeatRipple', 'segFlicker', 'segHeatWave']
      .forEach(rescheduleSegDue);

    rafId = requestAnimationFrame(animate);
  }

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    if (channel) { try { channel.close(); } catch {} }
    clearTimeout(resetTimer);
  }

  return { init, destroy, notifyEdit };
})();
