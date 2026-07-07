// file_name: help.js

(function () {
  'use strict';

  const HELP_BUTTON_ID = 'btn-help';
  const HELP_OVERLAY_ID = 'help-overlay';
  const HELP_SEARCH_ID = 'help-search-input';

  let lastFocus = null;
  let isReady = false;

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function toast(message, type = 'success') {
    if (window.Toast?.show) {
      window.Toast.show(message, type);
      return;
    }

    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function createHelpButton() {
    if (document.getElementById(HELP_BUTTON_ID)) return;

    const copyButton = document.getElementById('btn-copy');
    const toolbar = document.getElementById('toolbar');
    if (!copyButton || !toolbar) return;

    const button = document.createElement('button');
    button.id = HELP_BUTTON_ID;
    button.type = 'button';
    button.className = 'tb-btn tb-btn-icon-only help-toolbar-btn';
    button.title = 'Справка и быстрый старт (F2)';
    button.setAttribute('aria-label', 'Открыть справку');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', HELP_OVERLAY_ID);
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="10" cy="10" r="7.25"></circle>
        <path d="M7.9 7.8a2.25 2.25 0 0 1 4.25 1.05c0 1.65-1.98 1.98-1.98 3.27"></path>
        <path d="M10 15h.01"></path>
      </svg>
    `;

    copyButton.parentNode.insertBefore(button, copyButton);
    button.addEventListener('click', openHelp);
    button.addEventListener('mouseenter', () => { if (typeof Ember !== 'undefined') Ember.triggerReaction('helpHover'); });
  }

  function createHelpOverlay() {
    if (document.getElementById(HELP_OVERLAY_ID)) return;

    const overlay = document.createElement('section');
    overlay.id = HELP_OVERLAY_ID;
    overlay.className = 'help-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'help-title');
    overlay.innerHTML = getHelpMarkup();

    document.body.appendChild(overlay);
  }

  function getHelpMarkup() {
    return `
      <div class="help-shell" role="document">
        <div class="help-sticky-head">
          <header class="help-topbar">
            <div class="help-title-wrap">
              <span class="help-logo" aria-hidden="true">?</span>
              <div>
                <p class="help-eyebrow">paste\\copy · справка</p>
                <h1 id="help-title">Промпт-редактор, который не требует инструкции</h1>
              </div>
            </div>
            <div class="help-actions">
              <button type="button" class="help-chip help-chip-hotkey" data-help-filter="hotkeys">F2</button>
              <button type="button" class="help-close" data-help-close aria-label="Закрыть справку">✕</button>
            </div>
          </header>

          <div class="help-controlbar">
            <label class="help-search-wrap" for="${HELP_SEARCH_ID}">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5"></circle>
                <path d="M11.5 11.5l2.5 2.5"></path>
              </svg>
              <input id="${HELP_SEARCH_ID}" type="search" placeholder="Найти: блоки, БРО, перевод, якоря..." autocomplete="off" spellcheck="false">
            </label>
            <nav class="help-filterbar" aria-label="Фильтры справки">
              <button type="button" class="active" data-help-filter="all">Всё</button>
              <button type="button" data-help-filter="start">Старт</button>
              <button type="button" data-help-filter="hotkeys">Хоткеи</button>
              <button type="button" data-help-filter="blocks">Блоки</button>
              <button type="button" data-help-filter="tools">Инструменты</button>
              <button type="button" data-help-filter="bro">БРО</button>
              <button type="button" data-help-filter="sync">Синхронизация</button>
              <button type="button" data-help-filter="trouble">Проблемы</button>
            </nav>
          </div>
        </div>

        <div class="help-hero" data-help-card data-help-category="start" data-help-tags="старт быстро промпт превью копировать новичок">
          <div class="help-hero-main">
            <span class="help-pill">Быстрый старт</span>
            <h2>Собирай промпт как LEGO: блоками, а не одной простынёй боли.</h2>
            <p>Вкладка — отдельный сценарий. Блоки — куски промпта. Превью — итоговый текст для LLM. Чем яснее структура, тем меньше модель делает вид, что поняла.</p>
          </div>
          <ol class="help-steps" aria-label="Быстрый старт">
            <li><b>1</b><span>Создай вкладку под задачу</span></li>
            <li><b>2</b><span>Добавь блоки: контекст, задача, формат</span></li>
            <li><b>3</b><span>Проверь превью и счётчики</span></li>
            <li><b>4</b><span>Запусти аудит/сжатие, если нужно</span></li>
            <li><b>5</b><span>Копируй результат и иди побеждать хаос</span></li>
          </ol>
        </div>

        <main class="help-content" tabindex="-1">
          <div class="help-grid help-grid-priority">
            ${card('start', '🚀', 'Маршрут на 60 секунд', 'Самый короткий путь от «что это?» до рабочего промпта.', `
              <ul class="help-list">
                <li><b>Вкладка</b> = отдельный сценарий или проект.</li>
                <li><b>Блок</b> = часть будущего промпта: роль, контекст, ограничения.</li>
                <li><b>Превью</b> = итог, который копируется в LLM.</li>
                <li><b>Шаблон</b> = заготовка, чтобы не начинать с пустого космоса.</li>
              </ul>
            `, 'start вкладка блок превью шаблон')}

            ${card('hotkeys', '⌨️', 'Хоткеи', '', `
              <div class="help-kbd-grid">
                ${kbd('F2', 'Открыть / закрыть справку')}
                ${kbd('Esc', 'Закрыть панели, меню, справку')}
                ${kbd('Ctrl + S', 'Сохранить')}
                ${kbd('Ctrl + Z', 'Отменить')}
                ${kbd('Ctrl + Y', 'Повторить')}
                ${kbd('Ctrl + F', 'Поиск и замена')}
                ${kbd('F3', 'Следующее совпадение')}
                ${kbd('Ctrl + T', 'Новая вкладка')}
                ${kbd('Ctrl + W', 'Закрыть вкладку')}
                ${kbd('Ctrl + D', 'Дублировать вкладку')}
                ${kbd('Ctrl + Shift + C', 'Копировать превью')}
                ${kbd('Ctrl + Shift + 1', 'Установить якорь')}
                ${kbd('Ctrl + Shift + 2', 'Навигация по якорям')}
                ${kbd('Ctrl + Shift + 3', 'Удалить все якоря')}
                ${kbd('Alt + L', 'Мини-чат')}
                ${kbd('Ctrl + Enter', 'Отправить в мини-чате')}
              </div>
            `, 'hotkeys клавиши f2 esc ctrl alt')}

            ${card('start', '✅', 'Чеклист перед копированием', 'Если всё отмечено — модель меньше фантазирует.', `
              <label class="help-check"><input type="checkbox"> Есть роль или контекст?</label>
              <label class="help-check"><input type="checkbox"> Задача сформулирована одним глаголом?</label>
              <label class="help-check"><input type="checkbox"> Указан формат ответа?</label>
              <label class="help-check"><input type="checkbox"> Ограничения не противоречат друг другу?</label>
              <label class="help-check"><input type="checkbox"> Черновой мусор не уехал в превью?</label>
              <p class="help-muted">Последний пункт важен: LLM читает даже то, что ты «ну это потом удалю».</p>
            `, 'checklist чеклист копировать превью')}
          </div>

          <section class="help-section">
            <div class="help-section-head">
              <h2>Блоки</h2>
              <p>Кирпичики твоего промпта.</p>
            </div>
            <div class="help-masonry">
              ${card('blocks', '📝', 'Текстовый блок', 'Основа основ.', `
                <ul class="help-list">
                  <li>Обычная секция промпта с заголовком, иконкой и текстом.</li>
                  <li>Кнопка <b>⊙</b> включает/выключает блок из превью.</li>
                  <li>Заголовок можно редактировать прямо на месте.</li>
                  <li>У каждого блока есть <b>#N</b> — номер для ориентира.</li>
                </ul>
              `, 'blocks блок текст text')}

              ${card('blocks', '📌', 'Sticky Note', 'Цветная заметка, которая не лезет в превью.', `
                <ul class="help-list">
                  <li>5 цветов на выбор: синий, зелёный, жёлтый, розовый, серый.</li>
                  <li>Авто-подстройка высоты под текст.</li>
                  <li>Иконка ⊘ показывает: в превью не участвует.</li>
                  <li>Идеально для заметок, напоминаний, «пока не трогать».</li>
                </ul>
              `, 'blocks sticky заметка sticky note цвет')}

              ${card('blocks', '☑️', 'TODO Чеклист', 'Задачи с галочками прямо в промпте.', `
                <ul class="help-list">
                  <li>5 субвкладок для разных списков задач.</li>
                  <li>Чекбоксы с анимацией — отмечай и радуйся.</li>
                  <li><b>Enter</b> — новая задача, <b>Backspace</b> — удалить пустую.</li>
                  <li><b>Ctrl+↑↓</b> — перетаскивание задач.</li>
                  <li>Переключение вкладок <b>←→</b> без мышки.</li>
                </ul>
              `, 'blocks todo чеклист задачи checkbox')}

              ${card('blocks', '📊', 'Таблица', 'Структурированные данные в сетке.', `
                <ul class="help-list">
                  <li>5 субвкладок для разных таблиц.</li>
                  <li>Сетка от 1 до 15 колонок — настрой ширину.</li>
                  <li><b>+</b> / <b>−</b> — добавить/удалить строку.</li>
                  <li><b>&lt; &gt;</b> — выбор колонок и копирование между вкладками.</li>
                  <li>Превью таблицы в формате Markdown.</li>
                </ul>
              `, 'blocks table таблица grid колонки')}

              ${card('blocks', '🧩', 'Переменные', 'Одно имя — много мест.', `
                <p>Создай переменную <code>{{product}}</code> и используй в разных блоках. Поменял значение — обновилось везде.</p>
                <div class="help-example compact">
                  <pre><code>Продукт: {{product}}
Аудитория: {{audience}}
Формат: таблица + выводы</code></pre>
                  <button type="button" data-copy-example>Скопировать</button>
                </div>
              `, 'variables переменные product audience')}

              ${card('blocks', '🧱', 'Сниппеты', 'Облачные сниппеты (из Loom) и локальные шаблоны.', `
                <ul class="help-list">
                  <li><b>Облачные</b> — синхронизируются между проектами.</li>
                  <li><b>Локальные</b> — быстрые команды для текущего проекта.</li>
                  <li><b>Группа</b> — порядок и структура внутри структуры. Да, матрёшка.</li>
                </ul>
              `, 'blocks сниппеты команда группа snippets commands')}

              ${card('blocks', '👁️', 'Превью', 'Итоговый текст для LLM.', `
                <ul class="help-list">
                  <li>Собирает включённые блоки в один текст.</li>
                  <li>Показывает символы, строки, размер и примерные токены.</li>
                  <li>Перенос строк, размер шрифта, Markdown-рендер.</li>
                  <li>Кнопки аудита и сжатия — прямо в панели.</li>
                </ul>
              `, 'preview превью markdown токены копировать')}
            </div>
          </section>

          <section class="help-section">
            <div class="help-section-head">
              <h2>Инструменты</h2>
              <p>Всё, что делает редактирование быстрее.</p>
            </div>
            <div class="help-masonry">
              ${card('tools', '🌐', 'Переводчик', 'Перевод прямо в блоке, без копипаста.', `
                <ul class="help-list">
                  <li>Кнопка <b>🌐</b> внизу каждого текстового блока.</li>
                  <li>Клик — мгновенный перевод на выбранный язык.</li>
				  <li>Перевод выделения на выбранный язык.</li>
                  <li>Длинное нажатие — выбор языка и движка (Google, Microsoft).</li>
                  <li>Повторный клик — <b>↩</b> откат к оригиналу.</li>
                  <li>Не трогает переменные, теги и код — у них дипломатический иммунитет.</li>
                  <li>Ember показывает ✨ при переводе.</li>
                </ul>
              `, 'tools translate переводчик язык google microsoft')}

              ${card('tools', '🔍', 'Визуальный Diff', 'Сравнение версий с подсветкой изменений.', `
                <ul class="help-list">
                  <li>Открой <b>Снапшоты</b> и нажми <b>Diff</b> рядом с любой версией.</li>
                  <li>Inline-дифф: зелёное — добавлено, красное — удалено.</li>
                  <li>Навигация <b>▲ ▼</b> между изменениями.</li>
                  <li>Масштаб шрифта <b>A− A+</b> для детального просмотра.</li>
                  <li>Кнопка копирования изменений целиком.</li>
                </ul>
              `, 'tools diff сравнение версии снапшот snapshot')}

              ${card('tools', '⚓', 'Якоря', 'Закладки на нужные места в тексте.', `
                <ul class="help-list">
                  <li><b>Ctrl+Shift+1</b> — поставить якорь на выделение или курсор.</li>
                  <li><b>Ctrl+Shift+2</b> — перейти к следующему якорю.</li>
                  <li>Длинное нажатие иконки перехода — список всех якорей.</li>
                  <li><b>Ctrl+Shift+3</b> — удалить все якоря.</li>
                  <li>Цветные полосы и подсветка — сразу видно, где якорь.</li>
                  <li>Palette показывает превью текста и номер.</li>
                </ul>
              `, 'anchors якоря закладки bookmark navigation palette')}

              ${card('tools', '🪮', 'Локальная причёска', 'Текстовый линтер без нейросетей.', `
                <ul class="help-list">
                  <li><b>Быстро причесать</b> — убирает пробелы, края строк, проблемы пунктуации.</li>
                  <li><b>Diff и подсказки</b> — показывает, что изменится, до принятия.</li>
                  <li><b>Очистка AI-текста</b> — невидимые символы, тире, многоточия, неразрывные пробелы.</li>
                  <li>Защита сокращений: <code>т.д.</code>, <code>т.е.</code>, <code>т.к.</code> — линтер не ломает их.</li>
                  <li>Код, URL, email, <code>{{переменные}}</code>, Markdown и команды — не трогает.</li>
                  <li>Дробные числа <code>6,5</code> — без пробела, рубли не превращаются в салат.</li>
                </ul>
              `, 'tools text linter линтер причесать пробелы diff AI невидимые символы')}

              ${card('tools', '🧠', 'LLM-инструменты', 'ИИ прямо в редакторе.', `
                <ul class="help-list">
                  <li><b>Мини-чат</b> — спросить LLM, не покидая рабочее место.</li>
                  <li><b>Причесать текст</b> — меню на текстовом блоке с причиной:</li>
                  <li>Быстро причесать, diff, грамматика, форматирование</li>
                  <li>Позитивные инструкции, что пойдёт не так, резюме</li>
                  <li>Сокращение и тон: расширить, формальный, неформальный</li>
                  <li><b>Аудит промпта</b> — найти слабые места.</li>
                  <li><b>Сжать токены</b> — убрать лишнее без потери смысла.</li>
                </ul>
              `, 'tools llm модель аудит сжатие чат автозаголовок intelligence')}

              ${card('tools', '✨', 'Автодополнение', 'Подсказки при наборе текста.', `
                <ul class="help-list">
                  <li>Призрачная подсказка у каретки — как в IDE.</li>
                  <li><b>Tab</b> — принять подсказку.</li>
                  <li><b>Esc</b> — отклонить.</li>
                  <li>Работает по префиксу, учитывает контекст.</li>
                </ul>
              `, 'tools autocompletion подсказки tab word complete')}

              ${card('tools', '🪮', 'Тамагочи-показометр', 'Ember — живой символ на каждой вкладке.', `
                <ul class="help-list">
                  <li>На каждой вкладке живёт свой Ember — маленький уголёк с характером.</li>
                  <li>Показывает <b>время</b> и реагирует на твою активность.</li>
                  <li>Чем больше вводишь — тем ярче горит. Перестал работать — остывает и дымится.</li>
                  <li>Реакции на действия: искры при копировании, восторг при переводе, вздрагивание при удалении.</li>
                  <li><b>Двойной клик</b> — Economy Mode: выключает частицы для экономии батареи.</li>
                </ul>
              `, 'tools ember тамагочи показометр огонёк economy время')}

              ${card('tools', '🗂️', 'Шаблоны', 'Заготовки, чтобы не начинать с нуля.', `
                <ul class="help-list">
                  <li><b>6 встроенных:</b> Код-ревью, Перевод, Рефакторинг, Объяснение, Брейнсторм, Отладка.</li>
                  <li>Создавай свои шаблоны из текущей структуры блоков.</li>
                  <li>Установи шаблон по умолчанию для новых вкладок.</li>
                </ul>
              `, 'tools шаблоны templates')}
            </div>
          </section>

          <section class="help-section">
            <div class="help-section-head">
              <h2>БРО-теги</h2>
              <p>Команды прямо в тексте. Почти магия, но с логами.</p>
            </div>
            <div class="help-masonry">
              ${card('bro', '🗣️', 'Встроенные теги', '', `
                <div class="help-example">
                  <pre><code>!бро чем усилить этот промпт?
!фикс исправь этот текст
!вопрос каких данных не хватает?
!план
!сум
!режим кратко
!старт
!эн
!ру
!история</code></pre>
                  <button type="button" data-copy-example>Скопировать</button>
                </div>
                <p class="help-muted">При вводе <code>!</code> откроется быстрое меню. <code>!старт</code> становится контекстом для последующих тегов.</p>
              `, 'bro бро тег теги встроенные !бро !фикс !вопрос !план !сум')}

              ${card('bro', '🏷️', 'Пользовательские теги', 'Свои команды — свои правила.', `
                <ul class="help-list">
                  <li><code>!мой-тег</code> — вставляет ответ в позицию курсора.</li>
                  <li><code>!!мой-тег</code> — заменяет весь текст текущей вкладки.</li>
                  <li>Системные промпты в <b>Хранилище</b> — библиотека готовых инструкций.</li>
                  <li>Можно комбинировать: <code>... контекст. !бро что улучшить?</code></li>
                </ul>
              `, 'bro пользовательские теги !!мой-тег хранилище')}

              ${card('bro', '🌐', 'Перевод через БРО', 'Быстрый перевод одной строкой.', `
                <div class="help-example compact">
                  <pre><code>!эн перевод на английский
!ру перевод на русский</code></pre>
                  <button type="button" data-copy-example>Скопировать</button>
                </div>
                <p class="help-muted">Переводит весь текст вкладки через LLM. Используй текущий профиль для лучшего результата.</p>
              `, 'bro перевод !эн !ру translate')}
            </div>
          </section>

          <section class="help-section">
            <div class="help-section-head">
              <h2>Синхронизация и бэкапы</h2>
              <p>Твои данные переживут даже закрытие вкладки.</p>
            </div>
            <div class="help-masonry">
              ${card('sync', '☁️', 'Gist Sync', 'Синхронизация через GitHub Gist.', `
                <ul class="help-list">
                  <li>Полная синхронизация состояния через GitHub.</li>
                  <li>История версий — можно откатиться к любой точке.</li>
                  <li>Автосинхронизация по расписанию.</li>
                </ul>
              `, 'sync gist github синхронизация')}

              ${card('sync', '💾', 'Локальные бэкапы', 'IndexedDB — надёжнее куки.', `
                <ul class="help-list">
                  <li>Автосохранение после каждого пуша в Gist.</li>
                  <li>Максимум 30 бэкапов — старые удаляются.</li>
                  <li><b>☠</b> — пометить бэкап как бессмертный (не удаляется).</li>
                  <li>Восстановление с безопасным снапшотом перед откатом.</li>
                  <li>Экспорт бэкапа в JSON-файл.</li>
                </ul>
              `, 'sync backup бэкап indexeddb локальный')}

              ${card('sync', '🧠', 'Memory Sync', 'Синхронизация метаданных без полного текста.', `
                <ul class="help-list">
                  <li>Отправляет только хэши, роли, счётчики и структуру.</li>
                  <li>Полный текст не покидает браузер — паранойя тут фича.</li>
                  <li>Auto push/pull — настрой под свой темп.</li>
                </ul>
              `, 'sync memory метаданные приватность')}

              ${card('sync', '📦', 'Экспорт / Импорт', 'JSON — универсальный язык.', `
                <ul class="help-list">
                  <li>Экспорт всего состояния в JSON-файл.</li>
                  <li>Импорт из JSON — восстановление за секунду.</li>
                  <li>Перенос рабочего места между браузерами.</li>
                </ul>
              `, 'sync export import json экспорт импорт')}
            </div>
          </section>

          <section class="help-section">
            <div class="help-section-head">
              <h2>Типовые сценарии</h2>
              <p>Бери как рецепт. Можно без чувства вины.</p>
            </div>
            <div class="help-scenarios">
              ${scenario('Собрать промпт для задачи', ['Новая вкладка', 'Блок «Контекст»', 'Блок «Задача»', 'Блок «Формат ответа»', 'Аудит промпта', 'Копировать превью'])}
              ${scenario('Улучшить старый промпт', ['Вставь текст в блок', 'Запусти «Аудит промпта»', 'Исправь слабые места', 'Сделай снапшот до/после', 'Сожми токены при необходимости'])}
              ${scenario('Проверить ТЗ', ['Вставь ТЗ', 'Добавь !вопрос каких данных не хватает?', 'Нажми Enter', 'Смотри ответ и не спорь с очевидным'])}
              ${scenario('Перевести текст', ['Вставь текст в блок', 'Нажми 🌐 или добавь !эн / !ру', 'Проверь термины — модели любят творчество', 'Откати, если не нравится — повторный клик ↩'])}
            </div>
          </section>

          <section class="help-section">
            <div class="help-section-head">
              <h2>Примеры для копирования</h2>
              <p>Мини-заготовки, чтобы не смотреть в пустой блок как в бездну.</p>
            </div>
            <div class="help-grid">
              ${exampleCard('Каркас сильного промпта', `Роль: Ты опытный [специалист].
Контекст: [кратко опиши ситуацию].
Задача: [что нужно сделать].
Ограничения: [тон, объём, запреты].
Формат ответа: [список / таблица / JSON / план].
Проверь: укажи риски и вопросы, если данных не хватает.`)}
              ${exampleCard('Аудит задачи', `Проанализируй задачу ниже.
Найди:
1. Неясные места
2. Противоречия
3. Недостающие данные
4. Риски реализации
5. 5 уточняющих вопросов

Текст задачи:
[вставить сюда]`)}
              ${exampleCard('Сжатие без потери смысла', `Сожми текст ниже на 30–40%.
Сохрани требования, ограничения, примеры и важные термины.
Убери повторы, воду и декоративные фразы.

Текст:
[вставить сюда]`)}
            </div>
          </section>

          <section class="help-section">
            <div class="help-section-head">
              <h2>Если что-то пошло не так</h2>
              <p>Без паники. Паника — плохой UX.</p>
            </div>
            <div class="help-masonry">
              ${card('trouble', '📋', 'Не копируется', '', `
                <p>Проверь настройку <b>Clipboard API</b>. Если браузер капризничает, отключи её и копируй обычным способом. Иногда безопасность браузера думает, что она тут главная.</p>
              `, 'trouble clipboard копирование')}
              ${card('trouble', '🤐', 'LLM молчит', '', `
                <p>Проверь активный профиль, endpoint, API key, модель и timeout. Если модель локальная и тяжёлая — увеличь таймаут. Возможно, она не задумалась, а просто ещё грузится.</p>
              `, 'trouble llm endpoint api timeout модель')}
              ${card('trouble', '👻', 'Превью странное', '', `
                <p>Проверь включение заголовков, разделитель и Markdown-режим. Если текст выглядит как древний свиток — вероятно, разделитель слишком героический.</p>
              `, 'trouble preview markdown separator')}
              ${card('trouble', '🧯', 'Слишком много токенов', '', `
                <p>Запусти <b>Сжать токены</b>, отключи лишние блоки, вынеси повторяемое в переменные и убери «на всякий случай». LLM не обязана читать весь холодильник, чтобы приготовить омлет.</p>
              `, 'trouble tokens сжатие')}
            </div>
          </section>

          <section class="help-section help-advanced" data-help-card data-help-category="tools" data-help-tags="advanced продвинуто настройки системные промпты автопоэт intelligence smart suggestions memory sync gist privacy">
            <details>
              <summary>Продвинутые фишки — открывать, когда базовый хаос уже приручён</summary>
              <div class="help-details-grid">
                <p><b>Системные промпты:</b> можно менять инструкции встроенных LLM-функций. Не удаляй обязательные переменные вроде <code>{instruction}</code>.</p>
                <p><b>AutoPoet:</b> автодополнение от LLM. Удобно, но включай осознанно, чтобы текст не начал жить свою лучшую жизнь.</p>
                <p><b>Intelligence:</b> тихие подсказки, диагностика структуры, похожие промпты, версии и baseline. Не чатится без спроса — просто подмигивает, когда видит хаос.</p>
                <p><b>Word Complete:</b> призрачные подсказки при наборе. Принимай по Tab, отклоняй по Esc. Научится на твоём стиле.</p>
                <p><b>Prompt Loom:</b> итеративное развитие промптов. LLM предлагает варианты улучшения — ты выбираешь лучший.</p>
              </div>
            </details>
          </section>

          <div class="help-empty" hidden>
            <b>Ничего не найдено.</b>
            <span>Попробуй «блоки», «БРО», «перевод», «якоря» или нажми фильтр «Всё».</span>
          </div>
        </main>
      </div>
    `;
  }

  function card(category, icon, title, subtitle, body, tags = '') {
    return `
      <article class="help-card help-card-${escapeHtml(category)}" data-help-card data-help-category="${escapeHtml(category)}" data-help-tags="${escapeHtml(tags)} ${escapeHtml(title)} ${escapeHtml(subtitle || '')}">
        <div class="help-card-head">
          <span class="help-card-icon" aria-hidden="true">${escapeHtml(icon)}</span>
          <div>
            <h3>${escapeHtml(title)}</h3>
            ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
          </div>
        </div>
        <div class="help-card-body">${body}</div>
      </article>
    `;
  }

  function kbd(keys, label) {
    const parts = keys.split('+').map(part => `<kbd>${escapeHtml(part.trim())}</kbd>`).join('<span class="help-kbd-plus">+</span>');
    return `<div class="help-kbd-row"><span class="help-kbd-combo">${parts}</span><span>${escapeHtml(label)}</span></div>`;
  }

  function scenario(title, steps) {
    return `
      <article class="help-scenario" data-help-card data-help-category="start" data-help-tags="сценарий ${escapeHtml(title)} ${escapeHtml(steps.join(' '))}">
        <h3>${escapeHtml(title)}</h3>
        <ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
      </article>
    `;
  }

  function exampleCard(title, text) {
    return `
      <article class="help-card help-card-example" data-help-card data-help-category="start" data-help-tags="пример копировать ${escapeHtml(title)} ${escapeHtml(text)}">
        <div class="help-card-head">
          <span class="help-card-icon" aria-hidden="true">🧪</span>
          <div><h3>${escapeHtml(title)}</h3><p>Можно скопировать и адаптировать.</p></div>
        </div>
        <div class="help-example">
          <pre><code>${escapeHtml(text)}</code></pre>
          <button type="button" data-copy-example>Скопировать</button>
        </div>
      </article>
    `;
  }

  function bindEvents() {
    const overlay = document.getElementById(HELP_OVERLAY_ID);
    if (!overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';

    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeHelp();
      if (event.target.closest('[data-help-close]')) closeHelp();

      const filterButton = event.target.closest('[data-help-filter]');
      if (filterButton) {
        const filter = filterButton.dataset.helpFilter || 'all';
        setFilter(filter);
      }

      const copyButton = event.target.closest('[data-copy-example]');
      if (copyButton) copyExample(copyButton);
    });

    const search = document.getElementById(HELP_SEARCH_ID);
    if (search) {
      search.addEventListener('input', () => applyVisibility());
      search.addEventListener('keydown', event => {
        if (event.key === 'Escape' && search.value) {
          event.stopPropagation();
          search.value = '';
          applyVisibility();
        }
      });
    }

    if (!document.documentElement.dataset.helpHotkeysBound) {
      document.addEventListener('keydown', handleGlobalKeydown, true);
      document.documentElement.dataset.helpHotkeysBound = '1';
    }
  }

  function handleGlobalKeydown(event) {
    const overlay = document.getElementById(HELP_OVERLAY_ID);
    const opened = overlay && !overlay.hidden;

    if (event.key === 'F2') {
      event.preventDefault();
      event.stopPropagation();
      opened ? closeHelp() : openHelp();
      return;
    }

    if (!opened) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeHelp();
      return;
    }

    if (event.key === 'Tab') trapFocus(event, overlay);
  }

  function trapFocus(event, overlay) {
    const focusable = $all('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])', overlay)
      .filter(el => !el.disabled && el.offsetParent !== null);

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openHelp() {
    ensureReady();

    const overlay = document.getElementById(HELP_OVERLAY_ID);
    const button = document.getElementById(HELP_BUTTON_ID);
    if (!overlay) return;

    lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.hidden = false;
    document.body.classList.add('help-open');
    button?.classList.add('active-btn');
    button?.setAttribute('aria-expanded', 'true');

    const focusTarget = document.getElementById(HELP_SEARCH_ID) || $('.help-content', overlay) || overlay;
    focusTarget.focus?.({ preventScroll: true });

    requestAnimationFrame(() => {
      focusTarget.focus?.({ preventScroll: true });
    });
  }

  function closeHelp() {
    const overlay = document.getElementById(HELP_OVERLAY_ID);
    const button = document.getElementById(HELP_BUTTON_ID);
    if (!overlay || overlay.hidden) return;

    overlay.hidden = true;
    document.body.classList.remove('help-open');
    button?.classList.remove('active-btn');
    button?.setAttribute('aria-expanded', 'false');

    const focusTarget = lastFocus && document.contains(lastFocus) ? lastFocus : button;
    if (focusTarget && typeof focusTarget.focus === 'function') {
      setTimeout(() => focusTarget.focus({ preventScroll: true }), 0);
    }
  }

  function setFilter(filter) {
    const overlay = document.getElementById(HELP_OVERLAY_ID);
    if (!overlay) return;

    $all('[data-help-filter]', overlay).forEach(button => {
      button.classList.toggle('active', button.dataset.helpFilter === filter);
    });

    overlay.dataset.activeFilter = filter;
    applyVisibility();
  }

  function applyVisibility() {
    const overlay = document.getElementById(HELP_OVERLAY_ID);
    if (!overlay) return;

    const filter = overlay.dataset.activeFilter || 'all';
    const query = (document.getElementById(HELP_SEARCH_ID)?.value || '').trim().toLowerCase();
    let visibleCount = 0;

    $all('[data-help-card]', overlay).forEach(cardEl => {
      const category = cardEl.dataset.helpCategory || '';
      const haystack = `${cardEl.dataset.helpTags || ''} ${cardEl.textContent || ''}`.toLowerCase();
      const byFilter = filter === 'all' || category === filter;
      const byQuery = !query || haystack.includes(query);
      const visible = byFilter && byQuery;

      cardEl.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    const empty = $('.help-empty', overlay);
    if (empty) empty.hidden = visibleCount > 0;
  }

  async function copyExample(button) {
    const code = button.parentElement?.querySelector('code')?.textContent || '';
    if (!code.trim()) return;

    try {
      if (navigator.clipboard?.writeText && window._clipboardApiEnabled !== false) {
        await navigator.clipboard.writeText(code);
      } else {
        fallbackCopy(code);
      }

      const original = button.textContent;
      button.textContent = 'Скопировано ✓';
      button.classList.add('copied');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('copied');
      }, 1100);
      toast('Пример скопирован ✓', 'success');
    } catch (error) {
      console.warn('HelpCenter copy failed:', error);
      fallbackCopy(code);
      toast('Скопировано через fallback ✓', 'success');
    }
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function ensureReady() {
    if (isReady) return;
    createHelpButton();
    createHelpOverlay();
    bindEvents();
    setFilter('all');
    isReady = true;
  }

  function init() {
    createHelpButton();
    createHelpOverlay();
    bindEvents();
    setFilter('all');
    isReady = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.HelpCenter = {
    open: openHelp,
    close: closeHelp,
    toggle() {
      const overlay = document.getElementById(HELP_OVERLAY_ID);
      overlay && !overlay.hidden ? closeHelp() : openHelp();
    },
  };
})();
