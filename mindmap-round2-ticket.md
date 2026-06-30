# MindMap: round 2 — багфиксы + добивка 2.5D

Файл: `mindmap.js` (текущая версия — уже с viewport-группой, zoom/pan/parallax/tilt/bloom из round 1, дальше правим поверх неё).

---

## ЧАСТЬ A. Багфиксы (по скриншотам)

### A.1 "Чёрная дыра" в центре кластеров (`_drawClusters`)
Причина: радиальный градиент в `_buildDefs` центрирован на `cx=35% cy=30%`, а геометрический центр эллипса попадает в зону низкой непрозрачности (offset 100%, opacity 0.15). Сквозь эту прозрачность просвечивает `feDropShadow` от `filter="shadow"`, который висит на той же ellipse — получается тёмное пятно вместо светящегося ядра.

**Фикс:** убрать `filter="shadow"` с ellipse в `_drawClusters` (строка ~534, `ellipse.setAttribute('filter', 'url(#shadow)')`). Свечение и так даёт градиент + общий bloom на title. Если тень всё-таки нужна для отрыва от фона — повесить её не на саму ellipse, а на отдельный продублированный `<ellipse>` того же размера, залитый сплошным `rgba(0,0,0,0.3)`, размещённый ПЕРЕД основной (в DOM раньше) и без участия в градиенте — тогда тень не будет видна сквозь прозрачные зоны основного градиента.

### A.2 Кластеры наезжают друг на друга (`_drawClusters`)
Строка ~515: `const dist = Math.min(W, H) * 0.28;` — фиксированное расстояние от центра, не учитывает реальный радиус каждого эллипса (`r = 50 + cl.words.length * 12`, может быть очень разным).

**Фикс:** считать `dist` не константой, а с запасом под максимальный радиус среди кластеров:
```js
const maxR = Math.max(...clusters.map(cl => 50 + cl.words.length * 12));
const dist = Math.max(Math.min(W, H) * 0.28, maxR * 1.3);
```
Этого может быть недостаточно при сильно разных размерах кластеров (3 маленьких + 1 гигантский) — если после этого фикса всё ещё будут наезды на реальных данных, следующий шаг — простая попарная проверка пересечений после расстановки и раздвижка по нормали (как мини force-layout, но без итераций по 60 раз — кластеров мало, 2-3 прохода хватит).

### A.3 Панель слишком прозрачна, контент теряется (`mindmap.css`)
`.mindmap-panel` background `rgba(255,255,255,0.04 / 0.01)` — на тёмном фоне с малым количеством контента на канвасе (например текст-заглушка в tree-режиме) панель выглядит почти невидимой, текст еле читается.

**Фикс в `mindmap.css`:**
```css
.mindmap-panel {
  background: linear-gradient(135deg, rgba(20,22,30,0.55), rgba(15,16,22,0.45));
  backdrop-filter: blur(20px) saturate(140%);
  ...
}
```
Подобрать конкретные альфа-значения на глаз (ориентир 0.4-0.6) — главное, чтобы под панелью угадывался блюр фона, но текст и фигуры на канвасе не терялись.

---

## ЧАСТЬ B. Фичи (добивка 2.5D)

### B.1 Инерция при pan
Сейчас pan останавливается мгновенно на `mouseup`. Добавить "доезд" с затуханием.

State: `let _velX = 0, _velY = 0, _inertiaRaf = null;`

В обработчике `mousemove` (там, где сейчас `_panX += dx`) — параллельно трекать скорость:
```js
_velX = dx; _velY = dy; // скорость = последнее смещение за кадр
```
На `mouseup`:
```js
window.addEventListener('mouseup', () => {
  _dragging = false;
  if (Math.abs(_velX) + Math.abs(_velY) > 0.5) _startInertia();
});

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
```
**Важно:** новый `mousedown` должен звать `cancelAnimationFrame(_inertiaRaf)`, иначе инерция продолжит дёргать viewport поверх нового drag.

### B.2 Smooth zoom-to-node (даблклик)
По даблклику на узле/слове — плавно центрировать и приблизить камеру к нему.

Подход: добавить CSS-transition на `_viewport`, но **только на время программного перехода** (не во время ручного pan/zoom, иначе drag будет лагать через transition):
```js
function _smoothZoomTo(targetX, targetY, targetZoom) {
  _viewport.style.transition = 'transform 0.4s cubic-bezier(.2,.8,.2,1)';
  const rect = _svg.getBoundingClientRect();
  _zoom = targetZoom;
  _panX = rect.width / 2 - targetX * targetZoom;
  _panY = rect.height / 2 - targetY * targetZoom;
  _applyTransform();
  setTimeout(() => { _viewport.style.transition = ''; }, 400);
}
```
Вешать `dblclick` на каждый `circle`/`text` в `_drawGraph`/`_drawWords`, передавая их `n.x, n.y` и например `targetZoom = 2`.

### B.3 Atmospheric blur по глубине
Сейчас `data-depth` двигает элементы через parallax, но визуально передний/задний план неотличимы кроме смещения.

