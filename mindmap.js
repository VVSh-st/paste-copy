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
      _overlay.querySelector('.mindmap-status').textContent = 'Анализирую...';
      _overlay.querySelector('.mindmap-refresh').classList.add('spinning');
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
      if (_loading) return;
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

    _resizeObs = new ResizeObserver(() => {
      if (_data && _overlay?.classList.contains('visible')) {
        _resetTransform();
        _render();
      }
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

  function _jumpToWord(word) {
    document.dispatchEvent(new CustomEvent('mindmap:jump-word', { detail: { word } }));
    close();
  }

  function _smoothZoomTo(targetX, targetY, targetZoom) {
    cancelAnimationFrame(_inertiaRaf);
    _viewport.style.transition = 'transform 0.4s cubic-bezier(.2,.8,.2,1)';
    const rect = _svg.getBoundingClientRect();
    _zoom = targetZoom;
    _panX = rect.width / 2 - targetX * targetZoom;
    _panY = rect.height / 2 - targetY * targetZoom;
    _applyTransform();
    setTimeout(() => { _viewport.style.transition = ''; }, 400);
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
    _viewport.querySelectorAll('[data-depth]').forEach(el => {
      const depth = parseFloat(el.dataset.depth);
      const blurAmt = (0.3 - depth) * 6;
      el.style.filter = blurAmt > 0.3 ? `blur(${blurAmt.toFixed(1)}px)` : '';
    });
  }

  function _syncZoomSlider() {
    const r = _overlay?.querySelector('.mindmap-zoom-range');
    if (r) r.value = Math.round(_zoom * 100);
  }

  function _applyParallax(nx, ny) {
    if (!_viewport) return;
    _viewport.querySelectorAll('[data-depth]').forEach(el => {
      const depth = parseFloat(el.dataset.depth);
      const px = nx * depth * 40;
      const py = ny * depth * 40;
      el.style.transform = `translate(${px}px, ${py}px)`;
    });
  }

  function open() {
    _ensureOverlay();
    if (_loading) return;

    _overlay.classList.add('visible');
    _overlay.querySelector('.mindmap-canvas').innerHTML = '';
    _svg = document.createElementNS(SVG_NS, 'svg');
    _svg.setAttribute('width', '100%');
    _svg.setAttribute('height', '100%');
    _svg.style.display = 'block';
    _overlay.querySelector('.mindmap-canvas').appendChild(_svg);
    _overlay.querySelectorAll('.mindmap-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
    _resetTransform();
    _syncZoomSlider();
    _setupSvgListeners();

    if (_data) {
      _overlay.querySelector('.mindmap-status').textContent = '';
      _overlay.querySelector('.mindmap-refresh')?.classList.remove('spinning');
      _render();
      return;
    }

    const text = window.Preview?.getText?.() ?? '';
    if (!text.trim()) { window.Toast?.show('Превью пустое', 'info'); return; }
    _overlay.querySelector('.mindmap-status').textContent = 'Анализирую...';
    _overlay.querySelector('.mindmap-refresh')?.classList.add('spinning');
    _fetch(text);
  }

  function _setupSvgListeners() {
    _svg.addEventListener('wheel', e => {
      if (_loading) return;
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
      if (e.button !== 0 || _loading) return;
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
    _overlay.classList.remove('visible');
  }

  async function _fetch(text) {
    _loading = true;
    try {
      const result = await window.LLMCore?.request?.({
        messages: [{ role: 'user', content: window.LLMCore.getPrompt('mindmap') + '\n\n' + text.slice(0, 4000) }],
        stream: false,
        maxTokens: 2000,
        featureTag: 'mindmap',
      });
      if (!result?.trim()) { window.Toast?.show('Нет результата', 'info'); close(); return; }
      let json;
      try { json = JSON.parse(result.trim()); } catch {
        const m = result.match(/\{[\s\S]*\}/);
        if (m) json = JSON.parse(m[0]);
        else { window.Toast?.show('Не удалось распарсить JSON', 'error'); close(); return; }
      }
      _data = json;
      _overlay.querySelector('.mindmap-status').textContent = '';
      _render();
    } catch (e) {
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
      close();
    } finally {
      _loading = false;
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
    }
    _applyDepthBlur();
    _applyTransform();
  }

  function _drawWords(W, H) {
    const words = _data.words || [];
    if (!words.length) return;
    const maxW = Math.max(...words.map(w => w.weight));
    const placed = [];
    const padding = 8;

    const sorted = [...words].sort((a, b) => b.weight - a.weight);
    sorted.forEach((item, i) => {
      const fontSize = 10 + (item.weight / maxW) * 28;
      const color = ROLE_COLORS[item.role] || PALETTE[i % PALETTE.length];
      const tw = item.w.length * fontSize * 0.6;
      const th = fontSize * 1.3;
      let x, y, tries = 0;
      do {
        x = padding + Math.random() * (W - tw - padding * 2);
        y = padding + th + Math.random() * (H - th - padding * 2);
        tries++;
      } while (tries < 80 && placed.some(p =>
        Math.abs(x + tw / 2 - p.cx) < (tw / 2 + p.hw + padding) &&
        Math.abs(y - th / 2 - p.cy) < (th / 2 + p.hh + padding)
      ));
      placed.push({ cx: x + tw / 2, cy: y - th / 2, hw: tw / 2, hh: th / 2 });

      const enterG = document.createElementNS(SVG_NS, 'g');
      enterG.classList.add('mm-enter');
      enterG.style.animationDelay = `${i * 25}ms`;

      const depthG = document.createElementNS(SVG_NS, 'g');
      depthG.dataset.depth = item.weight > 7 ? '0.3' : '0.12';

      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y);
      text.setAttribute('font-size', fontSize);
      text.setAttribute('fill', color);
      text.setAttribute('font-family', 'var(--mono)');
      text.setAttribute('font-weight', item.weight > 6 ? '700' : '400');
      text.setAttribute('opacity', 0.4 + (item.weight / maxW) * 0.6);
      if (item.weight > 7) text.setAttribute('filter', 'url(#bloom)');
      text.textContent = item.w;
      text.style.cursor = 'pointer';
      text.style.transition = 'opacity 0.2s, font-size 0.2s';
      text.addEventListener('mouseenter', () => { text.setAttribute('opacity', '1'); text.setAttribute('font-size', fontSize + 4); text.classList.add('mm-pulse'); });
      text.addEventListener('mouseleave', () => { text.setAttribute('opacity', String(0.4 + (item.weight / maxW) * 0.6)); text.setAttribute('font-size', fontSize); text.classList.remove('mm-pulse'); });
      let clickTimer = null;
      text.addEventListener('click', () => {
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => { clickTimer = null; _jumpToWord(item.w); }, 220);
      });
      text.addEventListener('dblclick', () => {
        clearTimeout(clickTimer);
        clickTimer = null;
        _smoothZoomTo(x + tw / 2, y - th / 2, 2);
      });
      depthG.appendChild(text);
      enterG.appendChild(depthG);
      _viewport.appendChild(enterG);
    });
  }

  function _drawGraph(W, H) {
    const words = _data.words || [];
    const links = _data.links || [];
    if (!words.length) return;
    const maxW = Math.max(...words.map(w => w.weight));

    const dedup = [];
    const seen = new Map();
    words.forEach((w, i) => {
      if (seen.has(w.w)) { seen.get(w.w).indices.push(i); return; }
      const entry = { ...w, indices: [i] };
      seen.set(w.w, entry);
      dedup.push(entry);
    });

    const nodes = dedup.map((w, i) => ({
      ...w, idx: i,
      x: W / 2 + (Math.random() - 0.5) * W * 0.6,
      y: H / 2 + (Math.random() - 0.5) * H * 0.6,
      vx: 0, vy: 0
    }));

    const nodeMap = {};
    dedup.forEach((w, i) => { nodeMap[w.w] = i; });

    for (let iter = 0; iter < 60; iter++) {
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
        const ai = nodeMap[l.from], bi = nodeMap[l.to];
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

    const linksG = document.createElementNS(SVG_NS, 'g');
    linksG.dataset.depth = '0.12';
    links.forEach(l => {
      const ai = nodeMap[l.from], bi = nodeMap[l.to];
      if (ai == null || bi == null) return;
      const a = nodes[ai], b = nodes[bi];
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(255,255,255,0.12)');
      path.setAttribute('stroke-width', String(0.5 + l.strength * 2.5));
      path.setAttribute('stroke-linecap', 'round');
      linksG.appendChild(path);
    });
    _viewport.appendChild(linksG);

    nodes.forEach((n, i) => {
      const r = 6 + (n.weight / maxW) * 16;
      const color = ROLE_COLORS[n.role] || PALETTE[i % PALETTE.length];

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
      circle.addEventListener('dblclick', () => _smoothZoomTo(n.x, n.y, 2));
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

    const rowH = Math.min(80, (H - pad * 2) / rows.length);
    const startY = pad + 20;

    rows.forEach((r, i) => {
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

      const words = r.text.split(' ');
      let line = '', lineY = y + 32, lineNum = 0;
      const maxLineW = colW - 24;
      words.forEach(w => {
        if (lineNum > 2) return;
        const test = line + w + ' ';
        if (test.length * 7 > maxLineW && line) {
          const t = document.createElementNS(SVG_NS, 'text');
          t.setAttribute('x', pad + 12); t.setAttribute('y', lineY + lineNum * 16);
          t.setAttribute('font-size', '12'); t.setAttribute('fill', 'var(--text1)');
          t.setAttribute('font-family', 'var(--mono)');
          t.textContent = line.trim();
          depthG.appendChild(t);
          line = w + ' '; lineNum++;
        } else { line = test; }
      });
      if (line.trim() && lineNum <= 2) {
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', pad + 12); t.setAttribute('y', lineY + lineNum * 16);
        t.setAttribute('font-size', '12'); t.setAttribute('fill', 'var(--text1)');
        t.setAttribute('font-family', 'var(--mono)');
        t.textContent = line.trim();
        depthG.appendChild(t);
      }

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
    const maxR = Math.max(...clusters.map(cl => 50 + cl.words.length * 12));
    const dist = Math.max(Math.min(W, H) * 0.28, maxR * 1.3);

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

      const gradId = 'grad-' + color.replace('#', '');
      const ellipse = document.createElementNS(SVG_NS, 'ellipse');
      ellipse.setAttribute('cx', ccx); ellipse.setAttribute('cy', ccy);
      ellipse.setAttribute('rx', r); ellipse.setAttribute('ry', r * 0.7);
      ellipse.setAttribute('fill', `url(#${gradId})`);
      ellipse.setAttribute('stroke', color + '45');
      ellipse.setAttribute('stroke-width', '1.5');
      ellipse.style.transition = 'fill 0.3s';
      ellipse.addEventListener('mouseenter', () => { ellipse.setAttribute('fill', color + '28'); ellipse.classList.add('mm-pulse'); });
      ellipse.addEventListener('mouseleave', () => { ellipse.setAttribute('fill', `url(#${gradId})`); ellipse.classList.remove('mm-pulse'); });
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

  function _drawStarfield(W, H) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.dataset.depth = '0.05';
    const count = Math.floor((W * H) / 9000);
    for (let i = 0; i < count; i++) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', Math.random() * W);
      dot.setAttribute('cy', Math.random() * H);
      dot.setAttribute('r', (Math.random() * 1.2 + 0.3).toFixed(1));
      dot.setAttribute('fill', 'rgba(255,255,255,0.25)');
      g.appendChild(dot);
    }
    return g;
  }

  return { open, close };
})();
