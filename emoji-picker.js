/* ================================================================
   Emoji Picker — вставка эмодзи по ":" в textarea
   Минималистичный, зелёный accent, русские названия.
   ================================================================ */
(function () {
  'use strict';

  /* ── DATA ──────────────────────────────────────────────────────── */
  const EMOJI_DATA = [
    // Улыбки / эмоции
    { name: 'улыбка',       emoji: '😊',  tags: ['смех', 'радость', 'счастлив'] },
    { name: 'широкая улыбка', emoji: '😃', tags: ['улыбка', 'зубы'] },
    { name: 'смех',         emoji: '😆',  tags: ['хохот', 'смешно', 'улыбка'] },
    { name: 'веселье',      emoji: '😁',  tags: ['зубы', 'улыбка'] },
    { name: 'подмигивание', emoji: '😉',  tags: ['глаз'] },
    { name: 'благодарность', emoji: '🙏', tags: ['спасибо', 'молитва', 'ладони'] },
    { name: 'объятие',      emoji: '🤗',  tags: ['обнять', 'тёплый'] },
    { name: ' задумчивость', emoji: '🤔', tags: ['думаю', 'вопрос'] },
    { name: 'нейтрально',   emoji: '😐',  tags: ['без эмоций', 'пусто'] },
    { name: 'без выражения', emoji: '😑', tags: ['невыразительно'] },
    { name: 'молчание',     emoji: '😶',  tags: ['тишина', 'рот'] },
    { name: 'сон',          emoji: '😴',  tags: ['спать', 'спокойной'] },
    { name: 'усталость',    emoji: '😮‍💨', tags: ['устал', 'вздох'] },
    { name: 'шок',          emoji: '😱',  tags: ['ужас', 'крик'] },
    { name: 'восторг',      emoji: '🤩',  tags: ['звёзды', 'восхищение'] },
    { name: 'гордость',     emoji: '😤',  tags: ['досада', 'пар'] },
    { name: 'грусть',       emoji: '😢',  tags: ['слёзы', 'печаль'] },
    { name: 'рыдание',      emoji: '😭',  tags: ['горе', 'плач'] },
    { name: 'страх',        emoji: '😨',  tags: ['испуг', 'тревога'] },
    { name: 'облегчение',   emoji: '😌',  tags: ['покой', 'медитация'] },
    { name: 'кривая улыбка', emoji: '😬', tags: ['неловко'] },
    { name: 'rollable eyes', emoji: '🙄', tags: ['катать глаза'] },
    { name: 'плевок',       emoji: '🤮',  tags: ['тошнота', 'мерзко'] },
    { name: 'кайф',         emoji: '😎',  tags: ['очки', 'солнце'] },
    { name: 'дьявол',       emoji: '😈',  tags: ['рога', 'злой'] },
    { name: 'скелет',       emoji: '💀',  tags: ['череп', 'смех'] },
    { name: 'клоун',        emoji: '🤡',  tags: ['шут'] },
    { name: 'привидение',   emoji: '👻',  tags: ['призрак', 'хеллоуин'] },
    { name: 'alien',        emoji: '👽',  tags: ['инопланетянин'] },
    { name: 'робот',        emoji: '🤖',  tags: ['механизм'] },

    // Руки / жесты
    { name: 'класс',        emoji: '👍',  tags: ['лайк', 'ок', 'отлично'] },
    { name: 'плохо',        emoji: '👎',  tags: ['не нравится'] },
    { name: 'пятёрка',      emoji: '🖐️', tags: ['рука', 'пять'] },
    { name: 'ок',           emoji: '👌',  tags: ['класс', 'точно'] },
    { name: 'мир',          emoji: '✌️',  tags: ['победа', '两只 пальца'] },
    { name: 'рок',          emoji: '🤘',  tags: ['рока'] },
    { name: 'палец вверх',  emoji: '👆',  tags: ['указательный'] },
    { name: 'палец вниз',   emoji: '👇',  tags: ['указательный'] },
    { name: 'куки',         emoji: '🤝',  tags: ['рукопожатие', 'договор'] },
    { name: 'мольба',       emoji: '🙏',  tags: ['просьба', 'ладони'] },
    { name: 'руки вверх',   emoji: '🙌',  tags: ['ура', 'праздник'] },
    { name: 'обнять',       emoji: '🫂',  tags: ['объятие', 'любовь'] },
    { name: 'сердце руками', emoji: '🫶', tags: ['любовь', 'сердце'] },

    // Сердца / любовь
    { name: 'сердце',       emoji: '❤️',  tags: ['любовь', 'красное'] },
    { name: 'оранжевое сердце', emoji: '🧡', tags: ['оранжевый'] },
    { name: 'жёлтое сердце', emoji: '💛', tags: ['жёлтый'] },
    { name: 'зелёное сердце', emoji: '💚', tags: ['зелёный'] },
    { name: 'синее сердце', emoji: '💙',  tags: ['синий'] },
    { name: 'фиолетовое сердце', emoji: '💜', tags: ['фиолетовый'] },
    { name: 'чёрное сердце', emoji: '🖤', tags: ['чёрный'] },
    { name: 'белое сердце', emoji: '🤍',  tags: ['белый'] },
    { name: 'разбитое сердце', emoji: '💔', tags: ['печаль', 'разрыв'] },
    { name: 'горящее сердце', emoji: '🔥', tags: ['огонь', 'жар'] },
    { name: 'подарок',      emoji: '🎁',  tags: ['подарок', 'сюрприз'] },
    { name: 'ленточка',     emoji: '🎀',  tags: ['бантик'] },

    // Природа
    { name: 'солнце',       emoji: '☀️',  tags: ['погода', 'тёплый'] },
    { name: 'луна',         emoji: '🌙',  tags: ['ночь'] },
    { name: 'звезда',       emoji: '⭐',  tags: ['сияние'] },
    { name: 'огонь',        emoji: '🔥',  tags: ['жар', 'горячо'] },
    { name: 'молния',       emoji: '⚡',  tags: ['электричество'] },
    { name: 'радуга',       emoji: '🌈',  tags: ['цвет'] },
    { name: 'цветок',       emoji: '🌸',  tags: ['цветение', 'красиво'] },
    { name: 'роза',         emoji: '🌹',  tags: ['красная'] },
    { name: 'подсолнух',    emoji: '🌻',  tags: ['жёлтый'] },
    { name: 'дерево',       emoji: '🌳',  tags: ['природа'] },
    { name: 'ёлка',         emoji: '🎄',  tags: ['новый год', 'праздник'] },
    { name: 'листья',       emoji: '🍂',  tags: ['осень'] },
    { name: 'снег',         emoji: '❄️',  tags: ['зима', 'холодно'] },
    { name: 'облако',       emoji: '☁️',  tags: ['небо'] },
    { name: 'дождь',        emoji: '🌧️', tags: ['вода'] },
    { name: 'океан',        emoji: '🌊',  tags: ['вода', 'море'] },
    { name: 'молния',       emoji: '🌩️', tags: ['гроза'] },
    { name: 'туман',        emoji: '🌫️', tags: ['облако'] },

    // Еда
    { name: 'кофе',         emoji: '☕',  tags: ['напиток', 'чай'] },
    { name: 'пицца',        emoji: '🍕',  tags: ['еда'] },
    { name: 'бургер',       emoji: '🍔',  tags: ['еда'] },
    { name: 'пончик',       emoji: '🍩',  tags: ['сладкое'] },
    { name: 'торт',         emoji: '🎂',  tags: ['день рождения', 'праздник'] },
    { name: 'печенье',      emoji: '🍪',  tags: ['сладкое'] },
    { name: 'шоколад',      emoji: '🍫',  tags: ['сладкое'] },
    { name: 'мороженое',    emoji: '🍦',  tags: ['десерт'] },
    { name: 'яблоко',       emoji: '🍎',  tags: ['фрукт'] },
    { name: 'банан',        emoji: '🍌',  tags: ['фрукт'] },
    { name: 'виноград',     emoji: '🍇',  tags: ['фрукт'] },
    { name: 'клубника',     emoji: '🍓',  tags: ['ягода'] },
    { name: 'авocado',      emoji: '🥑',  tags: ['фрукт', 'зелёный'] },
    { name: 'тарелка',      emoji: '🍽️', tags: ['еда'] },

    // Животные
    { name: 'собака',       emoji: '🐶',  tags: ['пёс', 'животное'] },
    { name: 'кошка',        emoji: '🐱',  tags: ['кот', 'животное'] },
    { name: 'медведь',      emoji: '🐻',  tags: ['животное'] },
    { name: 'панда',        emoji: '🐼',  tags: ['животное'] },
    { name: 'львёнок',      emoji: '🦁',  tags: ['лев', 'животное'] },
    { name: 'енот',         emoji: '🦝',  tags: ['животное'] },
    { name: 'кролик',       emoji: '🐰',  tags: ['заяц', 'животное'] },
    { name: 'лиса',         emoji: '🦊',  tags: ['животное'] },
    { name: 'волк',         emoji: '🐺',  tags: ['животное'] },
    { name: 'пингвин',      emoji: '🐧',  tags: ['животное'] },
    { name: 'птица',        emoji: '🐦',  tags: ['животное'] },
    { name: 'орёл',         emoji: '🦅',  tags: ['животное'] },
    { name: 'сова',         emoji: '🦉',  tags: ['ночь', 'животное'] },
    { name: 'бабочка',      emoji: '🦋',  tags: ['насекомое'] },
    { name: 'улитка',       emoji: '🐌',  tags: ['животное'] },
    { name: 'лягушка',      emoji: '🐸',  tags: ['животное'] },
    { name: 'дракон',       emoji: '🐉',  tags: ['мифическое'] },
    { name: 'единорог',     emoji: '🦄',  tags: ['мифическое'] },
    { name: 'кит',          emoji: '🐳',  tags: ['морской'] },
    { name: 'дельфин',      emoji: '🐬',  tags: ['морской'] },
    { name: 'черепаха',     emoji: '🐢',  tags: ['животное'] },
    { name: 'крокодил',     emoji: '🐊',  tags: ['животное'] },
    { name: 'обезьяна',     emoji: '🐵',  tags: ['животное'] },
    { name: 'корова',       emoji: '🐮',  tags: ['животное'] },
    { name: 'свинья',       emoji: '🐷',  tags: ['животное'] },

    // Объекты
    { name: 'бомба',        emoji: '💣',  tags: ['взрыв'] },
    { name: 'кристалл',     emoji: '🔮',  tags: ['магия', 'шар'] },
    { name: 'алмаз',        emoji: '💎',  tags: ['драгоценность'] },
    { name: 'монета',       emoji: '💰',  tags: ['деньги'] },
    { name: 'сумка',        emoji: '💰',  tags: ['деньги'] },
    { name: 'часы',         emoji: '⏰',  tags: ['время'] },
    { name: 'замок',        emoji: '🔒',  tags: ['закрытый', 'безопасность'] },
    { name: 'ключ',         emoji: '🔑',  tags: ['открыть'] },
    { name: 'ножницы',      emoji: '✂️',  tags: ['резать'] },
    { name: 'молоток',      emoji: '🔨',  tags: ['инструмент'] },
    { name: 'гвоздь',       emoji: '📌',  tags: ['крепление'] },
    { name: 'мишень',       emoji: '🎯',  tags: ['цель'] },
    { name: 'магнит',       emoji: '🧲',  tags: ['притяжение'] },
    { name: 'шестерёнка',   emoji: '⚙️',  tags: ['настройка'] },
    { name: 'лупа',         emoji: '🔍',  tags: ['поиск'] },
    { name: 'binoculars',   emoji: '🔭',  tags: ['зрительная'] },
    { name: 'микроскоп',    emoji: '🔬',  tags: ['наука'] },
    { name: 'тестирование', emoji: '🧪',  tags: ['наука', 'химия'] },
    { name: 'лекарство',    emoji: '💊',  tags: ['таблетка'] },
    { name: 'бинт',         emoji: '🩹',  tags: ['больница'] },
    { name: 'термометр',    emoji: '🌡️', tags: ['температура'] },
    { name: 'шприц',        emoji: '💉',  tags: ['укол'] },
    { name: 'стетоскоп',    emoji: '🩺',  tags: ['врач'] },

    // Транспорт
    { name: 'автомобиль',   emoji: '🚗',  tags: ['машина'] },
    { name: 'автобус',      emoji: '🚌',  tags: ['транспорт'] },
    { name: 'самолёт',      emoji: '✈️',  tags: ['полёт'] },
    { name: 'поезд',        emoji: '🚂',  tags: ['железная дорога'] },
    { name: 'велосипед',    emoji: '🚲',  tags: ['велосипед'] },
    { name: 'корабль',      emoji: '🚢',  tags: ['море'] },
    { name: 'ракета',       emoji: '🚀',  tags: ['космос', 'быстро'] },
    { name: 'вертолёт',     emoji: '🚁',  tags: ['полёт'] },
    { name: 'мотор',        emoji: '🏍️', tags: ['мотоцикл'] },

    // Знаки / символы
    { name: 'галочка',      emoji: '✅',  tags: ['готово', 'выполнено', 'да'] },
    { name: 'крестик',      emoji: '❌',  tags: ['нет', 'ошибка', 'удалить'] },
    { name: 'восклицание',  emoji: '❗',  tags: ['важно', 'внимание'] },
    { name: 'вопрос',       emoji: '❓',  tags: ['вопрос'] },
    { name: 'вопросительный', emoji: '❔', tags: ['вопрос'] },
    { name: 'восклицательный', emoji: '❕', tags: ['важно'] },
    { name: 'спасибо',      emoji: 'Thank', tags: [] },
    { name: 'пожалуйста',   emoji: '🙏',  tags: ['прошу'] },
    { name: 'извините',     emoji: '😔',  tags: ['прости'] },
    { name: 'новый',        emoji: '🆕',  tags: ['new'] },
    { name: 'top',          emoji: '🆙',  tags: ['вверх'] },
    { name: 'soon',         emoji: '🔜',  tags: ['скоро'] },
    { name: 'конец',        emoji: '🔚',  tags: ['end'] },
    { name: 'назад',        emoji: '🔙',  tags: ['вернуться'] },
    { name: 'вперёд',       emoji: '🔜',  tags: ['далее'] },

    // Технологии
    { name: 'компьютер',    emoji: '💻',  tags: ['пк', 'ноутбук'] },
    { name: 'телефон',      emoji: '📱',  tags: ['смартфон'] },
    { name: 'клавиатура',   emoji: '⌨️',  tags: ['набор'] },
    { name: 'монитор',      emoji: '🖥️', tags: ['экран'] },
    { name: 'принтер',      emoji: '🖨️', tags: ['печать'] },
    { name: 'камера',       emoji: '📷',  tags: ['фото'] },
    { name: 'видеокамера',  emoji: '📹',  tags: ['видео'] },
    { name: 'флешка',       emoji: '💾',  tags: ['диск'] },
    { name: 'диск',         emoji: '💿',  tags: ['cd'] },
    { name: 'наушники',     emoji: '🎧',  tags: ['звук'] },
    { name: 'микрофон',     emoji: '🎤',  tags: ['звуко'] },
    { name: 'динамик',      emoji: '🔊',  tags: ['звук'] },
    { name: 'колонка',      emoji: '🔈',  tags: ['звук'] },
    { name: 'musical note', emoji: '🎵',  tags: ['музыка'] },
    { name: 'ноты',         emoji: '🎶',  tags: ['музыка'] },
    { name: 'радио',        emoji: '📻',  tags: ['вещание'] },

    // Работа / офис
    { name: 'папка',        emoji: '📁',  tags: ['документ'] },
    { name: 'документ',     emoji: '📄',  tags: ['файл'] },
    { name: 'блокнот',      emoji: '📝',  tags: ['запись'] },
    { name: 'ручка',        emoji: '🖊️', tags: ['писать'] },
    { name: 'карандаш',     emoji: '✏️',  tags: ['писать'] },
    { name: 'маркеры',      emoji: '🖊️', tags: ['цвет'] },
    { name: 'стикер',       emoji: '📌',  tags: ['заметка'] },
    { name: 'скрепка',      emoji: '📎',  tags: ['бумага'] },
    { name: 'порядок',      emoji: '📋',  tags: ['список'] },
    { name: 'калькулятор',  emoji: '🧮',  tags: ['счёт'] },
    { name: 'доска',        emoji: '📊',  tags: ['график'] },
    { name: 'график',       emoji: '📈',  tags: ['рост'] },
    { name: 'презентация',  emoji: '📑',  tags: ['слайд'] },
    { name: 'задача',       emoji: '☑️',  tags: ['чекбокс'] },

    // Спорт / хобби
    { name: 'футбол',      emoji: '⚽',  tags: ['мяч'] },
    { name: 'баскетбол',    emoji: '🏀',  tags: ['мяч'] },
    { name: 'теннис',       emoji: '🎾',  tags: ['мяч'] },
    { name: 'бейсбол',      emoji: '⚾',  tags: ['мяч'] },
    { name: 'гольф',        emoji: '⛳',  tags: ['мяч'] },
    { name: 'хоккей',       emoji: '🏒',  tags: ['шайба'] },
    { name: 'бильярд',      emoji: '🎱',  tags: ['шар'] },
    { name: 'гирлянда',     emoji: '🎄',  tags: ['ёлка'] },
    { name: 'подарок',      emoji: '🎁',  tags: ['подарок'] },
    { name: 'набросок',     emoji: '🎨',  tags: ['рисунок', 'краски'] },
    { name: 'маска',        emoji: '🎭',  tags: ['театр'] },
    { name: 'сцена',        emoji: '🎬',  tags: ['кино'] },
    { name: 'фотоальбом',   emoji: '📸',  tags: ['фото'] },
    { name: 'чемодан',      emoji: '🧳',  tags: ['путешествие'] },
    { name: 'палатка',      emoji: '⛺',  tags: ['поход'] },
    { name: 'рыбалка',      emoji: '🎣',  tags: ['рыба'] },
    { name: 'горы',         emoji: '🏔️', tags: ['природа'] },
    { name: 'пляж',         emoji: '🏖️', tags: ['море'] },
    { name: 'пустыня',      emoji: '🏜️', tags: ['песок'] },

    // Флаги / спецсимволы
    { name: 'белый флаг',   emoji: '🏳️',  tags: ['капитуляция'] },
    { name: 'черный флаг',  emoji: '🏴',  tags: [] },
    { name: 'мир',          emoji: '☮️',  tags: ['peace'] },
    { name: 'янтарь',       emoji: '☯️',  tags: ['баланс'] },
    { name: 'атом',         emoji: '⚛️',  tags: ['наука'] },
    { name: 'безопасность', emoji: '🔰',  tags: ['япония'] },
    { name: 'квадрат',      emoji: '✴️',  tags: ['цветок'] },
    { name: 'спаркл',       emoji: '✨',  tags: ['блеск', 'красиво'] },
    { name: 'глоток',       emoji: '💧',  tags: ['вода', 'капля'] },
    { name: 'бензин',       emoji: '⛽',  tags: ['топливо'] },
    { name: 'колесо',       emoji: '🎡',  tags: ['парк'] },
    { name: 'фонтан',       emoji: '⛲',  tags: ['вода'] },
    { name: 'крест',        emoji: '⛪',  tags: ['церковь'] },
    { name: 'храм',         emoji: '🛕',  tags: ['религия'] },
    { name: 'мечеть',       emoji: '🕌',  tags: ['религия'] },
    { name: 'синагога',     emoji: '🕍',  tags: ['религия'] },
    { name: 'город',        emoji: '🏙️', tags: ['здание'] },
    { name: 'мост',         emoji: '🌉',  tags: ['город'] },
    { name: 'подсветка',    emoji: '💡',  tags: ['идея', 'лампа'] },
    { name: 'фонарь',       emoji: '🏮',  tags: ['свет'] },
    { name: 'свеча',        emoji: '🕯️', tags: ['свет'] },
    { name: 'колокольчик',  emoji: '🔔',  tags: ['звук'] },
    { name: 'колокол',      emoji: '🔕',  tags: ['тишина'] },
    { name: 'связь',        emoji: '🔗',  tags: ['ссылка'] },
    { name: 'крючок',       emoji: '🪝',  tags: ['ловить'] },
    { name: 'ловушка',      emoji: '🪤',  tags: ['ловушка'] },
  ];

  /* ── CSS ───────────────────────────────────────────────────────── */
  const CSS = `
.emoji-palette {
  position: fixed; z-index: 10000;
  width: min(220px, calc(100vw - 16px));
  max-height: min(280px, calc(100vh - 18px));
  padding: 5px; border: 1px solid rgba(0,185,107,0.24);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg3) 92%, transparent);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.04) inset;
  overflow-y: auto; overscroll-behavior: contain;
  animation: emojiDropIn 0.15s cubic-bezier(.16,1,.3,1);
}
@keyframes emojiDropIn {
  from { opacity: 0; transform: translateY(-8px) scale(0.97); }
  to   { opacity: 1; transform: none; }
}
.emoji-item {
  display: flex; align-items: center; gap: 8px;
  min-height: 30px; padding: 5px 10px;
  border: 1px solid transparent; border-radius: 8px;
  background: transparent; cursor: pointer;
  font-family: inherit; font-size: 12px; font-weight: 500;
  color: var(--text1); text-align: left; width: 100%;
  transition: background var(--trans), color var(--trans), border-color var(--trans);
}
.emoji-item:hover { background: var(--surface2); color: var(--text0); border-color: var(--border); }
.emoji-item.focused {
  background: linear-gradient(90deg, rgba(0,185,107,0.34), rgba(0,185,107,0.16));
  color: #fff; border-color: rgba(0,185,107,0.58);
  box-shadow: 0 0 0 1px rgba(0,185,107,0.16) inset, 0 4px 14px rgba(0,185,107,0.12);
}
.emoji-char {
  font-size: 18px; width: 26px; text-align: center;
  flex-shrink: 0; line-height: 1;
}
.emoji-name {
  flex: 1; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.emoji-palette:empty::after {
  content: 'Ничего не найдено';
  display: block; padding: 10px; text-align: center;
  color: var(--text3); font-size: 11px;
}
.emoji-footer {
  border-top: 1px solid rgba(148,163,184,0.14);
  padding: 4px 8px; text-align: center;
  color: var(--text3); font-size: 10px;
}
@media (prefers-reduced-motion: reduce) {
  .emoji-palette { animation: none !important; }
}`;

  /* ── STATE ─────────────────────────────────────────────────────── */
  let _palette = null;
  let _ta = null;
  let _triggerStart = -1;
  let _focusedIdx = 0;
  let _filtered = [];
  let _wrapHold = '';

  /* ── INIT ──────────────────────────────────────────────────────── */
  const _style = document.createElement('style');
  _style.textContent = CSS;
  document.head.appendChild(_style);

  /* ── FILTER ────────────────────────────────────────────────────── */
  function _filter(query) {
    const q = (query || '').toLowerCase();
    if (!q) return [];
    const scored = [];
    for (let i = 0; i < EMOJI_DATA.length; i++) {
      const e = EMOJI_DATA[i];
      const name = e.name.toLowerCase();
      let rank = -1;
      if (name === q) rank = 0;
      else if (name.startsWith(q)) rank = 1;
      else if (name.includes(q)) rank = 2;
      else if (e.tags && e.tags.some(t => t.toLowerCase().includes(q))) rank = 3;
      if (rank >= 0) scored.push({ e, rank, idx: i });
    }
    scored.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
    return scored.slice(0, 10);
  }

  /* ── CLOSE ─────────────────────────────────────────────────────── */
  function _close() {
    if (_palette) { _palette.remove(); _palette = null; }
    _ta = null; _triggerStart = -1; _focusedIdx = 0; _filtered = []; _wrapHold = '';
  }

  /* ── RENDER ────────────────────────────────────────────────────── */
  function _render(ta, query) {
    _filtered = _filter(query);
    if (!_filtered.length) { _close(); return; }

    if (!_palette) {
      _palette = document.createElement('div');
      _palette.className = 'emoji-palette';
      _palette.setAttribute('role', 'listbox');
      _palette.setAttribute('aria-label', 'Эмодзи');
      document.body.appendChild(_palette);
    }
    _palette.innerHTML = '';
    _ta = ta;
    _focusedIdx = 0;

    for (let i = 0; i < _filtered.length; i++) {
      const item = _filtered[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-item' + (i === 0 ? ' focused' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.innerHTML = '<span class="emoji-char" aria-hidden="true">' + item.e.emoji + '</span>'
        + '<span class="emoji-name">' + _escHtml(item.e.name) + '</span>';
      btn.addEventListener('mousedown', ev => { ev.preventDefault(); _insert(i); });
      _palette.appendChild(btn);
    }

    const footer = document.createElement('div');
    footer.className = 'emoji-footer';
    footer.textContent = '↑↓ · Enter · Esc';
    _palette.appendChild(footer);

    _position(ta);
  }

  /* ── POSITION (clone-measure) ──────────────────────────────────── */
  function _position(ta) {
    if (!_palette || !_ta) return;

    const cs = getComputedStyle(ta);
    const pl = parseFloat(cs.paddingLeft) || 0;
    const pr = parseFloat(cs.paddingRight) || 0;
    const pt = parseFloat(cs.paddingTop) || 0;
    const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.4);
    const pos = ta.selectionStart;

    /* clone */
    const clone = document.createElement('div');
    clone.style.cssText = 'position:absolute;visibility:hidden;top:-9999px;left:-9999px;'
      + 'font:' + cs.font + ';white-space:pre-wrap;word-wrap:break-word;'
      + 'width:' + (ta.clientWidth - pl - pr) + 'px;'
      + 'padding:' + cs.padding + ';line-height:' + cs.lineHeight + ';'
      + 'letter-spacing:' + cs.letterSpacing + ';';

    const textBefore = ta.value.slice(0, pos);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    clone.appendChild(document.createTextNode(textBefore));
    clone.appendChild(marker);
    document.body.appendChild(clone);

    const mkR = marker.getBoundingClientRect();
    const taR = ta.getBoundingClientRect();
    const scrollEl = ta.closest('.llm-tab-panel') || ta.closest('.modal-body') || ta;
    const ox = taR.left - clone.getBoundingClientRect().left - ta.scrollLeft;
    const oy = taR.top - clone.getBoundingClientRect().top - scrollEl.scrollTop;

    let cx = mkR.left + ox;
    let cy = mkR.top + oy + lh + 4;

    clone.remove();

    _palette.style.left = cx + 'px';
    _palette.style.top = cy + 'px';

    requestAnimationFrame(() => {
      if (!_palette) return;
      const pw = _palette.offsetWidth || 220;
      const ph = _palette.offsetHeight || 200;
      if (cx + pw > window.innerWidth - 8) cx = Math.max(4, window.innerWidth - pw - 8);
      if (cy + ph > window.innerHeight - 8) cy = Math.max(4, cy - lh - ph - 8);
      _palette.style.left = cx + 'px';
      _palette.style.top = cy + 'px';
    });
  }

  /* ── INSERT ────────────────────────────────────────────────────── */
  function _insert(idx) {
    const item = _filtered[idx];
    if (!_ta || !item) return;
    const pos = _ta.selectionStart;
    _ta.setRangeText(item.e.emoji + ' ', _triggerStart, pos, 'end');
    _ta.dispatchEvent(new Event('input'));
    _close();
    _ta.focus();
  }

  /* ── NAV ────────────────────────────────────────────────────────── */
  function _focusRow(idx) {
    if (!_palette) return;
    const rows = _palette.querySelectorAll('.emoji-item');
    if (!rows.length) return;
    rows.forEach((r, i) => {
      const active = i === idx;
      r.classList.toggle('focused', active);
      r.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) r.scrollIntoView({ block: 'nearest' });
    });
    _focusedIdx = idx;
  }

  /* ── TRIGGER DETECTION ─────────────────────────────────────────── */
  function _handleInput(ta) {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const m = before.match(/(^|[\n\s]):([^\s\n:]{1,})$/);
    if (m) {
      const query = m[2].toLowerCase();
      _triggerStart = pos - m[2].length - 1;
      _render(ta, query);
    } else {
      if (_palette) _close();
    }
  }

  /* ── ESCAPE ────────────────────────────────────────────────────── */
  function _escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── GLOBAL EVENTS ─────────────────────────────────────────────── */
  document.addEventListener('input', e => {
    if (e.target && e.target.tagName === 'TEXTAREA') _handleInput(e.target);
  }, true);

  document.addEventListener('click', e => {
    if (_palette && !_palette.contains(e.target)) _close();
  });

  document.addEventListener('keydown', e => {
    if (!_palette || !_ta) return;
    const rows = _palette.querySelectorAll('.emoji-item');
    const count = rows.length;
    if (!count) return;

    const key = e.key;
    if (key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      const next = _focusedIdx + 1;
      if (next >= count) {
        if (_wrapHold === 'down') { _focusRow(0); _wrapHold = ''; }
        else { _focusRow(count - 1); _wrapHold = 'down'; }
      } else { _focusRow(next); _wrapHold = ''; }
    } else if (key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      const prev = _focusedIdx - 1;
      if (prev < 0) {
        if (_wrapHold === 'up') { _focusRow(count - 1); _wrapHold = ''; }
        else { _focusRow(0); _wrapHold = 'up'; }
      } else { _focusRow(prev); _wrapHold = ''; }
    } else if (key === 'Enter' || key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      _insert(_focusedIdx);
    } else if (key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      _close();
    }
  }, true);

})();
