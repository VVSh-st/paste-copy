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
  const MOVE_THRESHOLD_SQ = MOVE_THRESHOLD * MOVE_THRESHOLD;
  const PULSE_MAX_DURATION = 180000;
  const HEAD_FRAC = 0.10;
  const MIN_VISIBLE_PROGRESS = 0.003;
  const COMPLETION_FREQS = [523.25, 659.25, 783.99];

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
  let _resizeRaf = null;

  // Corner glow
  let _cornerGlowActive = false;

  // CPU optimization caches
  let _cachedPtsCW = null, _cachedPtsCCW = null;
  let _pts = null;
  let _lastDir = null;
  let _wasWarm = false;
  let _lastTs = 0;
  let _nextCornerIdx = 0;

  // Arc frame cache (safe: reset on wrap/dir change/reset)
  let _lastProgress = null;
  let _lastHeadSegDasharray = null;
  let _arcStaticsApplied = false;

  function _resetArcFrameCache() {
    _lastProgress = null;
    _lastHeadSegDasharray = null;
    _arcStaticsApplied = false;
  }

  // Digit animation timer (cancel previous to avoid race on fast changes)
  let _digitAnimationTimer = null;
  let _oldDigitEl = null;
  let _pulseUrgentApplied = false;

  // Corner glow timer
  let _cornerGlowTimer = null;

  // Pause state
  let _pausedAt = null;
  let _pausedElapsed = 0;

  // Pointerleave reference
  let _onPointerLeave = null;

  // Gesture cancel flag
  let _gestureCancelled = false;

  // Shared AudioContext (создаётся при первом user-gesture)
  let _audioCtx = null;

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
    if (_pathCW !== null && _pathCCW !== null && _cachedPtsCW !== null && _cachedPtsCCW !== null) {
      return true;
    }
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
    if (!_initialized) return;
    if (_resizeRaf) return;
    _resizeRaf = requestAnimationFrame(() => {
      if (!_initialized) { _resizeRaf = null; return; }
      _resizeRaf = null;
      _pathCW = null;
      _pathCCW = null;
      _radius = null;
      _cachedPtsCW = null;
      _cachedPtsCCW = null;
      _pts = null;
      _lastDir = null;
      _nextCornerIdx = 0;
      _resetArcFrameCache();
    });
  }

  /* ════════════════════════════════════════════════════════════════
     CORNER GLOW
     ════════════════════════════════════════════════════════════════ */

  const _CORNER_POSITIONS = [0.25, 0.5, 0.75];

  function _endCornerGlow() {
    btn.classList.remove('timer-corner-glow');
    _cornerGlowActive = false;
    _cornerGlowTimer = null;
  }

  function _checkCornerGlow(headPos, P) {
    if (_cornerGlowActive) return;

    const threshold = P * 0.02;

    // Check only the next expected corner
    if (_nextCornerIdx < _CORNER_POSITIONS.length) {
      const c = _CORNER_POSITIONS[_nextCornerIdx];
      const targetPos = c * P;

      if (headPos >= targetPos - threshold && headPos <= targetPos + threshold) {
        _cornerGlowActive = true;
        btn.classList.add('timer-corner-glow');
        if (_cornerGlowTimer !== null) clearTimeout(_cornerGlowTimer);
        _cornerGlowTimer = setTimeout(_endCornerGlow, 500);
        _nextCornerIdx++;
      }
    }

    // Reset on full revolution
    if (headPos < P * 0.02) {
      _nextCornerIdx = 0;
    }
  }

  /* ════════════════════════════════════════════════════════════════
     INIT / DESTROY
     ════════════════════════════════════════════════════════════════ */

  function init() {
    if (_initialized) return;

    btn         = document.getElementById('btn-timer');
    if (!btn) return;

    _onPointerLeave = e => { if (e.pointerType !== 'mouse') onPointerCancel(e); };
    arcSvg      = btn.querySelector('.timer-arc');
    arcTail     = btn.querySelector('.timer-arc-tail');
    arcHeadSeg  = btn.querySelector('.timer-arc-head-segment');
    arcHeadDot  = btn.querySelector('.timer-arc-head-dot');
    valueEl     = btn.querySelector('.timer-value');
    inputEl     = btn.querySelector('.timer-input');

    if (!arcSvg || !arcTail || !arcHeadSeg || !arcHeadDot || !valueEl) {
      console.warn('[SquareTimer] Required timer elements are missing');
      btn = null;
      return;
    }

    _initialized = true;
    if (valueEl?.parentNode) valueEl.parentNode.style.position = 'relative';

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
    _clearDigitAnimation();
    _clearCornerGlow();
    _pointerDownPos = null; _prevMin = null;
    _longPressFired = false;
    _initialized = false;
    mode = null; startTs = null; targetMinutes = null;
    _pausedAt = null; _pausedElapsed = 0;
    _lastDir = null; _pts = null;
    _nextCornerIdx = 0;
    _resetArcFrameCache();
    _resizeObserver?.disconnect();
    _resizeObserver = null;
    if (_resizeRaf) { cancelAnimationFrame(_resizeRaf); _resizeRaf = null; }
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
    btn = null; arcSvg = null; arcTail = null; arcHeadSeg = null; arcHeadDot = null;
    valueEl = null; inputEl = null;
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

    if (mode !== null && _pausedAt === null && !pulseIntervalId) {
      startTick();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     POINTER EVENTS + MICRO-INTERACTIONS
     ════════════════════════════════════════════════════════════════ */

  function onPointerDown(e) {
    if (e.button !== 0 || (inputEl && inputEl.style.display !== 'none' && inputEl.style.display !== '')) return;
    if (!_audioCtx) try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    btn.setPointerCapture?.(e.pointerId);
    _longPressFired = false;
    _gestureCancelled = false;
    _pointerDownPos = { x: e.clientX, y: e.clientY };

    btn.classList.add('timer-pressed');

    _longPressTimer = setTimeout(() => {
      _longPressFired = true;
      btn.classList.remove('timer-pressed');
      btn.classList.add('timer-long-pressed');
      if (navigator.vibrate) navigator.vibrate(10);
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
    if (mode === 'up' || mode === 'down') {
      if (_pausedAt !== null) resumeTimer(); else pauseTimer();
      return;
    }
    if (mode === null) startCountUp();
  }

  function onPointerMove(e) {
    if (!_pointerDownPos || _longPressFired) return;
    const dx = e.clientX - _pointerDownPos.x;
    const dy = e.clientY - _pointerDownPos.y;
    if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) {
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

  function _stopInputEvent(ev) { ev.stopPropagation(); }

  function _onInputBlur() {
    const v = Number.parseInt(inputEl.value, 10);
    if (Number.isFinite(v) && v >= 1 && v <= 99) {
      startCountDown(v);
    } else {
      inputEl.classList.add('timer-input-error');
      setTimeout(() => { inputEl.classList.remove('timer-input-error'); closeInlineInput(); }, 400);
    }
  }

  function _onInputKeydown(ev) {
    if (ev.key === 'Enter')  { ev.preventDefault(); inputEl.blur(); }
    if (ev.key === 'Escape') { ev.preventDefault(); inputEl.value = ''; inputEl.blur(); }
    ev.stopPropagation();
  }

  function openInlineInput() {
    if (mode !== null) return;
    valueEl.style.display = 'none';
    inputEl.style.display = '';
    inputEl.value = '';
    inputEl.focus();
    inputEl.onclick = _stopInputEvent;
    inputEl.onmousedown = _stopInputEvent;
    inputEl.onblur = _onInputBlur;
    inputEl.onkeydown = _onInputKeydown;
  }

  function closeInlineInput() {
    inputEl.value = '';
    inputEl.style.display = 'none';
    inputEl.onblur = inputEl.onkeydown = inputEl.onclick = inputEl.onmousedown = null;
    if (mode) {
      valueEl.style.display = 'flex';
      valueEl.classList.remove('timer-value-dim');
    } else {
      setIdleVisual();
    }
  }

  /* ════════════════════════════════════════════════════════════════
     SOUND
     ════════════════════════════════════════════════════════════════ */

  function _playCompletionSound() {
    if (!_audioCtx) return;
    try {
      if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
      const ctx = _audioCtx;
      const t0 = ctx.currentTime;
      for (let i = 0; i < COMPLETION_FREQS.length; i++) {
        const f = COMPLETION_FREQS[i];
        const t = t0 + i * 0.12;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.7);
      }
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
    mode = 'up'; startTs = Date.now();
    targetMinutes = null; _prevMin = null;
    btn.classList.remove('timer-idle'); btn.classList.add('timer-active');
    arcSvg.style.display = 'block';
    _pulseRing();
    saveState(); startTick();
  }

  function startCountDown(m) {
    mode = 'down'; startTs = Date.now();
    targetMinutes = m; _prevMin = null;
    btn.classList.remove('timer-idle'); btn.classList.add('timer-active');
    closeInlineInput(); arcSvg.style.display = 'block';
    _pulseRing();
    saveState(); startTick();
  }

  function _resetRenderState() {
    _lastDir = null;
    _pts = null;
    _nextCornerIdx = 0;
    _resetArcFrameCache();
    _pausedAt = null;
    _pausedElapsed = 0;
    _clearDigitAnimation();
    _clearCornerGlow();
    valueEl?.classList.remove('timer-urgent');
  }

  function _clearDigitAnimation() {
    if (_digitAnimationTimer !== null) {
      clearTimeout(_digitAnimationTimer);
      _digitAnimationTimer = null;
    }
    if (_oldDigitEl) { _oldDigitEl.remove(); _oldDigitEl = null; }
    valueEl?.classList.remove('timer-digit-enter');
  }

  function _clearCornerGlow() {
    if (_cornerGlowTimer !== null) {
      clearTimeout(_cornerGlowTimer);
      _cornerGlowTimer = null;
    }
    btn?.classList.remove('timer-corner-glow');
    _cornerGlowActive = false;
  }

  function resetToIdle() {
    stopTick(); stopPulse(); clearLongPress();
    _longPressFired = false; _pointerDownPos = null;
    mode = null; startTs = null; targetMinutes = null; _prevMin = null;
    _resetRenderState();
    btn.classList.remove('timer-pressed', 'timer-long-pressed', 'timer-paused');
    btn.removeAttribute('aria-label');
    saveState(); setIdleVisual();
  }

  function pauseTimer() {
    if (mode === null || _pausedAt !== null) return;
    _pausedAt = Date.now();
    _pausedElapsed = _pausedAt - startTs;
    stopTick();
    _hideArc();
    btn.classList.add('timer-paused');
    btn.setAttribute('aria-label', 'Таймер на паузе');
    saveState();
  }

  function resumeTimer() {
    if (mode === null || _pausedAt === null) return;
    startTs = Date.now() - _pausedElapsed;
    _pausedAt = null;
    _lastDir = null;
    _prevMin = null;
    _resetArcFrameCache();
    btn.classList.remove('timer-paused');
    btn.removeAttribute('aria-label');
    saveState();
    startTick();
  }

  /* ════════════════════════════════════════════════════════════════
     rAF LOOP
     ════════════════════════════════════════════════════════════════ */

  function startTick() { stopTick(); _lastTs = 0; rafId = requestAnimationFrame(_tickRAF); }
  function stopTick()  { if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }

  function _tickRAF(ts) {
    if (mode === null || _pausedAt !== null) { rafId = null; return; }
    if (ts - _lastTs < 33) { rafId = requestAnimationFrame(_tickRAF); return; }
    _lastTs = ts;
    const elapsed = (Date.now() - startTs) / 1000;

    if (mode === 'up') {
      const min = Math.floor(elapsed / 60);
      if (min >= 99) {
        _updateDisplay(99, 1, 'cw', false);
        onLimitReached();
        return;
      }
      _updateDisplay(min, (elapsed % 60) / 60, 'cw', false);
    } else {
      const rem = targetMinutes * 60 - Math.floor(elapsed);
      if (rem <= 0) {
        valueEl.textContent = '0';
        onLimitReached();
        return;
      }
      const display = rem < 60 ? rem : Math.ceil(rem / 60);
      _updateDisplay(display, (elapsed % 60) / 60, 'ccw', rem <= 5);
      valueEl?.classList.toggle('timer-urgent', rem <= 10 && rem > 0);
    }
    rafId = requestAnimationFrame(_tickRAF);
  }

  function onLimitReached() {
    stopTick();
    _resetRenderState();
    _hideArc();
    _flashEffect();
    _liquidMorph();
    if (navigator.vibrate) navigator.vibrate([60, 50, 60, 50, 120]);
    if (window.Ember?.notifyEdit) Ember.notifyEdit();
    startPulse();
  }

  /* ════════════════════════════════════════════════════════════════
     PULSE (после лимита — только тень)
     ════════════════════════════════════════════════════════════════ */

  function startPulse() {
    if (pulseIntervalId) return;
    pulseStartTime = Date.now();
    _pulseUrgentApplied = false;
    btn.classList.add('timer-pulsing');
    valueEl.classList.add('timer-digit-pulse-active');
    pulseIntervalId = setInterval(() => {
      const elapsed = Date.now() - pulseStartTime;
      if (!_pulseUrgentApplied && elapsed >= PULSE_MAX_DURATION - 30000) {
        _pulseUrgentApplied = true;
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
    _pulseUrgentApplied = false;
    if (pulseIntervalId) { clearInterval(pulseIntervalId); pulseIntervalId = null; }
  }

  function _startAutoCountdown() {
    mode = 'down'; startTs = Date.now();
    targetMinutes = 99; _prevMin = null;
    arcSvg.style.display = 'block';
    saveState(); startTick();
  }

  /* ════════════════════════════════════════════════════════════════
     DISPLAY (stacking animation)
     ════════════════════════════════════════════════════════════════ */

  function _updateDisplay(minutes, progress, dir, warm = false) {
    if (valueEl.style.display !== 'flex') valueEl.style.display = 'flex';
    if (valueEl.classList.contains('timer-value-dim')) valueEl.classList.remove('timer-value-dim');

    if (_prevMin !== minutes) {
      if (_prevMin !== null) {
        if (_oldDigitEl) { _oldDigitEl.remove(); _oldDigitEl = null; }

        const oldEl = document.createElement('div');
        oldEl.className = 'timer-digit-old';
        oldEl.textContent = _prevMin;

        valueEl.parentNode.appendChild(oldEl);
        _oldDigitEl = oldEl;

        valueEl.textContent = minutes;
        valueEl.classList.add('timer-digit-enter');
        oldEl.classList.add('timer-digit-old-exit');

        if (_digitAnimationTimer) clearTimeout(_digitAnimationTimer);
        _digitAnimationTimer = setTimeout(() => {
          if (_oldDigitEl === oldEl) { _oldDigitEl.remove(); _oldDigitEl = null; }
          valueEl.classList.remove('timer-digit-enter');
          _digitAnimationTimer = null;
        }, 400);
      } else {
        valueEl.textContent = minutes;
      }

      _prevMin = minutes;
    }

    _applyArc(progress, dir);
    _setWarmGlow(warm);
  }

  /* ── цветовая температура (мягкая тень) ── */

  function _setWarmGlow(warm) {
    if (_isBackground) return;
    if (warm !== _wasWarm) {
      btn.classList.toggle('timer-warm', warm);
      _wasWarm = warm;
    }
  }

  /* ── основная отрисовка дуги ── */

  function _applyArc(progress, dir) {
    if (!arcTail) return;

    if (!_ensurePaths()) return;

    if (_lastDir !== dir) {
      arcSvg.style.display = 'block';
      const d = dir === 'cw' ? _pathCW : _pathCCW;
      if (!d) return;
      arcTail.setAttribute('d', d);
      arcHeadSeg.setAttribute('d', d);
      arcTail.style.opacity = '0.55';
      _lastDir = dir;
      _pts = dir === 'cw' ? _cachedPtsCW : _cachedPtsCCW;
      _resetArcFrameCache();
    }

    const P = _pts.len;
    const visualProgress = Math.max(progress, MIN_VISIBLE_PROGRESS);

    // Detect per-minute wrap (0.999 → 0.000)
    if (_lastProgress !== null && progress < _lastProgress) {
      _resetArcFrameCache();
    }
    _lastProgress = progress;

    const headPos = visualProgress * P;

    // Static writes — once per arc session
    if (!_arcStaticsApplied) {
      arcTail.style.display = '';
      arcHeadSeg.style.display = '';
      arcHeadDot.style.display = '';
      arcTail.style.strokeDashoffset = '0';
      arcHeadDot.setAttribute('r', '2');
      _arcStaticsApplied = true;
    }

    // Tail — every frame (grows with progress)
    arcTail.style.strokeDasharray = headPos + ' ' + P;

    // Head segment — cache dasharray (changes only first ~6s)
    const hLen = Math.min(headPos, P * HEAD_FRAC);
    const headSegDasharray = hLen + ' ' + P;
    if (headSegDasharray !== _lastHeadSegDasharray) {
      arcHeadSeg.style.strokeDasharray = headSegDasharray;
      _lastHeadSegDasharray = headSegDasharray;
    }

    // Head segment offset — every frame
    arcHeadSeg.style.strokeDashoffset = -(headPos - hLen);

    // Comet dot — every frame (no idx cache to avoid stepping)
    const idx = Math.min(_pts.N, Math.floor(visualProgress * _pts.N));
    const pt = _pts.pts[idx];
    arcHeadDot.setAttribute('cx', pt.x);
    arcHeadDot.setAttribute('cy', pt.y);

    _checkCornerGlow(headPos, P);
  }

  function _hideArc() {
    if (arcTail)    { arcTail.style.display = 'none'; arcTail.style.opacity = ''; }
    if (arcHeadSeg) arcHeadSeg.style.display = 'none';
    if (arcHeadDot) arcHeadDot.style.display = 'none';
    _resetArcFrameCache();
    _clearCornerGlow();
    btn.classList.remove('timer-warm');
    _wasWarm = false;
  }

  /* ── idle ── */

  function setIdleVisual() {
    _prevMin = null;
    valueEl.classList.remove('timer-digit-animate', 'timer-digit-enter', 'timer-value-pulse');
    valueEl.style.display = 'flex'; valueEl.textContent = '0'; valueEl.classList.add('timer-value-dim');

    if (inputEl) {
      inputEl.style.display = 'none';
      inputEl.value = '';
      inputEl.onblur = inputEl.onkeydown = inputEl.onclick = inputEl.onmousedown = null;
    }

    arcSvg.style.display = 'none'; arcSvg.style.opacity = '';
    _hideArc();
    arcHeadSeg.style.stroke = ''; arcHeadSeg.style.filter = '';
    arcHeadDot.style.fill = '';  arcHeadDot.style.filter = '';

    btn.classList.remove('timer-pulsing', 'timer-active', 'timer-pressed', 'timer-long-pressed');
    btn.classList.add('timer-idle');
  }

  /* ════════════════════════════════════════════════════════════════
     PERSISTENCE
     ════════════════════════════════════════════════════════════════ */

  const safeSet = (k, v) => { try { Storage._set(k, v); } catch (e) { console.warn('[SquareTimer]', e); } };

  let _lastSavedState = null;

  function saveState() {
    let payload = '';
    if (mode !== null) {
      const data = { mode, startTs, targetMinutes };
      if (_pausedAt !== null) data.pausedElapsed = _pausedElapsed;
      payload = JSON.stringify(data);
    }
    if (payload === _lastSavedState) return;
    _lastSavedState = payload;
    safeSet(STORAGE_KEY, payload);
  }

  function restoreState() {
    _lastSavedState = null;
    try {
      const raw = Storage._get(STORAGE_KEY);
      if (!raw) { setIdleVisual(); return; }
      const s = JSON.parse(raw);
      if (!s || (s.mode !== 'up' && s.mode !== 'down') || !Number.isFinite(s.startTs) || s.startTs <= 0) {
        safeSet(STORAGE_KEY, ''); setIdleVisual(); return;
      }
      if (s.mode === 'down' && (typeof s.targetMinutes !== 'number' || s.targetMinutes < 1 || s.targetMinutes > 99)) {
        safeSet(STORAGE_KEY, ''); setIdleVisual(); return;
      }
      const rawPaused = s.pausedElapsed;
      const wasPaused =
        Number.isFinite(rawPaused) && rawPaused >= 0 &&
        rawPaused < (s.mode === 'up' ? 99 * 60 * 1000 : s.targetMinutes * 60 * 1000);
      if (!wasPaused && typeof rawPaused !== 'undefined') {
        safeSet(STORAGE_KEY, ''); setIdleVisual(); return;
      }
      if (!wasPaused) {
        const elapsed = (Date.now() - s.startTs) / 1000;
        if (s.mode === 'up' && Math.floor(elapsed / 60) >= 99) { safeSet(STORAGE_KEY, ''); setIdleVisual(); return; }
        if (s.mode === 'down' && s.targetMinutes * 60 - Math.floor(elapsed) <= 0) { safeSet(STORAGE_KEY, ''); setIdleVisual(); return; }
      }
      mode = s.mode; startTs = s.startTs; targetMinutes = s.targetMinutes; _prevMin = null;
      btn.classList.remove('timer-idle'); btn.classList.add('timer-active');
      arcSvg.style.display = 'block';
      if (wasPaused) {
        _pausedElapsed = rawPaused;
        _pausedAt = Date.now();
        _hideArc();
        btn.classList.add('timer-paused');
        btn.setAttribute('aria-label', 'Таймер на паузе');
        saveState();
      } else {
        startTick();
      }
      if (!_audioCtx) try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); _audioCtx.resume().catch(() => {}); } catch {}
    } catch (e) { console.warn('[SquareTimer] restore:', e); safeSet(STORAGE_KEY, ''); setIdleVisual(); }
  }

  function getState() {
    const isPulsing = pulseIntervalId !== null;
    const isPaused = _pausedAt !== null;
    const isRunning = mode !== null && !isPaused && !isPulsing;

    return {
      mode,
      running: isRunning,
      paused: isPaused,
      targetMinutes,
      elapsedMs: mode === null || startTs === null
        ? 0
        : isPaused
          ? _pausedElapsed
          : Math.max(0, Date.now() - startTs),
      pulse: isPulsing
    };
  }

  function reset() {
    if (mode === null && !pulseIntervalId) return false;
    resetToIdle();
    return true;
  }

  return { init, destroy, getState, reset };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SquareTimer.init());
} else { SquareTimer.init(); }
