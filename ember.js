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
  const MAX_SEG_EFFECTS = 2;

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
  const dirtySegments = new Set();

  let particles = [];
  let nextAshSpawn = 0;
  let nextSparkCheck = 0;
  let activeSparks = 0;
  let nextAnomalySparkAt = 0;

  const POOL_SIZE = 40;
  let particlePool = [];
  let freeParticleIndices = [];
  let glowPool = [];
  let freeGlowEls = [];
  let heatZonePool = [];
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
  let bobPhase = 0;
  let ringTrackX = 0, ringTrackY = 0;
  const mood = { agitated: 0, calm: 0.5, sleepy: 0 };
  let lastMoodUpdate = 0;

  let focusState = 'active';
  let focusTimer = 0;
  let sparkDone = false;
  let settlingDuration = 0;

  // --- курсор ---
  const mouse = { x: 0, y: 0, lastSampleX: 0, lastSampleY: 0, lastSampleTime: 0, speed: 0 };
  const caret = { x: 0, y: 0, active: false, typing: false, _typingTimer: null };
  const cursorLean = { x: 0, y: 0, squish: 0, scale: 1, tiltX: 0, tiltY: 0 };

  // --- getEmberCenter cache (per-frame) ---
  const _emberCenterCache = { x: 0, y: 0, frame: -1 };

  // --- pose buffer (reused each frame) ---
  const POSE_BUF = {
    x: 0, y: 0,
    scaleX: 1, scaleY: 1,
    squash: 0, rotate: 0,
    tiltX: 0, tiltY: 0,
    glow: 0, brightness: 0,
    hue: 0, saturation: 0,
    glowSkewX: 0, glowSkewY: 0,
    glowX: 0, glowY: 0,
    crustX: 0, crustY: 0, crustRot: 0, crustScale: 1,
    ashShiftX: 0, ashShiftY: 0, ashRot: 0,
    ringExpand: 0,
    ringExpandX: 0, ringExpandY: 0,
    segScaleX: 1, segScaleY: 1,
    glintOpacity: 0, glintX: 58, glintY: 32, glintRot: -18, glintScale: 1,
    massShiftX: 0, massShiftY: 0,
    upperBulge: 0, lowerSag: 0, sideBulge: 0,
    z: 0,
    coreLift: 0,
    glowLift: 0,
    ringDepth: 0,
    lightX: 0,
    lightY: 0,
    shadowTighten: 0,
  };
  const _poseDefaults = {};
  for (const k in POSE_BUF) _poseDefaults[k] = POSE_BUF[k];
  function resetPose() { for (const k in _poseDefaults) POSE_BUF[k] = _poseDefaults[k]; }

  // --- mouse movement tracking for idle gate ---
  let mouseMovedSinceLastFrame = false;
  let _mouseDirty = false;
  let _lastMouseEvent = null;

  // --- particle throttle ---
  let _particleFrameToggle = 0;
  let _fullUpdateDone = false;

  // --- idle callback for deferred work ---
  let _idleCallbackId = null;

  // --- temperament ---
  const temperament = { curiosity: 0, nervousness: 0, tiredness: 0, satisfaction: 0 };

  // --- gaze (взгляд) ---
  const gaze = { x: 0, y: 0, strength: 0 };

  // --- anticipation ---
  const anticipation = { active: false, type: null, start: 0, dur: 0, power: 0 };

  // --- split heat ---
  let flashHeat = 0;
  let coreHeatReserve = 0;

  // --- breath ---
  let breathHoldUntil = 0;

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
  let allowTestMode = false;
  let testModeTimer = null;
  let nextTestStepTimer = null;
  let allowTestModeTimer = null;

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
  const reduceMotionMql = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = reduceMotionMql.matches;
  let handlers = {};
  let listenersBound = false;
  let onClickCallback = null;
  const timers = new Set();

  function defer(fn, delay) {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!root) return;
      fn();
    }, delay);
    timers.add(id);
    return id;
  }

  function clearDeferred(id) {
    if (!id) return;
    clearTimeout(id);
    timers.delete(id);
  }

  function clearAllDeferred() {
    timers.forEach(id => clearTimeout(id));
    timers.clear();
  }
  function deferBurst(fn, count, interval) {
    const id = setTimeout(function step() {
      timers.delete(id);
      if (destroyed || !root) return;
      fn();
      if (count > 1) {
        deferBurst(fn, count - 1, interval);
      }
    }, interval);
    timers.add(id);
  }

  // ---------- утилиты ----------

  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function easeOutQuad(t) { return t * (2 - t); }

  function mixRgb(r1,g1,b1, r2,g2,b2, t) {
    return [
      Math.round(r1 + (r2 - r1) * t),
      Math.round(g1 + (g2 - g1) * t),
      Math.round(b1 + (b2 - b1) * t),
    ];
  }

  // ---------- style cache ----------
  const styleCache = new Map();
  function setVar(el, name, value) {
    if (!el) return;
    let map = styleCache.get(el);
    if (!map) { map = new Map(); styleCache.set(el, map); }
    if (map.get(name) === value) return;
    map.set(name, value);
    el.style.setProperty(name, value);
  }
  function setVarApprox(el, name, value, eps) {
    if (!el) return;
    let map = styleCache.get(el);
    if (!map) { map = new Map(); styleCache.set(el, map); }
    const old = map.get(name);
    if (old !== undefined && Math.abs(old - value) < eps) return;
    map.set(name, value);
    el.style.setProperty(name, value);
  }

  function removeVar(el, name) {
    if (!el) return;
    const map = styleCache.get(el);
    if (map) map.delete(name);
    el.style.removeProperty(name);
  }

  function computeBreath() {
    if (Date.now() > nextBreathSwitch) {
      breathPatternIdx = (breathPatternIdx + 1) % breathPattern.length;
      nextBreathSwitch = Date.now() + rand(2000, 6000);
    }
    const breathAmp = breathPattern[breathPatternIdx];
    const flicker =
      Math.sin(breathPhase * 2.5) * 0.5 +
      Math.sin(breathPhase * 6.3 + 1.7) * 0.3 +
      Math.sin(breathPhase * 11.1 + 4.2) * 0.2;
    return { breathAmp, flicker };
  }

  function setStyle(el, prop, value) {
    if (!el) return;
    const key = 'style:' + prop;
    let map = styleCache.get(el);
    if (!map) { map = new Map(); styleCache.set(el, map); }
    if (map.get(key) === value) return;
    map.set(key, value);
    el.style[prop] = value;
  }
  function easeInQuad(t) { return t * t; }
  function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function bump(t, riseEnd, holdEnd) {
    if (t < riseEnd) return easeOutQuad(t / riseEnd);
    if (t < holdEnd) return 1;
    return 1 - easeInQuad((t - holdEnd) / (1 - holdEnd));
  }

  // --- редкие экстремальные события ---
  const anomaly = {
    sparkStorm:       { chance: 1 / (30 * 60), mult: [3, 6] },
    deformationBurst: { chance: 1 / (20 * 60), mult: [3, 5] },
    ringPulseBig:     { chance: 1 / (60 * 60), mult: [2, 3] },
    heatBubble:       { chance: 1 / (45 * 60), mult: [2, 4] },
    coalSigh:         { chance: 1 / (40 * 60), mult: [2, 3] },
    hotVein:          { chance: 1 / (25 * 60), mult: [1.5, 2.5] },
    ashDump:          { chance: 1 / (35 * 60), mult: [2, 3] },
  };

  function activateRare(type) {
    const ev = anomaly[type];
    const mul = rand(ev.mult[0], ev.mult[1]);
    switch (type) {
      case 'sparkStorm':
        for (let i = 0; i < Math.floor(rand(10, 16)); i++) defer(() => spawnSpark(Math.random()), i * 35);
        for (let i = 0; i < 3; i++) defer(spawnShootingSpark, 80 + i * 110);
        igniteCrackSide(Math.random() < 0.5 ? -1 : 1);
        heatBoost = Math.max(heatBoost, 0.34 * mul);
        ringImpulse = rand(7, 12) * (Math.random() < 0.5 ? 1 : -1);
        break;
      case 'deformationBurst':
        heatBoost = Math.max(heatBoost, 0.3 * mul);
        residualHeat += 0.25;
        for (let i = 0; i < 6; i++) defer(spawnAshParticle, i * 70);
        igniteCrackSide(-1);
        igniteCrackSide(1);
        active.set('stretch', { phase: 0, durMs: rand(900, 1400), amp: 1.2, mag: 1.1, _geomWeight: 1 });
        break;
      case 'ringPulseBig':
        heatBoost = Math.max(heatBoost, 0.2 * mul);
        ringImpulse = rand(10, 16) * (Math.random() < 0.5 ? 1 : -1);
        for (let i = 0; i < 6; i++) {
          defer(() => {
            const idx = i % 12;
            const seg = segments[idx];
            if (seg) seg.style.setProperty('--seg-flash', '1');
          }, i * 45);
        }
        break;
      case 'heatBubble':
        heatBoost = Math.max(heatBoost, 0.24 * mul);
        flashHeat = Math.max(flashHeat, 0.18);
        for (let i = 0; i < 3; i++) defer(spawnSpark, i * 90);
        active.set('glowPulse', { phase: 0, durMs: rand(1000, 1500), mag: 1.2 });
        break;
      case 'coalSigh':
        heatBoost = Math.max(heatBoost, 0.12 * mul);
        for (let i = 0; i < 6; i++) defer(spawnAshParticle, i * 100);
        active.set('sigh', { phase: 0, durMs: rand(3200, 4200), mag: 1.1, glow: 0.2, _geomWeight: 1 });
        break;
      case 'hotVein': {
        const side = Math.random() < 0.5 ? -1 : 1;
        igniteCrackSide(side);
        heatBoost = Math.max(heatBoost, 0.12 * mul);
        crackGlowMod += 0.7;
        break;
      }
      case 'ashDump':
        for (let i = 0; i < Math.floor(rand(8, 12)); i++) defer(spawnAshParticle, i * 45);
        break;
    }
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
    const now = Date.now();
    return { lastEditTime: now, lastInitTime: 0, updatedAt: now };
  }

  function normalizeState(s) {
    if (!s || typeof s.lastEditTime !== 'number') return null;
    return {
      lastEditTime: s.lastEditTime,
      lastInitTime: typeof s.lastInitTime === 'number' ? s.lastInitTime : 0,
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : s.lastEditTime,
      sourceTabId: s.sourceTabId || null,
    };
  }

  function applyRemoteState(next) {
    const normalized = normalizeState(next);
    if (!normalized) return;
    if (!state) {
      state = normalized;
      persistMergedState();
      return;
    }
    const currentUpdatedAt = state.updatedAt || 0;
    const nextUpdatedAt = normalized.updatedAt || 0;
    const currentEdit = state.lastEditTime || 0;
    const nextEdit = normalized.lastEditTime || 0;

    const isNewer =
      nextUpdatedAt > currentUpdatedAt ||
      (nextUpdatedAt === currentUpdatedAt && nextEdit > currentEdit) ||
      (nextUpdatedAt === currentUpdatedAt && nextEdit === currentEdit &&
        String(normalized.sourceTabId || '') > String(state.sourceTabId || ''));

    if (!isNewer) return;

    state = {
      lastEditTime: normalized.lastEditTime,
      lastInitTime: Math.max(state.lastInitTime || 0, normalized.lastInitTime || 0),
      updatedAt: normalized.updatedAt,
      sourceTabId: normalized.sourceTabId,
    };
    persistMergedState();
    syncAccessibleLabel(true);
    if (tooltipEl) showTooltip();
  }

  function saveState() {
    if (state) state.sourceTabId = currentTabId;
    try { localStorage.setItem(getStorageKey(currentTabId), JSON.stringify(state)); } catch {}
  }

  function persistMergedState() {
    if (!state) return;
    try { localStorage.setItem(getStorageKey(currentTabId), JSON.stringify(state)); } catch {}
  }

  function broadcast() {
    try { channel && channel.postMessage({ type: 'update', tabId: currentTabId, state }); } catch {}
  }

  function setupBroadcast() {
    if (handlers.storageSync) {
      window.removeEventListener('storage', handlers.storageSync);
      handlers.storageSync = null;
    }
    if (channel) {
      try { channel.close(); } catch {}
      channel = null;
    }
    try {
      channel = new BroadcastChannel(BROADCAST_KEY);
      channel.onmessage = (e) => {
        if (e.data?.type === 'update' && e.data?.tabId !== currentTabId && e.data?.state) {
          applyRemoteState(e.data.state);
        }
      };
    } catch {}
    handlers.storageSync = (e) => {
      if (!e.key || !e.newValue) return;
      if (e.key !== getStorageKey(currentTabId)) return;
      try {
        const s = JSON.parse(e.newValue);
        applyRemoteState(s);
      } catch {}
    };
    window.addEventListener('storage', handlers.storageSync);
  }

  let _editTooltipTimer = null;

  function notifyEdit() {
    if (!state) return;
    const now = Date.now();
    state.lastEditTime = now;
    state.updatedAt = now;
    state.sourceTabId = currentTabId;
    saveState();
    broadcast();
    syncAccessibleLabel(true);
    clearDeferred(_editTooltipTimer);
    clearDeferred(tooltipHideTimer);
    _editTooltipTimer = defer(() => { if (tooltipEl) showTooltip(); }, 800);
  }

  function setStatus(type) {
    if (!root) return;
    clearDeferred(statusTimer);
    statusState = type;
    statusBurstDone = false;
    if (type === 'saving' || type === 'saved' || type === 'error') {
      const dur = type === 'error' ? 2500 : 1500;
      statusTimer = defer(() => { statusState = null; }, dur);
    }
    if (tooltipEl) showTooltip();
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
          for (let i = 0; i < 4; i++) defer(spawnSpark, i * 80);
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
    if (!state.lastInitTime) {
      state.lastInitTime = Date.now();
      state.updatedAt = state.lastInitTime;
      saveState();
    }
    setupBroadcast();
    spawnStart = performance.now();
    prevRemaining = remainingSegments();
    lastWarnRemaining = remainingSegments();
    prevAppliedRemaining = -1;
    syncAccessibleLabel(true);
    if (tooltipEl) showTooltip();
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

  let prevAppliedRemaining = -1;

  function applySegments() {
    const remaining = remainingSegments();
    if (remaining === prevAppliedRemaining) return;
    if (remaining > prevRemaining) {
      const added = remaining - prevRemaining;
      const totalWindow = clamp(300 + added * 20, 300, 500);
      const step = totalWindow / added;
      for (let i = prevRemaining; i < remaining; i++) {
        setVar(segments[i], '--reveal-delay', ((i - prevRemaining) * step).toFixed(0));
      }
      defer(() => {
        for (let i = prevRemaining; i < remaining; i++) {
          removeVar(segments[i], '--reveal-delay');
        }
      }, totalWindow + 50);
    }
    segments.forEach((seg, i) => seg.classList.toggle('active', i < remaining));
    prevRemaining = remaining;
    prevAppliedRemaining = remaining;
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

    const nextZones = [];
    zones.forEach((zone, i) => {
      const isExtraZone = i >= 3;
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
        if (isExtraZone) {
          zone.style.display = 'none';
          styleCache.delete(zone);
          heatZonePool.push(zone);
          return;
        }
        zone._life = rand(4000, 10000);
        zone._targetHeat = rand(0.4, 1.3);
        zone._targetX = rand(20, 80);
        zone._targetY = rand(20, 80);
        if (Math.random() < 0.1 && zones.length < 6 && heatZonePool.length > 0) {
          const nz = heatZonePool.pop();
          nz.style.display = '';
          nz._life = rand(2000, 5000);
          nz._targetHeat = rand(0.3, 0.9);
          nz._targetX = rand(20, 80);
          nz._targetY = rand(20, 80);
          nz._curHeat = 0.3;
          nz._curX = zone._curX;
          nz._curY = zone._curY;
          nextZones.push(nz);
        }
      }
      const lerpSpeed = 0.0015 * dt;
      zone._curHeat += (zone._targetHeat - zone._curHeat) * clamp(lerpSpeed, 0, 1);
      zone._curX += (zone._targetX - zone._curX) * clamp(lerpSpeed * 0.8, 0, 1);
      zone._curY += (zone._targetY - zone._curY) * clamp(lerpSpeed * 0.8, 0, 1);
      setVar(zone, '--cx', clamp(zone._curX, 10, 90).toFixed(1) + '%');
      setVar(zone, '--cy', clamp(zone._curY, 10, 90).toFixed(1) + '%');
      setVar(zone, '--zoneHeat', clamp(zone._curHeat, 0, 1.5).toFixed(3));
      if (zone.isConnected) nextZones.push(zone);
    });
    const avgHeat = nextZones.reduce((s, z) => s + (z._curHeat || 0.6), 0) / Math.max(nextZones.length, 1);
    if (crustEl) setStyle(crustEl, 'opacity', (0.5 + (1 - intensity) * 0.4 - avgHeat * 0.15).toFixed(3));
    zones = nextZones;
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
    const GLOBAL_DAMPING = 0.65;
    if (Math.random() >= probability * GLOBAL_DAMPING) { rescheduleDue(type); return; }
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
      ringExpandX: 0, ringExpandY: 0,
      segScaleX: 1, segScaleY: 1,
      glintOpacity: 0, glintX: 58, glintY: 32, glintRot: -18, glintScale: 1,
      massShiftX: 0, massShiftY: 0,
      upperBulge: 0, lowerSag: 0, sideBulge: 0,
      z: 0,
      coreLift: 0,
      glowLift: 0,
      ringDepth: 0,
      lightX: 0,
      lightY: 0,
      shadowTighten: 0,
    };
  }

  function applySighPose(pose, eff) {
    const p = eff.phase;
    const inhale = p < 0.22 ? easeOutQuad(p / 0.22) * 0.9 : 0;
    const exhale = p > 0.26 ? Math.pow((p - 0.26) / 0.74, 0.62) : 0;
    const drop = p > 0.52 ? Math.sin((p - 0.52) * Math.PI * 2.6) * (1 - p) * 0.18 : 0;
    const w = eff._geomWeight ?? 1;

    pose.squash += (-inhale * 0.10 + exhale * 0.24 + drop * 0.5) * w;
    pose.y += (-inhale * 1.6 + exhale * 3.4 + drop * 2.2) * w;
    pose.massShiftY += exhale * 1.1;
    pose.lowerSag += exhale * 0.9;
    pose.glow -= exhale * 0.08;
    pose.coreLift += inhale * 1.2 - exhale * 1.8;
    pose.shadowTighten += exhale * 0.15;

    if (p > 0.56 && p < 0.62 && !eff.ashDone) {
      eff.ashDone = true;
      for (let i = 0; i < 3; i++) defer(spawnAshParticle, i * 90);
    }
  }

  function applyCalmBurnPose(pose, eff) {
    const p = eff.phase;
    const base = bump(p, 0.18, 0.82);
    const flick = Math.sin(p * Math.PI * 5.7) * 0.06 + Math.sin(p * Math.PI * 13.2) * 0.03;
    const micro = p > 0.25 && p < 0.75 ? Math.sin(p * Math.PI * 29) * 0.015 : 0;
    const w = eff._geomWeight ?? 1;

    pose.glow += (base * 0.18 + flick + micro) * w;
    pose.brightness += (base * 0.14 + flick * 0.5) * w;
    pose.hue += base * (eff.hue ?? 0);
    pose.lightX += flick * 18;
    pose.lightY -= base * 8;
  }

  function applyWigglePose(pose, eff) {
    const p = eff.phase;
    const amp = eff.amp ?? 1;
    const w = eff._geomWeight ?? 1;

    const burst = p < 0.14 ? easeOutQuad(p / 0.14) * 1.4 : 0;
    const jitter = p >= 0.14 && p < 0.55
      ? Math.sin(p * Math.PI * 18) * Math.exp(-(p - 0.14) * 4.8)
      : 0;
    const settle = p >= 0.55
      ? Math.sin((p - 0.55) * Math.PI * 6) * (1 - p) * 0.35
      : 0;

    const shake = burst + jitter + settle;

    pose.x += shake * 2.2 * amp * w;
    pose.rotate += shake * 7.5 * amp * w;
    pose.tiltY += shake * 1.6 * amp;
    pose.sideBulge += Math.abs(jitter) * 0.12;
  }

  function applyTiltPose(pose, eff) {
    const p = eff.phase;
    const dir = Math.sign(eff.target || 1);

    const leanIn = p < 0.68 ? 1 - Math.pow(1 - p / 0.68, 2.2) : 1;
    const hang = p > 0.68 ? 1 - ((p - 0.68) / 0.32) * 0.35 : 1;
    const k = leanIn * hang;
    const settle = p > 0.78 ? Math.sin((p - 0.78) * Math.PI * 5) * (1 - p) * 0.12 : 0;

    pose.rotate += dir * (k * 5.8 + settle * 2.5);
    pose.x += dir * k * 1.8;
    pose.squash += -k * 0.04;
    pose.massShiftX += dir * k * 0.5;
    pose.tiltY += dir * k * 1.2;
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
      let heat = 0;
      if (layer.ignited) {
        const t = clamp((now - layer.igniteStart) / layer.igniteDur, 0, 1);
        if (t >= 1) { layer.ignited = false; }
        else {
          heat = t < 0.15
            ? easeOutQuad(t / 0.15)
            : 1 - 0.7 * (1 - Math.pow(1 - (t - 0.15) / 0.85, 2));
          opacity = clamp(crackGlow + (1 - crackGlow) * heat * 1.4, 0, 1);
        }
      }
      setStyle(layer.el, 'opacity', opacity.toFixed(3));
      setVar(layer.el, '--crack-opacity', opacity.toFixed(3));
      const c1 = mixRgb(255, 180, 60, 255, 240, 180, heat);
      const glow = mixRgb(255, 180, 100, 255, 255, 230, heat);
      setVar(layer.el, '--crack-c1', `rgba(${c1[0]},${c1[1]},${c1[2]},${(0.6 + heat * 0.4).toFixed(2)})`);
      setVar(layer.el, '--crack-glow-color', `rgba(${glow[0]},${glow[1]},${glow[2]},${(0.5 + heat * 0.3).toFixed(2)})`);
    });
  }

  function applyCracklePose(pose, eff) {
    const p = eff.phase;
    const mag = eff.mag ?? 1;
    const side = eff.side ?? (Math.random() < 0.5 ? -1 : 1);

    const bulge = p >= 0.08 && p < 0.22 ? Math.sin((p - 0.08) / 0.14 * Math.PI) : 0;
    const tremor = p >= 0.22 ? Math.sin((p - 0.22) * 40) * Math.exp(-(p - 0.22) * 6) : 0;

    const w = eff._geomWeight ?? 1;
    pose.x += side * (bulge * 2.4 + tremor * 1.2 + 5) * mag * w;
    pose.rotate += side * tremor * 14 * mag * w;

    if (!eff.crackFired && p > 0.1 && p < 0.15) {
      eff.crackFired = true;
      igniteCrackSide(side);
      defer(() => spawnSpark(side > 0 ? 0.7 : 0.3), 40);
      defer(() => spawnAshParticle(), 50);
      defer(() => spawnAshParticle(), 140);
      residualHeat += 0.2;
      pose.crustX += rand(-1.5, 1.5) * mag;
      pose.crustRot += rand(-2, 2) * mag;
      spawnCrumb();
    }
  }

  function applyStretchPose(pose, eff) {
    const p = eff.phase;
    const amp = eff.amp ?? 1;
    const w = eff._geomWeight ?? 1;

    const extend = p > 0.10 && p < 0.52 ? Math.sin((p - 0.10) / 0.42 * Math.PI) : 0;
    const rebound = p >= 0.52 ? Math.sin((p - 0.52) * Math.PI * 4.2) * (1 - p) * 0.18 : 0;
    const total = extend + rebound;

    pose.scaleY *= 1 + total * 0.13 * amp * w;
    pose.scaleX *= 1 - total * 0.035 * amp * w;
    pose.glow += extend * 0.14 * w;
    pose.glowY -= extend * 3.2;
    pose.glintX += extend * 10;
    pose.coreLift += extend * 1.6;
  }

  function applyGlintPose(pose, eff) {
    const k = bump(eff.phase, 0.2, 0.55);
    pose.glintOpacity = k;
    pose.glintX = 45 + k * 30 + eff.phase * 10;
    pose.glintScale = 1 + k * 1.2;
    pose.squash += -k * 0.1;
    pose.scaleX *= 1 + k * 0.025;
    pose.hue += k * (eff.hue ?? 25);
    pose.saturation += k * (eff.sat ?? 0.4);
  }

  function applySleepySagPose(pose, eff) {
    const p = eff.phase;
    const melt = p < 0.82 ? Math.pow(p / 0.82, 1.6) : 1;
    const drift = Math.sin(p * Math.PI * 1.5) * 0.2;
    const w = eff._geomWeight ?? 1;

    pose.y += (melt * 3.8 + drift) * w;
    pose.squash += melt * 0.38 * w;
    pose.massShiftY += melt * 1.25;
    pose.lowerSag += melt * 0.95;
    pose.glow -= melt * 0.06;
    pose.shadowTighten += melt * 0.22;
  }

  function applySmolderPose(pose, eff) {
    const p = eff.phase;
    const base = bump(p, 0.22, 0.86);
    const emberNoise = Math.sin(p * Math.PI * 4.1) * 0.18 + Math.sin(p * Math.PI * 11.3) * 0.08;
    const flare = Math.exp(-Math.pow((p - 0.64) / 0.06, 2)) * 0.8;

    pose.hue += base * (eff.hue ?? 20) + flare * 6;
    pose.saturation += base * (eff.sat ?? 0.25) + flare * 0.12;
    pose.glow += base * 0.18 + emberNoise * 0.08 + flare * 0.24;
    pose.brightness += base * 0.08 + flare * 0.12;
    pose.lightX += emberNoise * 24;
    crackGlowMod += base * 0.45 + flare * 0.9;
  }

  function applyHeatRadiancePose(pose, eff) {
    const k = bump(eff.phase, 0.3, 0.7);
    pose.glow += k * 0.6;
    pose.ringExpandX += k * 6;
    pose.ringExpandY += k * 2.5;
    pose.glowY -= k * 3;
    pose.glowSkewX += Math.sin(eff.phase * Math.PI * 3) * 12;
    pose.squash += -k * 0.08;
    pose.scaleX *= 1 + k * 0.015;
  }

  function applyGlowPulsePose(pose, eff) {
    const p = eff.phase;
    const beat1 = Math.exp(-Math.pow((p - 0.25) / 0.08, 2));
    const beat2 = Math.exp(-Math.pow((p - 0.48) / 0.11, 2));
    const beat = beat1 * 0.5 + beat2;
    pose.scaleY *= 1 + beat * 0.1;
    pose.glow += beat * 1.0;
    pose.ringExpandX += beat * 3;
    pose.ringExpandY += beat * 4;
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
    const p = eff.phase;
    const dir = eff.dir ?? 1;
    const w = eff._geomWeight ?? 1;

    const blast = p < 0.18 ? easeOutQuad(p / 0.18) : 1;
    const carry = p >= 0.18 && p < 0.58 ? 1 - ((p - 0.18) / 0.40) * 0.25 : 0.75;
    const snapBack = p >= 0.58 ? Math.sin((p - 0.58) * Math.PI * 3.5) * (1 - p) * 0.22 : 0;
    const k = (blast * carry) + snapBack;

    pose.x += dir * k * 5.4 * w;
    pose.rotate += dir * k * 13 * w;
    pose.tiltY += dir * k * 1.8;
    pose.ashShiftX += dir * k * 1.6;
    pose.glowSkewX += dir * k * 8;
  }

  function commitPose(pose, now, dt) {
    glowTrackX += (pose.glowX - glowTrackX) * 0.08;
    glowTrackY += (pose.glowY - glowTrackY) * 0.08;
    ashTrackX += (pose.ashShiftX - ashTrackX) * 0.03;
    ashTrackY += (pose.ashShiftY - ashTrackY) * 0.03;
    hazeTrackX += (pose.x * 0.1 - hazeTrackX) * 0.015;
    pose.glow += residualHeat + flashHeat * 0.9 + coreHeatReserve * 0.45;

    // depth bias — glow поднимается, ring уходит
    pose.z += hoverVal * 0.8 + Math.abs(cursorLean.x) * 0.02;
    pose.glowLift += pose.glow * 1.6;
    pose.ringDepth += ringImpulse * 0.18;

    // floating bob — медленное парение, отдельное от дыхания
    bobPhase += 0.0008;
    const bobY = Math.sin(bobPhase * 2 * Math.PI / 9) * 1.2;

    // 3D depth calculations
    const depthTiltX = clamp((pose.tiltX + cursorLean.tiltX) * 1.15, -18, 18);
    const depthTiltY = clamp((tiltCurrent * 0.6 + pose.tiltY + cursorLean.tiltY) * 1.2, -18, 18);
    const depthZ = pose.z + pose.coreLift + hoverVal * 1.5 + gaze.strength * 1.2;
    const glowDepth = pose.glowLift + hoverVal * 2.2 + windGust * 1.5;
    const ringDepthVal = pose.ringDepth - hoverVal * 0.8;

    // contact shadow — масштаб зависит от высоты + shadowTighten
    const shadowBase = 1 + Math.abs(pose.y) * 0.02 + Math.abs(bobY) * 0.05 - pose.shadowTighten * 0.08;
    const shadowAlpha = clamp(0.45 - Math.abs(pose.y + bobY) * 0.01 + pose.shadowTighten * 0.06, 0.15, 0.62);
    setVar(root, '--shadowScale', shadowBase.toFixed(3));
    setVar(root, '--shadowAlpha', shadowAlpha.toFixed(3));

    const shiftX = heatOffsetX * 0.6 + pose.x * 0.35 + ashTrackX * 0.3;
    const shiftY = heatOffsetY * 0.6 - hoverVal * 0.5 + pose.y * 0.35 + bobY;

    setVar(root, '--shiftX', shiftX.toFixed(2) + 'px');
    setVar(root, '--shiftY', shiftY.toFixed(2) + 'px');

    setVar(root, '--depthZ', depthZ.toFixed(2) + 'px');
    setVar(root, '--glowDepth', glowDepth.toFixed(2) + 'px');
    setVar(root, '--ringDepth', ringDepthVal.toFixed(2) + 'px');

    const sq = clamp(pose.squash, -1, 1);
    const absSq = Math.abs(sq);
    const stretchK = 1 + absSq * 0.55;
    const squashX = absSq > 0.005 ? (sq > 0 ? stretchK : 1 / stretchK) : 1;
    const squashY = absSq > 0.005 ? (sq > 0 ? 1 / stretchK : stretchK) : 1;
    setVar(root, '--scaleX', (pose.scaleX * breathScale * cursorLean.scale * spawnCore * squashX).toFixed(4));
    setVar(root, '--scaleY', (pose.scaleY * breathScale * cursorLean.scale * spawnCore * squashY).toFixed(4));
    setVar(root, '--rotation', (tiltCurrent + pose.rotate).toFixed(2) + 'deg');
    setVar(root, '--tiltX', (pose.tiltX + cursorLean.tiltX).toFixed(2) + 'deg');
    setVar(root, '--tiltY', (tiltCurrent * 0.6 + pose.tiltY + cursorLean.tiltY).toFixed(2) + 'deg');

    const glow = clamp(intensity + heatBoost * 0.4 + pose.glow + hoverVal * 0.2 + windGust * 0.25, 0, 1.8);
    const brightness = clamp(0.8 + intensity * 0.35 + pose.brightness + heatBoost * 0.45 + hoverVal * 0.18 + windGust * 0.35, 0.4, 2.5);

    setVar(root, '--heat', heat.toFixed(3));
    setVar(root, '--glow', glow.toFixed(3));
    setVar(root, '--intensity', intensity.toFixed(3));
    setVar(root, '--hover', hoverVal.toFixed(3));
    setVar(root, '--brightness', brightness.toFixed(3));
    setVar(root, '--glowOpacity', (1.1 + hoverVal * 0.18 + windGust * 0.25).toFixed(3));
    setVar(root, '--glowBlur', (6 + hoverVal * 1.8 + windGust * 2.5).toFixed(2) + 'px');
    setVar(root, '--glowScale', (1.04 + hoverVal * 0.1 + windGust * 0.08).toFixed(3));
    setVar(root, '--ringOpacity', clamp(intensity * 0.6 + 0.4, 0, 1).toFixed(3));

    setVar(root, '--glowSkewX', pose.glowSkewX.toFixed(1) + 'deg');
    setVar(root, '--glowSkewY', pose.glowSkewY.toFixed(1) + 'deg');
    const gazeGlowX = gaze.x * 0.18 * gaze.strength;
    const gazeGlowY = gaze.y * 0.12 * gaze.strength;
    setVar(root, '--glowX', (glowTrackX + gazeGlowX).toFixed(2) + 'px');
    setVar(root, '--glowY', (glowTrackY + gazeGlowY).toFixed(2) + 'px');
    setVar(root, '--lightX', (pose.lightX + gaze.x * 0.45).toFixed(2) + '%');
    setVar(root, '--lightY', (pose.lightY + gaze.y * 0.35).toFixed(2) + '%');

    setVar(root, '--crustX', pose.crustX.toFixed(2) + 'px');
    setVar(root, '--crustY', pose.crustY.toFixed(2) + 'px');
    setVar(root, '--crustRot', pose.crustRot.toFixed(2) + 'deg');
    setVar(root, '--crustScale', pose.crustScale.toFixed(3));

    setVar(root, '--ashShiftX', ashTrackX.toFixed(2) + 'px');
    setVar(root, '--ashShiftY', ashTrackY.toFixed(2) + 'px');
    setVar(root, '--ashRot', pose.ashRot.toFixed(2) + 'deg');

    setVar(root, '--ringExpand', (pose.ringExpand + pose.ringExpandY).toFixed(2) + 'px');
    setVar(root, '--ringExpandX', pose.ringExpandX.toFixed(2) + 'px');

    setVar(coreEl, '--glintOpacity', pose.glintOpacity.toFixed(3));
    setVar(coreEl, '--glintX', pose.glintX.toFixed(1) + '%');
    setVar(coreEl, '--glintY', pose.glintY.toFixed(1) + '%');
    setVar(coreEl, '--glintRot', pose.glintRot.toFixed(1) + 'deg');
    setVar(coreEl, '--glintScale', pose.glintScale.toFixed(3));
    // glint от курсора — блик скользит по поверхности при наклоне
    const glintCursorX = (cursorLean.tiltY || 0) * 0.8 + gaze.x * 0.15 * gaze.strength;
    const glintCursorY = (cursorLean.tiltX || 0) * -0.5 + gaze.y * -0.10 * gaze.strength;
    setVar(coreEl, '--glintCursorX', glintCursorX.toFixed(1) + '%');
    setVar(coreEl, '--glintCursorY', glintCursorY.toFixed(1) + '%');

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
      setStyle(coreEl, 'animation', 'none');
      setStyle(coreEl, 'borderRadius',
        `${(48+sqBr*4.5+uB*24-lS*9).toFixed(1)}% ${(52-sqBr*4.5+sB*18-uB*12).toFixed(1)}% ${(52-sqBr*6+lS*21-sB*9).toFixed(1)}% ${(48+sqBr*6+msX*9).toFixed(1)}% / ${(50-sqBr*12+msY*15-uB*12).toFixed(1)}% ${(46+sqBr*6+msX*6).toFixed(1)}% ${(50+sqBr*9+lS*15).toFixed(1)}% ${(50-sqBr*6+msY*9).toFixed(1)}%`);
    } else if (hasActiveSquash) {
      hasActiveSquash = false;
      setStyle(coreEl, 'animation', '');
      setStyle(coreEl, 'borderRadius', '');
    }

    setVar(coreEl, '--cursorLeanX', cursorLean.x.toFixed(1));
    setVar(coreEl, '--cursorLeanY', cursorLean.y.toFixed(1));
    setVar(coreEl, '--cursorSquish', cursorLean.squish.toFixed(3));
    setVar(coreEl, '--cursorScale', cursorLean.scale.toFixed(3));
    setVar(coreEl, '--cursorTiltX', cursorLean.tiltX.toFixed(1));
    setVar(coreEl, '--cursorTiltY', cursorLean.tiltY.toFixed(1));

    setVar(root, '--spawnCore', spawnCore.toFixed(3));
    setVar(root, '--spawnGlow', spawnGlow.toFixed(3));
    setVar(root, '--spawnRing', spawnRing.toFixed(3));

    const totalHue = pose.hue;
    const totalSat = pose.saturation;
    if (totalHue || totalSat) {
      setStyle(coreEl, 'filter', `brightness(var(--brightness)) hue-rotate(${totalHue.toFixed(1)}deg) saturate(${(1 + totalSat).toFixed(3)})`);
    } else {
      setStyle(coreEl, 'filter', 'brightness(var(--brightness))');
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
    if (segmentEffects.length >= MAX_SEG_EFFECTS) return;
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

  function markSegmentDirty(seg) {
    if (seg) dirtySegments.add(seg);
  }

  function clearDirtySegments() {
    dirtySegments.forEach(seg => {
      setVar(seg, '--seg-tilt', '');
      setVar(seg, '--seg-flash', '');
      setVar(seg, '--seg-dim', '');
      setVar(seg, '--seg-brightness', '');
      setVar(seg, '--seg-push', '');
      setVar(seg, '--seg-scaleX', '');
      setVar(seg, '--seg-scaleY', '');
    });
    dirtySegments.clear();
  }

  function applySegmentWave(center, radius, fn) {
    segments.forEach((seg, i) => {
      const dist = Math.abs(i - center);
      const circularDist = Math.min(dist, 12 - dist);
      if (circularDist <= radius) {
        markSegmentDirty(seg);
        fn(seg, 1 - circularDist / (radius + 1), circularDist);
      }
    });
  }

  function applySegEffects() {
    clearDirtySegments();
    if (!segmentEffects.length) return;
    for (const e of segmentEffects) {
      const m = e.mag ?? 1;
      switch (e.type) {
        case 'segTremor': {
          const intensity = Math.sin(e.phase * Math.PI * 3) * 6 * m * (1 - e.phase);
          const push = Math.sin(e.phase * Math.PI) * 1.2 * m;
          applySegmentWave(e.segIdx, 2, (seg, falloff) => {
            setVar(seg, '--seg-tilt', (intensity * falloff).toFixed(2) + 'deg');
            setVar(seg, '--seg-push', (push * falloff).toFixed(2) + 'px');
          });
          break;
        }
        case 'segTryIgnite': {
          const flash = e.phase < 0.3 ? easeOutQuad(e.phase / 0.3) : 1 - easeInQuad((e.phase - 0.3) / 0.7);
          const seg = segments[e.segIdx];
          if (seg) {
            markSegmentDirty(seg);
            setVar(seg, '--seg-flash', flash.toFixed(3));
            setVar(seg, '--seg-scaleX', (1 - flash * 0.35).toFixed(3));
            setVar(seg, '--seg-scaleY', (1 + flash * 0.2).toFixed(3));
          }
          const neighbor = Math.random() < 0.5
            ? (segments[e.segIdx - 1] || segments[e.segIdx + 1])
            : (segments[e.segIdx + 1] || segments[e.segIdx - 1]);
          if (neighbor && flash > 0.3) {
            markSegmentDirty(neighbor);
            setVar(neighbor, '--seg-flash', (flash * 0.3).toFixed(3));
          }
          break;
        }
        case 'segHeatRipple': {
          const wavePos = e.phase * 12;
          const center = Math.floor(wavePos);
          const localFrac = wavePos - center;
          const wave = Math.sin(localFrac * Math.PI);
          applySegmentWave(center, 2, (seg, falloff) => {
            setVar(seg, '--seg-brightness', (wave * falloff * 1.2 * m).toFixed(3));
            setVar(seg, '--seg-push', (wave * falloff * 0.8 * m).toFixed(2) + 'px');
          });
          break;
        }
        case 'segFlicker': {
          const blink = Math.sin(e.phase * Math.PI * 6) * (1 - e.phase);
          const seg = segments[e.segIdx];
          if (seg) {
            markSegmentDirty(seg);
            setVar(seg, '--seg-dim', (0.7 + 0.7 * blink).toFixed(3));
            setVar(seg, '--seg-scaleX', (1 - Math.abs(blink) * 0.3).toFixed(3));
            setVar(seg, '--seg-scaleY', (1 + Math.abs(blink) * 0.15).toFixed(3));
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
            setVar(seg, '--seg-brightness', (wave * falloff * 0.8 * m).toFixed(3));
            setVar(seg, '--seg-push', (wave * falloff * 0.6 * m).toFixed(2) + 'px');
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
      el.__poolIndex = i;
      particleLayer.appendChild(el);
      particlePool.push({ el, free: true });
      freeParticleIndices.push(i);
    }
    for (let i = 0; i < 8; i++) {
      const el = document.createElement('div');
      el.className = 'ember-landing-glow';
      el.style.display = 'none';
      particleLayer.appendChild(el);
      glowPool.push(el);
      freeGlowEls.push(el);
    }
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div');
      el.className = 'heat-zone';
      el.style.display = 'none';
      coreEl.insertBefore(el, crustEl);
      heatZonePool.push(el);
    }
    poolInited = true;
  }

  function acquireEl(className) {
    if (!particleLayer) return null;
    const idx = freeParticleIndices.pop();
    if (idx == null) return null;
    const slot = particlePool[idx];
    slot.free = false;
    slot.el.className = className;
    slot.el.classList.add('active-particle');
    slot.el.style.display = '';
    slot.el.style.opacity = '0';
    slot.el.style.boxShadow = '';
    slot.el.style.transform = '';
    slot.el.style.borderRadius = '';
    slot.el.style.width = '';
    slot.el.style.height = '';
    return slot.el;
  }

  function releaseEl(el) {
    const i = el && el.__poolIndex;
    if (Number.isInteger(i) && particlePool[i] && particlePool[i].el === el) {
      if (particlePool[i].free) return;
      particlePool[i].free = true;
      freeParticleIndices.push(i);
      el.style.display = 'none';
      el.className = 'ember-ash';
      el.classList.remove('active-particle');
      el.style.opacity = '0';
      el.style.boxShadow = '';
      el.style.transform = '';
      el.style.width = '';
      el.style.height = '';
      el.style.left = '';
      el.style.top = '';
      el.style.borderRadius = '';
      return;
    }
    if (el) el.remove();
  }

  function spawnAshParticle() {
    if (particles.length > 40) return;
    if (focusState !== 'active') return;
    const roll = Math.random();
    const cls = 'ember-ash' + (roll < 0.33 ? ' dark' : roll > 0.8 ? ' bright' : '');
    const el = acquireEl(cls);
    if (!el) return;
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
      startX, startY,
      dur: rand(3000, 5600),
      rise: rand(-16, -8),
      drift: rand(-10, 10) + windGust * 3,
      sway: rand(4, 10),
      isSpark: false,
      scalePulse: true,
      swirlFactor: rand(0.6, 1.6),
      heatLift: rand(0.6, 1.2),
      rot: rand(-25, 25),
      rotSpeed: rand(-18, 18),
      alphaBias: rand(0.75, 1),
    });
  }

  function spawnSpark(hBias) {
    if (activeSparks >= 7) return;
    if (focusState !== 'active') return;
    const sparkTypes = ['spark-point', 'spark-elongated', 'spark-broken', 'spark-double'];
    const typeIdx = Math.floor(Math.random() * sparkTypes.length);
    const sparkType = sparkTypes[typeIdx];
    const el = acquireEl('ember-spark ' + sparkType);
    if (!el) return;
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
      startX, startY,
      dur: rand(380, 820),
      rise: rand(-36, -20),
      drift: rand(-10, 10) + windGust * 15,
      sway: rand(0.4, 1.8),
      isSpark: true,
      type: sparkType,
      gravity: 0.038,
      trail: true,
      windInfluence: 0.85,
      rot: rand(-35, 35),
      rotSpeed: rand(80, 180) * (Math.random() < 0.5 ? -1 : 1),
    });
  }

  function spawnShootingSpark() {
    if (activeSparks >= 7) return;
    if (focusState !== 'active') return;
    const el = acquireEl('ember-spark ember-spark-shoot');
    if (!el) return;
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
      startX, startY,
      dur: rand(420, 720),
      rise: Math.cos(angle) * -speed,
      drift: Math.sin(angle) * speed * 0.6 + windGust * 12,
      sway: 0,
      isSpark: true,
      type: 'shooting',
      trail: true,
      gravity: 0.02,
      windInfluence: 1.1,
      rot: angle * 60,
      rotSpeed: rand(120, 220) * (Math.random() < 0.5 ? -1 : 1),
    });
  }

  function spawnAnomalySpark() {
    if (activeSparks >= 7) return;
    if (focusState !== 'active') return;
    if (!root || !particleLayer) return;

    const el = acquireEl('ember-spark ember-spark-anomaly');
    if (!el) return;

    const size = Math.random() < 0.6 ? rand(1.4, 2.2) : rand(2.3, 3.8);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = (size * rand(1.2, 2.2)).toFixed(1) + 'px';

    const startX = rand(60, 74);
    const startY = rand(16, 32);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
    activeSparks++;

    const travel = rand(380, 720);
    const angle = rand(Math.PI * 0.55, Math.PI * 1.05);
    const horizontalBias = Math.random() < 0.4
      ? rand(-180, 180)
      : rand(-60, 60);
    const drift = Math.cos(angle) * travel + horizontalBias;
    const rise = Math.sin(angle) * travel;

    particles.push({
      el, born: performance.now(),
      startX, startY,
      dur: rand(1200, 2400),
      rise, drift,
      sway: rand(2, 12),
      isSpark: true,
      type: 'anomaly',
      trail: size > 2.25 ? Math.random() < 0.3 : Math.random() < 0.15,
      gravity: rand(0.003, 0.014),
      windInfluence: 0.18,
      rot: rand(-35, 20),
      rotSpeed: rand(20, 120) * (Math.random() < 0.5 ? -1 : 1),
      arcX: rand(-18, 18),
      arcY: rand(-10, 12),
      jitterFreq: rand(1.4, 2.6),
      jitterAmp: rand(2, 6),
      brightPulse: rand(0.85, 1.15),
      shedAt: Math.random() < 0.45 ? rand(0.22, 0.58) : null,
      shedDone: false,
    });
  }

  function spawnAnomalyDustFrom(p) {
    if (!p || activeSparks >= 7) return;
    if (focusState !== 'active') return;

    const el = acquireEl('ember-spark ember-spark-anomaly ember-spark-anomaly-dust');
    if (!el) return;

    const size = rand(1.1, 1.8);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = size.toFixed(1) + 'px';
    el.style.left = p.startX + '%';
    el.style.top = p.startY + '%';
    activeSparks++;

    particles.push({
      el, born: performance.now(),
      startX: p.startX,
      startY: p.startY,
      dur: rand(420, 760),
      rise: p.rise * rand(0.18, 0.34) + rand(-16, 8),
      drift: p.drift * rand(0.18, 0.32) + rand(-18, 12),
      sway: rand(0.6, 2.4),
      isSpark: true,
      type: 'anomaly-dust',
      trail: false,
      gravity: rand(0.01, 0.02),
      windInfluence: 0.1,
      rot: rand(-20, 20),
      rotSpeed: rand(-60, 60),
      alphaBias: rand(0.6, 0.9),
    });
  }

  function maybeSpawnAnomalySpark(now) {
    if (reduceMotion || lowFpsMode) return;
    if (egg.active || previewScare.active || testMode) return;
    if (focusState !== 'active') return;
    if (now < nextAnomalySparkAt) return;

    nextAnomalySparkAt = now + rand(12000, 32000);
    if (Math.random() > 0.384) return;

    const count = Math.random() < 0.78 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      defer(() => spawnAnomalySpark(), i === 0 ? 0 : rand(120, 380));
    }
  }

  function spawnCrumb() {
    if (particles.length > 40) return;
    if (focusState !== 'active') return;
    const el = acquireEl('ember-ash bright');
    if (!el) return;
    const size = rand(2, 3.5);
    el.style.width = size.toFixed(1) + 'px';
    el.style.height = size.toFixed(1) + 'px';
    const startX = rand(30, 70);
    const startY = rand(40, 60);
    el.style.left = startX + '%';
    el.style.top = startY + '%';

    particles.push({
      el, born: performance.now(),
      startX, startY,
      dur: rand(1200, 2200),
      rise: rand(-10, -4),
      drift: rand(-4, 4) + windGust * 2,
      sway: 0,
      isSpark: false,
      type: 'crumb',
      vy: 0,
      gravity: 0.034,
      bounce: rand(0.25, 0.45),
      rot: rand(-20, 20),
      rotSpeed: rand(-90, 90),
      groundHit: false,
    });
  }

  function spawnLandingGlow(x, y) {
    if (!particleLayer || reduceMotion || lowFpsMode) return;
    const el = freeGlowEls.pop();
    if (!el) return;
    el.style.display = '';
    el.style.left = x + '%';
    el.style.top = y + '%';
    void el.offsetWidth;
    el.style.animation = 'none';
    el.style.animation = '';
    defer(() => {
      styleCache.delete(el);
      el.style.display = 'none';
      el.style.left = '';
      el.style.top = '';
      el.style.animation = '';
      freeGlowEls.push(el);
    }, 250);
    if (particles.length < 30 && Math.random() < 0.6) {
      const ashEl = acquireEl('ember-ash landed');
      if (ashEl) {
        ashEl.style.left = x + '%';
        ashEl.style.top = y + '%';
        ashEl.style.width = rand(1, 2.5).toFixed(1) + 'px';
        ashEl.style.height = rand(1, 2.5).toFixed(1) + 'px';
        particles.push({
          el: ashEl, born: performance.now(),
          startX: x, startY: y,
          dur: rand(8000, 18000),
          rise: 0, drift: 0, sway: 0,
          isSpark: false, type: 'landed',
          rot: 0, rotSpeed: 0,
          alphaBias: rand(0.4, 0.8),
        });
      }
    }
  }

  function updateParticles(now, dt) {
    let write = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const t = clamp((now - p.born) / p.dur, 0, 1);

      if (p.type === 'anomaly' && p.shedAt != null && !p.shedDone && t >= p.shedAt) {
        p.shedDone = true;
        if (Math.random() < 0.7) spawnAnomalyDustFrom(p);
      }

      if (t >= 1) {
        if (p.type === 'shooting' || p.type === 'crumb' || p.isSpark) {
          spawnLandingGlow(p.startX, p.startY);
        }
        if (p.isSpark && !p.ashSpawned && Math.random() < 0.5) {
          p.ashSpawned = true;
          spawnAshParticle();
        }
        releaseEl(p.el);
        if (p.isSpark) activeSparks = Math.max(0, activeSparks - 1);
        continue;
      }

      let rise = 0;
      let drift = 0;
      let rot = (p.rot || 0) + (p.rotSpeed || 0) * t;
      let scale = 1;
      let opacity = 1;

      if (p.isSpark) {
        const grav = (p.gravity || 0.03) * t * t * 55;
        if (p.type === 'anomaly') {
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const grav = (p.gravity || 0.03) * Math.pow(t, 1.6) * 30;
          const arc = Math.sin(t * Math.PI * 0.9);
          const jitterAmp = (p.jitterAmp || 0) * (0.5 + t * 1.2);
          const jitter = Math.sin(t * Math.PI * (p.jitterFreq || 2)) * jitterAmp;
          rise = p.rise * e - grav + (p.arcY || 0) * arc * 0.7;
          drift = p.drift * t + windGust * (p.windInfluence || 0.8) * t * 12 + (p.arcX || 0) * arc + jitter;
          if (t < 0.2) {
            const a = t / 0.2;
            scale = 0.3 + easeOutQuad(a) * 0.9;
            opacity = a;
          } else if (t < 0.7) {
            const a = (t - 0.2) / 0.5;
            scale = 1.2 + Math.sin(a * Math.PI * 2.5) * 0.18;
            opacity = 1.0;
          } else {
            const a = (t - 0.7) / 0.3;
            scale = 1.2 * (1 - a * a) + 0.35 * (1 - a);
            opacity = 1 - a * a;
          }
          scale *= (p.brightPulse || 1);
        } else if (p.type === 'anomaly-dust') {
          rise = p.rise * easeOutQuad(t) + grav;
          drift = p.drift * t + Math.sin(t * Math.PI * 4) * (p.sway || 0);
          scale = 1 - t * 0.55;
          opacity = (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88) * (p.alphaBias || 0.8);
        } else {
          rise = p.rise * easeOutQuad(t) + grav;
          drift = p.drift * t + windGust * (p.windInfluence || 0.8) * t * 8 + Math.sin(t * Math.PI * 5) * (p.sway || 0);
          scale = 1 - t * 0.78;
          opacity = t < 0.14 ? t / 0.14 : 1 - (t - 0.14) / 0.86;
        }
      } else if (p.type === 'crumb') {
        p.vy += (p.gravity || 0.03) * dt;
        rise = p.rise * t + p.vy * dt * 0.1;
        drift = p.drift * t + windGust * 1.5 * t;
        scale = 1 - t * 0.45;
        opacity = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;

        if (t > 0.68 && !p.groundHit) {
          p.groundHit = true;
          p.vy *= -(p.bounce || 0.35);
          rot += (Math.random() < 0.5 ? -1 : 1) * 35;
        }
      } else if (p.type === 'landed') {
        if (t < 0.15) {
          const a = t / 0.15;
          scale = 0.4 + easeOutQuad(a) * 0.6;
          opacity = a * (p.alphaBias || 0.6);
        } else if (t < 0.85) {
          scale = 1.0;
          opacity = (p.alphaBias || 0.6);
        } else {
          const a = (t - 0.85) / 0.15;
          scale = 1.0 - easeInQuad(a) * 0.2;
          opacity = (p.alphaBias || 0.6) * (1 - easeInQuad(a));
        }
      } else {
        const swirl = Math.sin(t * Math.PI * 2 * (p.swirlFactor || 1)) * (p.sway || 0);
        const heatLift = (p.heatLift || 0) * intensity * 6 * t * (1 - t * 0.6);
        rise = p.rise * easeOutQuad(t) - heatLift;
        drift = p.drift * t + swirl + windGust * 3.5 * t;
        scale = p.scalePulse && t < 0.55
          ? (1 - t * 0.28) * (1 + Math.sin(t * Math.PI) * 0.14)
          : (1 - t * 0.32);
        opacity = (t < 0.22 ? t / 0.22 : 1 - (t - 0.22) / 0.78) * (p.alphaBias || 0.92);
      }

      const wobble = p.type === 'spark-broken' ? Math.sin(t * Math.PI * 7) * 12
        : p.type === 'anomaly' ? Math.sin(t * Math.PI * (p.jitterFreq || 2.2) * 1.7) * 6
        : 0;
      let shadow = '';

      if (p.trail && p.isSpark) {
        let trailLen, trailColor;
        if (p.type === 'anomaly') {
          trailLen = (1 - t) * (1 - t) * 14 + 1.5;
          const cold = 1 - t;
          trailColor = `rgba(${Math.round(255 - cold * 90)}, ${Math.round(140 - cold * 30)}, ${Math.round(50 - cold * 20)}, ${(0.6 * cold * (p.brightPulse || 1)).toFixed(2)})`;
        } else if (p.type === 'shooting') {
          trailLen = (1 - t) * 14;
          trailColor = `rgba(255,150,50,${(0.65 * (1 - t)).toFixed(2)})`;
        } else {
          trailLen = (1 - t) * 9;
          trailColor = `rgba(255,150,50,${(0.65 * (1 - t)).toFixed(2)})`;
        }
        const trailX = (drift * 0.18).toFixed(1);
        shadow = `${trailX}px ${trailLen.toFixed(1)}px 4px ${trailColor}`;
      }

      p.el.style.transform =
        `translate(${drift.toFixed(2)}px, ${rise.toFixed(2)}px) rotate(${(rot + wobble).toFixed(1)}deg) scale(${scale.toFixed(2)})`;
      p.el.style.opacity = clamp(opacity, 0, 1).toFixed(3);
      if (shadow) p.el.style.boxShadow = shadow;
      particles[write++] = p;
    }
    particles.length = write;
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
    const dist2 = dx * dx + dy * dy;
    if (dist2 < 6400 || dist2 > 40000 || mouse.speed < 12) {
      windGust *= Math.max(0, 1 - dt * 0.003);
    } else {
      const dist = Math.sqrt(dist2);
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

    if (attn.state === 'idle') {
      const dist2 = dx * dx + dy * dy;
      if (dist2 > 1600 && dist2 < 62500 && mouse.speed > 15 && Math.random() < 0.001 * dt) {
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
    if (lowFpsMode) {
      if (shimmerActive) {
        shimmerActive = false;
        root.classList.remove('ember-shimmer');
      }
      return;
    }
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
    if (_mouseDirty) {
      _mouseDirty = false;
      const e = _lastMouseEvent;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 200;
      mouse.x = clamp(e.x, -margin, vw + margin);
      mouse.y = clamp(e.y, -margin, vh + margin);
    }
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
    if (!caret.typing && !caret.active) return;
    const ae = document.activeElement;
    const editable = ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.isContentEditable);
    if (!editable) { caret.active = false; return; }
    if (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') {
      const rect = ae.getBoundingClientRect();
      caret.x = rect.left + 12;
      caret.y = rect.top + 12;
      caret.active = rect.width > 0 && rect.height > 0;
      return;
    }
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
    if (_emberCenterCache.frame === lastFrame) return _emberCenterCache;
    if (!root) return _emberCenterCache;
    const rect = root.getBoundingClientRect();
    _emberCenterCache.x = rect.left + rect.width / 2;
    _emberCenterCache.y = rect.top + rect.height / 2;
    _emberCenterCache.frame = lastFrame;
    return _emberCenterCache;
  }

  function normD(dx, dy, dist) { return dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 0, y: 0 }; }

  function describe() {
    const h = Math.floor(hoursWithoutActivity());
    const rem = remainingSegments();
    if (rem <= 0 || intensity <= 0.03) return 'Проект остыл — уголёк почти потух';
    if (isSleeping()) return 'Проект спит — давно не было правок';
    if (h < 1) return 'Проект активен, уголёк горит ярко';
    return `Без активности ~${h} ч; осталось ${rem}/12 делений`;
  }

  let tooltipEl = null;
  let lastAriaLabel = '';
  let tooltipText = '';
  let tooltipHideTimer = null;
  let tooltipRemoveTimer = null;

  function syncAccessibleLabel(force = false) {
    if (!root) return;
    const label = describe();
    if (!force && label === lastAriaLabel) return;
    lastAriaLabel = label;
    root.setAttribute('aria-label', label);
    root.title = label;
  }

  function hideTooltip(immediate = false) {
    clearDeferred(tooltipHideTimer);
    clearDeferred(tooltipRemoveTimer);
    tooltipHideTimer = null;
    tooltipRemoveTimer = null;
    if (!tooltipEl) return;
    if (immediate) {
      styleCache.delete(tooltipEl);
      tooltipEl.remove();
      tooltipEl = null;
      tooltipText = '';
      return;
    }
    tooltipEl.style.opacity = '0';
    const el = tooltipEl;
    tooltipRemoveTimer = defer(() => {
      if (tooltipEl === el) { tooltipEl = null; tooltipText = ''; }
      styleCache.delete(el);
      el.remove();
    }, 300);
  }

  function showTooltip() {
    if (!root) return;
    clearDeferred(tooltipHideTimer);
    clearDeferred(tooltipRemoveTimer);
    tooltipRemoveTimer = null;
    const h = Math.floor(hoursWithoutActivity());
    const rem = remainingSegments();
    const cold = rem <= 0 || intensity <= 0.03;
    const sleeping = !cold && isSleeping();

    const hoursAgo = h < 1 ? '< 1 ч' : `${h} ч`;
    const segProgress = hoursWithoutActivity() % 2;
    const hoursToNextSeg = segProgress === 0 ? 0 : 2 - segProgress;
    const minsToNext = Math.round(hoursToNextSeg * 60);

    const lines = cold
      ? [
        `Уголёк остыл`,
        `⏱ ${hoursAgo} назад`,
        `🔥 ${rem}/12`,
      ]
      : sleeping
        ? [
          `Проект спит`,
          `⏱ ${hoursAgo} назад`,
          `🔥 ${rem}/12`,
        ]
        : [
          `⏱ ${hoursAgo} назад`,
          `🔥 ${rem}/12`,
        ];
    if (!cold && rem > 0 && rem < 12 && minsToNext > 0) lines.push(`⏳ ~${minsToNext} мин`);
    if (statusState === 'saving') lines.push('💾 сохранение...');
    else if (statusState === 'saved') lines.push('✓ сохранено');
    else if (statusState === 'error') lines.push('✗ ошибка');

    const nextText = lines.join('\n');
    if (tooltipEl && tooltipText === nextText) {
      tooltipEl.style.opacity = '1';
      return;
    }

    let el = tooltipEl;
    if (!el) {
      el = document.createElement('div');
      el.className = 'ember-tooltip';
      tooltipEl = el;
      root.appendChild(el);
    }
    el.textContent = nextText;
    el.style.opacity = '1';
    tooltipText = nextText;
    tooltipHideTimer = defer(() => {
      if (!root || tooltipEl !== el) return;
      hideTooltip();
    }, 3000);
  }

  function updateGaze(dt, targetX, targetY, activeStrength) {
    gaze.x += (targetX - gaze.x) * clamp(dt * 0.006, 0, 1);
    gaze.y += (targetY - gaze.y) * clamp(dt * 0.006, 0, 1);
    gaze.strength += (activeStrength - gaze.strength) * clamp(dt * 0.008, 0, 1);
  }

  function startAnticipation(type, dur, power = 1) {
    anticipation.active = true;
    anticipation.type = type;
    anticipation.start = performance.now();
    anticipation.dur = dur;
    anticipation.power = power;
  }

  function applyAnticipationPose(pose, now) {
    if (!anticipation.active) return;
    const t = clamp((now - anticipation.start) / anticipation.dur, 0, 1);
    const k = Math.sin(t * Math.PI);
    pose.squash += 0.10 * k * anticipation.power;
    pose.scaleX *= 1 - 0.03 * k * anticipation.power;
    pose.scaleY *= 1 - 0.02 * k * anticipation.power;
    pose.glow -= 0.05 * k * anticipation.power;
    if (t >= 1) anticipation.active = false;
  }

  function getSceneFocusSuppression() {
    if (egg.active) return 0.15;
    if (previewScare.active) return 0.35;
    if (peek.state !== 'idle') return 0.55;
    return 1;
  }

  function applyRingMoodBias() {
    if (!segments.length) return;
    const sleepyBias = temperament.tiredness;
    if (sleepyBias > 0.1) {
      [4, 5, 6, 7].forEach(i => {
        const seg = segments[i];
        if (!seg) return;
        markSegmentDirty(seg);
        setVar(seg, '--seg-dim', (sleepyBias * 0.35).toFixed(3));
        setVar(seg, '--seg-push', (sleepyBias * -0.8).toFixed(2) + 'px');
      });
    }
    if (temperament.curiosity > 0.3) {
      const bias = (temperament.curiosity - 0.3) * 0.5;
      [0, 1, 2].forEach(i => {
        const seg = segments[i];
        if (!seg) return;
        markSegmentDirty(seg);
        setVar(seg, '--seg-brightness', (bias * 0.6).toFixed(3));
      });
    }
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
        const curiosityAmp = 1 + temperament.curiosity * 0.3;

        cursorLean.x += (peek.leanX * ep * curiosityAmp - cursorLean.x) * peekLerp;
        cursorLean.y += (peek.leanY * ep * curiosityAmp - cursorLean.y) * peekLerp;

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

        // лёгкий наклон «головой» синхронно с покачиванием
        const tiltTargetX = -(peek.leanY + swayY) * 0.3;
        const tiltTargetY = (peek.leanX + swayX) * 0.3;
        cursorLean.tiltX += (tiltTargetX - cursorLean.tiltX) * peekLerp;
        cursorLean.tiltY += (tiltTargetY - cursorLean.tiltY) * peekLerp;

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
      for (let i = 0; i < 3; i++) defer(spawnSpark, i * 50);
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

  let eggTriggeredDay = null;

  function checkEggTrigger() {
    if (egg.active || egg.triggeredToday) return false;
    const today = new Date().toDateString();
    if (eggTriggeredDay === today) {
      egg.triggeredToday = true;
      return false;
    }
    try {
      const saved = localStorage.getItem(EGG_STORAGE_KEY);
      if (saved === today) {
        egg.triggeredToday = true;
        eggTriggeredDay = today;
        return false;
      }
    } catch {}
    if (eggCharCount >= EGG_CHARS_THRESHOLD) {
      egg.triggeredToday = true;
      eggTriggeredDay = today;
      try {
        localStorage.setItem(EGG_STORAGE_KEY, today);
      } catch {
        eggTriggeredDay = today;
      }
      return true;
    }
    return false;
  }

  function startEgg(targetOverride) {
    if (previewScare.active) return;
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
          for (let i = 0; i < 18; i++) defer(spawnAshParticle, i * 18 + rand(0, 10));
          for (let i = 0; i < 8; i++) defer(spawnSpark, 30 + i * 30);
          defer(() => { egg.tiltY -= burstDir * 7; }, 200);
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
            setVar(root, '--ringOpacity', '1');
            setVar(root, '--ringExpand', '-3px');
            setVar(root, '--ringPulse', '0.7');
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
          setVar(root, '--ringPulse', String(0.7 + easeOutQuad(s) * 0.38));
          setVar(root, '--ringExpand', (-3 + easeOutQuad(s) * 6).toFixed(1) + 'px');
        }
        if (p >= 1) {
          egg.scale = 1; egg.squish = 0; egg.active = false;
          egg._ringDone = false;
          removeVar(root, '--ringOpacity');
          removeVar(root, '--ringExpand');
          removeVar(root, '--ringPulse');
        }
        break;
      }
    }
  }

  function startPreviewScare() {
    if (previewScare.active || egg.active) return;
    if (Math.random() > 0.4) return;
    startAnticipation('scare', 100, 1.0);
    temperament.nervousness = Math.min(1, temperament.nervousness + 0.5);
    flashHeat = Math.max(flashHeat, 0.25);
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

  // ---------- реакции на действия пользователя ----------

  const reactionCooldowns = {};
  const reactionQueue = [];

  function canReact(type, cooldownMs) {
    const now = Date.now();
    if ((reactionCooldowns[type] ?? 0) > now) return false;
    if (Math.random() > 0.45) { reactionCooldowns[type] = now + (cooldownMs || 3000); return false; }
    reactionCooldowns[type] = now + (cooldownMs || 3000);
    return true;
  }

  function queueReaction(type, data) {
    if (previewScare.active || egg.active) return;
    reactionQueue.push({ type, data: data || {} });
  }

  function processReactions(now) {
    while (reactionQueue.length) {
      const r = reactionQueue.shift();
      applyReaction(r.type, r.data, now);
    }
  }

  function applyReaction(type, d, now) {
    switch (type) {

      case 'blockCollapse': {
        if (!canReact('blockCollapse', 2500)) return;
        const dir = d.collapsed ? -1 : 1;
        cursorLean.y += dir * rand(-14, -6);
        cursorLean.squish += rand(0.05, 0.12);
        cursorLean.tiltY += dir * rand(-3, 3);
        heatBoost = Math.max(heatBoost, 0.12);
        defer(() => spawnAshParticle(), 80);
        break;
      }

      case 'delete': {
        if (Math.random() > 0.30) return;
        reactionCooldowns['delete'] = now + 4000;
        startAnticipation('delete', 120, 1.2);
        flashHeat = Math.max(flashHeat, 0.3);
        temperament.nervousness = Math.min(1, temperament.nervousness + 0.3);
        defer(() => {
          const rx = rand(15, 30) * (Math.random() < 0.5 ? -1 : 1);
          const ry = -rand(18, 35);
          cursorLean.x += rx;
          cursorLean.y += ry;
          cursorLean.squish += 0.18;
          cursorLean.scale *= 0.88;
          cursorLean.tiltX += ry * 0.3;
          cursorLean.tiltY += -rx * 0.25;
          heatBoost = Math.max(heatBoost, 0.25);
          ringImpulse = rand(5, 10) * (Math.random() < 0.5 ? 1 : -1);
          deferBurst(spawnSpark, 8, 60);
          deferBurst(spawnAshParticle, 4, 100);
          defer(() => spawnShootingSpark(), 100);
        }, 120);
        break;
      }

      case 'subtabSwitch': {
        if (!canReact('subtabSwitch', 1800)) return;
        const dir = d.dir || 1;
        cursorLean.x += dir * rand(6, 14);
        cursorLean.squish += rand(-0.08, -0.03);
        cursorLean.tiltY += dir * rand(-5, -2);
        ringImpulse = dir * rand(3, 6);
        heatBoost = Math.max(heatBoost, 0.08);
        break;
      }

      case 'translate': {
        if (!canReact('translate', 4000)) return;
        cursorLean.y += rand(-10, -5);
        cursorLean.scale *= 1.06;
        cursorLean.squish += rand(-0.06, -0.02);
        heatBoost = Math.max(heatBoost, 0.18);
        temperament.satisfaction = Math.min(1, temperament.satisfaction + 0.25);
        defer(() => spawnSpark(), 120);
        defer(() => spawnSpark(), 250);
        defer(() => spawnAshParticle(), 200);
        break;
      }

      case 'copy': {
        if (!canReact('copy', 2500)) return;
        cursorLean.y += rand(-12, -6);
        cursorLean.squish += rand(0.04, 0.1);
        heatBoost = Math.max(heatBoost, 0.15);
        temperament.satisfaction = Math.min(1, temperament.satisfaction + 0.3);
        for (let i = 0; i < 5; i++) defer(() => spawnSpark(), i * 70);
        break;
      }

      case 'helpHover': {
        if (!canReact('helpHover', 5000)) return;
        const rx = rand(6, 14) * (Math.random() < 0.5 ? -1 : 1);
        cursorLean.x += rx;
        cursorLean.y += rand(3, 8);
        cursorLean.squish += rand(0.06, 0.12);
        cursorLean.scale *= 0.94;
        heatBoost = Math.max(heatBoost - 0.05, 0);
        for (let i = 0; i < 6; i++) defer(() => spawnAshParticle(), i * 80);
        break;
      }

      case 'undoRedo': {
        if (!canReact('undoRedo', 2000)) return;
        const tilt = d.dir || (Math.random() < 0.5 ? -1 : 1);
        cursorLean.tiltY += tilt * rand(4, 8);
        cursorLean.x += tilt * rand(-3, 3);
        cursorLean.squish += rand(0.03, 0.08);
        heatBoost = Math.max(heatBoost, 0.06);
        break;
      }

      case 'save': {
        if (!canReact('save', 5000)) return;
        startAnticipation('save', 80, 0.6);
        cursorLean.y += rand(-8, -3);
        cursorLean.scale *= 1.03;
        cursorLean.squish += rand(-0.04, -0.01);
        heatBoost = Math.max(heatBoost, 0.1);
        coreHeatReserve = Math.min(1, coreHeatReserve + 0.12);
        residualHeat += 0.15;
        temperament.satisfaction = Math.min(1, temperament.satisfaction + 0.4);
        for (let i = 0; i < 3; i++) defer(() => spawnSpark(), i * 100);
        break;
      }

      case 'tabSwitch': {
        if (!canReact('tabSwitch', 2000)) return;
        cursorLean.y += rand(-10, -4);
        cursorLean.squish += rand(0.04, 0.09);
        cursorLean.tiltY += rand(-4, 4);
        heatBoost = Math.max(heatBoost, 0.1);
        defer(() => spawnAshParticle(), 150);
        break;
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
    if (!allowTestMode) return;
    testMode = true;
    testQueue = [...TEST_EFFECTS];
    testIndex = 0;
    clearDeferred(testModeTimer);
    const TEST_STEP_MS = 3300;
    testModeTimer = defer(stopTestMode, TEST_EFFECTS.length * TEST_STEP_MS + 1500);
    runNextTest();
  }

  function stopTestMode() {
    testMode = false;
    testQueue = [];
    testIndex = 0;
    active.clear();
    segmentEffects = [];
    if (testLabel) { testLabel.remove(); testLabel = null; }
    clearDeferred(testModeTimer);
    clearDeferred(nextTestStepTimer);
    testModeTimer = null;
    nextTestStepTimer = null;
  }

  function setAllowTestMode(value = true, ttlMs = 60000) {
    allowTestMode = !!value;
    clearDeferred(allowTestModeTimer);
    allowTestModeTimer = null;
    if (allowTestMode && ttlMs > 0) {
      allowTestModeTimer = defer(() => {
        allowTestMode = false;
        if (testMode) stopTestMode();
      }, ttlMs);
    }
  }

  function runNextTest() {
    if (!testMode || testIndex >= testQueue.length) {
      stopTestMode();
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
    defer(() => { if (testLabel) testLabel.style.opacity = '0.7'; }, 800);

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
      deferBurst(spawnSpark, 6, 130);
    }
    if (type === 'gust') {
      deferBurst(spawnShootingSpark, 3, 200);
      deferBurst(spawnCrumb, 4, 250);
    }
    if (['ashDrift', 'smolder', 'sigh'].includes(type)) {
      deferBurst(spawnAshParticle, 10, 160);
    }

    if (type === 'typingApproach') {
      caret.typing = true;
      caret.active = true;
      const _ec = getEmberCenter();
      caret.x = _ec.x + rand(-100, 100);
      caret.y = _ec.y + rand(-50, 50);
      defer(() => { caret.typing = false; }, 2200);
    }
    if (type === 'eggFly') {
      const savedFlag = egg.triggeredToday;
      egg.triggeredToday = false;
      startEgg();
      defer(() => { egg.triggeredToday = savedFlag; }, 5000);
    }
    if (type === 'previewScare') {
      startPreviewScare();
    }
    if (type === 'shootingSpark') {
      for (let i = 0; i < 5; i++) defer(() => spawnShootingSpark(), i * 200);
    }
    if (type === 'crumb') {
      for (let i = 0; i < 6; i++) defer(() => spawnCrumb(), i * 200);
    }

    nextTestStepTimer = defer(runNextTest, 3300);
  }

  // ---------- основной кадр ----------

  function updateMood(now) {
    if (now - lastMoodUpdate < 1000) return;
    lastMoodUpdate = now;
    const dt1s = 1;

    if (typedChars > 5) mood.agitated = Math.min(mood.agitated + 0.3, 1);
    else mood.agitated = Math.max(mood.agitated - 0.02, 0);

    const h = hoursWithoutActivity();
    if (h > 2) mood.sleepy = Math.min(mood.sleepy + 0.05 * dt1s, 1);
    else mood.sleepy = Math.max(mood.sleepy - 0.03, 0);

    mood.calm = clamp(1 - mood.agitated - mood.sleepy, 0, 1);

    if (mood.agitated > 0.7) emberMood = 'active';
    else if (mood.agitated > 0.3) emberMood = 'overheated';
    else if (mood.sleepy > 0.6) emberMood = 'sleepy';
    else emberMood = 'calm';
  }

  function updateTemperament(now, dt) {
    const ember = getEmberCenter();
    const dx = mouse.x - ember.x;
    const dy = mouse.y - ember.y;
    const dist2 = dx * dx + dy * dy;

    if (dist2 > 2500 && dist2 < 48400 && mouse.speed > 2 && mouse.speed < 25) {
      temperament.curiosity = Math.min(1, temperament.curiosity + dt * 0.0008);
    } else {
      temperament.curiosity = Math.max(0, temperament.curiosity - dt * 0.0005);
    }

    if (mouse.speed > 60) {
      temperament.nervousness = Math.min(1, temperament.nervousness + dt * 0.0015);
    } else {
      temperament.nervousness = Math.max(0, temperament.nervousness - dt * 0.0008);
    }

    if (hoursWithoutActivity() > 2) {
      temperament.tiredness = Math.min(1, temperament.tiredness + dt * 0.00008);
    } else {
      temperament.tiredness = Math.max(0, temperament.tiredness - dt * 0.00012);
    }

    temperament.satisfaction = Math.max(0, temperament.satisfaction - dt * 0.0012);
  }

  function updateRingSegments(now) {
    if (segmentEffects.length) return;
    if (Math.random() < 0.02) {
      const start = Math.floor(rand(0, 12));
      const len = Math.floor(rand(2, 5));
      for (let i = start; i < start + len; i++) {
        const seg = segments[i % 12];
        if (seg) {
          markSegmentDirty(seg);
          setVar(seg, '--seg-flash', '0.8');
        }
      }
    }
  }

  function applyEggVars() {
    setVar(coreEl, '--cursorLeanX', '0');
    setVar(coreEl, '--cursorLeanY', '0');
    setVar(coreEl, '--cursorSquish', '0');
    setVar(coreEl, '--cursorScale', '1');
    setVar(coreEl, '--cursorTiltX', '0');
    setVar(coreEl, '--cursorTiltY', '0');
    setVar(coreEl, '--eggX', egg.x.toFixed(1) + 'px');
    setVar(coreEl, '--eggY', egg.y.toFixed(1) + 'px');
    setVar(coreEl, '--eggScale', clamp(egg.scale, 0.02, 2).toFixed(3));
    setVar(coreEl, '--eggSquish', egg.squish.toFixed(3));
    setVar(coreEl, '--eggTiltX', egg.tiltX.toFixed(1) + 'deg');
    setVar(coreEl, '--eggTiltY', egg.tiltY.toFixed(1) + 'deg');
  }

  function clearEggVars() {
    if (!coreEl) return;
    ['--eggX', '--eggY', '--eggScale', '--eggSquish', '--eggTiltX', '--eggTiltY']
      .forEach(name => {
        const map = styleCache.get(coreEl);
        if (map) map.delete(name);
        coreEl.style.removeProperty(name);
      });
  }

  function isSceneIdle() {
    if (!browserFocused || !onScreen) return false;
    if (spawnCore < 1) return false;
    if (particles.length) return false;
    if (active.size || segmentEffects.length) return false;
    if (mouseMovedSinceLastFrame) return false;
    if (Math.abs(hoverVal) > 0.001) return false;
    if (peek.state !== 'idle' || attn.state !== 'idle') return false;
    if (egg.active || previewScare.active || anticipation.active) return false;
    if (Math.abs(heatBoost) > 0.001) return false;
    if (Math.abs(ringImpulse) > 0.001) return false;
    if (Math.abs(residualHeat) > 0.001) return false;
    if (focusState !== 'active') return false;
    return true;
  }

  function update(now, dt) {
    intensity = calcIntensity();
    mouseMovedSinceLastFrame = false;

    // --- idle gate: skip heavy work when scene is stable ---
    if (_fullUpdateDone && isSceneIdle()) {
      breathPhase += 0.00055 * dt;
      glowTrackX *= 0.92; glowTrackY *= 0.92;
      ashTrackX *= 0.92; ashTrackY *= 0.92;

      let idlePulse = 0;
      if (Math.random() < dt * 0.6) {
        idlePulse = Math.pow(Math.random(), 3) * 0.2;
        glowTrackX += rand(-3, 3);
        glowTrackY += rand(-3, 3);
      }

      const idleBreath = 1 + Math.sin(breathPhase * 2.5) * 0.012 * intensity;
      breathScale += (idleBreath - breathScale) * 0.06;
      const idleGlow = clamp(intensity + heatBoost * 0.3 + idlePulse, 0, 1.8);
      const idleBright = clamp(0.7 + intensity * 0.3 + heatBoost * 0.4 + idlePulse * 0.3, 0.35, 2.5);

      heat = clamp(intensity + heatBoost * 0.25, 0, 1);
      setVarApprox(root, '--breathScale', breathScale.toFixed(4), 0.001);
      setVarApprox(root, '--breathCore', breathScale.toFixed(4), 0.001);
      setVarApprox(root, '--breathGlow', (1 + (breathScale - 1) * 0.85).toFixed(4), 0.001);
      setVarApprox(root, '--breathCrust', (1 + (breathScale - 1) * 1.1).toFixed(4), 0.001);
      setVarApprox(root, '--breathAsh', (1 + (breathScale - 1) * 0.6).toFixed(4), 0.001);
      setVarApprox(root, '--scaleX', breathScale.toFixed(4), 0.001);
      setVarApprox(root, '--scaleY', breathScale.toFixed(4), 0.001);
      setVar(root, '--heat', heat.toFixed(3));
      setVar(root, '--glow', idleGlow.toFixed(3));
      setVarApprox(root, '--intensity', intensity.toFixed(3), 0.001);
      setVarApprox(root, '--brightness', idleBright.toFixed(3), 0.001);
      setVar(root, '--coreHue', (15 + intensity * 35).toFixed(1));
      setVar(root, '--coreLight', (35 + intensity * 35).toFixed(1) + '%');
      setVarApprox(root, '--ringOpacity', clamp(intensity * 0.6 + 0.4, 0, 1).toFixed(3), 0.001);
      setVar(root, '--ashCoverage', (clamp(1 - intensity, 0, 1) ** 2 * (3 - 2 * clamp(1 - intensity, 0, 1))).toFixed(3));
      setVar(root, '--glowOpacity', (1 + heatBoost * 0.3).toFixed(3));
      setVar(root, '--glowBlur', (5 + heatBoost * 2).toFixed(2) + 'px');
      setVar(root, '--glowScale', (1 + heatBoost * 0.1).toFixed(3));
      setVar(root, '--shiftX', '0px');
      setVar(root, '--shiftY', '0px');
      setVar(root, '--rotation', '0deg');
      setVar(root, '--shadowScale', '1');
      setVar(root, '--shadowAlpha', '0.45');

      if (!nextAriaUpdate || now > nextAriaUpdate) {
        syncAccessibleLabel();
        nextAriaUpdate = now + 60000;
      }

      // --- particles still spawn/update in idle ---
      if (!reduceMotion && focusState === 'active') {
        if (Date.now() > nextAshSpawn) {
          if (Math.random() < 0.4) spawnAshParticle();
          nextAshSpawn = Date.now() + rand(700, 1400);
        }
        if (Date.now() > nextSparkCheck) {
          if (Math.random() < 0.35 * (0.4 + intensity * 0.6)) spawnSpark();
          if (intensity > 0.6 && Math.random() < 0.06) spawnShootingSpark();
          nextSparkCheck = Date.now() + rand(1800, 4000);
        }
        if ((++_particleFrameToggle & 1) || particles.length < 16) updateParticles(now, dt);
      }

      return;
    }

    if (!reduceMotion) {
      sampleMousePosition(now);
      sampleCaretPosition(now);
    }

    applySegments();
    const curRem = remainingSegments();
    if (curRem <= 2 && curRem < lastWarnRemaining && curRem > 0) {
      heatBoost = Math.max(heatBoost, 0.5);
      if (!reduceMotion) {
        deferBurst(spawnSpark, 6, 50);
        ringImpulse = rand(4, 7) * (Math.random() < 0.5 ? 1 : -1);
      }
    }
    lastWarnRemaining = curRem;

    if (reduceMotion) {
      ringImpulse = 0;
      cursorLean.x = 0; cursorLean.y = 0;
      cursorLean.squish = 0; cursorLean.scale = 1;
      cursorLean.tiltX = 0; cursorLean.tiltY = 0;
      if (coreEl) {
        removeVar(coreEl, '--glintOpacity');
        removeVar(coreEl, '--glintX');
        removeVar(coreEl, '--glintY');
        removeVar(coreEl, '--glintRot');
      }
      heat = clamp(intensity + heatBoost * 0.15, 0, 1);
      const ashRaw = clamp(1 - intensity, 0, 1);
      ashCoverage = ashRaw * ashRaw * (3 - 2 * ashRaw);
      setVar(root, '--heat', heat.toFixed(3));
      setVar(root, '--glow', intensity.toFixed(3));
      setVar(root, '--intensity', intensity.toFixed(3));
      setVar(root, '--brightness', (0.75 + intensity * 0.25).toFixed(3));
      setVar(root, '--coreHue', (15 + intensity * 35).toFixed(1));
      setVar(root, '--coreLight', (35 + intensity * 35).toFixed(1) + '%');
      setVar(root, '--ashCoverage', ashCoverage.toFixed(3));
      setVar(root, '--ringOpacity', clamp(intensity * 0.4 + 0.2, 0, 1).toFixed(3));
      setVar(root, '--breathScale', breathScale.toFixed(4));
      setVar(root, '--shiftX', '0px');
      setVar(root, '--shiftY', '0px');
      setVar(root, '--scaleX', breathScale.toFixed(4));
      setVar(root, '--scaleY', breathScale.toFixed(4));
      setVar(root, '--rotation', '0deg');
      setVar(root, '--shadowScale', '1');
      setVar(root, '--shadowAlpha', '0.45');
      if (!nextAriaUpdate || performance.now() > nextAriaUpdate) {
        syncAccessibleLabel();
        nextAriaUpdate = performance.now() + 60000;
      }
      return;
    }

    // вращение кольца — медленное, только при наведении + импульс от втягивания
    ringAngle += dt * 0.0003 * hoverVal / sleepSlowdown();
    ringAngle += dt * 0.008 * ringImpulse / sleepSlowdown();
    setVar(ringEl, '--ringRot', (ringAngle * 57.2958 % 360).toFixed(2) + 'deg');

    // parallax: кольцо отстаёт от курсора (инерция 0.04 vs 0.08 у glow)
    const ringTargetX = cursorLean.x * 0.3;
    const ringTargetY = cursorLean.y * 0.25;
    ringTrackX += (ringTargetX - ringTrackX) * 0.04;
    ringTrackY += (ringTargetY - ringTrackY) * 0.04;
    setVar(ringEl, '--ringParallaxX', ringTrackX.toFixed(2) + 'px');
    setVar(ringEl, '--ringParallaxY', ringTrackY.toFixed(2) + 'px');

    if (egg.active) {
      updateEgg(now);
      applyEggVars();

      const breathBase = intensity > 0.3 ? 0.00055 : 0.0002;
      breathPhase += breathBase * dt;
      const { breathAmp, flicker } = computeBreath();
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

      setVar(root, '--heat', heat.toFixed(3));
      setVar(root, '--glow', glow.toFixed(3));
      setVar(root, '--intensity', intensity.toFixed(3));
      setVar(root, '--breathScale', breathScale.toFixed(4));
      setVar(root, '--scaleX', breathScale.toFixed(4));
      setVar(root, '--scaleY', breathScale.toFixed(4));
      setVar(root, '--brightness', brightness.toFixed(3));
      setVar(root, '--coreHue', coreHue.toFixed(1));
      setVar(root, '--coreLight', coreLight.toFixed(1) + '%');
      setVar(root, '--ashCoverage', ashCoverage.toFixed(3));
      setVar(root, '--glowOpacity', (1 + heatBoost * 0.3).toFixed(3));
      setVar(root, '--glowBlur', (5 + heatBoost * 2).toFixed(2) + 'px');
      setVar(root, '--glowScale', (1 + heatBoost * 0.1).toFixed(3));
      setVar(root, '--ringOpacity', clamp(intensity * 0.6 + 0.4, 0, 1).toFixed(3));
      updateCrackLayers(now, crackGlow);
      setStyle(coreEl, 'filter', 'brightness(var(--brightness))');

      advanceSegEffects(dt);
      applySegEffects();
      updateParticles(now, dt);
      return;
    }
    clearEggVars();

    // --- settling → idle → wakeUp ---
    if (focusState === 'settling') {
      focusTimer += dt;
      const sp = clamp(focusTimer / settlingDuration, 0, 1);
      const damp = 1 - sp;
      cursorLean.x *= damp;
      cursorLean.y *= damp;
      cursorLean.squish *= damp;
      cursorLean.tiltX *= damp;
      cursorLean.tiltY *= damp;
      cursorLean.scale += (1 - cursorLean.scale) * 0.08;
      windGust *= 0.8;
      heatBoost *= 0.9;
      residualHeat *= 0.85;
      ringImpulse *= 0.7;
      breathScale += (1 + Math.sin(now * 0.0015) * 0.015 - breathScale) * 0.06;
      peek.state = 'idle';

      setVar(root, '--breathScale', breathScale.toFixed(4));
      setVar(root, '--shiftX', '0px');
      setVar(root, '--shiftY', '0px');
      setVar(root, '--scaleX', (breathScale * breathScale).toFixed(4));
      setVar(root, '--scaleY', (breathScale * breathScale).toFixed(4));
      setVar(root, '--rotation', '0deg');
      setVar(root, '--glow', (intensity * 0.6).toFixed(3));
      setVar(root, '--brightness', (0.6 + intensity * 0.2).toFixed(3));
      setVar(root, '--ringOpacity', clamp(intensity * 0.4 + 0.2, 0, 1).toFixed(3));

      if (sp >= 1) {
        focusState = 'idle';
        active.clear();
        segmentEffects = [];
        particles.forEach(p => releaseEl(p.el));
        particles = [];
        activeSparks = 0;
      }
      return;
    }

    if (focusState === 'idle') {
      focusTimer += dt;
      cursorLean.x *= 0.92;
      cursorLean.y *= 0.92;
      cursorLean.squish *= 0.92;
      cursorLean.tiltX *= 0.92;
      cursorLean.tiltY *= 0.92;
      cursorLean.scale += (1 - cursorLean.scale) * 0.05;
      windGust *= 0.9;
      heatBoost *= 0.99;
      ringImpulse *= 0.95;
      if (peek.state !== 'idle') {
        peek.state = 'idle';
        peek.cooldown = 5000;
      }

      const idleBreath = 1 + Math.sin(now * 0.0015) * 0.015;
      breathScale += (idleBreath - breathScale) * 0.06;
      const idleGlow = intensity * 0.6 + heatBoost * 0.25;
      const idleBright = 0.55 + intensity * 0.25;

      setVar(root, '--breathScale', breathScale.toFixed(4));
      setVar(root, '--shiftX', '0px');
      setVar(root, '--shiftY', '0px');
      setVar(root, '--scaleX', (idleBreath).toFixed(4));
      setVar(root, '--scaleY', (idleBreath).toFixed(4));
      setVar(root, '--rotation', '0deg');
      setVar(root, '--glow', idleGlow.toFixed(3));
      setVar(root, '--brightness', idleBright.toFixed(3));
      setVar(root, '--coreHue', (15 + intensity * 35).toFixed(1));
      setVar(root, '--coreLight', (35 + intensity * 35).toFixed(1) + '%');
      setVar(root, '--ringOpacity', clamp(intensity * 0.4 + 0.2, 0, 1).toFixed(3));

      setStyle(coreEl, 'filter', 'brightness(var(--brightness))');
      setVar(coreEl, '--cursorLeanX', '0');
      setVar(coreEl, '--cursorLeanY', '0');
      setVar(coreEl, '--cursorSquish', '0');
      setVar(coreEl, '--cursorScale', '1');
      setVar(coreEl, '--cursorTiltX', '0');
      setVar(coreEl, '--cursorTiltY', '0');
      return;
    }

    if (focusState === 'wakeUp') {
      focusTimer += dt;
      if (focusTimer < 200) {
        const wk = focusTimer / 200;
        breathScale += (1 + wk * 0.02 - breathScale) * 0.1;
        setVar(root, '--breathScale', breathScale.toFixed(4));
        setVar(root, '--brightness', (0.5 + wk * 0.3).toFixed(3));
        return;
      }
      if (focusTimer < 400 && !sparkDone) {
        sparkDone = true;
        heatBoost = 0.2;
        spawnSpark();
      }
      focusState = 'active';
      sparkDone = false;
    }

    updateTemperament(now, dt);

    // gaze: направление внимания
    const peekActive = peek.state === 'noticing' || peek.state === 'peeking' || peek.state === 'looking';
    if (peekActive) {
      const ember = getEmberCenter();
      const gDx = mouse.x - ember.x;
      const gDy = mouse.y - ember.y;
      const gDist = Math.hypot(gDx, gDy);
      const gNorm = gDist > 0 ? { x: gDx / gDist, y: gDy / gDist } : { x: 0, y: 0 };
      const closeness = clamp(1 - (gDist - 50) / 210, 0, 1);
      updateGaze(dt, gNorm.x * closeness * 30, gNorm.y * closeness * 30, closeness * 0.8);
    } else {
      updateGaze(dt, 0, 0, 0);
    }

    updateCursorLean(now, dt);
    updatePreviewScare(now);
    processReactions(now);

    const since = now - spawnStart;
    spawnCore = clamp(since / 500, 0, 1);
    spawnGlow = clamp((since - 400) / 500, 0, 1);
    spawnRing = clamp((since - 800) / 600, 0, 1);

    const hoverStep = clamp(dt / 300, 0, 1);
    hoverVal += hover ? (1 - hoverVal) * hoverStep : (0 - hoverVal) * hoverStep;

    const speedMult = (1 + hoverVal * 0.8) / sleepSlowdown();

    // breath: temperament modulation + rare pauses
    const stressed = temperament.nervousness > 0.65;
    const sleepy = temperament.tiredness > 0.6;
    if (!breathHoldUntil && !stressed && Math.random() < 0.00003 * dt) {
      breathHoldUntil = now + rand(120, 280);
    }
    if (breathHoldUntil && now < breathHoldUntil) {
      // hold — skip breath phase advance
    } else {
      if (breathHoldUntil && now >= breathHoldUntil) breathHoldUntil = 0;
      const breathBase =
        stressed ? 0.00072 :
        sleepy ? 0.00016 :
        intensity > 0.3 ? 0.00055 : 0.0002;
      breathPhase += breathBase * speedMult * dt;
    }
    const { breathAmp, flicker } = computeBreath();
    const hoverBreath = hover ? Math.sin(breathPhase * 2.5) * 0.05 * hoverVal : 0;
    breathScale = 1 + flicker * 0.012 * intensity * breathAmp + hoverBreath + windGust * 0.04;
    const breathCore = 1 + flicker * 0.012 * intensity * breathAmp;
    const breathGlow = 1 + flicker * 0.018 * intensity * breathAmp * 0.85;
    const breathCrust = 1 + flicker * 0.014 * intensity * breathAmp * 1.1;
    const breathAsh = 1 + flicker * 0.008 * intensity * breathAmp * 0.6;

    updateHeatZones(dt);
    if (!reduceMotion) {
      updateHotspots(now, dt);
      if (!lowFpsMode) {
        updateWind(now, dt);
        updateAttention(now, dt);
      }
      maybeSpawnAnomalySpark(now);
    }
    if ('requestIdleCallback' in window) {
      if (!_idleCallbackId) {
        _idleCallbackId = requestIdleCallback(() => {
          _idleCallbackId = null;
          if (destroyed || !root || !state) return;
          updateMood(performance.now());
        }, { timeout: 200 });
      }
    } else {
      updateMood(now);
    }

    // haze — динамическое обновление с cursor/wind
    if (hazeEl) {
      const hazeIntensity = clamp(intensity * 0.45 + coreHeatReserve * 0.22 + heatBoost * 0.35 + windGust * 0.12, 0, 1);
      setStyle(hazeEl, 'opacity', hazeIntensity.toFixed(3));
      setVar(hazeEl, '--hazeShiftX', (gaze.x * 0.08 + windGust * 6).toFixed(2) + 'px');
    }

    applyStatus();
    if (heatBoost > 0 && statusState !== 'error') heatBoost = Math.max(0, heatBoost - 0.00025 * dt);
    if (flashHeat > 0) flashHeat = Math.max(0, flashHeat - dt * 0.0012);
    if (coreHeatReserve > 0) coreHeatReserve = Math.max(0, coreHeatReserve - dt * 0.00012);
    residualHeat *= 0.992;

    // --- редкие экстремальные события ---
    if (!testMode) {
      for (const ev in anomaly) {
        if (Math.random() < dt / 1000 * anomaly[ev].chance) activateRare(ev);
      }
    }

    // --- запуск эффектов ядра с рандомными параметрами ---
    if (!testMode) {
      const moodMul = emberMood === 'active' ? 1.4 : emberMood === 'overheated' ? 1.6 : emberMood === 'sleepy' ? 0.5 : 1;
      const agitatedBoost = mood.agitated > 0.7 ? 2.5 : mood.agitated > 0.3 ? 1.5 : 1;
      tryStart('sigh', 0.5 * moodMul * (mood.sleepy > 0.5 ? 1.5 : 1), [4000, 5000], () => ({ mag: rand(0.04, 0.08), glow: rand(0.15, 0.28) }));
      tryStart('calmBurn', 0.8 * moodMul, [2000, 3000], () => ({ mag: rand(0.05, 0.1), hue: rand(-6, 12) }));
      if (intensity > 0.5 && !reduceMotion) tryStart('wiggle', 0.3 * moodMul * agitatedBoost, [700, 1100], () => ({ amp: rand(0.9, 1.3), mag: rand(0.7, 1.1) }));
      tryStart('tilt', 0.25 * moodMul, [2000, 2000], () => ({ target: rand(-1, 1) }));
      tryStart('microShift', 0.2 * moodMul, [1000, 2000], () => ({ dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) }));
      tryStart('crackle', 0.4 * moodMul * agitatedBoost, [80, 160], () => ({ mag: rand(0.9, 1.5), side: Math.random() < 0.5 ? -1 : 1 }));
      tryStart('stretch', 0.35 * moodMul, [3000, 4200], () => ({ amp: rand(0.9, 1.25), mag: rand(0.7, 1.1) }));
      tryStart('glint', 0.3 * moodMul * (1 + temperament.curiosity * 0.5), [2000, 3000], () => ({ hue: rand(15, 35), sat: rand(0.3, 0.6) }));
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

    tiltCurrent += (tiltTarget - tiltCurrent) * clamp(0.08 * (dt / 16.7), 0, 1);
    crackGlowMod = 0;

    // --- pose layer ---
    resetPose(); const pose = POSE_BUF;

    if (anticipation.active) applyAnticipationPose(pose, now);
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

    setVar(root, '--coreHue', coreHue.toFixed(1));
    setVar(root, '--coreLight', coreLight.toFixed(1) + '%');
    setVar(root, '--ashCoverage', ashCoverage.toFixed(3));

    const crackGlow = 0.4 + flicker * 0.3 + heatBoost * 1.5 + windGust * 0.4 + crackGlowMod;
    updateCrackLayers(now, crackGlow);

    const waveOffset = ((now * 0.00003) % 1) * 100;
    if (heatWaveEl) setVar(heatWaveEl, '--waveOffset', waveOffset.toFixed(1) + '%');

    commitPose(pose, now, dt);
    setVar(root, '--breathScale', breathScale.toFixed(4));
    setVarApprox(root, '--breathCore', breathCore.toFixed(4), 0.0008);
    setVarApprox(root, '--breathGlow', breathGlow.toFixed(4), 0.0008);
    setVarApprox(root, '--breathCrust', breathCrust.toFixed(4), 0.0008);
    setVarApprox(root, '--breathAsh', breathAsh.toFixed(4), 0.0008);

    applySegments();

    if (hotAttnEl) {
      if (attn.hotHeat > 0.01) {
        setStyle(hotAttnEl, 'left', clamp(attn.hotX, 15, 85) + '%');
        setStyle(hotAttnEl, 'top', clamp(attn.hotY, 15, 85) + '%');
        setStyle(hotAttnEl, 'opacity', clamp(attn.hotHeat * 0.7, 0, 0.8).toFixed(3));
      } else {
        setStyle(hotAttnEl, 'opacity', '0');
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
      applyRingMoodBias();
      updateRingSegments(now);

      if (Date.now() > nextAshSpawn) {
        const sceneBudget = getSceneFocusSuppression();
        if (Math.random() < (lowFpsMode ? 0.3 : 0.55) * sceneBudget) spawnAshParticle();
        if (intensity > 0.6 && Math.random() < (lowFpsMode ? 0.05 : 0.15) * sceneBudget) spawnAshParticle();
        nextAshSpawn = Date.now() + rand(lowFpsMode ? 500 : 600, lowFpsMode ? 1200 : 1100);
      }

      if (Date.now() > nextSparkCheck) {
        const sceneBudget = getSceneFocusSuppression();
        if (Math.random() < (lowFpsMode ? 0.2 : 0.5) * (0.4 + intensity * 0.6) * sceneBudget) spawnSpark();
        if (intensity > 0.6 && Math.random() < (lowFpsMode ? 0.02 : 0.08) * sceneBudget) spawnShootingSpark();
        if (intensity < 0.5 && Math.random() < (lowFpsMode ? 0.04 : 0.12) * sceneBudget) spawnCrumb();
        nextSparkCheck = Date.now() + rand(lowFpsMode ? 2400 : 1400, lowFpsMode ? 5500 : 3800);
      }

      if ((++_particleFrameToggle & 1) || particles.length < 16) updateParticles(now, dt);
      updateShimmer(now);
    }

    if (!nextAriaUpdate || now > nextAriaUpdate) {
      syncAccessibleLabel();
      nextAriaUpdate = now + 60000;
    }
    _fullUpdateDone = true;
  }

  let reduceMotionFrameSkip = 0;
  let reducedMotionTimer = null;
  let _throttleTimer = null;
  let destroyed = false;
  const fpsHistory = [];
  let lowFpsMode = false;
  let _idleLevel = 0;
  let _idleConsecutive = 0;

  function idleState(now) {
    if (!isSceneIdle()) {
      if (_idleLevel !== 0) { _idleLevel = 0; _idleConsecutive = 0; }
      return 0;
    }
    _idleConsecutive++;
    if (_idleLevel < 1 && _idleConsecutive > 120) _idleLevel = 1;
    if (_idleLevel < 2 && _idleConsecutive > 480) _idleLevel = 2;
    return _idleLevel;
  }

  function animate(timestamp) {
    rafId = null;
    if (destroyed || !root) return;
    if (lastFrame === 0) lastFrame = timestamp;
    const dt = Math.min(timestamp - lastFrame, 50);
    if (!browserFocused && focusState === 'active' && dt < 250) {
      rafId = requestAnimationFrame(animate);
      return;
    }
    lastFrame = timestamp;
    if (reduceMotion && reducedMotionTimer) {
      rafId = null;
      return;
    }
    fpsHistory.push(dt);
    if (fpsHistory.length > 30) fpsHistory.shift();
    if (fpsHistory.length >= 20) {
      const avgDt = fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length;
      lowFpsMode = avgDt > 33;
      if (root) root.classList.toggle('low-fps', lowFpsMode);
    }
    try { update(timestamp, dt); } catch (e) { console.error('Ember update error:', e); }
    if (!browserFocused && focusState === 'idle') {
      rafId = null;
      return;
    }
    if (reduceMotion) {
      reducedMotionTimer = setTimeout(() => {
        reducedMotionTimer = null;
        if (destroyed || !root || document.hidden || !onScreen) return;
        rafId = requestAnimationFrame(animate);
      }, 100);
    } else {
      const lvl = idleState(timestamp);
      if (lvl >= 2) {
        clearTimeout(_throttleTimer);
        _throttleTimer = setTimeout(() => {
          _throttleTimer = null;
          if (destroyed || !root) return;
          rafId = requestAnimationFrame(animate);
        }, 130);
      } else if (lvl === 1) {
        clearTimeout(_throttleTimer);
        _throttleTimer = setTimeout(() => {
          _throttleTimer = null;
          if (destroyed || !root) return;
          rafId = requestAnimationFrame(animate);
        }, 33);
      } else {
        clearTimeout(_throttleTimer);
        _throttleTimer = null;
        rafId = requestAnimationFrame(animate);
      }
    }
  }

  function syncLoopState(reason) {
    if (destroyed || !root) return;
    const wantToRun = browserFocused && onScreen && !document.hidden;
    if (wantToRun) {
      if (focusState === 'idle' || focusState === 'settling') {
        focusState = 'wakeUp';
        focusTimer = 0;
        sparkDone = false;
      }
      if (!rafId) startLoop();
    } else {
      if (focusState === 'active') {
        focusState = 'settling';
        focusTimer = 0;
        settlingDuration = rand(800, 1500);
      }
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (reducedMotionTimer) { clearTimeout(reducedMotionTimer); reducedMotionTimer = null; }
    }
  }
  function startLoop() {
    if (rafId) return;
    lastFrame = 0;
    _particleFrameToggle = 0;
    rafId = requestAnimationFrame(animate);
  }
  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (reducedMotionTimer) { clearTimeout(reducedMotionTimer); reducedMotionTimer = null; }
    if (_throttleTimer) { clearTimeout(_throttleTimer); _throttleTimer = null; }
  }

  // ---------- реакция на печать ----------

  function handleInput() {
    typedChars++;
    heatBoost = Math.min(typedChars / 150, 0.25);
    notifyEdit();
    clearDeferred(resetTimer);
    resetTimer = defer(() => { typedChars = 0; }, 2000);

    if (!egg.triggeredToday) {
      eggCharCount++;
      if (checkEggTrigger()) startEgg();
    }
  }

  function setupEventListeners() {
    if (listenersBound || !root) return;
    handlers.mouseenter = () => { hover = true; syncAccessibleLabel(true); };
    handlers.mouseleave = () => { hover = false; hideTooltip(); };
    handlers.rootFocus = () => { hover = true; syncAccessibleLabel(true); showTooltip(); };
    handlers.rootBlur = () => { hover = false; hideTooltip(); };
    handlers.contextmenu = (e) => {
      if (!allowTestMode) return;
      e.preventDefault();
      if (!testMode) startTestMode();
    };
    let _clickTimer = null;
    handlers.click = () => {
      clearDeferred(_clickTimer);
      _clickTimer = defer(() => {
        heatBoost = 0.4;
        deferBurst(spawnSpark, 8, 60);
        deferBurst(spawnShootingSpark, 3, 120);
        showTooltip();
        if (typeof onClickCallback === 'function') onClickCallback();
      }, 200);
    };
    handlers.dblclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearDeferred(_clickTimer);
      reduceMotion = !reduceMotion;
      root.classList.toggle('reduced-motion-runtime', reduceMotion);
      if (reduceMotion) {
        particles.forEach(p => releaseEl(p.el));
        particles = [];
        activeSparks = 0;
        segmentEffects = [];
        hideTooltip();
      }
      const label = reduceMotion ? 'Economy ON ⚡' : 'Economy OFF 🔥';
      if (!root) return;
      const existing = root.querySelector('.ember-eco-toast');
      if (existing) existing.remove();
      const toast = document.createElement('div');
      toast.className = 'ember-eco-toast';
      toast.textContent = label;
      root.appendChild(toast);
      defer(() => {
        if (!root || !toast.isConnected) return;
        toast.classList.add('show');
      }, 0);
      defer(() => { toast.classList.remove('show'); defer(() => toast.remove(), 300); }, 1500);
    };
    handlers.keydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        heatBoost = 0.4;
        deferBurst(spawnSpark, 8, 60);
        deferBurst(spawnShootingSpark, 3, 120);
        showTooltip();
        if (typeof onClickCallback === 'function') onClickCallback();
      }
    };

    root.addEventListener('mouseenter', handlers.mouseenter);
    root.addEventListener('mouseleave', handlers.mouseleave);
    root.addEventListener('focus', handlers.rootFocus);
    root.addEventListener('blur', handlers.rootBlur);
    root.addEventListener('contextmenu', handlers.contextmenu);
    root.addEventListener('click', handlers.click);
    root.addEventListener('dblclick', handlers.dblclick);
    root.addEventListener('keydown', handlers.keydown);

    const isEditable = (el) =>
      el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);

    handlers.input = (e) => {
      if (isEditable(e.target)) {
        handleInput();
        caret.typing = true;
        clearDeferred(caret._typingTimer);
        caret._typingTimer = defer(() => { caret.typing = false; }, 1500);
      }
    };
    handlers.mousemove = (e) => {
      if (!browserFocused) return;
      mouseMovedSinceLastFrame = true;
      _lastMouseEvent = { x: e.clientX, y: e.clientY };
      _mouseDirty = true;
    };
    handlers.selectionchange = () => {
      const ae = document.activeElement;
      const editable = ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.isContentEditable);
      if (!editable) { caret.active = false; return; }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { caret.active = false; return; }
      const range = sel.getRangeAt(0);
      caret.active = range.collapsed;
    };
    handlers.windowFocus = () => {
      browserFocused = true;
      syncLoopState('windowFocus');
    };
    handlers.windowBlur = () => {
      browserFocused = false;
      if (testMode) stopTestMode();
      syncLoopState('windowBlur');
    };
    handlers.visibilitychange = () => {
      if (document.hidden) {
        browserFocused = false;
        if (testMode) stopTestMode();
      } else {
        browserFocused = true;
      }
      syncLoopState('visibility');
    };

    document.addEventListener('input', handlers.input);
    document.addEventListener('mousemove', handlers.mousemove, { passive: true });
    document.addEventListener('selectionchange', handlers.selectionchange);
    window.addEventListener('focus', handlers.windowFocus);
    window.addEventListener('blur', handlers.windowBlur);
    document.addEventListener('visibilitychange', handlers.visibilitychange);

    handlers.reduceMotionChange = (e) => {
      reduceMotion = e.matches;
      if (root) root.classList.toggle('reduced-motion-runtime', reduceMotion);
      if (reduceMotion) {
        particles.forEach(p => releaseEl(p.el));
        particles = [];
        activeSparks = 0;
        segmentEffects = [];
        hideTooltip();
      }
      syncLoopState('reduceMotion');
    };
    if (reduceMotionMql.addEventListener) {
      reduceMotionMql.addEventListener('change', handlers.reduceMotionChange);
    } else if (reduceMotionMql.addListener) {
      reduceMotionMql.addListener(handlers.reduceMotionChange);
    }

    listenersBound = true;
  }

  // ---------- инициализация ----------

  function init(mountEl, tabId) {
    destroyed = false;
    if (root) {
      destroy();
      // destroy() marks the previous instance as destroyed;
      // this init() continues with a fresh instance, so reset the flag.
      destroyed = false;
    }
    resetDomRefs();
    currentTabId = tabId || null;
    state = loadState(currentTabId);
    if (!state.lastInitTime) {
      state.lastInitTime = Date.now();
      state.updatedAt = state.lastInitTime;
      saveState();
    }
    createDOM();
    root.classList.toggle('reduced-motion-runtime', reduceMotion);
    lastAriaLabel = '';
    syncAccessibleLabel(true);
    setupBroadcast();
    setupEventListeners();

    try {
      const today = new Date().toDateString();
      if (localStorage.getItem(EGG_STORAGE_KEY) === today) egg.triggeredToday = true;
    } catch {}
    try { localStorage.removeItem(DYING_STORAGE_KEY + '-' + currentTabId); } catch {}

    const container = mountEl || document.getElementById('ember-slot');
    if (container) container.appendChild(root);
    else document.body.appendChild(root);

    initParticlePool();

    browserFocused = !document.hidden;
    onScreen = true;

    // optimistic geometry check — if element already visible, skip IO wait
    const _initRect = root.getBoundingClientRect();
    const _initVisible = _initRect.width > 0 && _initRect.height > 0 && !document.hidden;
    if (_initVisible) onScreen = true;

    if ('IntersectionObserver' in window) {
      if (!_initVisible) onScreen = false;
      io = new IntersectionObserver(([e]) => {
        onScreen = e.isIntersecting;
        syncLoopState('io');
      }, { threshold: 0 });
      io.observe(root);
    } else {
      onScreen = true;
    }

    syncLoopState('init');
    setTimeout(() => syncLoopState('init-timeout'), 200);

    prevRemaining = remainingSegments();
    lastWarnRemaining = remainingSegments();
    const quickReload = state.lastInitTime && (Date.now() - state.lastInitTime < 3000);
    spawnStart = quickReload ? performance.now() - 600 : performance.now();
    lastFrame = 0;
    _fullUpdateDone = false;
    fpsHistory.length = 0;
    lowFpsMode = false;
    reducedMotionTimer = null;

    ['segTremor', 'segTryIgnite', 'segHeatRipple', 'segFlicker', 'segHeatWave']
      .forEach(rescheduleSegDue);
    Object.keys(PRIORITY).forEach(t => {
      nextDue[t] = Date.now() + rand(2000, 15000);
    });
  }

  function destroy() {
    destroyed = true;
    try { localStorage.setItem(DYING_STORAGE_KEY + '-' + currentTabId, Date.now().toString()); } catch {}
    stopLoop();
    if (_idleCallbackId && 'cancelIdleCallback' in window) {
      cancelIdleCallback(_idleCallbackId);
      _idleCallbackId = null;
    }
    if (io) { io.disconnect(); io = null; }
    if (channel) { try { channel.close(); } catch {} channel = null; }
    if (handlers.storageSync) window.removeEventListener('storage', handlers.storageSync);
    clearDeferred(resetTimer);
    clearDeferred(caret._typingTimer);
    clearDeferred(statusTimer);
    clearDeferred(tooltipHideTimer);
    clearDeferred(tooltipRemoveTimer);
    clearDeferred(allowTestModeTimer);
    clearDeferred(_editTooltipTimer);
    hideTooltip(true);
    clearAllDeferred();
    particles.forEach(p => releaseEl(p.el));
    particles = [];
    if (particleLayer) {
      particleLayer.querySelectorAll('.ember-landing-glow').forEach(el => {
        styleCache.delete(el);
        el.remove();
      });
    }
    particlePool.forEach(s => s.el.remove());
    particlePool = [];
    glowPool.forEach(el => el.remove());
    glowPool = [];
    heatZonePool.forEach(el => { el.remove(); styleCache.delete(el); });
    heatZonePool = [];
    freeParticleIndices = [];
    freeGlowEls = [];
    poolInited = false;
    activeSparks = 0;
    glowTrackX = 0; glowTrackY = 0;
    ashTrackX = 0; ashTrackY = 0;
    _mouseDirty = false;
    _lastMouseEvent = null;
    mouseMovedSinceLastFrame = false;
    hazeTrackX = 0;
    emberMood = 'calm';
    residualHeat = 0;
    ringAngle = 0;
    bobPhase = 0;
    breathPatternIdx = 0;
    nextBreathSwitch = 0;
    attn.state = 'idle'; attn.timer = 0; attn.hotHeat = 0;
    attn.dirX = 0; attn.hotX = 50; attn.hotY = 50; attn.activeHsIdx = -1;
    _emberCenterCache.frame = -1;
    _idleLevel = 0; _idleConsecutive = 0;
    focusState = 'active'; focusTimer = 0;
    temperament.curiosity = 0; temperament.nervousness = 0;
    temperament.tiredness = 0; temperament.satisfaction = 0;
    gaze.x = 0; gaze.y = 0; gaze.strength = 0;
    mouse.x = 0; mouse.y = 0; mouse.lastSampleX = 0; mouse.lastSampleY = 0; mouse.lastSampleTime = 0; mouse.speed = 0;
    caret.x = 0; caret.y = 0; caret.active = false; caret.typing = false;
    cursorLean.x = 0; cursorLean.y = 0; cursorLean.squish = 0; cursorLean.scale = 1; cursorLean.tiltX = 0; cursorLean.tiltY = 0;
    peek.state = 'idle'; peek.timer = 0; peek.leanX = 0; peek.leanY = 0; peek.blinkPhase = 0; peek.noticeDelay = 0; peek.lookDuration = 0; peek.leanProgress = 0; peek.cooldown = 0;
    hover = false; hoverVal = 0;
    spawnCore = 1; spawnGlow = 1; spawnRing = 1;
    intensity = 1; breathPhase = 0; breathScale = 1; heat = 1;
    crackGlowMod = 0; ashCoverage = 0;
    typedChars = 0; heatBoost = 0;
    shimmerActive = false; shimmerEnd = 0; nextShimmerCheck = 0;
    browserFocused = true; onScreen = true; hasActiveSquash = false;
    statusState = null; statusBurstDone = false; statusTimer = null;
    anticipation.active = false;
    egg.active = false; egg.triggeredToday = false;
    egg._ringDone = false; egg._burstDone = false;
    eggCharCount = 0; eggTriggeredDay = null;
    previewScare.active = false;
    flashHeat = 0; coreHeatReserve = 0;
    breathHoldUntil = 0;
    tooltipEl = null;
    tooltipText = '';
    tooltipHideTimer = null;
    tooltipRemoveTimer = null;
    state = null;
    currentTabId = null;
    testLabel = null;
    allowTestModeTimer = null;
    allowTestMode = false;
    testMode = false;
    testQueue = []; testIndex = 0;
    clearDeferred(testModeTimer);
    clearDeferred(nextTestStepTimer);
    testModeTimer = null;
    nextTestStepTimer = null;
    onClickCallback = null;
    if (styleCache) styleCache.clear();

    if (root) {
      if (handlers.mouseenter) root.removeEventListener('mouseenter', handlers.mouseenter);
      if (handlers.mouseleave) root.removeEventListener('mouseleave', handlers.mouseleave);
      if (handlers.rootFocus) root.removeEventListener('focus', handlers.rootFocus);
      if (handlers.rootBlur) root.removeEventListener('blur', handlers.rootBlur);
      if (handlers.contextmenu) root.removeEventListener('contextmenu', handlers.contextmenu);
      if (handlers.click) root.removeEventListener('click', handlers.click);
      if (handlers.dblclick) root.removeEventListener('dblclick', handlers.dblclick);
      if (handlers.keydown) root.removeEventListener('keydown', handlers.keydown);
    }
    if (handlers.input) document.removeEventListener('input', handlers.input);
    if (handlers.mousemove) document.removeEventListener('mousemove', handlers.mousemove);
    if (handlers.selectionchange) document.removeEventListener('selectionchange', handlers.selectionchange);
    if (handlers.windowFocus) window.removeEventListener('focus', handlers.windowFocus);
    if (handlers.windowBlur) window.removeEventListener('blur', handlers.windowBlur);
    if (handlers.visibilitychange) document.removeEventListener('visibilitychange', handlers.visibilitychange);
    if (handlers.reduceMotionChange) {
      if (reduceMotionMql.removeEventListener) {
        reduceMotionMql.removeEventListener('change', handlers.reduceMotionChange);
      } else if (reduceMotionMql.removeListener) {
        reduceMotionMql.removeListener(handlers.reduceMotionChange);
      }
    }
    handlers = {};
    listenersBound = false;

    if (root) { root.remove(); root = null; }
    segments = [];
    zones = [];
    hotspots = [];
    crackLayers = [];
    active.clear();
    segmentEffects = [];
    Object.keys(nextDue).forEach(k => delete nextDue[k]);
    Object.keys(nextSegDue).forEach(k => delete nextSegDue[k]);
    prevAppliedRemaining = -1;
    prevRemaining = 12;
    fpsHistory.length = 0;
    lowFpsMode = false;
    lastFrame = 0;
    heatOffsetX = 0; heatOffsetY = 0;
    heatTargetX = 0; heatTargetY = 0;
    nextHeatShift = 0;
    nextAshSpawn = 0;
    nextSparkCheck = 0;
    nextAnomalySparkAt = 0;
    nextMouseSample = 0;
    nextCaretSample = 0;
  }

  return {
    init, destroy, notifyEdit, switchTab, setStatus,
    onPreviewOpen: startPreviewScare,
    onClick(fn) { onClickCallback = fn; },
    triggerReaction(type, data) { queueReaction(type, data); },
    enableTestMode(value = true, ttlMs = 60000) { setAllowTestMode(value, ttlMs); },
  };
})();
