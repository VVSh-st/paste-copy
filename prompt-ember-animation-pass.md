# Ticket: Make secondary animations visually distinct and particles alive

## Goal

Сделать второстепенные анимации ember визуально различимыми друг от друга. Сейчас很多 эффекты выглядят похожими: одинаковый синусoidal motion, похожие timing curves. Сфокусироваться на:

1. Дать каждому.secondary effect свою "физическую подпись" (движение, timing, character)
2. Сделать частицы (sparks, ash, haze) живыми — каждая有自己的 поведение, а не одинаковые копии

## Constraints

- Vanilla JS, IIFE module.
- Не трогать: rAF loop, peek state machine, easter egg,反应系统, reduced motion, defer().
- Не переписывать particle pool.
- Изменения локальные, в existing code style.
- CSS keyframes можно расширять, но не удалять существующие.

---

# Scope

## 1. Give each core effect a distinct motion signature

### Problem

Сейчас `sigh`, `calmBurn`, `wiggle`, `tilt`, `stretch`, `sleepySag`, `smolder` все используют `bump()` или `Math.sin()` с похожими параметрами. На глаз они сливаются.

### Task

Сделать каждый secondary effect визуально узнаваемым по motion:

| Effect | Текущий характер | Целевой характер |
|--------|-----------------|-------------------|
| sigh | smooth inhale/exhale | **Утяжелённый** — медленный вдох, быстрый выдох с лёгким "сбрасыванием" |
| calmBurn | мягкий pulse | **Тлеющий** — неравномерный, с micro-glitch'ами |
| wiggle | синусoidal shake | **Нервный** — короткие рывки, не плавный sinus |
| tilt | медленный наклон | **Ленивый** — как под действием тяжести, asymmetrical |
| stretch | вертикальное удлинение | **Упругий** — с micro-rebound в конце |
| sleepySag | вертикальный sag | **Тяжёлый** — как тает, с micro-drift вниз |
| smolder | hue/glow pulse | **Тлеющий** — неравномерный, с редкими вспышками |
| gust | горизонтальный push | **Порывистый** — резкий старт, инерционный stop |

### Implementation

Не менять общую структуру `apply*Pose()`. Внутри каждого:

- Заменить типичный `bump(p, riseEnd, holdEnd)` на более характерную кривую
- Добавить asymmetry: вдох ≠ выдох, старт ≠ стоп
- Добавить micro-detail: tiny jitter, stagger, inertia

### Example: wiggle → nervous jitter

```js
// Было (smooth sinus):
const shake = Math.sin(p * Math.PI * 8) * decay;

// Стало (nervous staccato):
const burstPhase = p < 0.15 ? easeOutQuad(p / 0.15) : 0;
const jitterPhase = p >= 0.15 && p < 0.5;
const settlePhase = p >= 0.5;
const jitter = jitterPhase ? Math.sin(p * Math.PI * 14) * Math.exp(-(p - 0.15) * 5) : 0;
const settle = settlePhase ? easeOutQuad((p - 0.5) / 0.5) * Math.sin((p - 0.5) * 8) * 0.3 : 0;
const shake = burstPhase * 3 + jitter * 2 + settle;
```

### Example: sigh → heavy sigh

```js
// Было:
const inhale = p < 0.35 ? easeOutQuad(p / 0.35) : 0;
const exhale = p > 0.45 ? easeOutQuad((p - 0.45) / 0.55) : 0;

// Стало: быстрый вдох, долгий тяжёлый выдох с micro-settle
const inhale = p < 0.25 ? easeOutQuad(p / 0.25) * 1.1 : 0;
const exhale = p > 0.3 ? Math.pow((p - 0.3) / 0.7, 0.6) : 0;  // медленный затухающий
const settle = p > 0.7 ? Math.sin((p - 0.7) * 12) * (1 - p) * 0.15 : 0;
```

---

## 2. Particles: make each type feel physically distinct

### Problem

Сейчас `spawnAshParticle`, `spawnSpark`, `spawnShootingSpark`, `spawnCrumb` создают похожие объекты с разными размерами. Движение частиц (rise, drift, sway) слишком похоже друг на друга.

### Task

