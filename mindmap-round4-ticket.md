# MindMap: round 4 — режимы "Иерархия" и "Таймлайн"

Файлы: `mindmap.js`, `mindmap.css`, **`llm-core.js`** (промпт `getPrompt('mindmap')`).

Оба режима используют уже готовую инфраструктуру из round 1-3 (viewport/zoom/pan/parallax/bloom/stagger/jump-to-word) — нового фундамента не требуется, только новые данные от LLM + две функции отрисовки.

---

## ЧАСТЬ A. Расширение данных от LLM

Сейчас один JSON-ответ уже несёт `words`, `links`, `clusters`, `claim/evidence/conclusion` — используется на все 4 режима за один запрос. Добавляем туда ещё два поля по тому же принципу (один fetch — все режимы).

### A.1 Новые поля в схеме ответа
```json
{
  "hierarchy": {
    "label": "Главная тема",
    "children": [
      {
        "label": "Подтема 1",
        "children": [
          { "label": "Деталь 1.1", "children": [] }
        ]
      }
    ]
  },
  "steps": [
    { "order": 1, "title": "Шаг 1", "desc": "Краткое описание шага" }
  ]
}
```
- `hierarchy` — ограничить глубину 3 уровнями в промпте явно (иначе LLM может выдать неконтролируемо глубокое дерево, которое физически не влезет в радиальную раскладку читаемо).
- `steps` — только для текстов с реальной последовательностью/процессом. **Важно прописать в промпте явно:** если в тексте нет ни иерархии тем, ни последовательности шагов — возвращать `"hierarchy": null` / `"steps": []`, а не выдумывать структуру из неподходящего текста. Это та же логика, что уже работает для `claim/evidence/conclusion` (там есть фоллбэк "Нет структуры аргументов в тексте" — для новых полей нужны аналогичные фоллбэки на стороне рендера, см. часть C).

### A.2 Риск по токенам — на что обратить внимание
JSON-ответ теперь несёт 6 структур вместо 4. Возможные последствия:
- Рост латентности и стоимости запроса.
- LLM может "размазать" внимание и выдать более скудные/шаблонные `hierarchy`/`steps`, особенно если `max_tokens` для этого типа запроса в `llm-core.js` выставлен под старый, более компактный JSON.

**Нужно свериться в `llm-core.js`**, где настроен запрос для `mindmap` (вероятно рядом с `getPrompt('mindmap')`) — возможно потребуется поднять `max_tokens` под этот конкретный тип запроса. Сам промпт-текст я не видел, формулировку под `hierarchy`/`steps` нужно вписать в существующую структуру инструкций по аналогии с тем, как там уже описаны `words`/`clusters`.

---

## ЧАСТЬ B. Режим "Иерархия" (радиальный мультиуровневый mindmap)

### B.1 Раскладка — рекурсивный radial tree
```js
function _drawHierarchy(W, H) {
  if (!_data.hierarchy || !_data.hierarchy.label) {
    _viewport.appendChild(_emptyMsg('Нет иерархии тем в тексте'));
    return;
  }
  const cx = W / 2, cy = H / 2;
  const palette = ['#4f8ef7', '#a070f7', '#3ec98f', '#f7a13f', '#f76d6d'];

  function layout(node, depth, angleStart, angleEnd, color) {
    const angle = (angleStart + angleEnd) / 2;
    const radius = depth === 0 ? 0 : depth * Math.min(W, H) * 0.16 + 40;
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

  function render(node) {
    if (node.children) node.children.forEach(child => {
      _drawCurvedLink(node._pos, child._pos, 1 - node._pos.depth * 0.15);
      render(child);
    });
    _drawHierarchyNode(node);
  }
  render(_data.hierarchy);
}
```