В `_applyParallax` (или один раз при создании элемента) добавить блюр и лёгкое притемнение для дальнего плана:
```js
el.querySelectorAll('[data-depth]').forEach(el => {
  const depth = parseFloat(el.dataset.depth);
  // depth ~0.12 (дальний план) → больше блюра/тусклее
  // depth ~0.3 (передний план) → чётко, без блюра
  const blurAmt = (0.3 - depth) * 6; // подобрать коэффициент на глаз
  el.style.filter = blurAmt > 0.3 ? `blur(${blurAmt.toFixed(1)}px)` : '';
});
```
Применять один раз при рендере (не пересчитывать каждый mousemove — это статичное свойство элемента, не зависит от курсора). Естественно завести в один проход с присвоением `data-depth`, не отдельным циклом по всем элементам на каждый кадр.

**Осторожно:** `filter: blur()` на множестве SVG-элементов может просесть по производительности при большом графе — если узлов много (30+), ограничить блюр только на самый дальний слой (`linksG`, depth 0.12), не трогать остальное.

### B.4 Stagger-анимация появления
Сейчас все элементы возникают разом при рендере. Добавить fade+scale-in с небольшой задержкой по индексу.

Проще всего через CSS class + `animation-delay`:
```css
.mm-enter {
  animation: mm-enter-kf 0.35s cubic-bezier(.2,.8,.2,1) backwards;
}
@keyframes mm-enter-kf {
  from { opacity: 0; transform: scale(0.6); }
  to   { opacity: 1; transform: scale(1); }
}
```
При создании каждого узла/слова/кластера в `_draw*`-функциях:
```js
g.classList.add('mm-enter');
g.style.animationDelay = `${i * 25}ms`; // i — индекс в текущем forEach
```
**Конфликт, на который обратить внимание:** у элементов уже используется `el.style.transform` для parallax (B.3 пункт использует `filter`, ок, но B.1/parallax двигает через `style.transform`) — CSS `animation` тоже анимирует `transform`. Если повесить `animation` и одновременно JS постоянно перезаписывает `style.transform` через parallax, они будут конфликтовать (JS затрёт анимацию или наоборот). Решение: stagger-анимацию вешать на ОБЁРТКУ (родительский `<g>`), а parallax-transform — на отдельный вложенный `<g>` внутри неё. Сейчас структура и так через `g.dataset.depth` на группах — нужно убедиться, что анимация и parallax-transform не садятся на один и тот же DOM-узел.

### B.5 Изогнутые линии в графе
Сейчас `_drawGraph` рисует прямые `<line>`. Заменить на квадратичные Безье через `<path>`:
```js
const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15; // лёгкий изгиб перпендикулярно линии
const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
const path = document.createElementNS(SVG_NS, 'path');
path.setAttribute('d', `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`);
path.setAttribute('fill', 'none');
path.setAttribute('stroke', 'rgba(255,255,255,0.12)');
path.setAttribute('stroke-width', String(0.5 + l.strength * 2.5));
```
Коэффициент `0.15` — сила изгиба, подбирается на глаз (больше = заметнее дуга).

### B.6 Дрейфующий звёздный фон
Лёгкий слой частиц на фоне канваса для ощущения глубины в пустых зонах. Рисуется один раз при `_render()`, **до** основного контента (первым ребёнком `_viewport`, либо в отдельном `<g>` с минимальным depth для слабого parallax):
```js
function _drawStarfield(W, H) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.dataset.depth = '0.05'; // почти не двигается — самый дальний слой
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
```
Звать в `_render()` сразу после создания `_viewport`, до `switch (_mode)`. Если захочется именно "дрейф" (медленное самостоятельное движение, не только parallax от курсора) — добавить CSS `animation: mm-drift 60s linear infinite` с keyframes на небольшой `translate`, зацикленный.

---

## Порядок реализации

1. **A.1, A.2, A.3** — багфиксы, независимы друг от друга, делать в любом порядке, первыми.
2. **B.6 (starfield)** — самое простое и безопасное, не трогает существующую логику, можно сразу.
3. **B.5 (изогнутые линии)** — локальная замена в `_drawGraph`, не влияет на остальное.
4. **B.3 (atmospheric blur)** — расширяет существующий depth-механизм, делать после A.2 (чтобы не путать с фиксом кластеров).
5. **B.4 (stagger-анимация)** — здесь важно сначала прояснить структуру вложенности групп (см. предупреждение про конфликт с parallax-transform), потенциально мелкий рефакторинг структуры `<g>` перед тем как вешать анимацию.
6. **B.1 (инерция pan)** и **B.2 (smooth zoom-to-node)** — последние, самые чувствительные к существующему state machine (`_dragging`, `_zoom`, `_panX/Y`) — трогать их желательно когда всё остальное уже стабильно, чтобы не путать причины багов.

## Открытые вопросы по ходу реализации

- B.4: нужно решить структуру `<g>` вложенности (parallax-group vs anim-group) до того, как вешать stagger — иначе придётся переделывать.
- B.3: коэффициент блюра и порог "что считать дальним планом" — на глаз, после первого прогона на реальных данных скорее всего придётся подкрутить.
- A.2: если простого увеличения `dist` от `maxR` не хватит на реальных данных с сильным разбросом размеров кластеров — следующий шаг collision-раздвижки, см. описание в A.2.
