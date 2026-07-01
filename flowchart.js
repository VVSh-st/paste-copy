const Flowchart = (() => {
  const VCW = 2000, VCH = 1400;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PALETTE = ['#4f8ef7', '#5cb87a', '#f0a050', '#e05c6a', '#a78bfa', '#f472b6', '#22d3ee', '#fbbf24'];

  let _overlay = null, _panel = null, _svg = null, _viewport = null;
  let _mode = 'flow', _data = null, _loading = false;
  let _zoom = 1, _panX = 0, _panY = 0;
  let _dragging = false, _lastX = 0, _lastY = 0, _movedEnough = false;
  let _velX = 0, _velY = 0, _inertiaRaf = null;
  let _rafPending = false, _parallaxNX = 0, _parallaxNY = 0;
  let _dragNode = null, _dragOffX = 0, _dragOffY = 0;
  let _nodes = [], _edges = [], _edgesG = null;
  let _connectMode = false, _connectFrom = null;
  let _currentTooltip = null;
  let _canvases = [], _activeCanvasId = null;
  let _saveTimer = null;
  let _resizing = false, _startW, _startH, _startMX, _startMY;
  let _skipRestore = false;

  function _resetTransform() { _zoom = 1; _panX = 0; _panY = 0; if (_viewport) _viewport.setAttribute('transform', 'translate(0,0) scale(1)'); }
  function _applyTransform() { if (_viewport) _viewport.setAttribute('transform', `translate(${_panX},${_panY}) scale(${_zoom})`); }
  function _gradIdFor(c) { return 'fcg-' + c.replace('#', ''); }
  function _syncZoomSlider() { const r = _overlay?.querySelector('.flowchart-zoom-range'); if (r) r.value = Math.round(_zoom * 100); }

  function _ensureGradient(color) {
    if (_svg?.querySelector(`#${_gradIdFor(color)}`)) return;
    const defs = _svg?.querySelector('defs');
    if (!defs) return;
    const grad = document.createElementNS(SVG_NS, 'radialGradient');
    grad.setAttribute('id', _gradIdFor(color));
    grad.setAttribute('cx', '35%'); grad.setAttribute('cy', '30%'); grad.setAttribute('r', '70%');
    grad.innerHTML = `<stop offset="0%" stop-color="#fff" stop-opacity="0.8"/><stop offset="35%" stop-color="${color}" stop-opacity="0.9"/><stop offset="100%" stop-color="${color}" stop-opacity="0.15"/>`;
    defs.appendChild(grad);
  }

  function _wrapTextLines(text, maxW, maxL) {
    const words = (text || '').split(' '); const lines = []; let line = '';
    words.forEach(w => { if (lines.length >= maxL) return; const test = line + w + ' '; if (test.length * 7 > maxW && line) { lines.push(line.trim()); line = w + ' '; } else line = test; });
    if (line.trim() && lines.length < maxL) lines.push(line.trim());
    return lines;
  }

  function _emptyMsg(msg) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', VCW / 2); t.setAttribute('y', VCH / 2);
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle');
    t.setAttribute('fill', 'var(--text2)'); t.setAttribute('font-size', '14'); t.setAttribute('font-family', 'var(--mono)');
    t.textContent = msg; return t;
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

  function _shapeAnchor(node, dirX, dirY) {
    const { w, h } = node;
    switch (node.shape) {
      case 'circle': { const r = Math.min(w, h) / 2; return { x: node.x + dirX * r, y: node.y + dirY * r }; }
      case 'diamond': { const dw = w * 0.55, dh = h * 0.55; const t = 1 / (Math.abs(dirX) / dw + Math.abs(dirY) / dh); return { x: node.x + dirX * t, y: node.y + dirY * t }; }
      default: { const hw = w / 2, hh = h / 2; const t = Math.min(hw / Math.abs(dirX || 1e-6), hh / Math.abs(dirY || 1e-6)); return { x: node.x + dirX * t, y: node.y + dirY * t }; }
    }
  }

  function _startInertia() {
    cancelAnimationFrame(_inertiaRaf);
    function tick() { _velX *= 0.92; _velY *= 0.92; _panX += _velX; _panY += _velY; _applyTransform(); if (Math.abs(_velX) + Math.abs(_velY) > 0.3) _inertiaRaf = requestAnimationFrame(tick); }
    _inertiaRaf = requestAnimationFrame(tick);
  }

  function _applyParallax(nx, ny) {
    if (!_viewport) return;
    _viewport.querySelectorAll('[data-depth]').forEach(el => {
      const depth = parseFloat(el.dataset.depth);
      el.style.transform = `translate(${nx * depth * 30}px, ${ny * depth * 30}px)`;
    });
  }

  /* ── Tooltip ────────────────────────────────────────────────────────── */

  function _closeTooltip() { if (_currentTooltip) { _currentTooltip.remove(); _currentTooltip = null; } }

  function _showTooltip({ x, y, fields, onSubmit, title }) {
    _closeTooltip();
    const box = document.createElement('div');
    box.className = 'fc-tooltip';
    box.style.left = x + 'px'; box.style.top = y + 'px';
    box.innerHTML = `
      ${title ? `<div class="fc-tooltip-title">${title}</div>` : ''}
      ${fields.map(f => f.type === 'select'
        ? `<select data-field="${f.name}">${f.options.map(o => `<option value="${o}" ${o === f.value ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : `<input data-field="${f.name}" type="text" value="${f.value || ''}" placeholder="${f.placeholder || ''}">`
      ).join('')}
      <div class="fc-tooltip-actions">
        <button class="fc-tooltip-ok">✓</button>
        <button class="fc-tooltip-cancel">✕</button>
      </div>`;
    _overlay.appendChild(box);
    const firstInput = box.querySelector('input, select');
    firstInput?.focus(); firstInput?.select?.();
    const submit = () => { const values = {}; fields.forEach(f => values[f.name] = box.querySelector(`[data-field="${f.name}"]`).value); onSubmit(values); box.remove(); _currentTooltip = null; };
    box.querySelector('.fc-tooltip-ok').addEventListener('click', submit);
    box.querySelector('.fc-tooltip-cancel').addEventListener('click', () => { box.remove(); _currentTooltip = null; });
    box.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { box.remove(); _currentTooltip = null; } });
    _currentTooltip = box;
  }

  function _canvasCoords(e) {
    const rect = _svg.getBoundingClientRect();
    return { x: (e.clientX - rect.left - _panX) / _zoom, y: (e.clientY - rect.top - _panY) / _zoom };
  }

  /* ── Layout ─────────────────────────────────────────────────────────── */

  function _autoLayout() {
    const nodeMap = {}; _nodes.forEach(n => nodeMap[n.id] = n);
    const adj = {}; _nodes.forEach(n => adj[n.id] = []);
    _edges.forEach(e => { if (adj[e.from]) adj[e.from].push(e.to); });
    const inDeg = {}; _nodes.forEach(n => inDeg[n.id] = 0);
    _edges.forEach(e => { if (inDeg[e.to] !== undefined) inDeg[e.to]++; });

    const levels = []; const visited = new Set();
    let queue = _nodes.filter(n => inDeg[n.id] === 0 && n.x == null).map(n => n.id);
    if (!queue.length && _nodes.some(n => n.x == null)) queue = [_nodes.find(n => n.x == null)?.id].filter(Boolean);

    while (queue.length) {
      levels.push([...queue]); queue.forEach(id => visited.add(id));
      const next = [];
      queue.forEach(id => { (adj[id] || []).forEach(to => { if (!visited.has(to) && !next.includes(to) && _edges.filter(e => e.to === to).every(e => visited.has(e.from))) next.push(to); }); });
      queue = next;
    }
    _nodes.filter(n => !visited.has(n.id) && n.x == null).forEach(n => { levels.push([n.id]); visited.add(n.id); });

    const maxRowsPerCol = 5, colW = 400, levelGap = 130;
    const startY = 100;

    levels.forEach((level, li) => {
      const col = Math.floor(li / maxRowsPerCol);
      const rowInCol = li % maxRowsPerCol;
      const baseX = 100 + col * colW;
      level.forEach((id, ni) => {
        const node = nodeMap[id];
        if (node && node.x == null) {
          node.x = baseX + ni * 240;
          node.y = startY + rowInCol * levelGap;
        }
      });
    });
  }

  function _forceLayout() {
    _nodes.forEach(n => { if (n.x == null) { n.x = VCW / 2 + (Math.random() - 0.5) * 400; n.y = VCH / 2 + (Math.random() - 0.5) * 300; } });
    for (let iter = 0; iter < 60; iter++) {
      _nodes.forEach(a => {
        let fx = 0, fy = 0;
        _nodes.forEach(b => { if (a === b) return; const dx = a.x - b.x, dy = a.y - b.y; const dist = Math.max(20, Math.hypot(dx, dy)); const repel = 2200 / (dist * dist); fx += (dx / dist) * repel; fy += (dy / dist) * repel; });
        _edges.forEach(e => { if (e.from !== a.id && e.to !== a.id) return; const other = _nodes.find(n => n.id === (e.from === a.id ? e.to : e.from)); if (!other) return; const dx = other.x - a.x, dy = other.y - a.y; const dist = Math.max(20, Math.hypot(dx, dy)); const attract = (dist - 150) * 0.02; fx += (dx / dist) * attract; fy += (dy / dist) * attract; });
        a._vx = (a._vx || 0) * 0.8 + fx; a._vy = (a._vy || 0) * 0.8 + fy;
      });
      _nodes.forEach(a => { a.x = Math.min(VCW - 60, Math.max(60, a.x + a._vx)); a.y = Math.min(VCH - 60, Math.max(60, a.y + a._vy)); });
    }
  }

  /* ── Canvas persistence ─────────────────────────────────────────────── */

  function _loadCanvases() {
    try { _canvases = JSON.parse(localStorage.getItem('fc_canvases') || '[]'); } catch { _canvases = []; }
    _activeCanvasId = localStorage.getItem('fc_active') || null;
    if (!_canvases.length) { _canvases = [{ id: 'c1', name: '1', data: { nodes: [], edges: [] }, updatedAt: Date.now() }]; _activeCanvasId = 'c1'; _saveCanvases(); }
    if (!_activeCanvasId || !_canvases.find(c => c.id === _activeCanvasId)) _activeCanvasId = _canvases[0].id;
  }

  function _saveCanvases() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      localStorage.setItem('fc_canvases', JSON.stringify(_canvases));
      localStorage.setItem('fc_active', _activeCanvasId);
    }, 600);
  }

  function _syncData() {
    if (!_data) _data = { nodes: [], edges: [] };
    _data.nodes = _nodes.map(n => ({ id: n.id, label: n.label, shape: n.shape, x: n.x, y: n.y }));
    _data.edges = _edges.map(e => ({ from: e.from, to: e.to, label: e.label }));
    const cv = _canvases.find(c => c.id === _activeCanvasId);
    if (cv) { cv.data = JSON.parse(JSON.stringify(_data)); cv.updatedAt = Date.now(); _saveCanvases(); }
  }

  function _switchCanvas(id) {
    const cv = _canvases.find(c => c.id === id);
    if (!cv) return;
    _activeCanvasId = id;
    _data = JSON.parse(JSON.stringify(cv.data));
    _render();
    _renderCanvasPills();
    _saveCanvases();
  }

  function _renderCanvasPills() {
    const wrap = _overlay?.querySelector('.flowchart-canvases');
    if (!wrap) return;
    wrap.innerHTML = '';
    _canvases.forEach(cv => {
      const btn = document.createElement('button');
      btn.className = 'fc-canvas-pill' + (cv.id === _activeCanvasId ? ' active' : '');
      btn.textContent = cv.name; btn.dataset.id = cv.id;
      btn.addEventListener('click', () => _switchCanvas(cv.id));
      btn.addEventListener('dblclick', e => {
        e.stopPropagation();
        const rect = btn.getBoundingClientRect();
        const panelRect = _panel.getBoundingClientRect();
        _showTooltip({
          x: rect.left - panelRect.left, y: rect.bottom - panelRect.top + 4,
          title: 'Полотно', fields: [{ name: 'name', value: cv.name, placeholder: 'Название' }],
          onSubmit: v => { cv.name = v.name || cv.name; _renderCanvasPills(); _saveCanvases(); }
        });
      });
      wrap.appendChild(btn);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'fc-canvas-pill fc-canvas-add'; addBtn.textContent = '+'; addBtn.title = 'Новое полотно';
    addBtn.addEventListener('click', () => {
      const id = 'c' + Date.now();
      _canvases.push({ id, name: String(_canvases.length + 1), data: { nodes: [], edges: [] }, updatedAt: Date.now() });
      _switchCanvas(id);
    });
    wrap.appendChild(addBtn);
  }

  /* ── Edges ──────────────────────────────────────────────────────────── */

  function _renderEdges() {
    if (!_edgesG) return;
    _edgesG.innerHTML = '';
    const nodeMap = {}; _nodes.forEach(n => nodeMap[n.id] = n);
    _edges.forEach(e => { const a = nodeMap[e.from], b = nodeMap[e.to]; if (a && b) _drawEdge(a, b, e); });
  }

  function _drawEdge(a, b, edge) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const p1 = _shapeAnchor(a, ux, uy);
    const p2 = _shapeAnchor(b, -ux, -uy);
    const nx = -uy, ny = ux;

    if (_mode === 'graph') {
      const path = document.createElementNS(SVG_NS, 'path');
      const cdy = Math.abs(p2.y - p1.y) * 0.2 || 20;
      path.setAttribute('d', `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + cdy}, ${p2.x} ${p2.y - cdy}, ${p2.x} ${p2.y}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(255,255,255,0.18)');
      path.setAttribute('stroke-width', '1.5');
      path.style.cursor = 'pointer';
      path.dataset.edgeFrom = a.id; path.dataset.edgeTo = b.id;
      path.addEventListener('mouseenter', () => path.setAttribute('stroke', 'rgba(255,255,255,0.4)'));
      path.addEventListener('mouseleave', () => path.setAttribute('stroke', 'rgba(255,255,255,0.18)'));
      path.addEventListener('click', e => { e.stopPropagation(); _openEdgeTooltip(e, a.id, b.id, edge.label || ''); });
      path.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); _deleteEdge(a.id, b.id); });
      _edgesG.appendChild(path);
    } else {
      const wStart = 3, wEnd = 0.5;
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', [
        `${p1.x + nx * wStart},${p1.y + ny * wStart}`,
        `${p2.x + nx * wEnd},${p2.y + ny * wEnd}`,
        `${p2.x - nx * wEnd},${p2.y - ny * wEnd}`,
        `${p1.x - nx * wStart},${p1.y - ny * wStart}`,
      ].join(' '));
      poly.setAttribute('fill', 'rgba(255,255,255,0.22)');
      poly.style.cursor = 'pointer';
      poly.dataset.edgeFrom = a.id; poly.dataset.edgeTo = b.id;
      poly.addEventListener('mouseenter', () => poly.setAttribute('fill', 'rgba(255,255,255,0.4)'));
      poly.addEventListener('mouseleave', () => poly.setAttribute('fill', 'rgba(255,255,255,0.22)'));
      poly.addEventListener('click', e => { e.stopPropagation(); _openEdgeTooltip(e, a.id, b.id, edge.label || ''); });
      poly.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); _deleteEdge(a.id, b.id); });
      _edgesG.appendChild(poly);
    }

    if (edge.label) {
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', mx + 8); t.setAttribute('y', my);
      t.setAttribute('fill', 'var(--text2)'); t.setAttribute('font-size', '10'); t.setAttribute('font-family', 'var(--mono)');
      t.textContent = edge.label; _edgesG.appendChild(t);
    }
  }

  function _openEdgeTooltip(e, fromId, toId, label) {
    const rect = _overlay.getBoundingClientRect();
    _showTooltip({
      x: e.clientX - rect.left + 10, y: e.clientY - rect.top - 30,
      title: 'Ребро', fields: [{ name: 'label', value: label, placeholder: 'Лейбл (опционально)' }],
      onSubmit: v => { const edge = _edges.find(e => e.from === fromId && e.to === toId); if (edge) edge.label = v.label; _syncData(); _renderEdges(); }
    });
  }

  function _deleteEdge(fromId, toId) {
    _edges = _edges.filter(e => !(e.from === fromId && e.to === toId));
    _syncData(); _renderEdges();
  }

  /* ── Nodes ──────────────────────────────────────────────────────────── */

  function _drawNode(node, i) {
    const color = PALETTE[i % PALETTE.length];
    _ensureGradient(color);
    const { w, h } = _nodeSize(node);
    const x = node.x - w / 2, y = node.y - h / 2;

    const enterG = document.createElementNS(SVG_NS, 'g');
    enterG.classList.add('fc-enter');
    enterG.style.animationDelay = `${i * 30}ms`;
    const depthG = document.createElementNS(SVG_NS, 'g');
    depthG.dataset.depth = '0.2';
    depthG.dataset.nodeId = node.id;

    function makeBacking(shapeEl) {
      const b = shapeEl.cloneNode(true);
      b.removeAttribute('fill'); b.setAttribute('fill', 'rgba(10,11,16,0.92)');
      b.removeAttribute('stroke'); b.removeAttribute('stroke-width');
      b.removeAttribute('fill-opacity'); b.removeAttribute('filter');
      return b;
    }

    let shapeEl;
    switch (node.shape) {
      case 'diamond': {
        const cx = node.x, cy = node.y, dw = w * 0.55, dh = h * 0.55;
        const pts = `${cx},${cy - dh} ${cx + dw},${cy} ${cx},${cy + dh} ${cx - dw},${cy}`;
        depthG.appendChild(makeBacking(Object.assign(document.createElementNS(SVG_NS, 'polygon'), { outerHTML: '' })));
        depthG.lastChild.setAttribute('points', pts);
        shapeEl = document.createElementNS(SVG_NS, 'polygon');
        shapeEl.setAttribute('points', pts);
        shapeEl.setAttribute('fill', `url(#${_gradIdFor(color)})`);
        shapeEl.setAttribute('fill-opacity', '0.5');
        shapeEl.setAttribute('stroke', color + '60');
        shapeEl.setAttribute('stroke-width', '1.5');
        break;
      }
      case 'circle': {
        const r = Math.min(w, h) / 2;
        const back = document.createElementNS(SVG_NS, 'circle');
        back.setAttribute('cx', node.x); back.setAttribute('cy', node.y); back.setAttribute('r', r);
        back.setAttribute('fill', 'rgba(10,11,16,0.95)');
        depthG.appendChild(back);
        shapeEl = document.createElementNS(SVG_NS, 'circle');
        shapeEl.setAttribute('cx', node.x); shapeEl.setAttribute('cy', node.y); shapeEl.setAttribute('r', r);
        shapeEl.setAttribute('fill', `url(#${_gradIdFor(color)})`);
        shapeEl.setAttribute('fill-opacity', '0.5');
        shapeEl.setAttribute('stroke', color + '60');
        shapeEl.setAttribute('stroke-width', '1.5');
        break;
      }
      case 'cylinder': {
        const backG = document.createElementNS(SVG_NS, 'g');
        const br = document.createElementNS(SVG_NS, 'rect');
        br.setAttribute('x', x); br.setAttribute('y', y + 7); br.setAttribute('width', w); br.setAttribute('height', h - 14);
        br.setAttribute('rx', '6'); br.setAttribute('fill', 'rgba(10,11,16,0.92)');
        backG.appendChild(br);
        depthG.appendChild(backG);
        shapeEl = document.createElementNS(SVG_NS, 'g');
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y + 7); rect.setAttribute('width', w); rect.setAttribute('height', h - 14);
        rect.setAttribute('rx', '6'); rect.setAttribute('fill', `url(#${_gradIdFor(color)})`);
        rect.setAttribute('fill-opacity', '0.32'); rect.setAttribute('stroke', color + '60'); rect.setAttribute('stroke-width', '1.5');
        shapeEl.appendChild(rect);
        const top = document.createElementNS(SVG_NS, 'ellipse');
        top.setAttribute('cx', node.x); top.setAttribute('cy', y + 7); top.setAttribute('rx', w / 2); top.setAttribute('ry', 7);
        top.setAttribute('fill', `url(#${_gradIdFor(color)})`); top.setAttribute('fill-opacity', '0.25'); top.setAttribute('stroke', color + '40');
        shapeEl.appendChild(top);
        break;
      }
      case 'stadium': {
        const back = document.createElementNS(SVG_NS, 'rect');
        back.setAttribute('x', x); back.setAttribute('y', y); back.setAttribute('width', w); back.setAttribute('height', h);
        back.setAttribute('rx', h / 2); back.setAttribute('fill', 'rgba(10,11,16,0.95)');
        depthG.appendChild(back);
        shapeEl = document.createElementNS(SVG_NS, 'rect');
        shapeEl.setAttribute('x', x); shapeEl.setAttribute('y', y); shapeEl.setAttribute('width', w); shapeEl.setAttribute('height', h);
        shapeEl.setAttribute('rx', h / 2); shapeEl.setAttribute('fill', `url(#${_gradIdFor(color)})`);
        shapeEl.setAttribute('fill-opacity', '0.32'); shapeEl.setAttribute('stroke', color + '60'); shapeEl.setAttribute('stroke-width', '1.5');
        break;
      }
      default: {
        const back = document.createElementNS(SVG_NS, 'rect');
        back.setAttribute('x', x); back.setAttribute('y', y); back.setAttribute('width', w); back.setAttribute('height', h);
        back.setAttribute('rx', '8'); back.setAttribute('fill', 'rgba(10,11,16,0.95)');
        depthG.appendChild(back);
        shapeEl = document.createElementNS(SVG_NS, 'rect');
        shapeEl.setAttribute('x', x); shapeEl.setAttribute('y', y); shapeEl.setAttribute('width', w); shapeEl.setAttribute('height', h);
        shapeEl.setAttribute('rx', '8'); shapeEl.setAttribute('fill', `url(#${_gradIdFor(color)})`);
        shapeEl.setAttribute('fill-opacity', '0.32'); shapeEl.setAttribute('stroke', color + '60'); shapeEl.setAttribute('stroke-width', '1.5');
        break;
      }
    }
    depthG.appendChild(shapeEl);

    const lines = _wrapTextLines(node.label || node.id, w - 20, 3);
    lines.forEach((ln, li) => {
      const t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', node.x); t.setAttribute('y', node.y + 4 + (li - (lines.length - 1) / 2) * 14);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('fill', 'var(--text0)');
      t.setAttribute('font-size', '11'); t.setAttribute('font-family', 'var(--mono)');
      t.setAttribute('paint-order', 'stroke'); t.setAttribute('stroke', 'rgba(0,0,0,0.55)');
      t.setAttribute('stroke-width', '3'); t.setAttribute('stroke-linejoin', 'round');
      t.textContent = ln; depthG.appendChild(t);
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
    g.querySelectorAll('rect').forEach(r => {
      if (r.getAttribute('rx') === String(h / 2) || r.getAttribute('rx') === '8' || r.getAttribute('rx') === '6') {
        r.setAttribute('x', x); r.setAttribute('y', r.getAttribute('y') && parseInt(r.getAttribute('y')) === parseInt(String(y + 7)) ? y + 7 : y);
        r.setAttribute('width', w); if (r.getAttribute('height') !== String(h - 14)) r.setAttribute('height', h);
      }
    });
    g.querySelectorAll('circle').forEach(c => { c.setAttribute('cx', node.x); c.setAttribute('cy', node.y); });
    g.querySelectorAll('polygon').forEach(p => {
      const dw = w * 0.55, dh = h * 0.55;
      p.setAttribute('points', `${node.x},${node.y - dh} ${node.x + dw},${node.y} ${node.x},${node.y + dh} ${node.x - dw},${node.y}`);
    });
    g.querySelectorAll('ellipse').forEach(e => { e.setAttribute('cx', node.x); e.setAttribute('cy', y + 7); e.setAttribute('rx', w / 2); });
    g.querySelectorAll('text').forEach((t, i, all) => {
      t.setAttribute('x', node.x);
      t.setAttribute('y', node.y + 4 + (i - (all.length - 1) / 2) * 14);
    });
  }

  /* ── Overlay ────────────────────────────────────────────────────────── */

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
          <button class="flowchart-btn flowchart-export" title="Дублировать полотно">⇪</button>
          <button class="flowchart-btn flowchart-close" title="Закрыть">✕</button>
        </div>
        <div class="flowchart-canvases"></div>
        <div class="flowchart-zoom">
          <input type="range" class="flowchart-zoom-range" min="40" max="400" value="100" step="1">
        </div>
        <div class="flowchart-status"></div>
        <div class="flowchart-canvas"></div>
        <div class="flowchart-resize-handle"></div>
      </div>`;
    document.body.appendChild(_overlay);

    _panel = _overlay.querySelector('.flowchart-panel');
    const canvas = _overlay.querySelector('.flowchart-canvas');
    const savedW = localStorage.getItem('fc_panelW'), savedH = localStorage.getItem('fc_panelH');
    if (savedW) _panel.style.width = savedW;
    if (savedH) _panel.style.height = savedH;

    _svg = document.createElementNS(SVG_NS, 'svg');
    _svg.setAttribute('width', '100%'); _svg.setAttribute('height', '100%');
    _svg.setAttribute('viewBox', `0 0 ${VCW} ${VCH}`);
    _svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    _svg.style.display = 'block';
    canvas.appendChild(_svg);

    _overlay.addEventListener('click', e => { if (e.target === _overlay) close(); });
    _overlay.addEventListener('contextmenu', e => { if (e.target === _overlay) { e.preventDefault(); close(); } });
    _overlay.querySelector('.flowchart-close').addEventListener('click', close);

    _overlay.querySelectorAll('.flowchart-btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        _mode = btn.dataset.mode;
        _overlay.querySelectorAll('.flowchart-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
        _nodes.forEach(n => { n._vx = 0; n._vy = 0; });
        _skipRestore = true; _render();
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

    _overlay.querySelector('.flowchart-add').addEventListener('click', e => {
      const rect = e.target.getBoundingClientRect();
      const panelRect = _panel.getBoundingClientRect();
      _showTooltip({
        x: rect.left - panelRect.left, y: rect.bottom - panelRect.top + 4,
        title: 'Новый блок',
        fields: [
          { name: 'label', placeholder: 'Текст блока' },
          { name: 'shape', type: 'select', value: 'rect', options: ['rect', 'stadium', 'diamond', 'circle', 'cylinder'] }
        ],
        onSubmit: v => {
          if (!v.label) return;
          const id = 'n' + Date.now();
          const node = { id, label: v.label, shape: v.shape, x: VCW / 2 - _panX / _zoom, y: VCH / 2 - _panY / _zoom };
          const sz = _nodeSize(node); node.w = sz.w; node.h = sz.h;
          _nodes.push(node); _syncData(); _render();
        }
      });
    });

    _overlay.querySelector('.flowchart-connect').addEventListener('click', () => {
      _connectMode = !_connectMode; _connectFrom = null;
      _overlay.querySelector('.flowchart-connect').classList.toggle('active', _connectMode);
      if (_connectMode) window.Toast?.show('Кликните на исходный блок', 'info');
    });

    _overlay.querySelector('.flowchart-export').addEventListener('click', () => {
      const id = 'c' + Date.now();
      const sourceName = _canvases.find(c => c.id === _activeCanvasId)?.name || '1';
      _canvases.push({ id, name: sourceName + ' (копия)', data: JSON.parse(JSON.stringify(_data)), updatedAt: Date.now() });
      _switchCanvas(id);
      window.Toast?.show('Скопировано в новое полотно', 'info');
    });

    function _setupProximity(el, r) {
      _overlay.addEventListener('mousemove', e => { const rc = el.getBoundingClientRect(); el.classList.toggle('near', Math.hypot(e.clientX - (rc.left + rc.width / 2), e.clientY - (rc.top + rc.height / 2)) < r); });
    }
    _setupProximity(_overlay.querySelector('.flowchart-controls'), 150);
    _setupProximity(_overlay.querySelector('.flowchart-canvases'), 150);
    _setupProximity(_overlay.querySelector('.flowchart-zoom'), 120);

    const zoomRange = _overlay.querySelector('.flowchart-zoom-range');
    const zoomWrap = _overlay.querySelector('.flowchart-zoom');
    zoomRange.addEventListener('input', () => {
      const newZoom = zoomRange.value / 100;
      const rect = _svg.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      _panX = cx - (cx - _panX) * (newZoom / _zoom);
      _panY = cy - (cy - _panY) * (newZoom / _zoom);
      _zoom = newZoom; _applyTransform(); _saveViewport();
    });
    zoomRange.addEventListener('mousedown', () => zoomWrap.classList.add('dragging'));
    window.addEventListener('mouseup', () => zoomWrap.classList.remove('dragging'));
    zoomRange.addEventListener('dblclick', () => { _resetTransform(); zoomRange.value = 100; _saveViewport(); });

    document.addEventListener('keydown', e => { if (e.key === 'Escape' && _overlay?.classList.contains('visible')) { _closeTooltip(); close(); } });

    window.addEventListener('mousemove', e => {
      if (_resizing) {
        const newW = Math.max(480, Math.min(window.innerWidth * 0.95, _startW + (e.clientX - _startMX)));
        const newH = Math.max(360, Math.min(window.innerHeight * 0.92, _startH + (e.clientY - _startMY)));
        _panel.style.width = newW + 'px'; _panel.style.height = newH + 'px';
        return;
      }
      if (!_dragging) return;
      const dx = e.clientX - _lastX, dy = e.clientY - _lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) _movedEnough = true;
      if (_movedEnough) { _velX = dx; _velY = dy; _panX += dx; _panY += dy; _lastX = e.clientX; _lastY = e.clientY; _applyTransform(); }
    });
    window.addEventListener('mouseup', () => {
      if (_resizing) { _resizing = false; localStorage.setItem('fc_panelW', _panel.style.width); localStorage.setItem('fc_panelH', _panel.style.height); return; }
      if (_dragNode) { _dragNode = null; _syncData(); return; }
      _dragging = false;
      if (_movedEnough && (Math.abs(_velX) + Math.abs(_velY) > 0.5)) _startInertia();
      _saveViewport();
    });

    const resizeHandle = _overlay.querySelector('.flowchart-resize-handle');
    resizeHandle.addEventListener('mousedown', e => { _resizing = true; _startW = _panel.offsetWidth; _startH = _panel.offsetHeight; _startMX = e.clientX; _startMY = e.clientY; e.preventDefault(); e.stopPropagation(); });

    _svg.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = _svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = Math.min(4, Math.max(0.4, _zoom * factor));
      _panX = mx - (mx - _panX) * (newZoom / _zoom);
      _panY = my - (my - _panY) * (newZoom / _zoom);
      _zoom = newZoom; _applyTransform(); _syncZoomSlider(); _saveViewport();
    }, { passive: false });

    _svg.addEventListener('mousedown', e => {
      if (_loading) return;
      const nodeEl = e.target.closest('[data-node-id]');
      if (nodeEl) {
        const nodeId = nodeEl.dataset.nodeId;
        if (_connectMode) {
          if (!_connectFrom) { _connectFrom = nodeId; window.Toast?.show('Теперь кликните на целевой блок', 'info'); }
          else if (_connectFrom !== nodeId) { _edges.push({ from: _connectFrom, to: nodeId, label: '' }); _connectFrom = null; _connectMode = false; _overlay.querySelector('.flowchart-connect').classList.remove('active'); _syncData(); _renderEdges(); }
          return;
        }
        e.stopPropagation(); cancelAnimationFrame(_inertiaRaf); _dragging = false;
        _dragNode = nodeId;
        const node = _nodes.find(n => n.id === _dragNode);
        if (node) { const mc = _canvasCoords(e); _dragOffX = mc.x - node.x; _dragOffY = mc.y - node.y; }
        return;
      }
      if (e.button !== 0) return;
      cancelAnimationFrame(_inertiaRaf); _dragging = true; _movedEnough = false; _lastX = e.clientX; _lastY = e.clientY;
    });

    _svg.addEventListener('mousemove', e => {
      if (!_dragNode) return;
      const node = _nodes.find(n => n.id === _dragNode);
      if (!node) return;
      const mc = _canvasCoords(e);
      node.x = mc.x - _dragOffX; node.y = mc.y - _dragOffY;
      _updateNodePosition(node); _renderEdges();
    });

    _svg.addEventListener('dblclick', e => {
      const nodeEl = e.target.closest('[data-node-id]');
      if (!nodeEl) return;
      const node = _nodes.find(n => n.id === nodeEl.dataset.nodeId);
      if (!node) return;
      const panelRect = _panel.getBoundingClientRect();
      _showTooltip({
        x: e.clientX - panelRect.left + 10, y: e.clientY - panelRect.top - 30,
        title: 'Редактировать', fields: [{ name: 'label', value: node.label || '', placeholder: 'Текст блока' }],
        onSubmit: v => { if (v.label) { node.label = v.label; _syncData(); _render(); } }
      });
    });

    _svg.addEventListener('contextmenu', e => {
      const nodeEl = e.target.closest('[data-node-id]');
      if (!nodeEl) return;
      e.preventDefault();
      const node = _nodes.find(n => n.id === nodeEl.dataset.nodeId);
      if (!node) return;
      const panelRect = _panel.getBoundingClientRect();
      _showTooltip({
        x: e.clientX - panelRect.left, y: e.clientY - panelRect.top,
        title: `Удалить «${node.label}»?`,
        fields: [],
        onSubmit: () => { _nodes = _nodes.filter(n => n.id !== node.id); _edges = _edges.filter(e => e.from !== node.id && e.to !== node.id); _syncData(); _render(); }
      });
    });

    _svg.addEventListener('mousemove', e => {
      if (_dragging || _dragNode) return;
      const rect = _svg.getBoundingClientRect();
      _parallaxNX = (e.clientX - rect.left - rect.width / 2) / rect.width;
      _parallaxNY = (e.clientY - rect.top - rect.height / 2) / rect.height;
      if (!_rafPending) { _rafPending = true; requestAnimationFrame(() => { _rafPending = false; _applyParallax(_parallaxNX, _parallaxNY); }); }
    });
  }

  function _toMermaid() {
    const lines = ['flowchart TD'];
    _nodes.forEach(n => {
      const sw = { diamond: ['{', '}'], circle: ['((', '))'], stadium: ['([', '])'], cylinder: ['[(', ')]'], rect: ['[', ']'] }[n.shape] || ['[', ']'];
      lines.push(`  ${n.id}${sw[0]}"${n.label}"${sw[1]}`);
    });
    _edges.forEach(e => { lines.push(`  ${e.from} -->${e.label ? `|${e.label}|` : ''} ${e.to}`); });
    return lines.join('\n');
  }

  function open() {
    _ensureOverlay();
    if (_loading) return;
    _loadCanvases();
    _overlay.classList.add('visible');
    _overlay.querySelectorAll('.flowchart-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === _mode));
    const cv = _canvases.find(c => c.id === _activeCanvasId);
    _data = cv ? JSON.parse(JSON.stringify(cv.data)) : { nodes: [], edges: [] };
    _renderCanvasPills();

    const isEmpty = !_data.nodes || !_data.nodes.length;
    if (isEmpty) {
      const text = window.Preview?.getText?.() ?? '';
      if (text.trim()) {
        _overlay.querySelector('.flowchart-status').textContent = 'Анализирую...';
        _overlay.querySelector('.flowchart-refresh').classList.add('spinning');
        _fetch(text);
        return;
      }
    }
    _render();
  }

  function close() { if (_overlay) _overlay.classList.remove('visible'); _closeTooltip(); }

  async function _fetch(text) {
    _loading = true;
    try {
      const result = await window.LLMCore?.request?.({
        messages: [{ role: 'user', content: window.LLMCore.getPrompt('flowchart') + '\n\n' + text.slice(0, 4000) }],
        stream: false, maxTokens: 2500, featureTag: 'flowchart',
      });
      if (!result?.trim()) { window.Toast?.show('Нет результата', 'info'); _overlay.querySelector('.flowchart-status').textContent = ''; _loading = false; _overlay?.querySelector('.flowchart-refresh')?.classList.remove('spinning'); return; }
      let json;
      try { json = JSON.parse(result.trim()); } catch { const m = result.match(/\{[\s\S]*\}/); if (m) json = JSON.parse(m[0]); else { window.Toast?.show('Не удалось распарсить JSON', 'error'); _overlay.querySelector('.flowchart-status').textContent = ''; _loading = false; _overlay?.querySelector('.flowchart-refresh')?.classList.remove('spinning'); return; } }
      if (!json || !Array.isArray(json.nodes) || !json.nodes.length) { window.Toast?.show('LLM вернул пустую схему', 'info'); _overlay.querySelector('.flowchart-status').textContent = ''; _loading = false; _overlay?.querySelector('.flowchart-refresh')?.classList.remove('spinning'); return; }
      _data = json;
      _overlay.querySelector('.flowchart-status').textContent = '';
      _render();
      _syncData();
    } catch (e) { if (e.name !== 'AbortError') window.Toast?.show(e.message, 'error'); _overlay.querySelector('.flowchart-status').textContent = ''; }
    finally { _loading = false; _overlay?.querySelector('.flowchart-refresh')?.classList.remove('spinning'); }
  }

  function _buildDefs() {
    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
      <filter id="fc-shadow"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.25"/></filter>
      <marker id="fc-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,1 L7,4 L0,7 Z" fill="rgba(255,255,255,0.35)"/></marker>
    `;
    const seen = new Set();
    PALETTE.forEach(c => {
      if (seen.has(c)) return; seen.add(c);
      const grad = document.createElementNS(SVG_NS, 'radialGradient');
      grad.setAttribute('id', _gradIdFor(c)); grad.setAttribute('cx', '35%'); grad.setAttribute('cy', '30%'); grad.setAttribute('r', '70%');
      grad.innerHTML = `<stop offset="0%" stop-color="#fff" stop-opacity="0.8"/><stop offset="35%" stop-color="${c}" stop-opacity="0.9"/><stop offset="100%" stop-color="${c}" stop-opacity="0.15"/>`;
      defs.appendChild(grad);
    });
    return defs;
  }

  function _fitToContent() {
    if (!_nodes.length) { _zoom = 1; _panX = 0; _panY = 0; _applyTransform(); return; }
    const pad = 80;
    const minX = Math.min(..._nodes.map(n => n.x - n.w / 2));
    const maxX = Math.max(..._nodes.map(n => n.x + n.w / 2));
    const minY = Math.min(..._nodes.map(n => n.y - n.h / 2));
    const maxY = Math.max(..._nodes.map(n => n.y + n.h / 2));
    const contentW = Math.max(1, maxX - minX), contentH = Math.max(1, maxY - minY);
    const targetW = VCW - pad * 2, targetH = VCH - pad * 2;
    const zoom = Math.min(2, Math.max(0.4, Math.min(targetW / contentW, targetH / contentH)));
    const scaledW = contentW * zoom, scaledH = contentH * zoom;
    _zoom = zoom;
    _panX = pad + (targetW - scaledW) / 2 - minX * zoom;
    _panY = pad + (targetH - scaledH) / 2 - minY * zoom;
    _applyTransform(); _syncZoomSlider();
  }

  let _viewportSaveTimer = null;
  function _saveViewport() {
    const cv = _canvases.find(c => c.id === _activeCanvasId);
    if (!cv) return;
    clearTimeout(_viewportSaveTimer);
    _viewportSaveTimer = setTimeout(() => {
      cv.viewport = { zoom: _zoom, panX: _panX, panY: _panY };
      _saveCanvases();
    }, 500);
  }

  function _restoreOrFitViewport() {
    if (_skipRestore) { _skipRestore = false; _fitToContent(); _saveViewport(); return; }
    const cv = _canvases.find(c => c.id === _activeCanvasId);
    if (cv?.viewport) {
      _zoom = cv.viewport.zoom; _panX = cv.viewport.panX; _panY = cv.viewport.panY;
      _applyTransform(); _syncZoomSlider();
    } else {
      _fitToContent();
      _saveViewport();
    }
  }

  function _render() {
    if (!_data || !_svg) return;
    _svg.innerHTML = '';
    _svg.setAttribute('viewBox', `0 0 ${VCW} ${VCH}`);
    _svg.appendChild(_buildDefs());

    _viewport = document.createElementNS(SVG_NS, 'g');
    _viewport.setAttribute('class', 'fc-viewport');
    _svg.appendChild(_viewport);

    const starG = document.createElementNS(SVG_NS, 'g');
    starG.dataset.depth = '0.05';
    const count = Math.floor((VCW * VCH) / 15000);
    for (let i = 0; i < count; i++) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', Math.random() * VCW); dot.setAttribute('cy', Math.random() * VCH);
      dot.setAttribute('r', (Math.random() + 0.3).toFixed(1)); dot.setAttribute('fill', 'rgba(255,255,255,0.2)');
      starG.appendChild(dot);
    }
    _viewport.appendChild(starG);

    _nodes = (_data.nodes || []).map(n => {
      const existing = _nodes.find(en => en.id === n.id);
      const sz = _nodeSize(n);
      return { ...n, w: sz.w, h: sz.h, x: n.x != null ? n.x : (existing?.x ?? null), y: n.y != null ? n.y : (existing?.y ?? null) };
    });
    _edges = (_data.edges || []).map(e => ({ ...e }));

    if (!_nodes.length) { _viewport.appendChild(_emptyMsg('Нет данных для блок-схемы')); _applyTransform(); return; }

    if (_mode === 'flow') _autoLayout(); else _forceLayout();

    _edgesG = document.createElementNS(SVG_NS, 'g');
    _edgesG.setAttribute('class', 'fc-edges');
    _viewport.appendChild(_edgesG);
    _renderEdges();

    _nodes.forEach((node, i) => _drawNode(node, i));
    _restoreOrFitViewport();
  }

  return { open, close };
})();