Сделать каждую категорию частиц физически уникальной:

### Sparks — горячие, быстрые, с инерцией

- **Движение:** резкий старт вверх, гравитация тянет вниз, horizontal drift с wind influence
- **Визуал:** яркий центр + motion trail (box-shadow смещённый), разные формы: point, elongated, broken
- **Время жизни:** короткое (400-900ms)
- **Поведение:** при windGust смещаются в сторону ветра, при high intensity — больше shooting sparks

Патч для `spawnSpark`:
```js
function spawnSpark(hBias) {
  // ... existing pool acquire ...
  particles.push({
    el, born: performance.now(),
    dur: rand(350, 800),       // короче
    rise: rand(-35, -20),      // быстрый старт
    drift: rand(-10, 10) + windGust * 15,  // wind influence
    sway: rand(0.5, 2),        // минимум sway
    isSpark: true,
    type: sparkType,
    gravity: 0.04,             // гравитация
    trail: true,               // motion trail
    windInfluence: 0.8,        // подвержен ветру
  });
}
```

### Ash — лёгкие, медленные, floaty

- **Движение:** медленный подъём с strong sway, как пепел в восходящем потоке
- **Визуал:** тусклый, semi-transparent, мелкие
- **Время жизни:** длинное (2600-5200ms)
- **Поведение:** swirl pattern, rarely straight up, affected by heat zones

Патч для `spawnAshParticle`:
```js
particles.push({
  el, born: performance.now(),
  dur: rand(3000, 5500),       // дольше
  rise: rand(-15, -8),         // медленный подъём
  drift: rand(-8, 8),          // сильный drift
  sway: rand(4, 10),           // сильный swirl
  isSpark: false,
  scalePulse: true,
  swirlFactor: rand(0.3, 0.8), // закручивание
  heatLift: true,               // подъём от heat zones
});
```

### Crumbs — тяжёлые, падающие, с пружинкой

- **Движение:** начальный импульс вверх, потом гравитация, пружинка при "приземлении"
- **Визуал:** ярче ash, rounder
- **Время жизни:** среднее (1200-2200ms)
- **Поведение:** gravity > rise, bounce на "земле"

Патч для `spawnCrumb`:
```js
particles.push({
  el, born: performance.now(),
  dur: rand(1200, 2200),
  rise: rand(-10, -3),         // слабый старт
  drift: rand(-4, 4),
  sway: 0,
  isSpark: false,
  type: 'crumb',
  vy: 0,
  gravity: 0.035,              // сильная гравитация
  bounce: 0.4,                 // пружинка
  groundY: rand(55, 70),       // "уровень земли" в %
});
```

### Haze (дым) — объёмный, медленный, с рассеиванием

- **Движение:** very slow drift up, spreading horizontally
- **Визуал:** blur, large, transparent
- **Поведение:** affected by heat zones, almost stationary relative to particles

Уже реализовано в CSS как `.ember-haze`. Можно модулировать через CSS custom properties из JS:
```js
// В update(), рядом с heat zones:
const hazeIntensity = clamp(intensity * 0.6 + coreHeatReserve * 0.3, 0, 1);
hazeEl.style.opacity = hazeIntensity.toFixed(3);
```

---

## 3. Particle update: per-type physics

### Problem

`updateParticles()` обрабатывает все частицы одинаково: rise, drift, sway, opacity fade. Нет per-type физики.

### Task

В `updateParticles()` добавить per-type обработку:

```js
function updateParticles(now, dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    const t = clamp((now - p.born) / p.dur, 0, 1);
    if (t >= 1) { /* release */ continue; }

    let rise, drift;

    if (p.isSpark) {
      // Sparks: gravity + wind + inertia
      rise = p.rise * easeOutQuad(t) + (p.gravity || 0) * t * t * 50;
      drift = p.drift * t + windGust * (p.windInfluence || 0) * t;
    } else if (p.type === 'crumb') {
      // Crumbs: ballistic arc with bounce
      p.vy += (p.gravity || 0.025) * dt;
      rise = p.rise * t + p.vy * dt * 0.1;
      drift = p.drift * t;
      // ground bounce (visual only — clamp Y)
    } else if (p.swirlFactor) {
      // Ash with swirl
      rise = p.rise * easeOutQuad(t);
      drift = p.drift * t + Math.sin(t * Math.PI * 2 * p.swirlFactor) * p.sway;
    } else {
      // Default: original behavior
      rise = p.rise * easeOutQuad(t);
      drift = p.drift * t + Math.sin(t * Math.PI * 3) * (p.sway || 0);
    }

    // ... opacity, scale, transform (existing) ...
  }
}
```

