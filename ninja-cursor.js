// file_name: ninja-cursor.js

'use strict';

/**
 * NinjaCursor — animated caret-trail effect for textarea/contentEditable elements.
 *
 * Ported from the Obsidian ninja-cursor plugin and adapted for vanilla browser
 * textarea editing. Uses a mirror-div technique to calculate pixel-accurate
 * caret coordinates inside <textarea> elements (window.getSelection() does not
 * work there).
 */
const NinjaCursor = (() => {

  // ── Internal state ────────────────────────────────────────────────────────

  let _enabled  = false;
  let _instance = null;

  // ── Caret position: mirror-div approach for <textarea> ───────────────────

  // Properties to replicate from the textarea to the mirror div.
  const COPY_PROPS = [
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantLigatures',
    'fontFeatureSettings', 'fontKerning',
    'letterSpacing', 'lineHeight',
    'textTransform', 'textIndent',
    'whiteSpace',
    'wordBreak', 'overflowWrap',
    'tabSize',
  ];

  /** Cached mirror state keyed by the element it was built for. */
  let _mirrorCache = { el: null, mirror: null };

  /**
   * Get (or create) a mirror div for the given element.
   * Reuses the previous mirror if the element hasn't changed,
   * avoiding DOM thrashing on fast typing.
   */
  function _getMirror(el) {
    if (!el.isConnected) return null;
    const doc = el.ownerDocument;

    if (_mirrorCache.el === el && _mirrorCache.mirror && _mirrorCache.mirror.isConnected) {
      return _mirrorCache.mirror;
    }

    // Tear down previous mirror
    if (_mirrorCache.mirror && _mirrorCache.mirror.parentNode) {
      _mirrorCache.mirror.parentNode.removeChild(_mirrorCache.mirror);
    }

    const computed = window.getComputedStyle(el);
    const mirror   = doc.createElement('div');

    for (const prop of COPY_PROPS) {
      mirror.style[prop] = computed[prop];
    }

    // Use content-box so we can set width = textarea content area exactly.
    // el.clientWidth = padding-left + content-width + padding-right (no border, no scrollbar).
    // With content-box, mirror content-width = width (we set) and padding is added on top.
    // To match the textarea's text-flow area we need:
    //   content-width = el.clientWidth - paddingLeft - paddingRight
    const pl = parseFloat(computed.paddingLeft) || 0;
    const pr = parseFloat(computed.paddingRight) || 0;
    mirror.style.boxSizing = 'content-box';
    mirror.style.width     = (el.clientWidth - pl - pr) + 'px';

    mirror.style.position      = 'absolute';
    mirror.style.visibility    = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.top           = '-9999px';
    mirror.style.left          = '-9999px';
    mirror.style.overflow      = 'hidden';

    // whiteSpace now comes from COPY_PROPS (computed style).
    // For INPUT elements, force 'pre' to prevent wrap.
    if (el.tagName === 'INPUT') {
      mirror.style.whiteSpace = 'pre';
    }

    doc.body.appendChild(mirror);
    mirror.setAttribute('aria-hidden', 'true');

    _mirrorCache = { el, mirror };
    return mirror;
  }

  /**
   * Returns { x, y, height } in viewport coordinates for the caret
   * inside a <textarea> or <input type="text">.
   */
  function _getTextareaCaretRect(el) {
    if (!el.isConnected) return null;
    // Guard: selectionStart can be null for certain input types in some browsers
    const start = Number(el.selectionStart);
    if (!Number.isFinite(start)) return null;

    const doc      = el.ownerDocument;
    const computed = window.getComputedStyle(el);

    const mirror = _getMirror(el);

    // Refresh width in case textarea was resized since the mirror was created
    const pl = parseFloat(computed.paddingLeft) || 0;
    const pr = parseFloat(computed.paddingRight) || 0;
    mirror.style.width = (el.clientWidth - pl - pr) + 'px';

    // Clear previous content
    while (mirror.firstChild) mirror.removeChild(mirror.firstChild);

    // Text before caret
    const before = doc.createElement('span');
    before.textContent = el.value.substring(0, start);

    // Marker at the caret position. Use NBSP for spaces to prevent
    // collapse at wrap boundaries; '.' as fallback when at end of text.
    const marker = doc.createElement('span');
    const ch = el.value.substring(start, start + 1);
    marker.textContent = (ch && ch !== ' ') ? ch : '\u00A0';

    mirror.appendChild(before);
    mirror.appendChild(marker);

    const elRect     = el.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();

    const offsetX = elRect.left - mirrorRect.left - el.scrollLeft;
    const offsetY = elRect.top  - mirrorRect.top  - el.scrollTop;

    const lineH = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.4;

    return {
      x:      markerRect.left + offsetX,
      y:      markerRect.top  + offsetY,
      height: lineH,
    };
  }

  /**
   * Get caret rect for a contentEditable element using window.getSelection().
   */
  function _getContentEditableCaretRect(win, doc, _el) {
    const sel = win.getSelection();
    if (!sel || sel.rangeCount === 0) return null;

    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();

    if (rect.x === 0 && rect.y === 0) {
      const tmp = doc.createRange();
      try {
        tmp.setStart(range.startContainer, range.startOffset);
        tmp.setEndAfter(range.startContainer);
        rect = tmp.getBoundingClientRect();

        if (rect.x === 0 && rect.y === 0) {
          const startOff = Math.max(0, range.endOffset - 1);
          tmp.setStart(range.endContainer, startOff);
          tmp.setEnd(range.endContainer, range.endOffset);
          const rects = tmp.getClientRects();
          const last  = rects.item(rects.length - 1);
          if (!last) return null;
          return { x: last.right, y: last.bottom - last.height, height: last.height };
        }
      } catch (_) {
        return null;
      }
    }

    return (rect.width || rect.height)
      ? { x: rect.left, y: rect.top, height: rect.height }
      : null;
  }


  // ── Core cursor engine ────────────────────────────────────────────────────

  class CursorEngine {
    constructor() {
      this._doc        = document;
      this._win        = window;
      this._wrapper    = null;
      this._cursor     = null;
      this._lastPos    = null;
      this._styleCount = 0;
      this._busy       = false;
      this._needResync = false; // [FIX] deferred resync flag
      this._handlers   = [];
      this._datumEl    = null;
      this._scrollBusy = false;

      this._build();
      this._bind();
    }

    _build() {
      const { _doc } = this;

      this._wrapper = _doc.createElement('div');
      this._wrapper.className = 'nc-wrapper';
      this._wrapper.setAttribute('aria-hidden', 'true');

      this._cursor = _doc.createElement('span');
      this._cursor.className = 'nc-caret';

      this._wrapper.appendChild(this._cursor);
      _doc.body.appendChild(this._wrapper);
    }

    _on(target, type, fn, opts = { passive: true }) {
      target.addEventListener(type, fn, opts);
      this._handlers.push({ target, type, fn, opts });
    }

    _bind() {
      const events = [
        'keydown', 'keyup', 'input',
        'mousedown', 'mouseup',
        'touchstart', 'touchend',
        'focusin',
      ];

      for (const type of events) {
        this._on(this._win, type, (e) => this._onInput(e));
      }

      this._on(this._win, 'wheel', () => this._onWheel(), { passive: true });

      // 'scroll' doesn't bubble; capture to catch inner scrollables.
      this._on(this._win, 'scroll', () => this._onWheel(), { passive: true, capture: true });
    }

    _isEditTarget(el) {
      if (!el) return false;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      if (el.tagName === 'INPUT') {
        const t = el.type?.toLowerCase() ?? 'text';
        return ['text', 'search', 'url', 'email', 'password', ''].includes(t);
      }
      return false;
    }

    async _onInput(e, options = {}) {
      if (this._busy) {
        // =scroll resync=
        if (e === null) this._needResync = true;
        return;
      }
      this._busy = true;
      try {
        await this._tick(e, options);

        // =deferred resync=
        if (this._needResync) {
          this._needResync = false;
          await this._tick(null, { animate: false });
        }
      } catch (err) {
        if (typeof console !== 'undefined') console.debug('[NinjaCursor]', err);
      } finally {
        this._busy = false;
      }
    }

    async _resync({ animate = false } = {}) {
      if (this._busy) {
        this._needResync = true;
        return;
      }
      this._busy = true;
      try {
        await this._tick(null, { animate });
        if (this._needResync) {
          this._needResync = false;
          await this._tick(null, { animate });
        }
      } catch (err) {
        if (typeof console !== 'undefined') console.debug('[NinjaCursor]', err);
      } finally {
        this._busy = false;
      }
    }

    async _tick(e, options = {}) {
      const target = e?.target;

      // Hide cursor if focus left editable areas
      if (e && !this._isEditTarget(target)) {
        this._wrapper.style.setProperty('--nc-vis', 'hidden');
        return;
      }

      if (target && this._isEditTarget(target)) {
        this._datumEl = target;
      }

      // [FIX] Verify the element is still focused; if not, hide and bail.
      if (this._datumEl && this._doc.activeElement !== this._datumEl) {
        // activeElement might be a shadow host or the body — don't animate.
        // Exception: if the active element is inside a contentEditable, the
        // active element is the host, so we check contains() as well.
        if (!this._datumEl.contains(this._doc.activeElement)) {
          this._wrapper.style.setProperty('--nc-vis', 'hidden');
          this._datumEl = null;
          return;
        }
      }

      // Let the browser update selection after the event
      await new Promise(res => requestAnimationFrame(res));

      if (!this._datumEl || !this._datumEl.isConnected) {
        this._datumEl = null;
        this._wrapper.style.setProperty('--nc-vis', 'hidden');
        return;
      }

      const rect = this._getCaretRect(this._datumEl);
      if (!rect) return;

      if (options.animate === false) {
        this._syncSilently(rect);
        return;
      }

      this._wrapper.style.setProperty('--nc-vis', 'visible');

      if (!this._lastPos) {
        this._lastPos = rect;
        return;
      }

      if (this._lastPos.x === rect.x && this._lastPos.y === rect.y) return;

      this._animate(rect);
    }

    _getCaretRect(el) {
      try {
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          return _getTextareaCaretRect(el);
        }
        if (el.isContentEditable) {
          return _getContentEditableCaretRect(this._win, this._doc, el);
        }
      } catch (_) { /* cursor is cosmetic — never crash */ }
      return null;
    }

    _hide() {
      this._wrapper.style.setProperty('--nc-vis', 'hidden');
      if (this._cursor) this._cursor.className = 'nc-caret';
    }

    _syncSilently(rect) {
      this._lastPos = rect;
      const s = this._wrapper.style;
      s.setProperty('--nc-drag-h', '0px');
      s.setProperty('--nc-drag-w', '0px');
      s.setProperty('--nc-angle', '0rad');
      s.setProperty('--nc-h', `${rect.height}px`);
      s.setProperty('--nc-x1', `${rect.x}px`);
      s.setProperty('--nc-y1', `${rect.y}px`);
      s.setProperty('--nc-x2', `${rect.x}px`);
      s.setProperty('--nc-y2', `${rect.y}px`);
      s.setProperty('--nc-vis', 'hidden');
      if (this._cursor) this._cursor.className = 'nc-caret';
    }

    _animate(rect) {
      this._styleCount = (this._styleCount + 1) % 2;

      const prev   = this._lastPos;
      const dx     = rect.x - prev.x;
      const dy     = prev.y - rect.y;
      const angle  = Math.atan2(dx, dy) + Math.PI / 2;
      const dist   = Math.sqrt(dx * dx + dy * dy);
      const dragH  = Math.abs(Math.sin(angle)) * 8
                   + Math.abs(Math.cos(angle)) * rect.height;

      const s = this._wrapper.style;
      s.setProperty('--nc-drag-h', `${dragH}px`);
      s.setProperty('--nc-drag-w', `${dist}px`);
      s.setProperty('--nc-angle', `${angle}rad`);
      s.setProperty('--nc-h', `${rect.height}px`);
      s.setProperty('--nc-x1', `${prev.x}px`);
      s.setProperty('--nc-y1', `${prev.y}px`);
      s.setProperty('--nc-x2', `${rect.x}px`);
      s.setProperty('--nc-y2', `${rect.y}px`);
      s.setProperty('--nc-vis', 'visible');

      // [FIX] Update _lastPos synchronously so the next _tick
      // never reads a stale previous position.
      this._lastPos = rect;

      requestAnimationFrame(() => {
        // Only re-assign className to restart the CSS animation
        if (this._cursor) {
          this._cursor.className = `nc-caret nc-caret-${this._styleCount}`;
        }
      });
    }

    _onWheel() {
      if (!this._datumEl) return;

      // =scroll guard=
      // Во время скролла декоративный курсор не должен компенсировать позицию:
      // иначе fixed-слой визуально «ездит» по экрану отдельно от поля ввода.
      this._hide();

      if (this._scrollBusy) return;
      this._scrollBusy = true;

      const MAX_SCROLL_FRAMES = 90; // ~1.5s @ 60fps
      const tick = (prev, frame = 0) => {
        requestAnimationFrame(() => {
          if (!this._datumEl || !this._datumEl.isConnected || frame > MAX_SCROLL_FRAMES) {
            this._datumEl    = null;
            this._scrollBusy = false;
            this._resync({ animate: false });
            return;
          }
          try {
            const cur = this._datumEl.getBoundingClientRect().top;
            const elScroll = `${this._datumEl.scrollLeft || 0}:${this._datumEl.scrollTop || 0}`;
            const state = `${cur}:${elScroll}`;

            if (prev === false || prev !== state) {
              tick(state, frame + 1);
            } else {
              this._scrollBusy = false;
              this._resync({ animate: false });
            }
          } catch (_) {
            this._scrollBusy = false;
            this._hide();
          }
        });
      };

      tick(false);
    }

    destroy() {
      for (const { target, type, fn, opts } of this._handlers) {
        target.removeEventListener(type, fn, opts);
      }
      this._handlers = [];
      this._wrapper?.remove();
      this._wrapper = null;
      this._cursor  = null;
      this._datumEl = null;
      this._lastPos = null;

      // Clean up cached mirror
      if (_mirrorCache.mirror?.parentNode) {
        _mirrorCache.mirror.parentNode.removeChild(_mirrorCache.mirror);
      }
      _mirrorCache = { el: null, mirror: null };
    }
  }


  // ── Public API ────────────────────────────────────────────────────────────

  function init() {
    if (_instance || !_enabled) return;
    _instance = new CursorEngine();
  }

  function dispose() {
    _instance?.destroy();
    _instance = null;
  }

  /**
   * Enable or disable the cursor effect.
   * @param {boolean} on
   */
  function setEnabled(on) {
    _enabled = Boolean(on);
    _enabled ? init() : dispose();
  }

  /** @returns {boolean} */
  function getEnabled() { return _enabled; }

  return { init, dispose, setEnabled, getEnabled };

})();

window.NinjaCursor = NinjaCursor;