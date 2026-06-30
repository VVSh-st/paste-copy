const Flowchart = (() => {
  let _overlay = null;
  let _panel = null;
  let _svg = null;
  let _viewport = null;
  let _mode = 'flow';
  let _data = null;
  let _loading = false;
  let _resizeObs = null;

  let _zoom = 1, _panX = 0, _panY = 0;
  let _dragging = false, _lastX = 0, _lastY = 0, _movedEnough = false;
  let _velX = 0, _velY = 0, _inertiaRaf = null;

  let _rafPending = false;
  let _parallaxNX = 0, _parallaxNY = 0;

  let _dragNode = null, _dragOffX = 0, _dragOffY = 0;
  let _nodes = [], _edges = [];
  let _connectMode = false, _connectFrom = null;

  const PALETTE = ['#4f8ef7', '#5cb87a', '#f0a050', '#e05c6a', '#a78bfa', '#f472b6', '#22d3ee', '#fbbf24'];

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function _resetTransform() {
    _zoom = 1; _panX = 0; _panY = 0;
    if (_viewport) _viewport.setAttribute('transform', 'translate(0,0) scale(1)');
  }

  function _applyTransform() {
    if (_viewport) _viewport.setAttribute('transform', `translate(${_panX},${_panY}) scale(${_zoom})`);
  }

  function _gradIdFor(color) { return 'grad-' + color.replace('#', ''); }

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
      <stop offset="0%" stop-color="#fff" stop-opacity="0.8"/>
      <stop offset="35%" stop-color="${color}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.15"/>
    `;
    defs.appendChild(grad);
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

  function _wrapTextLines(text, maxWidth, maxLines) {
    const words = (text || '').split(' ');
    const lines = [];
    let line = '';
    words.forEach(w => {
      if (lines.length >= maxLines) return;
      const test = line + w + ' ';
      if (test.length * 7 > maxWidth && line) {
        lines.push(line.trim());
        line = w + ' ';
      } else { line = test; }
    });
    if (line.trim() && lines.length < maxLines) lines.push(line.trim());
    return lines;
  }

  function _nodeSize(node) {
    const label = node.label || node.id || '';
    const lines = label.split('\n');
    const maxLineW = Math.max(...lines.map(l => l.length), 4) * 7 + 32;
    const w = Math.max(140, Math.min(220, maxLineW));
    const h = 46 + Math.max(0, (lines.length - 1) * 14);
    switch (node.shape) {
      case 'diamond': return { w: Math.max(w, 100), h: Math.max(h, 66) };
      case 'circle': return { w: 50, h: 50 };
      case 'cylinder': return { w, h: h + 14 };
      case 'stadium': return { w: Math.max(w, 120), h };
      default: return { w, h };
    }
  }

  function _ensureOverlay() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.className = 'flowchart-overlay';
    _overlay.innerHTML = `
      <div class="flowchart-panel">
        <div class="flowchart-controls">
          <button class="flowchart-btn" data-mode="flow" title="Блок-схема">F</button>
          <button class="flowchart-btn" data-mode="graph" title="Граф связей">G</button>
          <button class="flowchart-btn flowchart-add" title="Добавить блок">+</button>
          <button class="flowchart-btn flowchart-connect" title="Соединить блоки">↗</button>
          <button class="flowchart-btn flowchart-refresh" title="Обновить анализ">↻</button>
          <button class="flowchart-btn flowchart-close" title="Закрыть">✕</button>
        </div>
        <div class="flowchart-zoom">
          <input type="range" class="flowchart-zoom-range" min="40" max="400" value="100" step="1">
        </div>
        <div class="flowchart-status"></div>
        <div class="flowchart-canvas"></div>
      </div>`;
    document.body.appendChild(_overlay);

    _panel = _overlay.querySelector('.flowchart-panel');
    const canvas = _overlay.querySelector('.flowchart-canvas');

    _svg = document.createElementNS(SVG_NS, 'svg');
    _svg.setAttribute('width', '100%');
    _svg.setAttribute('height', '100%');
    _svg.style.display = 'block';
    canvas.appendChild(_svg);

    _overlay.addEventListener('click', e => { if (e.target === _overlay) close(); });
    _overlay.addEventListener('contextmenu', e => { if (e.target === _overlay) { e.preventDefault(); close(); } });
    _overlay.querySelector('.flowchart-close').addEventListener('click', close);

    _overlay.querySelectorAll('.flowchart-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        _mode = btn.dataset.mode;
        _overlay.querySelectorAll('.flowchart-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
        _resetTransform(); _syncZoomSlider();
        if (_data) _render();
      });
    });

    _overlay.querySelector('.flowchart-refresh').addEventListener('click', () => {
      if (_loading) return;
      const text = window.Preview?.getText?.() ?? '';
      if (!text.trim()) { window.Toast?.show('Превью пустое', 'info'); return; }
      _overlay.querySelector('.flowchart-status').textContent = 'Анализирую...';
      _overlay.querySelector('.flowchart-refresh').classList.add('spinning');
      _fetch(text);
    });

    _overlay.querySelector('.flowchart-add').addEventListener('click', () => {
      _addNode();
    });

    _overlay.querySelector('.flowchart-connect').addEventListener('click', () => {
      _connectMode = !_connectMode;
      _connectFrom = null;
      _overlay.querySelector('.flowchart-connect').classList.toggle('active', _connectMode);
      if (_connectMode) window.Toast?.show('Кликните на исходный блок', 'info');
    });

    function _setupProximityReveal(el, radius) {
      _overlay.addEventListener('mousemove', e => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        el.classList.toggle('near', Math.hypot(e.clientX - cx, e.clientY - cy) < radius);
      });
    }
    _setupProximityReveal(_overlay.querySelector('.flowchart-controls'), 150);
    _setupProximityReveal(_overlay.querySelector('.flowchart-zoom'), 120);

    const zoomRange = _overlay.querySelector('.flowchart-zoom-range');
    const zoomWrap = _overlay.querySelector('.flowchart-zoom');
    zoomRange.addEventListener('input', () => {
      if (_loading) return;
      const newZoom = zoomRange.value / 100;
      const rect = _svg.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      _panX = cx - (cx - _panX) * (newZoom / _zoom);
      _panY = cy - (cy - _panY) * (newZoom / _zoom);
      _zoom = newZoom; _applyTransform();
    });
    zoomRange.addEventListener('mousedown', () => zoomWrap.classList.add('dragging'));
    window.addEventListener('mouseup', () => zoomWrap.classList.remove('dragging'));
    zoomRange.addEventListener('dblclick', () => { _resetTransform(); zoomRange.value = 100; });

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
      if (_data && _overlay?.classList.contains('visible')) { _resetTransform(); _render(); }
    });
    _resizeObs.observe(canvas);

    _panel.addEventListener('mousemove', e => {
      const r = _panel.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      _panel.style.transform = `perspective(1000px) rotateX(${-ny * 4}deg) rotateY(${nx * 4}deg)`;
    });
    _panel.addEventListener('mouseleave', () => { _panel.style.transform = ''; });
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
      if (Math.abs(_velX) + Math.abs(_velY) > 0.3) _inertiaRaf = requestAnimationFrame(tick);
    }
    _inertiaRaf = requestAnimationFrame(tick);
  }

  function _syncZoomSlider() {
    const r = _overlay?.querySelector('.flowchart-zoom-range');
    if (r) r.value = Math.round(_zoom * 100);
  }

  function _applyParallax(nx, ny) {
    if (!_viewport) return;
    _viewport.querySelectorAll('[data-depth]').forEach(el => {
      const depth = parseFloat(el.dataset.depth);
      el.style.transform = `translate(${nx * depth * 30}px, ${ny * depth * 30}px)`;
    });
  }

  function open() {
    _ensureOverlay();
    if (_loading) return;
    _overlay.classList.add('visible');
    _overlay.querySelector('.flowchart-canvas').innerHTML = '';
    _svg = document.createElementNS(SVG_NS, 'svg');
    _svg.setAttribute('width', '100%');
    _svg.setAttribute('height', '100%');
    _svg.style.display = 'block';
    _overlay.querySelector('.flowchart-canvas').appendChild(_svg);
    _overlay.querySelectorAll('.flowchart-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
    _resetTransform(); _syncZoomSlider(); _setupSvgListeners();

    if (_data) {
      _overlay.querySelector('.flowchart-status').textContent = '';
      _overlay.querySelector('.flowchart-refresh')?.classList.remove('spinning');
      _render();
      return;
    }
    const text = window.Preview?.getText?.() ?? '';
    if (!text.trim()) { window.Toast?.show('Превью пустое', 'info'); return; }
    _overlay.querySelector('.flowchart-status').textContent = 'Анализирую...';
    _overlay.querySelector('.flowchart-refresh')?.classList.add('spinning');
    _fetch(text);
  }

  function _setupSvgListeners() {
    _svg.addEventListener('wheel', e => {
      if (_loading) return;
      e.preventDefault();
      const rect = _svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = Math.min(4, Math.max(0.4, _zoom * factor));
      _panX = mx - (mx - _panX) * (newZoom / _zoom);
      _panY = my - (my - _panY) * (newZoom / _zoom);
      _zoom = newZoom; _applyTransform(); _syncZoomSlider();
    }, { passive: false });

    _svg.addEventListener('mousedown', e => {
      if (_loading) return;
      const nodeEl = e.target.closest('[data-node-id]');
      if (nodeEl) {
        const nodeId = nodeEl.dataset.nodeId;
        if (_connectMode) {
          if (!_connectFrom) {
            _connectFrom = nodeId;
            nodeEl.querySelector('rect, polygon, circle')?.setAttribute('stroke-width', '3');
            window.Toast?.show('Теперь кликните на целевой блок', 'info');
          } else if (_connectFrom !== nodeId) {
            _edges.push({ from: _connectFrom, to: nodeId, label: '' });
            _connectFrom = null;
            _connectMode = false;
            _overlay.querySelector('.flowchart-connect').classList.remove('active');
            _renderEdges();
            _syncData();
          }
          return;
        }
        e.stopPropagation();
        cancelAnimationFrame(_inertiaRaf);
        _dragging = false;
        _dragNode = nodeId;
        const node = _nodes.find(n => n.id === _dragNode);
        if (node) {
          const rect = _svg.getBoundingClientRect();
          const mx = (e.clientX - rect.left - _panX) / _zoom;
          const my = (e.clientY - rect.top - _panY) / _zoom;
          _dragOffX = mx - node.x;
          _dragOffY = my - node.y;
        }
        return;
      }
      if (e.button !== 0) return;
      cancelAnimationFrame(_inertiaRaf);
      _dragging = true; _movedEnough = false;
      _lastX = e.clientX; _lastY = e.clientY;
    });

    _svg.addEventListener('dblclick', e => {
      const nodeEl = e.target.closest('[data-node-id]');
      if (!nodeEl) return;
      const node = _nodes.find(n => n.id === nodeEl.dataset.nodeId);
      if (!node) return;
      const newName = prompt('Текст блока:', node.label || node.id);
      if (newName !== null && newName.trim()) {
        node.label = newName.trim();
        _syncData();
        _render();
      }
    });

    _svg.addEventListener('contextmenu', e => {
      const nodeEl = e.target.closest('[data-node-id]');
      if (!nodeEl) return;
      e.preventDefault();
      const nodeId = nodeEl.dataset.nodeId;
      const node = _nodes.find(n => n.id === nodeId);
      if (!node) return;
      if (!confirm(`Удалить блок «${node.label}»?`)) return;
      _nodes = _nodes.filter(n => n.id !== nodeId);
      _edges = _edges.filter(e => e.from !== nodeId && e.to !== nodeId);
      _syncData();
      _render();
    });

    window.addEventListener('mousemove', e => {
      if (!_dragNode) return;
      const node = _nodes.find(n => n.id === _dragNode);
      if (!node) return;
      const rect = _svg.getBoundingClientRect();
      const mx = (e.clientX - rect.left - _panX) / _zoom;
      const my = (e.clientY - rect.top - _panY) / _zoom;
      node.x = mx - _dragOffX;
      node.y = my - _dragOffY;
      _updateNodePosition(node);
      _renderEdges();
    });

    window.addEventListener('mouseup', () => {
      if (_dragNode) { _dragNode = null; return; }
    });

    _svg.addEventListener('mousemove', e => {
      if (_dragging || _dragNode) return;
      const rect = _svg.getBoundingClientRect();
      _parallaxNX = (e.clientX - rect.left - rect.width / 2) / rect.width;
      _parallaxNY = (e.clientY - rect.top - rect.height / 2) / rect.height;
      if (!_rafPending) {
        _rafPending = true;
        requestAnimationFrame(() => { _rafPending = false; _applyParallax(_parallaxNX, _parallaxNY); });
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
        messages: [{ role: 'user', content: window.LLMCore.getPrompt('flowchart') + '\n\n' + text.slice(0, 4000) }],
        stream: false,
        maxTokens: 2500,
        featureTag: 'flowchart',
      });
      if (!result?.trim()) { window.Toast?.show('Нет результата', 'info'); close(); return; }
      let json;
      try { json = JSON.parse(result.trim()); } catch {
        const m = result.match(/\{[\s\S]*\}/);
        if (m) json = JSON.parse(m[0]);
        else { window.Toast?.show('Не удалось распарсить JSON', 'error'); close(); return; }
      }
      _data = json;
      _overlay.querySelector('.flowchart-status').textContent = '';
      _render();
    } catch (e) {
      if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error');
      close();
    } finally {
      _loading = false;
      _overlay?.querySelector('.flowchart-refresh')?.classList.remove('spinning');
    }
  }

  function _buildDefs() {
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <filter id="fc-shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.25"/></filter>
      <marker id="fc-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,1 L7,4 L0,7 Z" fill="rgba(255,255,255,0.35)"/>
      </marker>
    `;
    const seen = new Set();
    PALETTE.forEach(c => {
      if (seen.has(c)) return; seen.add(c);
      const grad = document.createElementNS(SVG_NS, 'radialGradient');
      grad.setAttribute('id', _gradIdFor(c));
      grad.setAttribute('cx', '35%'); grad.setAttribute('cy', '30%'); grad.setAttribute('r', '70%');
      grad.innerHTML = `
        <stop offset="0%" stop-color="#fff" stop-opacity="0.8"/>
        <stop offset="35%" stop-color="${c}" stop-opacity="0.9"/>
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
    const W = rect.width || 700, H = rect.height || 450;
    _svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    _svg.appendChild(_buildDefs());

    _viewport = document.createElementNS(SVG_NS, 'g');
    _viewport.setAttribute('class', 'fc-viewport');
    _svg.appendChild(_viewport);

    _viewport.appendChild(_drawStarfield(W, H));

    _nodes = (_data.nodes || []).map(n => ({ ...n, x: 0, y: 0, ..._nodeSize(n) }));
    _edges = _data.edges || [];

    if (!_nodes.length) {
      _viewport.appendChild(_emptyMsg('Нет данных для блок-схемы'));
      _applyTransform();
      return;
    }

    _autoLayout(W, H);

    _edgesG = document.createElementNS(SVG_NS, 'g');
    _edgesG.setAttribute('class', 'fc-edges');
    _viewport.appendChild(_edgesG);
    _renderEdges();

    _nodes.forEach((node, i) => _drawNode(node, i));

    _applyTransform();
  }

  let _edgesG = null;

  function _autoLayout(W, H) {
    const adj = {};
    _nodes.forEach(n => adj[n.id] = []);
    _edges.forEach(e => { if (adj[e.from]) adj[e.from].push(e.to); });

    const inDeg = {};
    _nodes.forEach(n => inDeg[n.id] = 0);
    _edges.forEach(e => { if (inDeg[e.to] !== undefined) inDeg[e.to]++; });

    const levels = [];
    const visited = new Set();
    let queue = _nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
    if (!queue.length) queue = [_nodes[0]?.id].filter(Boolean);

    while (queue.length) {
      levels.push([...queue]);
      queue.forEach(id => visited.add(id));
      const next = [];
      queue.forEach(id => {
        (adj[id] || []).forEach(to => {
          if (!visited.has(to) && !next.includes(to)) {
            const allParentsvisited = _edges.filter(e => e.to === to).every(e => visited.has(e.from));
            if (allParentsvisited) next.push(to);
          }
        });
      });
      queue = next;
    }

    _nodes.filter(n => !visited.has(n.id)).forEach(n => {
      levels.push([n.id]);
      visited.add(n.id);
    });

    const nodeMap = {};
    _nodes.forEach(n => nodeMap[n.id] = n);

    const levelGap = 100;
    const totalH = levels.length * levelGap;
    const startY = (H - totalH) / 2 + 30;

    levels.forEach((level, li) => {
      const totalW = level.length * 200;
      const startX = (W - totalW) / 2 + 100;
      level.forEach((id, ni) => {
        const node = nodeMap[id];
        if (node) {
          node.x = startX + ni * 200;
          node.y = startY + li * levelGap;
        }
      });
    });
  }

  function _renderEdges() {
    if (!_edgesG) return;
    _edgesG.innerHTML = '';
    const nodeMap = {};
    _nodes.forEach(n => nodeMap[n.id] = n);

    _edges.forEach(e => {
      const a = nodeMap[e.from], b = nodeMap[e.to];
      if (!a || !b) return;
      _drawEdge(a, b, e.label || '');
    });
  }

  function _drawEdge(a, b, label) {
    const x1 = a.x, y1 = a.y + a.h / 2;
    const x2 = b.x, y2 = b.y - b.h / 2;
    const dy = Math.abs(y2 - y1) * 0.4 || 30;

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(255,255,255,0.2)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('marker-end', 'url(#fc-arrow)');
    _edgesG.appendChild(path);

    if (label) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', mx + 8); t.setAttribute('y', my);
      t.setAttribute('fill', 'var(--text2)'); t.setAttribute('font-size', '10');
      t.setAttribute('font-family', 'var(--mono)');
      t.textContent = label;
      _edgesG.appendChild(t);
    }
  }

  function _drawNode(node, i) {
    const color = PALETTE[i % PALETTE.length];
    _ensureGradient(color);

    const enterG = document.createElementNS(SVG_NS, 'g');
    enterG.classList.add('fc-enter');
    enterG.style.animationDelay = `${i * 30}ms`;

    const depthG = document.createElementNS(SVG_NS, 'g');
    depthG.dataset.depth = '0.2';
    depthG.dataset.nodeId = node.id;

    const { w, h } = _nodeSize(node);
    const x = node.x - w / 2, y = node.y - h / 2;
    const gradId = _gradIdFor(color);

    let shapeEl;
    switch (node.shape) {
      case 'diamond': {
        const cx = node.x, cy = node.y;
        const dw = w * 0.55, dh = h * 0.55;
        shapeEl = document.createElementNS(SVG_NS, 'polygon');
        shapeEl.setAttribute('points', `${cx},${cy - dh} ${cx + dw},${cy} ${cx},${cy + dh} ${cx - dw},${cy}`);
        shapeEl.setAttribute('fill', `url(#${gradId})`);
        shapeEl.setAttribute('fill-opacity', '0.3');
        shapeEl.setAttribute('stroke', color + '50');
        shapeEl.setAttribute('stroke-width', '1.5');
        break;
      }
      case 'circle': {
        const r = Math.min(w, h) / 2;
        shapeEl = document.createElementNS(SVG_NS, 'circle');
        shapeEl.setAttribute('cx', node.x); shapeEl.setAttribute('cy', node.y);
        shapeEl.setAttribute('r', r);
        shapeEl.setAttribute('fill', `url(#${gradId})`);
        shapeEl.setAttribute('fill-opacity', '0.3');
        shapeEl.setAttribute('stroke', color + '50');
        shapeEl.setAttribute('stroke-width', '1.5');
        break;
      }
      case 'cylinder': {
        shapeEl = document.createElementNS(SVG_NS, 'g');
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y + 7);
        rect.setAttribute('width', w); rect.setAttribute('height', h - 14);
        rect.setAttribute('rx', '6');
        rect.setAttribute('fill', `url(#${gradId})`);
        rect.setAttribute('fill-opacity', '0.3');
        rect.setAttribute('stroke', color + '50');
        rect.setAttribute('stroke-width', '1.5');
        shapeEl.appendChild(rect);
        const top = document.createElementNS(SVG_NS, 'ellipse');
        top.setAttribute('cx', node.x); top.setAttribute('cy', y + 7);
        top.setAttribute('rx', w / 2); top.setAttribute('ry', 7);
        top.setAttribute('fill', `url(#${gradId})`);
        top.setAttribute('fill-opacity', '0.25');
        top.setAttribute('stroke', color + '40');
        shapeEl.appendChild(top);
        break;
      }
      case 'stadium': {
        shapeEl = document.createElementNS(SVG_NS, 'rect');
        shapeEl.setAttribute('x', x); shapeEl.setAttribute('y', y);
        shapeEl.setAttribute('width', w); shapeEl.setAttribute('height', h);
        shapeEl.setAttribute('rx', h / 2);
        shapeEl.setAttribute('fill', `url(#${gradId})`);
        shapeEl.setAttribute('fill-opacity', '0.3');
        shapeEl.setAttribute('stroke', color + '50');
        shapeEl.setAttribute('stroke-width', '1.5');
        break;
      }
      default: {
        shapeEl = document.createElementNS(SVG_NS, 'rect');
        shapeEl.setAttribute('x', x); shapeEl.setAttribute('y', y);
        shapeEl.setAttribute('width', w); shapeEl.setAttribute('height', h);
        shapeEl.setAttribute('rx', '8');
        shapeEl.setAttribute('fill', `url(#${gradId})`);
        shapeEl.setAttribute('fill-opacity', '0.3');
        shapeEl.setAttribute('stroke', color + '50');
        shapeEl.setAttribute('stroke-width', '1.5');
        break;
      }
    }

    if (shapeEl.tagName !== 'g') {
      shapeEl.style.cursor = 'grab';
      shapeEl.style.transition = 'fill-opacity 0.2s, stroke 0.2s';
      shapeEl.addEventListener('mouseenter', () => { shapeEl.setAttribute('fill-opacity', '0.5'); shapeEl.setAttribute('stroke', color + '70'); });
      shapeEl.addEventListener('mouseleave', () => { shapeEl.setAttribute('fill-opacity', '0.3'); shapeEl.setAttribute('stroke', color + '50'); });
    }
    depthG.appendChild(shapeEl);

    const lines = _wrapTextLines(node.label || node.id, w - 20, 3);
    lines.forEach((ln, li) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', node.x); t.setAttribute('y', node.y + 4 + (li - (lines.length - 1) / 2) * 14);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', 'var(--text0)'); t.setAttribute('font-size', '11');
      t.setAttribute('font-family', 'var(--mono)');
      t.textContent = ln;
      depthG.appendChild(t);
    });

    enterG.appendChild(depthG);
    _viewport.appendChild(enterG);
  }

  function _updateNodePosition(node) {
    if (!_viewport) return;
    const g = _viewport.querySelector(`[data-node-id="${node.id}"]`);
    if (!g) return;
    const { w, h } = _nodeSize(node);
    const x = node.x - w / 2, y = node.y - h / 2;
    const shape = g.querySelector('rect, polygon, circle, g');
    if (!shape) return;
    const shapeType = node.shape;
    if (shapeType === 'circle') {
      shape.setAttribute('cx', node.x); shape.setAttribute('cy', node.y);
    } else if (shapeType === 'diamond') {
      const dw = w * 0.55, dh = h * 0.55;
      shape.setAttribute('points', `${node.x},${node.y - dh} ${node.x + dw},${node.y} ${node.x},${node.y + dh} ${node.x - dw},${node.y}`);
    } else if (shapeType === 'cylinder') {
      const rects = shape.querySelectorAll('rect, ellipse');
      if (rects[0]) { rects[0].setAttribute('x', x); rects[0].setAttribute('y', y + 7); rects[0].setAttribute('width', w); rects[0].setAttribute('height', h - 14); }
      if (rects[1]) { rects[1].setAttribute('cx', node.x); rects[1].setAttribute('cy', y + 7); rects[1].setAttribute('rx', w / 2); }
    } else {
      shape.setAttribute('x', x); shape.setAttribute('y', y);
      shape.setAttribute('width', w); shape.setAttribute('height', h);
    }
    g.querySelectorAll('text').forEach((t, li) => {
      t.setAttribute('x', node.x);
      t.setAttribute('y', node.y + 4 + (li - (linesCount(g) - 1) / 2) * 14);
    });
  }

  function linesCount(g) { return g.querySelectorAll('text').length || 1; }

  function _addNode() {
    const label = prompt('Текст нового блока:', 'Новый блок');
    if (!label) return;
    const shape = prompt('Форма (rect/stadium/diamond/circle/cylinder):', 'rect') || 'rect';
    const id = 'n' + Date.now();
    const node = { id, label, shape: ['rect','stadium','diamond','circle','cylinder'].includes(shape) ? shape : 'rect', x: 0, y: 0, w: 160, h: 50 };
    const { w, h } = _nodeSize(node);
    node.w = w; node.h = h;
    node.x = (_svg.getBoundingClientRect().width / 2 - _panX) / _zoom;
    node.y = (_svg.getBoundingClientRect().height / 2 - _panY) / _zoom;
    _nodes.push(node);
    _syncData();
    _render();
  }

  function _syncData() {
    if (!_data) _data = { nodes: [], edges: [] };
    _data.nodes = _nodes.map(n => ({ id: n.id, label: n.label, shape: n.shape }));
    _data.edges = _edges.map(e => ({ from: e.from, to: e.to, label: e.label }));
  }

  function _drawStarfield(W, H) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.dataset.depth = '0.05';
    const count = Math.floor((W * H) / 12000);
    for (let i = 0; i < count; i++) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', Math.random() * W);
      dot.setAttribute('cy', Math.random() * H);
      dot.setAttribute('r', (Math.random() * 1 + 0.3).toFixed(1));
      dot.setAttribute('fill', 'rgba(255,255,255,0.2)');
      g.appendChild(dot);
    }
    return g;
  }

  return { open, close };
})();
