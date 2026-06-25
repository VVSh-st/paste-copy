// file_name: ember.js

const Ember = (() => {
  'use strict';

  const LIFE = 7 * 24 * 60 * 60 * 1000;
  const STORAGE_KEY = 'ember-state';
  const BROADCAST_KEY = 'ember-sync';

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
  let breathScale = 1;
  let breathDir = 1;
  let breathSpeed = 0.0008;
  let heatOffsetX = 0;
  let heatOffsetY = 0;
  let heatTargetX = 0;
  let heatTargetY = 0;
  let nextHeatShift = 0;
  let heatPhase = 0;
  let heatPhaseSpeed = 0.003;

  let nextCalmBurn = 0;
  let calmBurnActive = false;
  let calmBurnEnd = 0;
  let calmBurnPhase = 0;

  let nextSigh = 0;
  let sighActive = false;
  let sighEnd = 0;
  let sighPhase = 0;

  let nextWiggle = 0;
  let wiggleActive = false;
  let wiggleEnd = 0;
  let wigglePhase = 0;
  let wigglePoints = null;

  let nextTilt = 0;
  let tiltActive = false;
  let tiltEnd = 0;
  let tiltPhase = 0;
  let tiltTarget = 0;
  let tiltCurrent = 0;

  let nextMicroShift = 0;
  let microShiftActive = false;
  let microShiftEnd = 0;
  let microShiftPhase = 0;

  let typedChars = 0;
  let heatBoost = 0;
  let heatBoostTarget = 0;
  let heatBoostDecay = 0;

  let spawnPhase = 0;
  let spawned = false;
  let spawnComplete = false;

  let activeEffects = 0;
  const MAX_EFFECTS = 2;

  let channel = null;
  let rafId = null;
  let lastFrame = 0;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  function easeOutQuad(t) {
    return t * (2 - t);
  }

  function easeInQuad(t) {
    return t * t;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.lastEditTime === 'number') return parsed;
      }
    } catch {}
    return { lastEditTime: Date.now(), lastActiveTab: null };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  function broadcast() {
    try {
      if (channel) channel.postMessage({ type: 'update', state });
    } catch {}
  }

  function updateLastEdit() {
    state.lastEditTime = Date.now();
    saveState();
    broadcast();
  }

  function calcIntensity() {
    const age = Date.now() - state.lastEditTime;
    const t = clamp(age / LIFE, 0, 1);
    return Math.pow(1 - t, 1.7);
  }

  function calcHoursWithoutActivity() {
    return (Date.now() - state.lastEditTime) / (60 * 60 * 1000);
  }

  function getRemainingSegments() {
    const hours = calcHoursWithoutActivity();
    return 12 - Math.floor(hours / 2);
  }

  function isSleeping() {
    const hours = calcHoursWithoutActivity();
    return hours > 5 * 24;
  }

  function effectFrequencyMult() {
    if (!isSleeping()) return 1;
    const hours = calcHoursWithoutActivity();
    return 0.5 + (1 - clamp((hours - 5 * 24) / (2 * 24), 0, 1)) * 0.5;
  }

  function canAddEffect() {
    return activeEffects < MAX_EFFECTS;
  }

  function startEffect(type) {
    if (!canAddEffect()) return false;
    activeEffects++;
    return true;
  }

  function endEffect() {
    activeEffects = Math.max(0, activeEffects - 1);
  }

  function createDOM() {
    root = document.createElement('div');
    root.className = 'ember';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', 'Индикатор состояния');
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

    for (let i = 1; i <= 3; i++) {
      const zone = document.createElement('div');
      zone.className = `heat-zone zone${i}`;
      coreEl.appendChild(zone);
      zones.push(zone);
    }

    glowEl = document.createElement('div');
    glowEl.className = 'ember-glow';
    coreEl.appendChild(glowEl);

    root.appendChild(ringEl);
    root.appendChild(coreEl);

    return root;
  }

  function applySegments() {
    const remaining = clamp(getRemainingSegments(), 0, 12);
    segments.forEach((seg, i) => {
      const active = i < remaining;
      seg.classList.toggle('active', active);
    });
  }

  function applyHeatVariables() {
    const i = intensity;
    const boost = heatBoost;
    const finalIntensity = clamp(i + boost * 0.25, 0, 1);
    const heat = clamp(finalIntensity, 0, 1);
    const glow = clamp(finalIntensity, 0, 1);

    root.style.setProperty('--heat', heat.toFixed(3));
    root.style.setProperty('--glow', glow.toFixed(3));
    root.style.setProperty('--intensity', finalIntensity.toFixed(3));
    root.style.setProperty('--hover', hoverVal.toFixed(3));
    root.style.setProperty('--breathScale', breathScale.toFixed(4));
    root.style.setProperty('--shiftX', heatOffsetX.toFixed(2) + 'px');
    root.style.setProperty('--shiftY', heatOffsetY.toFixed(2) + 'px');
    root.style.setProperty('--tiltX', tiltCurrent.toFixed(2) + 'deg');
    root.style.setProperty('--tiltY', (tiltCurrent * 0.5).toFixed(2) + 'deg');
  }

  function updateZones() {
    const baseX = 30 + heatOffsetX * 3;
    const baseY = 35 + heatOffsetY * 3;
    zones.forEach((zone, i) => {
      const offsetX = baseX + Math.sin(heatPhase + i * 2.1) * 10;
      const offsetY = baseY + Math.cos(heatPhase + i * 1.7) * 10;
      zone.style.setProperty('--cx', clamp(offsetX, 15, 85) + '%');
      zone.style.setProperty('--cy', clamp(offsetY, 15, 85) + '%');
    });
  }

  function scheduleRandomEvents() {
    const freq = effectFrequencyMult();
    const sleeping = isSleeping();

    const calmBase = sleeping ? 180 : 45;
    const calmMax = sleeping ? 360 : 90;
    nextCalmBurn = Date.now() + rand(calmBase, calmMax) * 1000 * (1 / freq);

    const sighBase = sleeping ? 240 : 60;
    const sighMax = sleeping ? 480 : 120;
    nextSigh = Date.now() + rand(sighBase, sighMax) * 1000 * (1 / freq);

    const wiggleBase = sleeping ? 180 : 45;
    const wiggleMax = sleeping ? 360 : 90;
    nextWiggle = Date.now() + rand(wiggleBase, wiggleMax) * 1000 * (1 / freq);

    const tiltBase = sleeping ? 240 : 60;
    const tiltMax = sleeping ? 480 : 120;
    nextTilt = Date.now() + rand(tiltBase, tiltMax) * 1000 * (1 / freq);

    const microBase = sleeping ? 240 : 60;
    const microMax = sleeping ? 480 : 120;
    nextMicroShift = Date.now() + rand(microBase, microMax) * 1000 * (1 / freq);

    nextHeatShift = Date.now() + rand(2000, 4000);
  }

  function scheduleNextCalmBurn() {
    const sleeping = isSleeping();
    const base = sleeping ? 180 : 45;
    const max = sleeping ? 360 : 90;
    const freq = effectFrequencyMult();
    nextCalmBurn = Date.now() + rand(base, max) * 1000 * (1 / freq);
  }

  function scheduleNextSigh() {
    const sleeping = isSleeping();
    const base = sleeping ? 240 : 60;
    const max = sleeping ? 480 : 120;
    const freq = effectFrequencyMult();
    nextSigh = Date.now() + rand(base, max) * 1000 * (1 / freq);
  }

  function scheduleNextWiggle() {
    const sleeping = isSleeping();
    const base = sleeping ? 180 : 45;
    const max = sleeping ? 360 : 90;
    const freq = effectFrequencyMult();
    nextWiggle = Date.now() + rand(base, max) * 1000 * (1 / freq);
  }

  function scheduleNextTilt() {
    const sleeping = isSleeping();
    const base = sleeping ? 240 : 60;
    const max = sleeping ? 480 : 120;
    const freq = effectFrequencyMult();
    nextTilt = Date.now() + rand(base, max) * 1000 * (1 / freq);
  }

  function scheduleNextMicroShift() {
    const sleeping = isSleeping();
    const base = sleeping ? 240 : 60;
    const max = sleeping ? 480 : 120;
    const freq = effectFrequencyMult();
    nextMicroShift = Date.now() + rand(base, max) * 1000 * (1 / freq);
  }

  function startCalmBurn() {
    calmBurnActive = true;
    calmBurnEnd = Date.now() + rand(2000, 3000);
    calmBurnPhase = 0;
  }

  function startSigh() {
    sighActive = true;
    sighEnd = Date.now() + rand(4000, 5000);
    sighPhase = 0;
  }

  function startWiggle() {
    if (intensity <= 0.5) return;
    wiggleActive = true;
    wiggleEnd = Date.now() + rand(700, 1000);
    wigglePhase = 0;
    wigglePoints = [
      { sx: 1, sy: 1 },
      { sx: 0.98, sy: 1.02 },
      { sx: 1.01, sy: 0.99 },
      { sx: 1, sy: 1 },
    ];
  }

  function startTilt() {
    tiltActive = true;
    tiltEnd = Date.now() + 2000;
    tiltPhase = 0;
    tiltTarget = rand(-1, 1);
  }

  function startMicroShift() {
    microShiftActive = true;
    microShiftEnd = Date.now() + rand(1000, 2000);
    microShiftPhase = 0;
  }

  function update(now, dt) {
    intensity = calcIntensity();

    if (spawnPhase < 1) {
      spawnPhase = clamp(spawnPhase + dt / 1800, 0, 1);
    } else if (!spawnComplete) {
      spawnComplete = true;
    }

    if (hover) {
      hoverVal = clamp(hoverVal + dt / 300 * (1.8 - 0.8), 0, 1);
    } else {
      hoverVal = clamp(hoverVal - dt / 300, 0, 1);
    }

    const breathMult = 1 + hoverVal * 0.8;
    const breathSpeedBase = intensity > 0.3 ? 0.0008 : 0.0003;
    breathPhase += breathSpeedBase * breathMult * dt;

    const hoverBreathe = hoverVal * 0.05;
    const baseBreath = Math.sin(breathPhase * 2.5) * 0.008 * intensity;
    const hoverBreathComp = hover ? Math.sin(now / 800) * 0.03 : 0;
    breathScale = 1 + baseBreath + hoverBreathe + hoverBreathComp;

    if (now > nextHeatShift) {
      heatTargetX = rand(-3, 3);
      heatTargetY = rand(-3, 3);
      nextHeatShift = now + rand(2000, 4000);
    }

    heatOffsetX += (heatTargetX - heatOffsetX) * 0.003 * dt;
    heatOffsetY += (heatTargetY - heatOffsetY) * 0.003 * dt;

    heatPhase += heatPhaseSpeed * dt;

    if (heatBoost > 0) {
      heatBoost = Math.max(0, heatBoost - 0.002 * dt);
    }

    if (now > nextCalmBurn && !calmBurnActive && canAddEffect() && Math.random() < 0.7 * effectFrequencyMult()) {
      if (startEffect('calm')) startCalmBurn();
    }
    if (calmBurnActive) {
      calmBurnPhase += dt / (rand(2000, 3000));
      if (calmBurnPhase >= 1) {
        calmBurnActive = false;
        endEffect();
        scheduleNextCalmBurn();
      }
    }

    if (now > nextSigh && !sighActive && canAddEffect() && Math.random() < 0.35 * effectFrequencyMult()) {
      if (startEffect('sigh')) startSigh();
    }
    if (sighActive) {
      sighPhase += dt / (rand(4000, 5000));
      if (sighPhase >= 1) {
        sighActive = false;
        endEffect();
        scheduleNextSigh();
      }
    }

    if (now > nextWiggle && !wiggleActive && canAddEffect() && Math.random() < 0.2 * effectFrequencyMult()) {
      if (startEffect('wiggle')) startWiggle();
    }
    if (wiggleActive) {
      wigglePhase += dt / rand(700, 1000);
      if (wigglePhase >= 1) {
        wiggleActive = false;
        endEffect();
        scheduleNextWiggle();
      }
    }

    if (now > nextTilt && !tiltActive && canAddEffect() && Math.random() < 0.15 * effectFrequencyMult()) {
      if (startEffect('tilt')) startTilt();
    }
    if (tiltActive) {
      tiltPhase += dt / 2000;
      if (tiltPhase >= 1) {
        tiltActive = false;
        tiltTarget = 0;
        endEffect();
        scheduleNextTilt();
      }
      const ep = easeInOut(clamp(tiltPhase, 0, 1));
      tiltCurrent += (tiltTarget - tiltCurrent) * 0.02 * dt;
    } else {
      tiltCurrent += (0 - tiltCurrent) * 0.02 * dt;
    }

    if (now > nextMicroShift && !microShiftActive && canAddEffect() && Math.random() < 0.1 * effectFrequencyMult()) {
      if (startEffect('micro')) startMicroShift();
    }
    if (microShiftActive) {
      microShiftPhase += dt / rand(1000, 2000);
      if (microShiftPhase >= 1) {
        microShiftActive = false;
        endEffect();
        scheduleNextMicroShift();
      }
    }

    let scaleX = 1, scaleY = 1;
    if (wiggleActive && wigglePoints) {
      const t = clamp(wigglePhase, 0, 1);
      const totalPoints = wigglePoints.length - 1;
      const pIdx = t * totalPoints;
      const p0 = Math.floor(pIdx);
      const p1 = Math.min(p0 + 1, totalPoints);
      const lt = pIdx - p0;
      scaleX = wigglePoints[p0].sx + (wigglePoints[p1].sx - wigglePoints[p0].sx) * lt;
      scaleY = wigglePoints[p0].sy + (wigglePoints[p1].sy - wigglePoints[p0].sy) * lt;
    }

    let calmMult = 1;
    if (calmBurnActive) {
      const ct = calmBurnPhase;
      if (ct < 0.3) calmMult = 1 + easeOutQuad(ct / 0.3) * 0.02;
      else if (ct < 0.7) calmMult = 1.02;
      else calmMult = 1.02 - easeInQuad((ct - 0.7) / 0.3) * 0.02;
    }

    let sighMult = 1;
    if (sighActive) {
      const st = sighPhase;
      if (st < 0.25) sighMult = 1 + easeOutQuad(st / 0.25) * 0.015;
      else if (st < 0.75) sighMult = 1.015;
      else sighMult = 1.015 - easeInQuad((st - 0.75) / 0.25) * 0.015;
    }

    let brightBase = 0.7 + intensity * 0.3;
    let brightHover = hoverVal * 0.15;
    let brightCalm = calmBurnActive ? 0.1 * Math.sin(calmBurnPhase * Math.PI) : 0;
    let brightSigh = sighActive ? 0.06 * Math.sin(sighPhase * Math.PI) : 0;
    let brightBoost = heatBoost;
    let brightness = clamp(brightBase + brightHover + brightCalm + brightSigh + brightBoost, 0.3, 1.5);

    let filterStr = `brightness(${brightness.toFixed(3)})`;

    root.style.setProperty('--brightness', brightness.toFixed(3));

    let glowBoost = 0;
    if (sighActive) glowBoost += 0.1 * Math.sin(sighPhase * Math.PI);
    if (hover) glowBoost += 0.15;
    root.style.setProperty('--glowBoost', glowBoost.toFixed(3));

    const finalScale = breathScale * scaleX * scaleY * calmMult * sighMult;
    root.style.setProperty('--finalScale', finalScale.toFixed(4));

    root.style.filter = filterStr;

    applyHeatVariables();
    applySegments();
    updateZones();

    root.style.setProperty('--rotation', tiltCurrent.toFixed(2) + 'deg');
  }

  let breathPhase = 0;

  function animate(timestamp) {
    if (!root) return;
    if (lastFrame === 0) lastFrame = timestamp;
    const dt = Math.min(timestamp - lastFrame, 50);
    lastFrame = timestamp;

    update(timestamp, dt);
    rafId = requestAnimationFrame(animate);
  }

  function handleInput() {
    typedChars++;
    heatBoostTarget = Math.min(typedChars / 150, 0.25);
    heatBoost = heatBoostTarget;
    updateLastEdit();
    scheduleRandomEvents();
  }

  function resetTypedChars() {
    typedChars = 0;
    heatBoostTarget = 0;
  }

  function setupEventListeners() {
    root.addEventListener('mouseenter', () => { hover = true; });
    root.addEventListener('mouseleave', () => { hover = false; });

    document.addEventListener('input', e => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
        handleInput();
      }
    });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
          handleInput();
        }
      }
    });

    document.addEventListener('focusout', () => {
      setTimeout(resetTypedChars, 2000);
    });
  }

  function setupBroadcast() {
    try {
      channel = new BroadcastChannel(BROADCAST_KEY);
      channel.onmessage = e => {
        if (e.data?.type === 'update' && e.data?.state) {
          state = e.data.state;
        }
      };
    } catch {}
  }

  function init() {
    state = loadState();
    createDOM();

    setupBroadcast();
    setupEventListeners();

    const container = document.getElementById('ember-slot');
    if (container) {
      container.appendChild(root);
    } else {
      const helpBtn = document.getElementById('btn-help');
      const copyBtn = document.getElementById('btn-copy');
      const anchor = helpBtn || copyBtn;
      if (anchor && anchor.parentNode) {
        const wrapper = document.createElement('span');
        wrapper.id = 'ember-slot';
        wrapper.className = 'ember-slot';
        wrapper.appendChild(root);
        anchor.parentNode.insertBefore(wrapper, anchor);
      }
    }

    spawnPhase = 0;
    spawned = true;
    spawnComplete = false;

    scheduleRandomEvents();
    lastFrame = 0;
    rafId = requestAnimationFrame(animate);
  }

  function destroy() {
    if (rafId) cancelAnimationFrame(rafId);
    if (channel) { try { channel.close(); } catch {} }
  }

  return { init, destroy, updateLastEdit };
})();
