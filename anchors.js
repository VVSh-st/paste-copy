// file_name: anchors.js

/* ============================================================
   Anchors — 3 buttons: set, navigate, clear
   ============================================================ */
const Anchors = (() => {
  'use strict';

  let _navIdx = -1;
  let _palette = null;
  let _paletteOutsideHandler = null;
  let _paletteOutsideTimer = null;
  let _longPressTimer = null;
  let _longPressTriggered = false;

  const JUMP_RETRY_LIMIT = 5;
  const JUMP_RETRY_DELAY = 60;
  const FLASH_DURATION = 1400;
  const PALETTE_DELETE_CONFIRM_MS = 1800;
  const LONG_PRESS_MS = 500;
  const CLEAR_CONFIRM_MS = 2500;
  const SCROLL_RENDER_DEBOUNCE_MS = 300;

  /* ---- helpers ---- */
  function uid() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? 'anc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : 'anc_' + Math.random().toString(36).slice(2, 10);
  }

  function _escapeCssIdent(value) {
    const str = String(value || '');
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(str);
    }
    return str.replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch.charCodeAt(0).toString(16) + ' ');
  }

  /* ---- state access ---- */
  function _getAnchors() {
    const tab = State.getActive();
    if (!tab) return [];
    if (!tab.anchors) tab.anchors = [];
    return tab.anchors;
  }

  function _getAllAnchors() {
    return State.getAll().flatMap(t => (t.anchors || []).map(a => ({ ...a, _tabName: t.name })));
  }

  function _findTabForAnchor(anchor) {
    return State.getAll().find(t => t.id === anchor.tabId) || null;
  }

  function _findBlockById(blocks, id) {
    for (const b of blocks) {
      if (b.id === id) return b;
      if (b.type === 'group' && b.children) {
        const found = _findBlockById(b.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  /* ---- core actions ---- */
  function setAnchor(ta, blockId) {
    if (!ta) return;
    const tab = State.getActive();
    if (!tab) {
      Toast.show('Активная вкладка не найдена', 'error');
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const snippet = (ta.value || '').slice(start, Math.min(start + 30, end || start + 30)).replace(/\n/g, ' ');

    const blk = _findBlockById(tab.blocks || [], blockId);
    const subtabIdx = blk ? (blk.activeSubtab ?? null) : null;

    // Если нет выделенного текста — используем название блока
    let finalSnippet = snippet;
    if (!finalSnippet && blk) {
      const title = (blk.title || '').trim();
      finalSnippet = title ? title.slice(0, 20) : '(пусто)';
    }

    const anchorId = uid();

    State.updateLive(t => {
      if (!t.anchors) t.anchors = [];
      t.anchors.push({
        id: anchorId,
        tabId: tab.id,
        blockId: blockId,
        subtabIdx: subtabIdx,
        start: start,
        end: end,
        snippet: finalSnippet,
        createdAt: Date.now(),
      });
    });

    _navIdx = _getAllAnchors().findIndex(a => a.id === anchorId);
    Toast.show(`Якорь #${_getAnchors().length} установлен ✓`, 'success');
    requestAnimationFrame(() => Blocks.refreshAllAnchorCounts());
  }

  function navigateAnchor(delta) {
    const anchors = _getAllAnchors();
    if (!anchors.length) { Toast.show('Нет якорей', 'info'); return; }
    _navIdx = (_navIdx + delta + anchors.length) % anchors.length;
    _jumpToAnchor(anchors[_navIdx]);
    Toast.show(`Якорь ${_navIdx + 1}/${anchors.length}`, 'success');
  }

  function clearAnchors() {
    const allAnchors = _getAllAnchors();
    if (!allAnchors.length) { Toast.show('Нет якорей', 'info'); return; }
    const count = allAnchors.length;
    _navIdx = -1;
    State.update(() => {
      for (const tab of State.getAll()) {
        tab.anchors = [];
      }
    });
    Toast.show(`Удалено ${count} якорей ✓`, 'success');
    document.querySelectorAll('.anchor-marker-line, .anchor-marker-gutter').forEach(m => m.remove());
    Blocks.refreshAllAnchorCounts();
  }

  function clearTabAnchors(blockId) {
    const tab = State.getActive();
    if (!tab) return;
    const anchors = tab.anchors || [];
    const blk = _findBlockById(tab.blocks || [], blockId);
    const activeSub = blk ? (blk.activeSubtab ?? null) : null;
    const toRemove = anchors.filter(a => a.blockId === blockId && (a.subtabIdx == null || a.subtabIdx === activeSub));
    if (!toRemove.length) { Toast.show('Нет якорей на вкладке блока', 'info'); return; }
    const count = toRemove.length;
    _navIdx = -1;
    const removeIds = new Set(toRemove.map(a => a.id));
    State.update(() => { tab.anchors = anchors.filter(a => !removeIds.has(a.id)); });
    Toast.show(`Удалено ${count} якорей с вкладки блока ✓`, 'success');
    document.querySelectorAll('.anchor-marker-line, .anchor-marker-gutter').forEach(m => m.remove());
    Blocks.refreshAllAnchorCounts();
  }

  function _jumpToAnchor(anchor, _depth) {
    _depth = (_depth || 0) + 1;
    if (_depth > JUMP_RETRY_LIMIT) { Toast.show('Не удалось перейти к якорю', 'error'); return; }
    const tab = State.getActive();
    if (!tab || anchor.tabId !== tab.id) {
      if (!_findTabForAnchor(anchor)) {
        Toast.show('Вкладка якоря не найдена', 'error');
        return;
      }
      State.setActive(anchor.tabId);
      setTimeout(() => _jumpToAnchor(anchor, _depth), JUMP_RETRY_DELAY);
      return;
    }
    const blk = _findBlockById(tab.blocks, anchor.blockId);
    if (!blk) { Toast.show('Блок не найден', 'error'); return; }
    if (blk.collapsed) State.update(() => { blk.collapsed = false; });
    if (anchor.subtabIdx != null && blk.activeSubtab !== anchor.subtabIdx) {
      State.update(() => { blk.activeSubtab = anchor.subtabIdx; });
    }

    // Ждём 2 кадра чтобы DOM обновился после смены вкладки/субвкладки
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const blockEl = document.querySelector(`.block[data-id="${_escapeCssIdent(anchor.blockId)}"]`);
      if (!blockEl) return;
      blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      blockEl.classList.remove('anchor-flash');
      void blockEl.offsetWidth;
      blockEl.classList.add('anchor-flash');
      setTimeout(() => blockEl.classList.remove('anchor-flash'), FLASH_DURATION);

      const ta = blockEl.querySelector('textarea.block-textarea');
      if (ta) {
        ta.focus({ preventScroll: true });
        const s = Math.min(anchor.start, ta.value.length);
        const e = Math.min(anchor.end, ta.value.length);
        ta.setSelectionRange(s, e);
        const pos = _measurePos(ta, s);
        const cs = getComputedStyle(ta);
        const pt = parseFloat(cs.paddingTop) || 0;
        const target = Math.max(0, pos.y - pt - ta.clientHeight / 2);
        // Восстанавливаем скролл после auto-scroll браузера
        requestAnimationFrame(() => {
          ta.scrollTop = target;
          // Плавная докрутка
          const start = ta.scrollTop;
          const dist = target - start;
          if (Math.abs(dist) > 1) {
            const dur = Math.min(350, Math.abs(dist) * 1.5);
            const t0 = performance.now();
            const ease = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            const tick = now => {
              const p = Math.min((now - t0) / dur, 1);
              ta.scrollTop = start + dist * ease(p);
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
        });
      }
    }));
  }

  function removeAnchorById(anchorId) {
    let removed = false;
    for (const tab of State.getAll()) {
      const anchors = tab.anchors || [];
      const idx = anchors.findIndex(a => a.id === anchorId);
      if (idx >= 0) {
        if (tab === State.getActive()) {
          State.updateLive(t => { t.anchors = t.anchors.filter(a => a.id !== anchorId); });
        } else {
          State.update(() => {
            tab.anchors = anchors.filter(a => a.id !== anchorId);
          });
        }
        removed = true;
        break;
      }
    }
    if (!removed) return;
    const all = _getAllAnchors();
    if (_navIdx >= all.length) _navIdx = all.length - 1;
    _renderMarkersAll();
    Blocks.refreshAllAnchorCounts();
  }

  /* ---- palette ---- */
  function _closePalette() {
    if (_palette) { _palette.remove(); _palette = null; }
    document.removeEventListener('keydown', _onPaletteKeydown, true);
    if (_paletteOutsideTimer) {
      clearTimeout(_paletteOutsideTimer);
      _paletteOutsideTimer = null;
    }
    if (_paletteOutsideHandler) {
      document.removeEventListener('mousedown', _paletteOutsideHandler, true);
      _paletteOutsideHandler = null;
    }
  }

  function _onPaletteKeydown(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      _closePalette();
    }
  }

  function _showPalette(btn) {
    _closePalette();
    const anchors = _getAllAnchors();
    if (!anchors.length) { Toast.show('Нет якорей', 'info'); return; }

    _palette = document.createElement('div');
    _palette.className = 'anchor-palette';
    _palette._anchorBtn = btn;
    _palette.setAttribute('role', 'listbox');
    document.body.appendChild(_palette);
    document.addEventListener('keydown', _onPaletteKeydown, true);

    anchors.forEach((a, idx) => {
      const row = document.createElement('div');
      row.className = 'slash-item' + (idx === _navIdx ? ' focused' : '');
      row.setAttribute('role', 'option');

      const kind = document.createElement('span');
      kind.className = 'slash-kind';
      kind.textContent = '⚓';

      const text = document.createElement('span');
      text.className = 'slash-text';
      text.textContent = (a.snippet || '').slice(0, 20) + ((a.snippet || '').length > 20 ? '...' : '');

      const del = document.createElement('span');
      del.className = 'anchor-palette-del';
      del.textContent = '✕';
      del.title = 'Удалить якорь';
      del.addEventListener('click', ev => {
        ev.stopPropagation();
        removeAnchorById(a.id);
        _showPalette(_palette?._anchorBtn);
        Toast.show('Якорь удалён', 'success');
      });

      row.addEventListener('click', ev => {
        if (del.contains(ev.target)) return;
        _navIdx = idx;
        _jumpToAnchor(a);
        _closePalette();
      });

      row.append(kind, text, del);
      _palette.appendChild(row);
    });

    const rect = btn.getBoundingClientRect();
    _palette.style.left = rect.left + 'px';
    _palette.style.top = (rect.bottom + 4) + 'px';
    requestAnimationFrame(() => {
      if (!_palette) return;
      const pr = _palette.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) _palette.style.left = Math.max(4, window.innerWidth - pr.width - 8) + 'px';
      if (pr.bottom > window.innerHeight - 8) _palette.style.top = Math.max(4, rect.top - pr.height - 4) + 'px';
    });
    _paletteOutsideTimer = setTimeout(() => {
      _paletteOutsideTimer = null;
      _paletteOutsideHandler = ev => {
        if (_palette && !_palette.contains(ev.target)) _closePalette();
      };
      document.addEventListener('mousedown', _paletteOutsideHandler, true);
    }, 100);
  }

  /* ---- mirror for line-wrap measurement ----
     ⚠️  НЕ МЕНЯТЬ _measurePos / _renderMarkers / _renderMarkersNoGutter без веской причины.
     Текущий паттерн (TreeWalker+Range через _getMirror на document.body + rawTop = pos.y - scrollY - taPt)
     отлажен и работает корректно. Любые «улучшения» (span-based, local mirror, line-count)
     приводили к систематическим сдвигам маркера на 1+ строку. ---- */
  let _mirror = null;

  function _getMirror(ta) {
    if (!_mirror) {
      _mirror = document.createElement('div');
      _mirror.style.cssText = 'position:absolute;top:0;left:0;visibility:hidden;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;pointer-events:none;z-index:-1;box-sizing:content-box;border:none;padding:0;margin:0;';
      document.body.appendChild(_mirror);
    }
    const cs = getComputedStyle(ta);
    _mirror.style.font = cs.font;
    _mirror.style.letterSpacing = cs.letterSpacing;
    _mirror.style.lineHeight = cs.lineHeight;
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    _mirror.style.width = Math.max(0, ta.clientWidth - pl - pr) + 'px';
    return _mirror;
  }

  function _measurePos(ta, charPos) {
    const cs = getComputedStyle(ta);
    const pt = parseFloat(cs.paddingTop) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0;
    if (charPos <= 0) return { x: pl, y: pt };

    const mirror = _getMirror(ta);
    const value = ta.value.substring(0, Math.min(charPos, ta.value.length));
    mirror.textContent = value;

    const walker = document.createTreeWalker(mirror, NodeFilter.SHOW_TEXT);
    let remaining = charPos;
    let targetNode = null;
    let targetOffset = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.textContent.length) {
        targetNode = node;
        targetOffset = remaining;
        break;
      }
      remaining -= node.textContent.length;
    }

    if (!targetNode) {
      mirror.textContent = ta.value.substring(0, charPos);
      return { x: pl, y: pt + mirror.scrollHeight };
    }

    try {
      const range = document.createRange();
      range.setStart(targetNode, targetOffset);
      range.collapse(true);
      const marker = document.createElement('span');
      marker.textContent = '\u200B';
      range.insertNode(marker);
      const mr = marker.getBoundingClientRect();
      const mir = mirror.getBoundingClientRect();
      const x = pl + mr.left - mir.left;
      const y = pt + mr.top - mir.top;
      if (marker.parentNode) marker.parentNode.removeChild(marker);
      return { x: x, y: y };
    } catch (_) {
      mirror.querySelectorAll('span').forEach(m => m.remove());
      mirror.textContent = ta.value.substring(0, charPos);
      return { x: pl, y: pt + mirror.scrollHeight };
    }
  }

  /* ---- marker rendering (DOM overlay inside current-line-wrap) ---- */
  const MARKER_KEY = 'anchor-markers-enabled';
  const MARKER_BG_KEY = 'anchor-bg-enabled';
  const MARKER_COLOR_KEY = 'anchor-marker-color';
  const DEFAULT_MARKER_COLOR = '#1DD110';

  function _sanitizeMarkerColor(value) {
    const color = String(value || '').trim();
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return color;
    if (/^rgba?\(\s*(\d{1,3}\s*,\s*){2}\d{1,3}(\s*,\s*(0|1|0?\.\d+))?\s*\)$/i.test(color)) return color;
    return DEFAULT_MARKER_COLOR;
  }

  function getMarkerSettings() {
    return {
      lineMarkers: localStorage.getItem(MARKER_KEY) !== 'false',
      bgHighlight: localStorage.getItem(MARKER_BG_KEY) !== 'false',
      color: _sanitizeMarkerColor(localStorage.getItem(MARKER_COLOR_KEY) || DEFAULT_MARKER_COLOR),
    };
  }

  function setMarkerSetting(key, value) {
    if (key === 'lineMarkers') localStorage.setItem(MARKER_KEY, String(value));
    else if (key === 'bgHighlight') localStorage.setItem(MARKER_BG_KEY, String(value));
    else if (key === 'color') localStorage.setItem(MARKER_COLOR_KEY, _sanitizeMarkerColor(value));
    _renderMarkersAll();
  }

  function _renderMarkersAll() {
    document.querySelectorAll('.block[data-id]').forEach(el => {
      const ta = el.querySelector('textarea.block-textarea');
      if (ta) _renderMarkers(el, ta);
    });
  }

  function _getLineHeight(ta) {
    const cs = getComputedStyle(ta);
    return parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 12) * 1.65;
  }

  function _createLineMarker(top, height, color) {
    const m = document.createElement('div');
    m.className = 'anchor-marker-line';
    m.style.cssText = 'position:absolute;left:0;width:3px;height:' + height + 'px;top:' + top + 'px;border-radius:0 2px 2px 0;pointer-events:none;z-index:4;background:' + color + ';opacity:0.85;box-shadow:0 0 6px ' + color + '44;';
    return m;
  }

  function _renderMarkers(blockEl, ta) {
    blockEl.querySelectorAll('.anchor-marker-line, .anchor-marker-gutter').forEach(m => m.remove());

    const anchors = _getAnchors();
    const settings = getMarkerSettings();
    const blockId = blockEl.dataset.id;
    const blk = _findBlockById(State.getActive()?.blocks || [], blockId);
    const activeSub = blk ? blk.activeSubtab : null;
    const blockAnchors = anchors.filter(a => a.blockId === blockId && (a.subtabIdx == null || a.subtabIdx === activeSub));
    if (!blockAnchors.length) return;

    const wrap = ta.closest('.current-line-wrap') || ta.parentElement;
    if (!wrap) return;
    wrap.style.position = 'relative';

    const lineHeight = _getLineHeight(ta);
    const scrollY = ta.scrollTop;
    const taCs = getComputedStyle(ta);
    const taPt = parseFloat(taCs.paddingTop) || 0;

    blockAnchors.forEach((anchor, localIdx) => {
      const pos = _measurePos(ta, anchor.start);
      const rawTop = pos.y - scrollY - taPt;
      const wrapH = wrap.clientHeight;
      const idx = anchors.indexOf(anchor);
      const inView = rawTop + lineHeight >= 0 && rawTop <= wrapH;

      if (settings.lineMarkers) {
        let mTop, stuck = '';
        if (rawTop + lineHeight < 0) {
          mTop = 2;
          stuck = ' anchor-stuck-top';
        } else if (rawTop > wrapH) {
          mTop = Math.max(2, wrapH - lineHeight - 2);
          stuck = ' anchor-stuck-bottom';
        } else {
          mTop = Math.max(0, Math.min(rawTop + 12, wrapH - lineHeight));
        }
        const mHeight = Math.max(2, lineHeight - 12);
        const m = _createLineMarker(mTop, mHeight, settings.color);
        if (stuck) m.className += stuck;
        m.title = 'Якорь #' + (idx + 1) + ': ' + (anchor.snippet || '');
        wrap.appendChild(m);
      }

      if (inView && settings.bgHighlight && anchor.start !== anchor.end) {
        const endPos = _measurePos(ta, anchor.end);
        const wrapW = wrap.clientWidth || (ta.clientWidth + (parseFloat(taCs.paddingLeft) || 0));
        const rawEndTop = endPos.y - scrollY - taPt;
        const multiLine = Math.abs(rawEndTop - rawTop) > lineHeight * 0.5;
        let selW, gTop, gHeight;
        if (multiLine) {
          const topLine = Math.min(rawTop, rawEndTop);
          const bottomLine = Math.max(rawTop, rawEndTop);
          selW = wrapW;
          gTop = Math.max(0, topLine + 2);
          gHeight = Math.max(lineHeight - 9, bottomLine - topLine + lineHeight - 9);
        } else {
          selW = Math.max(2, Math.abs(endPos.x - pos.x));
          gTop = Math.max(0, Math.min(rawTop + 12, wrapH - lineHeight));
          gHeight = Math.max(2, lineHeight - 9);
        }
        const gLeft = multiLine ? 0 : Math.min(pos.x, endPos.x);
        if (!multiLine && gLeft + selW > wrapW) selW = Math.max(2, wrapW - gLeft);
        const g = document.createElement('div');
        g.className = 'anchor-marker-gutter';
        g.style.cssText = 'position:absolute;height:' + gHeight + 'px;top:' + gTop + 'px;pointer-events:none;z-index:2;background:' + settings.color + '33;border-radius:2px;left:' + gLeft + 'px;width:' + selW + 'px;';
        wrap.appendChild(g);
      }
    });
  }

  function _renderMarkersNoGutter(blockEl, ta) {
    blockEl.querySelectorAll('.anchor-marker-line, .anchor-marker-gutter').forEach(m => m.remove());
    const anchors = _getAnchors();
    const settings = getMarkerSettings();
    const blockId = blockEl.dataset.id;
    const blk = _findBlockById(State.getActive()?.blocks || [], blockId);
    const activeSub = blk ? blk.activeSubtab : null;
    const blockAnchors = anchors.filter(a => a.blockId === blockId && (a.subtabIdx == null || a.subtabIdx === activeSub));
    if (!blockAnchors.length) return;
    const wrap = ta.closest('.current-line-wrap') || ta.parentElement;
    if (!wrap) return;
    wrap.style.position = 'relative';
    const lineHeight = _getLineHeight(ta);
    const scrollY = ta.scrollTop;
    const taPt = parseFloat(getComputedStyle(ta).paddingTop) || 0;
    const wrapH = wrap.clientHeight;
    blockAnchors.forEach(anchor => {
      const pos = _measurePos(ta, anchor.start);
      const rawTop = pos.y - scrollY - taPt;
      if (!settings.lineMarkers) return;
      let mTop, stuck = '';
      if (rawTop + lineHeight < 0) {
        mTop = 2;
        stuck = ' anchor-stuck-top';
      } else if (rawTop > wrapH) {
        mTop = Math.max(2, wrapH - lineHeight - 2);
        stuck = ' anchor-stuck-bottom';
      } else {
        mTop = Math.max(0, Math.min(rawTop + 12, wrapH - lineHeight));
      }
      const mHeight = Math.max(2, lineHeight - 12);
      const m = _createLineMarker(mTop, mHeight, settings.color);
      if (stuck) m.className += stuck;
      const idx = anchors.indexOf(anchor);
      m.title = 'Якорь #' + (idx + 1) + ': ' + (anchor.snippet || '');
      wrap.appendChild(m);
    });
  }

  /* ---- block buttons ---- */
  const SVG_ANCHOR = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="4.5" r="2.5"/><line x1="10" y1="7" x2="10" y2="18"/><path d="M6 12.5H4a8 8 0 0 0 12 0h-2"/></svg>';
  const SVG_LEFT = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 4 7 10 13 16"/></svg>';
  const SVG_RIGHT = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 4 13 10 7 16"/></svg>';

  function createBlockAnchorButtons(blockId, ta) {
    const group = document.createElement('span');
    group.className = 'anchor-btn-group anchor-btn-block';

    /* -- long-press helper -- */
    function _makeLongPress(el, onLongPress) {
      let started = false;
      let triggered = false;
      const start = () => {
        started = true; triggered = false;
        clearTimeout(_longPressTimer);
        _longPressTimer = setTimeout(() => { if (started) { triggered = true; onLongPress(); } }, LONG_PRESS_MS);
      };
      const stop = () => { started = false; clearTimeout(_longPressTimer); };
      el.addEventListener('pointerdown', start);
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('pointerleave', stop);
      return () => triggered;
    }

    /* -- left button: click = prev anchor, long press = clear tab anchors -- */
    const leftBtn = document.createElement('button');
    leftBtn.type = 'button';
    leftBtn.className = 'block-tool-btn anchor-btn';
    leftBtn.title = 'Предыдущий якорь · Длинное нажатие — очистить якоря вкладки';
    leftBtn.innerHTML = SVG_LEFT;
    const isLongLeft = _makeLongPress(leftBtn, () => clearTabAnchors(blockId));
    leftBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (isLongLeft()) { e.preventDefault(); return; }
      navigateAnchor(-1);
    });

    /* -- center button: click = set anchor, long press = palette -- */
    const setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.className = 'block-tool-btn anchor-btn';
    setBtn.title = 'Установить якорь · Длинное нажатие — список якорей';
    setBtn.innerHTML = SVG_ANCHOR;
    const isLongSet = _makeLongPress(setBtn, () => _showPalette(setBtn));
    setBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (isLongSet()) { e.preventDefault(); return; }
      setAnchor(ta, blockId);
    });

    /* -- right button: click = next anchor, long press = clear tab anchors -- */
    const rightBtn = document.createElement('button');
    rightBtn.type = 'button';
    rightBtn.className = 'block-tool-btn anchor-btn';
    rightBtn.title = 'Следующий якорь · Длинное нажатие — очистить якоря вкладки';
    rightBtn.innerHTML = SVG_RIGHT;
    const isLongRight = _makeLongPress(rightBtn, () => clearTabAnchors(blockId));
    rightBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (isLongRight()) { e.preventDefault(); return; }
      navigateAnchor(1);
    });

    group.appendChild(leftBtn);
    group.appendChild(setBtn);
    group.appendChild(rightBtn);
    return group;
  }

  /* ---- hotkeys ---- */
  function _setupHotkeys() {
    document.addEventListener('keydown', e => {
      if (!e.shiftKey || !(e.ctrlKey || e.metaKey)) return;
      if (e.key === '1') {
        e.preventDefault();
        const ta = document.querySelector('textarea.block-textarea:focus') || document.querySelector('.block:hover textarea.block-textarea');
        if (ta) { const bel = ta.closest('.block[data-id]'); if (bel) setAnchor(ta, bel.dataset.id); }
        else Toast.show('Кликните в текстовый блок', 'info');
      } else if (e.key === '2') { e.preventDefault(); navigateAnchor(1); }
      else if (e.key === '3') { e.preventDefault(); clearAnchors(); }
    });
  }

  /* ---- init ---- */
  function init() {
    _setupHotkeys();
    let _liveTimer = null;
    const rerender = () => _renderMarkersAll();
    const debouncedRerender = () => { clearTimeout(_liveTimer); _liveTimer = setTimeout(rerender, 150); };
    State.onChange(rerender);
    State.onLive(debouncedRerender);
    let _scrollTimer = null;
    let _scrollRaf = null;
    document.addEventListener('scroll', e => {
      const ta = e.target;
      if (ta.classList && ta.classList.contains('block-textarea')) {
        const bel = ta.closest('.block[data-id]');
        if (!bel) return;
        if (_scrollRaf) return;
        _scrollRaf = requestAnimationFrame(() => {
          _scrollRaf = null;
          if (bel.isConnected) _renderMarkersNoGutter(bel, ta);
        });
        clearTimeout(_scrollTimer);
        _scrollTimer = setTimeout(() => {
          if (bel.isConnected) _renderMarkers(bel, ta);
        }, SCROLL_RENDER_DEBOUNCE_MS);
      }
    }, { capture: true, passive: true });
    document.addEventListener('focusin', e => {
      const ta = e.target;
      if (ta.classList && ta.classList.contains('block-textarea')) {
        const bel = ta.closest('.block[data-id]');
        if (bel) {
          requestAnimationFrame(() => _renderMarkers(bel, ta));
        }
      }
    }, true);
    document.addEventListener('input', e => {
      const ta = e.target;
      if (ta.classList && ta.classList.contains('block-textarea')) {
        const bel = ta.closest('.block[data-id]');
        if (bel) {
          clearTimeout(ta._anchorInputTimer);
          ta._anchorInputTimer = setTimeout(() => {
            if (bel.isConnected) _renderMarkers(bel, ta);
          }, 150);
        }
      }
    }, true);
  }

  return {
    init, setAnchor, navigateAnchor, clearAnchors,
    getMarkerSettings, setMarkerSetting,
    _renderMarkersAll, _getAnchors, removeAnchorById,
    createBlockAnchorButtons,
  };
})();
