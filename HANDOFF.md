# HANDOFF

## Objective

Проект paste\copy — веб-приложение для работы с текстовыми промптами.

Делай backup в .git после каждого задания (скриншоты такого вида не сохраняй 2026-06-21_20-35.jpg").

Мне отвечай по русски.

## Status — В РАБОТЕ

### Уголёк (ember.js): squash-stretch геометрия + доминантный эффект

**Выполнено:**
1. ✅ Реальный squash-stretch: `pose.squash` → `--scaleX`/`--scaleY` с объёмосохраняющей инверсией (`stretchK = 1 + |sq| * 0.55`), border-radius снижен до органического слоя (коэффициенты ×0.5)
2. ✅ Исправлен `igniteCrackSide`: `leftLayers [0,2]` / `rightLayers [1,3]` вместо фиксированного `[0]`, искра спавнится с привязкой к стороне (`hBias`)
3. ✅ Доминантный эффект: 7 геометрических эффектов (sigh, calmBurn, wiggle, crackle, stretch, sleepySag, gust) сортируются по `mag`, доминантный получает полную геометрию, остальные — только glow/hue/brightness
4. ✅ Пасхалка фазы 4-9 усилены: phase 4 lean −8/−26 с bodyLean, scale 1.08; phase 6 асимметричный залп (9 ash, 4 sparks, recoil); phase 6.5 новая (recoil от залпа); phase 7 collapse 0.9 squash; ring swallow через `--ringPulse` (0.82→1.08)
5. ✅ Background tab throttle: `animate()` skip при `!browserFocused && dt < 250ms`
6. ✅ Hot-reload persistence: `state.lastInitTime`, пропуск birth-анимации при перезагрузке < 3с

**Активные файлы:**
- `ember.js` (~2400 строк): squash→scaleX/scaleY, dominant geometry guard, crack-side pools, egg amplification, ringPulse, background throttle, hot-reload
- `ember-styles.css` (~490 строк): `--ringPulse`, `--ringExpand`, ring `scale()`

### Архив предыдущих сессий

**Anchor gutter background highlight bug** — `Blocks.render()` + `Anchors._renderMarkersAll()` race condition
**Переводчик** (`translator.js`) — Google→MS→legacy fallback, 9 языков
**Кнопки перевода** — в блоках, блокноте, мини-чате
**Структура превью** — навигация + подсветка фона
**Якоря** — TreeWalker+Range позиционирование

## Architecture Decisions

- `pose.squash` → инверсная компрессия scaleX/scaleY (volume preservation), border-radius = вторичный органический слой
- Доминантный эффект: только один геометрический эффект влияет на squash/scale/rotate/x/y, остальные только на glow/hue/brightness
- `igniteCrackSide`: pool по физическим углам градиентов (лево/право), не по фиксированному индексу
- `--ringPulse` CSS variable для масштабирования кольца при телепорте
- Background throttle: skip rAF кадров при неактивном окне (< 250ms между кадрами)
- Hot-reload: `state.lastInitTime` для пропуска birth-анимации при быстрых перезагрузках
