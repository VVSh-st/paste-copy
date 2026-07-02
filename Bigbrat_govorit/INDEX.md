# Ответы аудиторов — Layout Engine для блок-схемы (flowchart.js)

Запрос: исправить движок блок-схемы, чтобы связи не проходили сквозь карточки, не пересекались, были без лишних изгибов.
Файл-тикет: `TICKET-flowchart-layout-core.md`

---

## a-a_star_grid_routing_2026-07-02.txt

**Аудитор:** B·3 (Аналитический архитектор)
**Подход:** Sugiyama + A* grid routing
**Суть:** 7-фазовый pipeline: breakCycles → assignLayers → minimizeCrossings → assignCoordinates → reserveLabelZones → buildObstacleGrid → routeEdges через A* по сетке.
**Плюсы:** Полный контроль маршрутизации, учёт лейблов.
**Минусы:** Сложность реализации, A* для 50 узлов — overkill.
**Решение:** Не выбрано. Слишком сложно.

---

## b-channel_routing_2026-07-02.txt

**Аудитор:** (не указан)
**Подход:** Layered Layout + Channel Routing
**Суть:** Пространство между слоями — «каналы», где могут проходить только горизонтальные сегменты связей. Порты на узлах (Top/Bottom/Left/Right). Циклы — по боковым обочинам.
**Плюсы:** Гарантия нет пересечений с узлами, лейблы в каналах.
**Минусы:** Ригидная структура, каналы могут быть пустыми.
**Решение:** Не выбрано. Идея каналов полезна, но подход过于 rigid.

---

## c-sugiyama_dummy_nodes_VYBRANO_2026-07-02.txt

**Аудитор:** Auditor 4
**Подход:** Sugiyama с dummy nodes
**Суть:** 4 фазы: cycle removal (DFS back-edges) → layer assignment (longest-path) → crossing minimization (median heuristic + dummy nodes для длинных рёбер) → coordinate assignment (Brandes-Köpf упрощённый).
**Ключевая идея:** Dummy nodes в промежуточных слоях физически резервируют трек для длинных рёбер — реальные узлы расступаются.
**Плюсы:** Математическая гарантия нет прохождения сквозь узлы, обработка циклов.
**Решение:** ВЫБРАНО. Реализовано в flowchart.js.

---

## d-sugiyama_4phase_2026-07-02.txt

**Аудитор:** (не указан)
**Подход:** Sugiyama 4-фазовый (упрощённый)
**Суть:** Layering → Ordering (crossing min) → Positioning (X/Y с размерами) → Edge routing. Аналогично Auditor 4, но с другими деталями реализации.
**Плюсы:** Чёткая структура 4 фаз.
**Минусы:** Менее детализированная реализация по сравнению с Auditor 4.
**Решение:** Не выбрано. Auditor 4 дал более полную реализацию.

---

## Итог

Выбран подход **Auditor 4 (Sugiyama с dummy nodes)**. Реализация в `flowchart.js`:
- `_breakCycles()` — DFS поиск back-edges
- `_assignLayers()` — longest-path + компактация слоёв
- `_insertDummyNodes()` — dummy nodes для длинных рёбер
- `_minimizeCrossings()` — 20 итераций median heuristic
- `_assignCoordinates()` — центрирование + интерполяция dummy
- `_renderEdges()` — прямые линии через waypoints + orthogonal для циклов
