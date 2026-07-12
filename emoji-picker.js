/* ================================================================
   Emoji Picker — вставка эмодзи по ":" в textarea
   Минималистичный, зелёный accent, русские названия.
   ================================================================ */
(function () {
  'use strict';

  /* ── DATA ──────────────────────────────────────────────────────── */
  const EMOJI_DATA = [
    // Улыбки / эмоции
    { name: 'улыбка',       emoji: '😊',  tags: ['смех', 'радость', 'счастлив'], aliases: ['smile', 'happy'] },
    { name: 'широкая улыбка', emoji: '😃', tags: ['улыбка', 'зубы'] },
    { name: 'смех',         emoji: '😆',  tags: ['хохот', 'смешно', 'улыбка'] },
    { name: 'веселье',      emoji: '😁',  tags: ['зубы', 'улыбка'] },
    { name: 'подмигивание', emoji: '😉',  tags: ['глаз'] },
    { name: 'благодарность', emoji: '🙏', tags: ['спасибо', 'молитва', 'ладони'] },
    { name: 'объятие',      emoji: '🤗',  tags: ['обнять', 'тёплый'] },
    { name: 'задумчивость', emoji: '🤔', tags: ['думаю', 'вопрос'] },
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
    { name: 'робот',        emoji: '🤖',  tags: ['механизм'], aliases: ['robot'] },

    // Руки / жесты
    { name: 'класс',        emoji: '👍',  tags: ['лайк', 'ок', 'отлично'], aliases: ['like', 'thumbsup', 'thumbs'] },
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
    { name: 'сердце',       emoji: '❤️',  tags: ['любовь', 'красное'], aliases: ['love', 'heart'] },
    { name: 'оранжевое сердце', emoji: '🧡', tags: ['оранжевый'] },
    { name: 'жёлтое сердце', emoji: '💛', tags: ['жёлтый'] },
    { name: 'зелёное сердце', emoji: '💚', tags: ['зелёный'] },
    { name: 'синее сердце', emoji: '💙',  tags: ['синий'] },
    { name: 'фиолетовое сердце', emoji: '💜', tags: ['фиолетовый'] },
    { name: 'чёрное сердце', emoji: '🖤', tags: ['чёрный'] },
    { name: 'белое сердце', emoji: '🤍',  tags: ['белый'] },
    { name: 'разбитое сердце', emoji: '💔', tags: ['печаль', 'разрыв'] },
    { name: 'подарок',      emoji: '🎁',  tags: ['подарок', 'сюрприз'], aliases: ['gift', 'present'] },
    { name: 'ленточка',     emoji: '🎀',  tags: ['бантик'] },

    // Природа
    { name: 'солнце',       emoji: '☀️',  tags: ['погода', 'тёплый'], aliases: ['sun', 'sunny'] },
    { name: 'луна',         emoji: '🌙',  tags: ['ночь'], aliases: ['moon'] },
    { name: 'звезда',       emoji: '⭐',  tags: ['сияние'], aliases: ['star'] },
    { name: 'огонь',        emoji: '🔥',  tags: ['жар', 'горячо'], aliases: ['fire', 'hot', 'flame'] },
    { name: 'молния',       emoji: '⚡',  tags: ['электричество'] },
    { name: 'радуга',       emoji: '🌈',  tags: ['цвет'] },
    { name: 'цветок',       emoji: '🌸',  tags: ['цветение', 'красиво'], aliases: ['flower', 'sakura'] },
    { name: 'роза',         emoji: '🌹',  tags: ['красная'] },
    { name: 'подсолнух',    emoji: '🌻',  tags: ['жёлтый'] },
    { name: 'дерево',       emoji: '🌳',  tags: ['природа'] },
    { name: 'ёлка',         emoji: '🎄',  tags: ['новый год', 'праздник'] },
    { name: 'листья',       emoji: '🍂',  tags: ['осень'] },
    { name: 'снег',         emoji: '❄️',  tags: ['зима', 'холодно'] },
    { name: 'облако',       emoji: '☁️',  tags: ['небо'] },
    { name: 'дождь',        emoji: '🌧️', tags: ['вода'] },
    { name: 'океан',        emoji: '🌊',  tags: ['вода', 'море'] },
    { name: 'гроза',        emoji: '🌩️', tags: ['молния', 'дождь'] },
    { name: 'туман',        emoji: '🌫️', tags: ['облако'] },

    // Еда
    { name: 'кофе',         emoji: '☕',  tags: ['напиток', 'чай'] },
    { name: 'пицца',        emoji: '🍕',  tags: ['еда'], aliases: ['pizza'] },
    { name: 'бургер',       emoji: '🍔',  tags: ['еда'], aliases: ['burger'] },
    { name: 'пончик',       emoji: '🍩',  tags: ['сладкое'] },
    { name: 'торт',         emoji: '🎂',  tags: ['день рождения', 'праздник'], aliases: ['cake', 'birthday'] },
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
    { name: 'собака',       emoji: '🐶',  tags: ['пёс', 'животное'], aliases: ['dog'] },
    { name: 'кошка',        emoji: '🐱',  tags: ['кот', 'животное'], aliases: ['cat'] },
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
    { name: 'кристалл',     emoji: '🔮',  tags: ['магия', 'шар'], aliases: ['crystal', 'magic'] },
    { name: 'алмаз',        emoji: '💎',  tags: ['драгоценность'] },
    { name: 'монета',       emoji: '💰',  tags: ['деньги'] },
    { name: 'сумка',        emoji: '👛',  tags: ['кошелёк'] },
    { name: 'часы',         emoji: '⏰',  tags: ['время'] },
    { name: 'замок',        emoji: '🔒',  tags: ['закрытый', 'безопасность'], aliases: ['lock', 'secure'] },
    { name: 'ключ',         emoji: '🔑',  tags: ['открыть'], aliases: ['key'] },
    { name: 'ножницы',      emoji: '✂️',  tags: ['резать'] },
    { name: 'молоток',      emoji: '🔨',  tags: ['инструмент'] },
    { name: 'гвоздь',       emoji: '📌',  tags: ['крепление', 'заметка'] },
    { name: 'мишень',       emoji: '🎯',  tags: ['цель'], aliases: ['target', 'goal'] },
    { name: 'магнит',       emoji: '🧲',  tags: ['притяжение'] },
    { name: 'шестерёнка',   emoji: '⚙️',  tags: ['настройка'], aliases: ['gear', 'settings'] },
    { name: 'лупа',         emoji: '🔍',  tags: ['поиск', 'исследование'], aliases: ['search', 'analysis'] },
    { name: 'binoculars',   emoji: '🔭',  tags: ['зрительная'] },
    { name: 'микроскоп',    emoji: '🔬',  tags: ['наука'] },
    { name: 'тестирование', emoji: '🧪',  tags: ['наука', 'химия'] },
    { name: 'лекарство',    emoji: '💊',  tags: ['таблетка'] },
    { name: 'бинт',         emoji: '🩹',  tags: ['больница'] },
    { name: 'термометр',    emoji: '🌡️', tags: ['температура'] },
    { name: 'шприц',        emoji: '💉',  tags: ['укол'] },
    { name: 'стетоскоп',    emoji: '🩺',  tags: ['врач'] },

    // Транспорт
    { name: 'автомобиль',   emoji: '🚗',  tags: ['машина'], aliases: ['car'] },
    { name: 'автобус',      emoji: '🚌',  tags: ['транспорт'] },
    { name: 'самолёт',      emoji: '✈️',  tags: ['полёт'], aliases: ['plane', 'flight'] },
    { name: 'поезд',        emoji: '🚂',  tags: ['железная дорога'] },
    { name: 'велосипед',    emoji: '🚲',  tags: ['велосипед'] },
    { name: 'корабль',      emoji: '🚢',  tags: ['море'] },
    { name: 'ракета',       emoji: '🚀',  tags: ['космос', 'быстро'], aliases: ['rocket', 'space'] },
    { name: 'вертолёт',     emoji: '🚁',  tags: ['полёт'] },
    { name: 'мотор',        emoji: '🏍️', tags: ['мотоцикл'] },

    // Знаки / символы
    { name: 'галочка',      emoji: '✅',  tags: ['готово', 'выполнено', 'да'], aliases: ['done', 'check', 'success'] },
    { name: 'крестик',      emoji: '❌',  tags: ['нет', 'ошибка', 'удалить'], aliases: ['cross', 'delete'] },
    { name: 'восклицание',  emoji: '❗',  tags: ['важно', 'внимание'] },
    { name: 'вопрос',       emoji: '❓',  tags: ['вопрос'] },
    { name: 'вопросительный', emoji: '❔', tags: ['вопрос'] },
    { name: 'восклицательный', emoji: '❕', tags: ['важно'] },
    { name: 'мольба-ладони', emoji: '🤲',  tags: ['ладони', 'молитва'] },
    { name: 'пожалуйста',   emoji: '🥹',  tags: ['прошу'], aliases: ['please'] },
    { name: 'извините',     emoji: '😔',  tags: ['прости'], aliases: ['sorry'] },
    { name: 'новый',        emoji: '🆕',  tags: ['new'] },
    { name: 'top',          emoji: '🆙',  tags: ['вверх'] },
    { name: 'soon',         emoji: '🔜',  tags: ['скоро'] },
    { name: 'конец',        emoji: '🔚',  tags: ['end'] },
    { name: 'назад',        emoji: '🔙',  tags: ['вернуться'] },
    { name: 'вперёд',       emoji: '⏩',  tags: ['далее'] },

    // Технологии
    { name: 'компьютер',    emoji: '💻',  tags: ['пк', 'ноутбук', 'программирование'], aliases: ['computer', 'laptop', 'code'] },
    { name: 'телефон',      emoji: '📱',  tags: ['смартфон'], aliases: ['phone', 'mobile'] },
    { name: 'клавиатура',   emoji: '⌨️',  tags: ['набор'] },
    { name: 'монитор',      emoji: '🖥️', tags: ['экран'] },
    { name: 'принтер',      emoji: '🖨️', tags: ['печать'] },
    { name: 'камера',       emoji: '📷',  tags: ['фото'], aliases: ['camera', 'photo'] },
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
    { name: 'папка',        emoji: '📁',  tags: ['документ'], aliases: ['folder'] },
    { name: 'документ',     emoji: '📄',  tags: ['файл'], aliases: ['file', 'document'] },
    { name: 'блокнот',      emoji: '📝',  tags: ['запись'], aliases: ['note', 'notepad'] },
    { name: 'ручка',        emoji: '🖊️', tags: ['писать', 'маркер', 'цвет'] },
    { name: 'карандаш',     emoji: '✏️',  tags: ['писать'] },
    { name: 'стикер',       emoji: '🗒️',  tags: ['заметка'] },
    { name: 'скрепка',      emoji: '📎',  tags: ['бумага'] },
    { name: 'порядок',      emoji: '📋',  tags: ['список'], aliases: ['clipboard', 'list'] },
    { name: 'калькулятор',  emoji: '🧮',  tags: ['счёт'] },
    { name: 'доска',        emoji: '📊',  tags: ['график'] },
    { name: 'график',       emoji: '📈',  tags: ['рост'], aliases: ['chart', 'growth'] },
    { name: 'презентация',  emoji: '📑',  tags: ['слайд'] },
    { name: 'задача',       emoji: '☑️',  tags: ['чекбокс'], aliases: ['task', 'todo'] },

    // Спорт / хобби
    { name: 'футбол',      emoji: '⚽',  tags: ['мяч'], aliases: ['soccer'] },
    { name: 'баскетбол',    emoji: '🏀',  tags: ['мяч'] },
    { name: 'теннис',       emoji: '🎾',  tags: ['мяч'] },
    { name: 'бейсбол',      emoji: '⚾',  tags: ['мяч'] },
    { name: 'гольф',        emoji: '⛳',  tags: ['мяч'] },
    { name: 'хоккей',       emoji: '🏒',  tags: ['шайба'] },
    { name: 'бильярд',      emoji: '🎱',  tags: ['шар'] },
    { name: 'набросок',     emoji: '🎨',  tags: ['рисунок', 'краски'], aliases: ['art', 'palette'] },
    { name: 'маска',        emoji: '🎭',  tags: ['театр'] },
    { name: 'сцена',        emoji: '🎬',  tags: ['кино'], aliases: ['movie', 'cinema'] },
    { name: 'фотоальбом',   emoji: '📸',  tags: ['фото'] },
    { name: 'чемодан',      emoji: '🧳',  tags: ['путешествие'], aliases: ['luggage', 'travel'] },
    { name: 'палатка',      emoji: '⛺',  tags: ['поход'], aliases: ['tent', 'camp'] },
    { name: 'рыбалка',      emoji: '🎣',  tags: ['рыба'], aliases: ['fish', 'fishing'] },
    { name: 'горы',         emoji: '🏔️', tags: ['природа'], aliases: ['mountain'] },
    { name: 'пляж',         emoji: '🏖️', tags: ['море'], aliases: ['beach'] },
    { name: 'пустыня',      emoji: '🏜️', tags: ['песок'], aliases: ['desert'] },

    // Флаги / спецсимволы
    { name: 'белый флаг',   emoji: '🏳️',  tags: ['капитуляция'] },
    { name: 'черный флаг',  emoji: '🏴',  tags: [] },
    { name: 'мир',          emoji: '☮️',  tags: ['peace'] },
    { name: 'янтарь',       emoji: '☯️',  tags: ['баланс'] },
    { name: 'атом',         emoji: '⚛️',  tags: ['наука'] },
    { name: 'безопасность', emoji: '🔰',  tags: ['япония'] },
    { name: 'квадрат',      emoji: '✴️',  tags: ['цветок'] },
    { name: 'спаркл',       emoji: '✨',  tags: ['блеск', 'красиво'], aliases: ['sparkle', 'shine'] },
    { name: 'глоток',       emoji: '💧',  tags: ['вода', 'капля'] },
    { name: 'бензин',       emoji: '⛽',  tags: ['топливо'] },
    { name: 'колесо',       emoji: '🎡',  tags: ['парк'], aliases: ['ferris', 'wheel'] },
    { name: 'фонтан',       emoji: '⛲',  tags: ['вода'], aliases: ['fountain'] },
    { name: 'крест',        emoji: '⛪',  tags: ['церковь'] },
    { name: 'храм',         emoji: '🛕',  tags: ['религия'], aliases: ['temple'] },
    { name: 'мечеть',       emoji: '🕌',  tags: ['религия'] },
    { name: 'синагога',     emoji: '🕍',  tags: ['религия'] },
    { name: 'город',        emoji: '🏙️', tags: ['здание'], aliases: ['city'] },
    { name: 'мост',         emoji: '🌉',  tags: ['город'], aliases: ['bridge'] },
    { name: 'подсветка',    emoji: '💡',  tags: ['идея', 'лампа'], aliases: ['idea', 'light'] },
    { name: 'фонарь',       emoji: '🏮',  tags: ['свет'], aliases: ['lantern'] },
    { name: 'свеча',        emoji: '🕯️', tags: ['свет'], aliases: ['candle'] },
    { name: 'колокольчик',  emoji: '🔔',  tags: ['звук'], aliases: ['bell', 'ring'] },
    { name: 'колокол',      emoji: '🔕',  tags: ['тишина'] },
    { name: 'связь',        emoji: '🔗',  tags: ['ссылка'], aliases: ['link', 'chain'] },
    { name: 'крючок',       emoji: '🪝',  tags: ['ловить'], aliases: ['hook'] },
    { name: 'ловушка',      emoji: '🪤',  tags: ['ловушка'] },

    // AI / разработка
    { name: 'ai',           emoji: '🤖',  tags: ['искусственный интеллект', 'нейросеть'], aliases: ['ai'] },
    { name: 'мозг',         emoji: '🧠',  tags: ['мышление'], aliases: ['brain'] },
    { name: 'данные',       emoji: '🧬',  tags: ['данные', 'генетика'], aliases: ['data'] },
    { name: 'инструмент',   emoji: '🛠',  tags: ['текущий инструмент'], aliases: ['tool'] },
    { name: 'баг',          emoji: '🐛',  tags: ['ошибка', 'жук'], aliases: ['bug'] },
    { name: 'разработка',   emoji: '🚧',  tags: ['в работе'], aliases: ['build', 'dev'] },
    { name: 'настройка',     emoji: '🔧',  tags: ['гаечный ключ'], aliases: ['setting', 'config'] },
    { name: 'код',          emoji: '⌨️',  tags: ['программирование', 'код'], aliases: ['coding'] },
    { name: 'деплой',       emoji: '🚀',  tags: ['развёртывание'], aliases: ['deploy', 'release'] },

    // Prompt / текст
    { name: 'промпт',       emoji: '📝',  tags: ['запрос', 'текст'], aliases: ['prompt'] },
    { name: 'анализ',       emoji: '📊',  tags: ['данные', 'статистика'], aliases: ['analysis'] },
    { name: 'предупреждение', emoji: '⚠️', tags: ['внимание'], aliases: ['warning', 'caution'] },

    // Статусы
    { name: 'активно',      emoji: '🟢',  tags: ['включено', 'активен'], aliases: ['active', 'on'] },
    { name: 'ожидание',     emoji: '🟡',  tags: ['пауза', 'ожидание'], aliases: ['pending', 'wait'] },
    { name: 'ошибка',       emoji: '🔴',  tags: ['стоп', 'ошибка'], aliases: ['error', 'stop'] },
    { name: 'процесс',      emoji: '⏳',  tags: ['загрузка', 'выполняется'], aliases: ['loading', 'process'] },

    // ── Команды: навигация ──────────────────────────────────────────
    { type: 'command', name: 'настройки',       emoji: '⚙️',  tags: ['настройки', 'профиль'],  aliases: ['settings', 'config'],
      action: () => window.LLMCore?.LLMSettingsModal?.open('profiles') },
    { type: 'command', name: 'промпты',         emoji: '📝',  tags: ['системные промпты'],     aliases: ['prompts'],
      action: () => window.LLMCore?.LLMSettingsModal?.open('prompts') },
    { type: 'command', name: 'бро-теги',        emoji: '🏷️',  tags: ['бро', 'теги'],           aliases: ['bro', 'tags'],
      action: () => window.LLMCore?.LLMSettingsModal?.open('bro') },
    { type: 'command', name: 'автопоэт',        emoji: '🎵',  tags: ['автопоэт'],              aliases: ['autopoet', 'poet'],
      action: () => window.LLMCore?.LLMSettingsModal?.open('autopoet') },
    { type: 'command', name: 'разное',          emoji: '🔧',  tags: ['настройки разное'],      aliases: ['misc'],
      action: () => window.LLMCore?.LLMSettingsModal?.open('misc') },

    // ── Команды: блоки ──────────────────────────────────────────────
    { type: 'command', name: 'текстовый блок',  emoji: '📝',  tags: ['текст', 'блок'],          aliases: ['text', 'block'],
      action: () => window.State?.addBlock('text') },
    { type: 'command', name: 'сниппеты',        emoji: '💬',  tags: ['шаблоны', 'фрагменты'],   aliases: ['snippets'],
      action: () => window.State?.addBlock('snippets') },
    { type: 'command', name: 'группа',          emoji: '📁',  tags: ['папка', 'коллекция'],     aliases: ['group', 'folder'],
      action: () => window.State?.addBlock('group') },
    { type: 'command', name: 'переменная',      emoji: '🔤',  tags: ['var', 'переменная'],      aliases: ['variable', 'var'],
      action: () => window.State?.addBlock('variable') },
    { type: 'command', name: 'заметка',         emoji: '📌',  tags: ['sticky', 'заметка'],      aliases: ['sticky', 'note'],
      action: () => window.State?.addBlock('sticky') },
    { type: 'command', name: 'чеклист',         emoji: '☑️',  tags: ['todo', 'список'],         aliases: ['todo', 'checklist'],
      action: () => window.State?.addBlock('todo') },
    { type: 'command', name: 'таблица',         emoji: '📊',  tags: ['table', 'таблица'],       aliases: ['table'],
      action: () => window.State?.addBlock('table') },
  ];

  /* ── ДЕДУПЛИКАЦИЯ (слияние tags/aliases при коллизии emoji) ─────── */
  const _cmdSeen = new Set();
  const EMOJI_UNIQUE = [];
  const _byEmoji = new Map();
  for (const e of EMOJI_DATA) {
    if (e.type === 'command') {
      if (_cmdSeen.has(e.name)) continue;
      _cmdSeen.add(e.name);
      EMOJI_UNIQUE.push(e);
      continue;
    }
    const dup = _byEmoji.get(e.emoji);
    if (dup) {
      dup.tags = [...new Set([...(dup.tags || []), ...(e.tags || [])])];
      dup.aliases = [...new Set([...(dup.aliases || []), ...(e.aliases || [])])];
    } else {
      _byEmoji.set(e.emoji, e);
      EMOJI_UNIQUE.push(e);
    }
  }

  /* ── CSS ───────────────────────────────────────────────────────── */
  const CSS = `
.emoji-palette {
  position: fixed; z-index: 10000;
  max-width: min(520px, calc(100vw - 16px));
  max-height: min(360px, calc(100vh - 18px));
  padding: 5px; border: 1px solid rgba(0,185,107,0.24);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg3) 92%, transparent);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.04) inset;
  overflow-y: auto; overscroll-behavior: contain;
  scrollbar-width: none; -ms-overflow-style: none;
  animation: emojiDropIn 0.18s cubic-bezier(.34,1.56,.64,1);
  will-change: transform;
  transition: left 0.08s ease, top 0.08s ease;
}
.emoji-palette::-webkit-scrollbar { display: none; }
@keyframes emojiDropIn {
  from { opacity: 0; transform: translateY(4px) scale(0.96); }
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
  animation: rowIn 0.14s ease both;
}
@keyframes rowIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
.emoji-item:hover { background: var(--surface2); color: var(--text0); border-color: var(--border); }
.emoji-item:active { transform: scale(0.94); }
.emoji-item:hover .emoji-char { transform: scale(1.35) rotate(-5deg); }
.emoji-item.focused {
  background: linear-gradient(90deg, rgba(0,185,107,0.34), rgba(0,185,107,0.16));
  color: #fff; border-color: rgba(0,185,107,0.58);
  box-shadow: 0 0 0 1px rgba(0,185,107,0.16) inset, 0 4px 14px rgba(0,185,107,0.12);
}
.emoji-char {
  font-size: 18px; width: 26px; text-align: center;
  flex-shrink: 0; line-height: 1;
  transition: transform 0.15s, filter 0.15s;
}
.emoji-name {
  flex: 1; min-width: 0;
  white-space: nowrap;
}

.emoji-footer {
  border-top: 1px solid rgba(148,163,184,0.14);
  padding: 4px 8px; text-align: center;
  color: var(--text3); font-size: 10px;
}
@media (prefers-reduced-motion: reduce) {
  .emoji-palette { animation: none !important; }
}
.emoji-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 6px;
  padding: 18px 12px; color: var(--text3); font-size: 11px;
}
.emoji-empty-icon { font-size: 22px; opacity: 0.5; }
.emoji-item[data-type="command"] .emoji-name::after {
  content: ''; display: inline-block; width: 12px; height: 12px; margin-left: 6px;
  background: #4f8ef7;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.5'%3E%3Cpath d='M5 12h14M12 5l7 7-7 7'/%3E%3C/svg%3E") center/contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.5'%3E%3Cpath d='M5 12h14M12 5l7 7-7 7'/%3E%3C/svg%3E") center/contain no-repeat;
}
`;

  /* ── STATE ─────────────────────────────────────────────────────── */
  let _palette = null;
  let _ta = null;
  let _triggerStart = -1;
  let _focusedIdx = 0;
  let _filtered = [];
  let _wrapHold = '';
  const _idRoot = 'emoji-p-' + Math.random().toString(36).slice(2, 8);

  /* ── CATEGORIES ────────────────────────────────────────────────── */
  const CATEGORIES = [
    { label: 'Эмоции',     emojis: ['😊','😃','😆','😁','😉','🤗','🤔','😐','😴','😱','🤩','😢','😭','😎','💀'] },
    { label: 'Руки',       emojis: ['👍','👎','👌','✌️','🤘','👆','👇','🤝','🙏','🙌','🫂','🫶'] },
    { label: 'Сердца',     emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔'] },
    { label: 'Животные',   emojis: ['🐶','🐱','🐻','🐼','🦁','🐰','🦊','🐺','🐧','🐦','🦋','🐸'] },
    { label: 'Еда',        emojis: ['☕','🍕','🍔','🍩','🎂','🍪','🍫','🍦','🍎','🍌','🍇','🍓'] },
    { label: 'Технологии', emojis: ['💻','📱','⌨️','🖥️','📷','💾','🎧','🎤','🔊'] },
    { label: 'Транспорт',  emojis: ['🚗','🚌','✈️','🚂','🚲','🚢','🚀','🚁'] },
    { label: 'AI/Код',     emojis: ['🤖','🧠','🧬','🐛','🔧','📝','🔍','⚠️','✅','❌','⏳'] },
  ];

  /* ── RECENTS (localStorage, frequency-weighted, cached) ─────────── */
  const RECENTS_KEY = 'emoji-picker:recents';
  const RECENTS_TTL = 1500;
  let _recentsCache = null;
  let _recentsCacheTime = 0;
  function _loadRecents() {
    const now = Date.now();
    if (_recentsCache && now - _recentsCacheTime < RECENTS_TTL) return _recentsCache;
    try {
      const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
      _recentsCache = raw.map(x => typeof x === 'string' ? { emoji: x, count: 1, last: 0 } : x);
    } catch { _recentsCache = []; }
    _recentsCacheTime = now;
    return _recentsCache;
  }
  function _pushRecent(emoji) {
    const list = _loadRecents();
    const item = list.find(x => x.emoji === emoji);
    if (item) { item.count++; item.last = Date.now(); }
    else { list.push({ emoji, count: 1, last: Date.now() }); }
    list.sort((a, b) => (b.count * 10 + b.last / 1e6) - (a.count * 10 + a.last / 1e6));
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 20))); } catch (_) {}
    _recentsCache = null;
  }

  /* ── CANVAS MEASURE (с кешем) ──────────────────────────────────── */
  const _widthCache = new Map();
  const _measureWidth = (() => {
    const ctx = document.createElement('canvas').getContext('2d');
    return (text, font) => {
      let m = _widthCache.get(font);
      if (!m) { m = new Map(); _widthCache.set(font, m); }
      if (m.has(text)) return m.get(text);
      ctx.font = font;
      const w = ctx.measureText(text).width;
      m.set(text, w);
      return w;
    };
  })();

  /* ── INIT ──────────────────────────────────────────────────────── */
  function _normalize(s) {
    return (s || '').toLowerCase()
      .replace(/ё/g, 'е').replace(/й/g, 'и')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }

  if (!document.getElementById('emoji-picker-style')) {
    const _style = document.createElement('style');
    _style.id = 'emoji-picker-style';
    _style.textContent = CSS;
    document.head.appendChild(_style);
  }

  /* ── FILTER ────────────────────────────────────────────────────── */
  const PRIORITY = { NAME_EXACT: 0, TAG_EXACT: 1, ALIAS_EXACT: 2, EMOJI_EXACT: 3, NAME_PREFIX: 4, TAG_PREFIX: 5, ALIAS_PREFIX: 6, ACRONYM: 7, NAME_INCLUDES: 8, TAG_INCLUDES: 9, ALIAS_INCLUDES: 10, FUZZY: 11 };
  function _fuzzy(q, text) {
    let qi = 0;
    for (let i = 0; i < text.length && qi < q.length; i++)
      if (text[i] === q[qi]) qi++;
    return qi === q.length;
  }
  const _EMOJI_INDEX = new Map(EMOJI_UNIQUE.map(e => [e.emoji, e]));
  for (const e of EMOJI_UNIQUE) {
    e._nameN = _normalize(e.name);
    e._tagsN = (e.tags || []).map(t => _normalize(t));
    e._aliasesN = (e.aliases || []).map(a => _normalize(a));
  }
  function _usageScore(emoji) {
    const item = _loadRecents().find(x => x.emoji === emoji);
    return item ? item.count : 0;
  }
  function _filter(query) {
    const q = _normalize(query);
    if (!q) return [];
    const scored = [];
    for (let i = 0; i < EMOJI_UNIQUE.length; i++) {
      const e = EMOJI_UNIQUE[i];
      let prio = -1;
      if (e._nameN === q) prio = PRIORITY.NAME_EXACT;
      else if (e._tagsN.some(t => t === q)) prio = PRIORITY.TAG_EXACT;
      else if (e._aliasesN.some(a => a === q)) prio = PRIORITY.ALIAS_EXACT;
      else if (_EMOJI_INDEX.has(query) && e.emoji === query) prio = PRIORITY.EMOJI_EXACT;
      else if (e._nameN.startsWith(q)) prio = PRIORITY.NAME_PREFIX;
      else if (e._tagsN.some(t => t.startsWith(q))) prio = PRIORITY.TAG_PREFIX;
      else if (e._aliasesN.some(a => a.startsWith(q))) prio = PRIORITY.ALIAS_PREFIX;
      else if (e._nameN.split(/[\s_-]+/).some(w => w.startsWith(q))) prio = PRIORITY.ACRONYM;
      else if (e._nameN.includes(q)) prio = PRIORITY.NAME_INCLUDES;
      else if (e._tagsN.some(t => t.includes(q))) prio = PRIORITY.TAG_INCLUDES;
      else if (e._aliasesN.some(a => a.includes(q))) prio = PRIORITY.ALIAS_INCLUDES;
      else if (_fuzzy(q, e._nameN)) prio = PRIORITY.FUZZY;
      if (prio >= 0) scored.push({ e, prio, idx: i });
    }
    scored.sort((a, b) => a.prio - b.prio || _usageScore(b.e.emoji) - _usageScore(a.e.emoji) || a.idx - b.idx);
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

    if (!_palette) {
      _palette = document.createElement('div');
      _palette.className = 'emoji-palette';
      _palette.setAttribute('role', 'listbox');
      _palette.setAttribute('aria-label', 'Эмодзи');
      document.body.appendChild(_palette);
    } else {
      _palette.querySelectorAll('.emoji-item, .emoji-footer, .emoji-empty').forEach(n => n.remove());
    }
    _ta = ta;
    _focusedIdx = 0;
    _wrapHold = '';

    /* recents + категории при пустом запросе */
    if (!query) {
      const recents = _loadRecents()
        .map(r => EMOJI_UNIQUE.find(d => d.emoji === r.emoji)).filter(Boolean)
        .slice(0, 8);
      let idx = 0;
      const allItems = [];

      if (recents.length) {
        const lbl = document.createElement('div');
        lbl.className = 'emoji-footer';
        lbl.textContent = 'Недавние';
        _palette.appendChild(lbl);
        for (const item of recents) {
          allItems.push({ e: item });
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.id = _idRoot + '-opt-' + idx;
          btn.className = 'emoji-item' + (idx === 0 ? ' focused' : '');
          btn.setAttribute('role', 'option');
          btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
          const charSpan = document.createElement('span');
          charSpan.className = 'emoji-char';
          charSpan.setAttribute('aria-hidden', 'true');
          charSpan.textContent = item.emoji;
          const nameSpan = document.createElement('span');
          nameSpan.className = 'emoji-name';
          nameSpan.textContent = item.name;
          btn.appendChild(charSpan);
          btn.appendChild(nameSpan);
          if (item.type) btn.setAttribute('data-type', item.type);
          const captureIdx = idx;
          btn.addEventListener('mousedown', ev => { ev.preventDefault(); _filtered = allItems; _insert(captureIdx); });
          _palette.appendChild(btn);
          idx++;
        }
      }

      for (const cat of CATEGORIES) {
        const lbl = document.createElement('div');
        lbl.className = 'emoji-footer';
        lbl.textContent = cat.label;
        _palette.appendChild(lbl);
        for (const emojiChar of cat.emojis) {
          const entry = EMOJI_UNIQUE.find(d => d.emoji === emojiChar);
          if (!entry) continue;
          allItems.push({ e: entry });
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.id = _idRoot + '-opt-' + idx;
          btn.className = 'emoji-item' + (idx === 0 ? ' focused' : '');
          btn.setAttribute('role', 'option');
          btn.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
          const charSpan = document.createElement('span');
          charSpan.className = 'emoji-char';
          charSpan.setAttribute('aria-hidden', 'true');
          charSpan.textContent = entry.emoji;
          const nameSpan = document.createElement('span');
          nameSpan.className = 'emoji-name';
          nameSpan.textContent = entry.name;
          btn.appendChild(charSpan);
          btn.appendChild(nameSpan);
          if (entry.type) btn.setAttribute('data-type', entry.type);
          const captureIdx = idx;
          btn.addEventListener('mousedown', ev => { ev.preventDefault(); _filtered = allItems; _insert(captureIdx); });
          _palette.appendChild(btn);
          idx++;
        }
      }

      _filtered = allItems;
      _palette.style.width = '';
      _position(ta);
      return;
    }

    if (!_filtered.length) {
      _palette.innerHTML = '<div class="emoji-empty"><span class="emoji-empty-icon" aria-hidden="true">🔍</span><span>Ничего не найдено</span></div>';
      _position(ta);
      return;
    }

    let footer = _palette.querySelector('.emoji-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'emoji-footer';
      _palette.appendChild(footer);
    }
    footer.textContent = '↑↓ · Enter · Esc';

    /* DOM-diffing: переиспользуем существующие строки */
    let rows = [..._palette.querySelectorAll('.emoji-item')];
    for (let i = 0; i < _filtered.length; i++) {
      const item = _filtered[i];
      let btn = rows[i];
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        const charSpan = document.createElement('span');
        charSpan.className = 'emoji-char';
        charSpan.setAttribute('aria-hidden', 'true');
        const nameSpan = document.createElement('span');
        nameSpan.className = 'emoji-name';
        btn.appendChild(charSpan);
        btn.appendChild(nameSpan);
        btn.addEventListener('mousedown', ev => { ev.preventDefault(); _insert(i); });
        _palette.insertBefore(btn, footer);
      }
      btn.id = _idRoot + '-opt-' + i;
      btn.className = 'emoji-item' + (i === 0 ? ' focused' : '');
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.style.animationDelay = (i * 0.012) + 's';
      if (item.e.type) btn.setAttribute('data-type', item.e.type);
      else btn.removeAttribute('data-type');
      btn.children[0].textContent = item.e.emoji;
      btn.children[1].textContent = item.e.name;
    }
    rows.slice(_filtered.length).forEach(r => r.remove());

    /* динамическая ширина: canvas + полный размер строки */
    const PAD_X = 10 + 10;          /* padding-left/right .emoji-item */
    const CHAR_FIXED = 26 + 8;      /* .emoji-char + gap */
    const PALETTE_INSET = 5 * 2;    /* padding самой палитры */
    const cs2 = getComputedStyle(ta);
    const fontStr = '500 12px ' + cs2.fontFamily;
    let maxW = 0;
    for (let i = 0; i < _filtered.length; i++) {
      maxW = Math.max(maxW, _measureWidth(_filtered[i].e.name, fontStr));
    }
    _palette.style.width = Math.min(Math.ceil(maxW) + CHAR_FIXED + PAD_X + PALETTE_INSET, 520) + 'px';

    _position(ta);
  }

  /* ── POSITION (clone-measure) ──────────────────────────────────── */
  function _position(ta) {
    if (!_palette || !_ta) return;

    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.4);
    const pos = ta.selectionStart;

    /* кеш metrics — clone создаём только при смене стиля/текста */
    const cacheKey = cs.font + '|' + cs.lineHeight + '|' + cs.padding + '|' + cs.letterSpacing + '|' + cs.boxSizing;
    if (!ta._emojiPosCache || ta._emojiPosCache.key !== cacheKey) {
      const pl = parseFloat(cs.paddingLeft) || 0;
      const pr = parseFloat(cs.paddingRight) || 0;
      const bs = cs.boxSizing === 'border-box';
      ta._emojiPosCache = {
        key: cacheKey,
        innerW: bs ? ta.clientWidth : (ta.clientWidth - pl - pr),
        font: cs.font, padding: cs.padding, lh, letterSpacing: cs.letterSpacing,
      };
    }
    const { innerW } = ta._emojiPosCache;

    /* clone */
    const clone = document.createElement('div');
    clone.style.cssText = 'position:absolute;visibility:hidden;top:-9999px;left:-9999px;'
      + 'box-sizing:' + cs.boxSizing + ';'
      + 'font:' + cs.font + ';white-space:pre-wrap;word-wrap:break-word;'
      + 'width:' + innerW + 'px;'
      + 'padding:' + cs.padding + ';line-height:' + cs.lineHeight + ';'
      + 'letter-spacing:' + cs.letterSpacing + ';border:' + cs.border + ';';

    const textBefore = ta.value.slice(0, pos);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    clone.appendChild(document.createTextNode(textBefore));
    clone.appendChild(marker);
    document.body.appendChild(clone);

    const mkR = marker.getBoundingClientRect();
    const taR = ta.getBoundingClientRect();
    const cR = clone.getBoundingClientRect();
    const ox = taR.left - cR.left - ta.scrollLeft;
    const oy = taR.top - cR.top - ta.scrollTop;

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
    const ta = _ta;
    if (item.e.type === 'command') {
      const pos = ta.selectionStart;
      ta.setRangeText('', _triggerStart, pos, 'end');
      ta.dispatchEvent(new Event('input'));
      _close();
      if (typeof item.e.action === 'function') item.e.action();
      return;
    }
    _pushRecent(item.e.emoji);
    const pos = ta.selectionStart;
    ta.setRangeText(item.e.emoji + ' ', _triggerStart, pos, 'end');
    ta.dispatchEvent(new Event('input'));
    _close();
    ta.focus();
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
    _palette.setAttribute('aria-activedescendant', _idRoot + '-opt-' + idx);
  }

  /* ── DEBOUNCE ──────────────────────────────────────────────────── */
  let _debounceTimer = 0;

  /* ── TRIGGER DETECTION ─────────────────────────────────────────── */
  function _isEnabled() {
    const lay = window.State?.getLayout?.();
    return !lay || lay.emojiPicker !== false;
  }

  function _handleInput(ta) {
    if (!_isEnabled()) { if (_palette) _close(); return; }
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => _doHandleInput(ta), 35);
  }
  function _doHandleInput(ta) {
    const pos = ta.selectionStart;
    const before = ta.value.slice(0, pos);
    const m = before.match(/(^|[\n\s]):([^\s\n:]{1,32}):?$/);
    if (m) {
      const query = m[2].toLowerCase();
      const isDouble = before[before.length - m[0].length - 1] === ':';
      _triggerStart = isDouble ? pos - m[0].length - 1 : pos - m[2].length - 1;
      _render(ta, query);
    } else {
      if (_palette) _close();
    }
  }

  /* ── GLOBAL EVENTS ─────────────────────────────────────────────── */
  function _onInput(e) {
    if (e.isComposing) return;
    if (e.target && e.target.tagName === 'TEXTAREA') _handleInput(e.target);
  }
  function _onClick(e) {
    if (_palette && !_palette.contains(e.target)) _close();
  }
  function _onResize() { if (_palette) _close(); }
  function _onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (!_palette || !_ta || e.target !== _ta) return;
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
      if (_triggerStart >= 0 && _ta) {
        const pos = _ta.selectionStart;
        _ta.setRangeText('', _triggerStart, pos, 'end');
        _ta.dispatchEvent(new Event('input'));
      }
      _close();
    }
  }

  document.addEventListener('input', _onInput, true);
  document.addEventListener('click', _onClick);
  window.addEventListener('resize', _onResize);
  document.addEventListener('keydown', _onKey, true);

  function destroy() {
    document.removeEventListener('input', _onInput, true);
    document.removeEventListener('click', _onClick);
    window.removeEventListener('resize', _onResize);
    document.removeEventListener('keydown', _onKey, true);
    _close();
  }

  window.EmojiPicker = { destroy };

})();
