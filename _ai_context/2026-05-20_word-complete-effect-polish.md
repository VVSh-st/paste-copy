# WordComplete accept effect polish

Задача: пользователь показал скриншоты, где Matrix-эффект принятия подсказки выглядел слишком грубо: тёмная подложка-плашка и широкие случайные символы вроде `/GB73`, которые распирали слово.

Изменения:
- `word-complete.js`: заменён общий набор glyphs с символами/слешами/блоками на безопасные пулы по типу символа: кириллица lower/upper, латиница lower/upper, цифры.
- `word-complete.js`: добавлен canvas measureText и фиксированная width для каждой буквы overlay, чтобы рандомные буквы не меняли ширину слова.
- `word-complete.js`: убрана установка `backgroundColor` для overlay, теперь эффект прозрачно ложится поверх вставленного текста без тёмной капсулы.
- `word-complete.js`: план фиксации букв стал более коротким и мягким: случайные островки + быстрое закрытие, меньше хаоса.
- `styles.css`: убрана визуальная плашка, снижен glow/opacity, сделан более тонкий Mercury/Matrix shimmer.

Затронутые файлы:
- `word-complete.js`
- `styles.css`

Backup manifest:
- `_ai_backups/2026-05-20_12-10-00/BACKUP_MANIFEST_word-complete-effect-polish.txt`
