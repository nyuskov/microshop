/**
 * Английские переводы интерфейса.
 *
 * КЛЮЧ = русский исходный текст (как он написан в компоненте), значение — перевод.
 * Так сделано, чтобы правка компонента была механической (`t('Войти')`), а
 * непереведённая строка просто оставалась русской: каталог наполняется по частям,
 * и приложение при этом остаётся рабочим.
 *
 * Правила для переводов:
 *  - подстановки в ключе — фигурные скобки, как в вызове:
 *    `t('Код отправлен на {phone}', { phone })` ↔ `'Код отправлен на {phone}': 'Code sent to {phone}'`;
 *  - кнопки и заголовки — с заглавной буквы, без точки в конце;
 *  - тон — как в русском тексте: коротко, без канцелярита, без «Please» там, где
 *    русский текст его не подразумевает;
 *  - кавычки-ёлочки в английском заменяются обычными (`«Спам»` → `“Spam”`).
 *
 * Файл грузится ЛЕНИВО (`import('./en')` в `i18n/index.ts`): он нужен только тем,
 * кто выбрал английский, и в основном чанке он бы увеличил загрузку всем
 * (бюджет бандла — `scripts/check-bundle-size.mjs`).
 *
 * Сколько ещё не переведено: `node scripts/check-i18n.mjs` (из каталога frontend/).
 */

