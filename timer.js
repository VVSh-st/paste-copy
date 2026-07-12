'use strict';

/**
 * Square Timer — квадратный таймер с орбитальной дугой по периметру.
 * Анимация 60fps через requestAnimationFrame.
 *
 * Орбита:
 *  - Хвост + головной сегмент + точка-голова
 *  - Путь повторяет border-radius кнопки (скруглённые углы)
 *  - CW/CCW через два разных path (без scaleX)
 *  - Мягкая цветовая температура через тень (последние 5 сек)
 *  - При лимите: дуга скрыта, пульсирует только box-shadow
 *  - Оптимизация в фоне: без mask/glow/filter
 *  - Stacking-анимация при смене цифр (old exits up, new enters down)
 *  - Micro-interactions: сжатие при касании
 *  - Corner glow при прохождении углов
 */

const SquareTimer = (() => {
  const STORAGE_KEY = 'paste-copy-timer';
  const LONG_PRESS_MS = 450;
  const MOVE_THRESHOLD = 10;
  const PULSE_MAX_DURATION = 180000;
  const HEAD_FRAC = 0.10;
  const WARM_START_SEC = 55;
  const MIN_VISIBLE_PROGRESS = 0.003;

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
  let _isBackground = false;

  let _pathCW = null;
  let _pathCCW = null;
  let _radius = null;
  let _resizeObserver = null;

  // Corner glow
  let _cornerGlowActive = false;
  let _firedCorners = new Set();

  // CPU optimization caches
  let _cachedPtsCW = null, _cachedPtsCCW = null;
  let _pts = null;
  let _lastDir = null;
  let _wasWarm = false;
  let _lastTs = 0;

  // Pointerleave reference
  let _onPointerLeave = null;

  // Gesture cancel flag
  let _gestureCancelled = false;

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
    if (btn.offsetWidth === 0 || btn.offsetHeight === 0) return false;
    if (_pathCW == null) {
      _pathCW = _buildPath('cw');
      _cachedPtsCW = _cachePoints(_pathCW);
    }
    if (_pathCCW == null) {
      _pathCCW = _buildPath('ccw');
      _cachedPtsCCW = _cachePoints(_pathCCW);
    }
    return true;
  }
  function _cachePoints(dStr) {
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tmp.setAttribute('d', dStr);
    arcSvg.appendChild(tmp);
    const len = tmp.getTotalLength();
    const N = 400;
    const pts = new Array(N + 1);
    for (let i = 0; i <= N; i++) pts[i] = tmp.getPointAtLength(len * i / N);
    arcSvg.removeChild(tmp);
    return { len, pts, N };
  }

  function _invalidateCaches() {
    _pathCW = null;
    _pathCCW = null;
    _radius = null;
    _cachedPtsCW = null;
    _cachedPtsCCW = null;
    _pts = null;
    _lastDir = null;
  }

  /* ════════════════════════════════════════════════════════════════
     CORNER GLOW
     ════════════════════════════════════════════════════════════════ */

  function _checkCornerGlow(headPos, P) {
    if (_cornerGlowActive) return;

    const corners = [0.25, 0.5, 0.75];
    const threshold = P * 0.008;

    for (const c of corners) {
      const key = c.toString();
      if (_firedCorners.has(key)) continue;
      if (Math.abs(headPos - c * P) < threshold) {
        _firedCorners.add(key);
        _cornerGlowActive = true;
        btn.classList.add('timer-corner-glow');
        setTimeout(() => {
          btn.classList.remove('timer-corner-glow');
          _cornerGlowActive = false;
        }, 500);
        break;
      }
    }

    // Сброс при полном обороте (progress перешёл через 0)
    if (headPos < P * 0.02) {
      _firedCorners.clear();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     INIT / DESTROY
     ════════════════════════════════════════════════════════════════ */

  function init() {
    if (_initialized) return;

    btn         = document.getElementById('btn-timer');
    if (!btn) return;

    _initialized = true;

    _onPointerLeave = e => { if (e.pointerType !== 'mouse') onPointerCancel(e); };
    arcSvg      = btn.querySelector('.timer-arc');
    arcTail     = btn.querySelector('.timer-arc-tail');
    arcHeadSeg  = btn.querySelector('.timer-arc-head-segment');
    arcHeadDot  = btn.querySelector('.timer-arc-head-dot');
    valueEl     = btn.querySelector('.timer-value');
    inputEl     = btn.querySelector('.timer-input');

    _resizeObserver = new ResizeObserver(_invalidateCaches);
    _resizeObserver.observe(btn);

    btn.addEventListener('pointerdown',   onPointerDown);
    btn.addEventListener('pointerup',     onPointerUp);
    btn.addEventListener('pointermove',   onPointerMove);
    btn.addEventListener('pointercancel', onPointerCancel);
    btn.addEventListener('lostpointercapture', onLostCapture);
    btn.addEventListener('pointerleave',  _onPointerLeave);
    btn.addEventListener('contextmenu',   onContextMenu);

    document.addEventListener('visibilitychange', _onVisibilityChange);

    restoreState();
  }

  function destroy() {
    stopTick(); stopPulse(); clearLongPress();
    _pointerDownPos = null; _prevMin = null;
    _longPressFired = false;
    _initialized = false;
    _resizeObserver?.disconnect();
    _resizeObserver = null;
    if (btn) {
      btn.removeEventListener('pointerdown',   onPointerDown);
      btn.removeEventListener('pointerup',     onPointerUp);
      btn.removeEventListener('pointermove',   onPointerMove);
      btn.removeEventListener('pointercancel', onPointerCancel);
      btn.removeEventListener('lostpointercapture', onLostCapture);
      btn.removeEventListener('pointerleave',  _onPointerLeave);
      btn.removeEventListener('contextmenu',   onContextMenu);
    }
    document.removeEventListener('visibilitychange', _onVisibilityChange);
  }

  /* ════════════════════════════════════════════════════════════════
     VISIBILITY OPTIMIZATION (tab background)
     ════════════════════════════════════════════════════════════════ */

  function _onVisibilityChange() {
    _isBackground = document.hidden;

    if (_isBackground) {
      stopTick();
      if (arcTail) arcTail.style.opacity = '';
      if (arcHeadSeg) arcHeadSeg.style.filter = '';
      if (arcHeadDot) arcHeadDot.style.filter = '';
      return;
    }

    if (mode !== null && !pulseIntervalId) {
      startTick();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     POINTER EVENTS + MICRO-INTERACTIONS
     ════════════════════════════════════════════════════════════════ */

  function onPointerDown(e) {
    if (e.button !== 0 || (inputEl && getComputedStyle(inputEl).display !== 'none')) return;
    btn.setPointerCapture?.(e.pointerId);
    _longPressFired = false;
    _gestureCancelled = false;
    _pointerDownPos = { x: e.clientX, y: e.clientY };

    btn.classList.add('timer-pressed');

    _longPressTimer = setTimeout(() => {
      _longPressFired = true;
      btn.classList.remove('timer-pressed');
      btn.classList.add('timer-long-pressed');
      openInlineInput();
    }, LONG_PRESS_MS);
  }

  function onPointerUp(e) {
    if (e.button !== 0) return;
    clearLongPress();
    btn.classList.remove('timer-pressed', 'timer-long-pressed');
    if (btn.hasPointerCapture?.(e.pointerId)) {
      btn.releasePointerCapture(e.pointerId);
    }
    if (_pointerDownPos === null) return;
    _pointerDownPos = null;
    if (_gestureCancelled) { _gestureCancelled = false; return; }
    if (pulseIntervalId) { resetToIdle(); return; }
    if (_longPressFired) { _longPressFired = false; return; }
    if (mode === null) startCountUp();
  }

  function onPointerMove(e) {
    if (!_pointerDownPos || _longPressFired) return;
    const dx = e.clientX - _pointerDownPos.x;
    const dy = e.clientY - _pointerDownPos.y;
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      _gestureCancelled = true;
      clearLongPress();
      btn.classList.remove('timer-pressed');
    }
  }

  function onPointerCancel() {
    clearLongPress();
    _longPressFired = false; _pointerDownPos = null;
    btn.classList.remove('timer-pressed', 'timer-long-pressed');
  }
  function onLostCapture() { onPointerCancel(); }

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
      ctx.resume();
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

  function _pulseRing() {
    const ring = document.createElement('div');
    ring.className = 'timer-pulse-ring';
    btn.appendChild(ring);
    setTimeout(() => ring.remove(), 800);
  }

  function _liquidMorph() {
    btn.classList.remove('timer-liquid-morph');
    void btn.offsetWidth;
    btn.classList.add('timer-liquid-morph');
    setTimeout(() => btn.classList.remove('timer-liquid-morph'), 1200);
  }

  function startCountUp() {
    mode = 'up'; startTs = Date.now(); targetMinutes = null; _prevMin = null;
    btn.classList.remove('timer-idle'); btn.classList.add('timer-active');
    arcSvg.style.display = 'block';
    _pulseRing();
    saveState(); startTick();
  }

  function startCountDown(m) {
    mode = 'down'; startTs = Date.now(); targetMinutes = m; _prevMin = null;
    btn.classList.remove('timer-idle'); btn.classList.add('timer-active');
    closeInlineInput(); arcSvg.style.display = 'block';
    _pulseRing();
    saveState(); startTick();
  }

  function resetToIdle() {
    stopTick(); stopPulse(); clearLongPress();
    _longPressFired = false; _pointerDownPos = null;
    mode = null; startTs = null; targetMinutes = null; _prevMin = null;
    btn.classList.remove('timer-pressed', 'timer-long-pressed');
    saveState(); setIdleVisual();
  }

  /* ════════════════════════════════════════════════════════════════
     rAF LOOP
     ════════════════════════════════════════════════════════════════ */

  function startTick() { stopTick(); _lastTs = 0; rafId = requestAnimationFrame(_tickRAF); }
  function stopTick()  { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }

  function _tickRAF(ts) {
    if (!startTs || mode === null) return;
    if (ts - _lastTs < 33) { rafId = requestAnimationFrame(_tickRAF); return; }
    _lastTs = ts;
    const elapsed = (Date.now() - startTs) / 1000;

    if (mode === 'up') {
      const min = Math.floor(elapsed / 60);
      if (min >= 99) {
        _updateDisplay(99, 1, 'cw');
        onLimitReached();
        return;
      }
      _updateDisplay(min, (elapsed % 60) / 60, 'cw');
    } else {
      const rem = targetMinutes * 60 - Math.floor(elapsed);
      if (rem <= 0) {
        valueEl.textContent = '0';
        onLimitReached();
        return;
      }
      const display = rem < 60 ? rem : Math.ceil(rem / 60);
      _updateDisplay(display, (elapsed % 60) / 60, 'ccw');
    }
    rafId = requestAnimationFrame(_tickRAF);
  }

  function onLimitReached() {
    stopTick();
    _hideArc();
    _flashEffect();
    _liquidMorph();
    if (window.Ember?.notifyEdit) Ember.notifyEdit();
    startPulse();
  }

  /* ════════════════════════════════════════════════════════════════
     PULSE (после лимита — только тень)
     ════════════════════════════════════════════════════════════════ */

  function startPulse() {
    if (pulseIntervalId) return;
    pulseStartTime = Date.now();
    btn.classList.add('timer-pulsing');
    valueEl.classList.add('timer-digit-pulse-active');
    pulseIntervalId = setInterval(() => {
      const elapsed = Date.now() - pulseStartTime;
      if (elapsed >= PULSE_MAX_DURATION - 30000) {
        valueEl.classList.remove('timer-digit-pulse-active');
        valueEl.classList.add('timer-digit-pulse-urgent');
      }
      if (elapsed >= PULSE_MAX_DURATION) {
        stopPulse();
        mode === 'up' ? (_playCompletionSound(), _startAutoCountdown()) : resetToIdle();
      }
    }, 1000);
  }

  function stopPulse() {
    btn.classList.remove('timer-pulsing');
    valueEl.classList.remove('timer-digit-pulse-active', 'timer-digit-pulse-urgent');
    if (pulseIntervalId) { clearInterval(pulseIntervalId); pulseIntervalId = null; }
  }

  function _startAutoCountdown() {
    mode = 'down'; startTs = Date.now(); targetMinutes = 99; _prevMin = null;
    arcSvg.style.display = 'block';
    saveState(); startTick();
  }

  /* ════════════════════════════════════════════════════════════════
     DISPLAY (stacking animation)
     ════════════════════════════════════════════════════════════════ */

  function _updateDisplay(minutes, progress, dir) {
    valueEl.style.display = 'flex';
    valueEl.classList.remove('timer-value-dim');

    if (_prevMin !== null && minutes !== _prevMin) {
      // Удаляем предыдущие overlay-элементы
      valueEl.parentNode.querySelectorAll('.timer-digit-old').forEach(el => el.remove());

      // Stacking: старая цифра уезжает вверх с blur, новая въезжает снизу
      const oldEl = document.createElement('div');
      oldEl.className = 'timer-digit-old';
      oldEl.textContent = _prevMin;
      oldEl.style.cssText = getComputedStyle(valueEl).cssText;
      oldEl.style.position = 'absolute';
      oldEl.style.inset = '0';
      oldEl.style.display = 'flex';
      oldEl.style.alignItems = 'center';
      oldEl.style.justifyContent = 'center';

      valueEl.parentNode.style.position = 'relative';
      valueEl.parentNode.appendChild(oldEl);

      valueEl.textContent = minutes;
      void valueEl.offsetWidth;
      valueEl.classList.add('timer-digit-enter');
      oldEl.classList.add('timer-digit-old-exit');

      setTimeout(() => {
        oldEl.remove();
        valueEl.classList.remove('timer-digit-enter');
      }, 400);
    } else {
      valueEl.textContent = minutes;
    }
    _prevMin = minutes;

    _applyArc(progress, dir);
  }

  /* ── цветовая температура (мягкая тень) ── */

  function _applyWarmGlow(progress) {
    if (_isBackground) return;
    const warm = progress >= (WARM_START_SEC / 60);
    if (warm !== _wasWarm) {
      btn.classList.toggle('timer-warm', warm);
      _wasWarm = warm;
    }
  }

  /* ── основная отрисовка дуги ── */

  function _applyArc(progress, dir) {
    if (!arcTail) return;
    arcSvg.style.display = 'block';

    if (!_ensurePaths()) return;
    const d = dir === 'cw' ? _pathCW : _pathCCW;
    if (!d) return;

    if (_lastDir !== dir) {
      arcTail.setAttribute('d', d);
      arcHeadSeg.setAttribute('d', d);
      arcTail.style.opacity = '0.55';
      _lastDir = dir;
      _pts = dir === 'cw' ? _cachedPtsCW : _cachedPtsCCW;
    }

    const P = _pts.len;

    const visualProgress = Math.max(progress, MIN_VISIBLE_PROGRESS);
    const headPos = visualProgress * P;

    // Хвост
    arcTail.style.display = '';
    arcTail.style.strokeDasharray  = headPos + ' ' + P;
    arcTail.style.strokeDashoffset = '0';

    // Головной сегмент
    const hLen = Math.min(headPos, P * HEAD_FRAC);
    arcHeadSeg.style.display = '';
    arcHeadSeg.style.strokeDasharray  = hLen + ' ' + P;
    arcHeadSeg.style.strokeDashoffset = -(headPos - hLen);

    // Точка-голова (из кэша вместо getPointAtLength)
    if (_pts) {
      const idx = Math.min(_pts.N, Math.floor(visualProgress * _pts.N));
      const pt = _pts.pts[idx];
      arcHeadDot.style.display = '';
      arcHeadDot.setAttribute('cx', pt.x);
      arcHeadDot.setAttribute('cy', pt.y);
      arcHeadDot.setAttribute('r', '2');

      // Corner glow
      _checkCornerGlow(headPos, P);
    }

    _applyWarmGlow(progress);
  }

  function _hideArc() {
    if (arcTail)    { arcTail.style.display = 'none'; arcTail.style.opacity = ''; }
    if (arcHeadSeg) arcHeadSeg.style.display = 'none';
    if (arcHeadDot) arcHeadDot.style.display = 'none';
    if (_cornerGlowActive) {
      btn.classList.remove('timer-corner-glow');
      _cornerGlowActive = false;
    }
    if (_wasWarm) { btn.classList.remove('timer-warm'); _wasWarm = false; }
  }

  /* ── idle ── */

  function setIdleVisual() {
    _prevMin = null;
    valueEl.classList.remove('timer-digit-animate', 'timer-digit-enter', 'timer-value-pulse');
    void valueEl.offsetWidth;
    valueEl.style.display = 'flex'; valueEl.textContent = '0'; valueEl.classList.add('timer-value-dim');

    if (inputEl) {
      inputEl.style.display = 'none';
      inputEl.value = '';
      inputEl.onblur = inputEl.onkeydown = inputEl.onclick = inputEl.onmousedown = null;
    }

    arcSvg.style.display = 'none'; arcSvg.style.opacity = '';
    _hideArc();
    arcTail.style.stroke = '';  arcTail.style.opacity = '';
    arcHeadSeg.style.stroke = ''; arcHeadSeg.style.filter = '';
    arcHeadDot.style.fill = '';  arcHeadDot.style.filter = '';

    btn.classList.remove('timer-pulsing', 'timer-active', 'timer-pressed', 'timer-long-pressed');
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
      if (s.mode === 'up' && Math.floor(elapsed / 60) >= 99) { safeSet(STORAGE_KEY, ''); setIdleVisual(); return; }
      if (s.mode === 'down' && s.targetMinutes * 60 - Math.floor(elapsed) <= 0) { safeSet(STORAGE_KEY, ''); setIdleVisual(); return; }
      mode = s.mode; startTs = s.startTs; targetMinutes = s.targetMinutes; _prevMin = null;
      btn.classList.remove('timer-idle'); btn.classList.add('timer-active');
      arcSvg.style.display = 'block'; startTick();
    } catch (e) { console.warn('[SquareTimer] restore:', e); safeSet(STORAGE_KEY, ''); setIdleVisual(); }
  }

  return { init, destroy };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SquareTimer.init());
} else { SquareTimer.init(); }