---

## 4. CSS: make ash/spark visually distinct

### Problem

`.ember-ash` и `.ember-spark` отличаются только размером и box-shadow. На мелких частицах это не видно.

### Task

Усилить визуальное различие:

**Ash** — тусклый, "мертвый":
```css
.ember-ash {
  background: rgba(140, 130, 125, 0.7);
  box-shadow: none;
  border-radius: 40% 60% 50% 50%;
}
.ember-ash.dark {
  background: rgba(60, 40, 25, 0.8);
}
.ember-ash.bright {
  background: rgba(220, 180, 120, 0.9);
  box-shadow: 0 0 3px rgba(255, 170, 80, 0.4);
}
```

**Spark** — яркий, "горячий":
```css
.ember-spark {
  background: radial-gradient(circle, rgba(255,240,180,1) 0%, rgba(255,160,50,1) 60%, transparent 100%);
  box-shadow:
    0 0 4px rgba(255, 200, 100, 1),
    0 0 10px rgba(255, 130, 40, 0.9),
    0 0 20px rgba(255, 80, 20, 0.5);
}
```

---

## 5. Ring segments: make effects visually readable

### Problem

Сегментные эффекты (`segTremor`, `segFlicker`, `segHeatRipple`, `segHeatWave`) все выглядят как "что-то мигает".

### Task

Дать каждому типу свой характер:

- **segTremor** — rapid stutter, like vibration. Использовать `Math.sin(p * π * 12)` вместо `π * 3`.
- **segFlicker** — irregular, like candle. Использовать `Math.random()` для irregular flicker.
- **segHeatRipple** — wave traveling around ring. Оставить как есть, но добавить color shift.
- **segHeatWave** — slow warm pulse. Медленнее, с glow.

---

## 6. Rare events: make them feel special

### Problem

`sparkStorm`, `deformationBurst`, `ringPulseBig` etc. — все добавляют больше частиц/boost, но визуально не отличаются друг от друга.

### Task

Каждый rare event должен иметь уникальную "подпись":

- **sparkStorm** — горизонтальный spray + ring rotation burst
- **deformationBurst** — core squish + crack ignition both sides + ash rain
- **ringPulseBig** — ring expands dramatically + segments flash in sequence
- **heatBubble** — core pulsates with color shift (hue rotate)
- **coalSigh** — heavy exhale motion + ash fall + glow dim
- **hotVein** — single side crack glow + localized brightness
- **ashDump** — concentrated ash burst from top

---

# Implementation guidance

## Priority order
1. Particles (sparks, ash, crumbs) — biggest visual impact
2. Core effect motion signatures — makes each effect recognizable
3. CSS particle styles — visual distinctness
4. Ring segment differentiation — secondary
5. Rare event signatures — polish

## Code style
- Follow existing module conventions
- Use existing helpers: `clamp`, `rand`, `easeOutQuad`, `easeInQuad`, `bump`
- Keep particle pool working
- Don't break `reduceMotion` or `lowFpsMode`

## Important
- Particle changes affect pool performance. Keep total count limits.
- CSS changes should not increase paint cost significantly.
- Test with `lowFpsMode` and `reduceMotion` — effects should degrade gracefully.

---

# Acceptance checklist

- [ ] sparks feel hot and fast, ash feels floaty and lazy, crumbs feel heavy
- [ ] each core effect (sigh, wiggle, tilt, etc.) is visually distinguishable from others
- [ ] ring segments show different patterns per effect type
- [ ] rare events feel genuinely special, not just "more particles"
- [ ] particles don't cause performance regression in low-fps mode
- [ ] reduced motion mode still works
- [ ] no new memory leaks or DOM growth
