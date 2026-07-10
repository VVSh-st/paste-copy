// file_name: timer.js
'use strict';

/**
 * Square Timer — квадратный таймер с орбитальной дугой по периметру.
 * Полностью независим от Preview.copy().
 *
 * Логика:
 * - Одиночный клик (idle) → счёт вперёд от 0:00
 * - Долгое нажатие (idle) → inline-ввод минут → обратный отсчёт
 * - Правый клик (активный) → сброс в idle
 * - Лимит (99 вверх / 0 вниз) → flash → пульсация 3 мин → звук → обратный отсчёт 99→0
 * - Персистентность через Storage._set/_get
 *
 * Анимация:
 * - 60fps через requestAnimationFrame
 * - Два независимых SVG-пути (CW/CCW) от 12 часов
 * - Хвост (opacity 0.35) + головной сегмент (opacity 1.0 + glow) + точка-голова
 * - Цветовая температура: последние 5 сек → синий→amber
 */

const SquareTimer = (() => {
  const STORAGE_KEY = 'paste-copy-timer';
  const LONG_PRESS_MS = 450;
  const MOVE_THRESHOLD = 10;
  const PULSE_BPM = 50;
  const PULSE_MAX_DURATION = 180000;

  let _initialized = false;
  let btn, arcSvg, valueEl, inputEl;
  let arcTail, arcHeadSegment, arcHeadDot;
  let mode = null;
  let startTs = null;
  let targetMinutes = null;
  let rafId = null;
  let pulseIntervalId = null;
  let pulseStartTime = null;
  let _longPressFired = false;
  let _pointerDownPos = null;
  let _longPressTimer = null;
  let _prevDisplayMinutes = null;

  // Кеш путей и периметра
  let _pathCW = null;
  let _pathCCW = null;
  let _cachedPerimeter = null;

  function _flashEffect() {
    btn.classList.remove('timer-flash');
    void btn.offsetWidth;
    btn.classList.add('timer-flash');
    setTimeout(() => btn.classList.remove('timer-flash'), 1500);
  }

  // ── Периметр путь (CW и CCW) ───────────────────────────────────────

  function _getPerimeterPath(dir) {
    const s = btn.offsetWidth;
    const half = s / 2;

    if (dir === 'cw') {
      return `M ${half},0 L ${s},0 L ${s},${s} L 0,${s} L 0,0 Z`;
    } else {
      return `M ${half},0 L 0,0 L 0,${s} L ${s},${s} L ${s},0 Z`;
    }
  }

  function _updatePaths() {
    _pathCW = _getPerimeterPath('cw');
    _pathCCW = _getPerimeterPath('ccw');
  }

  function _invalidateCaches() {
    _cachedPerimeter = null;
    _pathCW = null;
    _pathCCW = null;
  }

  // ── Init ──────────────────────────────────────────────────────────

  function init() {
    if (_initialized) return;
    _initialized = true;

    btn = document.getElementById('btn-timer');
    if (!btn) return;

    arcSvg = btn.querySelector('.timer-arc');
    arcTail = btn.querySelector('.timer-arc-tail');
    arcHeadSegment = btn.querySelector('.timer-arc-head-segment');
    arcHeadDot = btn.querySelector('.timer-arc-head-dot');
    valueEl = btn.querySelector('.timer-value');
    inputEl = btn.querySelector('.timer-input');

    const ro = new ResizeObserver(() => _invalidateCaches());
    ro.observe(btn);

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
    _pointerDownPos = null;
    _prevDisplayMinutes = null;
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

  // ── Pointer Events ─────────────────────────────────────────────────

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

  // ── Context Menu (правый клик) ────────────────────────────────────

  function onContextMenu(e) {
    if (mode !== null || pulseIntervalId) {
      e.preventDefault();
      resetToIdle();
    }
  }

  // ── Inline Input ──────────────────────────────────────────────────

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

  // ── Sound (Web Audio API) ─────────────────────────────────────────

  function _playCompletionSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
      const startTime = ctx.currentTime;

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0, startTime + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.12, startTime + i * 0.12 + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + i * 0.12 + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime + i * 0.12);
        osc.stop(startTime + i * 0.12 + 0.7);
      });

      setTimeout(() => ctx.close(), 2000);
    } catch (e) {
      console.warn('[SquareTimer] Sound error:', e);
    }
  }

  // ── Timer Logic ───────────────────────────────────────────────────

  function startCountUp() {
    mode = 'up';
    startTs = Date.now();
    targetMinutes = null;
    _prevDisplayMinutes = null;
    btn.classList.remove('timer-idle');
    btn.classList.add('timer-active');
    arcSvg.style.display = 'block';
    saveState();
    startTick();
  }

  function startCountDown(minutes) {
    mode = 'down';
    startTs = Date.now();
    targetMinutes = minutes;
    _prevDisplayMinutes = null;
    btn.classList.remove('timer-idle');
    btn.classList.add('timer-active');
    closeInlineInput();
    arcSvg.style.display = 'block';
    saveState();
    startTick();
  }

  function resetToIdle() {
    stopTick();
    stopPulse();
    clearLongPress();
    _longPressFired = false;
    _pointerDownPos = null;
    mode = null;
    startTs = null;
    targetMinutes = null;
    _prevDisplayMinutes = null;
    saveState();
    setIdleVisual();
  }

  // ── rAF Loop ──────────────────────────────────────────────────────

  function startTick() {
    stopTick();
    rafId = requestAnimationFrame(_tickRAF);
  }

  function stopTick() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function _tickRAF() {
    if (!startTs || mode === null) return;

    const now = Date.now();
    const elapsed = (now - startTs) / 1000;

    if (mode === 'up') {
      const totalSec = Math.floor(elapsed);
      const minutes = Math.floor(totalSec / 60);
      if (minutes >= 99) { onLimitReached(); return; }

      const secInMin = elapsed % 60;
      const progress = secInMin / 60;
      _updateDisplay(minutes, progress, 'cw');

    } else if (mode === 'down') {
      const totalSec = Math.floor(elapsed);
      const remaining = targetMinutes * 60 - totalSec;
      if (remaining <= 0) { onLimitReached(); return; }

      const minutes = Math.floor(remaining / 60);
      const secInMin = elapsed % 60;
      const progress = secInMin / 60;
      _updateDisplay(minutes, progress, 'ccw');
    }

    rafId = requestAnimationFrame(_tickRAF);
  }

  function onLimitReached() {
    stopTick();
    _flashEffect();

    if (window.Ember && typeof Ember.notifyEdit === 'function') {
      Ember.notifyEdit();
    }

    startPulse();
  }

  // ── Pulse (пульсация после достижения лимита) ─────────────────────

  function startPulse() {
    pulseStartTime = Date.now();
    btn.classList.add('timer-pulsing');

    pulseIntervalId = setInterval(() => {
      const elapsed = Date.now() - pulseStartTime;
      if (elapsed >= PULSE_MAX_DURATION) {
        stopPulse();
        if (mode === 'up') {
          _playCompletionSound();
          _startAutoCountdown();
        } else {
          resetToIdle();
        }
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

  function _startAutoCountdown() {
    mode = 'down';
    startTs = Date.now();
    targetMinutes = 99;
    _prevDisplayMinutes = null;
    arcSvg.style.display = 'block';
    saveState();
    startTick();
  }

  // ── Display ───────────────────────────────────────────────────────

  function _updateDisplay(minutes, progress, direction) {
    // Цифра
    valueEl.style.display = 'flex';
    valueEl.classList.remove('timer-value-dim');

    if (_prevDisplayMinutes !== null && minutes !== _prevDisplayMinutes) {
      valueEl.textContent = minutes;
      void valueEl.offsetWidth;
      valueEl.classList.add('timer-digit-animate');
    } else {
      valueEl.textContent = minutes;
    }
    _prevDisplayMinutes = minutes;

    // Дуга
    _applyArc(progress, direction);
  }

  function _applyArc(progress, direction) {
    if (!arcTail) return;
    arcSvg.style.display = 'block';

    // Выбираем путь
    if (_pathCW === null || _pathCCW === null) _updatePaths();
    const pathD = (direction === 'cw') ? _pathCW : _pathCCW;
    if (!pathD) return;

    // Устанавливаем `d` всем трём элементам
    arcTail.setAttribute('d', pathD);
    arcHeadSegment.setAttribute('d', pathD);

    // Периметр (кеш)
    if (_cachedPerimeter == null) {
      _cachedPerimeter = arcTail.getTotalLength();
    }
    const P = _cachedPerimeter;

    // Невидимо при progress ≈ 0
    if (progress < 0.005) {
      arcTail.style.display = 'none';
      arcHeadSegment.style.display = 'none';
      arcHeadDot.style.display = 'none';
      return;
    }

    const visibleLen = progress * P;

    // Хвост (тусклый, полная длина прогресса)
    arcTail.style.display = '';
    arcTail.style.strokeDasharray = visibleLen + ' ' + P;
    arcTail.style.strokeDashoffset = '0';

    // Головной сегмент (яркий, последние ~10% хвоста)
    const headLen = Math.min(visibleLen, P * 0.10);
    arcHeadSegment.style.display = '';
    arcHeadSegment.style.strokeDasharray = headLen + ' ' + P;
    arcHeadSegment.style.strokeDashoffset = -(visibleLen - headLen);

    // Точка-голова (на кончике дуги)
    const endPoint = arcTail.getPointAtLength(visibleLen);
    arcHeadDot.style.display = '';
    arcHeadDot.setAttribute('cx', endPoint.x);
    arcHeadDot.setAttribute('cy', endPoint.y);

    // Цветовая температура
    _applyColorTemperature(progress);
  }

  // ── Цветовая температура ──────────────────────────────────────────

  function _applyColorTemperature(progress) {
    const WARM_START = 55 / 60;
    if (progress < WARM_START) {
      arcTail.style.stroke = '';
      arcHeadSegment.style.stroke = '';
      arcHeadDot.style.fill = '';
      return;
    }

    const t = (progress - WARM_START) / (1 - WARM_START);
    const h = 217 + (30 - 217) * t;
    const s = 100;
    const l = 64 + (60 - 64) * t;
    const color = `hsl(${h.toFixed(1)}, ${s}%, ${l.toFixed(1)}%)`;

    arcTail.style.stroke = color;
    arcHeadSegment.style.stroke = color;
    arcHeadDot.style.fill = color;
  }

  // ── Idle ──────────────────────────────────────────────────────────

  function setIdleVisual() {
    _prevDisplayMinutes = null;

    valueEl.classList.remove('timer-digit-animate');
    void valueEl.offsetWidth;
    valueEl.style.display = 'flex';
    valueEl.textContent = '0';
    valueEl.classList.add('timer-value-dim');

    arcSvg.style.display = 'none';
    arcTail.style.display = 'none';
    arcHeadSegment.style.display = 'none';
    arcHeadDot.style.display = 'none';

    arcTail.style.stroke = '';
    arcHeadSegment.style.stroke = '';
    arcHeadDot.style.fill = '';

    btn.classList.remove('timer-pulsing');
    btn.classList.remove('timer-active');
    btn.classList.add('timer-idle');
  }

  // ── Persistence ───────────────────────────────────────────────────

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
        _prevDisplayMinutes = null;
        arcSvg.style.display = 'block';
        startTick();

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
        _prevDisplayMinutes = null;
        arcSvg.style.display = 'block';
        startTick();
      }

    } catch (e) {
      console.warn('[SquareTimer] restore error:', e);
      clearPersisted();
      setIdleVisual();
    }
  }

  // ── Public API ────────────────────────────────────────────────────

  return { init, destroy };
})();

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => SquareTimer.init());
} else {
  SquareTimer.init();
}
