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

      clusters: clusters.slice(0, 12).map(cl => ({
        topic: String(cl?.topic ?? '').slice(0, 100).trim(),
        words: Array.isArray(cl?.words)
          ? cl.words.slice(0, 20).map(w => String(w).slice(0, 80).trim()).filter(Boolean)
          : [],
      })).filter(cl => cl.topic || cl.words.length),

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

    let _lastCanvasW = 0, _lastCanvasH = 0;
    _resizeObs = new ResizeObserver(() => {
      if (!_data || !_overlay?.classList.contains('visible')) return;
      const rect = _svg.getBoundingClientRect();
      const w = Math.round(rect.width), h = Math.round(rect.height);
      if (w === _lastCanvasW && h === _lastCanvasH) return;
      _lastCanvasW = w; _lastCanvasH = h;
      _resetTransform();
      _render();
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

  function _attachWordInteractions(el, word, cx, cy) {
    el.style.cursor = 'pointer';
    let clickTimer = null;
    el.addEventListener('click', () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        clickTimer = null;
        if (!_overlay?.classList.contains('visible')) return;
        _jumpToWord(word);
      }, 220);
    });
    el.addEventListener('dblclick', () => {
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
    if (_loading) _abortController?.abort();
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

  function _mergeLinks(localLinks = [], llmLinks = [], maxLinks = 100) {
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
        map.set(pairKey, { from: link.from, to: link.to, strength, _score: strength + sourceBoost, synthetic: link.synthetic });
      }
    }
    localLinks.forEach(l => add(l, 0));
    llmLinks.forEach(l => add(l, 0.25));
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

  function _buildLocalLinks(text, words, maxLinks = 100) {
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
      enterG.classList.add('mm-enter');
      enterG.style.animationDelay = `${i * 25}ms`;

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
  }

  function _drawGraph(W, H) {
    const allWords = _data.words || [];
    const allLinks = _data.links || [];
    if (!allWords.length) return;

    const filteredLinks = _ensureMinimumGraphLinks(allWords, allLinks);
    const words = _selectGraphWords(allWords, filteredLinks, 45);
    if (!words.length) return;

    const weights = words.map(w => Number(w.weight) || 1);
    const maxW = Math.max(1, ...weights);

    function graphKey(s) {
      return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    }

    const wordKeys = new Set(words.map(w => graphKey(w.w)));
    const links = filteredLinks.filter(l =>
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

    const iterCount = nodes.length > 90 ? 35 : 60;

    for (let iter = 0; iter < iterCount; iter++) {
      nodes.forEach(a => {
        nodes.forEach(b => {
          if (a === b) return;
          let dx = a.x - b.x, dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          let force = 800 / (dist * dist);
          a.vx += (dx / dist) * force;
          a.vy += (dy / dist) * force;
        });
      });
      links.forEach(l => {
        const ai = nodeMap.get(graphKey(l.from)), bi = nodeMap.get(graphKey(l.to));
        if (ai == null || bi == null) return;
        const a = nodes[ai], b = nodes[bi];
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = (dist - 100) * 0.005;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      });
      nodes.forEach(n => {
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(40, Math.min(W - 40, n.x));
        n.y = Math.max(30, Math.min(H - 30, n.y));
      });
    }

    nodes.forEach(n => { n.r = 6 + (n.weight / maxW) * 16; });

    function edgePoint(from, to, offset) {
      const dx = to.x - from.x, dy = to.y - from.y;
      const dist = Math.hypot(dx, dy) || 1;
      return { x: from.x + (dx / dist) * offset, y: from.y + (dy / dist) * offset };
    }

    const linksG = document.createElementNS(SVG_NS, 'g');
    linksG.dataset.depth = '0.12';
    links.forEach(l => {
      const ai = nodeMap.get(graphKey(l.from)), bi = nodeMap.get(graphKey(l.to));
      if (ai == null || bi == null) return;
      const a = nodes[ai], b = nodes[bi];
      const start = edgePoint(a, b, a.r + 2);
      const end = edgePoint(b, a, b.r + 2);
      const mx = (start.x + end.x) / 2 + (end.y - start.y) * 0.15;
      const my = (start.y + end.y) / 2 - (end.x - start.x) * 0.15;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${start.x} ${start.y} Q ${mx} ${my} ${end.x} ${end.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', l.synthetic ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)');
      path.setAttribute('stroke-width', String(0.5 + l.strength * 2.5));
      path.setAttribute('stroke-linecap', 'round');
      linksG.appendChild(path);
    });
    _viewport.appendChild(linksG);

    nodes.forEach((n, i) => {
      const r = 6 + (n.weight / maxW) * 16;
      const color = n.role && n.role !== 'topic'
        ? (ROLE_COLORS[n.role] || PALETTE[i % PALETTE.length])
        : PALETTE[(Number.isFinite(n.colorIndex) ? n.colorIndex : i) % PALETTE.length];

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
      circle.setAttribute('opacity', '0.85');
      if (n.weight > 7) circle.setAttribute('filter', 'url(#bloom)');
      circle.style.cursor = 'pointer';
      circle.style.transition = 'r 0.2s, opacity 0.2s';
      circle.addEventListener('mouseenter', () => { circle.setAttribute('opacity', '1'); circle.setAttribute('r', r + 3); circle.classList.add('mm-pulse'); });
      circle.addEventListener('mouseleave', () => { circle.setAttribute('opacity', '0.8'); circle.setAttribute('r', r); circle.classList.remove('mm-pulse'); });
      _attachWordInteractions(circle, n.w, n.x, n.y);
      depthG.appendChild(circle);

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', n.x); text.setAttribute('y', n.y + r + 14);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', 'var(--text2)');
      text.setAttribute('font-family', 'var(--mono)');
      text.textContent = n.w;
      depthG.appendChild(text);
      enterG.appendChild(depthG);
      _viewport.appendChild(enterG);
    });
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
    const clusters = _data.clusters || [];
    if (!clusters.length) return;
    const cx = W / 2, cy = H / 2;
    const angleStep = (Math.PI * 2) / clusters.length;
    const maxR = Math.max(...clusters.map(cl => 50 + Math.max(1, cl.words.length) * 12));
    const safeDistX = Math.max(0, W / 2 - maxR - 20);
    const safeDistY = Math.max(0, H / 2 - maxR * 0.7 - 20);
    const safeDist = Math.min(safeDistX, safeDistY);
    const desiredDist = Math.max(Math.min(W, H) * 0.28, maxR * 1.1);
    const dist = Math.min(desiredDist, safeDist);

    clusters.forEach((cl, ci) => {
      const angle = angleStep * ci - Math.PI / 2;
      const ccx = cx + Math.cos(angle) * dist;
      const ccy = cy + Math.sin(angle) * dist;
      const color = PALETTE[ci % PALETTE.length];
      const r = 50 + cl.words.length * 12;

      const enterG = document.createElementNS(SVG_NS, 'g');
      enterG.classList.add('mm-enter');
      enterG.style.animationDelay = `${ci * 60}ms`;

      const depthG = document.createElementNS(SVG_NS, 'g');
      depthG.dataset.depth = '0.3';

      const cgradId = `mindmap-cgrad-${ci}`;
      const cgrad = document.createElementNS(SVG_NS, 'radialGradient');
      cgrad.setAttribute('id', cgradId);
      cgrad.setAttribute('cx', `${20 + Math.random() * 60}%`);
      cgrad.setAttribute('cy', `${20 + Math.random() * 60}%`);
      cgrad.setAttribute('r', '70%');
      cgrad.innerHTML = `
        <stop offset="0%" stop-color="#fff" stop-opacity="0.8"/>
        <stop offset="30%" stop-color="${color}" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.1"/>
      `;
      _svg.querySelector('defs').appendChild(cgrad);

      const ellipse = document.createElementNS(SVG_NS, 'ellipse');
      ellipse.setAttribute('cx', ccx); ellipse.setAttribute('cy', ccy);
      ellipse.setAttribute('rx', r); ellipse.setAttribute('ry', r * 0.7);
      ellipse.setAttribute('fill', `url(#${cgradId})`);
      ellipse.setAttribute('fill-opacity', '0.35');
      ellipse.setAttribute('stroke', color + '40');
      ellipse.setAttribute('stroke-width', '1');
      ellipse.style.transition = 'fill-opacity 0.3s, stroke 0.3s';
      ellipse.addEventListener('mouseenter', () => { ellipse.setAttribute('fill-opacity', '0.55'); ellipse.setAttribute('stroke', color + '60'); ellipse.classList.add('mm-pulse'); });
      ellipse.addEventListener('mouseleave', () => { ellipse.setAttribute('fill-opacity', '0.35'); ellipse.setAttribute('stroke', color + '40'); ellipse.classList.remove('mm-pulse'); });
      depthG.appendChild(ellipse);

      const title = document.createElementNS(SVG_NS, 'text');
      title.setAttribute('x', ccx); title.setAttribute('y', ccy - r * 0.35);
      title.setAttribute('text-anchor', 'middle');
      title.setAttribute('font-size', '11'); title.setAttribute('font-weight', '700');
      title.setAttribute('fill', color); title.setAttribute('font-family', 'var(--mono)');
      title.textContent = cl.topic;
      depthG.appendChild(title);

      const wordsG = document.createElementNS(SVG_NS, 'g');
      wordsG.dataset.depth = '0.18';
      cl.words.forEach((w, wi) => {
        const a = (wi / cl.words.length) * Math.PI * 2;
        const wr = r * 0.45;
        const wx = ccx + Math.cos(a) * wr;
        const wy = ccy + Math.sin(a) * wr * 0.7 + 8;
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', wx); t.setAttribute('y', wy);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', '10'); t.setAttribute('fill', 'var(--text1)');
        t.setAttribute('font-family', 'var(--mono)');
        t.textContent = w;
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
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', -marginX + Math.random() * totalW);
      dot.setAttribute('cy', -marginY + Math.random() * totalH);
      dot.setAttribute('r', (Math.random() * 1.2 + 0.3).toFixed(1));
      dot.setAttribute('fill', 'rgba(255,255,255,0.25)');
      g.appendChild(dot);
    }
    return g;
  }

  return { open, close };
})();
