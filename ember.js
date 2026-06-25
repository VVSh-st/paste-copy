// file_name: ember.js
//
// "Уголёк" — живой индикатор состояния проекта.
// Один rAF-цикл: update() -> applyVariables() -> requestAnimationFrame.

const Ember = (() => {
  'use strict';

  const LIFE = 7 * 24 * 60 * 60 * 1000;
  const STORAGE_KEY = 'ember-state';
  const BROADCAST_KEY = 'ember-sync';

  const PRIORITY = {
    startle: 0, sigh: 1, calmBurn: 2, wiggle: 3, tilt: 4, microShift: 5,
    crackle: 6, stretch: 7, glint: 8, sleepySag: 9,
    smolder: 10, heatRadiance: 11, glowPulse: 12, ashDrift: 13,
  };
  const MAX_EFFECTS = 3;

  let state = null;
  let root = null;
  let segments = [];
  let zones = [];
  let glowEl = null;
  let ringEl = null;
  let coreEl = null;
  let crustEl = null;
  let particleLayer = null;

  let hover = false;
  let hoverVal = 0;
  let intensity = 1;
  let breathPhase = 0;

  let heatOffsetX = 0, heatOffsetY = 0;
  let heatTargetX = 0, heatTargetY = 0;
  let nextHeatShift = 0;
  let heatPhase = 0;
  const heatPhaseSpeed = 0.0009;

  let typedChars = 0;
  let heatBoost = 0;
  let resetTimer = null;

  let prevRemaining = 12;
  let spawnStart = 0;

  const active = new Map();
  let nextDue = {};

  let tiltCurrent = 0;
  let tiltTarget = 0;

  let segmentEffects = [];
  let nextSegDue = {};

  let particles = [];
  let nextAshSpawn = 0;
  let nextSparkCheck = 0;
  let activeSparks = 0;

  let shimmerActive = false;
  let shimmerEnd = 0;
  let nextShimmerCheck = 0;

  let ringAngle = 0;
  let browserFocused = true;

  // --- курсор ---
  const mouse = { x: 0, y: 0, lastSampleX: 0, lastSampleY: 0, lastSampleTime: 0, speed: 0 };
  const caret = { x: 0, y: 0, active: false, typing: false, _typingTimer: null };
  const cursorLean = { x: 0, y: 0, squish: 0, scale: 1, tiltX: 0, tiltY: 0 };

  // ПКМ тестирование
  let testMode = false;
  let testQueue = [];
  let testIndex = 0;
  let testLabel = null;

  // пасхалка
  const egg = {
    active: false, phase: 0, phaseStart: 0,
    caretX: 0, caretY: 0, startX: 0, startY: 0, triggeredToday: false,
    x: 0, y: 0, scale: 1, squish: 0, tiltX: 0, tiltY: 0,
  };
  const EGG_STORAGE_KEY = 'ember-egg-date';
  const EGG_CHARS_THRESHOLD = 1000;
  let eggCharCount = 0;

  let channel = null;
  let rafId = null;
  let lastFrame = 0;

  // ---------- утилиты ----------

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function easeOutQuad(t) { return t * (2 - t); }
  function easeInQuad(t) { return t * t; }
  function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function bump(t, riseEnd, holdEnd) {
    if (t < riseEnd) return easeOutQuad(t / riseEnd);
    if (t < holdEnd) return 1;
    return 1 - easeInQuad((t - holdEnd) / (1 - holdEnd));
  }

  // ---------- состояние / синхронизация ----------

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
  function hoursWithoutActivity() { return (Date.now() - state.lastEditTime) / 3_600_000; }
  function remainingSegments() { return clamp(12 - Math.floor(hoursWithoutActivity() / 2), 0, 12); }
  function isSleeping() { return hoursWithoutActivity() > 5 * 24; }
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
    coreEl.style.animationDuration = rand(3.4, 4.8).toFixed(2) + 's';
    ['zone1', 'zone2', 'zone3'].forEach((cls) => {
      const z = document.createElement('div');
      z.className = `heat-zone ${cls}`;
      coreEl.appendChild(z);
      zones.push(z);
    });

    crustEl = document.createElement('div');
    crustEl.className = 'ember-crust';
    coreEl.appendChild(crustEl);

    glowEl = document.createElement('div');
    glowEl.className = 'ember-glow';
    glowEl.style.animationDuration = rand(2.6, 3.6).toFixed(2) + 's';
    coreEl.appendChild(glowEl);

    particleLayer = document.createElement('div');
    particleLayer.className = 'ember-particles';
    particleLayer.setAttribute('aria-hidden', 'true');

    root.appendChild(ringEl);
    root.appendChild(coreEl);
    root.appendChild(particleLayer);
    return root;
  }

  // ---------- сегменты ----------

  function applySegments() {
    const remaining = remainingSegments();
    if (remaining > prevRemaining) {
      const added = remaining - prevRemaining;
      const totalWindow = clamp(300 + added * 20, 300, 500);
      const step = totalWindow / added;
      for (let i = prevRemaining; i < remaining; i++) {
        segments[i].style.setProperty('--reveal-delay', ((i - prevRemaining) * step).toFixed(0));
      }
    }
    segments.forEach((seg, i) => seg.classList.toggle('active', i < remaining));
    prevRemaining = remaining;
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

    const cxBase = 50 + heatOffsetX * 2.5;
    const cyBase = 50 + heatOffsetY * 2.5;
    const wander = [
      { dx: -12, dy: -8, fx: 2.1, fy: 1.7 },
      { dx: 2, dy: 16, fx: 1.4, fy: 2.3 },
      { dx: 0, dy: 5, fx: 1.9, fy: 1.1 },
    ];
    zones.forEach((zone, i) => {
      const w = wander[i];
      const cx = cxBase + w.dx + Math.sin(heatPhase * w.fx + i) * 6;
      const cy = cyBase + w.dy + Math.cos(heatPhase * w.fy + i) * 6;
      zone.style.setProperty('--cx', clamp(cx, 20, 80).toFixed(1) + '%');
      zone.style.setProperty('--cy', clamp(cy, 20, 80).toFixed(1) + '%');
    });
  }

  // ---------- менеджер эффектов ядра ----------

  function rescheduleDue(type) {
    const ranges = {
      calmBurn: [15, 30], sigh: [20, 40], wiggle: [15, 30],
      tilt: [20, 40], microShift: [20, 40],
      crackle: [25, 50], stretch: [40, 80], glint: [50, 90],
      sleepySag: [60, 120],
      smolder: [25, 50], heatRadiance: [35, 65],
      glowPulse: [30, 55], ashDrift: [20, 45],
    };
    const slow = sleepSlowdown();
    const [a, b] = ranges[type] || [30, 60];
    nextDue[type] = Date.now() + rand(a, b) * 1000 * slow;
  }

  function tryStart(type, probability, durRangeMs, extraFn) {
    if (testMode) return;
    const now = Date.now();
    if (active.has(type)) return;
    if ((nextDue[type] ?? 0) > now) return;
    if (Math.random() >= probability) { rescheduleDue(type); return; }
    if (active.size >= MAX_EFFECTS) {
      let worstType = null, worstPri = -1;
      for (const t of active.keys()) {
        if (PRIORITY[t] > worstPri) { worstPri = PRIORITY[t]; worstType = t; }
      }
      if (worstType === null || PRIORITY[worstType] <= PRIORITY[type]) {
        rescheduleDue(type); return;
      }
      active.delete(worstType); rescheduleDue(worstType);
    }
    const extra = typeof extraFn === 'function' ? extraFn() : (extraFn || {});
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

  // ---------- сегментные эффекты ----------

  function rescheduleSegDue(type) {
    const ranges = {
      segTremor: [15, 30], segTryIgnite: [20, 40],
      segHeatRipple: [30, 50], segFlicker: [10, 25],
      segHeatWave: [25, 45],
    };
    const slow = sleepSlowdown();
    const [a, b] = ranges[type] || [20, 40];
    nextSegDue[type] = Date.now() + rand(a, b) * 1000 * slow;
  }

  function tryStartSeg(type, probability, durRangeMs, pickSeg) {
    if (segmentEffects.some(e => e.type === type)) return;
    if ((nextSegDue[type] ?? 0) > Date.now()) return;
    if (Math.random() >= probability) { rescheduleSegDue(type); return; }
    const segIdx = pickSeg();
    if (segIdx === null || segIdx === undefined) { rescheduleSegDue(type); return; }
    segmentEffects.push({
      type, segIdx, phase: 0,
      durMs: rand(durRangeMs[0], durRangeMs[1]),
      mag: rand(0.7, 1.3),
    });
  }

  function advanceSegEffects(dt) {
    for (let i = segmentEffects.length - 1; i >= 0; i--) {
      const e = segmentEffects[i];
      e.phase = clamp(e.phase + dt / e.durMs, 0, 1);
      if (e.phase >= 1) { segmentEffects.splice(i, 1); rescheduleSegDue(e.type); }
    }
  }

  function applySegEffects() {
    segments.forEach(seg => {
      seg.style.removeProperty('--seg-tilt');
      seg.style.removeProperty('--seg-flash');
      seg.style.removeProperty('--seg-dim');
      seg.style.removeProperty('--seg-brightness');
      seg.style.removeProperty('--seg-push');
    });
    for (const e of segmentEffects) {
      const seg = segments[e.segIdx];
      if (!seg) continue;
      const m = e.mag ?? 1;
      switch (e.type) {
        case 'segTremor':
          seg.style.setProperty('--seg-tilt', (Math.sin(e.phase * Math.PI * 3) * 6 * m * (1 - e.phase)).toFixed(2) + 'deg');
          seg.style.setProperty('--seg-push', (Math.sin(e.phase * Math.PI) * 1.2 * m).toFixed(2) + 'px');
          break;
        case 'segTryIgnite':
          seg.style.setProperty('--seg-flash',
            (e.phase < 0.3 ? easeOutQuad(e.phase / 0.3) : 1 - easeInQuad((e.phase - 0.3) / 0.7)).toFixed(3));
          break;
        case 'segHeatRipple':
          seg.style.setProperty('--seg-brightness', (1 + Math.sin(e.phase * Math.PI) * 1.2 * m).toFixed(3));
          break;
        case 'segFlicker':
          seg.style.setProperty('--seg-dim',
            (0.7 + 0.7 * Math.sin(e.phase * Math.PI * 6) * (1 - e.phase)).toFixed(3));
          break;
        case 'segHeatWave': {
          const activeIdx = getActiveSegIndices();
          const pos = e.phase * activeIdx.length;
          const dist = Math.abs(e.segIdx - Math.floor(pos));
          const localPhase = pos - Math.floor(pos);
          const wave = Math.sin(localPhase * Math.PI);
          if (dist <= 1)
            seg.style.setProperty('--seg-brightness', (1 + wave * 0.8 * (1 - dist)).toFixed(3));
          break;
        }
      }
    }
  }

  // ---------- частицы ----------

  function spawnAshParticle() {
    if (particles.length > 40) return;
    const el = document.createElement('div');
    const roll = Math.random();
    el.className = 'ember-ash' + (roll < 0.33 ? ' dark' : roll > 0.8 ? ' bright' : '');
    const size = rand(1.4, 3);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = size.toFixed(1) + 'px';
    const startX = rand(28, 72);
    const startY = rand(35, 70);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
    particleLayer.appendChild(el);

    particles.push({
      el, born: performance.now(),
      dur: rand(2600, 5200),
      rise: rand(-36, -20),
      drift: rand(-12, 12),
      sway: rand(2, 6),
      isSpark: false,
    });
  }

  function spawnSpark() {
    if (activeSparks >= 7) return;
    const el = document.createElement('div');
    el.className = 'ember-spark';
    const size = rand(1.6, 3.4);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = (size * rand(1.4, 2.2)).toFixed(1) + 'px';
    const startX = rand(30, 70);
    const startY = rand(35, 60);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
    particleLayer.appendChild(el);
    activeSparks++;

    particles.push({
      el, born: performance.now(),
      dur: rand(650, 1300),
      rise: rand(-30, -16),
      drift: rand(-8, 8),
      sway: rand(1, 3),
      isSpark: true,
    });
  }

  function updateParticles(now) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const t = clamp((now - p.born) / p.dur, 0, 1);
      if (t >= 1) {
        p.el.remove();
        if (p.isSpark) activeSparks = Math.max(0, activeSparks - 1);
        particles.splice(i, 1);
        continue;
      }
      const rise = p.rise * easeOutQuad(t);
      const drift = p.drift * t + Math.sin(t * Math.PI * 3) * p.sway;
      const opacity = t < 0.22 ? t / 0.22 : 1 - (t - 0.22) / 0.78;
      const scale = p.isSpark ? (1 - t * 0.75) : (1 - t * 0.3);
      const rot = p.isSpark ? t * 50 : 0;
      p.el.style.transform = `translate(${drift.toFixed(2)}px, ${rise.toFixed(2)}px) rotate(${rot}deg) scale(${scale.toFixed(2)})`;
      p.el.style.opacity = (opacity * (p.isSpark ? 1 : 0.92)).toFixed(3);
    }
  }

  // ---------- дрожание воздуха ----------

  function updateShimmer(now) {
    if (!shimmerActive && now > nextShimmerCheck) {
      if (Math.random() < 0.15) {
        shimmerActive = true;
        shimmerEnd = now + rand(2000, 4000);
        root.classList.add('ember-shimmer');
      }
      nextShimmerCheck = now + rand(120000, 180000);
    }
    if (shimmerActive && now > shimmerEnd) {
      shimmerActive = false;
      root.classList.remove('ember-shimmer');
    }
  }

  // ---------- отслеживание курсора ----------

  const CURSOR_SAMPLE_INTERVAL = 50;
  const CARET_SAMPLE_INTERVAL = 80;
  let nextMouseSample = 0;
  let nextCaretSample = 0;

  function sampleMousePosition(now) {
    if (now < nextMouseSample) return;
    nextMouseSample = now + CURSOR_SAMPLE_INTERVAL;
    const dx = mouse.x - mouse.lastSampleX;
    const dy = mouse.y - mouse.lastSampleY;
    const elapsed = now - mouse.lastSampleTime || 1;
    mouse.speed = Math.sqrt(dx * dx + dy * dy) / (elapsed / 16.7);
    mouse.lastSampleX = mouse.x;
    mouse.lastSampleY = mouse.y;
    mouse.lastSampleTime = now;
  }

  function sampleCaretPosition(now) {
    if (now < nextCaretSample) return;
    nextCaretSample = now + CARET_SAMPLE_INTERVAL;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { caret.active = false; return; }
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      const rect = range.getBoundingClientRect();
      caret.x = rect.left + rect.width / 2;
      caret.y = rect.top;
      caret.active = rect.width > 0 || rect.height > 0;
    } else {
      caret.active = false;
    }
  }

  function getEmberCenter() {
    if (!root) return { x: 0, y: 0 };
    const rect = root.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function normD(dx, dy, dist) { return dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 }; }

  // ---------- пасхалка ----------

  function checkEggTrigger() {
    if (egg.active || egg.triggeredToday) return false;
    const today = new Date().toDateString();
    try {
      const saved = localStorage.getItem(EGG_STORAGE_KEY);
      if (saved === today) { egg.triggeredToday = true; return false; }
    } catch {}
    if (eggCharCount >= EGG_CHARS_THRESHOLD) {
      egg.triggeredToday = true;
      try { localStorage.setItem(EGG_STORAGE_KEY, today); } catch {}
      return true;
    }
    return false;
  }

  function startEgg(targetOverride) {
    let targetX, targetY;
    if (targetOverride) {
      targetX = targetOverride.x;
      targetY = targetOverride.y;
    } else {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed) return;
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      targetX = rect.left + rect.width / 2;
      targetY = rect.top;
    }
    const ember = getEmberCenter();
    egg.active = true;
    egg.phase = 1;
    egg.phaseStart = performance.now();
    egg.startX = cursorLean.x;
    egg.startY = cursorLean.y;
    egg.caretX = targetX - ember.x;
    egg.caretY = targetY - ember.y;
    egg.x = cursorLean.x;
    egg.y = cursorLean.y;
    egg.scale = 1;
    egg.squish = 0;
    egg.tiltX = 0;
    egg.tiltY = 0;
    eggCharCount = 0;
  }

  // Сценарий: подлетает к каретке -> осматривается/разглядывает ->
  // схлопывается в точку -> телепортируется в кружок -> вырастает обратно.
  function updateEgg(now) {
    if (!egg.active) return;
    const t = now - egg.phaseStart;
    switch (egg.phase) {
      case 1: { // полёт к каретке
        const p = clamp(t / 850, 0, 1);
        const e = easeOutQuad(p);
        egg.x = egg.startX + (egg.caretX - egg.startX) * e;
        egg.y = egg.startY + (egg.caretY - egg.startY) * e;
        // лёгкое покачивание в полёте + наклон по направлению движения
        egg.y += Math.sin(p * Math.PI * 3) * 2 * (1 - p);
        egg.scale = 1 + Math.sin(p * Math.PI) * 0.12;
        egg.tiltY = (egg.caretX - egg.startX) > 0 ? -10 * (1 - p) : 10 * (1 - p);
        egg.tiltX = 0;
        if (p >= 1) { egg.phase = 2; egg.phaseStart = now; }
        break;
      }
      case 2: { // осматривается, крутит "головой", разглядывает
        const p = clamp(t / 2400, 0, 1);
        egg.x = egg.caretX + Math.sin(p * Math.PI * 3) * 7;
        egg.y = egg.caretY + Math.sin(p * Math.PI * 2 + 1) * 5 - 2;
        egg.scale = 1.05 + Math.sin(p * Math.PI * 4) * 0.04;
        egg.tiltX = Math.sin(p * Math.PI * 3.5) * 14;
        egg.tiltY = Math.cos(p * Math.PI * 2.5) * 16;
        egg.squish = Math.max(0, Math.sin(p * Math.PI * 6)) * 0.08;
        if (p >= 1) { egg.phase = 3; egg.phaseStart = now; }
        break;
      }
      case 3: { // замах перед схлопыванием
        const p = clamp(t / 220, 0, 1);
        egg.x = egg.caretX;
        egg.y = egg.caretY;
        egg.scale = 1.05 + easeOutQuad(p) * 0.25;
        egg.tiltX = 0; egg.tiltY = 0;
        egg.squish = -0.1 * p;
        if (p >= 1) { egg.phase = 4; egg.phaseStart = now; }
        break;
      }
      case 4: { // схлопывается в точку (на месте каретки)
        const p = clamp(t / 260, 0, 1);
        egg.x = egg.caretX;
        egg.y = egg.caretY;
        egg.scale = 1.3 - easeInQuad(p) * 1.26; // -> ~0.04
        egg.squish = easeInQuad(p) * 0.6;
        if (p >= 1) { egg.phase = 5; egg.phaseStart = now; }
        break;
      }
      case 5: { // телепорт в кружок: мгновенно дома, держим точку
        egg.x = 0;
        egg.y = 0;
        egg.scale = 0.04;
        egg.squish = 0.5;
        egg.tiltX = 0; egg.tiltY = 0;
        if (t > 90) { egg.phase = 6; egg.phaseStart = now; }
        break;
      }
      case 6: { // "пшик" — раздувается обратно до нормы
        const p = clamp(t / 420, 0, 1);
        const e = easeOutQuad(p);
        egg.x = 0; egg.y = 0;
        egg.scale = 0.04 + e * 0.96 + Math.sin(p * Math.PI) * 0.12;
        egg.squish = (1 - e) * 0.5 - Math.sin(p * Math.PI) * 0.1;
        if (p >= 1) {
          egg.scale = 1; egg.squish = 0;
          egg.active = false;
        }
        break;
      }
    }
  }

  // ---------- ПКМ тестирование ----------

  const TEST_EFFECTS = [
    'sigh', 'calmBurn', 'wiggle', 'tilt', 'microShift',
    'crackle', 'stretch', 'glint', 'sleepySag',
    'smolder', 'heatRadiance', 'glowPulse', 'ashDrift',
    'typingApproach',
    'eggFly',
  ];

  function startTestMode() {
    testMode = true;
    testQueue = [...TEST_EFFECTS];
    testIndex = 0;
    runNextTest();
  }

  function runNextTest() {
    if (!testMode || testIndex >= testQueue.length) {
      testMode = false;
      if (testLabel) { testLabel.remove(); testLabel = null; }
      return;
    }
    const type = testQueue[testIndex];
    testIndex++;

    if (!testLabel) {
      testLabel = document.createElement('div');
      testLabel.className = 'ember-test-label';
      root.appendChild(testLabel);
    }
    testLabel.textContent = type;
    testLabel.style.opacity = '1';
    setTimeout(() => { if (testLabel) testLabel.style.opacity = '0.7'; }, 800);

    const durRanges = {
      sigh: [4000, 5000], calmBurn: [2000, 3000], wiggle: [700, 1000],
      tilt: [2000, 2000], microShift: [1000, 2000],
      crackle: [150, 250], stretch: [3000, 4000], glint: [2000, 3000],
      sleepySag: [3000, 5000],
      smolder: [3000, 4000], heatRadiance: [2500, 3500],
      glowPulse: [2000, 3000], ashDrift: [3000, 4000],
    };

    active.clear();

    const coreTypes = Object.keys(durRanges);
    if (coreTypes.includes(type)) {
      const extras = {
        calmBurn: { mag: rand(0.05, 0.1), hue: rand(-6, 12) },
        sigh: { mag: rand(0.04, 0.08), glow: rand(0.15, 0.28) },
        wiggle: { amp: rand(0.9, 1.3) },
        stretch: { amp: rand(0.9, 1.25) },
        crackle: { mag: rand(0.9, 1.5) },
        glint: { hue: rand(15, 35), sat: rand(0.3, 0.6) },
        smolder: { hue: rand(10, 26), sat: rand(0.15, 0.32) },
        tilt: { target: rand(-1, 1) },
        microShift: { dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) },
        ashDrift: { dx: rand(-3, 3) },
      };
      active.set(type, {
        phase: 0,
        durMs: rand(durRanges[type][0], durRanges[type][1]),
        ...(extras[type] || {}),
      });
    }

    if (['segTremor', 'segFlicker', 'segHeatWave'].includes(type)) {
      const a = getActiveSegIndices();
      if (a.length) {
        segmentEffects.push({
          type, segIdx: type === 'segHeatWave' ? 0 : a[Math.floor(Math.random() * a.length)],
          phase: 0, durMs: rand(500, 800), mag: rand(0.8, 1.2),
        });
      }
    }

    if (['crackle', 'glowPulse', 'calmBurn'].includes(type)) {
      for (let i = 0; i < 6; i++) setTimeout(() => spawnSpark(), i * 130);
    }
    if (['ashDrift', 'smolder', 'sigh'].includes(type)) {
      for (let i = 0; i < 10; i++) setTimeout(() => spawnAshParticle(), i * 160);
    }

    if (type === 'typingApproach') {
      caret.typing = true;
      caret.active = true;
      caret.x = getEmberCenter().x + rand(-100, 100);
      caret.y = getEmberCenter().y + rand(-50, 50);
      setTimeout(() => { caret.typing = false; }, 2200);
    }
    if (type === 'eggFly') {
      egg.triggeredToday = false;
      const ec = getEmberCenter();
      startEgg({ x: ec.x + rand(40, 100), y: ec.y + rand(50, 90) });
    }

    setTimeout(runNextTest, 3300);
  }

  // ---------- основной кадр ----------

  function applyEggVars() {
    coreEl.style.setProperty('--cursorLeanX', '0');
    coreEl.style.setProperty('--cursorLeanY', '0');
    coreEl.style.setProperty('--cursorSquish', '0');
    coreEl.style.setProperty('--cursorScale', '1');
    coreEl.style.setProperty('--cursorTiltX', '0');
    coreEl.style.setProperty('--cursorTiltY', '0');
    coreEl.style.setProperty('--eggX', egg.x.toFixed(1) + 'px');
    coreEl.style.setProperty('--eggY', egg.y.toFixed(1) + 'px');
    coreEl.style.setProperty('--eggScale', clamp(egg.scale, 0.02, 2).toFixed(3));
    coreEl.style.setProperty('--eggSquish', egg.squish.toFixed(3));
    coreEl.style.setProperty('--eggTiltX', egg.tiltX.toFixed(1) + 'deg');
    coreEl.style.setProperty('--eggTiltY', egg.tiltY.toFixed(1) + 'deg');
  }

  function update(now, dt) {
    intensity = calcIntensity();

    sampleMousePosition(now);
    sampleCaretPosition(now);

    // вращение кольца — медленное, только при наведении
    ringAngle += dt * 0.0003 * hoverVal / sleepSlowdown();
    ringEl.style.setProperty('--ringRot', (ringAngle * 57.2958 % 360).toFixed(2) + 'deg');

    if (egg.active) {
      updateEgg(now);
      applyEggVars();
      applySegments();
      advanceSegEffects(dt);
      applySegEffects();
      updateParticles(now);
      return;
    }
    coreEl.style.removeProperty('--eggX');
    coreEl.style.removeProperty('--eggY');
    coreEl.style.removeProperty('--eggScale');
    coreEl.style.removeProperty('--eggSquish');
    coreEl.style.removeProperty('--eggTiltX');
    coreEl.style.removeProperty('--eggTiltY');

    updateCursorLean(now, dt);

    const since = now - spawnStart;
    const spawnCore = clamp(since / 500, 0, 1);
    const spawnGlow = clamp((since - 400) / 500, 0, 1);
    const spawnRing = clamp((since - 800) / 600, 0, 1);

    const hoverStep = clamp(dt / 300, 0, 1);
    hoverVal += hover ? (1 - hoverVal) * hoverStep : (0 - hoverVal) * hoverStep;

    const speedMult = (1 + hoverVal * 0.8) / sleepSlowdown();
    const breathBase = intensity > 0.3 ? 0.00055 : 0.0002;
    breathPhase += breathBase * speedMult * dt;
    const hoverBreath = hover ? Math.sin(breathPhase * 2.5) * 0.05 * hoverVal : 0;
    const breathScale = 1 + Math.sin(breathPhase * 2.5) * 0.012 * intensity + hoverBreath;

    updateHeatZones(dt);
    if (heatBoost > 0) heatBoost = Math.max(0, heatBoost - 0.00025 * dt);

    // --- запуск эффектов ядра с рандомными параметрами ---
    if (!testMode) {
      tryStart('sigh', 0.5, [4000, 5000], () => ({ mag: rand(0.04, 0.08), glow: rand(0.15, 0.28) }));
      tryStart('calmBurn', 0.8, [2000, 3000], () => ({ mag: rand(0.05, 0.1), hue: rand(-6, 12) }));
      if (intensity > 0.5) tryStart('wiggle', 0.3, [700, 1100], () => ({ amp: rand(0.9, 1.3) }));
      tryStart('tilt', 0.25, [2000, 2000], () => ({ target: rand(-1, 1) }));
      tryStart('microShift', 0.2, [1000, 2000], () => ({ dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) }));
      tryStart('crackle', 0.4, [80, 160], () => ({ mag: rand(0.9, 1.5) }));
      tryStart('stretch', 0.35, [3000, 4200], () => ({ amp: rand(0.9, 1.25) }));
      tryStart('glint', 0.3, [2000, 3000], () => ({ hue: rand(15, 35), sat: rand(0.3, 0.6) }));
      if (intensity < 0.4) tryStart('sleepySag', 0.25, [3000, 5000]);
      tryStart('smolder', 0.3, [3000, 4000], () => ({ hue: rand(10, 26), sat: rand(0.15, 0.32) }));
      tryStart('heatRadiance', 0.25, [2500, 3500]);
      tryStart('glowPulse', 0.3, [2000, 3000]);
      tryStart('ashDrift', 0.3, [3000, 4000], () => ({ dx: rand(-3, 3) }));
    }

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
    const smolder = advanceEffect('smolder', dt);
    const heatRadiance = advanceEffect('heatRadiance', dt);
    const glowPulse = advanceEffect('glowPulse', dt);
    const ashDrift = advanceEffect('ashDrift', dt);

    const tm = testMode ? 4 : 1;

    // поёживание (рандомная амплитуда)
    let scaleX = 1, scaleY = 1;
    if (wiggle) {
      const amp = wiggle.amp ?? 1;
      const pts = [[1, 1], [0.92, 1.07], [1.05, 0.95], [0.97, 1.03], [1, 1]];
      const s = wiggle.phase * (pts.length - 1);
      const i0 = Math.floor(s), i1 = Math.min(i0 + 1, pts.length - 1);
      const lt = s - i0;
      scaleX = 1 + ((pts[i0][0] + (pts[i1][0] - pts[i0][0]) * lt) - 1) * amp;
      scaleY = 1 + ((pts[i0][1] + (pts[i1][1] - pts[i0][1]) * lt) - 1) * amp;
    }

    if (stretch) {
      const amp = stretch.amp ?? 1;
      const pts = [[1, 1], [1.12, 0.92], [0.9, 1.08], [1, 1]];
      const s = stretch.phase * (pts.length - 1);
      const i0 = Math.floor(s), i1 = Math.min(i0 + 1, pts.length - 1);
      const lt = s - i0;
      scaleX *= 1 + ((pts[i0][0] + (pts[i1][0] - pts[i0][0]) * lt) - 1) * amp;
      scaleY *= 1 + ((pts[i0][1] + (pts[i1][1] - pts[i0][1]) * lt) - 1) * amp;
    }

    let crackleScale = 1;
    if (crackle) {
      const mag = crackle.mag ?? 1;
      const p = crackle.phase;
      const spike = p < 0.15 ? 1 + p / 0.15 * 0.12 * mag : 1 + (1 - (p - 0.15) / 0.85) * 0.12 * mag;
      crackleScale = spike;
      if (p < 0.04 && Math.random() < 0.5) spawnSpark();
    }

    const calmMag = calmBurn?.mag ?? 0.06;
    const calmMult = calmBurn ? 1 + bump(calmBurn.phase, 0.3, 0.7) * calmMag * tm : 1;
    const calmBright = calmBurn ? bump(calmBurn.phase, 0.3, 0.7) * 0.15 * tm : 0;
    const calmHue = calmBurn ? bump(calmBurn.phase, 0.3, 0.7) * (calmBurn.hue ?? 0) * tm : 0;

    const sighMag = sigh?.mag ?? 0.05;
    const sighMult = sigh ? 1 + bump(sigh.phase, 0.25, 0.75) * sighMag * tm : 1;
    const sighBright = sigh ? bump(sigh.phase, 0.25, 0.75) * 0.12 * tm : 0;
    const sighGlow = sigh ? bump(sigh.phase, 0.25, 0.75) * (sigh.glow ?? 0.2) * tm : 0;

    const crackleBright = crackle ? bump(crackle.phase, 0.3, 0.5) * 1.2 * (crackle.mag ?? 1) * tm : 0;

    const glintHue = glint ? bump(glint.phase, 0.3, 0.7) * (glint.hue ?? 25) * tm : 0;
    const glintSat = glint ? bump(glint.phase, 0.3, 0.7) * (glint.sat ?? 0.4) * tm : 0;

    const sleepyMult = sleepySag ? 1 - bump(sleepySag.phase, 0.3, 0.7) * 0.08 * tm : 1;
    const sleepyBright = sleepySag ? -bump(sleepySag.phase, 0.3, 0.7) * 0.2 * tm : 0;

    const smolderHue = smolder ? bump(smolder.phase, 0.2, 0.8) * (smolder.hue ?? 20) * tm : 0;
    const smolderSat = smolder ? bump(smolder.phase, 0.2, 0.8) * (smolder.sat ?? 0.25) * tm : 0;

    const radianceGlow = heatRadiance ? bump(heatRadiance.phase, 0.3, 0.7) * 0.4 * tm : 0;
    const glowPulseMult = glowPulse ? bump(glowPulse.phase, 0.2, 0.6) * 0.3 * tm : 0;
    const ashDriftX = ashDrift ? bump(ashDrift.phase, 0.3, 0.7) * (ashDrift.dx ?? 0) * 2 * tm : 0;

    if (tilt) tiltTarget = tilt.target * (1 - Math.abs(2 * tilt.phase - 1));
    tiltCurrent += (tiltTarget - tiltCurrent) * clamp(0.08 * (dt / 16.7), 0, 1);

    const microShiftPx = microShift ? bump(microShift.phase, 0.5, 0.5) * (microShift.dx ?? 0.5) : 0;

    const finalScaleX = breathScale * scaleX * calmMult * sighMult * sleepyMult * crackleScale * cursorLean.scale;
    const finalScaleY = breathScale * scaleY * calmMult * sighMult * sleepyMult * crackleScale * cursorLean.scale;

    const heat = clamp(intensity + heatBoost * 0.25, 0, 1);
    const glow = clamp(intensity + heatBoost * 0.3 + sighGlow + hoverVal * 0.15 + radianceGlow + glowPulseMult, 0, 1.8);

    const brightness = clamp(
      0.7 + intensity * 0.3 + calmBright + sighBright + crackleBright + sleepyBright
      + heatBoost * 0.4 + hoverVal * 0.15,
      0.35, 2.5
    );

    const shiftX = heatOffsetX * 0.6 + microShiftPx + ashDriftX;
    const shiftY = heatOffsetY * 0.6 - hoverVal * 0.5;

    root.style.setProperty('--heat', heat.toFixed(3));
    root.style.setProperty('--glow', glow.toFixed(3));
    root.style.setProperty('--intensity', intensity.toFixed(3));
    root.style.setProperty('--hover', hoverVal.toFixed(3));
    root.style.setProperty('--shiftX', shiftX.toFixed(2) + 'px');
    root.style.setProperty('--shiftY', shiftY.toFixed(2) + 'px');
    root.style.setProperty('--breathScale', breathScale.toFixed(4));
    root.style.setProperty('--rotation', tiltCurrent.toFixed(2) + 'deg');
    root.style.setProperty('--tiltX', (microShiftPx * 1.5 + cursorLean.tiltX).toFixed(2) + 'deg');
    root.style.setProperty('--tiltY', (tiltCurrent * 0.6 + cursorLean.tiltY).toFixed(2) + 'deg');

    root.style.setProperty('--scaleX', finalScaleX.toFixed(4));
    root.style.setProperty('--scaleY', finalScaleY.toFixed(4));
    root.style.setProperty('--brightness', brightness.toFixed(3));
    root.style.setProperty('--glowOpacity', (1 + hoverVal * 0.15 + radianceGlow).toFixed(3));
    root.style.setProperty('--glowBlur', (5 + hoverVal * 1.5 + radianceGlow * 3).toFixed(2) + 'px');
    root.style.setProperty('--glowScale', (1 + hoverVal * 0.08 + radianceGlow * 0.15 + glowPulseMult * 0.1).toFixed(3));
    root.style.setProperty('--ringOpacity', clamp(intensity * 0.6 + 0.4, 0, 1).toFixed(3));

    // cursor lean — только на core, кольцо остаётся на месте
    coreEl.style.setProperty('--cursorLeanX', cursorLean.x.toFixed(1));
    coreEl.style.setProperty('--cursorLeanY', cursorLean.y.toFixed(1));
    coreEl.style.setProperty('--cursorSquish', cursorLean.squish.toFixed(3));
    coreEl.style.setProperty('--cursorScale', cursorLean.scale.toFixed(3));
    coreEl.style.setProperty('--cursorTiltX', cursorLean.tiltX.toFixed(1));
    coreEl.style.setProperty('--cursorTiltY', cursorLean.tiltY.toFixed(1));

    root.style.setProperty('--spawnCore', spawnCore.toFixed(3));
    root.style.setProperty('--spawnGlow', spawnGlow.toFixed(3));
    root.style.setProperty('--spawnRing', spawnRing.toFixed(3));

    const totalHue = glintHue + smolderHue + calmHue;
    const totalSat = glintSat + smolderSat;
    if (totalHue || totalSat) {
      coreEl.style.filter = `brightness(var(--brightness)) hue-rotate(${totalHue.toFixed(1)}deg) saturate(${(1 + totalSat).toFixed(3)})`;
    } else {
      coreEl.style.filter = 'brightness(var(--brightness))';
    }

    applySegments();

    if (!testMode) {
      tryStartSeg('segTremor', 0.35, [300, 500], () => {
        const a = getActiveSegIndices();
        return a.length ? a[Math.floor(Math.random() * a.length)] : null;
      });
      tryStartSeg('segTryIgnite', 0.3, [200, 400], () => {
        const o = getOffSegIndices();
        return o.length ? o[0] : null;
      });
      tryStartSeg('segHeatRipple', 0.25, [400, 600], () => {
        const a = getActiveSegIndices();
        return a.length >= 2 ? a[Math.floor(Math.random() * (a.length - 1))] : null;
      });
      tryStartSeg('segFlicker', 0.4, [300, 500], () => {
        const a = getActiveSegIndices();
        return a.length ? a[Math.floor(Math.random() * a.length)] : null;
      });
      tryStartSeg('segHeatWave', 0.25, [600, 900], () => {
        const a = getActiveSegIndices();
        return a.length >= 3 ? 0 : null;
      });
    }

    advanceSegEffects(dt);
    applySegEffects();

    // --- микропепел (чаще + выше) ---
    if (Date.now() > nextAshSpawn) {
      if (Math.random() < 0.88) spawnAshParticle();
      if (intensity > 0.6 && Math.random() < 0.3) spawnAshParticle();
      nextAshSpawn = Date.now() + rand(280, 720);
    }

    // --- искры (чаще, ярче, разные) ---
    if (Date.now() > nextSparkCheck) {
      if (Math.random() < 0.5 * (0.4 + intensity * 0.6)) spawnSpark();
      nextSparkCheck = Date.now() + rand(1400, 3800);
    }

    updateParticles(now);
    updateShimmer(now);
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

    if (!egg.triggeredToday) {
      eggCharCount++;
      if (checkEggTrigger()) startEgg();
    }
  }

  function setupEventListeners() {
    root.addEventListener('mouseenter', () => { hover = true; });
    root.addEventListener('mouseleave', () => { hover = false; });
    root.addEventListener('focus', () => { hover = true; });
    root.addEventListener('blur', () => { hover = false; });

    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!testMode) startTestMode();
    });

    const isEditable = (el) =>
      el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);

    document.addEventListener('input', (e) => {
      if (isEditable(e.target)) {
        handleInput();
        caret.typing = true;
        clearTimeout(caret._typingTimer);
        caret._typingTimer = setTimeout(() => { caret.typing = false; }, 1500);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!browserFocused) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 200;
      mouse.x = clamp(e.clientX, -margin, vw + margin);
      mouse.y = clamp(e.clientY, -margin, vh + margin);
    });

    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { caret.active = false; return; }
      const range = sel.getRangeAt(0);
      caret.active = range.collapsed;
    });

    window.addEventListener('focus', () => { browserFocused = true; });
    window.addEventListener('blur', () => {
      browserFocused = false;
      mouseInZone = false;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        browserFocused = false;
        mouseInZone = false;
      } else {
        browserFocused = true;
      }
    });
  }

  // ---------- инициализация ----------

  function init(mountEl) {
    state = loadState();
    createDOM();
    setupBroadcast();
    setupEventListeners();

    try {
      const today = new Date().toDateString();
      if (localStorage.getItem(EGG_STORAGE_KEY) === today) egg.triggeredToday = true;
    } catch {}

    const container = mountEl || document.getElementById('ember-slot');
    if (container) container.appendChild(root);
    else document.body.appendChild(root);

    prevRemaining = remainingSegments();
    spawnStart = performance.now();
    lastFrame = 0;

    ['segTremor', 'segTryIgnite', 'segHeatRipple', 'segFlicker', 'segHeatWave']
      .forEach(rescheduleSegDue);

    rafId = requestAnimationFrame(animate);
  }

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    if (channel) { try { channel.close(); } catch {} }
    clearTimeout(resetTimer);
    particles.forEach(p => p.el.remove());
    particles = [];
    activeSparks = 0;
  }

  return { init, destroy, notifyEdit };
})();