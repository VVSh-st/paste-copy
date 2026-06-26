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
    smolder: 10, heatRadiance: 11, glowPulse: 12, ashDrift: 13, gust: 14,
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
  let crackEl = null;
  let ashEl = null;
  let hazeEl = null;
  let particleLayer = null;
  let hotspots = [];
  let windGust = 0;

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
  let nextAriaUpdate = 0;

  let ringAngle = 0;
  let browserFocused = true;
  let onScreen = true;
  let io = null;

  // --- курсор ---
  const mouse = { x: 0, y: 0, lastSampleX: 0, lastSampleY: 0, lastSampleTime: 0, speed: 0 };
  const caret = { x: 0, y: 0, active: false, typing: false, _typingTimer: null };
  const cursorLean = { x: 0, y: 0, squish: 0, scale: 1, tiltX: 0, tiltY: 0 };

  // state machine для peek-цикла
  const peek = {
    state: 'idle',
    timer: 0,
    leanX: 0, leanY: 0,
    blinkPhase: 0,
    noticeDelay: 0,
    lookDuration: 0,
    leanProgress: 0,
    cooldown: 0,
  };
  let ringImpulse = 0;

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
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let handlers = {};

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
    handlers.storageSync = (e) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const s = JSON.parse(e.newValue);
          if (s && typeof s.lastEditTime === 'number') state = s;
        } catch {}
      }
    };
    window.addEventListener('storage', handlers.storageSync);
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

    crackEl = document.createElement('div');
    crackEl.className = 'ember-cracks';
    coreEl.appendChild(crackEl);

    ashEl = document.createElement('div');
    ashEl.className = 'ember-ash-overlay';
    coreEl.appendChild(ashEl);

    for (let i = 0; i < 3; i++) {
      const hs = document.createElement('div');
      hs.className = 'ember-hotspot';
      coreEl.appendChild(hs);
      hotspots.push({ el: hs, born: 0, dur: 0, x: 0, y: 0 });
    }

    glowEl = document.createElement('div');
    glowEl.className = 'ember-glow';
    glowEl.style.animationDuration = rand(2.6, 3.6).toFixed(2) + 's';
    coreEl.appendChild(glowEl);

    hazeEl = document.createElement('div');
    hazeEl.className = 'ember-haze';

    particleLayer = document.createElement('div');
    particleLayer.className = 'ember-particles';
    particleLayer.setAttribute('aria-hidden', 'true');

    root.appendChild(ringEl);
    root.appendChild(coreEl);
    root.appendChild(hazeEl);
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
      const pulse = 0.6 + Math.sin(heatPhase * (1.3 + i * 0.4) + i * 2) * 0.4;
      zone.style.setProperty('--zoneHeat', pulse.toFixed(3));
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
      glowPulse: [30, 55], ashDrift: [20, 45], gust: [40, 80],
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
      type: 'spark',
    });
  }

  function spawnShootingSpark() {
    if (activeSparks >= 7) return;
    const el = document.createElement('div');
    el.className = 'ember-spark ember-spark-shoot';
    const size = rand(1.4, 2.2);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = (size * rand(2, 3)).toFixed(1) + 'px';
    const startX = rand(30, 70);
    const startY = rand(35, 55);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
    particleLayer.appendChild(el);
    activeSparks++;

    const angle = rand(-0.8, 0.8);
    const speed = rand(40, 70);
    particles.push({
      el, born: performance.now(),
      dur: rand(400, 700),
      rise: Math.cos(angle) * -speed,
      drift: Math.sin(angle) * speed * 0.6,
      sway: 0,
      isSpark: true,
      type: 'shooting',
      trail: true,
    });
  }

  function spawnCrumb() {
    if (particles.length > 40) return;
    const el = document.createElement('div');
    el.className = 'ember-ash bright';
    const size = rand(2, 3.5);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = size.toFixed(1) + 'px';
    const startX = rand(30, 70);
    const startY = rand(40, 60);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
    particleLayer.appendChild(el);

    particles.push({
      el, born: performance.now(),
      dur: rand(1200, 2200),
      rise: rand(-12, -5),
      drift: rand(-6, 6),
      sway: 0,
      isSpark: false,
      type: 'crumb',
      vy: 0,
      gravity: 0.025,
    });
  }

  function spawnLandingGlow(x, y) {
    const el = document.createElement('div');
    el.className = 'ember-landing-glow';
    el.style.left = x + '%';
    el.style.top = y + '%';
    particleLayer.appendChild(el);
    setTimeout(() => el.remove(), 250);
  }

  function updateParticles(now, dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const t = clamp((now - p.born) / p.dur, 0, 1);
      if (t >= 1) {
        if (p.type === 'shooting' || (p.isSpark && p.type === 'spark')) {
          const px = parseFloat(p.el.style.left);
          const py = parseFloat(p.el.style.top);
          if (!isNaN(px) && !isNaN(py)) spawnLandingGlow(px, py);
        }
        p.el.remove();
        if (p.isSpark) activeSparks = Math.max(0, activeSparks - 1);
        particles.splice(i, 1);
        continue;
      }

      let rise, drift;
      if (p.type === 'crumb') {
        p.vy += p.gravity * dt;
        rise = p.rise * t + p.vy * dt * 0.1;
        drift = p.drift * t;
      } else if (p.type === 'shooting') {
        rise = p.rise * easeOutQuad(t) * 1.5;
        drift = p.drift * t * 1.5;
      } else {
        rise = p.rise * easeOutQuad(t);
        drift = p.drift * t + Math.sin(t * Math.PI * 3) * (p.sway || 0);
      }

      const opacity = p.type === 'shooting'
        ? (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85)
        : (t < 0.22 ? t / 0.22 : 1 - (t - 0.22) / 0.78);
      const scale = p.isSpark ? (1 - t * 0.75) : (p.type === 'crumb' ? (1 - t * 0.5) : (1 - t * 0.3));
      const rot = p.isSpark ? t * 50 : 0;

      let shadow = '';
      if (p.trail && p.type === 'shooting') {
        const trailLen = (1 - t) * 12;
        shadow = `0 ${trailLen.toFixed(0)}px 3px rgba(255,150,50,${(0.6 * (1 - t)).toFixed(2)})`;
      }

      p.el.style.transform = `translate(${drift.toFixed(2)}px, ${rise.toFixed(2)}px) rotate(${rot}deg) scale(${scale.toFixed(2)})`;
      p.el.style.opacity = (opacity * (p.isSpark ? 1 : 0.92)).toFixed(3);
      if (shadow) p.el.style.boxShadow = shadow;
    }
  }

  // ---------- горячие точки на поверхности ----------

  function updateHotspots(now, dt) {
    if (reduceMotion) return;
    for (let i = 0; i < hotspots.length; i++) {
      const hs = hotspots[i];
      if (hs.born === 0) {
        if (Math.random() < 0.0008 * dt * intensity) {
          hs.born = now;
          hs.dur = rand(200, 600);
          hs.x = rand(25, 75);
          hs.y = rand(25, 75);
          hs.el.style.left = hs.x + '%';
          hs.el.style.top = hs.y + '%';
        }
      } else {
        const t = clamp((now - hs.born) / hs.dur, 0, 1);
        const opacity = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
        hs.el.style.opacity = (opacity * intensity).toFixed(3);
        if (t >= 1) {
          hs.born = 0;
          hs.el.style.opacity = '0';
        }
      }
    }
  }

  // ---------- ветер от курсора ----------

  function updateWind(now, dt) {
    if (reduceMotion) { windGust = 0; return; }
    const ember = getEmberCenter();
    const dx = mouse.x - ember.x;
    const dy = mouse.y - ember.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 80 || dist > 200 || mouse.speed < 12) {
      windGust *= Math.max(0, 1 - dt * 0.003);
    } else {
      const strength = clamp((mouse.speed - 12) / 60, 0, 1) * clamp(1 - (dist - 80) / 120, 0, 1);
      windGust += (strength - windGust) * clamp(dt * 0.004, 0, 1);
    }
    if (windGust > 0.15 && heatBoost < 0.1) {
      heatBoost = Math.min(heatBoost + windGust * 0.001 * dt, 0.2);
      if (Math.random() < windGust * 0.01 * dt) spawnSpark();
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

  function describe() {
    const h = Math.floor(hoursWithoutActivity());
    if (isSleeping()) return 'Проект спит — давно не было правок';
    if (h < 1) return 'Проект активен, уголёк горит ярко';
    return `Без активности ~${h} ч; осталось ${remainingSegments()}/12 делений`;
  }

  function updateCursorLean(now, dt) {
    const lerp = clamp(dt * 0.008, 0, 1);

    // кольцо втягивает обратно — импульс затухает
    ringImpulse *= Math.max(0, 1 - dt * 0.003);
    if (ringImpulse < 0.01) ringImpulse = 0;

    if (!browserFocused) {
      cursorLean.x += (0 - cursorLean.x) * lerp;
      cursorLean.y += (0 - cursorLean.y) * lerp;
      cursorLean.squish += (0 - cursorLean.squish) * lerp;
      cursorLean.scale += (1 - cursorLean.scale) * lerp;
      cursorLean.tiltX += (0 - cursorLean.tiltX) * lerp;
      cursorLean.tiltY += (0 - cursorLean.tiltY) * lerp;
      peek.state = 'idle';
      return;
    }

    const ember = getEmberCenter();
    const mDx = mouse.x - ember.x;
    const mDy = mouse.y - ember.y;
    const mDist = Math.hypot(mDx, mDy);
    const NEAR = 50, FAR = 260;
    const mouseInRange = mDist > NEAR && mDist < FAR;

    // лерп для возврата в центр
    const returnLerp = clamp(dt * 0.006, 0, 1);
    // лерп для вытягивания
    const peekLerp = clamp(dt * 0.004, 0, 1);

    switch (peek.state) {

      case 'idle': {
        // плавно в центр
        cursorLean.x += (0 - cursorLean.x) * returnLerp;
        cursorLean.y += (0 - cursorLean.y) * returnLerp;
        cursorLean.squish += (0 - cursorLean.squish) * returnLerp;
        cursorLean.scale += (1 - cursorLean.scale) * returnLerp;
        cursorLean.tiltX += (0 - cursorLean.tiltX) * returnLerp;
        cursorLean.tiltY += (0 - cursorLean.tiltY) * returnLerp;

        // кулдаун между циклами
        if (peek.cooldown > 0) { peek.cooldown -= dt; break; }

        if (mouseInRange && Math.random() < 0.0003 * dt) {
          peek.state = 'noticing';
          peek.noticeDelay = rand(400, 1200);
          peek.timer = 0;
        }
        break;
      }

      case 'noticing': {
        // пауза перед вытягиванием — «зорю»
        peek.timer += dt;
        // всё ещё в центре
        cursorLean.x += (0 - cursorLean.x) * returnLerp;
        cursorLean.y += (0 - cursorLean.y) * returnLerp;
        cursorLean.squish += (0 - cursorLean.squish) * returnLerp;
        cursorLean.scale += (1 - cursorLean.scale) * returnLerp;
        cursorLean.tiltX += (0 - cursorLean.tiltX) * returnLerp;
        cursorLean.tiltY += (0 - cursorLean.tiltY) * returnLerp;

        if (peek.timer >= peek.noticeDelay) {
          // вычислить цель наклона
          if (mouseInRange) {
            const n = normD(mDx, mDy, mDist);
            const closeness = easeOutQuad(clamp(1 - (mDist - NEAR) / (FAR - NEAR), 0, 1));
            peek.leanX = n.x * closeness * rand(18, 28);
            peek.leanY = n.y * closeness * rand(18, 28);
          } else {
            peek.leanX = 0;
            peek.leanY = 0;
          }
          peek.state = 'peeking';
          peek.leanProgress = 0;
          peek.timer = 0;
        }
        break;
      }

      case 'peeking': {
        // вытягиваемся к курсору
        peek.leanProgress = clamp(peek.leanProgress + dt * 0.0025, 0, 1);
        const ep = easeOutQuad(peek.leanProgress);

        cursorLean.x += (peek.leanX * ep - cursorLean.x) * peekLerp;
        cursorLean.y += (peek.leanY * ep - cursorLean.y) * peekLerp;

        // лёгкое наклонение «головой»
        const tiltTargetX = -peek.leanY * 0.3;
        const tiltTargetY = peek.leanX * 0.3;
        cursorLean.tiltX += (tiltTargetX - cursorLean.tiltX) * peekLerp;
        cursorLean.tiltY += (tiltTargetY - cursorLean.tiltY) * peekLerp;
        cursorLean.scale += (1.03 - cursorLean.scale) * peekLerp;
        cursorLean.squish += (0 - cursorLean.squish) * peekLerp;

        if (peek.leanProgress >= 1) {
          peek.state = 'looking';
          peek.timer = 0;
          peek.lookDuration = rand(600, 1800);
        }
        break;
      }

      case 'looking': {
        // «смотрю» — лёгкое покачивание на месте
        peek.timer += dt;
        const lookT = peek.timer / peek.lookDuration;

        const swayX = Math.sin(peek.timer * 0.003) * 2.5 * (1 - lookT);
        const swayY = Math.cos(peek.timer * 0.002 + 1) * 1.8 * (1 - lookT);

        cursorLean.x += ((peek.leanX + swayX) - cursorLean.x) * peekLerp;
        cursorLean.y += ((peek.leanY + swayY) - cursorLean.y) * peekLerp;

        // лёгкое «моргание» — кратковременная деформация в середине
        const blinkWindow = lookT > 0.4 && lookT < 0.6;
        const blinkPulse = blinkWindow ? Math.sin((lookT - 0.4) / 0.2 * Math.PI) : 0;
        cursorLean.squish += (blinkPulse * 0.12 - cursorLean.squish) * peekLerp;
        cursorLean.scale += ((1 - blinkPulse * 0.06) - cursorLean.scale) * peekLerp;

        if (peek.timer >= peek.lookDuration) {
          peek.state = 'blinking';
          peek.timer = 0;
          peek.blinkPhase = 0;
        }
        break;
      }

      case 'blinking': {
        // моргание перед втягиванием — быстрый squish
        peek.timer += dt;
        const bp = clamp(peek.timer / 180, 0, 1);

        const blinkSquish = bp < 0.5
          ? easeOutQuad(bp / 0.5) * 0.2
          : (1 - easeOutQuad((bp - 0.5) / 0.5)) * 0.2;

        cursorLean.squish += (blinkSquish - cursorLean.squish) * peekLerp;
        cursorLean.scale += ((1 - blinkSquish * 0.15) - cursorLean.scale) * peekLerp;
        cursorLean.x += (peek.leanX * (1 - bp * 0.3) - cursorLean.x) * peekLerp;
        cursorLean.y += (peek.leanY * (1 - bp * 0.3) - cursorLean.y) * peekLerp;

        if (peek.timer >= 180) {
          peek.state = 'retracting';
          peek.timer = 0;
          // случайное направление и сила прокрутки кольца
          ringImpulse = rand(2, 5) * (Math.random() < 0.5 ? 1 : -1);
        }
        break;
      }

      case 'retracting': {
        // втягиваемся обратно в кольцо
        peek.timer += dt;
        const rp = clamp(peek.timer / 500, 0, 1);
        const retractE = easeInOutQuad(rp);

        cursorLean.x += ((1 - retractE) * peek.leanX - cursorLean.x) * returnLerp;
        cursorLean.y += ((1 - retractE) * peek.leanY - cursorLean.y) * returnLerp;
        cursorLean.tiltX += (0 - cursorLean.tiltX) * returnLerp;
        cursorLean.tiltY += (0 - cursorLean.tiltY) * returnLerp;

        // сжимаемся при втягивании
        const retractSquish = Math.sin(rp * Math.PI) * 0.15;
        cursorLean.squish += (retractSquish - cursorLean.squish) * returnLerp;
        cursorLean.scale += ((1 - retractSquish * 0.2) - cursorLean.scale) * returnLerp;

        if (rp >= 1) {
          peek.state = 'idle';
          peek.cooldown = rand(15000, 50000);
          cursorLean.x = 0;
          cursorLean.y = 0;
          cursorLean.squish = 0;
          cursorLean.scale = 1;
          cursorLean.tiltX = 0;
          cursorLean.tiltY = 0;
        }
        break;
      }
    }

    // каретка при печати — дополнительный импульс к текущему lean
    if (caret.active && caret.typing && peek.state === 'idle') {
      const cDx = caret.x - ember.x;
      const cDy = caret.y - ember.y;
      const cDist = Math.hypot(cDx, cDy);
      if (cDist > 10 && cDist < 400) {
        const cn = normD(cDx, cDy, cDist);
        const cs = clamp(1 - cDist / 400, 0, 0.5);
        cursorLean.x += cn.x * cs * 4 * lerp;
        cursorLean.y += cn.y * cs * 3 * lerp;
      }
    }
  }

  // ---------- пасхалка ----------

  function getCaretRectSafe() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (r.collapsed) {
        const rect = r.getBoundingClientRect();
        if (rect.width || rect.height) return { x: rect.left + rect.width / 2, y: rect.top };
      }
    }
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
      const r = el.getBoundingClientRect();
      return { x: r.left + 12, y: r.top + 12 };
    }
    return null;
  }

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
    const ember = getEmberCenter();
    let targetX, targetY;
    if (targetOverride) {
      targetX = targetOverride.x;
      targetY = targetOverride.y;
    } else {
      const c = getCaretRectSafe();
      if (c) { targetX = c.x; targetY = c.y; }
      else {
        targetX = window.innerWidth / 2 + rand(-70, 70);
        targetY = window.innerHeight / 2 + rand(-50, 50);
      }
    }
    egg.active = true;
    egg.phase = 1;
    egg.phaseStart = performance.now();
    egg.startX = cursorLean.x;
    egg.startY = cursorLean.y;
    egg.caretX = targetX - ember.x;
    egg.caretY = targetY - ember.y;
    egg.x = cursorLean.x;
    egg.y = cursorLean.y;
    egg.scale = 1; egg.squish = 0; egg.tiltX = 0; egg.tiltY = 0;
    eggCharCount = 0;
  }

  // Сценарий: подлетает к каретке -> осматривается/разглядывает ->
  // схлопывается в точку -> телепортируется в кружок -> вырастает обратно.
  function updateEgg(now) {
    if (!egg.active) return;
    const t = now - egg.phaseStart;

    switch (egg.phase) {

      case 1: { // ЗАМАХ перед прыжком — приседает в сторону, противоположную цели
        const p = clamp(t / 260, 0, 1);
        const e = easeOutQuad(p);
        const dir = Math.sign(egg.caretX) || 1;
        egg.x = egg.startX - dir * 6 * e;
        egg.y = egg.startY + 4 * e;
        egg.scale = 1 - 0.12 * e;
        egg.squish = 0.18 * e;
        egg.tiltY = dir * 8 * e;
        if (p >= 1) { egg.phase = 2; egg.phaseStart = now; }
        break;
      }

      case 2: { // ПОЛЁТ к цели по дуге, вытянулся по направлению движения
        const p = clamp(t / 620, 0, 1);
        const e = easeOutQuad(p);
        egg.x = egg.startX + (egg.caretX - egg.startX) * e;
        egg.y = egg.startY + (egg.caretY - egg.startY) * e
                - Math.sin(p * Math.PI) * 26;
        egg.scale = 1.1 + Math.sin(p * Math.PI) * 0.1;
        egg.squish = -0.12 * Math.sin(p * Math.PI);
        const dir = Math.sign(egg.caretX - egg.startX) || 1;
        egg.tiltY = dir * 14 * (1 - p);
        egg.tiltX = -10 * Math.sin(p * Math.PI);
        if (p >= 1) { egg.phase = 3; egg.phaseStart = now; }
        break;
      }

      case 3: { // ПРИЗЕМЛЕНИЕ — пружинный сквош-стретч (затухающая пружина)
        const p = clamp(t / 520, 0, 1);
        const spring = Math.sin(p * Math.PI * 3) * (1 - p);
        egg.x = egg.caretX;
        egg.y = egg.caretY;
        egg.scale = 1 + spring * 0.12;
        egg.squish = spring * 0.35;
        egg.tiltX = 0; egg.tiltY = 0;
        if (p >= 1) { egg.phase = 4; egg.phaseStart = now; }
        break;
      }

      case 4: { // ОСМАТРИВАЕТСЯ — крутит головой, любопытные наклоны
        const p = clamp(t / 1600, 0, 1);
        egg.x = egg.caretX + Math.sin(p * Math.PI * 2) * 6;
        egg.y = egg.caretY + Math.sin(p * Math.PI * 4 + 1) * 3;
        egg.tiltY = Math.sin(p * Math.PI * 2) * 18;
        egg.tiltX = Math.sin(p * Math.PI * 3) * 10;
        egg.scale = 1.04 + Math.sin(p * Math.PI * 5) * 0.03;
        egg.squish = Math.max(0, Math.sin(p * Math.PI * 7)) * 0.06;
        if (p >= 1) { egg.phase = 5; egg.phaseStart = now; }
        break;
      }

      case 5: { // ДВОЙНОЙ ВЗГЛЯД — резко обернулся, замер
        const p = clamp(t / 420, 0, 1);
        const snap = p < 0.25 ? easeOutQuad(p / 0.25) : 1;
        egg.x = egg.caretX;
        egg.y = egg.caretY - snap * 2;
        egg.tiltY = -22 * snap;
        egg.tiltX = 6 * snap;
        egg.scale = 1.06 + (p < 0.25 ? 0.08 * snap : 0);
        egg.squish = p < 0.25 ? -0.1 * snap : 0;
        if (p >= 1) { egg.phase = 6; egg.phaseStart = now; }
        break;
      }

      case 6: { // НАБИРАЕТ ВОЗДУХ — раздулся перед схлопыванием
        const p = clamp(t / 240, 0, 1);
        egg.x = egg.caretX; egg.y = egg.caretY;
        egg.tiltX = 0; egg.tiltY = 0;
        egg.scale = 1.06 + easeOutQuad(p) * 0.3;
        egg.squish = -0.12 * p;
        if (p >= 1) { egg.phase = 7; egg.phaseStart = now; }
        break;
      }

      case 7: { // СХЛОПЫВАНИЕ в точку
        const p = clamp(t / 240, 0, 1);
        egg.x = egg.caretX; egg.y = egg.caretY;
        egg.scale = 1.36 - easeInQuad(p) * 1.32;
        egg.squish = easeInQuad(p) * 0.6;
        if (p >= 1) { egg.phase = 8; egg.phaseStart = now; }
        break;
      }

      case 8: { // ТЕЛЕПОРТ — мгновенно дома, держим точку
        egg.x = 0; egg.y = 0; egg.scale = 0.04; egg.squish = 0.5;
        egg.tiltX = 0; egg.tiltY = 0;
        if (t > 90) { egg.phase = 9; egg.phaseStart = now; }
        break;
      }

      case 9: { // «ПШИК» — раздулся обратно
        const p = clamp(t / 420, 0, 1);
        const e = easeOutQuad(p);
        egg.x = 0; egg.y = 0;
        egg.scale = 0.04 + e * 0.96 + Math.sin(p * Math.PI) * 0.14;
        egg.squish = (1 - e) * 0.5 - Math.sin(p * Math.PI) * 0.1;
        if (p >= 1) { egg.scale = 1; egg.squish = 0; egg.active = false; }
        break;
      }
    }
  }

  // ---------- ПКМ тестирование ----------

  const TEST_EFFECTS = [
    'sigh', 'calmBurn', 'wiggle', 'tilt', 'microShift',
    'crackle', 'stretch', 'glint', 'sleepySag',
    'smolder', 'heatRadiance', 'glowPulse', 'ashDrift', 'gust',
    'typingApproach',
    'eggFly',
    'shootingSpark', 'crumb',
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
      glowPulse: [2000, 3000], ashDrift: [3000, 4000], gust: [1200, 1800],
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
        gust: { power: rand(0.6, 1) },
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

    if (['crackle', 'glowPulse', 'calmBurn', 'gust'].includes(type)) {
      for (let i = 0; i < 6; i++) setTimeout(() => spawnSpark(), i * 130);
    }
    if (type === 'gust') {
      for (let i = 0; i < 3; i++) setTimeout(() => spawnShootingSpark(), i * 200);
      for (let i = 0; i < 4; i++) setTimeout(() => spawnCrumb(), i * 250);
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
      startEgg();
    }
    if (type === 'shootingSpark') {
      for (let i = 0; i < 5; i++) setTimeout(() => spawnShootingSpark(), i * 200);
    }
    if (type === 'crumb') {
      for (let i = 0; i < 6; i++) setTimeout(() => spawnCrumb(), i * 200);
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

    // вращение кольца — медленное, только при наведении + импульс от втягивания
    ringAngle += dt * 0.0003 * hoverVal / sleepSlowdown();
    ringAngle += dt * 0.008 * ringImpulse / sleepSlowdown();
    ringEl.style.setProperty('--ringRot', (ringAngle * 57.2958 % 360).toFixed(2) + 'deg');

    if (egg.active) {
      updateEgg(now);
      applyEggVars();
      applySegments();
      advanceSegEffects(dt);
      applySegEffects();
      updateParticles(now, dt);
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
    const breathScale = 1 + Math.sin(breathPhase * 2.5) * 0.012 * intensity + hoverBreath + windGust * 0.04;

    updateHeatZones(dt);
    updateHotspots(now, dt);
    updateWind(now, dt);
    if (heatBoost > 0) heatBoost = Math.max(0, heatBoost - 0.00025 * dt);

    // --- запуск эффектов ядра с рандомными параметрами ---
    if (!testMode) {
      tryStart('sigh', 0.5, [4000, 5000], () => ({ mag: rand(0.04, 0.08), glow: rand(0.15, 0.28) }));
      tryStart('calmBurn', 0.8, [2000, 3000], () => ({ mag: rand(0.05, 0.1), hue: rand(-6, 12) }));
      if (intensity > 0.5 && !reduceMotion) tryStart('wiggle', 0.3, [700, 1100], () => ({ amp: rand(0.9, 1.3) }));
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
      tryStart('gust', 0.15, [1200, 1800], () => ({ power: rand(0.6, 1) }));
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
    const gust = advanceEffect('gust', dt);

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

    const gustMult = gust ? bump(gust.phase, 0.2, 0.6) * (gust.power ?? 0.8) * tm : 0;
    const gustHue = gust ? bump(gust.phase, 0.15, 0.5) * 20 * tm : 0;
    const gustBright = gust ? bump(gust.phase, 0.15, 0.5) * 0.5 * tm : 0;

    const glow = clamp(intensity + heatBoost * 0.3 + sighGlow + hoverVal * 0.15 + radianceGlow + glowPulseMult + gustMult * 0.6 + windGust * 0.2, 0, 1.8);

    const brightness = clamp(
      0.7 + intensity * 0.3 + calmBright + sighBright + crackleBright + sleepyBright
      + heatBoost * 0.4 + hoverVal * 0.15 + gustBright + windGust * 0.3,
      0.35, 2.5
    );

    // цветовая температура по жизни угля
    const coreHue = 15 + intensity * 35;
    const coreLight = 35 + intensity * 35;
    root.style.setProperty('--coreHue', coreHue.toFixed(1));
    root.style.setProperty('--coreLight', coreLight.toFixed(1) + '%');

    // зола, нарастающая со временем — сереет к концу жизни
    const ashRaw = clamp(1 - intensity, 0, 1);
    const ashCoverage = ashRaw * ashRaw * (3 - 2 * ashRaw);
    root.style.setProperty('--ashCoverage', ashCoverage.toFixed(3));

    // трещины — пульсация с дыханием, ярче при нагреве
    const crackGlow = 0.4 + Math.sin(breathPhase * 2.5) * 0.3 + heatBoost * 1.5 + windGust * 0.4;
    crackEl.style.setProperty('--crackGlow', crackGlow.toFixed(3));

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
    root.style.setProperty('--glowOpacity', (1 + hoverVal * 0.15 + radianceGlow + windGust * 0.2).toFixed(3));
    root.style.setProperty('--glowBlur', (5 + hoverVal * 1.5 + radianceGlow * 3 + windGust * 2).toFixed(2) + 'px');
    root.style.setProperty('--glowScale', (1 + hoverVal * 0.08 + radianceGlow * 0.15 + glowPulseMult * 0.1 + windGust * 0.06).toFixed(3));
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

    const totalHue = glintHue + smolderHue + calmHue + gustHue;
    const totalSat = glintSat + smolderSat;
    if (totalHue || totalSat) {
      coreEl.style.filter = `brightness(var(--brightness)) hue-rotate(${totalHue.toFixed(1)}deg) saturate(${(1 + totalSat).toFixed(3)})`;
    } else {
      coreEl.style.filter = 'brightness(var(--brightness))';
    }

    applySegments();

    if (!reduceMotion) {
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

      if (Date.now() > nextAshSpawn) {
        if (Math.random() < 0.88) spawnAshParticle();
        if (intensity > 0.6 && Math.random() < 0.3) spawnAshParticle();
        nextAshSpawn = Date.now() + rand(280, 720);
      }

      if (Date.now() > nextSparkCheck) {
        if (Math.random() < 0.5 * (0.4 + intensity * 0.6)) spawnSpark();
        if (intensity > 0.6 && Math.random() < 0.08) spawnShootingSpark();
        if (intensity < 0.5 && Math.random() < 0.12) spawnCrumb();
        nextSparkCheck = Date.now() + rand(1400, 3800);
      }

      updateParticles(now, dt);
      updateShimmer(now);
    }

    if (!nextAriaUpdate || now > nextAriaUpdate) {
      const label = describe();
      root.setAttribute('aria-label', label);
      root.title = label;
      nextAriaUpdate = now + 60000;
    }
  }

  function animate(timestamp) {
    if (!root) return;
    if (lastFrame === 0) lastFrame = timestamp;
    const dt = Math.min(timestamp - lastFrame, 50);
    lastFrame = timestamp;
    try { update(timestamp, dt); } catch (e) { console.error('Ember update error:', e); }
    rafId = requestAnimationFrame(animate);
  }

  function startLoop() {
    if (rafId) return;
    lastFrame = 0;
    rafId = requestAnimationFrame(animate);
  }
  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
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
    handlers.mouseenter = () => { hover = true; };
    handlers.mouseleave = () => { hover = false; };
    handlers.rootFocus = () => { hover = true; };
    handlers.rootBlur = () => { hover = false; };
    handlers.contextmenu = (e) => { e.preventDefault(); if (!testMode) startTestMode(); };

    root.addEventListener('mouseenter', handlers.mouseenter);
    root.addEventListener('mouseleave', handlers.mouseleave);
    root.addEventListener('focus', handlers.rootFocus);
    root.addEventListener('blur', handlers.rootBlur);
    root.addEventListener('contextmenu', handlers.contextmenu);

    const isEditable = (el) =>
      el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);

    handlers.input = (e) => {
      if (isEditable(e.target)) {
        handleInput();
        caret.typing = true;
        clearTimeout(caret._typingTimer);
        caret._typingTimer = setTimeout(() => { caret.typing = false; }, 1500);
      }
    };
    handlers.mousemove = (e) => {
      if (!browserFocused) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 200;
      mouse.x = clamp(e.clientX, -margin, vw + margin);
      mouse.y = clamp(e.clientY, -margin, vh + margin);
    };
    handlers.selectionchange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { caret.active = false; return; }
      const range = sel.getRangeAt(0);
      caret.active = range.collapsed;
    };
    handlers.windowFocus = () => { browserFocused = true; };
    handlers.windowBlur = () => { browserFocused = false; };
    handlers.visibilitychange = () => {
      if (document.hidden) { browserFocused = false; stopLoop(); }
      else { browserFocused = true; if (onScreen) startLoop(); }
    };

    document.addEventListener('input', handlers.input);
    document.addEventListener('mousemove', handlers.mousemove);
    document.addEventListener('selectionchange', handlers.selectionchange);
    window.addEventListener('focus', handlers.windowFocus);
    window.addEventListener('blur', handlers.windowBlur);
    document.addEventListener('visibilitychange', handlers.visibilitychange);
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

    io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen && browserFocused && !document.hidden) startLoop();
      else stopLoop();
    }, { threshold: 0 });
    io.observe(root);

    prevRemaining = remainingSegments();
    spawnStart = performance.now();
    lastFrame = 0;

    ['segTremor', 'segTryIgnite', 'segHeatRipple', 'segFlicker', 'segHeatWave']
      .forEach(rescheduleSegDue);

    startLoop();
  }

  function destroy() {
    stopLoop();
    if (io) { io.disconnect(); io = null; }
    if (channel) { try { channel.close(); } catch {} }
    window.removeEventListener('storage', handlers.storageSync);
    clearTimeout(resetTimer);
    clearTimeout(caret._typingTimer);
    particles.forEach(p => p.el.remove());
    particles = [];
    activeSparks = 0;

    root.removeEventListener('mouseenter', handlers.mouseenter);
    root.removeEventListener('mouseleave', handlers.mouseleave);
    root.removeEventListener('focus', handlers.rootFocus);
    root.removeEventListener('blur', handlers.rootBlur);
    root.removeEventListener('contextmenu', handlers.contextmenu);
    document.removeEventListener('input', handlers.input);
    document.removeEventListener('mousemove', handlers.mousemove);
    document.removeEventListener('selectionchange', handlers.selectionchange);
    window.removeEventListener('focus', handlers.windowFocus);
    window.removeEventListener('blur', handlers.windowBlur);
    document.removeEventListener('visibilitychange', handlers.visibilitychange);
    handlers = {};
  }

  return { init, destroy, notifyEdit };
})();