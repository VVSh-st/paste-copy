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
  const PULSE_BPM = 50;          // 50 ударов в минуту → ~1.2с интервал
  const PULSE_MAX_DURATION = 180000; // 3 минуты

  let btn, arcSvg, arcRect, valueEl, inputEl;
  let _cachedPerimeter = null;   // кэш длины периметра rect
  let mode = null;               // 'up' | 'down' | null
  let startTs = null;
  let targetMinutes = null;      // только для mode:'down'
  let intervalId = null;
  let pulseIntervalId = null;
  let pulseStartTime = null;
  let _longPressFired = false;
  let _pointerDownPos = null;
  let _longPressTimer = null;

  function init() {
    btn = document.getElementById('btn-timer');
    if (!btn) return;

    arcSvg = btn.querySelector('.timer-arc');
    arcRect = btn.querySelector('.timer-arc-rect');
    valueEl = btn.querySelector('.timer-value');
    inputEl = btn.querySelector('.timer-input');

    // Кэшируем периметр один раз
    if (arcRect) {
      _cachedPerimeter = arcRect.getTotalLength();
    }

    // Pointer Events для long-press
    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointercancel', onPointerCancel);
    btn.addEventListener('pointerleave', onPointerCancel);

    // Правый клик — сброс
    btn.addEventListener('contextmenu', onContextMenu);

    // Восстановление из localStorage
    restoreState();
  }

  function destroy() {
    stopTick();
    stopPulse();
    clearLongPress();
    if (btn) {
      btn.removeEventListener('pointerdown', onPointerDown);
      btn.removeEventListener('pointerup', onPointerUp);
      btn.removeEventListener('pointermove', onPointerMove);
      btn.removeEventListener('pointercancel', onPointerCancel);
      btn.removeEventListener('pointerleave', onPointerCancel);
      btn.removeEventListener('contextmenu', onContextMenu);
    }
  }

  // ── Pointer Events ─────────────────────────────────────────────────────

  function onPointerDown(e) {
    if (e.button !== 0) return; // только левый клик
    if (inputEl.style.display !== 'none') return; // инпут активен

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

    // Сброс по клику во время пульсации
    if (pulseIntervalId) {
      resetToIdle();
      return;
    }

    if (_longPressFired) {
      _longPressFired = false;
      return;
    }

    // Короткий клик
    if (mode === null) {
      startCountUp();
    }
    // Если таймер активен — no-op (по тикету)
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
    // В idle — не перехватываем, нативное меню работает
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
      const v = parseInt(inputEl.value, 10);
      if (v >= 1 && v <= 99) {
        startCountDown(v);
      } else {
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
    saveState();
    startTick();
    updateDisplay();
  }

  function startCountDown(minutes) {
    mode = 'down';
    startTs = Date.now();
    targetMinutes = minutes;
    saveState();
    startTick();
    updateDisplay();
    closeInlineInput();
  }

  function resetToIdle() {
    stopTick();
    stopPulse();
    mode = null;
    startTs = null;
    targetMinutes = null;
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
    let minutes, progress, direction;

    if (mode === 'up') {
      const totalSeconds = Math.floor(elapsed / 1000);
      minutes = Math.floor(totalSeconds / 60);
      const secondsInMinute = totalSeconds % 60;
      progress = secondsInMinute / 60;
      direction = 'cw'; // по часовой
    } else {
      const totalSeconds = Math.floor(elapsed / 1000);
      const totalMinutesTarget = targetMinutes * 60;
      const remaining = totalMinutesTarget - totalSeconds;
      minutes = Math.floor(remaining / 60);
      const secondsInMinute = remaining % 60;
      progress = 1 - (secondsInMinute / 60);
      direction = 'ccw'; // против часовой
    }

    valueEl.style.display = 'flex';
    valueEl.classList.remove('timer-value-dim');
    valueEl.textContent = minutes;

    updateArc(progress, direction);
  }

  function updateArc(progress, direction) {
    if (!arcRect) return;

    arcSvg.style.display = 'block';

    const totalLength = _cachedPerimeter || arcRect.getTotalLength();
    arcRect.style.strokeDasharray = totalLength;

    const offset = totalLength * (1 - progress);
    arcRect.style.strokeDashoffset = offset;

    if (direction === 'ccw') {
      arcSvg.style.transform = 'scaleX(-1)';
    } else {
      arcSvg.style.transform = '';
    }
  }

  function setIdleVisual() {
    valueEl.style.display = 'flex';
    valueEl.textContent = '0';
    valueEl.classList.add('timer-value-dim');
    arcSvg.style.display = 'none';
    btn.classList.remove('timer-pulsing');
  }

  // ── Persistence ───────────────────────────────────────────────────────

  function saveState() {
    if (mode === null) {
      Storage._set(STORAGE_KEY, '');
      return;
    }

    const state = {
      mode,
      startTs,
      targetMinutes,
    };
    Storage._set(STORAGE_KEY, JSON.stringify(state));
  }

  function restoreState() {
    try {
      const raw = Storage._get(STORAGE_KEY);
      if (!raw) {
        setIdleVisual();
        return;
      }

      const state = JSON.parse(raw);
      if (!state || !state.mode || !state.startTs) {
        setIdleVisual();
        return;
      }

      const elapsed = Date.now() - state.startTs;

      if (state.mode === 'up') {
        const totalSeconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(totalSeconds / 60);

        if (minutes >= 99) {
          setIdleVisual();
          Storage._set(STORAGE_KEY, '');
          return;
        }

        mode = state.mode;
        startTs = state.startTs;
        targetMinutes = null;
        startTick();
        updateDisplay();

      } else if (state.mode === 'down') {
        const totalSeconds = Math.floor(elapsed / 1000);
        const totalMinutesTarget = state.targetMinutes * 60;
        const remaining = totalMinutesTarget - totalSeconds;

        if (remaining <= 0) {
          setIdleVisual();
          Storage._set(STORAGE_KEY, '');
          return;
        }

        mode = state.mode;
        startTs = state.startTs;
        targetMinutes = state.targetMinutes;
        startTick();
        updateDisplay();
      }

    } catch (e) {
      console.warn('[SquareTimer] restore error:', e);
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
