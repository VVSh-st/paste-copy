# MindMap: багфиксы + visual upgrade (neon/glassmorphism 2.5D)

Файлы: `mindmap.js`, `mindmap.css`

---

## 1. Багфиксы (сделать первыми, до визуала)

### 1.1 `_drawTree` — перенос строк вылезает за карточку
Строки ~312-327. Сейчас проверка лимита строк идёт **после** push текста:
```js
if (test.length * 7 > maxLineW && line) {
  // push текста ...
  line = w + ' '; lineNum++;
  if (lineNum > 2) return;   // <- проверка СЛИШКОМ ПОЗДНО
}
```
Из-за этого при overflow на 3-й строке push уже произошёл, и следующий overflow (4-й) тоже успевает запушить текст ДО проверки — карточка может получить 4 строки текста при высоте, рассчитанной под 3.

**Фикс:** проверять лимит до push, не после:
```js
words.forEach(w => {
  if (lineNum > 2) return; // стоп сразу, не накапливаем дальше
  const test = line + w + ' ';
  if (test.length * 7 > maxLineW && line) {
    // push текущей line
    line = w + ' '; lineNum++;
  } else { line = test; }
});
```

### 1.2 Задвоенный атрибут
Строка ~300 и ~302: `rect.setAttribute('stroke-width', '1')` вызван дважды подряд. Убрать дубль.

### 1.3 `nodeMap` коллизия по ключу
`_drawGraph`, строка ~195: `nodeMap[n.w] = i` — если два слова в `data.words` совпадают текстуально (LLM так может отдать), один узел затирает другой в мапе, и `links` могут указать не туда.

**Фикс:** строить ключ по индексу, а не по тексту слова — добавить `id` в data на этапе генерации, либо временно ключевать по `i` если порядок слов в `links.from/to` гарантированно совпадает с индексами (нужно свериться с промптом `llm-core.js: getPrompt('mindmap')` — если там LLM возвращает `from`/`to` как сами слова, то нужен дедуп слов перед построением nodeMap, либо склейка дублей в данные на этапе парсинга).

### 1.4 Нет реакции на resize окна
`_render()` читает `W/H` через `getBoundingClientRect()` один раз за вызов. Сейчас неактуально (статичный рендер), но после добавления zoom/pan (см. ниже) ресайз должен сбрасывать/пересчитывать viewport. Добавить `ResizeObserver` на `.mindmap-canvas`, на срабатывание — `_render()` заново (с сохранением текущего pan/zoom, см. п.3).

### 1.5 Мёртвый код
`_panel` объявлена как module-level, используется только разово в `_ensureOverlay`. Если нигде больше не нужна — убрать из верхнего scope, оставить локальной переменной внутри `_ensureOverlay`.

---

## 2. Архитектурное изменение: viewport-группа

Сейчас все `_draw*` функции аппендят элементы прямо в `_svg`. Для zoom/pan/parallax всё содержимое должно жить в одной `<g>`, к которой применяется единый transform.

В `_render()`:
```js
_svg.innerHTML = '';
// ... defs ...
_viewport = document.createElementNS(SVG_NS, 'g');
_viewport.setAttribute('class', 'mm-viewport');
_svg.appendChild(_viewport);
_resetTransform(); // zoom=1, pan=0,0 — см. ниже, решить: сбрасывать при смене mode или нет
```
Все `_draw*` функции должны аппендить в `_viewport`, а не в `_svg` напрямую (кроме `<defs>`).

**Вопрос для решения по ходу реализации:** сбрасывать zoom/pan при переключении режима (words/graph/tree/clusters) или сохранять? Рекомендация — сбрасывать, иначе человек зумит в "облако слов", переключается на "граф" и видит пустоту, потому что zoom 3x смотрит не туда.

---

## 3. Zoom колесом (к курсору)

State: `let _zoom = 1, _panX = 0, _panY = 0;`

```js
_svg.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = _svg.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const newZoom = Math.min(4, Math.max(0.4, _zoom * factor));
  // удержать точку под курсором на месте
  _panX = mx - (mx - _panX) * (newZoom / _zoom);
  _panY = my - (my - _panY) * (newZoom / _zoom);
  _zoom = newZoom;
  _applyTransform();
}, { passive: false });

function _applyTransform() {
  _viewport.setAttribute('transform', `translate(${_panX},${_panY}) scale(${_zoom})`);
}
```

---

## 4. Pan мышью (drag)

```js
let dragging = false, lastX = 0, lastY = 0, movedEnough = false;

_svg.addEventListener('mousedown', e => {
  dragging = true; movedEnough = false;
  lastX = e.clientX; lastY = e.clientY;
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  if (Math.abs(dx) + Math.abs(dy) > 3) movedEnough = true;
  if (movedEnough) {
    _panX += dx; _panY += dy;
    lastX = e.clientX; lastY = e.clientY;
    _applyTransform();
  }
});
window.addEventListener('mouseup', () => { dragging = false; });
```

**Важно:** порог `movedEnough` (3px) нужен, чтобы клик по узлу (hover/click-эффекты у circle/text уже есть) не ломался случайным микро-drag. Курсор на `.mindmap-canvas` лучше переключать на `grab`/`grabbing` через CSS (`:active`).

---

## 5. Cursor parallax (ощущение глубины)

Идея: элементы на разном "весе/важности" двигаются с разным коэффициентом от смещения курсора относительно центра канваса — тяжёлые/близкие чуть сильнее, фоновые/лёгкие — слабее.

