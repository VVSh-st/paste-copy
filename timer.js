'use strict';

/**
 * Square Timer — квадратный таймер с орбитальной дугой по периметру.
 * Анимация 60fps через requestAnimationFrame.
 *
 * Орбита:
 *  - Хвост (opacity 0.35) + головной сегмент (opacity 1 + glow) + точка-голова
 *  - Путь повторяет border-radius кнопки (скруглённые углы)
 *  - CW/CCW через два разных path (без scaleX)
 *  - Плавный fade на стыке минут (smoothstep)
 *  - Мягкая цветовая температура через тень (последние 5 сек)
 *  - При лимите: дуга скрыта, пульсирует только box-shadow
 */

const SquareTimer = (() => {
  const STORAGE_KEY = 'paste-copy-timer';
  const LONG_PRESS_MS = 450;
  const MOVE_THRESHOLD = 10;
  const PULSE_MAX_DURATION = 180000;
  const HEAD_FRAC = 0.10;
  const FADE_SECS = 1.2;
  const WARM_START_SEC = 55;

  let _initialized = false;
  let btn, arcSvg, arcTail, arcHeadSeg, arcHeadDot, valueEl, inputEl;
  let mode = null;
  let startTs = null;
  let targetMinutes = null;
  let rafId = null;
  let pulseIntervalId = null;
  let pulseStartTime = null;
  let _longPressFired = false;
  let _pointerDownPos = null;
  let _longPressTimer = null;
  let _prevMin = null;

  let _pathCW = null;
  let _pathCCW = null;
  let _perim = null;
  let _radius = null;

  /* ════════════════════════════════════════════════════════════════
     ПЕРИМЕТР: путь с дугами в углах (повторяет border-radius)
     ════════════════════════════════════════════════════════════════ */

  function _readRadius() {
    const v = parseFloat(getComputedStyle(btn).borderRadius);
    _radius = isNaN(v) ? 6 : v;
  }

  function _buildPath(dir) {
    const w = btn.offsetWidth;
    const h = btn.offsetHeight;
    const hw = w / 2;
    const r  = Math.min(_radius, w / 2, h / 2);

    const s = dir === 'cw';

    return [
      `M ${hw},0`,
      s ? `L ${w - r},0`            : `L ${r},0`,
      s ? `A ${r},${r},0,0,1 ${w},${r}`
        : `A ${r},${r},0,0,0 0,${r}`,
      s ? `L ${w},${h - r}`         : `L 0,${h - r}`,
      s ? `A ${r},${r},0,0,1 ${w - r},${h}`
        : `A ${r},${r},0,0,0 ${r},${h}`,
      s ? `L ${r},${h}`             : `L ${w - r},${h}`,
      s ? `A ${r},${r},0,0,1 0,${h - r}`
        : `A ${r},${r},0,0,0 ${w},${h - r}`,
      s ? `L 0,${r}`               : `L ${w},${r}`,
      s ? `A ${r},${r},0,0,1 ${r},0`
        : `A ${r},${r},0,0,0 ${w - r},0`,
      `Z`
    ].join(' ');
  }

  function _ensurePaths() {
    if (_radius == null) _readRadius();
    if (_pathCW == null)  _pathCW  = _buildPath('cw');
    if (_pathCCW == null) _pathCCW = _buildPath('ccw');
  }

  function _invalidateCaches() {
    _perim = null;
    _pathCW = null;
    _pathCCW = null;
    _radius = null;
  }

  /* ════════════════════════════════════════════════════════════════
     INIT / DESTROY
     ════════════════════════════════════════════════════════════════ */

  function init() {
    if (_initialized) return;
    _initialized = true;

    btn         = document.getElementById('btn-timer');
    if (!btn) return;
    arcSvg      = btn.querySelector('.timer-arc');
    arcTail     = btn.querySelector('.timer-arc-tail');
    arcHeadSeg  = btn.querySelector('.timer-arc-head-segment');
    arcHeadDot  = btn.querySelector('.timer-arc-head-dot');
    valueEl     = btn.querySelector('.timer-value');
    inputEl     = btn.querySelector('.timer-input');

    new ResizeObserver(_invalidateCaches).observe(btn);

    btn.addEventListener('pointerdown',   onPointerDown);
    btn.addEventListener('pointerup',     onPointerUp);
    btn.addEventListener('pointermove',   onPointerMove);
    btn.addEventListener('pointercancel', onPointerCancel);
    btn.addEventListener('lostpointercapture', onLostCapture);
    btn.addEventListener('pointerleave',  e => { if (e.pointerType !== 'mouse') onPointerCancel(e); });
    btn.addEventListener('contextmenu',   onContextMenu);

    restoreState();
  }

  function destroy() {
    stopTick(); stopPulse(); clearLongPress();
    _pointerDownPos = null; _prevMin = null; _longPressFired = false;
    if (btn) {
      btn.removeEventListener('pointerdown',   onPointerDown);
      btn.removeEventListener('pointerup',     onPointerUp);
      btn.removeEventListener('pointermove',   onPointerMove);
      btn.removeEventListener('pointercancel', onPointerCancel);
      btn.removeEventListener('lostpointercapture', onLostCapture);
      btn.removeEventListener('contextmenu',   onContextMenu);
    }
  }

  /* ════════════════════════════════════════════════════════════════
     POINTER EVENTS
     ════════════════════════════════════════════════════════════════ */

  function onPointerDown(e) {
    if (e.button !== 0 || inputEl.style.display !== 'none') return;
    _longPressFired = false;
    _pointerDownPos = { x: e.clientX, y: e.clientY };
    _longPressTimer = setTimeout(() => { _longPressFired = true; openInlineInput(); }, LONG_PRESS_MS);
  }

  function onPointerUp(e) {
    if (e.button !== 0) return;
    clearLongPress();
    if (_pointerDownPos === null) return;
    _pointerDownPos = null;
    if (pulseIntervalId) { resetToIdle(); return; }
    if (_longPressFired) { _longPressFired = false; return; }
    if (mode === null) startCountUp();
  }

  function onPointerMove(e) {
    if (!_pointerDownPos || _longPressFired) return;
    const dx = e.clientX - _pointerDownPos.x;
    const dy = e.clientY - _pointerDownPos.y;
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD) clearLongPress();
  }

  function onPointerCancel() { clearLongPress(); _longPressFired = false; _pointerDownPos = null; }
  function onLostCapture()   { onPointerCancel(); }

  function clearLongPress() {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  }

  function onContextMenu(e) {
    if (mode !== null || pulseIntervalId) { e.preventDefault(); resetToIdle(); }
  }

  /* ════════════════════════════════════════════════════════════════
     INLINE INPUT
     ════════════════════════════════════════════════════════════════ */

  function openInlineInput() {
    if (mode !== null) return;
    valueEl.style.display = 'none';
    inputEl.style.display = '';
    inputEl.value = '';
    inputEl.focus();
    inputEl.onclick = ev => ev.stopPropagation();
    inputEl.onmousedown = ev => ev.stopPropagation();
    inputEl.onblur = () => {
      const v = Number.parseInt(inputEl.value, 10);
      (Number.isFinite(v) && v >= 1 && v <= 99) ? startCountDown(v) : closeInlineInput();
    };
    inputEl.onkeydown = ev => {
      if (ev.key === 'Enter')  { ev.preventDefault(); inputEl.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); inputEl.value = ''; inputEl.blur(); }
      ev.stopPropagation();
    };
  }

  function closeInlineInput() {
    inputEl.value = '';
    inputEl.style.display = 'none';
    inputEl.onblur = inputEl.onkeydown = inputEl.onclick = inputEl.onmousedown = null;
    mode ? (valueEl.style.display = 'flex', valueEl.classList.remove('timer-value-dim')) : setIdleVisual();
  }

  /* ════════════════════════════════════════════════════════════════
     SOUND
     ════════════════════════════════════════════════════════════════ */

  function _playCompletionSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + i * .12);
        g.gain.linearRampToValueAtTime(.12, t0 + i * .12 + .08);
        g.gain.exponentialRampToValueAtTime(.001, t0 + i * .12 + .6);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + i * .12); o.stop(t0 + i * .12 + .7);
      });
      setTimeout(() => ctx.close(), 2000);
    } catch (e) { console.warn('[SquareTimer] Sound:', e); }
  }

  /* ════════════════════════════════════════════════════════════════
     TIMER LOGIC
     ════════════════════════════════════════════════════════════════ */

  function _flashEffect() {
    btn.classList.remove('timer-flash');
    void btn.offsetWidth;
    btn.classList.add('timer-flash');
    setTimeout(() => btn.classList.remove('timer-flash'), 1500);
  }

  function startCountUp() {
    mode = 'up'; startTs = Date.now(); targetMinutes = null; _prevMin = null;
    btn.classList.remove('timer-idle'); btn.classList.add('timer-active');
    arcSvg.style.display = 'block';
    saveState(); startTick();
  }

  function startCountDown(m) {
    mode = 'down'; startTs = Date.now(); targetMinutes = m; _prevMin = null;
    btn.classList.remove('timer-idle'); btn.classList.add('timer-active');
    closeInlineInput(); arcSvg.style.display = 'block';
    saveState(); startTick();
  }

  function resetToIdle() {
    stopTick(); stopPulse(); clearLongPress();
    _longPressFired = false; _pointerDownPos = null;
    mode = null; startTs = null; targetMinutes = null; _prevMin = null;
    saveState(); setIdleVisual();
  }

  /* ════════════════════════════════════════════════════════════════
     rAF LOOP
     ════════════════════════════════════════════════════════════════ */

  function startTick() { stopTick(); rafId = requestAnimationFrame(_tickRAF); }
  function stopTick()  { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }

  function _tickRAF() {
    if (!startTs || mode === null) return;
    const elapsed = (Date.now() - startTs) / 1000;

    if (mode === 'up') {
      const min = Math.floor(elapsed / 60);
      if (min >= 99) { onLimitReached(); return; }
      _updateDisplay(min, (elapsed % 60) / 60, 'cw');
    } else {
      const rem = targetMinutes * 60 - Math.floor(elapsed);
      if (rem <= 0) { onLimitReached(); return; }
      _updateDisplay(Math.floor(rem / 60), (elapsed % 60) / 60, 'ccw');
    }
    rafId = requestAnimationFrame(_tickRAF);
  }

  function onLimitReached() {
    stopTick();
    _hideArc();
    _flashEffect();
    if (window.Ember?.notifyEdit) Ember.notifyEdit();
    startPulse();
  }

  /* ════════════════════════════════════════════════════════════════
     PULSE (после лимита — только тень)
     ════════════════════════════════════════════════════════════════ */

  function startPulse() {
    pulseStartTime = Date.now();
    btn.classList.add('timer-pulsing');
    pulseIntervalId = setInterval(() => {
      if (Date.now() - pulseStartTime >= PULSE_MAX_DURATION) {
        stopPulse();
        mode === 'up' ? (_playCompletionSound(), _startAutoCountdown()) : resetToIdle();
      }
    }, 1000);
  }

  function stopPulse() {
    btn.classList.remove('timer-pulsing');
    if (pulseIntervalId) { clearInterval(pulseIntervalId); pulseIntervalId = null; }
  }

  function _startAutoCountdown() {
    mode = 'down'; startTs = Date.now(); targetMinutes = 99; _prevMin = null;
    arcSvg.style.display = 'block';
    saveState(); startTick();
  }

  /* ════════════════════════════════════════════════════════════════
     DISPLAY
     ════════════════════════════════════════════════════════════════ */

  function _updateDisplay(minutes, progress, dir) {
    valueEl.style.display = 'flex';
    valueEl.classList.remove('timer-value-dim');
    if (_prevMin !== null && minutes !== _prevMin) {
      valueEl.textContent = minutes;
      void valueEl.offsetWidth;
      valueEl.classList.add('timer-digit-animate');
    } else {
      valueEl.textContent = minutes;
    }
    _prevMin = minutes;

    _applyArc(progress, dir);
  }

  /* ── opacity fade на стыке минут (smoothstep) ── */

  function _arcOpacity(progress) {
    const fade = FADE_SECS / 60;
    if (progress <= 0 || progress >= 1) return 0;
    if (progress < fade) {
      const t = progress / fade;
      return t * t * (3 - 2 * t);
    }
    if (progress > 1 - fade) {
      const t = (1 - progress) / fade;
      return t * t * (3 - 2 * t);
    }
    return 1;
  }

  /* ── цветовая температура (мягкая тень) ── */

  function _applyWarmGlow(progress) {
    const ws = WARM_START_SEC / 60;
    if (progress < ws) {
      arcHeadSeg.style.filter = '';
      arcHeadDot.style.filter = '';
      return;
    }
    const t = (progress - ws) / (1 - ws);
    const op = (t * 0.22).toFixed(3);
    const r  = (1 + t * 4).toFixed(1);
    const f  = [
      'drop-shadow(0 0 2px rgba(79,142,247,0.5))',
      `drop-shadow(0 0 ${r}px rgba(255,200,80,${op}))`
    ].join(' ');
    arcHeadSeg.style.filter = f;
    arcHeadDot.style.filter = f;
  }

  /* ── основная отрисовка дуги ── */

  function _applyArc(progress, dir) {
    if (!arcTail) return;
    arcSvg.style.display = 'block';

    _ensurePaths();
    const d = dir === 'cw' ? _pathCW : _pathCCW;
    if (!d) return;

    arcTail.setAttribute('d', d);
    arcHeadSeg.setAttribute('d', d);

    if (_perim == null) _perim = arcTail.getTotalLength();
    const P = _perim;

    arcSvg.style.opacity = _arcOpacity(progress);

    if (progress < 0.001) {
      _hideArc();
      _applyWarmGlow(progress);
      return;
    }

    const vis = progress * P;

    arcTail.style.display = '';
    arcTail.style.strokeDasharray  = vis + ' ' + P;
    arcTail.style.strokeDashoffset = '0';

    const hLen = Math.min(vis, P * HEAD_FRAC);
    arcHeadSeg.style.display = '';
    arcHeadSeg.style.strokeDasharray  = hLen + ' ' + P;
    arcHeadSeg.style.strokeDashoffset = -(vis - hLen);

    const pt = arcTail.getPointAtLength(vis);
    arcHeadDot.style.display = '';
    arcHeadDot.setAttribute('cx', pt.x);
    arcHeadDot.setAttribute('cy', pt.y);

    _applyWarmGlow(progress);
  }

  function _hideArc() {
    if (arcTail)    arcTail.style.display    = 'none';
    if (arcHeadSeg) arcHeadSeg.style.display = 'none';
    if (arcHeadDot) arcHeadDot.style.display = 'none';
  }

  /* ── idle ── */

  function setIdleVisual() {
    _prevMin = null;
    valueEl.classList.remove('timer-digit-animate');
    void valueEl.offsetWidth;
    valueEl.style.display = 'flex';
    valueEl.textContent = '0';
    valueEl.classList.add('timer-value-dim');

    arcSvg.style.display = 'none';
    arcSvg.style.opacity = '';
    _hideArc();
    arcTail.style.stroke = '';    arcHeadSeg.style.stroke = '';    arcHeadDot.style.fill = '';
    arcHeadSeg.style.filter = ''; arcHeadDot.style.filter = '';

    btn.classList.remove('timer-pulsing', 'timer-active');
    btn.classList.add('timer-idle');
  }

  /* ════════════════════════════════════════════════════════════════
     PERSISTENCE
     ════════════════════════════════════════════════════════════════ */

  const safeSet = (k, v) => { try { Storage._set(k, v); } catch (e) { console.warn('[SquareTimer]', e); } };

  function saveState() {
    if (mode === null) { safeSet(STORAGE_KEY, ''); return; }
    safeSet(STORAGE_KEY, JSON.stringify({ mode, startTs, targetMinutes }));
  }

  function restoreState() {
    try {
      const raw = Storage._get(STORAGE_KEY);
      if (!raw) { setIdleVisual(); return; }
      const s = JSON.parse(raw);
      if (!s || (s.mode !== 'up' && s.mode !== 'down') || typeof s.startTs !== 'number' || s.startTs <= 0) {
        safeSet(STORAGE_KEY, ''); setIdleVisual(); return;
      }
      if (s.mode === 'down' && (typeof s.targetMinutes !== 'number' || s.targetMinutes < 1 || s.targetMinutes > 99)) {
        safeSet(STORAGE_KEY, ''); setIdleVisual(); return;
      }
      const elapsed = (Date.now() - s.startTs) / 1000;
      if (s.mode === 'up') {
        if (Math.floor(elapsed / 60) >= 99) { safeSet(STORAGE_KEY, ''); setIdleVisual(); return; }
      } else {
        if (s.targetMinutes * 60 - Math.floor(elapsed) <= 0) { safeSet(STORAGE_KEY, ''); setIdleVisual(); return; }
      }
      mode = s.mode; startTs = s.startTs; targetMinutes = s.targetMinutes; _prevMin = null;
      arcSvg.style.display = 'block';
      startTick();
    } catch (e) {
      console.warn('[SquareTimer] restore:', e);
      safeSet(STORAGE_KEY, ''); setIdleVisual();
    }
  }

  return { init, destroy };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SquareTimer.init());
} else {
  SquareTimer.init();
}
