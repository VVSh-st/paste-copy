# WordComplete accept effect fix

Issue from screenshots: overlay was visually doubling with inserted text, looked like mush. Root causes:
- Inline hint has `HINT_OFFSET_X = 5`, but accepted text starts at actual caret. Overlay reused hint left position, so it was shifted over the inserted word.
- Transparent overlay made accepted text visible underneath, causing doubled letters.
- Random glyph pool and frequent updates were too noisy.

Changes:
- `InlineHint.getSnapshot()` now carries `hintOffsetX`.
- `WordAcceptEffect.play()` subtracts `hintOffsetX` to align overlay with actual inserted text.
- Effect masks only individual character cells with textarea background via `--wc-mask-bg`, not a full dark pill.
- Glyph logic prefers final character most of the time and uses a small soft pool only briefly.
- CSS glow/blur reduced; lock animation simplified.

Affected files:
- word-complete.js
- styles.css
