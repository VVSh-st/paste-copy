// file_name: timer.js
'use strict';

/**
 * Square Timer — квадратный таймер с обводкой по периметру.
 * Полностью независим от Preview.copy().
 *
 * Логика:
 * - Одиночный клик (idle) → счёт вперёд от 0:00
 * - Долгое нажатие (idle) → inline-ввод минут → обратный отсчёт
 * - Правый клик (активный) → сброс в idle
 * - Лимит (99 вверх / 0 вниз) → пульсация 3 мин или до клика
 * - Персистентность через Storage._set/_get
 */

const SquareTimer = (() => {
  const STORAGE_KEY = 'paste-copy-timer';
  const LONG_PRESS_MS = 450;
  const MOVE_THRESHOLD = 10;
  const PULSE_BPM = 50;
  const PULSE_MAX_DURATION = 180000;
  const TRAIL_DURATION = 2000;

  let _initialized = false;
  let btn, arcSvg, arcRect, arcGhost, valueEl, inputEl;
  let _cachedPerimeter = null;
  let mode = null;
  let startTs = null;
  let targetMinutes = null;
  let intervalId = null;
  let pulseIntervalId = null;
  let pulseStartTime = null;
  let _longPressFired = false;
  let _pointerDownPos = null;
  let _longPressTimer = null;
  let _prevMinutes = null;
  let _prevSecondsInMinute = null;
  let _isFading = false;
  let _fadeTimeout = null;

  function init() {
    if (_initialized) return;
    _initialized = true;

    btn = document.getElementById('btn-timer');
    if (!btn) return;

    arcSvg = btn.querySelector('.timer-arc');
    arcRect = btn.querySelector('.timer-arc-rect');
    valueEl = btn.querySelector('.timer-value');
    inputEl = btn.querySelector('.timer-input');

    if (arcRect) {
      _cachedPerimeter = arcRect.getTotalLength();

      arcGhost = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arcGhost.setAttribute('d', arcRect.getAttribute('d'));
      arcGhost.classList.add('timer-arc-ghost');
      arcGhost.style.display = 'none';
      arcSvg.insertBefore(arcGhost, arcRect);

      const ro = new ResizeObserver(() => { _cachedPerimeter = null; });
      ro.observe(btn);
    }

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointercancel', onPointerCancel);
    btn.addEventListener('lostpointercapture', onLostCapture);

    btn.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') return;
      onPointerCancel(e);
    });

    btn.addEventListener('contextmenu', onContextMenu);

    restoreState();
  }

  function destroy() {
    stopTick();
    stopPulse();
    clearLongPress();
    _isFading = false;
    if (_fadeTimeout) { clearTimeout(_fadeTimeout); _fadeTimeout = null; }
    _pointerDownPos = null;
    _prevMinutes = null;
    _prevSecondsInMinute = null;
    _longPressFired = false;
    if (btn) {
      btn.removeEventListener('pointerdown', onPointerDown);
      btn.removeEventListener('pointerup', onPointerUp);
      btn.removeEventListener('pointermove', onPointerMove);
      btn.removeEventListener('pointercancel', onPointerCancel);
      btn.removeEventListener('lostpointercapture', onLostCapture);
      btn.removeEventListener('contextmenu', onContextMenu);
    }
  }

  // ── Pointer Events ─────────────────────────────────────────────────────

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (inputEl.style.display !== 'none') return;

    _longPressFired = false;
    _pointerDownPos = { x: e.clientX, y: e.clientY };

    _longPressTimer = setTimeout(() => {
      _longPressFired = true;
      openInlineInput();
    }, LONG_PRESS_MS);
  }

  function onPointerUp(e) {
    if (e.button !== 0) return;
    clearLongPress();

    if (_pointerDownPos === null) return;
    _pointerDownPos = null;

    if (pulseIntervalId) {
      resetToIdle();
      return;
    }

    if (_longPressFired) {
      _longPressFired = false;
      return;
    }

    if (mode === null) {
      startCountUp();
    }
  }

  function onPointerMove(e) {
    if (!_pointerDownPos || _longPressFired) return;

    const dx = e.clientX - _pointerDownPos.x;
    const dy = e.clientY - _pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_THRESHOLD) {
      clearLongPress();
    }
  }

  function onPointerCancel() {
    clearLongPress();
    _longPressFired = false;
    _pointerDownPos = null;
  }

  function onLostCapture() {
    clearLongPress();
    _longPressFired = false;
    _pointerDownPos = null;
  }

  function clearLongPress() {
    if (_longPressTimer) {
      clearTimeout(_longPressTimer);
      _longPressTimer = null;
    }
  }

  // ── Context Menu (правый клик) ────────────────────────────────────────

  function onContextMenu(e) {
    if (mode !== null || pulseIntervalId) {
      e.preventDefault();
      resetToIdle();
    }
  }

  // ── Inline Input ──────────────────────────────────────────────────────

  function openInlineInput() {
    if (mode !== null) return;

    valueEl.style.display = 'none';
    inputEl.style.display = '';
    inputEl.value = '';
    inputEl.focus();

    inputEl.onclick = ev => ev.stopPropagation();
    inputEl.onmousedown = ev => ev.stopPropagation();

    inputEl.onblur = () => {
      try {
        const v = Number.parseInt(inputEl.value, 10);
        if (Number.isFinite(v) && v >= 1 && v <= 99) {
          startCountDown(v);
        } else {
          closeInlineInput();
        }
      } catch {
        closeInlineInput();
      }
    };

    inputEl.onkeydown = ev => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        inputEl.blur();
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        inputEl.value = '';
        inputEl.blur();
      }
      ev.stopPropagation();
    };
  }

  function closeInlineInput() {
    inputEl.value = '';
    inputEl.style.display = 'none';
    inputEl.onblur = null;
    inputEl.onkeydown = null;
    inputEl.onclick = null;
    inputEl.onmousedown = null;
    if (mode) {
      valueEl.style.display = 'flex';
      valueEl.classList.remove('timer-value-dim');
    } else {
      setIdleVisual();
    }
  }

  // ── Timer Logic ───────────────────────────────────────────────────────

  function startCountUp() {
    mode = 'up';
    startTs = Date.now();
    targetMinutes = null;
    _prevMinutes = null;
    _prevSecondsInMinute = null;
    _isFading = false;
    saveState();
    startTick();
    updateDisplay();
  }

  function startCountDown(minutes) {
    mode = 'down';
    startTs = Date.now();
    targetMinutes = minutes;
    _prevMinutes = null;
    _prevSecondsInMinute = null;
    _isFading = false;
    closeInlineInput();
    saveState();
    startTick();
    updateDisplay();
  }

  function resetToIdle() {
    stopTick();
    stopPulse();
    clearLongPress();
    _isFading = false;
    if (_fadeTimeout) { clearTimeout(_fadeTimeout); _fadeTimeout = null; }
    _longPressFired = false;
    _pointerDownPos = null;
    mode = null;
    startTs = null;
    targetMinutes = null;
    _prevMinutes = null;
    _prevSecondsInMinute = null;
    saveState();
    setIdleVisual();
  }

  function startTick() {
    stopTick();
    intervalId = setInterval(tick, 1000);
  }

  function stopTick() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function tick() {
    if (!startTs) return;

    const elapsed = Date.now() - startTs;

    if (mode === 'up') {
      const totalSeconds = Math.floor(elapsed / 1000);
      const minutes = Math.floor(totalSeconds / 60);

      if (minutes >= 99) {
        onLimitReached();
        return;
      }

      updateDisplay();
    } else if (mode === 'down') {
      const totalSeconds = Math.floor(elapsed / 1000);
      const totalMinutesTarget = targetMinutes * 60;
      const remaining = totalMinutesTarget - totalSeconds;

      if (remaining <= 0) {
        onLimitReached();
        return;
      }

      updateDisplay();
    }
  }

  function onLimitReached() {
    stopTick();
    if (window.Ember && typeof Ember.notifyEdit === 'function') {
      Ember.notifyEdit();
    }
    startPulse();
  }

  // ── Pulse (пульсация после достижения лимита) ─────────────────────────

  function startPulse() {
    pulseStartTime = Date.now();
    btn.classList.add('timer-pulsing');

    pulseIntervalId = setInterval(() => {
      const elapsed = Date.now() - pulseStartTime;
      if (elapsed >= PULSE_MAX_DURATION) {
        resetToIdle();
      }
    }, 1000);
  }

  function stopPulse() {
    btn.classList.remove('timer-pulsing');
    if (pulseIntervalId) {
      clearInterval(pulseIntervalId);
      pulseIntervalId = null;
    }
  }

  // ── Display ───────────────────────────────────────────────────────────

  function updateDisplay() {
    if (!startTs) return;

    const elapsed = Date.now() - startTs;
    let minutes, progress, direction, secondsInMinute;

    if (mode === 'up') {
      const totalSeconds = Math.floor(elapsed / 1000);
      minutes = Math.floor(totalSeconds / 60);
      secondsInMinute = totalSeconds % 60;
      progress = secondsInMinute / 60;
      direction = 'cw';
    } else {
      const totalSeconds = Math.floor(elapsed / 1000);
      const totalMinutesTarget = targetMinutes * 60;
      const remaining = totalMinutesTarget - totalSeconds;
      minutes = Math.floor(remaining / 60);
      secondsInMinute = remaining % 60;
      progress = 1 - (secondsInMinute / 60);
      direction = 'ccw';
    }

    _checkMinuteBoundary(secondsInMinute, direction);

    valueEl.style.display = 'flex';
    valueEl.classList.remove('timer-value-dim');

    if (_prevMinutes !== null && minutes !== _prevMinutes) {
      valueEl.textContent = minutes;
      void valueEl.offsetWidth;
      valueEl.classList.add('timer-digit-animate');
    } else {
      valueEl.textContent = minutes;
    }
    _prevMinutes = minutes;
    _prevSecondsInMinute = secondsInMinute;

    _applyArc(progress, direction);
  }

  function _checkMinuteBoundary(secondsInMinute, direction) {
    if (_prevSecondsInMinute === null) return;

    const crossed =
      (direction === 'cw'  && _prevSecondsInMinute === 59 && secondsInMinute === 0) ||
      (direction === 'ccw' && _prevSecondsInMinute === 0  && secondsInMinute === 59);

    if (crossed && !_isFading) {
      _startTrailTransition();
    }
  }

  function _startTrailTransition() {
    if (!arcGhost || !arcRect) return;
    _isFading = true;

    const perimeter = _cachedPerimeter || arcRect.getTotalLength();
    const currentOffset = parseFloat(arcRect.style.strokeDashoffset) || 0;

    arcGhost.style.transition = 'none';
    arcGhost.style.strokeDasharray = perimeter + ' ' + perimeter;
    arcGhost.style.strokeDashoffset = currentOffset;
    arcGhost.style.opacity = '1';
    arcGhost.style.display = 'block';

    if (mode === 'down') {
      arcGhost.style.transform = 'scaleX(-1)';
    } else {
      arcGhost.style.transform = '';
    }

    void arcGhost.offsetWidth;

    arcGhost.style.transition =
      'stroke-dashoffset ' + TRAIL_DURATION + 'ms cubic-bezier(0.4, 0, 1, 1), ' +
      'opacity ' + TRAIL_DURATION + 'ms ease-in';
    arcGhost.style.strokeDashoffset = currentOffset - perimeter;
    arcGhost.style.opacity = '0.15';

    const cleanup = () => {
      arcGhost.removeEventListener('transitionend', cleanup);
      arcGhost.removeEventListener('transitioncancel', cleanup);
      arcGhost.style.display = 'none';
      arcGhost.style.transition = '';
      _isFading = false;
    };

    _fadeTimeout = setTimeout(cleanup, TRAIL_DURATION + 100);

    arcGhost.addEventListener('transitionend', function handler(e) {
      if (e.propertyName === 'stroke-dashoffset') {
        clearTimeout(_fadeTimeout);
        cleanup();
      }
    });
    arcGhost.addEventListener('transitioncancel', cleanup);
  }

  function _applyArc(progress, direction) {
    if (!arcRect) return;

    arcSvg.style.display = 'block';

    if (_cachedPerimeter == null) {
      _cachedPerimeter = arcRect.getTotalLength();
    }
    const totalLength = _cachedPerimeter;

    arcRect.style.transition = 'stroke-dashoffset 0.95s linear';
    arcRect.style.strokeDasharray = totalLength + ' ' + totalLength;
    arcRect.style.strokeDashoffset = totalLength * (1 - progress);

    if (direction === 'ccw') {
      arcSvg.style.transform = 'scaleX(-1)';
    } else {
      arcSvg.style.transform = '';
    }
  }

  function setIdleVisual() {
    _prevMinutes = null;
    _prevSecondsInMinute = null;
    _isFading = false;
    if (_fadeTimeout) { clearTimeout(_fadeTimeout); _fadeTimeout = null; }

    if (arcGhost) {
      arcGhost.style.transition = 'none';
      arcGhost.style.display = 'none';
      arcGhost.style.opacity = '';
    }

    valueEl.classList.remove('timer-digit-animate');
    void valueEl.offsetWidth;
    valueEl.style.display = 'flex';
    valueEl.textContent = '0';
    valueEl.classList.add('timer-value-dim');

    arcSvg.style.opacity = '';
    arcSvg.style.transition = '';
    arcSvg.style.display = 'none';
    btn.classList.remove('timer-pulsing');
  }

  // ── Persistence ───────────────────────────────────────────────────────

  function safeSet(key, val) {
    try { return Storage._set(key, val); } catch (e) { console.warn('[SquareTimer]', e); }
  }

  function saveState() {
    if (mode === null) {
      safeSet(STORAGE_KEY, '');
      return;
    }

    const state = {
      mode,
      startTs,
      targetMinutes,
    };
    safeSet(STORAGE_KEY, JSON.stringify(state));
  }

  function clearPersisted() {
    safeSet(STORAGE_KEY, '');
  }

  function restoreState() {
    try {
      const raw = Storage._get(STORAGE_KEY);
      if (!raw) {
        setIdleVisual();
        return;
      }

      const state = JSON.parse(raw);

      if (!state || (state.mode !== 'up' && state.mode !== 'down')) {
        clearPersisted();
        setIdleVisual();
        return;
      }
      if (typeof state.startTs !== 'number' || state.startTs <= 0) {
        clearPersisted();
        setIdleVisual();
        return;
      }
      if (state.mode === 'down' &&
          (typeof state.targetMinutes !== 'number' || state.targetMinutes < 1 || state.targetMinutes > 99)) {
        clearPersisted();
        setIdleVisual();
        return;
      }

      const elapsed = Date.now() - state.startTs;

      if (state.mode === 'up') {
        const totalSeconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(totalSeconds / 60);

        if (minutes >= 99) {
          clearPersisted();
          setIdleVisual();
          return;
        }

        mode = state.mode;
        startTs = state.startTs;
        targetMinutes = null;
        _prevMinutes = null;
        _prevSecondsInMinute = null;
        startTick();
        updateDisplay();

      } else if (state.mode === 'down') {
        const totalSeconds = Math.floor(elapsed / 1000);
        const totalMinutesTarget = state.targetMinutes * 60;
        const remaining = totalMinutesTarget - totalSeconds;

        if (remaining <= 0) {
          clearPersisted();
          setIdleVisual();
          return;
        }

        mode = state.mode;
        startTs = state.startTs;
        targetMinutes = state.targetMinutes;
        _prevMinutes = null;
        _prevSecondsInMinute = null;
        startTick();
        updateDisplay();
      }

    } catch (e) {
      console.warn('[SquareTimer] restore error:', e);
      clearPersisted();
      setIdleVisual();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  return { init, destroy };
})();

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SquareTimer.init());
} else {
  SquareTimer.init();
}
