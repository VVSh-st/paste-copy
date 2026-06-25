// file_name: ember.js
//
// "Уголёк" — живой индикатор состояния проекта.
// Один rAF-цикл: update() -> applyVariables() -> requestAnimationFrame.
// Все случайные эффекты идут через единый менеджер с приоритетом и
// лимитом в 3 одновременных эффекта (со взаимным вытеснением слотов).
// ПКМ на уголёк — циклический запуск всех эффектов для тестирования.

const Ember = (() => {
  'use strict';

  const LIFE = 7 * 24 * 60 * 60 * 1000;
  const STORAGE_KEY = 'ember-state';
  const BROADCAST_KEY = 'ember-sync';

  // --- приоритет эффектов: меньше число = выше приоритет ---
  const PRIORITY = {
    sigh: 1, calmBurn: 2, wiggle: 3, tilt: 4, microShift: 5,
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
  let particleLayer = null;

  let hover = false;
  let hoverVal = 0;
  let intensity = 1;
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

  // сегменты
  let prevRemaining = 12;

  // спавн
  let spawnStart = 0;

  // активные эффекты ядра
  const active = new Map();
  let nextDue = {};

  let tiltCurrent = 0;
  let tiltTarget = 0;

  // сегментные эффекты
  let segmentEffects = [];
  let nextSegDue = {};

  // частицы (микропепел + искры)
  let particles = [];
  let nextAshSpawn = 0;
  let nextSparkCheck = 0;
  let activeSparks = 0;

  // дрожание воздуха
  let shimmerActive = false;
  let shimmerEnd = 0;
  let nextShimmerCheck = 0;

  // отслеживание курсора
  const mouse = { x: 0, y: 0, lastSampleX: 0, lastSampleY: 0, lastSampleTime: 0, speed: 0, active: false };
  const caret = { x: 0, y: 0, active: false, typing: false, lastTypingEnd: 0 };
  const cursorLean = { x: 0, y: 0, squish: 0 };
  let cursorReactionCooldown = 0;
  let mouseEnterTime = 0;
  let mouseInZone = false;

  // ПКМ тестирование
  let testMode = false;
  let testQueue = [];
  let testIndex = 0;
  let testLabel = null;

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

  // ---------- менеджер эффектов ядра ----------

  function rescheduleDue(type) {
    const ranges = {
      calmBurn: [15, 30], sigh: [20, 40], wiggle: [15, 30],
      tilt: [20, 40], microShift: [20, 40],
      crackle: [30, 60], stretch: [40, 80], glint: [50, 90],
      sleepySag: [60, 120],
      smolder: [25, 50], heatRadiance: [35, 65],
      glowPulse: [30, 55], ashDrift: [20, 45],
    };
    const slow = sleepSlowdown();
    const [a, b] = ranges[type] || [30, 60];
    nextDue[type] = Date.now() + rand(a, b) * 1000 * slow;
  }

  function tryStart(type, probability, durRangeMs, extra) {
    if (testMode) {
      // в тестовом режиме — принудительный запуск из очереди
      if (active.has(type)) return;
      if (active.size >= MAX_EFFECTS) {
        let worstType = null, worstPri = -1;
        for (const t of active.keys()) {
          if (PRIORITY[t] > worstPri) { worstPri = PRIORITY[t]; worstType = t; }
        }
        if (worstType && PRIORITY[worstType] > PRIORITY[type]) {
          active.delete(worstType); rescheduleDue(worstType);
        } else return;
      }
      active.set(type, { phase: 0, durMs: rand(durRangeMs[0], durRangeMs[1]), ...extra });
      return;
    }
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
    segmentEffects.push({ type, segIdx, phase: 0, durMs: rand(durRangeMs[0], durRangeMs[1]) });
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
    });
    for (const e of segmentEffects) {
      const seg = segments[e.segIdx];
      if (!seg) continue;
      switch (e.type) {
        case 'segTremor':
          seg.style.setProperty('--seg-tilt', (Math.sin(e.phase * Math.PI) * 5).toFixed(2) + 'deg');
          break;
        case 'segTryIgnite':
          seg.style.setProperty('--seg-flash',
            (e.phase < 0.3 ? easeOutQuad(e.phase / 0.3) : 1 - easeInQuad((e.phase - 0.3) / 0.7)).toFixed(3));
          break;
        case 'segHeatRipple':
          seg.style.setProperty('--seg-brightness', (1 + Math.sin(e.phase * Math.PI) * 1.2).toFixed(3));
          break;
        case 'segFlicker':
          seg.style.setProperty('--seg-dim',
            (0.7 + 0.7 * Math.sin(e.phase * Math.PI * 6) * (1 - e.phase)).toFixed(3));
          break;
        case 'segHeatWave': {
          const activeIdx = getActiveSegIndices();
          const pos = e.phase * activeIdx.length;
          const localPhase = pos - Math.floor(pos);
          const wave = Math.sin(localPhase * Math.PI);
          const dist = Math.abs(e.segIdx - Math.floor(pos));
          if (dist <= 1)
            seg.style.setProperty('--seg-brightness', (1 + wave * 0.8 * (1 - dist)).toFixed(3));
          break;
        }
      }
    }
  }

  // ---------- частицы: микропепел ----------

  function spawnAshParticle() {
    if (particles.length > 20) return;
    const el = document.createElement('div');
    el.className = 'ember-ash';
    const startX = rand(25, 75);
    const startY = rand(20, 65);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
    particleLayer.appendChild(el);

    const dur = rand(2500, 5000);
    const driftX = rand(-12, 12);
    const driftY = rand(-20, -8);
    particles.push({
      el, born: performance.now(), dur,
      startX, startY, driftX, driftY,
    });
  }

  function updateParticles(now) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = now - p.born;
      const t = clamp(age / p.dur, 0, 1);
      if (t >= 1) {
        p.el.remove();
        particles.splice(i, 1);
        continue;
      }
      const x = p.startX + p.driftX * t;
      const y = p.startY + p.driftY * t;
      const opacity = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
      p.el.style.left = x + '%';
      p.el.style.top = y + '%';
      p.el.style.opacity = (opacity * 0.85).toFixed(3);
    }
  }

  // ---------- частицы: искры ----------

  function spawnSpark() {
    if (activeSparks >= 3) return;
    const el = document.createElement('div');
    el.className = 'ember-spark';
    const startX = rand(30, 70);
    const startY = rand(20, 55);
    el.style.left = startX + '%';
    el.style.top = startY + '%';
    particleLayer.appendChild(el);

    const dur = rand(800, 1200);
    const driftX = rand(-6, 6);
    activeSparks++;
    particles.push({
      el, born: performance.now(), dur,
      startX, startY, driftX, driftY: -6,
      isSpark: true,
    });
  }

  // ---------- дрожание воздуха ----------

  function updateShimmer(now) {
    if (!shimmerActive && now > nextShimmerCheck) {
      if (Math.random() < 0.15) {
        shimmerActive = true;
        shimmerEnd = now + rand(2000, 4000);
        root.classList.add('ember-shimmer');
      }
      nextShimmerCheck = now + rand(120000, 180000); // 2–3 мин
    }
    if (shimmerActive && now > shimmerEnd) {
      shimmerActive = false;
      root.classList.remove('ember-shimmer');
    }
  }

  // ---------- отслеживание курсора ----------

  const CURSOR_SAMPLE_INTERVAL = 80;
  const CURSOR_ZONE_RADIUS = 200;
  const CARET_SAMPLE_INTERVAL = 100;
  let nextMouseSample = 0;
  let nextCaretSample = 0;

  function sampleMousePosition(now) {
    if (now < nextMouseSample) return;
    nextMouseSample = now + CURSOR_SAMPLE_INTERVAL;
    const dx = mouse.x - mouse.lastSampleX;
    const dy = mouse.y - mouse.lastSampleY;
    const dt = now - mouse.lastSampleTime || 1;
    mouse.speed = Math.sqrt(dx * dx + dy * dy) / (dt / 16.7);
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

  function updateCursorLean(now, dt) {
    const ember = getEmberCenter();

    // мышь в зоне?
    const mDx = mouse.x - ember.x;
    const mDy = mouse.y - ember.y;
    const mDist = Math.sqrt(mDx * mDx + mDy * mDy);
    const mInZone = mDist < CURSOR_ZONE_RADIUS;

    // входим в зону — решаем реагировать или нет
    if (mInZone && !mouseInZone) {
      mouseInZone = true;
      mouseEnterTime = now;
      cursorReactionCooldown = now + rand(300, 1200);
      if (Math.random() < (1 - intensity) * 0.4) {
        cursorReactionCooldown = now + rand(4000, 10000);
      }
    } else if (!mInZone) {
      mouseInZone = false;
    }

    // цель для наклона — от позиции мыши
    let targetLeanX = 0, targetLeanY = 0, targetSquish = 0;
    if (mInZone && now > cursorReactionCooldown) {
      const normX = clamp(mDx / CURSOR_ZONE_RADIUS, -1, 1);
      const normY = clamp(mDy / CURSOR_ZONE_RADIUS, -1, 1);
      const proximity = 1 - clamp(mDist / CURSOR_ZONE_RADIUS, 0, 1);
      const strength = proximity * proximity;
      targetLeanX = normX * strength * 3.5;
      targetLeanY = normY * strength * 2.5;
      // сжатие когда курсор внизу
      if (normY > 0.3) targetSquish = (normY - 0.3) * 0.25 * strength;
    }

    // typing approach — подхожу к каретке
    if (caret.active && caret.typing) {
      const cDx = caret.x - ember.x;
      const cDy = caret.y - ember.y;
      const cDist = Math.sqrt(cDx * cDx + cDy * cDy);
      if (cDist > 15 && cDist < 500) {
        const cNormX = clamp(cDx / cDist, -1, 1);
        const cNormY = clamp(cDy / cDist, -1, 1);
        const cStrength = clamp(1 - cDist / 500, 0, 0.6);
        targetLeanX += cNormX * cStrength * 2;
        targetLeanY += cNormY * cStrength * 1.5;
      }
    }

    // dodge — быстрое движение мыши
    if (mouse.speed > 12 && mInZone && mDist < 80) {
      const dodgeX = -normDX(mDx, mDist) * Math.min(mouse.speed * 0.08, 2);
      const dodgeY = -normDY(mDy, mDist) * Math.min(mouse.speed * 0.06, 1.5);
      targetLeanX += dodgeX;
      targetLeanY += dodgeY;
    }

    // startle — резкое появление мыши
    if (mInZone && mouse.speed > 8 && now - mouseEnterTime < 300) {
      targetLeanX += (Math.random() < 0.5 ? 1 : -1) * 1.5;
      targetLeanY -= 1;
    }

    // плавная интерполяция
    const lerpSpeed = clamp(dt * 0.0025, 0, 1);
    cursorLean.x += (targetLeanX - cursorLean.x) * lerpSpeed;
    cursorLean.y += (targetLeanY - cursorLean.y) * lerpSpeed;
    cursorLean.squish += (targetSquish - cursorLean.squish) * lerpSpeed;

    // gaze following — тепловые зоны следят за курсором
    if (mInZone && now > cursorReactionCooldown) {
      const gStr = 1 - clamp(mDist / CURSOR_ZONE_RADIUS, 0, 1);
      heatTargetX += normDX(mDx, mDist) * gStr * 0.3;
      heatTargetY += normDY(mDy, mDist) * gStr * 0.3;
    }
  }

  function normDX(dx, dist) { return dist > 0 ? dx / dist : 0; }
  function normDY(dy, dist) { return dist > 0 ? dy / dist : 0; }

  // ---------- ПКМ тестирование ----------

  const TEST_EFFECTS = [
    'sigh', 'calmBurn', 'wiggle', 'tilt', 'microShift',
    'crackle', 'stretch', 'glint', 'sleepySag',
    'smolder', 'heatRadiance', 'glowPulse', 'ashDrift',
    'cursorLean', 'typingApproach', 'startle', 'playfulDodge',
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

    // показываем название текущего эффекта
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
      cursorLean: [2000, 3000], typingApproach: [3000, 4000],
      startle: [1500, 2000], playfulDodge: [1200, 1800],
    };
    const extra = type === 'tilt' ? { target: rand(-1, 1) }
      : type === 'microShift' ? { dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) }
      : type === 'ashDrift' ? { dx: rand(-3, 3) }
      : {};
    // принудительный запуск — очищаем всё перед каждым эффектом
    active.clear();
    active.set(type, { phase: 0, durMs: rand(durRanges[type][0], durRanges[type][1]), ...extra });

    // запускаем сегментные эффекты тоже
    if (['segTremor', 'segFlicker'].includes(type)) {
      const a = getActiveSegIndices();
      if (a.length) segmentEffects.push({ type, segIdx: a[Math.floor(Math.random() * a.length)], phase: 0, durMs: rand(400, 600) });
    }

    // запускаем искры/пепел для соответствующих эффектов
    if (type === 'crackle' || type === 'glowPulse' || type === 'calmBurn') {
      for (let i = 0; i < 5; i++) setTimeout(() => spawnSpark(), i * 150);
    }
    if (type === 'ashDrift' || type === 'smolder' || type === 'sigh') {
      for (let i = 0; i < 8; i++) setTimeout(() => spawnAshParticle(), i * 200);
    }

    // курсорные эффекты — имитируем позицию мыши
    if (type === 'cursorLean') {
      cursorReactionCooldown = 0;
      mouseInZone = true;
      mouseEnterTime = performance.now() - 5000;
      mouse.x = getEmberCenter().x + rand(-120, 120);
      mouse.y = getEmberCenter().y + rand(30, 150);
    }
    if (type === 'typingApproach') {
      caret.typing = true;
      caret.active = true;
      caret.x = getEmberCenter().x + rand(-100, 100);
      caret.y = getEmberCenter().y + rand(-50, 50);
      setTimeout(() => { caret.typing = false; }, 2000);
    }
    if (type === 'startle') {
      mouseInZone = false;
      mouseEnterTime = performance.now();
      mouse.x = getEmberCenter().x + rand(-200, 200);
      mouse.y = getEmberCenter().y + rand(-200, 200);
      mouse.speed = rand(15, 30);
    }
    if (type === 'playfulDodge') {
      mouseInZone = true;
      mouseEnterTime = performance.now() - 2000;
      mouse.x = getEmberCenter().x + rand(-60, 60);
      mouse.y = getEmberCenter().y + rand(-60, 60);
      mouse.speed = rand(15, 25);
    }

    setTimeout(runNextTest, 2500);
  }

  // ---------- основной кадр ----------

  function update(now, dt) {
    intensity = calcIntensity();

    sampleMousePosition(now);
    sampleCaretPosition(now);
    updateCursorLean(now, dt);

    // спавн
    const since = now - spawnStart;
    const spawnCore = clamp(since / 500, 0, 1);
    const spawnGlow = clamp((since - 400) / 500, 0, 1);
    const spawnRing = clamp((since - 800) / 600, 0, 1);

    // hover
    const hoverStep = clamp(dt / 300, 0, 1);
    hoverVal += hover ? (1 - hoverVal) * hoverStep : (0 - hoverVal) * hoverStep;

    // дыхание (~4-5с)
    const speedMult = (1 + hoverVal * 0.8) / sleepSlowdown();
    const breathBase = intensity > 0.3 ? 0.00055 : 0.0002;
    breathPhase += breathBase * speedMult * dt;
    const hoverBreath = hover ? Math.sin(breathPhase * 2.5) * 0.05 * hoverVal : 0;
    const breathScale = 1 + Math.sin(breathPhase * 2.5) * 0.012 * intensity + hoverBreath;

    updateHeatZones(dt);
    if (heatBoost > 0) heatBoost = Math.max(0, heatBoost - 0.00025 * dt);

    // --- эффекты ядра (только в автоматическом режиме) ---
    if (!testMode) {
      tryStart('sigh', 0.5, [4000, 5000]);
      tryStart('calmBurn', 0.8, [2000, 3000]);
      if (intensity > 0.5) tryStart('wiggle', 0.3, [700, 1000]);
      tryStart('tilt', 0.25, [2000, 2000], { target: rand(-1, 1) });
      tryStart('microShift', 0.2, [1000, 2000], { dx: rand(0.3, 0.6) * (Math.random() < 0.5 ? -1 : 1) });
      tryStart('crackle', 0.4, [80, 150]);
      tryStart('stretch', 0.35, [3000, 4000]);
      tryStart('glint', 0.3, [2000, 3000]);
      if (intensity < 0.4) tryStart('sleepySag', 0.25, [3000, 5000]);
      tryStart('smolder', 0.3, [3000, 4000]);
      tryStart('heatRadiance', 0.25, [2500, 3500]);
      tryStart('glowPulse', 0.3, [2000, 3000]);
      tryStart('ashDrift', 0.3, [3000, 4000], { dx: rand(-3, 3) });
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

    // --- композиция ---
    const tm = testMode ? 5 : 1; // тестовый режим: усиление в 5 раз

    // поёживание — усилено
    let scaleX = 1, scaleY = 1;
    if (wiggle) {
      const pts = [[1, 1], [0.96, 1.04], [1.02, 0.98], [1, 1]];
      const s = wiggle.phase * (pts.length - 1);
      const i0 = Math.floor(s), i1 = Math.min(i0 + 1, pts.length - 1);
      const lt = s - i0;
      scaleX = pts[i0][0] + (pts[i1][0] - pts[i0][0]) * lt;
      scaleY = pts[i0][1] + (pts[i1][1] - pts[i0][1]) * lt;
    }

    // растяжка/зевок — усилено
    if (stretch) {
      const pts = [[1, 1], [1.06, 1], [0.95, 1], [1, 1]];
      const s = stretch.phase * (pts.length - 1);
      const i0 = Math.floor(s), i1 = Math.min(i0 + 1, pts.length - 1);
      const lt = s - i0;
      scaleY *= pts[i0][1] + (pts[i1][1] - pts[i0][1]) * lt;
    }

    // спокойное горение
    const calmMult = calmBurn ? 1 + bump(calmBurn.phase, 0.3, 0.7) * 0.04 * tm : 1;
    const calmBright = calmBurn ? bump(calmBurn.phase, 0.3, 0.7) * 0.2 * tm : 0;

    // вздох
    const sighMult = sigh ? 1 + bump(sigh.phase, 0.25, 0.75) * 0.03 * tm : 1;
    const sighBright = sigh ? bump(sigh.phase, 0.25, 0.75) * 0.15 * tm : 0;
    const sighGlow = sigh ? bump(sigh.phase, 0.25, 0.75) * 0.25 * tm : 0;

    // потрескивание — яркая вспышка
    const crackleBright = crackle ? bump(crackle.phase, 0.3, 0.5) * 1.5 * tm : 0;

    // отблеск — насыщенность
    const glintHue = glint ? bump(glint.phase, 0.3, 0.7) * 25 * tm : 0;
    const glintSat = glint ? bump(glint.phase, 0.3, 0.7) * 0.4 * tm : 0;

    // сонная просадка
    const sleepyMult = sleepySag ? 1 - bump(sleepySag.phase, 0.3, 0.7) * 0.05 * tm : 1;
    const sleepyBright = sleepySag ? -bump(sleepySag.phase, 0.3, 0.7) * 0.25 * tm : 0;

    // тление
    const smolderHue = smolder ? bump(smolder.phase, 0.2, 0.8) * 20 * tm : 0;
    const smolderSat = smolder ? bump(smolder.phase, 0.2, 0.8) * 0.25 * tm : 0;

    // тепловое излучение
    const radianceGlow = heatRadiance ? bump(heatRadiance.phase, 0.3, 0.7) * 0.4 * tm : 0;

    // пульс свечения
    const glowPulseMult = glowPulse ? bump(glowPulse.phase, 0.2, 0.6) * 0.35 * tm : 0;

    // дрейф пепла
    const ashDriftX = ashDrift ? bump(ashDrift.phase, 0.3, 0.7) * (ashDrift.dx ?? 0) * 2 * tm : 0;

    // поворот
    if (tilt) tiltTarget = tilt.target * (1 - Math.abs(2 * tilt.phase - 1));
    tiltCurrent += (tiltTarget - tiltCurrent) * clamp(0.08 * (dt / 16.7), 0, 1);

    // микросмещение
    const microShiftPx = microShift ? bump(microShift.phase, 0.5, 0.5) * (microShift.dx ?? 0.5) : 0;

    const finalScaleX = breathScale * scaleX * calmMult * sighMult * sleepyMult;
    const finalScaleY = breathScale * scaleY * calmMult * sighMult * sleepyMult;

    const heat = clamp(intensity + heatBoost * 0.25, 0, 1);
    const glow = clamp(intensity + heatBoost * 0.3 + sighGlow + hoverVal * 0.15 + radianceGlow + glowPulseMult, 0, 1.8);

    const brightness = clamp(
      0.7 + intensity * 0.3 + calmBright + sighBright + crackleBright + sleepyBright
      + heatBoost * 0.4 + hoverVal * 0.15,
      0.35, 2.5
    );

    const shiftX = heatOffsetX * 0.6 + microShiftPx + ashDriftX;
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
    root.style.setProperty('--glowOpacity', (1 + hoverVal * 0.15 + radianceGlow).toFixed(3));
    root.style.setProperty('--glowBlur', (5 + hoverVal * 1.5 + radianceGlow * 3).toFixed(2) + 'px');
    root.style.setProperty('--glowScale', (1 + hoverVal * 0.08 + radianceGlow * 0.15).toFixed(3));
    root.style.setProperty('--ringOpacity', clamp(intensity * 0.6 + 0.4, 0, 1).toFixed(3));

    root.style.setProperty('--cursorLeanX', cursorLean.x.toFixed(2));
    root.style.setProperty('--cursorLeanY', cursorLean.y.toFixed(2));
    root.style.setProperty('--cursorSquish', cursorLean.squish.toFixed(3));

    root.style.setProperty('--spawnCore', spawnCore.toFixed(3));
    root.style.setProperty('--spawnGlow', spawnGlow.toFixed(3));
    root.style.setProperty('--spawnRing', spawnRing.toFixed(3));

    // отблеск + тление на core
    const totalHue = glintHue + smolderHue;
    const totalSat = glintSat + smolderSat;
    if (totalHue || totalSat) {
      coreEl.style.filter = `hue-rotate(${totalHue.toFixed(1)}deg) saturate(${(1 + totalSat).toFixed(3)})`;
    } else {
      coreEl.style.filter = '';
    }

    applySegments();

    // --- сегментные эффекты ---
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

    // --- микропепел ---
    if (Date.now() > nextAshSpawn) {
      if (Math.random() < 0.5) spawnAshParticle();
      nextAshSpawn = Date.now() + rand(1500, 4000);
    }
    updateParticles(now);

    // --- искры ---
    if (Date.now() > nextSparkCheck) {
      if (Math.random() < 0.25 && activeSparks < 3) spawnSpark();
      nextSparkCheck = Date.now() + rand(20000, 50000);
    }
    // подсчёт активных искр
    activeSparks = particles.filter(p => p.isSpark).length;

    // --- дрожание воздуха ---
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
  }

  function setupEventListeners() {
    root.addEventListener('mouseenter', () => { hover = true; });
    root.addEventListener('mouseleave', () => { hover = false; });
    root.addEventListener('focus', () => { hover = true; });
    root.addEventListener('blur', () => { hover = false; });

    // ПКМ — тестовый режим
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!testMode) startTestMode();
    });

    const isEditable = (el) =>
      el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);

    document.addEventListener('input', (e) => {
      if (isEditable(e.target)) handleInput();
    });

    // отслеживание мыши
    document.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    });

    // отслеживание каретки — через selectionchange
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { caret.active = false; return; }
      const range = sel.getRangeAt(0);
      caret.active = range.collapsed;
    });

    // отслеживание набора текста
    document.addEventListener('input', (e) => {
      if (isEditable(e.target)) {
        caret.typing = true;
        clearTimeout(caret._typingTimer);
        caret._typingTimer = setTimeout(() => {
          caret.typing = false;
          caret.lastTypingEnd = performance.now();
        }, 1500);
      }
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
  }

  return { init, destroy, notifyEdit };
})();
