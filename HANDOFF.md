# HANDOFF — Paste/Copy Project

## Модули

### text-expander.js
- **~1550 строк**, 9 раундов аудита, **100 фиксов**. Коммит `12df6f0`.
- Основные: RU/EN trigger, space trigger без dropdown, async clipboard safety, dropdown session guard, save rollback, long press fixes, rAF race protection.
- Аудит #9: дефолт Ё→пусто, Escape щадит форму, case transform ≤120, `_doInsert` проверяет `_activeTa`, `_save()` кеш payload, `_showAddShortcutError()` хелпер.
- Статус: код стабилен, ожидает браузерного тестирования.

### ember.js
- **Патч от аудитора (Ответ 2.txt)**. Коммит `46b9d51`.
- Egg localStorage fallback: `catch` фиксирует `eggTriggeredDay` в памяти при переполнении квоты.
- Anomaly spark: +150px дальность (100→400), шире угол (0.45π→1.0π), +20% частота (0.32→0.384), longer dur (1900ms), выше trail chance.

## Следующий шаг
Протестировать в браузере:
1. `Ёabc` + пробел → expansion БЕЗ открытого dropdown
2. Ё + query + Enter → вставка через dropdown
3. Long press → панель, Escape → закрыта
4. Clipboard expansion → pending state, однократная вставка
5. Anomaly sparks → шире разлёт, +20% частота
6. Egg пасхалка → не стреляет повторно после reload при quota exceeded