### B.2 Узел иерархии — переиспользуем стиль из графа
```js
function _drawHierarchyNode(node) {
  const { x, y, depth, color } = node._pos;
  const r = Math.max(8, 22 - depth * 6);
  const depthVal = (0.32 - depth * 0.08).toFixed(2); // глубже — дальше, для parallax/blur

  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('mm-enter');
  g.style.animationDelay = `${depth * 80}ms`;

  const depthG = document.createElementNS(SVG_NS, 'g');
  depthG.dataset.depth = depthVal;

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', x); circle.setAttribute('cy', y); circle.setAttribute('r', r);
  circle.setAttribute('fill', `url(#${_gradIdFor(color)})`);
  if (depth === 0) circle.setAttribute('filter', 'url(#bloom)');

  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', x); label.setAttribute('y', y + r + 14);
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('fill', color);
  label.textContent = node.label;

  // переиспользуем click/dblclick из round 3 (часть D) — те же хендлеры, что у слов
  _attachWordInteractions(label, node.label, x, y);

  depthG.appendChild(circle); depthG.appendChild(label);
  g.appendChild(depthG);
  _viewport.appendChild(g);
}
```

**Рефакторинг, который отсюда напрашивается:** click/dblclick-логика (jump-to-word + smooth-zoom, round 3 часть D) сейчас, скорее всего, реализована инлайн внутри `_drawWords`. Чтобы не копипастить её ещё в двух местах (иерархия, и опционально граф/таймлайн) — вынести в `_attachWordInteractions(el, word, x, y)` один раз и звать везде. Если round 3 ещё не реализован к моменту этой части — реализовать сразу в виде переиспользуемой функции, не дублировать.

### B.3 Цвет узла → готовый градиент
Если `_gradIdFor(color)` ещё не существует как хелпер (сейчас в `_buildDefs` вероятно генерируются градиенты по фиксированному списку цветов под кластеры/граф) — обобщить: одна функция, которая по hex-цвету либо возвращает уже созданный `<radialGradient>` id, либо создаёт новый на лету и кэширует в `Map`. Сейчас велик риск, что под кластеры и граф градиенты генерируются двумя похожими, но не общими кусками кода — если так, заодно свести к одному при реализации этой части (не обязательно, но раз трогаем эту зону — стоит).

---

## ЧАСТЬ C. Режим "Таймлайн" (поток шагов)

### C.1 Раскладка — горизонтальная лента, пан/зум вместо скролла
Канвас уже умеет pan/zoom — значит не нужен отдельный скролл-контейнер: просто кладём карточки в ряд шире видимой области, пользователь подвинет панорамированием.

```js
function _drawTimeline(W, H) {
  const steps = _data.steps;
  if (!steps || !steps.length) {
    _viewport.appendChild(_emptyMsg('Нет последовательности шагов в тексте'));
    return;
  }
  const cardW = 220, cardH = 110, gap = 70;
  const totalW = steps.length * (cardW + gap) - gap;
  const startX = (W - totalW) / 2 > 40 ? (W - totalW) / 2 : 40; // центрируем, если влезает
  const y = H / 2 - cardH / 2;

  steps.forEach((step, i) => {
    const x = startX + i * (cardW + gap);
    if (i > 0) {
      _drawFlowArrow(startX + (i - 1) * (cardW + gap) + cardW, y + cardH / 2, x, y + cardH / 2);
    }
    _drawStepCard(step, x, y, cardW, cardH, i);
  });
}
```

### C.2 Карточка шага — переиспользуем wrap-логику из `_drawTree`
В round 1 чинили перенос строк в `_drawTree` (баг с лишней 4-й строкой). Если эта логика всё ещё живёт инлайн внутри `_drawTree` — для таймлайна понадобится та же самая функция переноса текста. **Не копировать код переноса второй раз** (тот же риск повторно словить тот же класс бага в другом месте) — вынести в `_wrapTextLines(text, maxWidth, maxLines)`, использовать и в `_drawTree`, и в `_drawStepCard`.

```js
function _drawStepCard(step, x, y, w, h, i) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('mm-enter');
  g.style.animationDelay = `${i * 60}ms`;

  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', x); rect.setAttribute('y', y);
  rect.setAttribute('width', w); rect.setAttribute('height', h);
  rect.setAttribute('rx', 10);
  rect.setAttribute('fill', 'rgba(79,142,247,0.06)');
  rect.setAttribute('stroke', 'rgba(79,142,247,0.3)');
  g.appendChild(rect);

  const title = document.createElementNS(SVG_NS, 'text');
  title.setAttribute('x', x + 14); title.setAttribute('y', y + 24);
  title.setAttribute('fill', '#4f8ef7'); title.setAttribute('font-weight', '600');
  title.textContent = step.title;
  g.appendChild(title);

  _wrapTextLines(step.desc, w - 28).forEach((line, li) => {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', x + 14); t.setAttribute('y', y + 48 + li * 16);
    t.setAttribute('fill', 'var(--text2)'); t.setAttribute('font-size', '12');
    t.textContent = line;
    g.appendChild(t);
  });

  _viewport.appendChild(g);
}
```

### C.3 Стрелка потока
Добавить в `_buildDefs` маркер стрелки (один раз, переиспользуется всеми стрелками таймлайна):
```js
defs.innerHTML += `
  <marker id="arrow-head" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L6,3 L0,6 Z" fill="rgba(255,255,255,0.3)"/>
  </marker>
`;
```
```js
function _drawFlowArrow(x1, y1, x2, y2) {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2 - 6); line.setAttribute('y2', y2); // -6 чтобы стрелка не утыкалась в карточку
  line.setAttribute('stroke', 'rgba(255,255,255,0.25)');
  line.setAttribute('marker-end', 'url(#arrow-head)');
  _viewport.appendChild(line);
}
```

---

## ЧАСТЬ D. Подключение режимов в общий UI

### D.1 Кнопки режимов
В разметке `.mindmap-controls` (там же где сейчас W/G/T/C) добавить:
```html
<button class="mindmap-btn" data-mode="hierarchy" title="Иерархия тем">M</button>
<button class="mindmap-btn" data-mode="timeline" title="Поток шагов">→</button>
```
Буквы/иконки подобрать так, чтобы не путались визуально с уже занятыми (Words/Graph/Tree/Clusters) — например M (mindmap-иерархия) и → (поток) читаются однозначно.

### D.2 `_render()` — добавить кейсы
```js
switch (_mode) {
  case 'words': _drawWords(W, H); break;
  case 'graph': _drawGraph(W, H); break;
  case 'tree': _drawTree(W, H); break;
  case 'clusters': _drawClusters(W, H); break;
  case 'hierarchy': _drawHierarchy(W, H); break;
  case 'timeline': _drawTimeline(W, H); break;
}
```

### D.3 Сброс вида при смене режима
Уже есть логика сброса zoom/pan при переключении mode (round 1/3) — убедиться, что она срабатывает и для двух новых режимов (она общая для всех `data-mode` кнопок, так что должна подхватиться автоматически, если не захардкожен список режимов где-то ещё).

---

## Порядок реализации

1. **Часть A** — сначала промпт/данные. Без них рендер-функции нечего показывать, тестировать вслепую бессмысленно.
2. **Часть B (Иерархия)** — сложнее (рекурсия, углы), делать первой из двух, чтобы рефакторинг `_attachWordInteractions`/`_gradIdFor` (если понадобится) был сделан до Таймлайна и тот мог сразу им пользоваться.
3. **Часть C (Таймлайн)** — проще, в основном переиспользование (`_wrapTextLines`, карточки в стиле `_drawTree`).
4. **Часть D** — подключение, в последнюю очередь, когда обе функции отрисовки уже самостоятельно проверены.

## Открытые вопросы
- Глубина `hierarchy` — ограничение в 3 уровня (A.1) можно скорректировать по факту, если на реальных текстах LLM упрямо лезет глубже или, наоборот, не наполняет даже 2 уровня.
- `max_tokens` для mindmap-запроса в `llm-core.js` (A.2) — нужно свериться с текущим значением, я его не видел.
- Если `_attachWordInteractions` и `_gradIdFor` уже были вынесены отдельно при реализации round 3 — часть B просто на них ссылается, ничего пересоздавать не надо.
