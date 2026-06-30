# MindMap: round 3 — управление, кэш, переход к слову в тексте

Файлы: `mindmap.js`, `mindmap.css`. Возможно `blocks.js`/`ui.js` (см. часть D, открытый вопрос).

Принцип захода: минимум новых элементов управления, всё максимально воздушное/прозрачное, появляется только когда нужно (курсор рядом / идёт взаимодействие), в остальное время практически не видно.

---

## ЧАСТЬ A. Ползунок зума

### A.1 Разметка
В `_ensureOverlay()`, внутри `.mindmap-panel`, рядом с `.mindmap-controls` добавить:
```html
<div class="mindmap-zoom">
  <input type="range" class="mindmap-zoom-range" min="40" max="400" value="100" step="1">
</div>
```

### A.2 CSS — вертикальный слайдер через rotate, воздушный, по проксимити
```css
.mindmap-zoom {
  position: absolute; left: 14px; top: 50%;
  transform: translateY(-50%);
  height: 150px; width: 28px;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.4s ease;
  pointer-events: none;
  z-index: 10;
}
.mindmap-zoom.near, .mindmap-zoom.dragging { opacity: 1; pointer-events: auto; }

.mindmap-zoom-range {
  width: 150px; height: 24px;
  transform: rotate(-90deg);
  -webkit-appearance: none; appearance: none;
  background: transparent;
  cursor: pointer;
}
.mindmap-zoom-range::-webkit-slider-runnable-track {
  height: 2px; border-radius: 2px;
  background: rgba(255,255,255,0.12);
}
.mindmap-zoom-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px; height: 10px; border-radius: 50%;
  background: rgba(79,142,247,0.7);
  border: 1px solid rgba(79,142,247,0.9);
  margin-top: -4px;
  transition: background 0.2s, transform 0.15s;
}
.mindmap-zoom-range::-webkit-slider-thumb:hover { background: var(--accent); transform: scale(1.2); }
/* + аналогичные -moz-range-track/-moz-range-thumb для Firefox */
```
**Важно:** `appearance` для range активно отличается между Chrome/Firefox — реализовать оба набора псевдоэлементов (`::-webkit-*` и `::-moz-*`), не полагаться на дефолтный вид.

### A.3 Логика проксимити — обобщить, не дублировать
Сейчас `near`-логика (показ `.mindmap-controls` при приближении курсора) реализована инлайн в одном `mousemove`-обработчике на `_overlay`. Чтобы не плодить копипасту под слайдер — вынести в helper:
```js
function _setupProximityReveal(el, radius) {
  _overlay.addEventListener('mousemove', e => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    el.classList.toggle('near', dist < radius);
  });
}
```
Вызвать для `.mindmap-controls` (как сейчас, radius ~150) и для `.mindmap-zoom` (radius ~120, чуть меньше — он сбоку и не должен ловить курсор с другого конца канваса).

### A.4 Синхронизация слайдера ↔ zoom state
Слайдер двигает зум от центра канваса (не от курсора — это инженерный控ль, не жест):
```js
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

// двойной клик по слайдеру — сброс к 100% (как единственный "reset" в интерфейсе, отдельная кнопка не нужна)
zoomRange.addEventListener('dblclick', () => {
  _resetTransform();
  zoomRange.value = 100;
});
```

**Обратная синхронизация:** колесо мыши (`_setupSvgListeners`, обработчик `wheel`) тоже меняет `_zoom` — после `_zoom = newZoom;` там добавить:
```js
zoomRange.value = Math.round(_zoom * 100);
```
Иначе слайдер разъедется с реальным состоянием при зуме колесом. То же самое — после `_resetTransform()` в любом месте, где он вызывается (смена режима, ресайз), синхронизировать `zoomRange.value = 100`.

---

## ЧАСТЬ B. Воздушные кнопки

В `mindmap.css`:
```css
.mindmap-btn {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  backdrop-filter: blur(6px);
  color: rgba(255,255,255,0.45);
}
.mindmap-btn:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(79,142,247,0.35);
  color: var(--accent);
}
.mindmap-btn.active {
  background: rgba(79,142,247,0.10);
  border-color: rgba(79,142,247,0.3);
  color: var(--accent);
}
```
Заменяет текущие `var(--bg2)`/`var(--border2)` — было плотно-непрозрачно, станет в стиле остального 2.5D-стекла. `.mindmap-close` наследует то же, плюс текущий hover в красный — оставить как есть.

---

## ЧАСТЬ C. Кэш результата + кнопка "Обновить"

### C.1 Не дёргать LLM повторно при каждом открытии
Сейчас `open()` безусловно вызывает `_fetch(text)`. Меняем: если `_data` уже есть — просто показываем кэш.

```js
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
  _setupSvgListeners();

  if (_data) {
    _overlay.querySelector('.mindmap-status').textContent = '';
    _render();
    return;
  }

  const text = window.Preview?.getText?.() ?? '';
  if (!text.trim()) { window.Toast?.show('Превью пустое', 'info'); return; }
  _overlay.querySelector('.mindmap-status').textContent = 'Анализирую...';
  _fetch(text);
}
```

