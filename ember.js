// file_name: ember.js
//
// "Уголёк" — живой индикатор состояния проекта.
// Один rAF-цикл: update() -> applyVariables() -> requestAnimationFrame.

const Ember = (() => {
  'use strict';

  const LIFE = 7 * 24 * 60 * 60 * 1000;
  const STORAGE_KEY_PREFIX = 'ember-state-';
  const BROADCAST_KEY = 'ember-sync';

  const PRIORITY = {
    startle: 0, sigh: 1, calmBurn: 2, wiggle: 3, tilt: 4, microShift: 5,
    crackle: 6, stretch: 7, glint: 8, sleepySag: 9,
    smolder: 10, heatRadiance: 11, glowPulse: 12, ashDrift: 13, gust: 14,
  };
  const MAX_EFFECTS = 3;

  let state = null;
  let currentTabId = null;
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
  let glintEl = null;
  let particleLayer = null;
  let hotspots = [];
  let windGust = 0;
  let heatWaveEl = null;
  let hotAttnEl = null;
  let statusState = null;
  let statusTimer = null;
  let statusSince = 0;
  let statusUntil = 0;
  let statusBurstDone = false;

  let hover = false;
  let hoverVal = 0;
  let intensity = 1;
  let breathPhase = 0;
  let breathScale = 1;
  let heat = 1;
  let crackGlowMod = 0;
  let ashCoverage = 0;
  let spawnCore = 1;
  let spawnGlow = 1;
  let spawnRing = 1;

  let heatOffsetX = 0, heatOffsetY = 0;
  let heatTargetX = 0, heatTargetY = 0;
  let nextHeatShift = 0;
  let heatPhase = 0;
  const heatPhaseSpeed = 0.0009;

  let residualHeat = 0;

  let breathPattern = [1, 0.8, 1.2, 0.5, 0.9];
  let breathPatternIdx = 0;
  let nextBreathSwitch = 0;

  const attn = {
    state: 'idle', timer: 0, dirX: 0,
    hotX: 50, hotY: 50, hotHeat: 0,
    activeHsIdx: -1,
  };

  let typedChars = 0;
  let heatBoost = 0;
  let resetTimer = null;

  let prevRemaining = 12;
  let spawnStart = 0;
  let lastWarnRemaining = 12;

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

  const POOL_SIZE = 25;
  let particlePool = [];
  let poolInited = false;

  let shimmerActive = false;
  let shimmerEnd = 0;
  let nextShimmerCheck = 0;
  let nextAriaUpdate = 0;

  let ringAngle = 0;
  let browserFocused = true;
  let onScreen = true;
  let io = null;
  let hasActiveSquash = false;

  let glowTrackX = 0, glowTrackY = 0;
  let ashTrackX = 0, ashTrackY = 0;
  let hazeTrackX = 0;
  let emberMood = 'calm';
  let lastMoodCheck = 0;

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

  // испуг при раскрытии превью
  const previewScare = {
    active: false, phase: 0, phaseStart: 0,
    recoilX: 0, recoilY: 0,
    sparksToEmit: 0, ashToEmit: 0,
    sparksEmitted: 0, ashEmitted: 0,
    ringHugAmt: 0, phase1Dur: 500,
  };

  let channel = null;
  let rafId = null;
  let lastFrame = 0;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let handlers = {};
  let onClickCallback = null;

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

  function getStorageKey(tabId) {
    return STORAGE_KEY_PREFIX + (tabId || 'unknown');
  }

  function loadState(tabId) {
    try {
      const raw = localStorage.getItem(getStorageKey(tabId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.lastEditTime === 'number') return parsed;
      }
    } catch {}
    return { lastEditTime: Date.now() };
  }

  function saveState() {
    try { localStorage.setItem(getStorageKey(currentTabId), JSON.stringify(state)); } catch {}
  }

  function broadcast() {
    try { channel && channel.postMessage({ type: 'update', tabId: currentTabId, state }); } catch {}
  }

  function setupBroadcast() {
    try {
      channel = new BroadcastChannel(BROADCAST_KEY);
      channel.onmessage = (e) => {
        if (e.data?.type === 'update' && e.data?.tabId === currentTabId && e.data?.state) {
          state = e.data.state;
        }
      };
    } catch {}
    handlers.storageSync = (e) => {
      if (e.key === getStorageKey(currentTabId) && e.newValue) {
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
    state.lastInitTime = Date.now();
    saveState();
    broadcast();
  }

  function setStatus(type) {
    clearTimeout(statusTimer);
    statusState = type;
    statusSince = performance.now();
    statusBurstDone = false;
    if (type === 'saving' || type === 'saved' || type === 'error') {
      const dur = type === 'error' ? 2500 : 1500;
      statusUntil = performance.now() + dur;
      statusTimer = setTimeout(() => { statusState = null; statusUntil = 0; }, dur);
    } else {
      statusUntil = 0;
    }
  }

  function applyStatus() {
    if (!statusState) return;
    const now = performance.now();
    switch (statusState) {
      case 'dirty':
        heatBoost = Math.max(heatBoost, 0.05);
        break;
      case 'saving': {
        const pulse = Math.sin(now * 0.005) * 0.5 + 0.5;
        heatBoost = Math.max(heatBoost, pulse * 0.15);
        break;
      }
      case 'saved': {
        if (!statusBurstDone) {
          statusBurstDone = true;
          heatBoost = Math.max(heatBoost, 0.3);
          for (let i = 0; i < 4; i++) setTimeout(spawnSpark, i * 80);
        }
        break;
      }
      case 'error': {
        heatBoost = Math.max(heatBoost - 0.1, 0);
        break;
      }
    }
  }

  function switchTab(newTabId) {
    if (newTabId === currentTabId) return;
    if (currentTabId) saveState();
    currentTabId = newTabId;
    state = loadState(currentTabId);
    spawnStart = performance.now();
    prevRemaining = remainingSegments();
    lastWarnRemaining = remainingSegments();
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

  function resetDomRefs() {
    root = null;
    segments = [];
    zones = [];
    hotspots = [];
    crackLayers = [];
    glowEl = null;
    ringEl = null;
    coreEl = null;
    crustEl = null;
    crackEl = null;
    ashEl = null;
    hazeEl = null;
    particleLayer = null;
    heatWaveEl = null;
    hotAttnEl = null;
  }

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
    coreEl.style.setProperty('--deformPhase', (-rand(0, 4)).toFixed(2) + 's');
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

    crackLayers = [];
    const crackDefs = [
      'linear-gradient(137deg, transparent 42%, rgba(255,180,60,0.9) 42.5%, rgba(255,180,60,0.9) 43%, transparent 43.5%)',
      'linear-gradient(53deg, transparent 55%, rgba(255,140,40,0.7) 55.3%, rgba(255,140,40,0.7) 55.7%, transparent 56%)',
      'linear-gradient(170deg, transparent 30%, rgba(255,200,80,0.6) 30.2%, rgba(255,200,80,0.6) 30.6%, transparent 30.8%)',
      'linear-gradient(95deg, transparent 65%, rgba(255,160,50,0.5) 65.2%, rgba(255,160,50,0.5) 65.5%, transparent 65.7%)',
    ];
    crackDefs.forEach((bg) => {
      const layer = document.createElement('div');
      layer.className = 'ember-crack-layer';
      layer.style.background = bg;
      coreEl.appendChild(layer);
      crackLayers.push({ el: layer, baseOpacity: 0.5, ignited: false, igniteStart: 0, igniteDur: 0 });
    });

    ashEl = document.createElement('div');
    ashEl.className = 'ember-ash-overlay';
    coreEl.appendChild(ashEl);

    glintEl = document.createElement('div');
    glintEl.className = 'ember-glint';
    coreEl.appendChild(glintEl);

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

    heatWaveEl = document.createElement('div');
    heatWaveEl.className = 'ember-heatwave';
    coreEl.appendChild(heatWaveEl);

    hotAttnEl = document.createElement('div');
    hotAttnEl.className = 'ember-hotspot attn-hotspot';
    hotAttnEl.style.opacity = '0';
    coreEl.appendChild(hotAttnEl);

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

    zones.forEach((zone, i) => {
      if (!zone._life) {
        zone._life = rand(4000, 10000);
        zone._targetHeat = rand(0.4, 1.3);
        zone._targetX = rand(20, 80);
        zone._targetY = rand(20, 80);
        zone._curHeat = 0.6;
        zone._curX = 50;
        zone._curY = 50;
      }
      zone._life -= dt;
      if (zone._life <= 0) {
        zone._life = rand(4000, 10000);
        zone._targetHeat = rand(0.4, 1.3);
        zone._targetX = rand(20, 80);
        zone._targetY = rand(20, 80);
        if (Math.random() < 0.1 && zones.length < 6) {
          const nz = document.createElement('div');
          nz.className = 'heat-zone';
          coreEl.insertBefore(nz, crustEl);
          zones.push(nz);
          nz._life = rand(2000, 5000);
          nz._targetHeat = rand(0.3, 0.9);
          nz._targetX = rand(20, 80);
          nz._targetY = rand(20, 80);
          nz._curHeat = 0.3;
          nz._curX = zone._curX;
          nz._curY = zone._curY;
        }
      }
      const lerpSpeed = 0.0015 * dt;
      zone._curHeat += (zone._targetHeat - zone._curHeat) * clamp(lerpSpeed, 0, 1);
      zone._curX += (zone._targetX - zone._curX) * clamp(lerpSpeed * 0.8, 0, 1);
      zone._curY += (zone._targetY - zone._curY) * clamp(lerpSpeed * 0.8, 0, 1);
      zone.style.setProperty('--cx', clamp(zone._curX, 10, 90).toFixed(1) + '%');
      zone.style.setProperty('--cy', clamp(zone._curY, 10, 90).toFixed(1) + '%');
      zone.style.setProperty('--zoneHeat', clamp(zone._curHeat, 0, 1.5).toFixed(3));
    });
    const avgHeat = zones.reduce((s, z) => s + (z._curHeat || 0.6), 0) / Math.max(zones.length, 1);
    if (crustEl) crustEl.style.opacity = (0.5 + (1 - intensity) * 0.4 - avgHeat * 0.15).toFixed(3);
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
    if (Math.random() < 0.35) { rescheduleDue(type); return; }
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
    const eff = active.get(type);
    if (eff.mag !== undefined) eff.mag *= rand(0.7, 1.4);
    if (eff.side !== undefined && Math.random() < 0.15) eff.side *= -1;
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

  // ---------- система поз ----------

  function createPose() {
    return {
      x: 0, y: 0,
      scaleX: 1, scaleY: 1,
      squash: 0,
      rotate: 0,
      tiltX: 0, tiltY: 0,
      glow: 0, brightness: 0,
      hue: 0, saturation: 0,
      glowSkewX: 0, glowSkewY: 0,
      glowX: 0, glowY: 0,
      crustX: 0, crustY: 0, crustRot: 0, crustScale: 1,
      ashShiftX: 0, ashShiftY: 0, ashRot: 0,
      ringExpand: 0,
      segScaleX: 1, segScaleY: 1,
      glintOpacity: 0, glintX: 58, glintY: 32, glintRot: -18, glintScale: 1,
      massShiftX: 0, massShiftY: 0,
      upperBulge: 0, lowerSag: 0, sideBulge: 0,
    };
  }

  function applySighPose(pose, eff) {
    const p = eff.phase;
    const inhale = p < 0.35 ? easeOutQuad(p / 0.35) : 0;
    const exhale = p > 0.45 ? easeOutQuad((p - 0.45) / 0.55) : 0;
    const w = eff._geomWeight ?? 1;
    pose.squash += (-inhale * 0.15 + exhale * 0.12) * w;
    pose.scaleX *= 1 + (-inhale * 0.04 + exhale * 0.08) * w;
    pose.y += (-inhale * 1.2 + exhale * 1.4) * w;
    pose.rotate += Math.sin(p * Math.PI * 2) * 1.2 * (1 - p) * w;
    pose.massShiftY += exhale * 0.8;
    pose.lowerSag += exhale * 0.6;
    const k = bump(p, 0.25, 0.75);
    pose.glow += k * (eff.glow ?? 0.2);
    pose.brightness += k * 0.12;
    if (p > 0.5 && p < 0.55 && !eff.ashDone) {
      eff.ashDone = true;
      for (let i = 0; i < 3; i++) setTimeout(spawnAshParticle, i * 80);
    }
  }

  function applyCalmBurnPose(pose, eff) {
    const k = bump(eff.phase, 0.25, 0.75);
    const sway = Math.sin(eff.phase * Math.PI * 2) * 0.8;
    const w = eff._geomWeight ?? 1;
    pose.x += sway * 0.4 * w;
    pose.y += Math.sin(eff.phase * Math.PI) * -0.4 * w;
    pose.scaleX *= 1 + k * 0.035 * w;
    pose.squash += -k * 0.08 * w;
    pose.massShiftX += sway * 0.3;
    pose.rotate += sway * 0.4 * w;
    pose.brightness += k * 0.15;
    pose.hue += k * (eff.hue ?? 0);
  }

  function applyWigglePose(pose, eff) {
    const p = eff.phase;
    const decay = 1 - p;
    const shake = Math.sin(p * Math.PI * 8) * decay;
    const amp = eff.amp ?? 1;
    const w = eff._geomWeight ?? 1;
    pose.x += shake * 1.4 * amp * w;
    pose.rotate += shake * 5 * amp * w;
    pose.scaleX *= 1 + Math.abs(shake) * 0.04 * amp * w;
    pose.squash += shake * 0.06 * amp * w;
    pose.massShiftX += shake * 0.6 * amp;
    pose.sideBulge += Math.abs(shake) * 0.3 * amp;
    pose.crustX = -shake * 0.7;
    pose.ashShiftX = shake * 1.2;
  }

  function applyTiltPose(pose, eff) {
    const p = eff.phase;
    const k = Math.sin(p * Math.PI);
    const dir = Math.sign(eff.target || 1);
    pose.rotate += dir * k * 5;
    pose.x += dir * k * 1.2;
    pose.squash += -k * 0.06;
  }

  function applyMicroShiftPose(pose, eff) {
    const p = eff.phase;
    const dir = Math.sign(eff.dx || 1);
    const push = Math.sin(p * Math.PI);
    const snap = Math.sin(p * Math.PI * 2) * (1 - p);
    pose.x += dir * push * 1.2;
    pose.squash += -push * 0.1;
    pose.rotate += dir * snap * 2;
  }

  let crackLayers = [];

  function igniteCrackSide(side) {
    const leftLayers = [0, 2];
    const rightLayers = [1, 3];
    const pool = side < 0 ? leftLayers : rightLayers;
    const idx = pool[Math.floor(Math.random() * pool.length)];
    const layer = crackLayers[idx];
    if (!layer) return;
    layer.ignited = true;
    layer.igniteStart = performance.now();
    layer.igniteDur = rand(220, 420);
  }

  function updateCrackLayers(now, crackGlow) {
    crackLayers.forEach(layer => {
      let opacity = crackGlow;
      if (layer.ignited) {
        const t = clamp((now - layer.igniteStart) / layer.igniteDur, 0, 1);
        if (t >= 1) { layer.ignited = false; }
        else { opacity = Math.min(1, crackGlow + (1 - crackGlow) * (1 - t) * 1.5); }
      }
      layer.el.style.opacity = clamp(opacity, 0, 1).toFixed(3);
    });
  }

  function applyCracklePose(pose, eff) {
    const p = eff.phase;
    const mag = eff.mag ?? 1;
    const side = eff.side ?? (Math.random() < 0.5 ? -1 : 1);

    const snap = p < 0.08 ? easeOutQuad(p / 0.08) : 0;
    const bulge = p >= 0.08 && p < 0.22 ? Math.sin((p - 0.08) / 0.14 * Math.PI) : 0;
    const tremor = p >= 0.22 ? Math.sin((p - 0.22) * 40) * Math.exp(-(p - 0.22) * 6) : 0;

    const w = eff._geomWeight ?? 1;
    pose.squash += (-snap * 0.6 + bulge * 0.45) * mag * w;
    pose.scaleX *= 1 + (bulge * 0.16 - snap * 0.05) * mag * w;
    pose.x += side * (bulge * 1.2 + tremor * 0.6 + 2.5) * mag * w;
    pose.rotate += side * tremor * 7 * mag * w;
    pose.massShiftX += side * bulge * 1.5 * mag;
    pose.upperBulge += bulge * 0.8 * mag;
    pose.sideBulge += snap * 0.5 * mag;
    pose.brightness += (snap + bulge * 0.7) * mag;

    if (!eff.crackFired && p > 0.1 && p < 0.15) {
      eff.crackFired = true;
      igniteCrackSide(side);
      setTimeout(() => spawnSpark(side > 0 ? 0.7 : 0.3), 40);
      setTimeout(() => spawnAshParticle(), 50);
      setTimeout(() => spawnAshParticle(), 140);
      residualHeat += 0.2;
      pose.crustX += rand(-1.5, 1.5) * mag;
      pose.crustRot += rand(-2, 2) * mag;
      spawnCrumb();
    }
  }

  function applyStretchPose(pose, eff) {
    const p = eff.phase;
    const amp = eff.amp ?? 1;
    const crouch = p < 0.2 ? easeOutQuad(p / 0.2) : 0;
    const reach = p > 0.15 && p < 0.6 ? Math.sin((p - 0.15) / 0.45 * Math.PI) : 0;
    const settle = p > 0.55 ? easeOutQuad((p - 0.55) / 0.45) : 0;

    const w = eff._geomWeight ?? 1;
    pose.squash += (-reach * 0.6 + crouch * 0.2) * amp * w;
    pose.scaleX *= 1 + (crouch * 0.1 - reach * 0.06 + settle * 0.06) * w;
    pose.y += (crouch * 1.2 - reach * 1.6 + settle * 0.8) * w;
    pose.massShiftY += (-reach * 1.2 + crouch * 0.5) * amp;
    pose.upperBulge += reach * 0.9 * amp;
    pose.rotate += Math.sin(p * Math.PI * 2) * 2 * (1 - p) * w;
    pose.glowY -= reach * 2;
    pose.glintX += reach * 8;
  }

  function applyGlintPose(pose, eff) {
    const k = bump(eff.phase, 0.2, 0.55);
    pose.glintOpacity = k;
    pose.glintX = 45 + k * 20 + eff.phase * 10;
    pose.glintScale = 1 + k * 0.8;
    pose.squash += -k * 0.1;
    pose.scaleX *= 1 + k * 0.025;
    pose.hue += k * (eff.hue ?? 25);
    pose.saturation += k * (eff.sat ?? 0.4);
  }

  function applySleepySagPose(pose, eff) {
    const p = eff.phase;
    const sag = bump(p, 0.35, 0.8);
    const nod = Math.sin(p * Math.PI * 3) * (1 - p);
    const w = eff._geomWeight ?? 1;
    pose.y += sag * 1.8 * w;
    pose.squash += sag * 0.25 * w;
    pose.scaleX *= 1 + sag * 0.08 * w;
    pose.massShiftY += sag * 1.0;
    pose.lowerSag += sag * 0.7;
    pose.rotate += (sag * 4 + nod * 2) * w;
    pose.brightness -= sag * 0.2;
  }

  function applySmolderPose(pose, eff) {
    const k = bump(eff.phase, 0.25, 0.85);
    const inner = Math.sin(eff.phase * Math.PI * 2.5) * 0.5 + 0.5;
    pose.scaleX *= 1 + k * inner * 0.04;
    pose.scaleY *= 1 - k * inner * 0.03;
    pose.squash += k * inner * 0.06;
    pose.massShiftY -= k * inner * 0.5;
    pose.sideBulge += k * inner * 0.4;
    pose.hue += k * (eff.hue ?? 20);
    pose.saturation += k * (eff.sat ?? 0.25);
    crackGlowMod += k * inner * 0.8;
  }

  function applyHeatRadiancePose(pose, eff) {
    const k = bump(eff.phase, 0.3, 0.7);
    pose.glow += k * 0.4;
    pose.ringExpand += k * 2.5;
    pose.glowY -= k * 2;
    pose.glowSkewX += Math.sin(eff.phase * Math.PI * 3) * 8;
    pose.squash += -k * 0.05;
    pose.scaleX *= 1 + k * 0.01;
  }

  function applyGlowPulsePose(pose, eff) {
    const p = eff.phase;
    const beat1 = Math.exp(-Math.pow((p - 0.25) / 0.08, 2));
    const beat2 = Math.exp(-Math.pow((p - 0.48) / 0.11, 2));
    const beat = beat1 * 0.5 + beat2;
    pose.scaleX *= 1 + beat * 0.05;
    pose.squash += -beat * 0.15;
    pose.y -= beat * 0.5;
    pose.glow += beat * 0.8;
    pose.ringExpand += beat * 4;
  }

  function applyAshDriftPose(pose, eff) {
    const k = bump(eff.phase, 0.2, 0.8);
    const dx = (eff.dx ?? 0) * k;
    pose.ashShiftX = dx * 2.2;
    pose.ashShiftY = Math.sin(eff.phase * Math.PI) * 0.5;
    pose.ashRot = dx * 4;
    pose.crustX = dx * 0.3;
    pose.crustRot = -dx * 0.4;
    pose.squash += Math.abs(dx) * 0.03;
    pose.rotate -= dx * 0.4;
    if (k > 0.6 && !eff.spawned) {
      eff.spawned = true;
      spawnAshParticle();
    }
  }

  function applyGustPose(pose, eff) {
    const k = bump(eff.phase, 0.15, 0.6);
    const dir = eff.dir ?? 1;
    const w = eff._geomWeight ?? 1;
    pose.x += dir * k * 2.2 * w;
    pose.rotate += dir * k * 8 * w;
    pose.scaleX *= 1 + k * 0.08 * w;
    pose.squash += -k * 0.12 * w;
    pose.massShiftX += dir * k * 1.0;
    pose.sideBulge += k * 0.6;
    pose.glowSkewX += dir * k * 12;
    pose.glowX += dir * k * 3;
    pose.brightness += k * 0.5;
    pose.hue += k * 20;
  }

  function commitPose(pose, now, dt) {
    glowTrackX += (pose.glowX - glowTrackX) * 0.08;
    glowTrackY += (pose.glowY - glowTrackY) * 0.08;
    ashTrackX += (pose.ashShiftX - ashTrackX) * 0.03;
    ashTrackY += (pose.ashShiftY - ashTrackY) * 0.03;
    hazeTrackX += (pose.x * 0.1 - hazeTrackX) * 0.015;
    pose.glow += residualHeat;

    const shiftX = heatOffsetX * 0.6 + pose.x * 0.1 + ashTrackX * 0.3;
    const shiftY = heatOffsetY * 0.6 - hoverVal * 0.5 + pose.y * 0.1;

    root.style.setProperty('--shiftX', shiftX.toFixed(2) + 'px');
    root.style.setProperty('--shiftY', shiftY.toFixed(2) + 'px');

    const sq = clamp(pose.squash, -1, 1);
    const absSq = Math.abs(sq);
    const stretchK = 1 + absSq * 0.55;
    const squashX = absSq > 0.005 ? (sq > 0 ? stretchK : 1 / stretchK) : 1;
    const squashY = absSq > 0.005 ? (sq > 0 ? 1 / stretchK : stretchK) : 1;
    root.style.setProperty('--scaleX', (pose.scaleX * breathScale * cursorLean.scale * spawnCore * squashX).toFixed(4));
    root.style.setProperty('--scaleY', (pose.scaleY * breathScale * cursorLean.scale * spawnCore * squashY).toFixed(4));
    root.style.setProperty('--rotation', (tiltCurrent + pose.rotate).toFixed(2) + 'deg');
    root.style.setProperty('--tiltX', (pose.tiltX + cursorLean.tiltX).toFixed(2) + 'deg');
    root.style.setProperty('--tiltY', (tiltCurrent * 0.6 + pose.tiltY + cursorLean.tiltY).toFixed(2) + 'deg');

    const glow = clamp(intensity + heatBoost * 0.3 + pose.glow + hoverVal * 0.15 + windGust * 0.2, 0, 1.8);
    const brightness = clamp(0.7 + intensity * 0.3 + pose.brightness + heatBoost * 0.4 + hoverVal * 0.15 + windGust * 0.3, 0.35, 2.5);

    root.style.setProperty('--heat', heat.toFixed(3));
    root.style.setProperty('--glow', glow.toFixed(3));
    root.style.setProperty('--intensity', intensity.toFixed(3));
    root.style.setProperty('--hover', hoverVal.toFixed(3));
    root.style.setProperty('--brightness', brightness.toFixed(3));
    root.style.setProperty('--glowOpacity', (1 + hoverVal * 0.15 + windGust * 0.2).toFixed(3));
    root.style.setProperty('--glowBlur', (5 + hoverVal * 1.5 + windGust * 2).toFixed(2) + 'px');
    root.style.setProperty('--glowScale', (1 + hoverVal * 0.08 + windGust * 0.06).toFixed(3));
    root.style.setProperty('--ringOpacity', clamp(intensity * 0.6 + 0.4, 0, 1).toFixed(3));

    root.style.setProperty('--glowSkewX', pose.glowSkewX.toFixed(1) + 'deg');
    root.style.setProperty('--glowSkewY', pose.glowSkewY.toFixed(1) + 'deg');
    root.style.setProperty('--glowX', glowTrackX.toFixed(2) + 'px');
    root.style.setProperty('--glowY', glowTrackY.toFixed(2) + 'px');

    root.style.setProperty('--crustX', pose.crustX.toFixed(2) + 'px');
    root.style.setProperty('--crustY', pose.crustY.toFixed(2) + 'px');
    root.style.setProperty('--crustRot', pose.crustRot.toFixed(2) + 'deg');
    root.style.setProperty('--crustScale', pose.crustScale.toFixed(3));

    root.style.setProperty('--ashShiftX', ashTrackX.toFixed(2) + 'px');
    root.style.setProperty('--ashShiftY', ashTrackY.toFixed(2) + 'px');
    root.style.setProperty('--ashRot', pose.ashRot.toFixed(2) + 'deg');

    root.style.setProperty('--ringExpand', pose.ringExpand.toFixed(2) + 'px');

    coreEl.style.setProperty('--glintOpacity', pose.glintOpacity.toFixed(3));
    coreEl.style.setProperty('--glintX', pose.glintX.toFixed(1) + '%');
    coreEl.style.setProperty('--glintY', pose.glintY.toFixed(1) + '%');
    coreEl.style.setProperty('--glintRot', pose.glintRot.toFixed(1) + 'deg');
    coreEl.style.setProperty('--glintScale', pose.glintScale.toFixed(3));

    const sqBr = clamp(pose.squash, -1, 1);
    const absSqBr = Math.abs(sqBr);
    const msX = pose.massShiftX || 0;
    const msY = pose.massShiftY || 0;
    const uB = pose.upperBulge || 0;
    const lS = pose.lowerSag || 0;
    const sB = pose.sideBulge || 0;
    const hasDeform = absSqBr > 0.005 || Math.abs(msX) > 0.05 || Math.abs(msY) > 0.05 || uB > 0.05 || lS > 0.05 || sB > 0.05;
    if (hasDeform) {
      hasActiveSquash = true;
      coreEl.style.animation = 'none';
      coreEl.style.borderRadius =
        `${(48+sqBr*1.5+uB*8-lS*3).toFixed(1)}% ${(52-sqBr*1.5+sB*6-uB*4).toFixed(1)}% ${(52-sqBr*2+lS*7-sB*3).toFixed(1)}% ${(48+sqBr*2+msX*3).toFixed(1)}% / ${(50-sqBr*4+msY*5-uB*4).toFixed(1)}% ${(46+sqBr*2+msX*2).toFixed(1)}% ${(50+sqBr*3+lS*5).toFixed(1)}% ${(50-sqBr*2+msY*3).toFixed(1)}%`;
    } else if (hasActiveSquash) {
      hasActiveSquash = false;
      coreEl.style.animation = '';
      coreEl.style.borderRadius = '';
    }

    coreEl.style.setProperty('--cursorLeanX', cursorLean.x.toFixed(1));
    coreEl.style.setProperty('--cursorLeanY', cursorLean.y.toFixed(1));
    coreEl.style.setProperty('--cursorSquish', cursorLean.squish.toFixed(3));
    coreEl.style.setProperty('--cursorScale', cursorLean.scale.toFixed(3));
    coreEl.style.setProperty('--cursorTiltX', cursorLean.tiltX.toFixed(1));
    coreEl.style.setProperty('--cursorTiltY', cursorLean.tiltY.toFixed(1));

    root.style.setProperty('--spawnCore', spawnCore.toFixed(3));
    root.style.setProperty('--spawnGlow', spawnGlow.toFixed(3));
    root.style.setProperty('--spawnRing', spawnRing.toFixed(3));

    const totalHue = pose.hue;
    const totalSat = pose.saturation;
    if (totalHue || totalSat) {
      coreEl.style.filter = `brightness(var(--brightness)) hue-rotate(${totalHue.toFixed(1)}deg) saturate(${(1 + totalSat).toFixed(3)})`;
    } else {
      coreEl.style.filter = 'brightness(var(--brightness))';
    }
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

  function applySegmentWave(center, radius, fn) {
    segments.forEach((seg, i) => {
      const dist = Math.abs(i - center);
      const circularDist = Math.min(dist, 12 - dist);
      if (circularDist <= radius) {
        fn(seg, 1 - circularDist / (radius + 1), circularDist);
      }
    });
  }

  function applySegEffects() {
    segments.forEach(seg => {
      seg.style.removeProperty('--seg-tilt');
      seg.style.removeProperty('--seg-flash');
      seg.style.removeProperty('--seg-dim');
      seg.style.removeProperty('--seg-brightness');
      seg.style.removeProperty('--seg-push');
      seg.style.removeProperty('--seg-scaleX');
      seg.style.removeProperty('--seg-scaleY');
    });
    for (const e of segmentEffects) {
      const m = e.mag ?? 1;
      switch (e.type) {
        case 'segTremor': {
          const intensity = Math.sin(e.phase * Math.PI * 3) * 6 * m * (1 - e.phase);
          const push = Math.sin(e.phase * Math.PI) * 1.2 * m;
          applySegmentWave(e.segIdx, 2, (seg, falloff) => {
            seg.style.setProperty('--seg-tilt', (intensity * falloff).toFixed(2) + 'deg');
            seg.style.setProperty('--seg-push', (push * falloff).toFixed(2) + 'px');
          });
          break;
        }
        case 'segTryIgnite': {
          const flash = e.phase < 0.3 ? easeOutQuad(e.phase / 0.3) : 1 - easeInQuad((e.phase - 0.3) / 0.7);
          const seg = segments[e.segIdx];
          if (seg) {
            seg.style.setProperty('--seg-flash', flash.toFixed(3));
            seg.style.setProperty('--seg-scaleX', (1 - flash * 0.35).toFixed(3));
            seg.style.setProperty('--seg-scaleY', (1 + flash * 0.2).toFixed(3));
          }
          const neighbor = segments[e.segIdx - 1] || segments[e.segIdx + 1];
          if (neighbor && flash > 0.3) {
            neighbor.style.setProperty('--seg-flash', (flash * 0.3).toFixed(3));
          }
          break;
        }
        case 'segHeatRipple': {
          const wavePos = e.phase * 12;
          const center = Math.floor(wavePos);
          const localFrac = wavePos - center;
          const wave = Math.sin(localFrac * Math.PI);
          applySegmentWave(center, 2, (seg, falloff) => {
            seg.style.setProperty('--seg-brightness', (wave * falloff * 1.2 * m).toFixed(3));
            seg.style.setProperty('--seg-push', (wave * falloff * 0.8 * m).toFixed(2) + 'px');
          });
          break;
        }
        case 'segFlicker': {
          const blink = Math.sin(e.phase * Math.PI * 6) * (1 - e.phase);
          const seg = segments[e.segIdx];
          if (seg) {
            seg.style.setProperty('--seg-dim', (0.7 + 0.7 * blink).toFixed(3));
            seg.style.setProperty('--seg-scaleX', (1 - Math.abs(blink) * 0.3).toFixed(3));
            seg.style.setProperty('--seg-scaleY', (1 + Math.abs(blink) * 0.15).toFixed(3));
          }
          break;
        }
        case 'segHeatWave': {
          const activeIdx = getActiveSegIndices();
          if (!activeIdx.length) break;
          const pos = e.phase * activeIdx.length;
          const ci = Math.floor(pos);
          const localFrac = pos - ci;
          const wave = Math.sin(localFrac * Math.PI);
          applySegmentWave(activeIdx[ci] ?? 0, 1, (seg, falloff) => {
            seg.style.setProperty('--seg-brightness', (wave * falloff * 0.8 * m).toFixed(3));
            seg.style.setProperty('--seg-push', (wave * falloff * 0.6 * m).toFixed(2) + 'px');
          });
          break;
        }
      }
    }
  }

  // ---------- частицы ----------

  function initParticlePool() {
    if (poolInited) return;
    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement('div');
      el.className = 'ember-ash';
      el.style.display = 'none';
      particleLayer.appendChild(el);
      particlePool.push({ el, free: true });
    }
    poolInited = true;
  }

  function acquireEl(className) {
    for (const slot of particlePool) {
      if (slot.free) {
        slot.free = false;
        slot.el.className = className;
        slot.el.style.display = '';
        slot.el.style.opacity = '0';
        slot.el.style.boxShadow = '';
        slot.el.style.transform = '';
        slot.el.style.borderRadius = '';
        slot.el.style.width = '';
        slot.el.style.height = '';
        return slot.el;
      }
    }
    const el = document.createElement('div');
    el.className = className;
    particleLayer.appendChild(el);
    particlePool.push({ el, free: false });
    return el;
  }

  function releaseEl(el) {
    for (const slot of particlePool) {
      if (slot.el === el) {
        slot.free = true;
        el.style.display = 'none';
        el.className = 'ember-ash';
        return;
      }
    }
    el.remove();
  }

  function spawnAshParticle() {
    if (particles.length > 40) return;
    const roll = Math.random();
    const cls = 'ember-ash' + (roll < 0.33 ? ' dark' : roll > 0.8 ? ' bright' : '');
    const el = acquireEl(cls);
    let size = rand(2.2, 4.8);
    if (Math.random() < 0.06) size *= 2.2;
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = (size * rand(0.7, 1.4)).toFixed(1) + 'px';
    el.style.borderRadius = '60% 40% 70% 30% / 45% 55% 35% 65%';
    const startX = rand(28, 72);
    const startY = rand(35, 70);
    el.style.left = startX + '%';
    el.style.top = startY + '%';

    particles.push({
      el, born: performance.now(),
      dur: rand(2600, 5200),
      rise: rand(-20, -10),
      drift: rand(-12, 12),
      sway: rand(2, 6),
      isSpark: false,
      scalePulse: true,
    });
  }

  function spawnSpark(hBias) {
    if (activeSparks >= 7) return;
    const sparkTypes = ['spark-point', 'spark-elongated', 'spark-broken', 'spark-double'];
    const typeIdx = Math.floor(Math.random() * sparkTypes.length);
    const sparkType = sparkTypes[typeIdx];
    const el = acquireEl('ember-spark ' + sparkType);
    let w, h;
    if (sparkType === 'spark-point') {
      w = rand(1.6, 2.4); h = w;
    } else if (sparkType === 'spark-elongated') {
      w = rand(1.2, 2); h = rand(3.5, 6);
    } else if (sparkType === 'spark-broken') {
      w = rand(2, 3.2); h = rand(2, 4);
    } else {
      w = rand(1.4, 2.2); h = rand(2.4, 4);
    }
    el.style.width = w.toFixed(1) + 'px';
    el.style.height = h.toFixed(1) + 'px';
    const startX = hBias != null ? (hBias * 100) : rand(30, 70);
    const startY = rand(35, 60);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
    activeSparks++;

    particles.push({
      el, born: performance.now(),
      dur: rand(650, 1300),
      rise: rand(-30, -16),
      drift: rand(-8, 8),
      sway: rand(1, 3),
      isSpark: true,
      type: sparkType,
    });
  }

  function spawnShootingSpark() {
    if (activeSparks >= 7) return;
    const el = acquireEl('ember-spark ember-spark-shoot');
    const size = rand(1.4, 2.2);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = (size * rand(2, 3)).toFixed(1) + 'px';
    const startX = rand(30, 70);
    const startY = rand(35, 55);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
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
    const el = acquireEl('ember-ash bright');
    const size = rand(2, 3.5);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = size.toFixed(1) + 'px';
    const startX = rand(30, 70);
    const startY = rand(40, 60);
    el.style.left = startX + '%';
    el.style.top = startY + '%';

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
        if (p.type === 'shooting' || (p.isSpark && p.type === 'spark') || p.type === 'crumb') {
          const px = parseFloat(p.el.style.left);
          const py = parseFloat(p.el.style.top);
          if (!isNaN(px) && !isNaN(py)) spawnLandingGlow(px, py);
        }
        if (p.isSpark && t > 0.8 && !p.ashSpawned) {
          p.ashSpawned = true;
          spawnAshParticle();
        }
        releaseEl(p.el);
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
      const finalScale = (p.scalePulse && t < 0.5) ? scale * (1 + Math.sin(t * Math.PI) * 0.2) : scale;
      const rot = p.isSpark ? t * 50 : 0;
      const wobble = (p.type === 'spark-broken') ? Math.sin(t * Math.PI * 6) * 15 : 0;

      let shadow = '';
      if (p.trail && p.type === 'shooting') {
        const trailLen = (1 - t) * 12;
        shadow = `0 ${trailLen.toFixed(0)}px 3px rgba(255,150,50,${(0.6 * (1 - t)).toFixed(2)})`;
      }

      p.el.style.transform = `translate(${drift.toFixed(2)}px, ${rise.toFixed(2)}px) rotate(${(rot + wobble).toFixed(1)}deg) scale(${finalScale.toFixed(2)})`;
      p.el.style.opacity = (opacity * (p.isSpark ? 1 : 0.92)).toFixed(3);
      if (shadow) p.el.style.boxShadow = shadow;
    }
  }

  // ---------- горячие точки на поверхности ----------

  function updateHotspots(now, dt) {
    if (reduceMotion) return;
    const spawnChance = 0.0008 * dt * intensity + windGust * 0.004 * dt;
    for (let i = 0; i < hotspots.length; i++) {
      const hs = hotspots[i];
      if (hs.born === 0) {
        if (Math.random() < spawnChance) {
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

  // ---------- внимание — горячая зона со стороны курсора ----------

  function updateAttention(now, dt) {
    if (reduceMotion || attn.state === 'cooling') {
      if (attn.state === 'cooling') {
        attn.timer -= dt;
        attn.hotHeat *= 0.97;
        if (attn.timer <= 0 || attn.hotHeat < 0.05) {
          attn.state = 'idle';
          attn.hotHeat = 0;
        }
      }
      return;
    }
    const ember = getEmberCenter();
    const dx = mouse.x - ember.x;
    const dy = mouse.y - ember.y;
    const dist = Math.hypot(dx, dy);

    if (attn.state === 'idle') {
      if (dist > 40 && dist < 250 && mouse.speed > 15 && Math.random() < 0.001 * dt) {
        attn.state = 'noticing';
        attn.timer = rand(300, 800);
        attn.dirX = Math.sign(dx) || 1;
      }
    } else if (attn.state === 'noticing') {
      attn.timer -= dt;
      attn.hotHeat += (0.7 - attn.hotHeat) * 0.005 * dt;
      attn.hotX += (50 + attn.dirX * 25 - attn.hotX) * 0.003 * dt;
      attn.hotY += (50 + dy * 0.05 - attn.hotY) * 0.002 * dt;
      if (attn.timer <= 0) {
        attn.state = 'looking';
        attn.timer = rand(1500, 4000);
      }
    } else if (attn.state === 'looking') {
      attn.timer -= dt;
      attn.hotHeat += (attn.hotHeat > 0.9 ? 0 : 0.0008 * dt);
      attn.hotX += (50 + attn.dirX * 30 - attn.hotX) * 0.002 * dt;
      attn.hotY += (50 + dy * 0.08 - attn.hotY) * 0.001 * dt;
      if (Math.random() < 0.0005 * dt) spawnSpark();
      if (attn.timer <= 0) {
        attn.state = 'cooling';
        attn.timer = rand(3000, 6000);
      }
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

  let tooltipEl = null;

  function showTooltip() {
    if (tooltipEl) tooltipEl.remove();
    const h = Math.floor(hoursWithoutActivity());
    const rem = remainingSegments();
    let statusText;
    if (statusState === 'saving') statusText = 'Сохранение...';
    else if (statusState === 'saved') statusText = 'Сохранено';
    else if (statusState === 'error') statusText = 'Ошибка сохранения';
    else if (statusState === 'dirty') statusText = 'Есть несохранённые изменения';
    else statusText = 'Нет активности';

    const timeText = h < 1 ? 'менее часа' : `${h} ч. назад`;
    const lines = [
      `Правка: ${timeText}`,
      `Осталось: ${rem}/12 делений`,
      statusState ? `Статус: ${statusText}` : null,
    ].filter(Boolean);

    tooltipEl = document.createElement('div');
    tooltipEl.className = 'ember-tooltip';
    tooltipEl.textContent = lines.join(' · ');
    root.appendChild(tooltipEl);
    setTimeout(() => { if (tooltipEl) { tooltipEl.style.opacity = '0'; setTimeout(() => tooltipEl?.remove(), 300); } }, 3000);
  }

  function updateCursorLean(now, dt) {
    const lerp = clamp(dt * 0.008, 0, 1);

    // кольцо втягивает обратно — импульс затухает
    ringImpulse *= Math.max(0, 1 - dt * 0.003);
    if (ringImpulse < 0.01) ringImpulse = 0;

    if (previewScare.active) return;

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

      case 'startled': {
        peek.timer += dt;
        const sp = clamp(peek.timer / 350, 0, 1);
        const shrink = sp < 0.3 ? easeOutQuad(sp / 0.3) : 1;

        cursorLean.scale += ((1 - shrink * 0.25) - cursorLean.scale) * returnLerp;
        cursorLean.squish += (shrink * 0.2 - cursorLean.squish) * returnLerp;
        cursorLean.x += (0 - cursorLean.x) * returnLerp * 2;
        cursorLean.y += (0 - cursorLean.y) * returnLerp * 2;
        cursorLean.tiltX += (0 - cursorLean.tiltX) * returnLerp;
        cursorLean.tiltY += (0 - cursorLean.tiltY) * returnLerp;

        if (sp >= 1) {
          peek.state = 'idle';
          peek.cooldown = rand(8000, 20000);
          cursorLean.scale = 1;
          cursorLean.squish = 0;
        }
        break;
      }
    }

    // startled detection: резкое приближение курсора
    if ((peek.state === 'noticing' || peek.state === 'peeking') && mouse.speed > 80 && mDist < FAR) {
      peek.state = 'startled';
      peek.timer = 0;
      for (let i = 0; i < 3; i++) setTimeout(spawnSpark, i * 50);
      ringImpulse = rand(3, 6) * (Math.random() < 0.5 ? 1 : -1);
    }

    // каретка при печати — дополнительный импульс к текущему lean
    if (caret.active && caret.typing) {
      if (peek.state !== 'idle' && peek.state !== 'startled') {
        peek.state = 'idle';
        peek.cooldown = rand(8000, 20000);
        peek.timer = 0;
      }
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
    let x, y;
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (r.collapsed) {
        const rect = r.getBoundingClientRect();
        if (rect.width || rect.height) { x = rect.left + rect.width / 2; y = rect.top; }
      }
    }
    if (x === undefined) {
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
        const r = el.getBoundingClientRect();
        x = r.left + 12; y = r.top + 12;
      }
    }
    if (x === undefined) return null;
    return {
      x: clamp(x, 30, window.innerWidth - 30),
      y: clamp(y, 30, window.innerHeight - 30),
    };
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

      case 1: { // ЗАМАХ — приседает против хода, резко ~150мс
        const p = clamp(t / 150, 0, 1);
        const e = easeOutQuad(p);
        const dir = Math.sign(egg.caretX) || 1;
        egg.x = egg.startX - dir * 7 * e;
        egg.y = egg.startY + 5 * e;
        egg.scale = 1 - 0.14 * e;
        egg.squish = 0.2 * e;
        egg.tiltY = dir * 10 * e;
        if (p >= 1) { egg.phase = 2; egg.phaseStart = now; }
        break;
      }

      case 2: { // ПОЛЁТ — очень быстро easeIn→easeOut, 350мс, огненный хвост
        const p = clamp(t / 350, 0, 1);
        const e = p < 0.4 ? easeInQuad(p / 0.4) * 0.5 : easeOutQuad((p - 0.4) / 0.6) * 0.5 + 0.5;
        egg.x = egg.startX + (egg.caretX - egg.startX) * e;
        egg.y = egg.startY + (egg.caretY - egg.startY) * e
                - Math.sin(p * Math.PI) * 28;
        egg.scale = 1.12 + Math.sin(p * Math.PI) * 0.12;
        egg.squish = -0.14 * Math.sin(p * Math.PI);
        const dir = Math.sign(egg.caretX - egg.startX) || 1;
        egg.tiltY = dir * 16 * (1 - p);
        egg.tiltX = -12 * Math.sin(p * Math.PI);
        if (Math.random() < 0.6) spawnSpark();
        if (p >= 1) { egg.phase = 3; egg.phaseStart = now; }
        break;
      }

      case 3: { // ПРИЗЕМЛЕНИЕ — пружинка ~200мс
        const p = clamp(t / 200, 0, 1);
        const spring = Math.sin(p * Math.PI * 3) * (1 - p);
        egg.x = egg.caretX;
        egg.y = egg.caretY;
        egg.scale = 1 + spring * 0.14;
        egg.squish = spring * 0.4;
        egg.tiltX = 0; egg.tiltY = 0;
        if (!egg._landGlowDone) {
          egg._landGlowDone = true;
          const ember = getEmberCenter();
          spawnLandingGlow(
            clamp((ember.x + egg.caretX) / window.innerWidth * 100, 10, 90),
            clamp((ember.y + egg.caretY) / window.innerHeight * 100, 10, 90)
          );
        }
        if (p >= 1) { egg.phase = 4; egg.phaseStart = now; egg._landGlowDone = false; }
        break;
      }

      case 4: { // ОСМОТР — медленно 1800мс, паузы между поворотами
        const p = clamp(t / 1800, 0, 1);
        let lookX = 0, lookY = 0, tiltYVal = 0, bodyLean = 0;
        if (p < 0.18) {
          const lp = easeOutQuad(p / 0.18);
          lookX = -8 * lp; tiltYVal = -26 * lp; bodyLean = -4 * lp;
        } else if (p < 0.28) {
          lookX = -8; tiltYVal = -26; bodyLean = -4;
        } else if (p < 0.42) {
          const lp = easeOutQuad((p - 0.28) / 0.14);
          lookX = -8 + 16 * lp; tiltYVal = -26 + 52 * lp; bodyLean = -4 + 8 * lp;
        } else if (p < 0.52) {
          lookX = 8; tiltYVal = 26; bodyLean = 4;
        } else if (p < 0.66) {
          const lp = easeOutQuad((p - 0.52) / 0.14);
          lookX = 8 * (1 - lp); tiltYVal = 26 * (1 - lp); lookY = -8 * lp; bodyLean = 4 * (1 - lp);
        } else if (p < 0.78) {
          lookY = -8; tiltYVal = 0;
          egg.scale = 1.08 + 0.04;
          egg.squish = -0.08;
        } else {
          lookY = -8; tiltYVal = 0;
          egg.scale = 1.08;
          egg.squish = 0;
        }
        egg.x = egg.caretX + lookX;
        egg.y = egg.caretY + lookY;
        egg.tiltY = tiltYVal;
        egg.tiltX = Math.sin(p * Math.PI * 2) * 9 + bodyLean;
        if (!egg._glint1 && p > 0.15 && p < 0.2) { egg._glint1 = true; spawnSpark(); spawnSpark(); }
        if (!egg._glint2 && p > 0.39 && p < 0.44) { egg._glint2 = true; spawnSpark(); spawnSpark(); }
        if (!egg._glint3 && p > 0.63 && p < 0.68) { egg._glint3 = true; spawnSpark(); }
        if (p >= 1) { egg.phase = 5; egg.phaseStart = now; egg._glint1 = false; egg._glint2 = false; egg._glint3 = false; }
        break;
      }

      case 5: { // «РУКИ В БОКИ» — гордость, scaleX>1, задержка 300мс
        const p = clamp(t / 300, 0, 1);
        const e = easeOutQuad(p);
        egg.x = egg.caretX;
        egg.y = egg.caretY - e * 3;
        egg.tiltY = -20 * e;
        egg.tiltX = 6 * e;
        egg.scale = 1.08 + e * 0.14;
        egg.squish = -0.14 * e;
        if (p >= 1) { egg.phase = 6; egg.phaseStart = now; }
        break;
      }

      case 6: { // ЗАЛП — мгновенно 100мс старт, 16-20 пепла + 8 искр
        const p = clamp(t / 300, 0, 1);
        egg.x = egg.caretX; egg.y = egg.caretY;
        egg.tiltX = Math.sin(p * Math.PI * 4) * 4 * p;
        egg.tiltY = 0;
        egg.scale = 1.22 + easeOutQuad(p) * 0.18;
        egg.squish = -0.18 * p;
        if (!egg._burstDone && p > 0.08) {
          egg._burstDone = true;
          const burstDir = Math.random() < 0.5 ? -1 : 1;
          for (let i = 0; i < 18; i++) setTimeout(spawnAshParticle, i * 18 + rand(0, 10));
          for (let i = 0; i < 8; i++) setTimeout(spawnSpark, 30 + i * 30);
          setTimeout(() => { egg.tiltY -= burstDir * 7; }, 200);
        }
        if (p >= 1) { egg.phase = 6.5; egg.phaseStart = now; egg._burstDone = false; }
        break;
      }

      case 6.5: { // ОТДАЧА — быстрый дёрг назад, смущение
        const p = clamp(t / 150, 0, 1);
        const e = easeOutQuad(p);
        egg.scale = 1.4 - e * 0.12;
        egg.tiltX = -8 * (1 - e);
        egg.squish = 0.08 * (1 - e);
        if (p >= 1) { egg.phase = 7; egg.phaseStart = now; }
        break;
      }

      case 7: { // СХЛОПЫВАНИЕ — mass утягивается в точку, easeIn
        const p = clamp(t / 280, 0, 1);
        egg.x = egg.caretX * (1 - easeInQuad(p) * 0.7);
        egg.y = egg.caretY * (1 - easeInQuad(p) * 0.7);
        egg.scale = 1.28 - easeInQuad(p) * 0.98;
        egg.squish = easeInQuad(p) * 0.95;
        egg.tiltY = Math.sign(-egg.caretX) * easeInQuad(p) * 14;
        egg.tiltX = -easeInQuad(p) * 6;
        if (p >= 1) { egg.phase = 8; egg.phaseStart = now; }
        break;
      }

      case 8: { // ТЕЛЕПОРТ — дом, кольцо сжимается к центру
        egg.x = 0; egg.y = 0; egg.scale = 0.5; egg.squish = 0.8;
        egg.tiltY = 10; egg.tiltX = -4;
        if (t > 90) { egg.phase = 9; egg.phaseStart = now; }
        break;
      }

      case 9: { // ЗАГЛАТЫВАНИЕ КОЛЬЦОМ — кольцо сжимается внутрь, уголь выскакивает
        const p = clamp(t / 500, 0, 1);
        if (p < 0.2) {
          const s = p / 0.2;
          egg.scale = 0.5 * (1 - easeOutQuad(s) * 0.6);
          egg.squish = 0.8 * (1 - easeOutQuad(s));
          egg.tiltY = 10 * (1 - s);
          egg.tiltX = -4 * (1 - s);
          if (!egg._ringDone) {
            egg._ringDone = true;
            ringImpulse = rand(3, 5) * (Math.random() < 0.5 ? 1 : -1);
            heatBoost = Math.max(heatBoost, 0.25);
            root.style.setProperty('--ringOpacity', '1');
            root.style.setProperty('--ringExpand', '-3px');
            root.style.setProperty('--ringPulse', '0.7');
          }
        } else if (p < 0.4) {
          const s = (p - 0.2) / 0.2;
          egg.scale = 0.2;
          egg.squish = 0;
        } else {
          const s = (p - 0.4) / 0.6;
          const bounce = Math.sin(s * Math.PI * 2) * (1 - s) * 0.12;
          egg.scale = 0.2 + easeOutQuad(s) * 0.8 + bounce;
          egg.squish = -Math.sin(s * Math.PI) * 0.12;
          egg.tiltY = Math.sin(s * Math.PI * 3) * 4 * (1 - s);
          root.style.setProperty('--ringPulse', String(0.7 + easeOutQuad(s) * 0.38));
          root.style.setProperty('--ringExpand', (-3 + easeOutQuad(s) * 6).toFixed(1) + 'px');
        }
        if (p >= 1) {
          egg.scale = 1; egg.squish = 0; egg.active = false;
          egg._ringDone = false;
          root.style.removeProperty('--ringOpacity');
          root.style.removeProperty('--ringExpand');
          root.style.removeProperty('--ringPulse');
        }
        break;
      }
    }
  }

  function startPreviewScare() {
    if (previewScare.active || egg.active) return;
    if (Math.random() > 0.4) return;
    const recoilX = (Math.random() < 0.5 ? -1 : 1) * rand(8, 20);
    const recoilY = -rand(14, 30);
    previewScare.active = true;
    previewScare.phase = 0;
    previewScare.phaseStart = performance.now() - 100;
    previewScare.recoilX = recoilX;
    previewScare.recoilY = recoilY;
    previewScare.sparksToEmit = Math.floor(rand(3, 7));
    previewScare.ashToEmit = Math.floor(rand(2, 5));
    previewScare.sparksEmitted = 0;
    previewScare.ashEmitted = 0;
    previewScare.ringHugAmt = rand(3, 7);
    heatBoost = Math.max(heatBoost, 0.2);
    ringImpulse = rand(4, 8) * (Math.random() < 0.5 ? 1 : -1);
  }

  function updatePreviewScare(now) {
    if (!previewScare.active) return;
    const t = now - previewScare.phaseStart;
    const p = previewScare.phase;

    if (p === 0) {
      const prog = clamp(t / 280, 0, 1);
      const e = easeOutQuad(prog);
      cursorLean.x += (previewScare.recoilX * e - cursorLean.x) * 0.12;
      cursorLean.y += (previewScare.recoilY * e - cursorLean.y) * 0.12;
      cursorLean.squish += (0.15 * e - cursorLean.squish) * 0.12;
      cursorLean.scale += ((1 - 0.12 * e) - cursorLean.scale) * 0.12;
      cursorLean.tiltX += (previewScare.recoilY * 0.4 * e - cursorLean.tiltX) * 0.12;
      cursorLean.tiltY += (-previewScare.recoilX * 0.3 * e - cursorLean.tiltY) * 0.12;
      if (Math.random() < 0.3 * prog) spawnSpark();
      if (prog >= 1) { previewScare.phase = 1; previewScare.phaseStart = now; previewScare.phase1Dur = rand(350, 700); }
    } else if (p === 1) {
      const prog = clamp(t / previewScare.phase1Dur, 0, 1);
      cursorLean.x += (previewScare.recoilX - cursorLean.x) * 0.04;
      cursorLean.y += (previewScare.recoilY - cursorLean.y) * 0.04;
      cursorLean.squish += (0.1 - cursorLean.squish) * 0.06;
      cursorLean.scale += (0.94 - cursorLean.scale) * 0.06;
      if (Math.random() < 0.08) spawnAshParticle();
      if (prog >= 1) { previewScare.phase = 2; previewScare.phaseStart = now; }
    } else if (p === 2) {
      const dur = 700;
      const prog = clamp(t / dur, 0, 1);
      const e = easeInOutQuad(prog);
      cursorLean.x += ((1 - e) * previewScare.recoilX - cursorLean.x) * 0.08;
      cursorLean.y += ((1 - e) * previewScare.recoilY - cursorLean.y) * 0.08;
      cursorLean.squish += ((1 - e) * 0.1 - cursorLean.squish) * 0.08;
      cursorLean.scale += ((1 + e * 0.04) - cursorLean.scale) * 0.08;
      cursorLean.tiltX += ((1 - e) * previewScare.recoilY * 0.4 - cursorLean.tiltX) * 0.08;
      cursorLean.tiltY += ((1 - e) * -previewScare.recoilX * 0.3 - cursorLean.tiltY) * 0.08;
      if (previewScare.sparksEmitted < previewScare.sparksToEmit && Math.random() < 0.15) {
        spawnSpark();
        previewScare.sparksEmitted++;
      }
      if (previewScare.ashEmitted < previewScare.ashToEmit && Math.random() < 0.2) {
        spawnAshParticle();
        previewScare.ashEmitted++;
      }
      if (prog >= 1) { previewScare.phase = 3; previewScare.phaseStart = now; }
    } else if (p === 3) {
      const prog = clamp(t / 350, 0, 1);
      const e = easeOutQuad(prog);
      ringImpulse = previewScare.ringHugAmt * (1 - e) * (Math.random() < 0.5 ? 1 : -1);
      heatBoost = Math.max(heatBoost, 0.15 * (1 - e));
      cursorLean.scale += (1 - cursorLean.scale) * 0.15;
      cursorLean.squish += (0 - cursorLean.squish) * 0.15;
      cursorLean.tiltX += (0 - cursorLean.tiltX) * 0.1;
      cursorLean.tiltY += (0 - cursorLean.tiltY) * 0.1;
      if (prog >= 1) {
        previewScare.active = false;
        cursorLean.x = 0; cursorLean.y = 0;
        cursorLean.squish = 0; cursorLean.scale = 1;
        cursorLean.tiltX = 0; cursorLean.tiltY = 0;
      }
    }
  }

  // ---------- ПКМ тестирование ----------

  const TEST_EFFECTS = [
    'sigh', 'calmBurn', 'wiggle', 'tilt', 'microShift',
    'crackle', 'stretch', 'glint', 'sleepySag',
    'smolder', 'heatRadiance', 'glowPulse', 'ashDrift', 'gust',
    'segTremor', 'segTryIgnite', 'segHeatRipple', 'segFlicker', 'segHeatWave',
    'typingApproach',
    'eggFly',
    'previewScare',
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
        wiggle: { amp: rand(0.9, 1.3), mag: rand(0.7, 1.1) },
        stretch: { amp: rand(0.9, 1.25), mag: rand(0.7, 1.1) },
        crackle: { mag: rand(0.9, 1.5), side: Math.random() < 0.5 ? -1 : 1 },
        glint: { hue: rand(15, 35), sat: rand(0.3, 0.6) },
        smolder: { hue: rand(10, 26), sat: rand(0.15, 0.32) },
        tilt: { target: rand(-1, 1) },
        microShift: { dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) },
        ashDrift: { dx: rand(-3, 3) },
        gust: { power: rand(0.6, 1), dir: Math.random() < 0.5 ? -1 : 1, mag: rand(0.7, 1.1) },
        sleepySag: { mag: rand(0.6, 1.0) },
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
      const savedFlag = egg.triggeredToday;
      egg.triggeredToday = false;
      startEgg();
      setTimeout(() => { egg.triggeredToday = savedFlag; }, 5000);
    }
    if (type === 'previewScare') {
      startPreviewScare();
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

  function updateMood(now) {
    if (now - lastMoodCheck < 3000) return;
    lastMoodCheck = now;
    const recentActivity = heatBoost;
    const h = hoursWithoutActivity();
    if (recentActivity > 0.3) emberMood = 'overheated';
    else if (h < 1) emberMood = 'active';
    else if (h < 24) emberMood = 'calm';
    else emberMood = 'sleepy';
  }

  function updateRingSegments(now) {
    if (Math.random() < 0.3) {
      const start = Math.floor(rand(0, 12));
      const len = Math.floor(rand(2, 5));
      for (let i = start; i < start + len; i++) {
        segments[i % 12].style.setProperty('--seg-flash', '0.8');
      }
    }
  }

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

      const breathBase = intensity > 0.3 ? 0.00055 : 0.0002;
      breathPhase += breathBase * dt;
      if (Date.now() > nextBreathSwitch) {
        breathPatternIdx = (breathPatternIdx + 1) % breathPattern.length;
        nextBreathSwitch = Date.now() + rand(2000, 6000);
      }
      const breathAmp = breathPattern[breathPatternIdx];
      const flicker =
        Math.sin(breathPhase * 2.5) * 0.5 +
        Math.sin(breathPhase * 6.3 + 1.7) * 0.3 +
        Math.sin(breathPhase * 11.1 + 4.2) * 0.2;
      breathScale = 1 + flicker * 0.012 * intensity * breathAmp;

      updateHeatZones(dt);
      updateHotspots(now, dt);

      heat = clamp(intensity + heatBoost * 0.25, 0, 1);
      const glow = clamp(intensity + heatBoost * 0.3, 0, 1.8);
      const brightness = clamp(0.7 + intensity * 0.3 + heatBoost * 0.4, 0.35, 2.5);
      const coreHue = 15 + intensity * 35;
      const coreLight = 35 + intensity * 35;
      const crackGlow = 0.4 + flicker * 0.3 + heatBoost * 1.5;
      const ashRaw = clamp(1 - intensity, 0, 1);
      ashCoverage = ashRaw * ashRaw * (3 - 2 * ashRaw);

      root.style.setProperty('--heat', heat.toFixed(3));
      root.style.setProperty('--glow', glow.toFixed(3));
      root.style.setProperty('--intensity', intensity.toFixed(3));
      root.style.setProperty('--breathScale', breathScale.toFixed(4));
      root.style.setProperty('--scaleX', breathScale.toFixed(4));
      root.style.setProperty('--scaleY', breathScale.toFixed(4));
      root.style.setProperty('--brightness', brightness.toFixed(3));
      root.style.setProperty('--coreHue', coreHue.toFixed(1));
      root.style.setProperty('--coreLight', coreLight.toFixed(1) + '%');
      root.style.setProperty('--ashCoverage', ashCoverage.toFixed(3));
      root.style.setProperty('--glowOpacity', (1 + heatBoost * 0.3).toFixed(3));
      root.style.setProperty('--glowBlur', (5 + heatBoost * 2).toFixed(2) + 'px');
      root.style.setProperty('--glowScale', (1 + heatBoost * 0.1).toFixed(3));
      root.style.setProperty('--ringOpacity', clamp(intensity * 0.6 + 0.4, 0, 1).toFixed(3));
      updateCrackLayers(now, crackGlow);
      coreEl.style.filter = 'brightness(var(--brightness))';

    applySegments();

    const curRem = remainingSegments();
    if (curRem <= 2 && curRem < lastWarnRemaining && curRem > 0 && !egg.active) {
      heatBoost = Math.max(heatBoost, 0.5);
      for (let i = 0; i < 6; i++) setTimeout(spawnSpark, i * 50);
      ringImpulse = rand(4, 7) * (Math.random() < 0.5 ? 1 : -1);
    }
    lastWarnRemaining = curRem;
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
    updatePreviewScare(now);

    const since = now - spawnStart;
    spawnCore = clamp(since / 500, 0, 1);
    spawnGlow = clamp((since - 400) / 500, 0, 1);
    spawnRing = clamp((since - 800) / 600, 0, 1);

    const hoverStep = clamp(dt / 300, 0, 1);
    hoverVal += hover ? (1 - hoverVal) * hoverStep : (0 - hoverVal) * hoverStep;

    const speedMult = (1 + hoverVal * 0.8) / sleepSlowdown();
    const breathBase = intensity > 0.3 ? 0.00055 : 0.0002;
    breathPhase += breathBase * speedMult * dt;
    if (Date.now() > nextBreathSwitch) {
      breathPatternIdx = (breathPatternIdx + 1) % breathPattern.length;
      nextBreathSwitch = Date.now() + rand(2000, 6000);
    }
    const breathAmp = breathPattern[breathPatternIdx];
    const hoverBreath = hover ? Math.sin(breathPhase * 2.5) * 0.05 * hoverVal : 0;
    const flicker =
      Math.sin(breathPhase * 2.5) * 0.5 +
      Math.sin(breathPhase * 6.3 + 1.7) * 0.3 +
      Math.sin(breathPhase * 11.1 + 4.2) * 0.2;
    breathScale = 1 + flicker * 0.012 * intensity * breathAmp + hoverBreath + windGust * 0.04;

    updateHeatZones(dt);
    updateHotspots(now, dt);
    updateWind(now, dt);
    updateAttention(now, dt);
    updateMood(now);
    applyStatus();
    if (heatBoost > 0 && statusState !== 'error') heatBoost = Math.max(0, heatBoost - 0.00025 * dt);
    residualHeat *= 0.992;

    // --- запуск эффектов ядра с рандомными параметрами ---
    if (!testMode) {
      const moodMul = emberMood === 'active' ? 1.4 : emberMood === 'overheated' ? 1.6 : emberMood === 'sleepy' ? 0.5 : 1;
      tryStart('sigh', 0.5 * moodMul, [4000, 5000], () => ({ mag: rand(0.04, 0.08), glow: rand(0.15, 0.28) }));
      tryStart('calmBurn', 0.8 * moodMul, [2000, 3000], () => ({ mag: rand(0.05, 0.1), hue: rand(-6, 12) }));
      if (intensity > 0.5 && !reduceMotion) tryStart('wiggle', 0.3 * moodMul, [700, 1100], () => ({ amp: rand(0.9, 1.3), mag: rand(0.7, 1.1) }));
      tryStart('tilt', 0.25 * moodMul, [2000, 2000], () => ({ target: rand(-1, 1) }));
      tryStart('microShift', 0.2 * moodMul, [1000, 2000], () => ({ dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) }));
      tryStart('crackle', 0.4 * moodMul, [80, 160], () => ({ mag: rand(0.9, 1.5), side: Math.random() < 0.5 ? -1 : 1 }));
      tryStart('stretch', 0.35 * moodMul, [3000, 4200], () => ({ amp: rand(0.9, 1.25), mag: rand(0.7, 1.1) }));
      tryStart('glint', 0.3 * moodMul, [2000, 3000], () => ({ hue: rand(15, 35), sat: rand(0.3, 0.6) }));
      if (intensity < 0.4 || emberMood === 'sleepy') tryStart('sleepySag', 0.25 * moodMul, [3000, 5000], () => ({ mag: rand(0.6, 1.0) }));
      tryStart('smolder', 0.3 * moodMul, [3000, 4000], () => ({ hue: rand(10, 26), sat: rand(0.15, 0.32) }));
      tryStart('heatRadiance', 0.25 * moodMul, [2500, 3500]);
      tryStart('glowPulse', 0.3 * moodMul, [2000, 3000]);
      tryStart('ashDrift', 0.3 * moodMul, [3000, 4000], () => ({ dx: rand(-3, 3) }));
      tryStart('gust', 0.15 * moodMul, [1200, 1800], () => ({ power: rand(0.6, 1), dir: Math.random() < 0.5 ? -1 : 1, mag: rand(0.7, 1.1) }));
    }

    const sigh = advanceEffect('sigh', dt);
    const calmBurn = advanceEffect('calmBurn', dt);
    const wiggle = advanceEffect('wiggle', dt);
    const tilt = advanceEffect('tilt', dt);
    if (tilt) tiltTarget = tilt.target * (1 - Math.abs(2 * tilt.phase - 1));
    else tiltTarget = 0;
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

    const geomTypes = ['sigh', 'calmBurn', 'wiggle', 'crackle', 'stretch', 'sleepySag', 'gust'];
    const geomEffects = geomTypes.map(t => ({ type: t, eff: active.get(t) })).filter(e => e.eff);
    const maxMag = geomEffects.reduce((m, e) => Math.max(m, e.eff.mag ?? 1), 0) || 1;
    geomTypes.forEach(t => {
      const eff = active.get(t);
      if (eff) {
        const ratio = (eff.mag ?? 1) / maxMag;
        eff._geomWeight = 0.35 + 0.65 * ratio;
        eff.skipGeometry = false;
      }
    });

    const tm = testMode ? 4 : 1;

    tiltCurrent += (tiltTarget - tiltCurrent) * clamp(0.08 * (dt / 16.7), 0, 1);
    crackGlowMod = 0;

    // --- pose layer ---
    const pose = createPose();

    if (sigh) applySighPose(pose, sigh);
    if (calmBurn) applyCalmBurnPose(pose, calmBurn);
    if (wiggle) applyWigglePose(pose, wiggle);
    if (tilt) applyTiltPose(pose, tilt);
    if (microShift) applyMicroShiftPose(pose, microShift);
    if (crackle) applyCracklePose(pose, crackle);
    if (stretch) applyStretchPose(pose, stretch);
    if (glint) applyGlintPose(pose, glint);
    if (sleepySag) applySleepySagPose(pose, sleepySag);
    if (smolder) applySmolderPose(pose, smolder);
    if (heatRadiance) applyHeatRadiancePose(pose, heatRadiance);
    if (glowPulse) applyGlowPulsePose(pose, glowPulse);
    if (ashDrift) applyAshDriftPose(pose, ashDrift);
    if (gust) applyGustPose(pose, gust);

    heat = clamp(intensity + heatBoost * 0.25, 0, 1);
    const ashRaw = clamp(1 - intensity, 0, 1);
    ashCoverage = ashRaw * ashRaw * (3 - 2 * ashRaw);

    let coreHue = 15 + intensity * 35 + windGust * 15;
    let coreLight = 35 + intensity * 35 + windGust * 8;
    if (statusState === 'error') {
      const pulse = Math.sin(now * 0.012) * 0.5 + 0.5;
      coreHue = 205 + pulse * 10;
      coreLight = 20 + pulse * 8;
    }

    root.style.setProperty('--coreHue', coreHue.toFixed(1));
    root.style.setProperty('--coreLight', coreLight.toFixed(1) + '%');
    root.style.setProperty('--ashCoverage', ashCoverage.toFixed(3));

    const crackGlow = 0.4 + flicker * 0.3 + heatBoost * 1.5 + windGust * 0.4 + crackGlowMod;
    updateCrackLayers(now, crackGlow);

    const waveOffset = ((now * 0.00003) % 1) * 100;
    if (heatWaveEl) heatWaveEl.style.setProperty('--waveOffset', waveOffset.toFixed(1) + '%');

    commitPose(pose, now, dt);
    root.style.setProperty('--breathScale', breathScale.toFixed(4));

    applySegments();

    if (hotAttnEl) {
      if (attn.hotHeat > 0.01) {
        hotAttnEl.style.left = clamp(attn.hotX, 15, 85) + '%';
        hotAttnEl.style.top = clamp(attn.hotY, 15, 85) + '%';
        hotAttnEl.style.opacity = clamp(attn.hotHeat * 0.7, 0, 0.8).toFixed(3);
      } else {
        hotAttnEl.style.opacity = '0';
      }
    }

    if (!testMode && Math.random() < 0.0004 * dt * heatBoost) {
      spawnCrumb();
      igniteCrackSide(Math.random() < 0.5 ? -1 : 1);
    }

    if (!reduceMotion) {
      if (!testMode) {
        const sp = lowFpsMode ? 0.5 : 1;
        tryStartSeg('segTremor', 0.35 * sp, [300, 500], () => {
          const a = getActiveSegIndices();
          return a.length ? a[Math.floor(Math.random() * a.length)] : null;
        });
        tryStartSeg('segTryIgnite', 0.3 * sp, [200, 400], () => {
          const o = getOffSegIndices();
          return o.length ? o[0] : null;
        });
        tryStartSeg('segHeatRipple', 0.25 * sp, [400, 600], () => {
          const a = getActiveSegIndices();
          return a.length >= 2 ? a[Math.floor(Math.random() * (a.length - 1))] : null;
        });
        tryStartSeg('segFlicker', 0.4 * sp, [300, 500], () => {
          const a = getActiveSegIndices();
          return a.length ? a[Math.floor(Math.random() * a.length)] : null;
        });
        tryStartSeg('segHeatWave', 0.25 * sp, [600, 900], () => {
          const a = getActiveSegIndices();
          return a.length >= 3 ? 0 : null;
        });
      }

      advanceSegEffects(dt);
      applySegEffects();
      updateRingSegments(now);

      if (Date.now() > nextAshSpawn) {
        if (Math.random() < (lowFpsMode ? 0.4 : 0.88)) spawnAshParticle();
        if (intensity > 0.6 && Math.random() < (lowFpsMode ? 0.1 : 0.3)) spawnAshParticle();
        nextAshSpawn = Date.now() + rand(lowFpsMode ? 500 : 280, lowFpsMode ? 1200 : 720);
      }

      if (Date.now() > nextSparkCheck) {
        if (Math.random() < (lowFpsMode ? 0.2 : 0.5) * (0.4 + intensity * 0.6)) spawnSpark();
        if (intensity > 0.6 && Math.random() < (lowFpsMode ? 0.02 : 0.08)) spawnShootingSpark();
        if (intensity < 0.5 && Math.random() < (lowFpsMode ? 0.04 : 0.12)) spawnCrumb();
        nextSparkCheck = Date.now() + rand(lowFpsMode ? 2400 : 1400, lowFpsMode ? 5500 : 3800);
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

  let reduceMotionFrameSkip = 0;
  const fpsHistory = [];
  let lowFpsMode = false;

  function animate(timestamp) {
    if (!root) return;
    if (lastFrame === 0) lastFrame = timestamp;
    const dt = Math.min(timestamp - lastFrame, 50);
    if (!browserFocused && dt < 250) {
      rafId = requestAnimationFrame(animate);
      return;
    }
    lastFrame = timestamp;
    if (reduceMotion) {
      reduceMotionFrameSkip++;
      if (reduceMotionFrameSkip % 6 !== 0) { rafId = requestAnimationFrame(animate); return; }
    }
    fpsHistory.push(dt);
    if (fpsHistory.length > 30) fpsHistory.shift();
    if (fpsHistory.length >= 20) {
      const avgDt = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
      lowFpsMode = avgDt > 33;
    }
    try { update(timestamp, dt * (reduceMotion ? 6 : 1)); } catch (e) { console.error('Ember update error:', e); }
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
    handlers.click = () => {
      heatBoost = 0.4;
      for (let i = 0; i < 8; i++) setTimeout(() => spawnSpark(), i * 60);
      for (let i = 0; i < 3; i++) setTimeout(() => spawnShootingSpark(), i * 120);
      showTooltip();
      if (typeof onClickCallback === 'function') onClickCallback();
    };

    root.addEventListener('mouseenter', handlers.mouseenter);
    root.addEventListener('mouseleave', handlers.mouseleave);
    root.addEventListener('focus', handlers.rootFocus);
    root.addEventListener('blur', handlers.rootBlur);
    root.addEventListener('contextmenu', handlers.contextmenu);
    root.addEventListener('click', handlers.click);

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

  function init(mountEl, tabId) {
    if (root) destroy();
    resetDomRefs();
    currentTabId = tabId || null;
    state = loadState(currentTabId);
    createDOM();
    initParticlePool();
    setupBroadcast();
    setupEventListeners();

    try {
      const today = new Date().toDateString();
      if (localStorage.getItem(EGG_STORAGE_KEY) === today) egg.triggeredToday = true;
    } catch {}

    const container = mountEl || document.getElementById('ember-slot');
    if (container) container.appendChild(root);
    else document.body.appendChild(root);

    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(([e]) => {
        onScreen = e.isIntersecting;
        if (onScreen && browserFocused && !document.hidden) startLoop();
        else stopLoop();
      }, { threshold: 0 });
      io.observe(root);
    } else {
      onScreen = true;
      startLoop();
    }

    prevRemaining = remainingSegments();
    lastWarnRemaining = remainingSegments();
    const quickReload = state.lastInitTime && (Date.now() - state.lastInitTime < 3000);
    spawnStart = quickReload ? performance.now() - 600 : performance.now();
    lastFrame = 0;

    ['segTremor', 'segTryIgnite', 'segHeatRipple', 'segFlicker', 'segHeatWave']
      .forEach(rescheduleSegDue);
    Object.keys(PRIORITY).forEach(t => {
      nextDue[t] = Date.now() + rand(2000, 15000);
    });

    startLoop();
  }

  function destroy() {
    stopLoop();
    if (io) { io.disconnect(); io = null; }
    if (channel) { try { channel.close(); } catch {} }
    window.removeEventListener('storage', handlers.storageSync);
    clearTimeout(resetTimer);
    clearTimeout(caret._typingTimer);
    clearTimeout(statusTimer);
    particles.forEach(p => releaseEl(p.el));
    particles = [];
    particlePool.forEach(s => s.el.remove());
    particlePool = [];
    poolInited = false;
    activeSparks = 0;
    glowTrackX = 0; glowTrackY = 0;
    ashTrackX = 0; ashTrackY = 0;
    hazeTrackX = 0;
    emberMood = 'calm';
    residualHeat = 0;
    breathPatternIdx = 0;
    nextBreathSwitch = 0;
    attn.state = 'idle'; attn.timer = 0; attn.hotHeat = 0;

    root.removeEventListener('mouseenter', handlers.mouseenter);
    root.removeEventListener('mouseleave', handlers.mouseleave);
    root.removeEventListener('focus', handlers.rootFocus);
    root.removeEventListener('blur', handlers.rootBlur);
    root.removeEventListener('contextmenu', handlers.contextmenu);
    root.removeEventListener('click', handlers.click);
    document.removeEventListener('input', handlers.input);
    document.removeEventListener('mousemove', handlers.mousemove);
    document.removeEventListener('selectionchange', handlers.selectionchange);
    window.removeEventListener('focus', handlers.windowFocus);
    window.removeEventListener('blur', handlers.windowBlur);
    document.removeEventListener('visibilitychange', handlers.visibilitychange);
    handlers = {};

    if (root) { root.remove(); root = null; }
    segments = [];
    zones = [];
    hotspots = [];
    active.clear();
    segmentEffects = [];
    Object.keys(nextDue).forEach(k => delete nextDue[k]);
    Object.keys(nextSegDue).forEach(k => delete nextSegDue[k]);
  }

  return { init, destroy, notifyEdit, switchTab, setStatus, onPreviewOpen: startPreviewScare, onClick(fn) { onClickCallback = fn; } };
})();