export const EN: Record<string, string> = {
  // --- Вход (components/Login.vue) ---
  Вход: 'Log in',
  'Номер телефона': 'Phone number',
  'Введите номер телефона — войдёте по паролю.':
    'Enter your phone number — then log in with your password.',
  'Проверка…': 'Checking…',
  '6 цифр': '6 digits',
  'Не выбран': 'Not set',
  Продолжить: 'Continue',
  'Если пароля ещё нет — подтвердим номер кодом в Telegram и предложим его создать.':
    'If there is no password yet, we will confirm the number with a Telegram code and offer to create one.',
  'Войти по коду на e-mail': 'Log in with an email code',
  'Введите пароль': 'Enter your password',
  'Для номера': 'Password for number',
  'уже задан пароль.': 'is already set.',
  Пароль: 'Password',
  'Введите пароль.': 'Enter your password.',
  'Скрыть пароль': 'Hide password',
  'Показать пароль': 'Show password',
  'Вход…': 'Signing in…',
  Войти: 'Sign in',
  'Изменить номер': 'Change number',
  'Забыли пароль?': 'Forgot your password?',
  'Регистрация новых пользователей временно отключена. Попробуйте позже.':
    'Registration of new users is temporarily disabled. Try again later.',
  'Введите корректный номер телефона в формате +7 (___) ___-__-__':
    'Enter a valid phone number in the format +7 (___) ___-__-__',
  'Не удалось проверить номер.': 'Could not check the number.',
  'Неверный номер или пароль.': 'Wrong number or password.',
  'Код отправлен на {phone}': 'Code sent to {phone}',
  'Не удалось отправить код.': 'Could not send the code.',

  // --- Вход: код подтверждения (Telegram) ---
  'Введите код': 'Enter the code',
  'Код подтверждения отправлен в Telegram на номер':
    'The confirmation code was sent via Telegram to the number',
  'Код из сообщения': 'Code from the message',
  'Код подтверждения': 'Confirmation code',
  'Введите код из сообщения.': 'Enter the code from the message.',
  'Неверный или истёкший код.': 'Wrong or expired code.',
  'Отправить код ещё раз': 'Send the code again',
  'Код приходит в Telegram на этот номер. Нет Telegram или код не пришёл — напишите на':
    'The code arrives in Telegram for this number. No Telegram or no code — write to',
  'Я принимаю': 'I accept the',
  'политику конфиденциальности': 'privacy policy',
  'пользовательское соглашение': 'terms of service',
  и: 'and',
  'правила сообщества': 'community guidelines',
  'а также даю согласие на обработку персональных данных.':
    ', and I consent to the processing of personal data.',

  // --- Список чатов: шапка (components/messenger/SidebarHeader.vue) ---
  Отмена: 'Cancel',
  'Включить уведомления': 'Turn notifications on',
  'Замьютить выбранные': 'Mute selected',
  'Мьют/анмьют выбранных': 'Mute/unmute selected',
  'Открепить выбранные': 'Unpin selected',
  'Закрепить выбранные': 'Pin selected',
  'Пин/анпин выбранных': 'Pin/unpin selected',
  'Убрать из архива': 'Unarchive',
  'В архив': 'Archive',
  'В архив/из архива выбранных': 'Archive/unarchive selected',
  'В папку': 'To folder',
  'Добавить выбранные чаты в папку': 'Add selected chats to a folder',
  'Удалить выбранные': 'Delete selected',
  'Выбрать все': 'Select all',
  Контакты: 'Contacts',
  'Открыть контакты': 'Open contacts',
  Чаты: 'Chats',
  'Открыть чаты': 'Open chats',
  'Закрыть поиск': 'Close search',
  Поиск: 'Search',
  'Добавить из контактов телефона': 'Add from phone contacts',
  Ещё: 'More',
  'Настройки профиля': 'Profile settings',
  Звонки: 'Calls',
  'Новая группа': 'New group',
  'Новый канал': 'New channel',
  Заблокированные: 'Blocked',

  // --- Список чатов: строки и пустые состояния (components/messenger/ChatList.vue) ---
  'Загрузка диалогов…': 'Loading chats…',
  'Фильтр чатов': 'Chat filter',
  'Новая папка': 'New folder',
  'Новая папка чатов': 'New chat folder',
  'В папке пока нет чатов — добавьте их через «В папку» в меню чата.':
    'No chats in this folder yet — add them via “To folder” in the chat menu.',
  'Вы пока не подписаны на каналы — найдите их поиском по названию или адресу':
    'You are not subscribed to any channels yet — find them by name or address in search',
  'Найдите пользователя по логину или телефону и начните переписку':
    'Find a user by username or phone number to start a chat',
  печатает: 'typing',
  'Черновик: {text}': 'Draft: {text}',
  Открепить: 'Unpin',
  Закрепить: 'Pin',
  'Выключить уведомления': 'Turn notifications off',
  'Из архива': 'Unarchive',
  'Папка чатов: долгий тап — изменить': 'Chat folder: hold to edit',

  // --- Поле ввода и панель эмодзи/стикеров (components/messenger/MessageComposer.vue) ---
  Редактирование: 'Editing',
  'Отменить ответ': 'Cancel reply',
  'Прикрепить файл': 'Attach a file',
  'Файл или фото': 'File or photo',
  'Посмотреть один раз': 'View once',
  'Одноразовое медиа сгорит после первого просмотра: его нельзя переслать.':
    'A one-time media item disappears after the first view: it cannot be forwarded.',
  Сообщение: 'Message',
  'Эмодзи и GIF': 'Emoji and GIF',
  'Видеосообщение (нажмите). Удерживайте 2 секунды — голосовое':
    'Video message (tap). Hold for 2 seconds for a voice message',
  'Голосовое сообщение (нажмите). Удерживайте 2 секунды — видеосообщение':
    'Voice message (tap). Hold for 2 seconds for a video message',
  'Записать видеосообщение. Удерживайте 2 секунды для голосового':
    'Record a video message. Hold for 2 seconds for a voice message',
  'Записать голосовое сообщение. Удерживайте 2 секунды для видеосообщения':
    'Record a voice message. Hold for 2 seconds for a video message',
  'Отправить. Удерживайте или нажмите правой кнопкой — отправить позже':
    'Send. Hold or right-click to send later',
  'Стикер уходит сразу — как сообщение.': 'A sticker is sent right away, like a message.',
  Добавить: 'Add',
  'Мои паки стикеров': 'My sticker packs',
  Паки: 'Packs',
  'Категории эмодзи': 'Emoji categories',
  'Паки стикеров': 'Sticker packs',
  'Отправить: {alt}': 'Send: {alt}',
  'Отправить стикер {alt}': 'Send sticker {alt}',
  'Отправить {emoji}': 'Send {emoji}',
  'Здесь пока пусто.': 'Nothing here yet.',
  'Загружаем…': 'Loading…',
  Добавлен: 'Added',
  'Добавляем…': 'Adding…',
  'Добавить весь набор': 'Add the whole set',
  Недавние: 'Recent',
  'Недавние эмодзи': 'Recent emoji',
  'В паке пусто. Добавьте картинки кнопкой «Добавить».':
    'This pack is empty. Add images with the “Add” button.',
  Стикер: 'Sticker',
  'Не добавились: {list}': 'Not added: {list}',

  // --- Шапка открытого чата (components/messenger/ChatHeader.vue) ---
  'К списку чатов': 'Back to chats',
  'Информация о чате': 'Chat info',
  'Сквозное шифрование включено: сообщения читаете только вы и собеседник':
    'End-to-end encryption is on: only you and your peer can read the messages',
  '{kind} — нажмите для звонка, удерживайте 0,5 с для смены типа':
    '{kind} — tap to call, hold for 0.5 s to change the type',
  'Поиск по сообщениям': 'Search in messages',
  'Звук уведомлений': 'Notification sound',
  'В папку…': 'To folder…',
  'Статистика чата': 'Chat statistics',
  'Показать закреплённые': 'Show pinned',
  'Скрыть закреплённые': 'Hide pinned',
  Пожаловаться: 'Report',
  'Принимать звонки': 'Accept calls',
  'Не принимать звонки': 'Don’t accept calls',
  Разблокировать: 'Unblock',
  Заблокировать: 'Block',

  // --- Лента сообщений (components/messenger/MessageThread.vue) ---
  'Загрузка сообщений…': 'Loading messages…',
  'Непрочитанные сообщения': 'Unread messages',
  Комментировать: 'Comment',
  'Ждёт сети — отправим, как появится': 'Waiting for connection — will send when it is back',
  'Не отправлено': 'Not sent',
  'Повторить отправку': 'Retry sending',
  'Убрать из очереди': 'Remove from the queue',
  'Сообщений пока нет': 'No messages yet',
  'Напишите первым — сообщение появится здесь': 'Write first — your message will appear here',
  'Новые сообщения': 'New messages',
  Вниз: 'Down',
  'Перейти к новым сообщениям': 'Jump to new messages',
  'Прокрутить вниз': 'Scroll down',

  // --- Строка сообщения (components/messenger/MessageRow.vue) ---
  'Открыть чат с автором': 'Open the chat with the author',
  'Ответ на историю': 'Reply to a story',
  'Нажмите, чтобы показать': 'Tap to reveal',
  Свернуть: 'Collapse',
  'Показать полностью': 'Show more',
  '{emoji} {count} · нажмите, чтобы поставить, удержите — кто поставил':
    '{emoji} {count} · tap to react, hold to see who reacted',
  '{emoji} {count}. Кто поставил': '{emoji} {count}. Who reacted',
  изменено: 'edited',
  'Напоминание {label}': 'Reminder {label}',
  'Переслано от вас': 'Forwarded from you',
  'Переслано от {name}': 'Forwarded from {name}',
  Переслано: 'Forwarded',
  'Перевод…': 'Translating…',
  'Скрыть перевод': 'Hide translation',
  Перевести: 'Translate',
  Звонок: 'Call',

  // --- Панель действий с сообщением (components/messenger/MessageActionsBar.vue) ---
  'Быстрые реакции': 'Quick reactions',
  'Реакция {emoji}': 'React with {emoji}',
  'Все реакции': 'All reactions',
  Ответить: 'Reply',
  Переслать: 'Forward',
  Копировать: 'Copy',
  Редактировать: 'Edit',
  'Сохранить в Сохранённые': 'Save to Saved messages',
  'Изменить напоминание': 'Change the reminder',
  Напомнить: 'Remind me',
  'В стикеры': 'To stickers',
  Удалить: 'Delete',
  'Удалить у себя': 'Delete for me',
  'Открыть как картинку': 'Open as an image',
  'Открыть изображение': 'Open the image',
  'Скрыто до проверки модератором': 'Hidden until moderation review',

  // --- Мессенджер: общие подписи (views/Messenger.vue) ---
  'Сообщения защищены сквозным шифрованием': 'Messages are protected with end-to-end encryption',
  'Загрузка профиля…': 'Loading the profile…',
  'Входящий звонок': 'Incoming call',
  'Принимаем звонок': 'Answering the call',
  'Ответить на звонок': 'Answer the call',
  Отвечаем: 'Answering',
  'Отклонить звонок': 'Decline the call',
  'Вызов завершён': 'Call ended',
  Чат: 'Chat',
  Медиа: 'Media',
  'в сети': 'online',
  'был(а) давно': 'last seen a long time ago',
  канал: 'channel',
  'канал · {count} {noun}': 'channel · {count} {noun}',
  '{noun} · {online} в сети': '{noun} · {online} online',
  Собеседник: 'Peer',
  Вы: 'You',
  'Вы: ': 'You: ',
  Вложение: 'Attachment',
  'Откройте чат, чтобы отправить файл': 'Open a chat to send a file',
  'Удалить для всех': 'Delete for everyone',
  Исчезнут: 'Will disappear',
  Исчезнет: 'Will disappear',
  '{what} и у {name} — вернуть нельзя.': '{what} for {name} too — it cannot be undone.',
  '{what} у всех участников — вернуть нельзя.': '{what} for all members — it cannot be undone.',
  'Новое сообщение: {who}': 'New message: {who}',
  'Новое сообщение': 'New message',
  Настройки: 'Settings',
  'Это ваша ссылка': 'This is your link',
  'Ссылка не открылась': 'The link did not open',
  'Приглашение не открылось': 'The invite did not open',
  Пользователь: 'User',

  // --- Сайдбар чатов: поиск и чипы фильтров (components/messenger/ChatSidebar.vue) ---
  'Поиск: люди, сообщения, каналы': 'Search: people, messages, channels',
  'Глобальный поиск': 'Global search',
  Очистить: 'Clear',
  'Не удалось начать переписку': 'Could not start the chat',

  // --- Полоса историй (components/stories/StoriesStrip.vue) ---
  'Показать истории': 'Show stories',
  'Моя история': 'My story',
  'Добавить историю': 'Add a story',
  'Новая история': 'New story',
  'Подпись (необязательно)': 'Caption (optional)',
  Я: 'Me',
  'История может быть фото или видео': 'A story can be a photo or a video',
  'Не удалось опубликовать историю': 'Could not publish the story',

  // --- Отчёт «что умеет это устройство» (utils/browserSupport.ts) ---
  'Неизвестное окружение': 'Unknown environment',
  'Встроенный браузер (не Chrome)': 'Embedded browser (not Chrome)',
  'Браузер на Android': 'Browser on Android',
  'Браузер на iPhone или iPad': 'Browser on iPhone or iPad',
  'Обычный браузер': 'Regular browser',
  'Нужно защищённое соединение (HTTPS)': 'A secure connection (HTTPS) is required',
  'Откройте приложение по адресу https://… — по http браузер не даёт ни микрофон, ни камеру':
    'Open the app over https://… — over http the browser gives neither microphone nor camera',
  'Браузер не умеет WebRTC': 'This browser does not support WebRTC',
  'Позвонить можно из Chrome, Safari или Firefox на компьютере и телефоне':
    'You can call from Chrome, Safari or Firefox on a computer or a phone',
  'Звуковые и видеозвонки работают': 'Voice and video calls work',
  'Показ экрана': 'Screen sharing',
  'Можно показать экран в звонке': 'You can share your screen in a call',
  'Включите показ экрана с компьютера — собеседник увидит его в том же звонке':
    'Start screen sharing from a computer — the peer will see it in the same call',
  'Откройте приложение по адресу https://… — по http браузер не даёт захват':
    'Open the app over https://… — over http the browser does not allow screen capture',
  'Это ограничение окружения, а не приложения: в обычном Chrome кнопка покажется':
    'This is a limitation of the environment, not the app: the button appears in regular Chrome',
  'Показывать экран умеют Chrome, Edge и Safari на компьютере':
    'Chrome, Edge and Safari can share the screen on a computer',
  'Уведомления о сообщениях': 'Message notifications',
  'Браузер не умеет push-уведомления': 'This browser does not support push notifications',
  'Во встроенном браузере push не приходят: откройте приложение в обычном Chrome и добавьте на главный экран':
    'Push notifications do not arrive in an embedded browser: open the app in regular Chrome and add it to the home screen',
  'Установите приложение на главный экран (Chrome: «Установить приложение») — тогда push будут приходить':
    'Install the app to the home screen (Chrome: “Install app”) — then push notifications will arrive',
  'По http браузер не выдаёт разрешение на уведомления':
    'Over http the browser does not grant notification permission',
  'Уведомления запрещены в настройках браузера':
    'Notifications are blocked in the browser settings',
  'Разрешите уведомления для этого сайта (значок замка в адресной строке) и обновите страницу':
    'Allow notifications for this site (the lock icon in the address bar) and reload the page',
  'Разрешение ещё не выдано': 'Permission has not been granted yet',
  'Включите уведомления в разделе «Уведомления» — браузер спросит разрешение':
    'Turn notifications on in the “Notifications” section — the browser will ask for permission',
  'Уведомления разрешены': 'Notifications are allowed',
  'Расшифровка голосовых в текст': 'Voice-to-text transcription',
  'Распознаёт распознаватель устройства': 'Uses the device speech recogniser',
  'Распознаёт Chrome: звук записи уходит в сервис браузера':
    'Uses Chrome recognition: the recording audio goes to the browser service',
  'Распознаём на устройстве моделью — она скачается один раз':
    'Recognised on the device with a model — it is downloaded once',
  'Модель «{title}» (~{size} МБ) скачается в браузер при первом нажатии значка расшифровки у записи; звук и текст при этом остаются на устройстве':
    'The “{title}” model (~{size} MB) is downloaded to the browser on the first tap on the transcription icon next to a recording; the audio and the text stay on the device',
  'У этого браузера нет распознавания речи': 'This browser has no speech recognition',
  'Откройте Pismo в обычном браузере или в приложении: во встроенном браузере редактора модель распознавания не запускается':
    'Open Pismo in a regular browser or in the app: the speech model does not start in the editor’s embedded browser',
  'Нужен браузер с WebAssembly (Chrome, Firefox, Safari) либо приложение Pismo на Android':
    'A browser with WebAssembly (Chrome, Firefox, Safari) or the Pismo app on Android is required',
  'Перевод сообщений': 'Message translation',
  'Переводит браузер устройства, модель скачается при первом переводе':
    'Translated by the device browser; the model is downloaded on the first translation',
  'Первые десятки мегабайт скачает браузер — текст при этом никуда не уходит':
    'The browser downloads the first tens of megabytes — the text never leaves the device',
  'У этого браузера нет встроенного переводчика': 'This browser has no built-in translator',
  'Перевод есть только в обычном Chrome 138+ на компьютере: в приложении на Android и во встроенном браузере редактора сервиса моделей нет':
    'Translation is available only in regular Chrome 138+ on a computer: the Android app and the editor’s embedded browser have no model service',
  'Нужен Chrome 138+ на компьютере: перевод идёт на устройстве, текст никуда не отправляется. В мобильных браузерах кнопки нет':
    'Chrome 138+ on a computer is required: translation runs on the device and the text is not sent anywhere. Mobile browsers have no such button',
  'Голосовые сообщения': 'Voice messages',
  'Формат записей (webm/Opus) устройству знаком':
    'The recording format (webm/Opus) is known to this device',
  'Устройство не умеет проигрывать формат записей (webm/Opus)':
    'This device cannot play the recording format (webm/Opus)',
  'Записи не послушать, но их можно расшифровать в текст значком ↳A у записи — если расшифровка доступна':
    'Recordings cannot be played, but they can be transcribed with the ↳A icon next to a recording — if transcription is available',

  // --- Каналы (components/channels/*) ---
  Канал: 'Channel',
  Закрыть: 'Close',
  'Разделы канала': 'Channel sections',
  Название: 'Name',
  Описание: 'Description',
  'Название канала': 'Channel name',
  'Например, «Новости проекта»': 'For example, “Project news”',
  'Описание (необязательно)': 'Description (optional)',
  'О чём канал?': 'What is the channel about?',
  'Публичный канал': 'Public channel',
  'Виден в поиске и открывается по ссылке': 'Visible in search and opens via the link',
  '. Выключено — вход только по ссылке-приглашению.':
    '. Switched off — you can join by invite link only.',
  Ссылка: 'Link',
  адрес: 'address',
  ', канал виден в поиске.': ', the channel is visible in search.',
  'Адрес канала': 'Channel address',
  'Латиница, цифры и подчёркивание, 4–32 символа, начинается с буквы.':
    'Latin letters, digits and underscores, 4–32 characters, starts with a letter.',
  'Каналов на аккаунт: до 10. Публикуют владелец и админы.':
    'Up to 10 channels per account. The owner and admins can post.',
  'Нужно название канала': 'A channel name is required',
  'Для публичного канала нужен адрес (минимум 4 символа)':
    'A public channel needs an address (at least 4 characters)',
  'Загружаем канал…': 'Loading the channel…',
  Подписаться: 'Subscribe',
  'Открыть канал': 'Open the channel',
  Отписаться: 'Unsubscribe',
  'Снять админа': 'Remove as admin',
  'Сделать админом': 'Make admin',
  'Назначать админов может только владелец канала.': 'Only the channel owner can appoint admins.',
  'Новых предложек нет.': 'No new submissions.',
  'О канале': 'About the channel',
  владелец: 'owner',
  админ: 'admin',
  'Ваш комментарий': 'Your comment',
  'Комментировать могут подписчики': 'Only subscribers can comment',
  'Отправить комментарий': 'Send the comment',
  'Удалить комментарий': 'Delete the comment',

  // --- Профиль: поля и разделы (views/UserProfile.vue) ---
  'Не выбрана': 'Not set',
  Россия: 'Russia',
  Беларусь: 'Belarus',
  Казахстан: 'Kazakhstan',
  США: 'USA',
  Германия: 'Germany',
  Испания: 'Spain',
  Франция: 'France',
  Аватар: 'Avatar',
  'Загрузка фото…': 'Uploading the photo…',
  'Ничего не нашлось — попробуйте другое слово.': 'Nothing found — try another word.',
  'Выйти из аккаунта': 'Log out',
  'Удалить аккаунт': 'Delete account',
  'Профиль сохранён': 'Profile saved',
  Статус: 'Status',
  'Ваш статус': 'Your status',
  'Например: в работе 🚀': 'For example: at work 🚀',
  'Показывается собеседнику в шапке личного чата.':
    'Shown to the peer in the header of a private chat.',
  'О себе': 'About yourself',
  Биография: 'Bio',
  'Расскажите немного о себе…': 'Tell a bit about yourself…',
  'Имя и фамилия': 'First and last name',
  Имя: 'First name',
  Фамилия: 'Last name',
  Логин: 'Username',
  'Подтверждён — можно входить по коду на e-mail.': 'Verified — you can log in with an email code.',
  'Не подтверждён: подтвердите адрес, иначе войти по нему и восстановить пароль не получится.':
    'Not verified: confirm the address, otherwise you cannot log in with it or reset the password.',
  'Не подтверждён (отправка писем на сервере выключена).':
    'Not verified (email sending is disabled on the server).',
  'Контакты и локализация': 'Contacts and language',
  Телефон: 'Phone',
  'Дата рождения': 'Date of birth',
  Язык: 'Language',
  Страна: 'Country',
  'Это логин аккаунта, изменить номер нельзя. Нужен другой — напишите на':
    'This is the account login; the number cannot be changed. Need another one — write to',
  'Системные push-уведомления, когда приложение свёрнуто или закрыто':
    'System push notifications when the app is minimised or closed',
  'Показывать текст сообщения': 'Show the message text',
  'Если выключить — в уведомлении будет только имя отправителя':
    'If disabled, the notification will show only the sender name',
  'Звук сообщений': 'Message sound',
  'Короткий звук в приложении; на этом устройстве': 'A short sound in the app; on this device',
  'Тихие часы': 'Quiet hours',
  'Не присылать уведомления о сообщениях в выбранное время':
    'Do not send message notifications during the selected time',
  С: 'From',
  До: 'To',
  'Начало тихих часов': 'Quiet hours start',
  'Конец тихих часов': 'Quiet hours end',
  'Разрешить звонки': 'Allow calls',
  'Входящий звонок разбудит даже в тихие часы':
    'An incoming call will wake you up even during quiet hours',
  'Время местное, {offset} —': 'Local time, {offset} —',
  'сохраняем…': 'saving…',
  'сохраняется сразу': 'saved instantly',
  'Приватный режим': 'Private mode',
  'Скрывать профиль от посторонних в поиске': 'Hide the profile from strangers in search',
  'Изменение сохраняется сразу.': 'The change is saved instantly.',
  из: 'of',
  'файл(ов)': 'file(s)',
  'Место почти закончилось: новые файлы не загрузятся — удалите старые сообщения с вложениями.':
    'Storage is almost full: new files will not upload — delete old messages with attachments.',
  'Пересланные файлы не тратят место второй раз. Освобождается сразу после удаления сообщения.':
    'Forwarded files do not use space twice. It is freed right after deleting a message.',
  Обновить: 'Refresh',
  'Не удалось получить данные хранилища.': 'Could not get the storage data.',
  'Кэш приложения на устройстве': 'App cache on this device',
  '{count} файл(ов) оболочки (страницы, шрифты, иконки). Переписка, черновики и настройки лежат отдельно и очисткой не затрагиваются.':
    '{count} app shell file(s) (pages, fonts, icons). Your chats, drafts and settings are stored separately and are not touched by the cleanup.',
  'Очищаем…': 'Clearing…',
  'Очистить кэш приложения': 'Clear the app cache',
  'Поиск по зашифрованным чатам': 'Search in encrypted chats',
  'В шифрованном чате сервер текста не видит, поэтому поиск идёт по индексу на этом устройстве. Запоминается только текст сообщений, которые вы уже прочитали здесь; ключи шифрования в индексе не хранятся.':
    'In an encrypted chat the server does not see the text, so search works over an index on this device. Only the text of messages you have already read here is remembered; encryption keys are not stored in the index.',
  'Индекс на устройстве': 'Index on this device',
  'Очистить индекс': 'Clear the index',
  'QR-код ссылки на ваш профиль': 'QR code with a link to your profile',
  'Наводят камеру другого телефона — чат со мной откроется сразу.':
    'Point another phone’s camera — the chat with me will open right away.',
  'Дайте эту ссылку — по ней в Pismo откроется чат с вами. Номер телефона в ссылке не виден: логин уникален и служит только адресом профиля.':
    'Share this link — it opens a chat with you in Pismo. The phone number is not visible in the link: the username is unique and only serves as the profile address.',
  'Ссылка на профиль': 'Profile link',
  'Логин не задан — ссылку пока не создать.':
    'No username is set — the link cannot be created yet.',
  'Аккаунт стоит защитить': 'The account should be protected',
  'Вход — по номеру телефона. Пароль нужен, чтобы входить без кода в Telegram; минимум {count} символов, лучше — длинная фраза.':
    'Login is by phone number. A password lets you log in without a Telegram code; at least {count} characters, better a long phrase.',
  'E-mail подтверждён': 'E-mail verified',
  'Подтверждение e-mail': 'Verify e-mail',
  'По нему можно войти без пароля и восстановить доступ.':
    'You can log in with it without a password and restore access.',
  'Без подтверждения адрес не годится для входа и восстановления пароля.':
    'Without confirmation the address cannot be used for login or password reset.',
  'Отправить код на e-mail': 'Send a code to the e-mail',
  'Текущий пароль': 'Current password',
  'Сменить пароль': 'Change the password',
  'Задать пароль': 'Set a password',
  'После смены пароля все другие устройства выйдут из аккаунта.':
    'After changing the password all other devices will log out.',
  'Выйти на всех устройствах': 'Log out on all devices',
  'Активные входы': 'Active sessions',
  'Загружаем устройства…': 'Loading devices…',
  'Активных входов не найдено.': 'No active sessions found.',
  'это устройство': 'this device',
  'Выйти на этом устройстве': 'Log out on this device',
  'Завершить этот вход': 'End this session',
  Выйти: 'Log out',
  Завершить: 'End',
  'Вход с нового устройства требует код из письма, а о каждом таком входе мы сообщаем на подтверждённый e-mail.':
    'Logging in from a new device requires a code from the email, and we notify the confirmed e-mail about each such login.',
  'Заморозить аккаунт': 'Freeze the account',
  'Если в аккаунт вошли чужие: все устройства выйдут, вход будет закрыт. Разморозить можно кодом на подтверждённый e-mail.':
    'If someone else logged into the account: all devices will log out and login will be closed. You can unfreeze it with a code sent to the confirmed e-mail.',
  'Заморозка…': 'Freezing…',
  Заморозить: 'Freeze',
  'Последние действия': 'Recent activity',
  'Загружаем историю…': 'Loading the history…',
  'Событий пока нет.': 'No events yet.',

  // --- Панель группы (components/messenger/GroupChatInfo.vue) ---
  'Информация о группе': 'Group info',
  'Загрузка…': 'Loading…',
  'Аватар группы': 'Group avatar',
  'Удалить аватар': 'Delete the avatar',
  'Название группы': 'Group name',
  'Описание группы': 'Group description',
  Сохранить: 'Save',
  '{count} в сети': '{count} online',
  'Сквозное шифрование': 'End-to-end encryption',
  'Обычная группа — текст и файлы читает сервер (видны в превью и уведомлениях). Зашифрованная — переписку читают только участники; ключ группы хранится на устройствах и меняется, когда состав группы меняется.':
    'In a regular group the server reads texts and files (they appear in previews and notifications). In an encrypted one only the members can read the chat; the group key is stored on devices and changes whenever the membership changes.',
  'Сквозное шифрование группы': 'End-to-end encryption of the group',
  'Включить или выключить шифрование может создатель группы или админ.':
    'Only the group creator or an admin can turn encryption on or off.',
  'Пригласить по ссылке': 'Invite by link',
  'Ссылка готова': 'The link is ready',
  Создать: 'Create',
  'Ссылку можно отправить любому человеку: он увидит карточку группы и вступит сам.':
    'You can send the link to anyone: they will see the group card and join by themselves.',
  'Срок действия — пока не отзовёте.': 'It is valid until you revoke it.',
  'В зашифрованной группе вход по ссылке закрыт: ключ выдаёт участник группы, поэтому добавляйте людей вручную.':
    'In an encrypted group joining by link is closed: a member has to hand over the key, so add people manually.',
  'Ссылка-приглашение': 'Invite link',
  Скопировано: 'Copied',
  Поделиться: 'Share',
  Отозвать: 'Revoke',
  'QR-код ссылки-приглашения в группу': 'QR code of the group invite link',
  'Участники — {count}': 'Members — {count}',
  'Поиск по имени или логину': 'Search by name or username',
  'Поиск участников': 'Search members',
  'Некого добавить — все ваши контакты уже в группе':
    'Nobody to add — all your contacts are already in the group',
  'Добавить ({count})': 'Add ({count})',
  'Замутить {name}': 'Mute {name}',
  'Снять мут': 'Unmute',
  '(вы)': '(you)',
  'в муте': 'muted',
  'Анти-флуд': 'Anti-flood',
  'Медленный режим': 'Slow mode',
  Изменить: 'Change',
  'Участники ждут паузу между сообщениями; админов режим не ограничивает.':
    'Members have to wait between messages; admins are not limited.',
  'Забаненные — {count}': 'Banned — {count}',
  Разбанить: 'Unban',
  'Забаненный не вернётся по ссылке, пока вы не снёте бан.':
    'A banned person cannot come back via the link until you unban them.',
  'Удалить группу': 'Delete the group',
  'Покинуть группу': 'Leave the group',
  '{count} сек': '{count} sec',
  'Пользователь #{id}': 'User #{id}',
  'Человек будет исключён и не сможет вернуться по ссылке-приглашению, пока бан не снимут.':
    'The person will be removed and cannot come back via the invite link until the ban is lifted.',
  Забанить: 'Ban',
  Исключить: 'Remove',
  Замутить: 'Mute',
  'Снять с админов': 'Remove as admin',
  'Покинуть группу?': 'Leave the group?',
  'Вы перестанете получать её сообщения.': 'You will stop receiving its messages.',
  Покинуть: 'Leave',
  'Удалить группу для всех участников?': 'Delete the group for all members?',
  'Это действие нельзя отменить: история и участники удалятся у всех.':
    'This cannot be undone: the history and the members will be deleted for everyone.',
  'Человек перестанет получать сообщения группы. Вернуть его можно повторным приглашением.':
    'The person will stop receiving the group messages. You can bring them back with a new invite.',
  Группа: 'Group',
  Создатель: 'Creator',
  Админ: 'Admin',
  'Не удалось изменить мут': 'Could not change the mute',
  'Не удалось забанить участника': 'Could not ban the member',
  'Не удалось снять бан': 'Could not unban',
  'Не удалось изменить медленный режим': 'Could not change the slow mode',
  'Не удалось загрузить ссылки': 'Could not load the links',
  'Не удалось создать ссылку': 'Could not create the link',
  'Не удалось отозвать ссылку': 'Could not revoke the link',
  'Не удалось загрузить информацию о группе': 'Could not load the group info',
  'Не удалось исключить участника': 'Could not remove the member',
  'Не удалось изменить роль': 'Could not change the role',
  'Не удалось покинуть группу': 'Could not leave the group',
  'Не удалось удалить группу': 'Could not delete the group',
  'Не удалось сохранить': 'Could not save',
  'Не удалось загрузить аватар': 'Could not upload the avatar',
  'Не удалось удалить аватар': 'Could not delete the avatar',
  'Не удалось добавить участников': 'Could not add the members',
  'Исключить {name} из группы?': 'Remove {name} from the group?',

  // --- Разделы настроек (views/UserProfile.vue) ---
  Аккаунт: 'Account',
  'Имя, логин, статус, контакты': 'Name, username, status, contacts',
  Безопасность: 'Security',
  'Пароль, e-mail, устройства, журнал входов': 'Password, e-mail, devices, login log',
  Приватность: 'Privacy',
  'Видимость профиля в поиске': 'Profile visibility in search',
  Уведомления: 'Notifications',
  'Push-уведомления': 'Push notifications',
  Хранилище: 'Storage',
  'Сколько занимают вложения': 'How much attachments take',
  'Моя ссылка': 'My link',
  'Ссылка на ваш профиль': 'A link to your profile',
  'Внешний вид': 'Appearance',
  'Тема, обои, размер текста': 'Theme, wallpaper, text size',
  Устройство: 'Device',
  'Что работает в этом браузере и что докачать': 'What works in this browser and what to download',
  'О приложении': 'About the app',
  'Документы и версия': 'Documents and version',
  Приглашения: 'Invites',
  'Ссылки на регистрацию для новых людей': 'Sign-up links for new people',
  'Технические работы': 'Maintenance',
  'Закрыть приложение на время обновления': 'Close the app while updating',
  Жалобы: 'Reports',
  'Разбор жалоб и журнал модерации': 'Report handling and the moderation journal',
  Администрирование: 'Administration',
  'Приглашения, жалобы, техработы': 'Invites, reports, maintenance',
  'Обновлений нет — версия свежая.': 'No updates — the version is up to date.',
  'Не удалось проверить обновления': 'Could not check for updates',
  'Ссылка скопирована': 'Link copied',
  'Не удалось скопировать ссылку': 'Could not copy the link',
  'Пожалуйста, выберите изображение': 'Please choose an image',
  'Не удалось загрузить фото': 'Could not upload the photo',
  'Не удалось удалить фото': 'Could not delete the photo',
  'Не удалось сохранить профиль': 'Could not save the profile',
  'Не удалось сохранить тихие часы': 'Could not save quiet hours',
  'Готово: удалено файлов — {count}. Переписка не затронута.':
    'Done: {count} files deleted. Your chats are not affected.',
  'Кэш уже пуст.': 'The cache is already empty.',
  'Включено: текст прочитанных сообщений из шифрованных чатов будет запоминаться на этом устройстве':
    'On: the text of read messages from encrypted chats will be remembered on this device',
  'Индекс очищен': 'The index has been cleared',
  'Уведомления заблокированы браузером. Разрешите их в настройках сайта и попробуйте снова.':
    'Notifications are blocked by the browser. Allow them in the site settings and try again.',
  'Push-уведомления недоступны: нужен HTTPS или localhost.':
    'Push notifications are unavailable: HTTPS or localhost is required.',
  'Не удалось включить push-уведомления.': 'Could not enable push notifications.',
  'К разделам': 'Back to sections',
  'Изменить фото': 'Change the photo',
  'Загрузить фото': 'Upload a photo',
  'Удалить фото': 'Delete the photo',
  'Разделы настроек': 'Settings sections',
  'Разделы администрирования': 'Administration sections',
  'Найти настройку': 'Find a setting',
  'Поиск по настройкам': 'Search in settings',
  'Аккаунт, переписка и вложения будут удалены безвозвратно.':
    'The account, your chats and attachments will be deleted permanently.',
  // Подписи чипов приходят из `utils/chatFilters.ts` и переводятся в сайдбаре.
  Все: 'All',
  Непрочитанные: 'Unread',
  Личные: 'Personal',
  Группы: 'Groups',
  Каналы: 'Channels',
  Архив: 'Archive',

  // --- Мессенджер: ошибки отправки (views/Messenger.vue) ---
  'Не удалось открыть одноразовое медиа': 'Could not open the one-time media',
  'Не удалось отправить сообщение': 'Could not send the message',
  'Не удалось отправить стикер': 'Could not send the sticker',
  'Не удалось отправить ответ': 'Could not send the reply',
  'Ссылка не действует — попросите новую': 'The link is no longer valid — ask for a new one',
  'Не удалось войти в группу': 'Could not join the group',

  // --- Вход: создание пароля ---
  'Создание аккаунта': 'Creating an account',
  'Придумайте пароль': 'Create a password',
  'Номер {phone} подтверждён — задайте пароль, чтобы дальше входить без кода.':
    'Number {phone} is confirmed — set a password to log in without a code next time.',
  'Номер {phone} ещё не зарегистрирован — придумайте пароль.':
    'Number {phone} is not registered yet — create a password.',
  'Для номера {phone} ещё нет пароля — задайте его.':
    'Number {phone} has no password yet — set one.',
  'Не короче {count} символов': 'At least {count} characters',
  'Повторите пароль': 'Repeat the password',
  'Повтор пароля': 'Repeat password',
  'Пароли не совпадают.': 'Passwords do not match.',
  'Не удалось создать пароль.': 'Could not create the password.',
  'Сохранение…': 'Saving…',
  'Сохранить пароль и войти': 'Save the password and sign in',
  'Создать пароль и войти': 'Create a password and sign in',
  'Отметьте согласие с правилами сервиса — без него аккаунт создать нельзя.':
    'Accept the terms of service — the account cannot be created without it.',

  // --- Вход: e-mail (код из письма, сброс пароля) ---
  'Вход по e-mail': 'Log in with email',
  'Восстановление пароля': 'Password reset',
  'Пришлём код на подтверждённый адрес аккаунта.':
    'We will send a code to the confirmed email of the account.',
  'Пришлём код на подтверждённый адрес, затем задайте новый пароль.':
    'We will send a code to the confirmed email, then set a new password.',
  'Введите e-mail.': 'Enter the e-mail.',
  'Код отправлен на e-mail.': 'Code sent to the e-mail.',
  'Не удалось отправить код на e-mail.': 'Could not send the code to the e-mail.',
  'Код из письма': 'Code from the email',
  'Введите код из письма.': 'Enter the code from the email.',
  'Неверный или истёкший код из письма.': 'Wrong or expired code from the email.',
  'Новый пароль': 'New password',
  'Повтор нового пароля': 'Repeat the new password',
  Подтвердить: 'Confirm',
  'Вернуться к входу по номеру': 'Back to phone login',

  // --- Вход: новое устройство (2FA кодом из письма) ---
  'Новое устройство': 'New device',
  'Вход с этого устройства выполняется впервые. Введите код из письма':
    'This is the first login from this device. Enter the code from the email',
  '(отправлен на': '(sent to',
  '— так мы убедимся, что это вы.': '— this way we make sure it is you.',
  'Код подтверждения из письма': 'Confirmation code from the email',
  'Скрыть код': 'Hide code',
  'Показать код': 'Show code',
  'Подтвердить вход': 'Confirm login',
  'Код не пришёл? Проверьте папку «Спам». Отправить письмо ещё раз можно, войдя заново — если прошла минута с прошлой отправки, придёт новый код, иначе действует предыдущий.':
    'No code? Check the “Spam” folder. You can request another email by logging in again — if a minute has passed since the last one, a new code will arrive, otherwise the previous one is still valid.',
  'Неверный или истёкший код. Попробуйте войти заново.':
    'Wrong or expired code. Please log in again.',
  Вернуться: 'Back',

  // --- Вход: заморозка аккаунта ---
  'Аккаунт заморожен': 'Account frozen',
  'Все устройства вышли из аккаунта, вход закрыт — так работает защита от угона. Вернуть доступ можно кодом на подтверждённый e-mail аккаунта.':
    'All devices were logged out and login is closed — this is how the anti-hijack protection works. You can restore access with a code sent to the confirmed e-mail of the account.',
  'E-mail аккаунта': 'Account e-mail',
  'Разморозить аккаунт': 'Unfreeze account',
  'Отправить код': 'Send code',
  'Не удалось отправить код на этот адрес.': 'Could not send the code to this address.',
  'Нет доступа к почте аккаунта? Напишите на': 'No access to the account e-mail? Write to',
  '— вернём доступ вручную.': '— we will restore access manually.',
  'Войти в другой аккаунт': 'Log in to another account',

  // --- Согласие с документами ---
  'Продолжая, вы соглашаетесь с': 'By continuing you agree to the',
  'политикой конфиденциальности': 'privacy policy',
  'пользовательским соглашением': 'terms of service',
  'правилами сообщества': 'community guidelines',
  'и обработкой персональных данных.': 'and to the processing of personal data.',
  'Вход успешен!': 'Logged in!'
}