### C.2 Кнопка "Обновить" (новый запрос)
В разметке `.mindmap-controls`, рядом с режимами (но визуально можно слегка отделить от W/G/T/C — например через небольшой margin-left, чтобы читалось как "другая группа действий"):
```html
<button class="mindmap-btn mindmap-refresh" title="Обновить анализ">↻</button>
```
Обработчик:
```js
_overlay.querySelector('.mindmap-refresh').addEventListener('click', () => {
  if (_loading) return;
  const text = window.Preview?.getText?.() ?? '';
  if (!text.trim()) { window.Toast?.show('Превью пустое', 'info'); return; }
  _overlay.querySelector('.mindmap-status').textContent = 'Анализирую...';
  _fetch(text);
});
```
Пока `_loading === true` — добавить кнопке класс `.spinning` с CSS-анимацией вращения (`animation: spin 0.8s linear infinite`), чтобы было видно, что запрос идёт, и заблокировать повторные клики (уже прикрыто проверкой `if (_loading) return`, но визуальный фидбек нужен отдельно).

**Дополнительно (защитный момент, раз уж трогаем `_loading`):** пока идёт обновление — стоит на время заблокировать `wheel`/`mousedown` на `_svg` (например через простую проверку `if (_loading) return;` в начале обработчиков в `_setupSvgListeners`), чтобы пользователь не крутил зум/пан над данными, которые вот-вот заменятся новым результатом. Мелочь, но иначе будет ощущение глюка в момент подмены `_data`.

---

## ЧАСТЬ D. Клик по слову → переход к слову в тексте

### D.1 Разводим click и dblclick (конфликт!)
В `_drawWords` уже висит `dblclick` на `text`-элементе → `_smoothZoomTo`. Если повесить туда же `click` → переход в текст, при двойном клике браузер выстрелит `click, click, dblclick` — переход в текст сработает (дважды) раньше, чем долетит дабл-клик на зум. Нужна стандартная разводка через таймер:

```js
let clickTimer = null;
text.addEventListener('click', () => {
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    clickTimer = null;
    _jumpToWord(item.w);
  }, 220);
});
text.addEventListener('dblclick', () => {
  clearTimeout(clickTimer);
  clickTimer = null;
  _smoothZoomTo(x + tw / 2, y - th / 2, 2);
});
```
220мс — стандартный порог различения click/dblclick, можно подстроить.

### D.2 `_jumpToWord` — что может сделать mindmap.js сам
```js
function _jumpToWord(word) {
  document.dispatchEvent(new CustomEvent('mindmap:jump-word', { detail: { word } }));
  close();
}
```
Дальше — **открытый архитектурный вопрос** (см. ниже), потому что mindmap.js не знает, какая вкладка активна, как устроен текстовый блок (textarea / contenteditable / кастомный блок-редактор) и как туда скроллить/выделять текст.

### ⚠️ Открытый вопрос для MIMO — куда вешать обработчик `mindmap:jump-word`
mindmap.js принципиально не лезет в DOM редактора — это вне его зоны ответственности (как и было задумано архитектурой проекта: модули не трогают чужую территорию). Нужно решить на месте, в `blocks.js` или `ui.js` (где знают про активный таб/блок), повесить:
```js
document.addEventListener('mindmap:jump-word', e => {
  const word = e.detail.word;
  // 1. найти активный блок/textarea текущей вкладки
  // 2. найти первое вхождение word с учётом границ слова (regex \bword\b, case-insensitive)
  //    — НЕ просто indexOf, иначе зацепит часть другого слова
  // 3. поставить курсор/selection на найденную позицию
  // 4. scrollIntoView / прокрутить textarea так, чтобы позиция была видна
  // 5. (опционально) на 1-2 сек добавить класс подсветки на это место, если редактор это позволяет
});
```
Если в проекте уже есть готовая функция поиска/перехода к тексту (например, использовалась где-то для поиска по сниппетам) — переиспользовать её вместо нового кода с нуля.

---

## Порядок реализации

1. **Часть C (кэш + refresh)** — самое безопасное и самое полезное по факту использования, делать первым.
2. **Часть B (airy-кнопки)** — чистый CSS, нулевой риск, можно вообще параллельно с чем угодно.
3. **Часть A (слайдер зума)** — после кэша, чтобы тестировать на реальных повторных открытиях без лишних LLM-запросов.
4. **Часть D (jump-to-word)** — последним, и только если есть ясность по архитектурному вопросу выше. Если непонятно, куда вешать обработчик — сделать D.1/D.2 (диспатч события) и оставить TODO-комментарий с описанием контракта события, не блокируя остальное.

## Что сознательно НЕ добавляем (чтобы не перегружать UI)
- Отдельную кнопку "сбросить вид" — её роль выполняет двойной клик по слайдеру зума (A.4).
- Числовой инпут рядом со слайдером (показывать %) — лишняя деталь, slider сам по себе читаем по положению.
- Подсветка/анимация в момент жонглирования между кэшем и refresh — статус-строка "Анализирую..." уже это покрывает.
