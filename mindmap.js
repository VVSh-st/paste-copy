const MindMap = (() => {
  let _overlay = null;
  let _panel = null;
  let _svg = null;
  let _viewport = null;
  let _mode = 'words';
  let _data = null;
  let _loading = false;
  let _resizeObs = null;

  let _zoom = 1, _panX = 0, _panY = 0;
  let _dragging = false, _lastX = 0, _lastY = 0, _movedEnough = false;
  let _velX = 0, _velY = 0, _inertiaRaf = null;

  let _rafPending = false;
  let _parallaxNX = 0, _parallaxNY = 0;
  let _wordsAnimatedForHash = null;

  const PALETTE = ['#4f8ef7', '#5cb87a', '#f0a050', '#e05c6a', '#a78bfa', '#f472b6', '#22d3ee', '#fbbf24'];
  const ROLE_COLORS = { topic: '#4f8ef7', action: '#5cb87a', modifier: '#a78bfa', entity: '#f0a050' };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let _requestSeq = 0;
  let _textHash = null;
  let _depthEls = [];
  let _abortController = null;

  function _wordKey(s) {
    return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  const STOP_WORDS_CODE = new Set([
    'string', 'object', 'undefined', 'typeof', 'return', 'null',
    'true', 'false', 'function', 'const', 'let', 'var',
    'date', 'math', 'json', 'number', 'boolean', 'error',
    'promise', 'class', 'async', 'await', 'new', 'this',
  ]);

  function _isGraphNoiseWord(w) {
    return STOP_WORDS_CODE.has(_wordKey(w));
  }

  function _hashString(s) {
    let h = 2166136261;
    s = String(s ?? '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function _rand01(seed) {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  }

  function _num(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function _isClusterNoiseWord(w) {
    const s = String(w ?? '').trim();
    const key = _wordKey(s);
    if (!s || s.length < 2) return true;
    if (STOP_WORDS_CODE.has(key)) return true;
    if (/^[._$]/.test(s)) return true;
    if (/[()[\]{}=;<>]/.test(s)) return true;
    if (s.includes('.')) return true;

    const CLUSTER_NOISE = new Set([
      'raf', 'rafid', 'requestanimationframe',
      'settimeout', 'cleartimeout', 'setinterval', 'clearinterval',
      'setattribute', 'getattribute', 'setproperty', 'removeproperty',
      'queryselector', 'queryselectorall',
      'addeventlistener', 'removeeventlistener',
      'getboundingclientrect', 'textcontent', 'innerhtml',
      'classlist', 'foreach', 'onclick', 'oninput', 'onkeydown',
      'console', 'document', 'window', 'localstorage', 'sessionstorage',
      'browserfocused', 'reduceemotion', 'focusstate',
      'persistmergedstate', 'applyremotestate', 'lastedittime',
      'subtaboffsets', 'observermap', 'pendingratios',
    ]);
    if (CLUSTER_NOISE.has(key.replace(/\s+/g, '').toLowerCase())) return true;

    if (s.length > 20 && /^[A-Za-z0-9_$-]+$/.test(s)) return true;
    if (/^(get|set|add|remove|update|render|handle|apply|create|query|focus|blur|persist|reduce|request|observe|resize)[A-Z]/.test(s)) return true;
    if (/(El|Ref|Ctx|Tmp|Idx|Id|Map|State|Cache|Offsets|Ratios)$/i.test(s) && s.length > 8) return true;
    if (/^(CPU|GPU|rAF|RAF)$/i.test(s)) return true;
    if (/^[A-Za-z]+(?:[A-Z][a-z0-9]+){2,}$/.test(s) && s.length > 12) return true;
    if (/(Effect|Handler|Listener|Manager|Controller|Service|Provider|Renderer)$/i.test(s) && s.length > 12) return true;
    return false;
  }

  function _normalizeData(raw, forcedWords) {
    const data = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    const dedupedWords = Array.isArray(forcedWords) ? forcedWords : [];
    const links = Array.isArray(data.links) ? data.links : [];
    const clusters = Array.isArray(data.clusters) ? data.clusters : [];
    const evidence = Array.isArray(data.evidence) ? data.evidence : [];
    const steps = Array.isArray(data.steps) ? data.steps : [];

    return {
      words: dedupedWords,

      links: (() => {
        const wordKeys = new Set(dedupedWords.map(w => _wordKey(w.w)));
        return links.slice(0, 200)
          .map(l => ({
            from: String(l?.from ?? '').slice(0, 80).trim(),
            to: String(l?.to ?? '').slice(0, 80).trim(),
            strength: _num(l?.strength, 0.3, 0, 1),
          }))
          .filter(l => l.from && l.to && l.from !== l.to
            && wordKeys.has(_wordKey(l.from)) && wordKeys.has(_wordKey(l.to)));
      })(),

      claim: String(data.claim ?? '').slice(0, 500),
      conclusion: String(data.conclusion ?? '').slice(0, 500),

      evidence: evidence.slice(0, 20).map(e => ({
        text: String(e?.text ?? '').slice(0, 500),
        supports: Boolean(e?.supports),
      })),

      clusters: clusters.slice(0, 10).map(cl => {
        const words = Array.isArray(cl?.words)
          ? cl.words
              .map(w => String(w).slice(0, 32).trim())
              .filter(Boolean)
              .filter(w => !_isClusterNoiseWord(w))
              .slice(0, 8)
          : [];
        return {
          topic: String(cl?.topic ?? '').slice(0, 100).trim(),
          words,
        };
      }).filter(cl => cl.topic || cl.words.length),

      hierarchy: normalizeHierarchy(data.hierarchy),
      steps: steps.slice(0, 20)
        .map((s, i) => ({
          order: _num(s?.order, i + 1, 1, 100),
          title: String(s?.title ?? '').slice(0, 150).trim(),
          desc: String(s?.desc ?? '').slice(0, 500).trim(),
        }))
        .filter(s => s.title || s.desc),
    };
  }

  function normalizeHierarchy(node, depth = 0, counter = { n: 0 }) {
    if (!node || typeof node !== 'object') return null;
    if (depth > 5 || counter.n > 120) return null;
    counter.n++;

    const children = Array.isArray(node.children)
      ? node.children.slice(0, 8)
          .map(child => normalizeHierarchy(child, depth + 1, counter))
          .filter(Boolean)
      : [];

    return {
      label: String(node.label ?? '').slice(0, 100),
      children,
    };
  }

  function _findBalancedJsonObjects(s) {
    const out = [];
    for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { out.push(s.slice(start, i + 1)); break; }
        }
      }
    }
    return out;
  }

  function _looksLikeMindmap(o) {
    const p = o?.mindmap && typeof o.mindmap === 'object' ? o.mindmap : o;
    return !!p && typeof p === 'object' && !Array.isArray(p) && (
      Array.isArray(p.words) || Array.isArray(p.links) ||
      Array.isArray(p.clusters) || Array.isArray(p.steps) ||
      p.hierarchy || p.claim || p.conclusion
    );
  }

  function _extractJsonObject(raw) {
    const s = String(raw ?? '').trim();
    try {
      const direct = JSON.parse(s);
      if (_looksLikeMindmap(direct)) return direct;
    } catch {}
    const fences = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    for (const m of fences) {
      try {
        const obj = JSON.parse(m[1].trim());
        if (_looksLikeMindmap(obj)) return obj;
      } catch {}
    }
    for (const c of _findBalancedJsonObjects(s)) {
      try {
        const obj = JSON.parse(c);
        if (_looksLikeMindmap(obj)) return obj;
      } catch {}
    }
    try { return JSON.parse(s); } catch {}
    for (const m of fences) {
      try { return JSON.parse(m[1].trim()); } catch {}
    }
    for (const c of _findBalancedJsonObjects(s)) {
      try { return JSON.parse(c); } catch {}
    }
    return null;
  }

  function _resetTransform() {
    _zoom = 1; _panX = 0; _panY = 0;
    if (_viewport) _viewport.setAttribute('transform', 'translate(0,0) scale(1)');
  }

  function _applyTransform() {
    if (_viewport) _viewport.setAttribute('transform', `translate(${_panX},${_panY}) scale(${_zoom})`);
  }

  function _ensureOverlay() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.className = 'mindmap-overlay';
    _overlay.innerHTML = `
      <div class="mindmap-panel">
        <div class="mindmap-controls">
          <button class="mindmap-btn" data-mode="words" title="Облако слов">W</button>
          <button class="mindmap-btn" data-mode="graph" title="Граф связей">G</button>
          <button class="mindmap-btn" data-mode="tree" title="Дерево аргументов">T</button>
          <button class="mindmap-btn" data-mode="clusters" title="Кластеры тем">C</button>
          <button class="mindmap-btn" data-mode="hierarchy" title="Иерархия тем">M</button>
          <button class="mindmap-btn" data-mode="timeline" title="Поток шагов">→</button>
          <button class="mindmap-btn mindmap-refresh" title="Обновить анализ">↻</button>
          <button class="mindmap-btn mindmap-close" title="Закрыть">✕</button>
        </div>
        <div class="mindmap-zoom">
          <input type="range" class="mindmap-zoom-range" min="40" max="400" value="100" step="1">
        </div>
        <div class="mindmap-status"></div>
        <div class="mindmap-canvas"></div>
      </div>`;
    document.body.appendChild(_overlay);

    _panel = _overlay.querySelector('.mindmap-panel');
    const canvas = _overlay.querySelector('.mindmap-canvas');

    _svg = document.createElementNS(SVG_NS, 'svg');
    _svg.setAttribute('width', '100%');
    _svg.setAttribute('height', '100%');
    _svg.style.display = 'block';
    canvas.appendChild(_svg);
    _setupSvgListeners();

    _overlay.addEventListener('click', e => {
      if (e.target === _overlay) close();
    });

    _overlay.addEventListener('contextmenu', e => {
      if (e.target === _overlay) { e.preventDefault(); close(); }
    });

    _overlay.querySelector('.mindmap-close').addEventListener('click', close);

    _overlay.querySelectorAll('.mindmap-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        _mode = btn.dataset.mode;
        _overlay.querySelectorAll('.mindmap-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
        _resetTransform();
        _syncZoomSlider();
        if (_data) _render();
      });
    });

    _overlay.querySelector('.mindmap-refresh').addEventListener('click', () => {
      if (_loading) return;
      const text = window.Preview?.getText?.() ?? '';
      if (!text.trim()) { window.Toast?.show('Превью пустое', 'info'); return; }

      _overlay.querySelector('.mindmap-status').textContent = 'Анализирую структуру...';
      _overlay.querySelector('.mindmap-refresh').classList.add('spinning');

      const localWords = _buildLocalWords(text);
      const localLinks = _buildLocalLinks(text, localWords);
      _data = {
        words: localWords, links: localLinks, claim: '', conclusion: '',
        evidence: [], clusters: [], hierarchy: null, steps: [], localOnly: true,
      };

      _render();
      _fetch(text);
    });

    function _setupProximityReveal(el, radius) {
      _overlay.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        el.classList.toggle('near', dist < radius);
      });
    }
    _setupProximityReveal(_overlay.querySelector('.mindmap-controls'), 150);
    _setupProximityReveal(_overlay.querySelector('.mindmap-zoom'), 120);

    const zoomRange = _overlay.querySelector('.mindmap-zoom-range');
    const zoomWrap = _overlay.querySelector('.mindmap-zoom');
    zoomRange.addEventListener('input', () => {
      const newZoom = zoomRange.value / 100;
      const rect = _svg.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      _panX = cx - (cx - _panX) * (newZoom / _zoom);
      _panY = cy - (cy - _panY) * (newZoom / _zoom);
      _zoom = newZoom;
      _applyTransform();
    });
    zoomRange.addEventListener('mousedown', () => zoomWrap.classList.add('dragging'));
    window.addEventListener('mouseup', () => zoomWrap.classList.remove('dragging'));
    zoomRange.addEventListener('dblclick', () => {
      _resetTransform();
      zoomRange.value = 100;
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _overlay?.classList.contains('visible')) close();
    });

    window.addEventListener('mousemove', e => {
      if (!_dragging) return;
      const dx = e.clientX - _lastX, dy = e.clientY - _lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) _movedEnough = true;
      if (_movedEnough) {
        _velX = dx; _velY = dy;
        _panX += dx; _panY += dy;
        _lastX = e.clientX; _lastY = e.clientY;
        _applyTransform();
      }
    });
    window.addEventListener('mouseup', () => {
      _dragging = false;
      if (_movedEnough && (Math.abs(_velX) + Math.abs(_velY) > 0.5)) _startInertia();
    });

    let _lastCanvasW = 0, _lastCanvasH = 0, _resizeRaf = null;
    _resizeObs = new ResizeObserver(() => {
      if (!_data || !_overlay?.classList.contains('visible')) return;
      cancelAnimationFrame(_resizeRaf);
      _resizeRaf = requestAnimationFrame(() => {
        const rect = _svg.getBoundingClientRect();
        const w = Math.round(rect.width), h = Math.round(rect.height);
        if (w === _lastCanvasW && h === _lastCanvasH) return;
        _lastCanvasW = w; _lastCanvasH = h;
        _resetTransform();
        _render();
      });
    });
    _resizeObs.observe(canvas);

    _panel.addEventListener('mousemove', e => {
      const r = _panel.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      const rotY = nx * 4;
      const rotX = -ny * 4;
      _panel.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    });
    _panel.addEventListener('mouseleave', () => {
      _panel.style.transform = '';
    });
  }

  function _gradIdFor(color) {
    return 'grad-' + color.replace('#', '');
  }

  function _ensureGradient(color) {
    if (_svg?.querySelector(`#${_gradIdFor(color)}`)) return;
    const defs = _svg?.querySelector('defs');
    if (!defs) return;
    const grad = document.createElementNS(SVG_NS, 'radialGradient');
    grad.setAttribute('id', _gradIdFor(color));
    grad.setAttribute('cx', '35%');
    grad.setAttribute('cy', '30%');
    grad.setAttribute('r', '70%');
    grad.innerHTML = `
      <stop offset="0%" stop-color="#fff" stop-opacity="0.9"/>
      <stop offset="35%" stop-color="${color}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.15"/>
    `;
    defs.appendChild(grad);
  }

  function _showWordCountAtClick(word, evt, sourceEl) {
    if (!_viewport || !_svg) return;
    const safeWord = String(word ?? '').slice(0, 100).trim();
    if (!safeWord) return;
    const sourceText = window.Preview?.getText?.() ?? '';
    const count = _findWordOccurrences(sourceText, safeWord).length;
    const rect = _svg.getBoundingClientRect();
    const svgX = (evt.clientX - rect.left - _panX) / _zoom;
    const svgY = (evt.clientY - rect.top - _panY) / _zoom;
    const color = sourceEl?.getAttribute?.('fill') || '#ffffff';
    const isCircle = sourceEl?.tagName === 'circle';
    const srcFontSize = isCircle
      ? (Number(sourceEl?.getAttribute?.('r')) || 16) * 1.2
      : (Number(sourceEl?.getAttribute?.('font-size')) || 18);
    const fontSize = srcFontSize * (isCircle ? 1.6 : 1.3);
    const fontWeight = '700';

    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${svgX}, ${svgY})`);

    const anim = document.createElementNS(SVG_NS, 'g');
    anim.setAttribute('class', 'mm-count-pop');

    const halo = document.createElementNS(SVG_NS, 'circle');
    halo.setAttribute('cx', '0'); halo.setAttribute('cy', '0');
    halo.setAttribute('r', String(Math.max(20, fontSize * 0.9)));
    halo.setAttribute('fill', color); halo.setAttribute('opacity', '0.2');
    halo.setAttribute('filter', 'url(#glow)');

    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '0'); t.setAttribute('y', '0');
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('font-family', 'var(--mono)');
    t.setAttribute('font-size', String(Math.max(18, fontSize)));
    t.setAttribute('font-weight', fontWeight); t.setAttribute('fill', '#ffffff');
    t.setAttribute('stroke', color); t.setAttribute('stroke-width', '2');
    t.setAttribute('filter', 'url(#glow)');
    t.textContent = String(count);

    anim.appendChild(halo); anim.appendChild(t);
    g.appendChild(anim);
    _viewport.appendChild(g);
    setTimeout(() => { if (anim.isConnected) anim.classList.add('vanish'); }, 3000);
    setTimeout(() => { g.remove(); }, 3700);
  }

  function _attachWordInteractions(el, word, cx, cy) {
    el.style.cursor = 'pointer';
    let clickTimer = null;
    el.addEventListener('click', e => {
      e.stopPropagation();
      clearTimeout(clickTimer);
      const evt = { clientX: e.clientX, clientY: e.clientY };
      clickTimer = setTimeout(() => {
        clickTimer = null;
        if (!_overlay?.classList.contains('visible')) return;
        _showWordCountAtClick(word, evt, el);
      }, 180);
    });
    el.addEventListener('dblclick', e => {
      e.stopPropagation();
      clearTimeout(clickTimer);
      clickTimer = null;
      _smoothZoomTo(cx, cy, 2);
    });
  }

  function _wrapTextLines(text, maxWidth, maxLines) {
    const approxCharW = 7;
    const maxChars = Math.max(4, Math.floor(maxWidth / approxCharW));

    const tokens = String(text ?? '')
      .split(/\s+/)
      .flatMap(token => {
        if (token.length <= maxChars) return [token];
        const chunks = [];
        for (let i = 0; i < token.length; i += maxChars) {
          chunks.push(token.slice(i, i + maxChars));
        }
        return chunks;
      });

    const lines = [];
    let line = '';

    tokens.forEach(w => {
      if (lines.length >= maxLines) return;
      const test = line ? `${line} ${w}` : w;
      if (test.length * approxCharW > maxWidth && line) {
        lines.push(line.trim());
        line = w;
      } else {
        line = test;
      }
    });

    if (line.trim() && lines.length < maxLines) lines.push(line.trim());
    return lines;
  }

  function _clusterTextLines(text, maxChars = 14, maxLines = 2) {
    const s = String(text ?? '').trim();
    if (!s) return [];
    const parts = s.split(/[\s-]+/).filter(Boolean);
    if (parts.length > 1) {
      const lines = [];
      let line = '';
      parts.forEach(part => {
        if (lines.length >= maxLines) return;
        const test = line ? `${line} ${part}` : part;
        if (test.length > maxChars && line) { lines.push(line); line = part; }
        else { line = test; }
      });
      if (line && lines.length < maxLines) lines.push(line);
      return lines.slice(0, maxLines);
    }
    return [s];
  }

  function _clusterWordFontSize(word, baseSize) {
    const len = String(word ?? '').trim().length;
    if (len > 22) return Math.max(10, baseSize - 3);
    if (len > 17) return Math.max(10, baseSize - 2);
    if (len > 13) return Math.max(10, baseSize - 1);
    return baseSize;
  }

  function _emptyMsg(msg) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', '50%'); t.setAttribute('y', '50%');
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('fill', 'var(--text2)'); t.setAttribute('font-size', '14');
    t.setAttribute('font-family', 'var(--mono)');
    t.textContent = msg;
    return t;
  }

  function _jumpToWord(word) {
    const safeWord = String(word ?? '').slice(0, 100).trim();
    if (!safeWord) return;

    const sourceText = window.Preview?.getText?.() ?? '';
    const occurrences = _findWordOccurrences(sourceText, safeWord);

    if (!occurrences.length) {
      window.Toast?.show(`"${safeWord}" не найдено в тексте`, 'info');
      return;
    }

    const key = _wordKey(safeWord);
    const prev = _jumpCursors.get(key) ?? -1;
    const next = (prev + 1) % occurrences.length;
    _jumpCursors.set(key, next);

    const target = occurrences[next];

    document.dispatchEvent(new CustomEvent('mindmap:jump-word', {
      detail: {
        word: safeWord,
        source: 'mindmap',
        exact: true,
        occurrenceIndex: next,
        occurrenceCount: occurrences.length,
        charIndex: target.index,
        length: target.length,
      }
    }));

    if (occurrences.length > 1) {
      window.Toast?.show(`"${safeWord}": вхождение ${next + 1} из ${occurrences.length}`, 'info');
    }

    close();
  }

  function _smoothZoomTo(targetX, targetY, targetZoom) {
    if (!_viewport || !_svg) return;
    cancelAnimationFrame(_inertiaRaf);
    const vp = _viewport;
    vp.style.transition = 'transform 0.4s cubic-bezier(.2,.8,.2,1)';
    const rect = _svg.getBoundingClientRect();
    _zoom = targetZoom;
    _panX = rect.width / 2 - targetX * targetZoom;
    _panY = rect.height / 2 - targetY * targetZoom;
    _applyTransform();
    _syncZoomSlider();
    setTimeout(() => { if (vp) vp.style.transition = ''; }, 400);
  }

  function _startInertia() {
    cancelAnimationFrame(_inertiaRaf);
    function tick() {
      _velX *= 0.92; _velY *= 0.92;
      _panX += _velX; _panY += _velY;
      _applyTransform();
      if (Math.abs(_velX) + Math.abs(_velY) > 0.3) {
        _inertiaRaf = requestAnimationFrame(tick);
      }
    }
    _inertiaRaf = requestAnimationFrame(tick);
  }

  function _applyDepthBlur() {
    if (!_viewport) return;
    const noBlur = _mode === 'hierarchy' || _mode === 'timeline';
    _viewport.querySelectorAll('[data-depth]').forEach(el => {
      if (noBlur) { el.style.filter = ''; return; }
      if (_mode === 'graph') {
        if (el.classList.contains('mm-graph-legend') || el.classList.contains('mm-graph-backdrops') || el.querySelector?.('text')) {
          el.style.filter = '';
          return;
        }
        const depth = parseFloat(el.dataset.depth);
        const blurAmt = (0.3 - depth) * 0.65;
        el.style.filter = blurAmt > 0.75 ? `blur(${blurAmt.toFixed(1)}px)` : '';
        return;
      }
      const depth = parseFloat(el.dataset.depth);
      const blurAmt = (0.3 - depth) * 3;
      el.style.filter = blurAmt > 0.4 ? `blur(${blurAmt.toFixed(1)}px)` : '';
    });
  }

  function _syncZoomSlider() {
    const r = _overlay?.querySelector('.mindmap-zoom-range');
    if (r) r.value = Math.round(_zoom * 100);
  }

  function _applyParallax(nx, ny) {
    _depthEls.forEach(el => {
      const depth = parseFloat(el.dataset.depth);
      const px = nx * depth * 40;
      const py = ny * depth * 40;
      el.style.transform = `translate(${px}px, ${py}px)`;
    });
  }

  function open() {
    _ensureOverlay();

    const text = window.Preview?.getText?.() ?? '';
    const currentHash = _hashString(text);

    if (!_data && !text.trim()) {
      window.Toast?.show('Превью пустое', 'info');
      return;
    }

    if (_data && !_data.localOnly && _textHash === currentHash) {
      _overlay.classList.add('visible');
      _overlay.querySelectorAll('.mindmap-btn[data-mode]').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === _mode);
      });
      _resetTransform();
      _syncZoomSlider();
      _overlay.querySelector('.mindmap-status').textContent = '';
      _overlay.querySelector('.mindmap-refresh')?.classList.remove('spinning');
      _render();
      return;
    }

    if (_data && _textHash !== currentHash) {
      _data = null;
      _jumpCursors.clear();
      _wordsAnimatedForHash = null;
    }

    _overlay.classList.add('visible');
    _overlay.querySelectorAll('.mindmap-btn[data-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === _mode);
    });
    _resetTransform();
    _syncZoomSlider();

    if (_loading) {
      _overlay.querySelector('.mindmap-status').textContent = 'Анализирую...';
      _render();
      return;
    }

    const localWords = _buildLocalWords(text);
    const localLinks = _buildLocalLinks(text, localWords);

    _data = {
      words: localWords,
      links: localLinks,
      claim: '',
      conclusion: '',
      evidence: [],
      clusters: [],
      hierarchy: null,
      steps: [],
      localOnly: true,
    };
    _textHash = currentHash;

    _overlay.querySelector('.mindmap-status').textContent = 'Анализирую структуру...';
    _overlay.querySelector('.mindmap-refresh')?.classList.add('spinning');

    _render();
    _fetch(text);
  }

  function _setupSvgListeners() {
    _svg.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = _svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = Math.min(4, Math.max(0.4, _zoom * factor));
      _panX = mx - (mx - _panX) * (newZoom / _zoom);
      _panY = my - (my - _panY) * (newZoom / _zoom);
      _zoom = newZoom;
      _applyTransform();
      _syncZoomSlider();
    }, { passive: false });

    _svg.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      cancelAnimationFrame(_inertiaRaf);
      _dragging = true; _movedEnough = false;
      _lastX = e.clientX; _lastY = e.clientY;
    });

    _svg.addEventListener('mousemove', e => {
      if (_dragging) return;
      const rect = _svg.getBoundingClientRect();
      _parallaxNX = (e.clientX - rect.left - rect.width / 2) / rect.width;
      _parallaxNY = (e.clientY - rect.top - rect.height / 2) / rect.height;
      if (!_rafPending) {
        _rafPending = true;
        requestAnimationFrame(() => {
          _rafPending = false;
          _applyParallax(_parallaxNX, _parallaxNY);
        });
      }
    });
  }

  function close() {
    if (!_overlay) return;
    _requestSeq++;
    _overlay.classList.remove('visible');
    _dragging = false;
    cancelAnimationFrame(_inertiaRaf);
    _inertiaRaf = null;
    _rafPending = false;
    if (_panel) _panel.style.transform = '';
    if (_loading) {
      _abortController?.abort();
      _loading = false;
    }
    _overlay.querySelector('.mindmap-refresh')?.classList.remove('spinning');
  }

  async function _fetch(text) {
    const seq = ++_requestSeq;
    _abortController?.abort();
    _abortController = new AbortController();
    _loading = true;
    try {
      const prompt = window.LLMCore?.getPrompt?.('mindmap');
      if (!prompt || !window.LLMCore?.request) {
        window.Toast?.show('LLMCore недоступен', 'error');
        if (_data?.words?.length) {
          _overlay.querySelector('.mindmap-status').textContent = '';
        } else {
          close();
        }
        return;
      }

      const localWordsForPrompt = (_data?.words || []).slice(0, 60).map(w => w.w);

      const result = await window.LLMCore.request({
        messages: [{
          role: 'user',
          content: prompt +
            '\n\nСписок words уже рассчитан локально и будет использован для облака слов. ' +
            'Не возвращай words. Для links/clusters используй только слова из этого списка. ' +
            'Верни links только между действительно связанными понятиями. ' +
            'Не связывай служебные токены кода без смысловой причины. ' +
            'Для clusters группируй слова в смысловые темы. ' +
            'cluster.topic должен быть человеческим названием темы, не именем функции или переменной. ' +
            'cluster.words должны быть понятными терминами из текста, но не случайными идентификаторами кода. ' +
            'Не используй camelCase/PascalCase имена функций и переменных, DOM/API методы, свойства объектов, event handler names, storage keys. ' +
            'Не используй rAF, rafId, setTimeout, querySelector, classList, textContent, localStorage, state/cache/id/map/offset/ratio tokens как cluster.words. ' +
            'Если текст технический, обобщай identifiers в понятия: анимация, производительность, состояние, синхронизация, память, DOM, события, редактор, вкладки, скролл, ошибки. ' +
            'В каждом cluster.words возвращай 5-9 коротких понятных слов или фраз. ' +
            'Если подходящих связей мало, верни меньше links, не заполняй искусственно.\n' +
            JSON.stringify(localWordsForPrompt) +
            '\n\nТекст:\n' + text.slice(0, 4000)
        }],
        stream: false,
        maxTokens: 7500,
        featureTag: 'mindmap',
        signal: _abortController.signal,
      });
      if (seq !== _requestSeq) return;
      if (!result?.trim()) {
        window.Toast?.show('Нет результата', 'info');
        if (_data?.words?.length) {
          _overlay.querySelector('.mindmap-status').textContent = '';
        } else { close(); }
        return;
      }

      const json = _extractJsonObject(result);
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        console.warn('[MindMap] Unexpected JSON shape:', json);
        window.Toast?.show('Ответ mind map имеет неверный формат', 'error');
        if (_data?.words?.length) {
          _overlay.querySelector('.mindmap-status').textContent = '';
        } else { close(); }
        return;
      }

      const localWords = _data?.words?.length ? _data.words : _buildLocalWords(text);
      const localLinks = _data?.links?.length ? _data.links : _buildLocalLinks(text, localWords);
      const payload = json.mindmap && typeof json.mindmap === 'object' ? json.mindmap : json;
      const normalized = _normalizeData(payload, localWords);

      if (
        !normalized.clusters.length && !normalized.hierarchy &&
        !normalized.steps.length && !normalized.claim &&
        !normalized.evidence.length && !normalized.conclusion
      ) {
        if (localWords.length) {
          window.Toast?.show('LLM не вернул структуру, оставлено облако слов', 'info');
          _overlay.querySelector('.mindmap-status').textContent = '';
          return;
        }
        window.Toast?.show('LLM вернул пустую mind map', 'info');
        close();
        return;
      }

      const mergedLinks = _mergeLinks(localLinks, normalized.links);

      _data = {
        ..._data,
        ...normalized,
        words: _data?.words?.length ? _data.words : localWords,
        links: mergedLinks,
        localOnly: false,
      };
      if (_overlay?.classList.contains('visible')) {
        _overlay.querySelector('.mindmap-status').textContent = '';
        if (_mode !== 'words') _render();
      }
    } catch (e) {
      if (seq !== _requestSeq) return;
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
      if (!_data?.words?.length) close();
    } finally {
      if (seq === _requestSeq) _loading = false;
      _overlay?.querySelector('.mindmap-refresh')?.classList.remove('spinning');
    }
  }

  function _buildDefs(W, H) {
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <filter id="bloom" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="6" result="blur1"/>
        <feGaussianBlur in="blur1" stdDeviation="12" result="blur2"/>
        <feMerge>
          <feMergeNode in="blur2"/>
          <feMergeNode in="blur1"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/></filter>
      <marker id="arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="rgba(255,255,255,0.3)"/>
      </marker>
      <marker id="flow-arrow-head" markerWidth="6" markerHeight="6" refX="5" refY="2.5" orient="auto">
        <path d="M0,0 L5,2.5 L0,5 Z" fill="rgba(255,255,255,0.26)"/>
      </marker>
    `;
    const seen = new Set();
    PALETTE.forEach(c => {
      if (seen.has(c)) return;
      seen.add(c);
      const id = 'grad-' + c.replace('#', '');
      const grad = document.createElementNS(SVG_NS, 'radialGradient');
      grad.setAttribute('id', id);
      grad.setAttribute('cx', '35%');
      grad.setAttribute('cy', '30%');
      grad.setAttribute('r', '70%');
      grad.innerHTML = `
        <stop offset="0%" stop-color="#fff" stop-opacity="0.9"/>
        <stop offset="35%" stop-color="${c}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${c}" stop-opacity="0.15"/>
      `;
      defs.appendChild(grad);
    });
    return defs;
  }

  function _render() {
    if (!_data || !_svg) return;
    _svg.innerHTML = '';
    const rect = _svg.getBoundingClientRect();
    const W = rect.width || 700;
    const H = rect.height || 450;
    _svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    _svg.appendChild(_buildDefs(W, H));

    _viewport = document.createElementNS(SVG_NS, 'g');
    _viewport.setAttribute('class', 'mm-viewport');
    _svg.appendChild(_viewport);

    _viewport.appendChild(_drawStarfield(W, H));

    switch (_mode) {
      case 'words': _drawWords(W, H); break;
      case 'graph': _drawGraph(W, H); break;
      case 'tree': _drawTree(W, H); break;
      case 'clusters': _drawClusters(W, H); break;
      case 'hierarchy': _drawHierarchy(W, H); break;
      case 'timeline': _drawTimeline(W, H); break;
    }
    _applyDepthBlur();
    _applyTransform();
    _depthEls = Array.from(_viewport.querySelectorAll('[data-depth]'));
  }

  function _estimateTextWidth(text, fontSize, fontWeight) {
    const s = String(text ?? '');
    const wide = [...s].filter(ch => /[А-Яа-яЁёШЩЮЖМЫФ]/u.test(ch)).length;
    const narrow = s.length - wide;
    const weightFactor = fontWeight === '700' ? 1.08 : 1;
    return ((wide * 0.68 + narrow * 0.58) * fontSize) * weightFactor;
  }

  const STOP_WORDS_RU = new Set([
    'и', 'в', 'во', 'не', 'что', 'он', 'на', 'я', 'с', 'со', 'как',
    'а', 'то', 'все', 'она', 'так', 'его', 'но', 'да', 'ты', 'к',
    'у', 'же', 'вы', 'за', 'бы', 'по', 'только', 'ее', 'мне', 'было',
    'вот', 'от', 'меня', 'еще', 'нет', 'о', 'из', 'ему', 'теперь',
    'когда', 'даже', 'ну', 'вдруг', 'ли', 'если', 'уже', 'или',
    'ни', 'быть', 'был', 'него', 'до', 'вас', 'нибудь', 'опять',
    'уж', 'вам', 'ведь', 'там', 'потом', 'себя', 'ничего', 'ей',
    'может', 'они', 'тут', 'где', 'есть', 'надо', 'ней', 'для',
    'мы', 'тебя', 'их', 'чем', 'была', 'сам', 'чтоб', 'без',
    'будто', 'чего', 'раз', 'тоже', 'себе', 'под', 'будет', 'ж',
    'тогда', 'кто', 'этот', 'того', 'потому', 'этого', 'какой',
    'совсем', 'ним', 'здесь', 'этом', 'один', 'почти', 'мой',
    'тем', 'чтобы', 'нее', 'сейчас', 'были', 'куда', 'зачем',
    'сказать', 'всех', 'никогда', 'сегодня', 'можно', 'при',
    'наконец', 'два', 'об', 'другой', 'хоть', 'после', 'над',
    'больше', 'тот', 'через', 'эти', 'нас', 'про', 'всего',
    'них', 'какая', 'много', 'разве', 'три', 'эту', 'моя',
  ]);

  const STOP_WORDS_EN = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with',
    'this', 'that', 'from', 'have', 'has', 'was', 'were', 'will',
    'would', 'could', 'should', 'there', 'their', 'they', 'them',
    'then', 'than', 'into', 'about', 'because', 'what', 'when',
    'where', 'which', 'while', 'who', 'how', 'can', 'all', 'any',
    'one', 'two', 'out', 'our', 'its', 'his', 'her', 'she', 'him',
  ]);

  function _mergeLinks(localLinks = [], llmLinks = [], maxLinks = 45) {
    localLinks = Array.isArray(localLinks) ? localLinks : [];
    llmLinks = Array.isArray(llmLinks) ? llmLinks : [];
    const key = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const map = new Map();
    function add(link, sourceBoost = 0) {
      const a = key(link?.from), b = key(link?.to);
      if (!a || !b || a === b) return;
      const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
      const strength = Math.max(0, Math.min(1, Number(link?.strength) || 0.3));
      const existing = map.get(pairKey);
      if (!existing || strength + sourceBoost > existing._score) {
        map.set(pairKey, { from: link.from, to: link.to, strength, source: link.source || 'local', _score: strength + sourceBoost, synthetic: link.synthetic });
      }
    }
    localLinks.forEach(l => add({ ...l, source: 'local' }, 0));
    llmLinks.forEach(l => add({ ...l, source: 'llm' }, 0.25));
    return [...map.values()].sort((a, b) => b._score - a._score).slice(0, maxLinks).map(({ _score, ...l }) => l);
  }

  function _selectGraphWords(words = [], links = [], maxNodes = 45) {
    words = Array.isArray(words) ? words : [];
    links = Array.isArray(links) ? links : [];
    const key = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const linked = new Set();
    links.forEach(l => {
      if (l?.from) linked.add(key(l.from));
      if (l?.to) linked.add(key(l.to));
    });
    const linkedWords = words.filter(w => linked.has(key(w.w)) && !_isGraphNoiseWord(w.w));
    if (linkedWords.length >= 8) return linkedWords.slice(0, maxNodes);
    return [...words].filter(w => !_isGraphNoiseWord(w.w))
      .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0))
      .slice(0, maxNodes);
  }

  function _ensureMinimumGraphLinks(words, links, minLinks = 12) {
    if (links.length > 0) return links;
    const top = [...words].sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0)).slice(0, 12);
    const extra = [];
    for (let i = 0; i < top.length - 1 && extra.length < minLinks; i++) {
      const from = top[i].w, to = top[i + 1].w;
      const a = _wordKey(from), b = _wordKey(to);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      extra.push({ from, to, strength: 0.15, synthetic: true });
    }
    return links.concat(extra);
  }

  function _buildLocalWords(text, limit = 90) {
    const source = String(text ?? '');
    if (source.length < 30) return [];

    const counts = new Map();
    const re = /[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/giu;

    for (const m of source.matchAll(re)) {
      const raw = m[0];
      const key = raw.toLowerCase();
      if (key.length < 3) continue;
      if (STOP_WORDS_RU.has(key) || STOP_WORDS_EN.has(key)) continue;
      if (/^\d+$/.test(key)) continue;

      const item = counts.get(key) || { w: raw, key, count: 0, firstIndex: m.index };
      item.count++;
      counts.set(key, item);
    }

    const items = [...counts.values()]
      .sort((a, b) => b.count !== a.count ? b.count - a.count : a.firstIndex - b.firstIndex)
      .slice(0, limit);

    if (!items.length) return [];
    const maxCount = Math.max(1, items[0].count);

    return items.map((x, i) => ({
      w: x.w,
      count: x.count,
      firstIndex: x.firstIndex,
      weight: Math.max(1, Math.min(10, 1 + Math.log2(x.count + 1) / Math.log2(maxCount + 1) * 9)),
      role: 'topic',
      colorIndex: i,
    }));
  }

  function _buildLocalLinks(text, words, maxLinks = 45) {
    if (!words.length || !text) return [];
    const key = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const wordSet = new Map(words.map(w => [key(w.w), w.w]));
    const weightByKey = new Map(words.map(w => [key(w.w), Number(w.weight) || 0]));
    const chunks = String(text).split(/(?:[.!?]+|\n{2,})+/).map(s => s.trim()).filter(s => s.length > 30);
    const pairCounts = new Map();

    for (const chunk of chunks) {
      const foundSet = new Set();
      for (const m of chunk.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/giu)) {
        const k = key(m[0]);
        if (wordSet.has(k)) foundSet.add(k);
      }
      const found = [...foundSet].sort((a, b) => {
        return (weightByKey.get(b) || 0) - (weightByKey.get(a) || 0);
      }).slice(0, 8);

      for (let i = 0; i < found.length; i++) {
        for (let j = i + 1; j < found.length; j++) {
          const a = found[i], b = found[j];
          const pairKey = a < b ? `${a}|${b}` : `${b}|${a}`;
          pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
        }
      }
    }

    return [...pairCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxLinks)
      .map(([pairKey, count]) => {
        const [a, b] = pairKey.split('|');
        return { from: wordSet.get(a), to: wordSet.get(b), strength: Math.min(1, 0.25 + count / 4) };
      });
  }

  let _jumpCursors = new Map();

  function _findWordOccurrences(text, word) {
    const safeWord = String(word ?? '').slice(0, 100).trim();
    if (!safeWord) return [];
    const escaped = safeWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    const out = [];
    for (const m of String(text ?? '').matchAll(re)) {
      const prefix = m[1] || '';
      const matchedWord = m[2] || safeWord;
      out.push({ word: matchedWord, index: m.index + prefix.length, length: matchedWord.length });
    }
    return out;
  }

  function _drawWords(W, H) {
    const words = _data.words || [];
    if (!words.length) return;

    const enriched = words.map(item => ({
      ...item,
      count: Number.isFinite(item.count) ? item.count : 0,
      visualWeight: Math.max(1, Math.min(10, Number(item.weight) || 1)),
    }));

    const maxW = Math.max(...enriched.map(w => w.visualWeight));
    const placed = [];
    const padding = 8;

    const sorted = [...enriched].sort((a, b) => b.visualWeight - a.visualWeight);
    const animateWords = _wordsAnimatedForHash !== _textHash;
    sorted.forEach((item, i) => {
      const t = item.visualWeight / maxW;
      let fontSize = 10 + Math.pow(t, 3.9) * 48;
      const color = PALETTE[i % PALETTE.length];
      const maxTextW = Math.max(40, W - padding * 2);
      let tw = _estimateTextWidth(item.w, fontSize, item.visualWeight > 6 ? '700' : '400');
      if (tw > maxTextW) {
        fontSize = Math.max(8, (maxTextW / (item.w.length * 0.6)));
        tw = _estimateTextWidth(item.w, fontSize, item.visualWeight > 6 ? '700' : '400');
      }
      const th = fontSize * 1.3;
      let x, y, tries = 0, collides = false;
      do {
        const rangeX = Math.max(1, W - tw - padding * 2);
        const rangeY = Math.max(1, H - th - padding * 2);
        const seed = _hashString(item.w + '_' + tries);
        x = padding + _rand01(seed) * rangeX;
        y = padding + th + _rand01(seed ^ 0x9e3779b9) * rangeY;
        collides = placed.some(p =>
          Math.abs(x + tw / 2 - p.cx) < (tw / 2 + p.hw + padding) &&
          Math.abs(y - th / 2 - p.cy) < (th / 2 + p.hh + padding)
        );
        tries++;
      } while (tries < 80 && collides);
      if (collides) return;
      placed.push({ cx: x + tw / 2, cy: y - th / 2, hw: tw / 2, hh: th / 2 });

      const enterG = document.createElementNS(SVG_NS, 'g');
      if (animateWords && i < 40 && item.visualWeight >= 2) {
        enterG.classList.add('mm-enter');
        enterG.style.animationDelay = `${Math.min(i * 18, 450)}ms`;
      }

      const depthG = document.createElementNS(SVG_NS, 'g');
      depthG.dataset.depth = item.visualWeight > 7 ? '0.3' : '0.12';

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('font-size', fontSize);
      text.setAttribute('fill', color);
      text.setAttribute('font-family', 'var(--mono)');
      text.setAttribute('font-weight', item.visualWeight > 6 ? '700' : '400');
      text.setAttribute('opacity', 0.4 + (item.visualWeight / maxW) * 0.6);
      if (item.count === 0) {
        text.setAttribute('opacity', '0.35');
        text.setAttribute('stroke', color);
        text.setAttribute('stroke-opacity', '0.3');
        text.setAttribute('stroke-width', '0.4');
      } else if (item.visualWeight > 7) {
        text.setAttribute('filter', 'url(#bloom)');
      }
      text.textContent = item.w;
      text.style.transition = 'opacity 0.2s, font-size 0.2s';
      text.addEventListener('mouseenter', () => { text.setAttribute('opacity', '1'); text.setAttribute('font-size', fontSize + 4); text.classList.add('mm-pulse'); });
      text.addEventListener('mouseleave', () => { text.setAttribute('opacity', String(0.4 + (item.visualWeight / maxW) * 0.6)); text.setAttribute('font-size', fontSize); text.classList.remove('mm-pulse'); });
      _attachWordInteractions(text, item.w, x + tw / 2, y - th / 2);
      depthG.appendChild(text);
      enterG.appendChild(depthG);
      _viewport.appendChild(enterG);
    });
    if (animateWords) _wordsAnimatedForHash = _textHash;
  }

  function _scoreGraphLink(l, nodeWeightByKey, gk) {
    const a = gk(l.from), b = gk(l.to);
    const strength = Math.max(0, Math.min(1, Number(l.strength) || 0.2));
    const wa = nodeWeightByKey.get(a) || 1;
    const wb = nodeWeightByKey.get(b) || 1;
    const syntheticPenalty = l.synthetic ? 0.35 : 1;
    return syntheticPenalty * (strength * 1.8 + Math.min(10, wa + wb) * 0.08);
  }

  function _pruneGraphLinks(links, nodes, gk, maxLinks = 26, maxDegree = 3) {
    const nodeWeightByKey = new Map(nodes.map(n => [gk(n.w), Number(n.weight) || 1]));
    const sorted = [...links].map(l => ({ ...l, _score: _scoreGraphLink(l, nodeWeightByKey, gk) }))
      .sort((a, b) => b._score - a._score);
    const degree = new Map();
    const selected = [];
    const seen = new Set();
    for (const l of sorted) {
      const a = gk(l.from), b = gk(l.to);
      if (!a || !b || a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(k)) continue;
      if ((degree.get(a) || 0) >= maxDegree || (degree.get(b) || 0) >= maxDegree) continue;
      selected.push(l);
      seen.add(k);
      degree.set(a, (degree.get(a) || 0) + 1);
      degree.set(b, (degree.get(b) || 0) + 1);
      if (selected.length >= maxLinks) break;
    }
    return selected.map(({ _score, ...l }) => l);
  }

  function _graphComponents(nodes, links, nodeMap, gk) {
    const adj = nodes.map(() => []);
    links.forEach(l => {
      const ai = nodeMap.get(gk(l.from)), bi = nodeMap.get(gk(l.to));
      if (ai == null || bi == null) return;
      adj[ai].push(bi); adj[bi].push(ai);
    });
    const seen = new Set();
    const comps = [];
    nodes.forEach((_, start) => {
      if (seen.has(start)) return;
      const stack = [start]; const comp = []; seen.add(start);
      while (stack.length) {
        const i = stack.pop(); comp.push(i);
        adj[i].forEach(j => { if (!seen.has(j)) { seen.add(j); stack.push(j); } });
      }
      comps.push(comp);
    });
    return comps.sort((a, b) => b.length - a.length);
  }

  function _graphComponentLabel(comp, nodes) {
    return comp.map(i => nodes[i])
      .sort((a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0))
      .slice(0, 2).map(n => String(n.w || '').trim()).filter(Boolean).join(' / ');
  }

  function _drawGraphComponentBackdrops(comps, nodes) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.dataset.depth = '0.06';
    g.setAttribute('class', 'mm-graph-backdrops');
    comps.forEach((comp, ci) => {
      if (comp.length < 2) return;
      const color = PALETTE[ci % PALETTE.length];
      const items = comp.map(i => nodes[i]);
      const minX = Math.min(...items.map(n => n.x - n.r));
      const maxX = Math.max(...items.map(n => n.x + n.r));
      const minY = Math.min(...items.map(n => n.y - n.r));
      const maxY = Math.max(...items.map(n => n.y + n.r));
      const pad = 22;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(minX - pad)); rect.setAttribute('y', String(minY - pad));
      rect.setAttribute('width', String(maxX - minX + pad * 2)); rect.setAttribute('height', String(maxY - minY + pad * 2));
      rect.setAttribute('rx', '16');
      rect.setAttribute('fill', color + '09'); rect.setAttribute('stroke', color + '1C');
      rect.setAttribute('stroke-width', '1'); rect.setAttribute('stroke-dasharray', '5 7');
      g.appendChild(rect);
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(minX - pad + 14)); label.setAttribute('y', String(minY - pad + 20));
      label.setAttribute('fill', color); label.setAttribute('font-size', '10'); label.setAttribute('font-weight', '700');
      label.setAttribute('font-family', 'var(--mono)');
      label.setAttribute('paint-order', 'stroke');
      label.setAttribute('stroke', 'rgba(0,0,0,0.42)'); label.setAttribute('stroke-width', '2');
      label.textContent = _graphComponentLabel(comp, nodes);
      g.appendChild(label);
    });
    _viewport.appendChild(g);
  }

  function _drawGraphLegend(W, H, nodeCount, linkCount) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.dataset.depth = '0.04';
    g.setAttribute('class', 'mm-graph-legend');
    g.style.cursor = 'default';
    const x = 18, y = 18;
    const compactW = 86, compactH = 28, fullW = 232, fullH = 70;
    const box = document.createElementNS(SVG_NS, 'rect');
    box.setAttribute('x', String(x)); box.setAttribute('y', String(y));
    box.setAttribute('width', String(compactW)); box.setAttribute('height', String(compactH));
    box.setAttribute('rx', '9');
    box.setAttribute('fill', 'rgba(0,0,0,0.34)'); box.setAttribute('stroke', 'rgba(255,255,255,0.10)');
    box.setAttribute('stroke-width', '1');
    g.appendChild(box);
    const title = document.createElementNS(SVG_NS, 'text');
    title.setAttribute('x', String(x + 11)); title.setAttribute('y', String(y + 18));
    title.setAttribute('fill', 'var(--text0)'); title.setAttribute('font-size', '10');
    title.setAttribute('font-weight', '700'); title.setAttribute('font-family', 'var(--mono)');
    title.textContent = 'Карта';
    g.appendChild(title);
    const hint = document.createElementNS(SVG_NS, 'text');
    hint.setAttribute('x', String(x + 51)); hint.setAttribute('y', String(y + 18));
    hint.setAttribute('fill', 'var(--text2)'); hint.setAttribute('font-size', '10');
    hint.setAttribute('font-family', 'var(--mono)');
    hint.textContent = '?';
    g.appendChild(hint);
    const details = document.createElementNS(SVG_NS, 'g');
    details.setAttribute('opacity', '0'); details.style.pointerEvents = 'none';
    details.style.transition = 'opacity 0.16s ease';
    const detailBox = document.createElementNS(SVG_NS, 'rect');
    detailBox.setAttribute('x', String(x)); detailBox.setAttribute('y', String(y));
    detailBox.setAttribute('width', String(fullW)); detailBox.setAttribute('height', String(fullH));
    detailBox.setAttribute('rx', '10');
    detailBox.setAttribute('fill', 'rgba(0,0,0,0.48)'); detailBox.setAttribute('stroke', 'rgba(255,255,255,0.12)');
    detailBox.setAttribute('stroke-width', '1');
    details.appendChild(detailBox);
    ['шар = термин, размер = важность', 'цвет = тема, линия = связь', `${nodeCount} терминов · ${linkCount} связей`].forEach((line, i) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', String(x + 12)); t.setAttribute('y', String(y + 20 + i * 15));
      t.setAttribute('fill', i === 0 ? 'var(--text0)' : 'var(--text2)');
      t.setAttribute('font-size', '10'); t.setAttribute('font-family', 'var(--mono)');
      if (i === 0) t.setAttribute('font-weight', '700');
      t.textContent = line;
      details.appendChild(t);
    });
    g.appendChild(details);
    g.addEventListener('mouseenter', () => {
      box.setAttribute('width', String(fullW)); box.setAttribute('height', String(fullH));
      title.setAttribute('opacity', '0'); hint.setAttribute('opacity', '0');
      details.setAttribute('opacity', '1');
    });
    g.addEventListener('mouseleave', () => {
      box.setAttribute('width', String(compactW)); box.setAttribute('height', String(compactH));
      title.setAttribute('opacity', '1'); hint.setAttribute('opacity', '1');
      details.setAttribute('opacity', '0');
    });
    _viewport.appendChild(g);
  }

  function _drawGraph(W, H) {
    const allWords = _data.words || [];
    const allLinks = _data.links || [];
    if (!allWords.length) return;

    function graphKey(s) {
      return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    const filteredLinks = _ensureMinimumGraphLinks(allWords, allLinks);
    const graphMaxNodes = W < 900 ? 28 : 34;
    const words = _selectGraphWords(allWords, filteredLinks, graphMaxNodes);
    if (!words.length) return;

    const weights = words.map(w => Number(w.weight) || 1);
    const maxW = Math.max(1, ...weights);

    const wordKeys = new Set(words.map(w => graphKey(w.w)));
    let links = filteredLinks.filter(l =>
      wordKeys.has(graphKey(l.from)) && wordKeys.has(graphKey(l.to))
    );

    const dedup = [];
    const seen = new Map();
    words.forEach((w, i) => {
      const gk = graphKey(w.w);
      if (seen.has(gk)) { seen.get(gk).indices.push(i); return; }
      const entry = { ...w, indices: [i] };
      seen.set(gk, entry);
      dedup.push(entry);
    });

    const nodes = dedup.map((w, i) => {
      const seed = _hashString(w.w);
      return {
        ...w, idx: i,
        x: W / 2 + (_rand01(seed) - 0.5) * W * 0.6,
        y: H / 2 + (_rand01(seed ^ 0x9e3779b9) - 0.5) * H * 0.6,
        vx: 0, vy: 0,
        weight: Math.max(1, Math.min(10, Number(w.weight) || 1)),
      };
    });

    const nodeMap = new Map();
    dedup.forEach((w, i) => { nodeMap.set(graphKey(w.w), i); });

    nodes.forEach(n => { n.r = 6 + (n.weight / maxW) * 16; });

    const maxGraphLinks = W < 900 ? 22 : 28;
    links = _pruneGraphLinks(links, nodes, graphKey, maxGraphLinks, 3);

    const comps = _graphComponents(nodes, links, nodeMap, graphKey);
    comps.forEach((comp, ci) => {
      const color = PALETTE[ci % PALETTE.length];
      comp.forEach(nodeIndex => { nodes[nodeIndex].compId = ci; nodes[nodeIndex].compColor = color; });
    });
    const compCenterByNode = new Map();

    if (comps.length > 1) {
      const ringR = Math.min(W, H) * 0.32;
      comps.forEach((comp, ci) => {
        const angle = -Math.PI / 2 + ci * Math.PI * 2 / comps.length;
        const center = {
          x: W / 2 + Math.cos(angle) * ringR,
          y: H / 2 + Math.sin(angle) * ringR * 0.72,
        };
        comp.forEach((nodeIndex, localI) => {
          compCenterByNode.set(nodeIndex, center);
          const n = nodes[nodeIndex];
          const seed = _hashString(`${n.w}:component:${ci}:${localI}`);
          const spread = 44 + Math.sqrt(comp.length) * 18;
          n.x = center.x + (_rand01(seed) - 0.5) * spread;
          n.y = center.y + (_rand01(seed ^ 0x9e3779b9) - 0.5) * spread;
          n.vx = 0; n.vy = 0;
        });
      });
    }

    const LINK_DIST = Math.min(240, Math.max(170, Math.min(W, H) * 0.28));
    const REPULSE = 2400;
    const COLLIDE_PAD = 42;
    const CENTER_PULL = comps.length > 1 ? 0.006 : 0.002;
    const DAMPING = 0.82;
    const iterCount = nodes.length > 32 ? 90 : 120;

    for (let iter = 0; iter < iterCount; iter++) {
      nodes.forEach(a => {
        nodes.forEach(b => {
          if (a === b) return;
          let dx = a.x - b.x, dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          let force = REPULSE / (dist * dist);
          a.vx += (dx / dist) * force;
          a.vy += (dy / dist) * force;
          const labelA = Math.min(90, String(a.w || '').length * 5);
          const labelB = Math.min(90, String(b.w || '').length * 5);
          const minDist = Math.max((a.r || 16) * 2, labelA) * 0.55 + Math.max((b.r || 16) * 2, labelB) * 0.55 + COLLIDE_PAD;
          if (dist < minDist) {
            const push = (minDist - dist) * 0.045;
            a.vx += (dx / dist) * push; a.vy += (dy / dist) * push;
            b.vx -= (dx / dist) * push; b.vy -= (dy / dist) * push;
          }
        });
      });
      links.forEach(l => {
        const ai = nodeMap.get(graphKey(l.from)), bi = nodeMap.get(graphKey(l.to));
        if (ai == null || bi == null) return;
        const a = nodes[ai], b = nodes[bi];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const strength = Math.max(0.15, Math.min(1, Number(l.strength) || 0.3));
        let force = (dist - LINK_DIST) * 0.0028 * strength;
        a.vx += (dx / dist) * force; a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force; b.vy -= (dy / dist) * force;
      });
      nodes.forEach(n => {
        const c = compCenterByNode.get(n.idx) || { x: W / 2, y: H / 2 };
        n.vx += (c.x - n.x) * CENTER_PULL;
        n.vy += (c.y - n.y) * CENTER_PULL;
        n.vx *= DAMPING; n.vy *= DAMPING;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(70, Math.min(W - 70, n.x));
        n.y = Math.max(70, Math.min(H - 70, n.y));
      });
    }

    function edgePoint(from, to, offset) {
      const dx = to.x - from.x, dy = to.y - from.y;
      const dist = Math.hypot(dx, dy) || 1;
      return { x: from.x + (dx / dist) * offset, y: from.y + (dy / dist) * offset };
    }

    function curvedMidpoint(a, b, seedBase) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist, ny = dx / dist;
      const side = (_hashString(seedBase) % 2) ? 1 : -1;
      const bend = Math.min(44, Math.max(12, dist * 0.14)) * side;
      return { x: (a.x + b.x) / 2 + nx * bend, y: (a.y + b.y) / 2 + ny * bend };
    }

    const defs = _svg?.querySelector('defs');
    if (defs) {
      const maskId = `graph-mask-${_requestSeq}`;
      const mask = document.createElementNS(SVG_NS, 'mask');
      mask.setAttribute('id', maskId);
      mask.setAttribute('maskUnits', 'userSpaceOnUse');
      mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
      mask.setAttribute('x', '0'); mask.setAttribute('y', '0');
      mask.setAttribute('width', String(W)); mask.setAttribute('height', String(H));
      const bg = document.createElementNS(SVG_NS, 'rect');
      bg.setAttribute('x', '0'); bg.setAttribute('y', '0');
      bg.setAttribute('width', String(W)); bg.setAttribute('height', String(H));
      bg.setAttribute('fill', 'white');
      mask.appendChild(bg);
      nodes.forEach(n => {
        const cut = document.createElementNS(SVG_NS, 'circle');
        cut.setAttribute('cx', String(n.x)); cut.setAttribute('cy', String(n.y));
        cut.setAttribute('r', String((n.r || 16) + 5));
        cut.setAttribute('fill', 'black');
        mask.appendChild(cut);
      });
      defs.appendChild(mask);

      const EDGE_GAP = 6;
      const linksG = document.createElementNS(SVG_NS, 'g');
      linksG.dataset.depth = '0.12';
      linksG.setAttribute('mask', `url(#${maskId})`);

      links.forEach(l => {
        const ai = nodeMap.get(graphKey(l.from)), bi = nodeMap.get(graphKey(l.to));
        if (ai == null || bi == null) return;
        const a = nodes[ai], b = nodes[bi];
        const start = edgePoint(a, b, a.r + EDGE_GAP);
        const end = edgePoint(b, a, b.r + EDGE_GAP);
        const mid = curvedMidpoint(start, end, `${l.from}|${l.to}`);
        const strength = Math.max(0, Math.min(1, Number(l.strength) || 0.3));
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', `M ${start.x} ${start.y} Q ${mid.x} ${mid.y} ${end.x} ${end.y}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', l.synthetic ? 'rgba(255,255,255,0.035)' : `rgba(255,255,255,${(0.07 + strength * 0.11).toFixed(3)})`);
        path.setAttribute('stroke-width', String(0.8 + strength * 1.4));
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        if (l.synthetic) path.setAttribute('stroke-dasharray', '4 6');
        else if (l.source === 'local') path.setAttribute('stroke-dasharray', '5 6');
        const edgeTitle = document.createElementNS(SVG_NS, 'title');
        const srcLabel = l.source === 'llm' ? 'смысловая связь' : 'часто рядом в тексте';
        edgeTitle.textContent = `${l.from} ↔ ${l.to} · ${srcLabel} · ${(strength * 100).toFixed(0)}%`;
        path.appendChild(edgeTitle);
        linksG.appendChild(path);
      });
      _viewport.appendChild(linksG);
    }

    _drawGraphComponentBackdrops(comps, nodes);

    nodes.forEach((n, i) => {
      const isIsolated = !links.some(l => graphKey(l.from) === graphKey(n.w) || graphKey(l.to) === graphKey(n.w));
      const r = isIsolated ? 5 + (n.weight / maxW) * 9 : 6 + (n.weight / maxW) * 16;
      const color = n.compColor || PALETTE[i % PALETTE.length];

      const enterG = document.createElementNS(SVG_NS, 'g');
      enterG.classList.add('mm-enter');
      enterG.style.animationDelay = `${i * 25}ms`;

      const depthG = document.createElementNS(SVG_NS, 'g');
      depthG.dataset.depth = n.weight > 7 ? '0.3' : '0.18';

      const gradId = 'grad-' + color.replace('#', '');
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', n.x); circle.setAttribute('cy', n.y);
      circle.setAttribute('r', r);
      circle.setAttribute('fill', `url(#${gradId})`);
      circle.setAttribute('opacity', isIsolated ? '0.35' : '0.85');
      if (n.weight > 7 && !isIsolated) circle.setAttribute('filter', 'url(#bloom)');
      circle.style.cursor = 'pointer';
      circle.style.transition = 'r 0.2s, opacity 0.2s';
      circle.addEventListener('mouseenter', () => { circle.setAttribute('opacity', '1'); circle.setAttribute('r', r + 3); circle.classList.add('mm-pulse'); });
      circle.addEventListener('mouseleave', () => { circle.setAttribute('opacity', isIsolated ? '0.35' : '0.8'); circle.setAttribute('r', r); circle.classList.remove('mm-pulse'); });
      _attachWordInteractions(circle, n.w, n.x, n.y);
      const nodeTitle = document.createElementNS(SVG_NS, 'title');
      nodeTitle.textContent = `${n.w}\nважность: ${(Number(n.weight) || 0).toFixed(1)}\nклик: показать количество`;
      circle.appendChild(nodeTitle);
      depthG.appendChild(circle);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', n.x); text.setAttribute('y', n.y + r + 14);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', n.weight > 7 ? '11' : '10');
      text.setAttribute('fill', 'var(--text2)');
      text.setAttribute('font-family', 'var(--mono)');
      text.setAttribute('opacity', isIsolated ? '0.45' : '1');
      text.setAttribute('paint-order', 'stroke');
      text.setAttribute('stroke', 'rgba(0,0,0,0.48)'); text.setAttribute('stroke-width', '2');
      text.setAttribute('stroke-linejoin', 'round');
      text.textContent = n.w;
      depthG.appendChild(text);
      enterG.appendChild(depthG);
      _viewport.appendChild(enterG);
    });
    _drawGraphLegend(W, H, nodes.length, links.length);
  }

  function _drawTree(W, H) {
    const claim = _data.claim || '';
    const evidence = _data.evidence || [];
    const conclusion = _data.conclusion || '';
    if (!claim && !evidence.length && !conclusion) {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', W / 2); t.setAttribute('y', H / 2);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('fill', 'var(--text2)');
      t.setAttribute('font-size', '14'); t.textContent = 'Нет структуры аргументов в тексте';
      _viewport.appendChild(t);
      return;
    }

    const pad = 30;
    const colW = W - pad * 2;
    const rows = [];
    if (claim) rows.push({ text: claim, color: '#4f8ef7', label: 'ТЕЗИС' });
    evidence.forEach(e => rows.push({ text: e.text, color: e.supports ? '#5cb87a' : '#e05c6a', label: e.supports ? 'ДОКАЗАТЕЛЬСТВО' : 'КОНТР-АРГУМЕНТ' }));
    if (conclusion) rows.push({ text: conclusion, color: '#fbbf24', label: 'ВЫВОД' });

    const maxRows = Math.max(3, Math.floor((H - pad * 2) / 72));
    const visibleRows = rows.slice(0, maxRows);

    const rowH = Math.min(80, (H - pad * 2) / visibleRows.length);
    const startY = pad + 20;

    visibleRows.forEach((r, i) => {
      const y = startY + i * (rowH + 16);

      const enterG = document.createElementNS(SVG_NS, 'g');
      enterG.classList.add('mm-enter');
      enterG.style.animationDelay = `${i * 50}ms`;

      const depthG = document.createElementNS(SVG_NS, 'g');
      depthG.dataset.depth = i === 0 ? '0.3' : '0.18';

      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', pad); rect.setAttribute('y', y);
      rect.setAttribute('width', colW); rect.setAttribute('height', rowH - 8);
      rect.setAttribute('rx', '12');
      rect.setAttribute('fill', r.color + '12');
      rect.setAttribute('stroke', r.color + '35');
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('filter', 'url(#shadow)');
      depthG.appendChild(rect);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', pad + 12); label.setAttribute('y', y + 16);
      label.setAttribute('font-size', '9'); label.setAttribute('fill', r.color);
      label.setAttribute('font-weight', '700'); label.setAttribute('font-family', 'var(--mono)');
      label.textContent = r.label;
      depthG.appendChild(label);

      const wrappedLines = _wrapTextLines(r.text, colW - 24, 3);
      wrappedLines.forEach((ln, li) => {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', pad + 12); t.setAttribute('y', y + 32 + li * 16);
        t.setAttribute('font-size', '12'); t.setAttribute('fill', 'var(--text1)');
        t.setAttribute('font-family', 'var(--mono)');
        t.textContent = ln;
        depthG.appendChild(t);
      });

      if (i > 0) {
        const arrow = document.createElementNS(SVG_NS, 'line');
        arrow.setAttribute('x1', W / 2); arrow.setAttribute('y1', y - 14);
        arrow.setAttribute('x2', W / 2); arrow.setAttribute('y2', y);
        arrow.setAttribute('stroke', 'rgba(255,255,255,0.2)');
        arrow.setAttribute('stroke-width', '1.5');
        arrow.setAttribute('stroke-dasharray', '4,3');
        _viewport.appendChild(arrow);
      }
      enterG.appendChild(depthG);
      _viewport.appendChild(enterG);
    });
  }

  function _drawClusters(W, H) {
    const clusters = (_data.clusters || []).slice(0, 7);
    if (!clusters.length) return;
    const cx = W / 2, cy = H / 2;

    function clusterRadius(cl) {
      const words = Array.isArray(cl.words) ? cl.words : [];
      const longest = words.reduce((m, w) => Math.max(m, String(w).length), 0);
      const longBoost = longest > 18 ? 18 : longest > 13 ? 10 : 0;
      return Math.min(200, Math.max(130, (72 + Math.max(4, words.length) * 11) * 1.08 + longBoost));
    }

    const angleStep = (Math.PI * 2) / clusters.length;
    const maxR = Math.max(...clusters.map(clusterRadius));
    const safeDistX = Math.max(0, W / 2 - maxR - 16);
    const safeDistY = Math.max(0, H / 2 - maxR * 0.7 - 16);
    const safeDist = Math.min(safeDistX, safeDistY);
    const desiredDist = Math.max(Math.min(W, H) * 0.28, maxR * 0.98);
    const dist = Math.min(desiredDist, safeDist);

    clusters.forEach((cl, ci) => {
      const angle = angleStep * ci - Math.PI / 2;
      const ccx = cx + Math.cos(angle) * dist;
      const ccy = cy + Math.sin(angle) * dist;
      const color = PALETTE[ci % PALETTE.length];
      const r = clusterRadius(cl);

      const enterG = document.createElementNS(SVG_NS, 'g');
      enterG.classList.add('mm-enter');
      enterG.style.animationDelay = `${ci * 60}ms`;

      const depthG = document.createElementNS(SVG_NS, 'g');
      depthG.dataset.depth = '0.3';

      const cgradId = `mindmap-cgrad-${ci}`;
      const cgradSeed = _hashString(`${cl.topic}:${ci}`);
      const cgrad = document.createElementNS(SVG_NS, 'radialGradient');
      cgrad.setAttribute('id', cgradId);
      cgrad.setAttribute('cx', `${24 + _rand01(cgradSeed) * 52}%`);
      cgrad.setAttribute('cy', `${24 + _rand01(cgradSeed ^ 0x9e3779b9) * 52}%`);
      cgrad.setAttribute('r', '72%');
      cgrad.innerHTML = `
        <stop offset="0%" stop-color="#fff" stop-opacity="0.34"/>
        <stop offset="34%" stop-color="${color}" stop-opacity="0.48"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.10"/>
      `;
      _svg.querySelector('defs').appendChild(cgrad);

      const ellipse = document.createElementNS(SVG_NS, 'ellipse');
      ellipse.setAttribute('cx', ccx); ellipse.setAttribute('cy', ccy);
      ellipse.setAttribute('rx', r); ellipse.setAttribute('ry', r * 0.7);
      ellipse.setAttribute('fill', `url(#${cgradId})`);
      ellipse.setAttribute('fill-opacity', '0.8');
      ellipse.setAttribute('stroke', color + '55');
      ellipse.setAttribute('stroke-width', '1.2');
      ellipse.setAttribute('filter', 'url(#shadow)');
      ellipse.style.transition = 'fill-opacity 0.25s, stroke 0.25s, stroke-width 0.25s';
      ellipse.addEventListener('mouseenter', () => { ellipse.setAttribute('fill-opacity', '0.95'); ellipse.setAttribute('stroke', color + '90'); ellipse.setAttribute('stroke-width', '1.6'); ellipse.classList.add('mm-pulse'); });
      ellipse.addEventListener('mouseleave', () => { ellipse.setAttribute('fill-opacity', '0.8'); ellipse.setAttribute('stroke', color + '55'); ellipse.setAttribute('stroke-width', '1.2'); ellipse.classList.remove('mm-pulse'); });
      depthG.appendChild(ellipse);

      const titleLines = _clusterTextLines(cl.topic, 22, 2);
      titleLines.forEach((line, li) => {
        const title = document.createElementNS(SVG_NS, 'text');
        title.setAttribute('x', ccx); title.setAttribute('y', ccy - r * 0.42 + li * 16);
        title.setAttribute('text-anchor', 'middle');
        title.setAttribute('font-size', '14'); title.setAttribute('font-weight', '700');
        title.setAttribute('fill', color); title.setAttribute('font-family', 'var(--mono)');
        title.setAttribute('paint-order', 'stroke');
        title.setAttribute('stroke', 'rgba(0,0,0,0.45)'); title.setAttribute('stroke-width', '3');
        title.setAttribute('stroke-linejoin', 'round');
        title.textContent = line;
        depthG.appendChild(title);
      });

      const wordsG = document.createElementNS(SVG_NS, 'g');
      wordsG.dataset.depth = '0.18';
      const visibleWords = cl.words.slice(0, 8).sort((a, b) => String(a).length - String(b).length);
      const wordCount = Math.max(1, visibleWords.length);

      visibleWords.forEach((w, wi) => {
        let wx, wy;
        if (wordCount <= 3) {
          const smallAngles = [-Math.PI / 2, Math.PI * 0.15, Math.PI * 0.85];
          const a = smallAngles[wi] ?? (wi / wordCount) * Math.PI * 2;
          const wr = wi === 0 && wordCount === 1 ? 0 : r * 0.28;
          wx = ccx + Math.cos(a) * wr;
          wy = ccy + Math.sin(a) * wr * 0.55 + 8;
        } else if (wordCount <= 7) {
          const a = (wi / wordCount) * Math.PI * 2 - Math.PI / 2;
          const wr = r * 0.40;
          wx = ccx + Math.cos(a) * wr;
          wy = ccy + Math.sin(a) * wr * 0.62 + 10;
        } else {
          const innerCount = 3;
          if (wi < innerCount) {
            const a = (wi / innerCount) * Math.PI * 2 - Math.PI / 2;
            const wr = r * 0.24;
            wx = ccx + Math.cos(a) * wr;
            wy = ccy + Math.sin(a) * wr * 0.55 + 8;
          } else {
            const outerIndex = wi - innerCount;
            const outerCount = wordCount - innerCount;
            const a = (outerIndex / outerCount) * Math.PI * 2 - Math.PI / 2;
            const wr = r * 0.46;
            wx = ccx + Math.cos(a) * wr;
            wy = ccy + Math.sin(a) * wr * 0.62 + 10;
          }
        }
        const baseFontSize = wi < 3 ? 13 : 12;
        const fontSize = _clusterWordFontSize(w, baseFontSize);
        const wordLines = _clusterTextLines(w, fontSize >= 13 ? 12 : 14, 2);
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', wx);
        t.setAttribute('y', wy - (wordLines.length - 1) * fontSize * 0.45);
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
        t.setAttribute('font-size', String(fontSize));
        t.setAttribute('font-weight', wi < 2 ? '600' : '400');
        t.setAttribute('fill', wi < 3 ? 'var(--text0)' : 'var(--text1)');
        t.setAttribute('font-family', 'var(--mono)');
        t.setAttribute('opacity', wi < 3 ? '0.96' : '0.82');
        t.setAttribute('paint-order', 'stroke');
        t.setAttribute('stroke', 'rgba(0,0,0,0.35)'); t.setAttribute('stroke-width', '1.7');
        t.setAttribute('stroke-linejoin', 'round');
        wordLines.forEach((line, li) => {
          const span = document.createElementNS(SVG_NS, 'tspan');
          span.setAttribute('x', wx);
          span.setAttribute('dy', li === 0 ? '0' : String(fontSize * 1.05));
          span.textContent = line;
          t.appendChild(span);
        });
        _attachWordInteractions(t, w, wx, wy);
        wordsG.appendChild(t);
      });
      depthG.appendChild(wordsG);
      enterG.appendChild(depthG);
      _viewport.appendChild(enterG);
    });
  }

  function _drawHierarchy(W, H) {
    if (!_data.hierarchy || !_data.hierarchy.label) {
      _viewport.appendChild(_emptyMsg('Нет иерархии тем в тексте'));
      return;
    }
    const cx = W / 2, cy = H / 2;
    const palette = ['#4f8ef7', '#a070f7', '#3ec98f', '#f7a13f', '#f76d6d'];

    function layout(node, depth, angleStart, angleEnd, color) {
      const angle = (angleStart + angleEnd) / 2;
      const radius = depth === 0 ? 0 : Math.min(depth * Math.min(W, H) * 0.16 + 40, Math.min(W, H) * 0.42);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      node._pos = { x, y, depth, color };

      if (node.children && node.children.length) {
        const span = (angleEnd - angleStart) / node.children.length;
        node.children.forEach((child, i) => {
          const childColor = depth === 0 ? palette[i % palette.length] : color;
          layout(child, depth + 1, angleStart + i * span, angleStart + (i + 1) * span, childColor);
        });
      }
    }
    layout(_data.hierarchy, 0, 0, Math.PI * 2, palette[0]);

    function drawLink(a, b, opacity) {
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', `rgba(255,255,255,${opacity})`);
      path.setAttribute('stroke-width', '1.5');
      _viewport.appendChild(path);
    }

    let nodeIdx = 0;
    function renderNode(node) {
      if (node.children) node.children.forEach(child => {
        drawLink(node._pos, child._pos, 1 - node._pos.depth * 0.15);
        renderNode(child);
      });
      const { x, y, depth, color } = node._pos;
      const r = Math.max(8, 22 - depth * 6);
      const depthVal = (0.32 - depth * 0.08).toFixed(2);

      _ensureGradient(color);

      const enterG = document.createElementNS(SVG_NS, 'g');
      enterG.classList.add('mm-enter');
      enterG.style.animationDelay = `${nodeIdx++ * 30}ms`;

      const depthG = document.createElementNS(SVG_NS, 'g');
      depthG.dataset.depth = depthVal;

      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', r);
      circle.setAttribute('fill', `url(#${_gradIdFor(color)})`);
      circle.setAttribute('opacity', '0.85');
      if (depth === 0) circle.setAttribute('filter', 'url(#bloom)');
      circle.style.cursor = 'pointer';
      circle.style.transition = 'r 0.2s, opacity 0.2s';
      circle.addEventListener('mouseenter', () => { circle.setAttribute('opacity', '1'); circle.setAttribute('r', r + 3); circle.classList.add('mm-pulse'); });
      circle.addEventListener('mouseleave', () => { circle.setAttribute('opacity', '0.8'); circle.setAttribute('r', r); circle.classList.remove('mm-pulse'); });
      depthG.appendChild(circle);

      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', x); label.setAttribute('y', y + r + 14);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', color); label.setAttribute('font-family', 'var(--mono)');
      label.setAttribute('font-size', depth === 0 ? '12' : '10');
      label.textContent = node.label;
      _attachWordInteractions(label, node.label, x, y);
      depthG.appendChild(label);

      enterG.appendChild(depthG);
      _viewport.appendChild(enterG);
    }
    renderNode(_data.hierarchy);
  }

  function _drawTimeline(W, H) {
    const steps = _data.steps ? [..._data.steps].sort((a, b) => a.order - b.order) : [];
    if (!steps || !steps.length) {
      _viewport.appendChild(_emptyMsg('Нет последовательности шагов в тексте'));
      return;
    }

    const count = Math.min(steps.length, 12);
    const visibleSteps = steps.slice(0, count);
    const sidePad = 40;
    const minCardH = 120;

    let cardW = 240;
    let gap = 70;

    const availableW = W - sidePad * 2;
    const desiredTotalW = count * cardW + (count - 1) * gap;

    if (desiredTotalW > availableW && count > 1) {
      gap = Math.max(32, Math.min(70, availableW * 0.08));
      cardW = Math.max(210, (availableW - (count - 1) * gap) / count);
    }

    let maxCardH = minCardH;
    visibleSteps.forEach(step => {
      const titleLines = _wrapTextLines(step.title || '', cardW - 28, 2);
      const descLines = _wrapTextLines(step.desc || '', cardW - 28, 4);
      const contentH = 36 + titleLines.length * 15 + 4 + descLines.length * 15 + 14;
      if (contentH > maxCardH) maxCardH = contentH;
    });

    const totalW = count * cardW + (count - 1) * gap;
    const startX = Math.max(sidePad, (W - totalW) / 2);
    maxCardH = Math.max(minCardH, Math.min(maxCardH, H - 80));
    const y = Math.max(40, H / 2 - maxCardH / 2);

    visibleSteps.forEach((step, i) => {
      const x = startX + i * (cardW + gap);
      if (i > 0) {
        const prevRight = startX + (i - 1) * (cardW + gap) + cardW;
        _drawFlowArrow(prevRight, y + maxCardH / 2, x, y + maxCardH / 2);
      }
      _drawStepCard(step, x, y, cardW, maxCardH, i);
    });
  }

  function _drawStepCard(step, x, y, w, h, i) {
    const enterG = document.createElementNS(SVG_NS, 'g');
    enterG.classList.add('mm-enter');
    enterG.style.animationDelay = `${i * 60}ms`;

    const depthG = document.createElementNS(SVG_NS, 'g');
    depthG.dataset.depth = '0.25';

    const titleLines = _wrapTextLines(step.title || '', w - 28, 2);
    const descLines = _wrapTextLines(step.desc || '', w - 28, 4);
    const cardH = h;

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('width', w); rect.setAttribute('height', cardH);
    rect.setAttribute('rx', 10);
    rect.setAttribute('fill', 'rgba(79,142,247,0.06)');
    rect.setAttribute('stroke', 'rgba(79,142,247,0.3)');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('filter', 'url(#shadow)');
    depthG.appendChild(rect);

    const order = document.createElementNS(SVG_NS, 'text');
    order.setAttribute('x', x + 14); order.setAttribute('y', y + 18);
    order.setAttribute('fill', '#4f8ef7'); order.setAttribute('font-size', '9');
    order.setAttribute('font-weight', '700'); order.setAttribute('font-family', 'var(--mono)');
    order.textContent = `ШАГ ${step.order || i + 1}`;
    depthG.appendChild(order);

    titleLines.forEach((ln, li) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', x + 14); t.setAttribute('y', y + 36 + li * 15);
      t.setAttribute('fill', 'var(--text0)'); t.setAttribute('font-weight', '600');
      t.setAttribute('font-size', '12'); t.setAttribute('font-family', 'var(--mono)');
      t.textContent = ln;
      depthG.appendChild(t);
    });

    const descY = y + 36 + titleLines.length * 15 + 4;
    descLines.forEach((line, li) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', x + 14); t.setAttribute('y', descY + li * 15);
      t.setAttribute('fill', 'var(--text2)'); t.setAttribute('font-size', '11');
      t.setAttribute('font-family', 'var(--mono)');
      t.textContent = line;
      depthG.appendChild(t);
    });

    enterG.appendChild(depthG);
    _viewport.appendChild(enterG);
  }

  function _drawFlowArrow(x1, y1, x2, y2) {
    const mid = (x1 + x2) / 2;
    const available = Math.max(0, x2 - x1);
    const len = Math.min(34, Math.max(18, available - 28));

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', mid - len / 2);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', mid + len / 2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', 'rgba(255,255,255,0.24)');
    line.setAttribute('stroke-width', '1.3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#flow-arrow-head)');
    _viewport.appendChild(line);
  }

  function _drawStarfield(W, H) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.dataset.depth = '0.05';
    const marginX = W * 0.5;
    const marginY = H * 0.5;
    const totalW = W + marginX * 2;
    const totalH = H + marginY * 2;
    const count = Math.floor((totalW * totalH) / 9000);
    for (let i = 0; i < count; i++) {
      const seed = _hashString(`${_textHash}:${W}:${H}:star:${i}`);
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(-marginX + _rand01(seed) * totalW));
      dot.setAttribute('cy', String(-marginY + _rand01(seed ^ 0x9e3779b9) * totalH));
      dot.setAttribute('r', (_rand01(seed ^ 0xdeadbeef) * 1.2 + 0.3).toFixed(1));
      dot.setAttribute('fill', 'rgba(255,255,255,0.25)');
      g.appendChild(dot);
    }
    return g;
  }

  return { open, close };
})();