Группировать при рендере по глубине, например в `_drawGraph`/`_drawClusters`:
- `depth = 0.3` для крупных/тяжёлых узлов (передний план)
- `depth = 0.12` для линков/фоновых элементов (задний план)

```js
_svg.addEventListener('mousemove', e => {
  if (dragging) return; // не мешать pan
  const rect = _svg.getBoundingClientRect();
  const nx = (e.clientX - rect.left - rect.width / 2) / rect.width;   // -0.5..0.5
  const ny = (e.clientY - rect.top - rect.height / 2) / rect.height;
  requestAnimationFrame(() => _applyParallax(nx, ny));
});

function _applyParallax(nx, ny) {
  _viewport.querySelectorAll('[data-depth]').forEach(el => {
    const depth = parseFloat(el.dataset.depth);
    const px = nx * depth * 40; // амплитуда в px, подобрать
    const py = ny * depth * 40;
    el.style.transform = `translate(${px}px, ${py}px)`;
  });
}
```
Каждой группе/элементу при создании проставлять `el.dataset.depth = '0.3'` и т.п.

**⚠️ Важно (из истории проекта — был баг с infinite RAF loop в blocks.js):** не стекать `requestAnimationFrame` без контроля. Использовать throttle через флаг `let rafPending = false`, не вызывать новый rAF, пока предыдущий не отработал.

---

## 6. Neon/glassmorphism — рендер-часть

### 6.1 Bloom-фильтр (вместо текущего простого `#glow`)
Текущий `#glow` — один `feGaussianBlur` + merge. Для настоящего bloom-эффекта нужен более яркий "core + halo":
```html
<filter id="bloom" x="-60%" y="-60%" width="220%" height="220%">
  <feGaussianBlur stdDeviation="6" result="blur1"/>
  <feGaussianBlur in="blur1" stdDeviation="12" result="blur2"/>
  <feMerge>
    <feMergeNode in="blur2"/>
    <feMergeNode in="blur1"/>
    <feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>
```
Применять на high-weight узлы/слова (`item.weight > 7`, уже есть условие — просто сменить `url(#glow)` → `url(#bloom)`).

### 6.2 Радиальные градиенты вместо плоской заливки
Для circle в `_drawGraph` и ellipse в `_drawClusters` — вместо `fill="color"` использовать `radialGradient` per-цвет (генерировать в `<defs>` один раз на палитру):
```html
<radialGradient id="grad-4f8ef7" cx="35%" cy="30%" r="70%">
  <stop offset="0%" stop-color="#fff" stop-opacity="0.9"/>
  <stop offset="35%" stop-color="#4f8ef7" stop-opacity="1"/>
  <stop offset="100%" stop-color="#4f8ef7" stop-opacity="0.15"/>
</radialGradient>
```
Даёт "светящийся шар" вместо плоского кружка — основа всего neon-стиля.

### 6.3 Hover — bloom pulse
Сейчас на hover просто меняется `r`/`opacity`. Добавить CSS-анимацию пульсации через class toggle (`.mm-pulse`) вместо инлайн стилей — проще анимировать keyframes в CSS, чем дёргать атрибуты вручную.

---

## 7. Glassmorphism — CSS-часть (`mindmap.css`)

```css
.mindmap-panel {
  background: linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01));
  backdrop-filter: blur(20px) saturate(140%);
  border: 1px solid rgba(255,255,255,0.08);
  box-shadow:
    0 8px 40px rgba(0,0,0,0.5),
    0 0 60px rgba(79,142,247,0.08) inset;
  transition: transform 0.15s ease-out;
  transform-style: preserve-3d;
}

.mindmap-canvas { cursor: grab; }
.mindmap-canvas:active { cursor: grabbing; }
```

---

## 8. Tilt-эффект панели (лёгкий псевдо-3D)

```js
_panel.addEventListener('mousemove', e => {
  const r = _panel.getBoundingClientRect();
  const nx = (e.clientX - r.left) / r.width - 0.5;
  const ny = (e.clientY - r.top) / r.height - 0.5;
  const rotY = nx * 4;   // макс ±4deg, не переборщить
  const rotX = -ny * 4;
  _panel.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
});
_panel.addEventListener('mouseleave', () => {
  _panel.style.transform = '';
});
```
Амплитуду (4deg) можно потом подкрутить — больше 6-7 уже будет ощущаться как баг, а не фича.

---

## 9. Порядок реализации (этапы, чтобы можно было катить по частям)

1. Багфиксы (раздел 1) — независимо от всего остального.
2. Viewport-группа (раздел 2) — фундамент, без неё zoom/pan невозможны.
3. Zoom + Pan (разделы 3-4) — после этого MindMap уже ощутимо современнее.
4. Resize handling (1.4) — добавить сразу после viewport-группы, иначе будет баг при ресайзе с активным zoom.
5. Parallax (раздел 5) — после того как zoom/pan стабильны и не конфликтуют по mousemove.
6. Neon-рендер + glass CSS (разделы 6-7) — чисто визуальный слой, можно катить отдельным PR/коммитом.
7. Tilt (раздел 8) — последний штрих, опционально можно вообще выключаемым флагом сделать, если будет ощущаться лишним.

---

## 10. Открытые вопросы для решения по ходу

- Сбрасывать zoom/pan при смене mode (words/graph/tree/clusters) — рекомендация: да, сбрасывать.
- `nodeMap` по тексту слова (1.3) — нужно свериться с промптом mindmap в `llm-core.js`, отдаёт ли LLM `id` для слов или только текст.
- Амплитуды parallax/tilt — числа в коде ориентировочные, подбираются на глаз после первого прогона.
