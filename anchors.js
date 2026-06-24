// file_name: anchors.js

/* ============================================================
   Anchors — 3 buttons: set, navigate, clear
   ============================================================ */
const Anchors = (() => {
  'use strict';

  let _navIdx = -1;
  let _palette = null;
  let _longPressTimer = null;
  let _longPressTriggered = false;

  /* ---- helpers ---- */
  function uid() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? 'anc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : 'anc_' + Math.random().toString(36).slice(2, 10);
  }

  function escHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---- state access ---- */
  function _getAnchors() {
    const tab = State.getActive();
    if (!tab) return [];
    if (!tab.anchors) tab.anchors = [];
    return tab.anchors;
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
    const anchors = _getAnchors();
    const tab = State.getActive();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const snippet = (ta.value || '').slice(start, Math.min(start + 30, end || start + 30)).replace(/\n/g, ' ');

    anchors.push({
      id: uid(),
      tabId: tab.id,
      blockId: blockId,
      subtabIdx: null,
      start: start,
      end: end,
      snippet: snippet || '(пусто)',
      createdAt: Date.now(),
    });
    _navIdx = anchors.length - 1;
    State.emit();
    Toast.show(`Якорь #${anchors.length} установлен ✓`, 'success');
    const blockEl = document.querySelector('.block[data-id="' + blockId + '"]');
    if (blockEl) _renderMarkers(blockEl, ta);
  }

  function navigateAnchor(delta) {
    const anchors = _getAnchors();
    if (!anchors.length) { Toast.show('Нет якорей', 'info'); return; }
    _navIdx = (_navIdx + delta + anchors.length) % anchors.length;
    _jumpToAnchor(anchors[_navIdx]);
    Toast.show(`Якорь ${_navIdx + 1}/${anchors.length}`, 'success');
  }

  function clearAnchors() {
    const tab = State.getActive();
    if (!tab) return;
    const count = (tab.anchors || []).length;
    if (!count) { Toast.show('Нет якорей', 'info'); return; }
    tab.anchors = [];
    _navIdx = -1;
    State.emit();
    Toast.show(`Удалено ${count} якорей ✓`, 'success');
    document.querySelectorAll('.block[data-id]').forEach(el => {
      const ta = el.querySelector('textarea.block-textarea');
      if (ta) el.querySelectorAll('.anchor-marker-line, .anchor-marker-gutter').forEach(m => m.remove());
    });
  }

  function _jumpToAnchor(anchor) {
    const tab = State.getActive();
    if (!tab || anchor.tabId !== tab.id) {
      State.setActive(anchor.tabId);
      requestAnimationFrame(() => _jumpToAnchor(anchor));
      return;
    }
    const blk = _findBlockById(tab.blocks, anchor.blockId);
    if (!blk) { Toast.show('Блок не найден', 'error'); return; }
    if (blk.collapsed) State.update(() => { blk.collapsed = false; });
    if (anchor.subtabIdx != null) State.updateLive(() => { blk.activeSubtab = anchor.subtabIdx; });

    requestAnimationFrame(() => {
      const blockEl = document.querySelector(`.block[data-id="${anchor.blockId}"]`);
      if (!blockEl) return;
      blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      blockEl.classList.remove('anchor-flash');
      void blockEl.offsetWidth;
      blockEl.classList.add('anchor-flash');
      setTimeout(() => blockEl.classList.remove('anchor-flash'), 1400);

      const ta = blockEl.querySelector('textarea.block-textarea');
      if (ta) {
        ta.focus({ preventScroll: true });
        const s = Math.min(anchor.start, ta.value.length);
        const e = Math.min(anchor.end, ta.value.length);
        ta.setSelectionRange(s, e);
        const linesBefore = ta.value.slice(0, s).split('\n').length - 1;
        const lineHeight = parseInt(getComputedStyle(ta).lineHeight, 10) || 18;
        ta.scrollTop = Math.max(0, linesBefore * lineHeight - ta.clientHeight / 2);
      }
    });
  }

  function removeAnchorById(anchorId) {
    const anchors = _getAnchors();
    const idx = anchors.findIndex(a => a.id === anchorId);
    if (idx < 0) return;
    anchors.splice(idx, 1);
    if (_navIdx >= anchors.length) _navIdx = anchors.length - 1;
    State.emit();
    _renderMarkersAll();
  }

  /* ---- palette ---- */
  function _closePalette() {
    if (_palette) { _palette.remove(); _palette = null; }
  }

  function _showPalette(btn) {
    _closePalette();
    const anchors = _getAnchors();
    if (!anchors.length) { Toast.show('Нет якорей', 'info'); return; }

    _palette = document.createElement('div');
    _palette.className = 'anchor-palette';
    _palette.setAttribute('role', 'listbox');
    document.body.appendChild(_palette);

    anchors.forEach((a, idx) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'slash-item' + (idx === _navIdx ? ' focused' : '');
      row.setAttribute('role', 'option');
      const preview = (a.snippet || '').slice(0, 20) + ((a.snippet || '').length > 20 ? '...' : '');
      row.innerHTML =
        '<span class="slash-hotkey">' + escHtml(String(idx + 1)) + '</span>' +
        '<span class="slash-kind">⚓</span>' +
        '<span class="slash-text">' + escHtml(preview) + '</span>';
      row.onmousedown = ev => { ev.preventDefault(); _navIdx = idx; _jumpToAnchor(a); _closePalette(); };
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
    setTimeout(() => document.addEventListener('click', _closePalette, { once: true }), 0);
  }

  /* ---- char width measurement ---- */
  let _measureCtx = null;
  let _cachedFont = '';
  let _cachedCharW = 0;

  function _charW(ta) {
    const cs = getComputedStyle(ta);
    const f = cs.fontSize + ' ' + cs.fontFamily;
    if (f === _cachedFont && _cachedCharW) return _cachedCharW;
    if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
    _measureCtx.font = f;
    _cachedCharW = _measureCtx.measureText('MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM').width / 40;
    _cachedFont = f;
    return _cachedCharW;
  }

  /* ---- marker rendering (DOM overlay inside current-line-wrap) ---- */
  const MARKER_KEY = 'anchor-markers-enabled';
  const MARKER_BG_KEY = 'anchor-bg-enabled';
  const MARKER_COLOR_KEY = 'anchor-marker-color';

  function getMarkerSettings() {
    return {
      lineMarkers: localStorage.getItem(MARKER_KEY) !== 'false',
      bgHighlight: localStorage.getItem(MARKER_BG_KEY) !== 'false',
      color: localStorage.getItem(MARKER_COLOR_KEY) || '#4f8ef7',
    };
  }

  function setMarkerSetting(key, value) {
    if (key === 'lineMarkers') localStorage.setItem(MARKER_KEY, String(value));
    else if (key === 'bgHighlight') localStorage.setItem(MARKER_BG_KEY, String(value));
    else if (key === 'color') localStorage.setItem(MARKER_COLOR_KEY, value);
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

  function _renderMarkers(blockEl, ta) {
    blockEl.querySelectorAll('.anchor-marker-line, .anchor-marker-gutter').forEach(m => m.remove());

    const anchors = _getAnchors();
    const settings = getMarkerSettings();
    const blockId = blockEl.dataset.id;
    const blockAnchors = anchors.filter(a => a.blockId === blockId);
    if (!blockAnchors.length) return;

    const wrap = ta.closest('.current-line-wrap') || ta.parentElement;
    if (!wrap) return;
    wrap.style.position = 'relative';

    const cs = getComputedStyle(ta);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const lineHeight = _getLineHeight(ta);
    const cw = _charW(ta);

    blockAnchors.forEach(anchor => {
      const textBefore = ta.value.slice(0, anchor.start);
      const lines = textBefore.split('\n');
      const lineIdx = lines.length - 1;
      const topPx = padTop + lineIdx * lineHeight - ta.scrollTop;

      if (topPx + lineHeight < -lineHeight || topPx > wrap.clientHeight + lineHeight) return;

      const idx = anchors.indexOf(anchor);

      if (settings.lineMarkers) {
        const m = document.createElement('div');
        m.className = 'anchor-marker-line';
        m.style.cssText = 'position:absolute;left:0;width:3px;height:' + lineHeight + 'px;top:' + topPx + 'px;border-radius:0 2px 2px 0;pointer-events:none;z-index:2;background:' + settings.color + ';opacity:0.85;box-shadow:0 0 6px ' + settings.color + '44;';
        m.title = 'Якорь #' + (idx + 1) + ': ' + (anchor.snippet || '');
        wrap.appendChild(m);
      }

      if (settings.bgHighlight && anchor.start !== anchor.end) {
        const charsBefore = lines[lineIdx].length;
        const selLen = anchor.end - anchor.start;
        const leftPx = padLeft + charsBefore * cw;
        const selW = Math.max(2, selLen * cw);
        const g = document.createElement('div');
        g.className = 'anchor-marker-gutter';
        g.style.cssText = 'position:absolute;height:' + lineHeight + 'px;top:' + topPx + 'px;pointer-events:none;z-index:0;background:' + settings.color + '33;border-radius:2px;left:' + leftPx + 'px;width:' + selW + 'px;';
        wrap.appendChild(g);
      }
    });
  }

  /* ---- block buttons ---- */
  const SVG_ANCHOR = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="4.5" r="2.5"/><line x1="10" y1="7" x2="10" y2="18"/><path d="M6 12.5H4a8 8 0 0 0 12 0h-2"/></svg>';

  function createBlockAnchorButtons(blockId, ta) {
    const group = document.createElement('span');
    group.className = 'anchor-btn-group anchor-btn-block';

    const setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.className = 'block-tool-btn anchor-btn';
    setBtn.title = 'Установить якорь';
    setBtn.innerHTML = SVG_ANCHOR;
    setBtn.onclick = e => { e.stopPropagation(); setAnchor(ta, blockId); };

    const navBtn = document.createElement('button');
    navBtn.type = 'button';
    navBtn.className = 'block-tool-btn anchor-btn';
    navBtn.title = 'Навигация по якорям · Длинное нажатие — список';
    navBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a6 6 0 0 1 12 0"/><polyline points="4 10 1 7"/><polyline points="16 10 19 7"/></svg>';

    let longPressStarted = false;
    navBtn.addEventListener('mousedown', e => {
      longPressStarted = true; _longPressTriggered = false;
      _longPressTimer = setTimeout(() => { if (longPressStarted) { _longPressTriggered = true; _showPalette(navBtn); } }, 500);
    });
    navBtn.addEventListener('mouseup', () => { longPressStarted = false; clearTimeout(_longPressTimer); });
    navBtn.addEventListener('mouseleave', () => { longPressStarted = false; clearTimeout(_longPressTimer); });
    navBtn.addEventListener('click', e => { e.stopPropagation(); if (!_longPressTriggered) navigateAnchor(1); });

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'block-tool-btn anchor-btn anchor-btn-danger';
    clearBtn.title = 'Удалить все якоря';
    clearBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l12 12"/><path d="M16 4L4 16"/></svg>';
    let clearPending = false, clearTimer = null;
    clearBtn.onclick = e => {
      e.stopPropagation();
      if (!clearPending) {
        clearPending = true; clearBtn.classList.add('anchor-clear-pending');
        clearTimer = setTimeout(() => { clearPending = false; clearBtn.classList.remove('anchor-clear-pending'); }, 2500);
      } else { clearTimeout(clearTimer); clearBtn.classList.remove('anchor-clear-pending'); clearAnchors(); }
    };

    group.appendChild(setBtn);
    group.appendChild(navBtn);
    group.appendChild(clearBtn);
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
    State.onChange(() => _renderMarkersAll());
    document.addEventListener('scroll', e => {
      const ta = e.target;
      if (ta.classList && ta.classList.contains('block-textarea')) {
        const bel = ta.closest('.block[data-id]');
        if (bel) _renderMarkers(bel, ta);
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
