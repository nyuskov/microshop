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
  'Вход успешен!': 'Logged in!',

  // --- Экран звонка (components/calls/*) ---
  'Входящий видеозвонок': 'Incoming video call',
  Отклонить: 'Decline',
  Отменить: 'Cancel',
  'Звоним…': 'Calling…',
  'Голосовой звонок': 'Voice call',
  'Камера собеседника выключена': 'The camera of the other person is off',
  'Собеседник выключил микрофон': 'The other person turned the microphone off',
  'Микрофон собеседника выключен': 'The microphone of the other person is off',
  'Микрофон выключен': 'Microphone off',
  'Микрофон включён': 'Microphone on',
  'Плохая связь': 'Poor connection',
  'Видео приостановлено': 'Video paused',
  'Связь слабая — видео приостановлено, чтобы не пропадал звук':
    'The connection is weak — video paused so the sound keeps coming through',
  'Связь слабая — видео приостановлено (верните в меню «Ещё»)':
    'The connection is weak — video paused (turn it back on in the “More” menu)',
  'Вы показываете экран': 'You are sharing your screen',
  'Собеседник показывает экран': 'The other person is sharing the screen',
  'Показываете экран': 'You are sharing the screen',
  'Показывает экран': 'Sharing the screen',
  Микрофон: 'Microphone',
  Камера: 'Camera',
  Динамик: 'Speaker',
  Звук: 'Sound',
  'Обработка звука': 'Audio processing',
  'Чистый голос': 'Clear voice',
  Естественный: 'Natural',
  'Показать экран': 'Share the screen',
  'Остановить показ экрана': 'Stop sharing the screen',
  'Скрыть меню': 'Hide the menu',
  'Обычный режим': 'Earpiece mode',
  'Громкая связь': 'Speakerphone',
  'Вернуть видео': 'Resume video',
  'Передняя камера': 'Front camera',
  'Задняя камера': 'Rear camera',
  'Устройства звонка': 'Call devices',
  'Окно поверх других': 'Always-on-top window',
  'Диагностика звонка': 'Call diagnostics',
  'Код сверки': 'Verification code',
  'Код появится, когда соединение установится.':
    'The code will appear once the connection is established.',
  'Сравните код с собеседником вслух — по телефону или голосом. Совпал — разговор идёт именно между вами, сервер в середине отсутствует. Код меняется у каждого нового звонка: сверять надо каждый раз.':
    'Compare the code out loud with the other person — over the phone or in voice. If it matches, the conversation goes directly between the two of you and no server sits in the middle. The code changes with every new call: compare it every time.',
  'Собираем данные о соединении…': 'Collecting connection data…',
  Скопировать: 'Copy',
  'Список устройств появится после разрешения доступа к камере и микрофону.':
    'The device list will appear once you allow access to the camera and microphone.',
  'Переподключаемся…': 'Reconnecting…',
  'Сбросить вызов: {name}': 'Cancel the call to {name}',
  'Убрать из звонка: {name}': 'Remove {name} from the call',
  'Пользователь {id}': 'User {id}',

  // --- Экран звонка: панель диагностики ---
  'через релей (TURN{protocol})': 'via relay (TURN{protocol})',
  'через релей{protocol}': 'via relay{protocol}',
  'напрямую через NAT': 'directly via NAT',
  напрямую: 'directly',
  'определяем…': 'determining…',
  полоса: 'bandwidth',
  процессор: 'CPU',
  прочее: 'other',
  '{value} мс': '{value} ms',
  '{value} кбит/с': '{value} kbps',
  Соединение: 'Connection',
  Маршрут: 'Route',
  Задержка: 'Latency',
  Потери: 'Loss',
  'Потери у собеседника': 'Loss on the other side',
  Дрожание: 'Jitter',
  'Буфер воспроизведения': 'Playback buffer',
  Приём: 'Incoming',
  Отправка: 'Outgoing',
  'Полоса (оценка)': 'Bandwidth (estimate)',
  Ограничивает: 'Limited by',
  'Видео теряется': 'Video drops',
  '{freezes} заморозок · {dropped} кадров': '{freezes} freezes · {dropped} frames',
  Кодеки: 'Codecs',
  'Звонок: {kind}, {time}': 'Call: {kind}, {time}',
  видео: 'video',
  аудио: 'audio',
  'Участник {name}: {value}': 'Participant {name}: {value}',
  'Итого: {summary}': 'Total: {summary}',
  '{route} · {rtt} мс{loss}': '{route} · {rtt} ms{loss}',
  ', потери {loss}%': ', {loss}% loss',
  'задержка {rtt} мс': 'latency {rtt} ms',
  'приём: потери {loss}%': 'incoming: {loss}% loss',
  'наш поток: потери {loss}%': 'our stream: {loss}% loss',
  'ступень: {step}': 'step: {step}',
  'нет данных': 'no data',
  плохая: 'bad',
  средняя: 'fair',
  хорошая: 'good',

  // --- Эффекты видео (components/calls/CallEffectsDialog.vue) ---
  'Эффекты видео': 'Video effects',
  'Эффекты недоступны на этом устройстве': 'Effects are unavailable on this device',
  Цвет: 'Color',
  'Эффект кадра': 'Frame effect',
  'Без эффекта': 'No effect',
  Тёплый: 'Warm',
  Холодный: 'Cool',
  'Ч/б': 'B&W',
  Плёнка: 'Film',
  'Мягкая кожа': 'Soft skin',
  Маска: 'Mask',
  'Маска на видео': 'Mask on video',
  'Без маски': 'No mask',
  Кошка: 'Cat',
  Собака: 'Dog',
  Очки: 'Glasses',
  Корона: 'Crown',
  'Маска меньше': 'Smaller mask',
  'Маска больше': 'Larger mask',
  'По центру': 'Center',
  'Потяните маску на своём видео, чтобы поставить её по лицу.':
    'Drag the mask on your own video to place it over your face.',
  'Убрать все эффекты': 'Remove all effects',
  'Эффекты считаются на вашем устройстве: кадр никуда не отправляется и собеседник видит уже готовую картинку.':
    'Effects are rendered on your device: the frame is never sent anywhere, and the other person sees the finished picture.',
  'Браузер не умеет обрабатывать видео на лету — эффекты недоступны':
    'The browser cannot process video on the fly — effects are unavailable',
  'Canvas недоступен — эффекты включить нельзя':
    'Canvas is unavailable — effects cannot be turned on',
  'Браузер не умеет снимать поток с canvas': 'The browser cannot capture a stream from canvas',
  'Не удалось получить обработанную дорожку': 'Could not get the processed track',
  'Не удалось включить эффекты': 'Could not turn on the effects',

  // --- История звонков (components/messenger/CallHistoryDialog.vue) ---
  'Фильтр звонков': 'Call filter',
  'Загружаем звонки…': 'Loading calls…',
  'Пропущенных нет': 'No missed calls',
  'Звонков пока нет': 'No calls yet',
  'Здесь появятся звонки, на которые вы не ответили.': 'Calls you did not answer will appear here.',
  'Позвоните собеседнику из шапки чата — звонок появится здесь.':
    'Call someone from the chat header — the call will appear here.',
  Перезвонить: 'Call back',
  'Перезвонить видео': 'Call back with video',
  'Перезвонить: {name}': 'Call back: {name}',
  'Показать ещё': 'Show more',
  'Не удалось загрузить историю звонков': 'Could not load the call history',
  Видео: 'Video',
  Аудио: 'Audio',
  Пропущенный: 'Missed',
  '{kind} · отклонён': '{kind} · declined',
  '{kind} · не ответили': '{kind} · no answer',
  Исходящий: 'Outgoing',
  Входящий: 'Incoming',
  '{direction} · {kind} · {duration}': '{direction} · {kind} · {duration}',
  '{direction} · {kind}': '{direction} · {kind}',
  'Удалённый аккаунт': 'Deleted account',
  'Без имени': 'No name',
  Видеозвонок: 'Video call',
  Аудиозвонок: 'Audio call',
  'Пропущенный видеозвонок': 'Missed video call',
  'Пропущенный звонок': 'Missed call',
  '{name} отклонён': '{name} declined',

  // --- Звонок: состояние и ошибки (stores/call.ts и модули) ---
  'Связь потеряна — звонок завершён': 'Connection lost — the call has ended',
  'Звук и видео не идут — попробуйте переключить сеть или перезвонить':
    'No sound and no video — try switching the network or calling back',
  'Звонок отменён': 'The call was cancelled',
  'Звонок завершён': 'The call has ended',
  'Звонок завершён: не удалось восстановить связь':
    'The call has ended: the connection could not be restored',
  'Никто не ответил': 'No one answered',
  'Абонент не отвечает': 'No answer',
  'Абонент занят': 'The line is busy',
  'Абонент сейчас недоступен': 'This person is unavailable right now',
  'Абонент отклонил звонок': 'The person declined the call',
  'Собеседник не смог ответить': 'The other person could not answer',
  'Вас убрали из звонка': 'You were removed from the call',
  'Звонок принят на другом устройстве': 'The call was answered on another device',
  'На другом устройстве не удалось ответить': 'Could not answer on another device',
  'На другом устройстве уже идёт звонок': 'A call is already going on another device',
  'Звонок отклонён на другом устройстве': 'The call was declined on another device',
  'Собеседник не в сети без уведомлений — звонок ждёт его в приложении':
    'The other person is offline with notifications off — the call is waiting in the app',
  'Собеседник не в сети — отправили уведомление о звонке':
    'The other person is offline — we sent a call notification',
  'В звонке уже {count} человека — больше не помещается':
    'The call already has {count} people — no room for more',
  'Не удалось подключиться к серверу звонков': 'Could not connect to the call server',
  'Не удалось ответить: нет связи с сервером':
    'Could not answer: there is no connection to the server',
  'Собеседник недоступен — звонок завершён': 'The other person is unreachable — the call has ended',
  'Камера недоступна — звонок продолжается без видео':
    'The camera is unavailable — the call continues without video',
  'Не удалось переключить камеру': 'Could not switch the camera',
  'Не удалось переключить микрофон': 'Could not switch the microphone',
  'Не удалось изменить обработку звука': 'Could not change the audio processing',
  'Показ экрана не начался: выбор окна отменён':
    'Screen sharing did not start: the window selection was cancelled',
  'Браузер не дал показать экран — попробуйте обычный Chrome':
    'The browser did not allow screen sharing — try regular Chrome',
  'Показ экрана работает только по защищённому соединению (HTTPS)':
    'Screen sharing works only over a secure connection (HTTPS)',
  'На телефоне показ экрана недоступен — включите его с компьютера':
    'Screen sharing is not available on a phone — turn it on from a computer',
  'Во встроенном браузере захват экрана не работает — откройте приложение в обычном Chrome':
    'Screen capture does not work in the embedded browser — open the app in regular Chrome',
  'Браузер не поддерживает демонстрацию экрана': 'The browser does not support screen sharing',

  // --- Звонок: доступ к камере и микрофону (stores/call/media.ts) ---
  'камере и микрофону': 'the camera and microphone',
  микрофону: 'the microphone',
  'камеру и микрофон': 'the camera and microphone',
  микрофон: 'the microphone',
  'Доступ к {subject} запрещён — разрешите его в настройках браузера':
    'Access to {subject} is blocked — allow it in the browser settings',
  'Не нашлось подходящего устройства: проверьте {device}':
    'No suitable device was found: check {device}',
  'Камера или микрофон заняты другим приложением — закройте его и попробуйте снова':
    'The camera or microphone is busy in another application — close it and try again',
  'Не удалось получить доступ к {subject}': 'Could not get access to {subject}',
  'нет видеодорожки': 'no video track',

  // --- Проверка подлинности звонка (utils/callVerification.ts) ---
  'Через релей': 'Via relay',
  'Напрямую (P2P)': 'Direct (P2P)',
  'Маршрут: определяем…': 'Route: determining…',
  'Медиа шифруется между участниками (DTLS-SRTP), релей только пересылает зашифрованные пакеты и расшифровать их не может':
    'Media is encrypted between the participants (DTLS-SRTP); the relay only forwards encrypted packets and cannot decrypt them',
  'Медиа идёт напрямую между устройствами и защищено сквозным шифрованием (DTLS-SRTP)':
    'Media flows directly between the devices and is protected with end-to-end encryption (DTLS-SRTP)',
  'Соединение ещё устанавливается': 'The connection is still being established',

  // --- Мессенджер: выбор сообщений и канал (views/Messenger.vue) ---
  'Открываю чат': 'Opening the chat',
  'Выйти из выбора': 'Exit selection',
  'Выбрано: {count}': 'Selected: {count}',
  'Переслать выбранные': 'Forward selected',
  'Сохранить в «Сохранённые сообщения»': 'Save to “Saved messages”',
  'Удалить для {name}': 'Delete for {name}',
  'Публикуют владелец и админы канала': 'Only the owner and channel admins can post',
  'Предложить пост': 'Suggest a post',
  Комментарии: 'Comments',
  Эмодзи: 'Emoji',
  Стикеры: 'Stickers',
  'Подписчики · {count}': 'Subscribers · {count}',
  'Предложки · {count}': 'Suggestions · {count}',
  'Добавить набор': 'Add the set',

  // --- Вложения и превью (utils/media.ts, utils/chatPreview.ts) ---
  Изображение: 'Image',
  'Голосовое сообщение': 'Voice message',
  Видеосообщение: 'Video message',
  'Файл: {name}': 'File: {name}',
  '📞 Звонок': '📞 Call',
  '📷 Изображение': '📷 Image',
  '🎤 Голосовое': '🎤 Voice',
  '🎥 Видео': '🎥 Video',
  '🔒 Сообщение': '🔒 Message',
  '🔒 Изображение': '🔒 Image',
  '🔒 Видео': '🔒 Video',
  '🔒 Голосовое': '🔒 Voice message',
  '🔒 Вложение': '🔒 Attachment',
  'Нет сообщений': 'No messages',
  '{prefix}↪ Переслано: {body}': '{prefix}↪ Forwarded: {body}',
  'Выберите, кому хотели бы написать': 'Choose who you would like to write to',
  'Начните переписку: найдите собеседника по логину или телефону.':
    'Start a chat: find the person by username or phone number.',

  // --- Вложения: подписи (components/messenger/MessageAttachment.vue) ---
  'Открыть изображение «{name}»': 'Open the image “{name}”',
  'Открыть набор стикеров': 'Open the sticker set',
  'Вложение просмотрено': 'The attachment has been viewed',
  'Открыть (сгорит после просмотра)': 'Open (it disappears after viewing)',
  Просмотрено: 'Viewed',
  'Медиа больше недоступно': 'The media is no longer available',
  'Сгорит после открытия': 'Disappears after opening',
  'Одноразовое видео': 'One-time video',
  'Одноразовое фото': 'One-time photo',
  '🔒 Не удалось расшифровать': '🔒 Could not decrypt',
  '🔒 Расшифровываем…': '🔒 Decrypting…',
  'Стикер недоступен': 'The sticker is unavailable',
  'Изображение недоступно': 'The image is unavailable',

  // --- Приглашения (components/messenger/InvitesSettings.vue) ---
  'Публичной регистрации нет: аккаунт создаётся только по личной ссылке. Ссылка одноразовая — после успешной регистрации гаснет, а передать её нужно лично приглашённому.':
    'There is no public sign-up: an account is created only via a personal link. The link is single-use — it goes out after a successful registration, and you have to hand it to the invitee in person.',
  'Новая ссылка': 'New link',
  'Номер телефона (необязательно)': 'Phone number (optional)',
  'Номер телефона для приглашения': 'Phone number for the invitation',
  'Заметка для себя': 'Note for yourself',
  'Например: для Пети': 'For example: for Pete',
  'Срок действия': 'Expires in',
  'Создаём…': 'Creating…',
  'Создать ссылку': 'Create a link',
  Отправить: 'Send',
  'QR-код ссылки-приглашения': 'QR code of the invitation link',
  'Выданные ссылки': 'Issued links',
  'Ссылок пока нет.': 'No links yet.',
  'создано {date}': 'created {date}',
  'до {date}': 'until {date}',
  'использовано {date}': 'used {date}',
  'отозвано {date}': 'revoked {date}',
  'Без заметки': 'No note',
  'Не удалось загрузить приглашения': 'Could not load the invitations',
  'Номер заполнен не полностью — либо очистите поле, либо введите его целиком.':
    'The phone number is incomplete — either clear the field or enter it in full.',
  'Ссылка создана — скопируйте и передайте её лично.':
    'The link is ready — copy it and hand it over in person.',
  'Не удалось создать приглашение': 'Could not create the invitation',
  'Ссылка отозвана — по ней больше нельзя зарегистрироваться.':
    'The link has been revoked — no one can sign up with it anymore.',
  'Приглашение в Pismo': 'Invitation to Pismo',
  Бессрочно: 'No expiry',
  '1 день': '1 day',
  '7 дней': '7 days',
  '30 дней': '30 days',
  действует: 'active',
  использована: 'used',
  отозвана: 'revoked',
  истекла: 'expired',

  // --- Жалобы и журнал модерации (components/messenger/ModerationReportsSection.vue) ---
  Журнал: 'Journal',
  'Журнал модерации: что и когда произошло с контентом — отправили жалобу, автомат скрыл сообщение после нескольких жалоб, модератор подтвердил нарушение или восстановил контент. Записи не меняются, поэтому на них можно ссылаться при разборе спорных случаев.':
    'Moderation journal: what happened to content and when — a report was filed, the automatic filter hid a message after several reports, a moderator confirmed a violation or restored the content. Entries never change, so they can be referred to when reviewing disputed cases.',
  'Скрыто сейчас: {hidden} · записей в журнале: {total}':
    'Hidden now: {hidden} · journal entries: {total}',
  'Журнал пуст.': 'The journal is empty.',
  автоматика: 'automatic',
  'модератор #{id}': 'moderator #{id}',
  'сообщение #{id}': 'message #{id}',
  'жалоба #{id}': 'report #{id}',
  'автор #{id}': 'author #{id}',
  'Восстановить все сообщения автора': 'Restore all messages of this author',
  'Жалобы приходят из приложения: «Пожаловаться» в шапке диалога или в меню сообщения. Разбор нигде, кроме этой таблицы, не отображается — статус нужен, чтобы не разбирать одно дважды.':
    'Reports come from the app: “Report” in the dialog header or in the message menu. The review is not shown anywhere except this table — the status is needed so the same case is not reviewed twice.',
  'Жалоб в этом разделе нет.': 'There are no reports in this section.',
  'Всего: {total}': 'Total: {total}',
  'Сообщение #{id} (вложение или удалено)': 'Message #{id} (attachment or deleted)',
  'Контекст: {context}': 'Context: {context}',
  ' · заметка: {note}': ' · note: {note}',
  'Комментарий:': 'Comment:',
  'Заметка (необязательно)': 'Note (optional)',
  'Заметка по жалобе {id}': 'Note on report {id}',
  'Не удалось загрузить жалобы': 'Could not load the reports',
  'Не удалось изменить статус': 'Could not change the status',
  'чат #{id}': 'chat #{id}',
  'без чата (жалоба на профиль)': 'no chat (report on a profile)',
  'Не удалось загрузить журнал': 'Could not load the journal',
  'Не удалось восстановить сообщения': 'Could not restore the messages',
  Новые: 'New',
  'В работе': 'In review',
  Решённые: 'Resolved',
  Отклонённые: 'Rejected',
  Новая: 'New',
  Решена: 'Resolved',
  Отклонена: 'Rejected',
  'В работу': 'Start review',
  'Спам или реклама': 'Spam or advertising',
  'Оскорбления и травля': 'Abuse and harassment',
  Мошенничество: 'Fraud',
  'Угрозы и насилие': 'Threats and violence',
  Другое: 'Other',
  'Жалоба отправлена': 'Report filed',
  'Авто-скрытие по жалобам': 'Auto-hidden after reports',
  'Решение по жалобе': 'Report decision',
  'Сообщение скрыто модератором': 'Message hidden by a moderator',
  'Сообщение восстановлено': 'Message restored',

  // --- Стикеры: паки и наборы (components/messenger/Sticker*Dialog.vue) ---
  'Мои стикеры': 'My stickers',
  'Как в остальных чатах': 'Same as other chats',
  'Стикер — картинка из вашего набора: в переписке он отправляется тапом в панели стикеров и показывается без пузыря. Подходят PNG, WebP и GIF до 512 КБ; крупные картинки сервер сам уменьшает, а анимацию оставляет как есть.':
    'A sticker is an image from your set: in a chat it is sent by tapping in the sticker panel and is shown without a bubble. PNG, WebP and GIF up to 512 KB will do; the server shrinks large images on its own and leaves animations as they are.',
  'Новый пак': 'New pack',
  'Наборы приложения': 'App sets',
  '{count} шт.': '{count} pcs',
  'Название нового пака': 'Name of the new pack',
  'Название пака': 'Pack name',
  'Паков пока нет. Создайте первый — и добавьте в него картинки.':
    'No packs yet. Create the first one and add images to it.',
  'Снять набор с публикации': 'Unpublish the set',
  'Опубликовать набор для всех': 'Publish the set for everyone',
  'Набор публичный: его видят все и могут добавить себе':
    'The set is public: everyone sees it and can add it',
  'Опубликовать набор: его увидят все и смогут добавить себе':
    'Publish the set: everyone will see it and can add it',
  'Пак выше': 'Move the pack up',
  'Пак ниже': 'Move the pack down',
  'Удалить пак': 'Delete the pack',
  'Стикер в паке {title}': 'Sticker in the pack {title}',
  'Удалить стикер из пака {title}': 'Delete the sticker from the pack {title}',
  'В паке пусто.': 'The pack is empty.',
  'Добавить стикеры': 'Add stickers',
  'Не удалось изменить публикацию': 'Could not change the publication',
  'Не удалось создать пак': 'Could not create the pack',
  'Не удалось переименовать пак': 'Could not rename the pack',
  'Удалить пак «{title}»?': 'Delete the pack “{title}”?',
  '{count} стикеров исчезнут из библиотеки. Отправленные сообщения со стикерами останутся.':
    '{count} stickers will disappear from the library. Messages already sent with stickers will stay.',
  'Не удалось удалить пак': 'Could not delete the pack',
  'Не удалось удалить стикер': 'Could not delete the sticker',
  '{name} — больше {size} КБ': '{name} — larger than {size} KB',
  'Набор «{title}»': 'The set “{title}”',
  'Отправить: {name}': 'Send: {name}',
  'Отправить стикер {name}': 'Send the sticker {name}',
  'В наборе пока нет стикеров.': 'The set has no stickers yet.',
  'Это ваш набор': 'This is your set',
  'Не удалось добавить набор': 'Could not add the set',

  // --- Экранные состояния, ошибки, обслуживание ---
  'Закрыть сообщение об ошибке': 'Dismiss the error message',
  'Что-то пошло не так': 'Something went wrong',
  Перезагрузить: 'Reload',
  'Продолжить работу': 'Continue',
  'Ошибка повторяется? Напишите на': 'Does the error keep happening? Write to',
  'Идут технические работы': 'Maintenance is in progress',
  'Проверить снова': 'Check again',
  'Работы обычно занимают несколько минут — страница обновится сама.':
    'Maintenance usually takes a few minutes — the page will refresh itself.',
  'Страница не найдена': 'Page not found',
  'К чатам': 'To the chats',
  Назад: 'Back',
  'Кажется, это ошибка приложения?': 'Looks like an app error?',
  'Переход на внешний сайт': 'Leaving for an external site',
  'Это был(а) я': 'It was me',

  // --- Скачивание, вложения, подписи ---
  'Остановить скачивание': 'Stop the download',
  'Переводит браузер устройства; текст в E2EE-чате на сервер не уходит.':
    'Translated by the browser on your device; text from an E2EE chat never goes to the server.',
  'Сообщения отправятся, когда связь вернётся': 'Messages will be sent once the connection is back',
  'Отправка вложения': 'Sending the attachment',
  'Добавьте подпись…': 'Add a caption…',
  'Подпись к вложению': 'Caption for the attachment',
  Скачать: 'Download',
  'в файл': 'to a file',
  'Можно перетащить несколько файлов сразу': 'You can drag several files at once',
  или: 'or',
  'Отправить в Pismo': 'Send to Pismo',
  'Содержимое из другого приложения': 'Content from another application',
  'Смотреть в плавающем окне': 'Watch in a floating window',
  'Видео недоступно': 'The video is unavailable',
  Вложения: 'Attachments',

  // --- Поиск ---
  'Поиск по списку': 'Search the list',
  'Ничего не найдено': 'Nothing found',
  'Ничего не найдено.': 'Nothing found.',
  Найти: 'Find',
  'Найти людей': 'Find people',
  'Никого не найдено': 'No one found',
  'Найдено в чатах': 'Found in chats',
  'Найдены в мессенджере': 'Found in the messenger',
  'Поиск…': 'Search…',
  'Поиск чата': 'Search for a chat',
  'Поиск чата…': 'Search for a chat…',
  'Поиск чата для папки': 'Search for a chat for the folder',
  'Область поиска': 'Search scope',
  'Публичные каналы': 'Public channels',
  'Вы подписаны': 'You are subscribed',

  // --- Изображения, просмотрщик, GIF ---
  'Просмотр изображения': 'Image viewer',
  'Скачать изображение': 'Download the image',
  'Закрыть (Esc)': 'Close (Esc)',
  'Назад (←)': 'Back (←)',
  'Вперёд (→)': 'Forward (→)',
  'Предыдущее изображение': 'Previous image',
  'Следующее изображение': 'Next image',
  'Открываем изображение': 'Opening the image',
  'Поиск GIF…': 'Search GIFs…',
  'Отправить GIF': 'Send a GIF',
  Перемотка: 'Seeking',
  'Ещё раз': 'Try again',
  Повторить: 'Retry',
  'Язык речи': 'Speech language',
  'Видеосообщение (кружок)': 'Video message (round)',
  'Отменить запись': 'Cancel the recording',
  'Запись голосового сообщения': 'Recording a voice message',
  'Остановить запись': 'Stop the recording',
  Прослушать: 'Listen',

  // --- Папки чатов ---
  Папки: 'Folders',
  '· только звонки': '· calls only',
  'Папок пока нет — создайте первую прямо здесь.':
    'No folders yet — create the first one right here.',
  'Папок пока нет. Создайте первую — например, «Работа».':
    'No folders yet. Create the first one — for example, “Work”.',
  'Название новой папки': 'Name of the new folder',
  'Название папки': 'Folder name',
  'Папки чатов': 'Chat folders',
  'В папке пока нет чатов.': 'The folder has no chats yet.',
  'Удалить папку': 'Delete the folder',
  Выше: 'Up',
  Ниже: 'Down',
  Готово: 'Done',

  // --- Контакты ---
  Контакт: 'Contact',
  'Имя контакта': 'Contact name',
  'Например: Мама': 'For example: Mom',
  'Удалить из контактов': 'Remove from contacts',
  'Добавить в контакты': 'Add to contacts',
  'Поиск по логину или телефону': 'Search by username or phone number',
  'Поиск контактов': 'Search for contacts',
  'Закрыть результаты': 'Close the results',
  'Загрузка контактов…': 'Loading contacts…',
  'Ищем людей…': 'Searching for people…',
  'Из контактов телефона': 'From the phone contacts',
  'Номера телефонов': 'Phone numbers',

  // --- Профиль, статистика, хранилище ---
  Изображения: 'Images',
  'Изображений пока нет': 'No images yet',
  Файлы: 'Files',
  'Файлов пока нет': 'No files yet',
  'Считаем сообщения…': 'Counting messages…',
  'Активность за 30 дней': 'Activity over 30 days',
  'Кто пишет': 'Who writes',
  'Проверить шифрование': 'Check the encryption',
  'Проверка шифрования': 'Encryption check',
  собеседником: 'with the other person',
  'Считаем код…': 'Calculating the code…',
  'Код проверки': 'Verification code',
  'Скопировать код': 'Copy the code',
  'Код скопирован': 'The code has been copied',

  // --- Удаление аккаунта и копия ключей ---
  'Удаление аккаунта': 'Deleting the account',
  безвозвратно: 'permanently',
  'Пароль аккаунта': 'Account password',
  'Ключ шифрования': 'Encryption key',
  'Действие с копией': 'Action with the backup',
  'Парольная фраза': 'Passphrase',
  'Повторите фразу': 'Repeat the passphrase',
  'Фразу не восстановить: если забудете — копия останется запертой.':
    'The passphrase cannot be recovered: if you forget it, the backup stays locked.',
  'Файл копии': 'Backup file',
  'Новый вход в аккаунт': 'New login to the account',
  'Это не я — завершить все сессии': 'It was not me — end all sessions',
  'Это его устройство': 'This is their device',
  'Проверю позже': 'I will check later',
  'Собеседник сменил ключ шифрования': 'The other person changed the encryption key',

  // --- Каналы, группы, оставшиеся подписи чата ---
  'pismo.space/c/адрес': 'pismo.space/c/address',
  Опубликовать: 'Publish',
  'Переслать сообщение': 'Forward the message',
  'Например, «Семья» или «Коллеги»': 'For example, “Family” or “Colleagues”',
  'О чём эта группа?': 'What is this group about?',
  'Создать группу': 'Create a group',
  'Приглашение в группу': 'Invitation to a group',
  'Предыдущее (Shift+Enter)': 'Previous (Shift+Enter)',
  'Предыдущее совпадение': 'Previous match',
  'Следующее (Enter)': 'Next (Enter)',
  'Следующее совпадение': 'Next match',
  'Режим технических работ': 'Maintenance mode',
  'Текст на экране': 'Text on the screen',
  'Например: обновляем сервис, вернёмся к 15:00':
    'For example: we are updating the service, back at 15:00',

  // --- Закреплённые, реакции, напоминания ---
  'Закреплённые сообщения': 'Pinned messages',
  Скрыть: 'Hide',
  'Скрыть закреплённые сообщения': 'Hide the pinned messages',
  'Перейти к сообщению': 'Go to the message',
  'Кто поставил': 'Who set it',
  Реакции: 'Reactions',
  вы: 'you',
  'Напомнить о сообщении': 'Remind about the message',
  'Когда напомнить': 'When to remind',
  'Убрать напоминание': 'Remove the reminder',
  Отложенные: 'Scheduled',
  'Отменить отправку': 'Cancel sending',
  'Отменить отложенную отправку': 'Cancel the scheduled sending',

  // --- Жалобы и проверка шифрования ---
  Жалоба: 'Report',
  'Комментарий (необязательно)': 'Comment (optional)',
  'Что не так с этим пользователем или сообщением?': 'What is wrong with this user or message?',
  'Отправить жалобу': 'Send the report',

  // --- Истории ---
  'Загружаем истории…': 'Loading stories…',
  'Историй пока нет': 'No stories yet',
  'Кто смотрел': 'Who viewed',
  'Удалить историю': 'Delete the story',
  Предыдущая: 'Previous',
  Следующая: 'Next',
  'Кто отреагировал': 'Who reacted',
  'Реакций пока нет': 'No reactions yet',
  'Ответить на историю': 'Reply to the story',
  'Отправить ответ': 'Send the reply',
  'кто смотрел': 'who viewed',
  'Аудитория истории': 'Story audience',
  'Пока никто не смотрел': 'No one has viewed it yet',

  // --- Оформление (views/AppearanceSettings.vue) ---
  'Тема оформления': 'Theme',
  'Тёмная с': 'Dark from',
  'Начало тёмной темы': 'Dark theme starts',
  до: 'until',
  'Конец тёмной темы': 'Dark theme ends',
  'Чёрный фон (AMOLED)': 'Black background (AMOLED)',
  'Акцентный цвет': 'Accent color',
  'Цвет моих сообщений': 'Color of my messages',
  'Размер текста': 'Text size',
  Аа: 'Aa',
  'Действует на текст сообщений, поле ввода и список чатов.':
    'Applies to message text, the input field and the chat list.',
  'Обои окна сообщений': 'Wallpaper of the message window',
  'Ваше фото': 'Your photo',
  'Список чатов': 'Chat list',
  'Что делает свайп влево по строке чата. Свайп вправо всегда закрепляет чат.':
    'What a swipe left on a chat row does. A swipe right always pins the chat.',

  // --- Удаление чата и постов ---
  'Текст поста — его увидит владелец канала': 'Post text — the channel owner will see it',
  'Только у меня': 'Only for me',
  'Чат исчезнет из вашего списка; у собеседника останется.':
    'The chat will disappear from your list; the other person keeps it.',
  'Для всех': 'For everyone',
  'Чат и переписка будут удалены у всех участников.':
    'The chat and its messages will be deleted for all members.',

  // --- Оформление: подписи данных (stores/theme.ts, views/AppearanceSettings.vue) ---
  Светлая: 'Light',
  Тёмная: 'Dark',
  Системная: 'System',
  'По расписанию': 'Scheduled',
  'Чистый чёрный вместо тёмно-серого — экономит заряд на OLED':
    'Pure black instead of dark gray — saves battery on OLED',
  'Доступно в тёмной теме': 'Available in the dark theme',
  Убрать: 'Remove',
  'Сбросить настройки': 'Reset the settings',
  'Сбросить все настройки оформления?': 'Reset all appearance settings?',
  'Тема, обои, размер текста и акцентный цвет вернутся к значениям по умолчанию.':
    'The theme, wallpaper, text size and accent color will go back to their default values.',
  Сбросить: 'Reset',
  'Границы совпали — тема меняться не будет': 'The times are the same — the theme will not change',
  'с {from} до {to}': 'from {from} to {to}',
  ' (через ночь)': ' (overnight)',
  'сейчас тёмная': 'dark now',
  'сейчас светлая': 'light now',
  'Тёмная {window}{night}; {current}': 'Dark {window}{night}; {current}',
  Зелёный: 'Green',
  Синий: 'Blue',
  Бирюзовый: 'Turquoise',
  Фиолетовый: 'Violet',
  Розовый: 'Pink',
  Оранжевый: 'Orange',
  Красный: 'Red',
  Индиго: 'Indigo',
  Голубой: 'Light blue',
  Сирень: 'Lilac',
  Персик: 'Peach',
  Мята: 'Mint',
  Мелкий: 'Small',
  Обычный: 'Regular',
  Крупный: 'Large',
  'По умолчанию': 'Default',
  Небо: 'Sky',
  Графит: 'Graphite',
  Океан: 'Ocean',
  Закат: 'Sunset',
  'Не удалось прочитать файл': 'Could not read the file',
  'Файл не является изображением': 'The file is not an image',
  'Canvas недоступен': 'Canvas is unavailable',

  // --- Свайп по строке чата (utils/chatSwipe.ts) ---
  'Чат скрывается из списка, вернуть — из фильтра «Архив»':
    'The chat is hidden from the list; bring it back from the “Archive” filter',
  'Выключает и включает уведомления по этому чату': 'Turns notifications for this chat off and on',

  // --- Наборы стикеров приложения (utils/standardStickers.ts) ---
  Ок: 'OK',
  Да: 'Yes',
  Нет: 'No',
  Спасибо: 'Thanks',
  Пожалуйста: "You're welcome",
  Привет: 'Hi',
  Пока: 'Bye',
  Согласен: 'Agreed',
  Смешно: 'Funny',
  Люблю: 'Love',
  Извини: 'Sorry',
  Минуту: 'One minute',
  Отлично: 'Great',
  Сомневаюсь: 'Not sure',
  Обнимаю: 'Hugs',
  Поздравляю: 'Congrats',
  Работа: 'Work',
  Созвон: 'Call',
  Встреча: 'Meeting',
  Дедлайн: 'Deadline',
  Отчёт: 'Status report',
  'В отпуске': 'On vacation',
  Вопрос: 'Question',
  Еда: 'Food',
  Кофе: 'Coffee',
  Обед: 'Lunch',
  Чай: 'Tea',
  Голоден: 'Hungry',
  Вкусно: 'Tasty',
  Пицца: 'Pizza',
  Торт: 'Cake',
  Счёт: 'Bill',
  Праздники: 'Holidays',
  'С Новым годом': 'Happy New Year',
  'С днём рождения': 'Happy birthday',
  'С Рождеством': 'Merry Christmas',
  Ура: 'Hooray',
  Подарок: 'Gift',
  Праздник: 'Celebration',
  'Спасибо!': 'Thanks!',

  // --- Импорт набора стикеров (composables/useStandardSetImport.ts) ---
  'Добавляем {done} из {total}': 'Adding {done} of {total}',
  'Ждём лимит загрузок ({seconds} с) · {done}':
    'Waiting for the upload limit ({seconds} s) · {done}',
  'Добавлено {added} из {total}: часть стикеров не загрузилась. Набор можно добавить ещё раз.':
    'Added {added} of {total}: some stickers failed to upload. You can add the set again.',

  // --- Даты, присутствие, размеры (utils/format.ts) ---
  Сегодня: 'Today',
  Вчера: 'Yesterday',
  'был(а) только что': 'last seen just now',
  'был(а) вчера': 'last seen yesterday',
  'был(а) {count} {noun} назад': 'last seen {count} {noun} ago',
  '{size} Б': '{size} B',
  '{size} КБ': '{size} KB',
  '{size} МБ': '{size} MB',

  // --- Тексты ошибок сервера (services/errors.ts) ---
  'Произошла ошибка.': 'Something went wrong.',
  'Сервер не принял запрос. Проверьте данные и попробуйте ещё раз.':
    'The server rejected the request. Check the data and try again.',
  'Сессия истекла — войдите заново.': 'The session has expired — please log in again.',
  'Недостаточно прав для этого действия.': 'You do not have permission for this action.',
  'Не найдено: возможно, данные уже удалили.': 'Not found: the data may have been deleted already.',
  'Это действие здесь не поддерживается.': 'This action is not supported here.',
  'Не получилось: данные уже изменились (например, с другого устройства). Обновите и повторите.':
    'That did not work: the data has already changed (for example, from another device). Refresh and try again.',
  'Файл слишком большой — сервер не принял загрузку. Выберите файл меньше.':
    'The file is too large — the server rejected the upload. Choose a smaller file.',
  'Такой формат файла не поддерживается.': 'This file format is not supported.',
  'Данные не прошли проверку на сервере.': 'The data did not pass validation on the server.',
  'Слишком много запросов. Подождите немного и повторите.':
    'Too many requests. Wait a little and try again.',
  'Ошибка на сервере. Попробуйте позже.': 'Server error. Try again later.',
  'Сервер перезапускается. Попробуйте ещё раз через минуту.':
    'The server is restarting. Try again in a minute.',
  'Сервис временно недоступен. Попробуйте позже.':
    'The service is temporarily unavailable. Try again later.',
  'Сервер не ответил вовремя. Проверьте связь и повторите.':
    'The server did not answer in time. Check your connection and try again.',
  'Нет подключения к серверу. Проверьте интернет и повторите.':
    'No connection to the server. Check your internet and try again.',

  // --- Подсказки и пояснения в разметке (второй проход кодмода) ---
  'Пока никто не комментировал. Будьте первым.': 'No comments yet. Be the first.',
  'Ссылка ведёт за пределы Pismo. Мы не проверяем чужие сайты и не отвечаем за их содержимое.':
    'The link leads outside Pismo. We do not check other sites and are not responsible for their content.',
  Перейти: 'Go',
  'Нужно один раз скачать модель перевода (десятки мегабайт) — это делает браузер, текст никуда не уходит.':
    'The translation model has to be downloaded once (tens of megabytes) — the browser does it, and your text never leaves the device.',
  'Скачать и перевести': 'Download and translate',
  Тренды: 'Trends',
  'Если слова не те — попробуйте другой язык и нажмите «Ещё раз».':
    'If the words are wrong, try another language and tap “Try again”.',
  'Нажмите «Запись», чтобы начать': 'Tap “Record” to start',
  'Так увидит собеседник': 'This is how the other person sees it',
  Запись: 'Recording',
  'Повторить доступ': 'Retry access',
  Стоп: 'Stop',
  Перезаписать: 'Overwrite',
  'Одноразовое медиа: после закрытия оно исчезнет у всех участников. Скриншот или запись экрана запретить нельзя — об этом честно предупреждаем.':
    'One-time media: after closing it disappears for all participants. Screenshots or screen recording cannot be prevented — we are honest about that.',
  'Заблокированные не могут писать вам, а их диалоги скрыты из списка. Для тех, кому запрещены только звонки, переписка остаётся. Здесь блокировку можно снять.':
    'Blocked people cannot write to you, and their dialogs are hidden from the list. For those with only calls blocked, the chat stays. You can unblock them here.',
  'Заблокированных пользователей нет.': 'There are no blocked users.',
  'Папка — свой список чатов с ручным порядком. Хранится на этом устройстве: на телефоне и на компьютере папки могут быть разными.':
    'A folder is your own list of chats with a manual order. It is stored on this device: folders on a phone and on a computer may differ.',
  'Обычный чат — текст виден в превью и уведомлениях. Зашифрованный — сообщения читают только участники, но текст скрыт в превью/уведомлениях.':
    'An ordinary chat shows the text in previews and notifications. In an encrypted one only the participants read the messages, while the text is hidden in previews and notifications.',
  'Чат зашифрован — показаны загруженные вложения.':
    'The chat is encrypted — loaded attachments are shown.',
  'В этом чате пока нет общих вложений': 'This chat has no shared attachments yet',
  'Имя видите только вы — в списке чатов, шапке и уведомлениях. Собеседник его не видит.':
    'Only you see this name — in the chat list, the header and notifications. The other person does not see it.',
  'Никого из вашей книги нет в мессенджере': 'None of your contacts is in the messenger',
  'У собеседников сохранится история переписки, но ваши сообщения исчезнут.':
    'The other people keep their chat history, but your messages will be gone.',
  'Здесь видно, что умеет ЭТО устройство и этот браузер. Самые частые «не работает» — про окружение, а не про приложение: во встроенном браузере редактора нет сервиса моделей Chrome, в WebView на телефоне нет распознавания речи, а показ экрана умеют только настольные браузеры.':
    'Here you can see what THIS device and this browser can do. The most common “does not work” issues are about the environment, not the app: the editor’s embedded browser has no Chrome model service, a phone WebView has no speech recognition, and only desktop browsers can share the screen.',
  'Проверяется только наличие возможностей — ничего не скачивается и никуда не отправляется. Модель перевода браузер скачает при первом переводе, и только после нажатия.':
    'Only the availability of features is checked — nothing is downloaded and nothing is sent anywhere. The browser downloads the translation model on the first translation, and only after you tap.',
  'Ключ сквозного шифрования живёт только в этом браузере: переустановка приложения, очистка данных или потеря телефона делают переписку в зашифрованных чатах нечитаемой — сервер расшифровать её не может. Копия ключа, зашифрованная вашей парольной фразой, возвращает доступ на новом устройстве.':
    'The end-to-end encryption key lives only in this browser: reinstalling the app, clearing the data or losing the phone makes the encrypted chats unreadable — the server cannot decrypt them. A key backup encrypted with your passphrase restores access on a new device.',
  'Файл копии и парольная фраза вместе — это доступ ко всей переписке. Храните их отдельно друг от друга (фразу удобно держать в менеджере паролей) и никому не пересылайте: поддержка такую копию никогда не попросит.':
    'The backup file and the passphrase together give access to all your chats. Keep them apart (a password manager is a good place for the passphrase) and never forward them to anyone: support will never ask for such a backup.',
  'Ключ этого браузера будет заменён ключом из копии, а приложение — перезапущено, чтобы перечитать переписку.':
    'The key of this browser will be replaced with the key from the backup, and the app will restart to re-read the chats.',
  'Нет других чатов для пересылки. Найдите собеседника и начните диалог.':
    'There are no other chats to forward to. Find someone and start a dialog.',
  'Включите, когда сервис обновляется или что-то чинится: вместо мессенджера все увидят понятный экран «идут технические работы» — без ошибок и пустых списков. Вход в аккаунт, уведомления о доступности и ваш собственный доступ продолжают работать, так что выключить режим можно оттуда же.':
    'Turn this on when the service is being updated or fixed: instead of the messenger everyone sees a clear “maintenance in progress” screen — with no errors and no empty lists. Logging in, availability notifications and your own access keep working, so you can turn the mode off from there as well.',
  'Сообщение уйдёт в назначенное время, даже если приложение закрыто. Текст останется только текстом: вложения отложить нельзя.':
    'The message will be sent at the set time even if the app is closed. It stays text only: attachments cannot be scheduled.',
  'Если это не он, новые сообщения сможет читать тот, кто получил доступ к его аккаунту.':
    'If this is not them, whoever gained access to the account will be able to read new messages.',
  'Сверьте код проверки в карточке чата или спросите его лично. Пока не сверили — не отправляйте сюда пароли и коды.':
    'Compare the verification code in the chat card or ask the person directly. Until you have compared it, do not send passwords or codes here.',
  'Браузер не открывает книгу напрямую — вставьте номера ниже (по одному в строке).':
    'The browser cannot open the phone book directly — paste the numbers below (one per line).',
  'Никого: реакции сняли (или приложение собеседника их не передаёт).':
    'No one: the reactions were removed (or the other person’s app does not relay them).',
  'Ключ собеседника пока неизвестен: проверять нечего, пока он не зайдёт в приложение.':
    'The other person’s key is not known yet: there is nothing to check until they open the app.',
  'Код меняется, если кто-то из вас зайдёт с нового устройства (ключ привязан к устройству). Тогда сверьте код заново — это нормально.':
    'The code changes if either of you logs in from a new device (the key is tied to the device). Then compare the code again — that is normal.',
  'Заморозка закрывает вход полностью — разморозить можно кодом на подтверждённый e-mail аккаунта.':
    'A freeze closes login completely — you can unfreeze it with a code sent to the confirmed e-mail of the account.',
  'Чатов пока нет. Найдите собеседника в «Контактах» — и вернитесь к отправке.':
    'No chats yet. Find someone in “Contacts” and come back to send it.',
  'История — это фото или видео на 24 часа. Друзья увидят её в этом разделе и в списке чатов.':
    'A story is a photo or a video for 24 hours. Friends see it in this section and in the chat list.',
  'Здесь появятся истории друзей — они живут 24 часа.':
    'Your friends’ stories will appear here — they live for 24 hours.',
  'Это видео не проигрывается в браузере — его перекодирует сервер. Это может занять до минуты.':
    'This video does not play in the browser — the server is transcoding it. It can take up to a minute.',
  'Это видео не проигрывается в этом браузере — файл записан в формате, который он не умеет читать. Дальше показ продолжится.':
    'This video does not play in this browser — the file is recorded in a format it cannot read. The show will go on.',
  'Публикуют владелец и админы: они увидят предложку в настройках канала.':
    'The owner and admins can post: they will see your suggestion in the channel settings.',

  // --- Политика паролей (utils/passwordPolicy.ts) ---
  'номер телефона': 'the phone number',
  'адрес почты': 'the e-mail address',
  логин: 'the username',
  'Пароль должен быть не короче {count} символов.':
    'The password must be at least {count} characters.',
  'Пароль не может быть длиннее {count} символов.':
    'The password cannot be longer than {count} characters.',
  'Такой пароль слишком часто встречается — выберите другой.':
    'This password is too common — choose another one.',
  'Пароль не должен состоять только из цифр.': 'The password cannot consist of digits only.',
  'Пароль не должен содержать {count} одинаковых символа подряд.':
    'The password cannot contain {count} identical characters in a row.',
  'Пароль не должен быть простой последовательностью символов.':
    'The password cannot be a simple sequence of characters.',
  'Пароль не должен содержать {what}.': 'The password cannot contain {what}.',
  Слабый: 'Weak',
  Хороший: 'Strong',
  Нормальный: 'Medium',

  // --- Перевод сообщений (utils/translation.ts) ---
  'Встроенный перевод Chrome не работает во встроенном браузере VS Code — откройте приложение в обычном Chrome':
    'Chrome built-in translation does not work in the embedded VS Code browser — open the app in regular Chrome',
  'Браузер не смог связаться со своим сервисом перевода — модель не скачивается':
    'The browser could not reach its translation service — the model is not downloading',
  'Перевод отменён': 'Translation cancelled',
  'В этом сообщении нет текста для перевода': 'This message has no text to translate',
  'Этот браузер не умеет переводить на устройстве': 'This browser cannot translate on the device',
  'Готовим перевод…': 'Preparing the translation…',
  'Сообщение уже на этом языке': 'The message is already in this language',
  'Браузер считает, что этой пары языков у него нет — попробуем загрузить модель':
    'The browser thinks it does not have this language pair — let us try to load the model',
  'Скачиваем модель перевода…': 'Downloading the translation model…',
  'Переводим…': 'Translating…',
  'Скачиваем модель перевода: {percent}%': 'Downloading the translation model: {percent}%',
  'Не удалось подготовить перевод — возможно, модель не скачалась':
    'Could not prepare the translation — the model may not have downloaded',
  'Для этой пары языков встроенный переводчик браузера недоступен — нужен Chrome 138+':
    'The built-in browser translator is not available for this language pair — Chrome 138+ is required',
  'Текст слишком длинный для перевода': 'The text is too long to translate',
  'Не удалось перевести сообщение': 'Could not translate the message',

  // --- Распознавание речи на устройстве (utils/voiceRecognition.ts) ---
  'Распознавание недоступно на этом устройстве': 'Recognition is not available on this device',
  'Этот браузер не умеет распознавать готовые записи':
    'This browser cannot recognise ready recordings',
  'В мобильном браузере распознаётся только микрофон, а не запись — расшифровка есть в приложении Pismo':
    'A mobile browser recognises only the microphone, not a recording — transcription is available in the Pismo app',
  'Этот браузер распознаёт только микрофон, а не запись — нужен Chrome на компьютере':
    'This browser recognises only the microphone, not a recording — use Chrome on a computer',
  'Не удалось распознать голосовое': 'Could not recognise the voice message',
  'Браузер не смог обратиться к своему сервису распознавания':
    'The browser could not reach its recognition service',
  'Браузер запретил распознавание речи': 'The browser blocked speech recognition',
  'Распознавание отменено': 'Recognition was cancelled',
  'Распознавание не получило звук — попробуйте ещё раз':
    'Recognition received no audio — try again',
  'Речь не разобрана — возможно, в записи тихо или шумно':
    'The speech was not recognised — the recording may be too quiet or noisy',
  'В записи не слышно речи — проверьте микрофон и попробуйте снова':
    'No speech can be heard in the recording — check the microphone and try again',
  'Не удалось подготовить звук': 'Could not prepare the audio',
  'Не удалось запустить распознавание': 'Could not start recognition',
  'Расшифровка на устройстве': 'On-device transcription',
  'Скачается модель распознавания ({title}, ~{size} МБ) — один раз. ':
    'The recognition model will be downloaded ({title}, ~{size} MB) — one time only. ',
  'Дальше расшифровка работает без интернета, звук и текст остаются на устройстве.':
    'After that, transcription works without the internet, and the audio and text stay on the device.',
  'Расшифровка отменена — модель не скачана':
    'Transcription cancelled — the model was not downloaded',

  // --- Безопасность аккаунта (composables/useAccountSecurity.ts) ---
  'Не удалось загрузить историю действий.': 'Could not load the activity history.',
  'Задайте пароль — сейчас вход возможен только по коду в Telegram.':
    'Set a password — right now you can only log in with a code in Telegram.',
  'Пароль слабый — замените его на длинную фразу.':
    'The password is weak — replace it with a long phrase.',
  'Добавьте e-mail — он понадобится для восстановления доступа.':
    'Add an e-mail — you will need it to restore access.',
  'Подтвердите e-mail — только подтверждённый адрес годится для входа и сброса пароля.':
    'Confirm the e-mail — only a confirmed address works for logging in and resetting the password.',
  'Сначала укажите e-mail и сохраните профиль.': 'First enter the e-mail and save the profile.',
  'Не удалось отправить код': 'Could not send the code',
  'E-mail подтверждён — теперь по нему можно входить и восстанавливать пароль.':
    'The e-mail is confirmed — you can now log in with it and reset the password.',
  'Неверный код из письма': 'Wrong code from the e-mail',
  'Пароль обновлён. Остальные устройства вышли из аккаунта.':
    'The password has been updated. Other devices have been logged out.',
  'Не удалось изменить пароль': 'Could not change the password',
  'Не удалось выйти на всех устройствах': 'Could not log out on all devices',
  'Не удалось загрузить устройства': 'Could not load the devices',
  'Устройство вышло из аккаунта.': 'The device has been logged out.',
  'Не удалось отозвать устройство': 'Could not revoke the device',
  'Неизвестное устройство': 'Unknown device',
  'Заморозка аккаунта': 'Account freeze',
  'Подтвердите паролем — так «заморозить» аккаунт не сможет тот, кто получил доступ к вашей сессии.':
    'Confirm with your password — this way whoever got into your session cannot “freeze” the account.',
  'Заморозить аккаунт?': 'Freeze the account?',
  'Все устройства выйдут, вход будет закрыт до разморозки кодом из письма.':
    'All devices will be logged out and login will stay closed until you unfreeze it with a code from the e-mail.',
  'Не удалось заморозить аккаунт': 'Could not freeze the account',

  // --- Копия ключа шифрования (services/e2eeBackup.ts) ---
  'Нет ключа устройства': 'There is no device key',
  'Шифрование в этом браузере недоступно': 'Encryption is not available in this browser',
  'Ключ в резервной копии повреждён: части не совпадают':
    'The key in the backup is damaged: its parts do not match',
  'Ключ устройства не найден — в этом браузере шифрование ещё не включалось':
    'The device key was not found — encryption has not been enabled in this browser yet',
  'Это не файл резервной копии (не читается как JSON)':
    'This is not a backup file (it does not read as JSON)',
  'Это не файл резервной копии Pismo или он повреждён':
    'This is not a Pismo backup file, or it is damaged',
  'Копия сделана более новой версией приложения — обновите приложение':
    'The backup was made by a newer version of the app — please update the app',
  'Копия сделана для другого аккаунта — войдите в него и повторите':
    'The backup was made for another account — log in to it and try again',
  'Не подошла парольная фраза (или файл повреждён)':
    'The passphrase did not match (or the file is damaged)',
  'Внутри копии не ключ устройства — файл повреждён':
    'The backup does not contain a device key — the file is damaged',
  'Внутри копии неполный ключ устройства — файл повреждён':
    'The backup contains an incomplete device key — the file is damaged',

  // --- Запись медиа (services/recorder.ts) ---
  'Нет доступа к микрофону/камере. Разрешите доступ: откройте сайт в Chrome, нажмите значок 🔒 рядом с адресом и включите «Микрофон» и «Камера», затем повторите. В установленном приложении доступ настраивается там же.':
    'No access to the microphone/camera. Allow it: open the site in Chrome, tap the 🔒 icon next to the address and enable “Microphone” and “Camera”, then try again. In the installed app the access is configured in the same place.',
  'Не найдено устройство записи (микрофон/камера).':
    'No recording device found (microphone/camera).',
  'Микрофон/камера заняты другим приложением. Закройте его и повторите.':
    'The microphone/camera is busy in another application. Close it and try again.',
  'Запись доступна только по HTTPS.': 'Recording is available over HTTPS only.',
  'Не удалось получить доступ к микрофону/камере.':
    'Could not get access to the microphone/camera.',

  // --- Истории и статистика (utils/stories.ts, utils/chatStats.ts) ---
  'только что': 'just now',
  'Всего: {label}': 'Total: {label}',
  'Всего: {label} · показаны последние {shown}': 'Total: {label} · showing the last {shown}',

  // --- Тексты скриптов компонентов (автообёртка) ---
  'Введите корректный номер телефона.': 'Enter a valid phone number.',
  'Не удалось завершить регистрацию.': 'Could not complete the registration.',
  'Не удалось открыть окно поверх других:': 'Could not open the always-on-top window:',
  'Нет подключения к интернету': 'No internet connection',
  'Соединение…': 'Connecting…',
  'Связь восстановлена': 'Connection restored',
  'Не выбрано': 'Not selected',
  'Не удалось воспроизвести аудио': 'Could not play the audio',
  'Загрузка записи прервана': 'The upload of the recording was interrupted',
  'Запись не загрузилась — проверьте связь': 'The recording did not upload — check your connection',
  'Запись повреждена — файл не читается': 'The recording is damaged — the file cannot be read',
  'Устройство не умеет играть этот формат': 'The device cannot play this format',
  'Не удалось загрузить гифки': 'Could not load the GIFs',
  'Не удалось найти гифки': 'Could not find GIFs',
  'Не удалось отправить GIF': 'Could not send the GIF',
  'Не удалось открыть плавающее окно:': 'Could not open the floating window:',
  'Распознаём — нажмите, чтобы отменить': 'Recognising — tap to cancel',
  'Скрыть текст расшифровки': 'Hide the transcript',
  'Расшифровать запись в текст': 'Transcribe the recording into text',
  'Готовим запись…': 'Preparing the recording…',
  'Скачиваем модель распознавания…': 'Downloading the recognition model…',
  'Распознаём на устройстве…': 'Recognising on the device…',
  'Слушаем запись…': 'Listening to the recording…',
  'Распознано на устройстве моделью в браузере — звук и текст никуда не отправлялись.':
    'Recognised on the device by the browser model — the audio and text were never sent anywhere.',
  'Распознано распознавателем устройства — наш сервер звук не получает.':
    'Recognised by the device recogniser — our server never receives the audio.',
  'Распознаёт браузер устройства — в E2EE-чате текст на сервер не уходит, но распознавание может обращаться к сервису браузера.':
    'The device browser does the recognition — in an E2EE chat the text never goes to the server, but recognition may contact the browser service.',
  'Не удалось загрузить список': 'Could not load the list',
  'Не удалось снять блокировку': 'Could not unblock',
  'Не удалось изменить блокировку': 'Could not change the block',
  'Чаты останутся на месте — удалится только сам список.':
    'The chats stay in place — only the list itself is deleted.',
  Файл: 'File',
  'Не удалось загрузить вложения': 'Could not load the attachments',
  'Не удалось загрузить статистику': 'Could not load the statistics',
  'Не удалось сохранить контакт': 'Could not save the contact',
  'Не удалось убрать из контактов': 'Could not remove from contacts',
  'Не удалось удалить аккаунт': 'Could not delete the account',
  'Удалить сообщение?': 'Delete the message?',
  'Сообщения исчезнут из вашей переписки.': 'The messages will disappear from your chat.',
  'Сообщение исчезнет из вашей переписки.': 'The message will disappear from your chat.',
  работает: 'works',
  'с оговоркой': 'with a caveat',
  недоступно: 'unavailable',
  'Файл копии сохранён. Держите его отдельно от парольной фразы.':
    'The backup file has been saved. Keep it apart from the passphrase.',
  'Не удалось сохранить копию': 'Could not save the backup',
  'Не удалось восстановить ключ': 'Could not restore the key',
  участник: 'participant',
  участника: 'participants',
  участников: 'participants',
  'Не удалось создать группу': 'Could not create the group',
  'Не удалось узнать состояние режима': 'Could not get the state of the mode',
  'Режим включён: пользователи видят экран технических работ.':
    'The mode is on: users see the maintenance screen.',
  'Режим выключен: приложение снова работает как обычно.':
    'The mode is off: the app works as usual again.',
  'Не удалось переключить режим': 'Could not switch the mode',
  'Отправить вложение': 'Send the attachment',
  'Не удалось добавить стикер': 'Could not add the sticker',
  'У собеседника новое устройство — так бывает, когда входят с телефона или компьютера.':
    'The other person has a new device — that happens when they log in from a phone or a computer.',
  Участник: 'Participant',
  'Не удалось отправить жалобу': 'Could not send the report',
  'Зашифрованное сообщение': 'Encrypted message',
  'Остальные устройства вышли из аккаунта.': 'Other devices have been logged out.',
  'Не удалось завершить сессии': 'Could not end the sessions',
  'Убрать свою реакцию': 'Remove your reaction',
  реакция: 'reaction',
  реакций: 'reactions',
  'Поставить реакцию': 'Add a reaction',
  'Не удалось загрузить аудиторию': 'Could not load the audience',
  чат: 'chat',
  чата: 'chats',
  чатов: 'chats',
  'Не удалось изменить mute чата:': 'Could not change the chat mute:',
  'Не удалось изменить тип чата:': 'Could not change the chat type:',
  'Ключ группы не удалось отдать участникам (нет ключа устройства):':
    'Could not give the group key to the participants (no device key):',
  'Не удалось раздать ключ группы:': 'Could not distribute the group key:',
  'Ключ чата не удалось отдать всем устройствам (нет ключа устройства):':
    'Could not give the chat key to all devices (no device key):',
  'Ключ чата не выпущен: обёртки для устройств не сохранились':
    'The chat key was not issued: the device wrappers were not saved',
  'Не удалось раздать ключ чата:': 'Could not distribute the chat key:',
  'Не удалось сохранить сообщение:': 'Could not save the message:',
  'Расшифровка не завершилась': 'The transcription did not finish',
  'Не удалось загрузить сообщение с вложением:': 'Could not load the message with the attachment:',
  подписчик: 'subscriber',
  подписчика: 'subscribers',
  подписчиков: 'subscribers',
  'Не удалось загрузить канал:': 'Could not load the channel:',
  'Не удалось загрузить счётчики постов:': 'Could not load the post counters:',
  'Не удалось отметить просмотр поста:': 'Could not mark the post as viewed:',
  'Не удалось изменить реакцию:': 'Could not change the reaction:',
  'Не удалось загрузить чаты:': 'Could not load the chats:',
  'Не удалось загрузить закреплённые сообщения:': 'Could not load the pinned messages:',
  'Не удалось загрузить контакты:': 'Could not load the contacts:',
  'Не удалось прочитать стикер': 'Could not read the sticker',
  'Не удалось изменить закрепление:': 'Could not change the pin:',
  'Не удалось скопировать:': 'Could not copy:',
  'Не удалось открыть чат с автором:': 'Could not open the chat with the author:',
  'Не удалось удалить чаты:': 'Could not delete the chats:',
  'Не удалось удалить сообщение:': 'Could not delete the message:',
  'Не удалось выполнить поиск по сообщениям:': 'Could not search the messages:',
  'Не удалось обновить чаты:': 'Could not refresh the chats:',
  'Не удалось обновить сообщения:': 'Could not refresh the messages:',
  'Не удалось открыть ссылку-профиль:': 'Could not open the profile link:',
  'Отправить {count} {noun}': 'Send {count} {noun}',
  '{count} {noun}': '{count} {noun}',

  // --- Поиск GIF и истории: примеры и заглушки ---
  кот: 'cat',
  привет: 'hi',
  спасибо: 'thanks',
  праздник: 'party',
  круто: 'cool',
  П: 'P',

  // --- Кнопки окон по умолчанию (utils/appDialogs.ts) ---
  ОК: 'OK',
  Понятно: 'Got it',

  // --- Поля даты (utils/dateInput.ts) ---
  'Введите дату целиком: ДД.ММ.ГГГГ': 'Enter the full date: DD.MM.YYYY',
  'Месяц — от 01 до 12': 'The month must be from 01 to 12',
  'День — от 01 до 31': 'The day must be from 01 to 31',
  'Такой даты не существует': 'That date does not exist',
  'Дата рождения не может быть в будущем': 'The date of birth cannot be in the future',

  // --- Распознавание на устройстве: ошибки (utils/localSpeech.ts) ---
  '[stt] свой движок не поднялся, беру с CDN':
    '[stt] the local engine did not start, falling back to the CDN',
  'В браузере не хватило места для модели — освободите место и попробуйте снова':
    'There was not enough space in the browser for the model — free up space and try again',
  'Модель не поместилась в память устройства — попробуйте модель «быстрая»':
    'The model did not fit in the device memory — try the “fast” model',
  'Не удалось загрузить движок распознавания — проверьте подключение к интернету':
    'Could not load the recognition engine — check your internet connection',
  'Не удалось скачать модель — проверьте подключение к интернету и попробуйте снова':
    'Could not download the model — check your internet connection and try again',
  'Не удалось распознать запись на устройстве': 'Could not recognise the recording on the device',

  // --- Тихие часы (utils/quietHours.ts) ---
  'Выключено: уведомления приходят круглосуточно': 'Off: notifications come around the clock',
  'Границы совпали — тишины не будет, уведомления приходят круглосуточно':
    'The times are the same — there will be no quiet hours, notifications come around the clock',
  'звонки разрешены': 'calls are allowed',
  'звонки тоже не приходят': 'calls do not come through either',

  // --- Отложенная отправка (utils/scheduledSend.ts) ---
  'Через час': 'In an hour',
  'Сегодня в {time}': 'Today at {time}',
  'Завтра в {time}': 'Tomorrow at {time}',
  сейчас: 'now',
  'через {count} мин': 'in {count} min',
  'через {count} ч': 'in {count} h',
  'сегодня в {time}': 'today at {time}',
  'завтра в {time}': 'tomorrow at {time}',
  '{date} в {time}': '{date} at {time}',

  // --- Подписи-данные (передаются в t() переменной) ---
  // Длительность мута и медленного режима (GroupChatInfo.vue)
  Выкл: 'Off',
  '10 сек': '10 s',
  '30 сек': '30 s',
  '1 мин': '1 min',
  '5 мин': '5 min',
  '15 мин': '15 min',
  '1 час': '1 hour',
  '5 минут': '5 minutes',
  '8 часов': '8 hours',
  '24 часа': '24 hours',
  // Звуки уведомлений (utils/sounds.ts)
  'Без звука': 'Silent',
  Классика: 'Classic',
  Капля: 'Drop',
  Мягкий: 'Soft',
  Яркий: 'Bright',
  'Не удалось прочитать изображение': 'Could not read the image',
  'Скоро вернёмся.': 'We will be back soon.',
  'Проверяем…': 'Checking…',
  'Проверить обновления': 'Check for updates',
  'Забанить {name}?': 'Ban {name}?',
  локальная: 'local',
  // Категории эмодзи (utils/emojiCatalog.ts)
  Смайлы: 'Smileys',
  Люди: 'People',
  Природа: 'Nature',
  Места: 'Places',
  Занятия: 'Activities',
  Предметы: 'Objects',
  Символы: 'Symbols',
  Флаги: 'Flags',
  // Модели распознавания (utils/localSpeech.ts)
  быстрая: 'fast',
  точнее: 'more accurate',
  // Прочее
  'печатает…': 'is typing…',
  Пропущенные: 'Missed',
  Голосовые: 'Voice',
  Фото: 'Photos',
  'Через 20 минут': 'In 20 minutes',
  Открыть: 'Open',
  'QR-код ссылки': 'Link QR code',

  // --- Копия ключа: кнопки диалога (E2eeBackupDialog.vue) ---
  'Сохранить копию': 'Save the backup',
  Восстановить: 'Restore',
  'Выбрать файл': 'Choose a file',
  'Готовим файл…': 'Preparing the file…',
  'Сохранить файл копии': 'Save the backup file',
  'Восстанавливаем…': 'Restoring…',
  'Восстановить ключ': 'Restore the key',

  // --- Медиа: запись и размеры ---
  'Не удалось отправить медиасообщение': 'Could not send the media message',
  'Запись не удалось прочитать — файл повреждён или формат не поддерживается устройством':
    'The recording could not be read — the file is damaged or the format is not supported by the device',
  Б: 'B',
  КБ: 'KB',
  МБ: 'MB',
  ГБ: 'GB',
  'записывает голосовое…': 'is recording a voice message…',
  'записывает видеосообщение…': 'is recording a video message…',
  'отправляет фото…': 'is sending a photo…',
  'отправляет видео…': 'is sending a video…',
  'отправляет файл…': 'is sending a file…',

  // --- Контакты, поиск, перевод сообщения ---
  Перевод: 'Translation',
  'Скачано {percent}%': '{percent}% downloaded',
  'В ваших контактах: {name}': 'In your contacts: {name}',
  'Добавьте в контакты и назовите по-своему — имя видите только вы.':
    'Add the person to contacts and name them your own way — only you see this name.',
  Переименовать: 'Rename',
  'В контакты': 'Add to contacts',
  Сообщения: 'Messages',
  'В зашифрованных чатах — на этом устройстве': 'In encrypted chats — on this device only',
  'просмотров: {count}': 'views: {count}',
  'Не удалось определить номера. Проверьте ввод.':
    'Could not detect the numbers. Check what you entered.',
  'Не удалось найти в мессенджере': 'Could not find anyone in the messenger',
  'Не удалось открыть контакты': 'Could not open the contacts',

  // --- Импорт телефонов и создание группы ---
  'Открываем…': 'Opening…',
  Участники: 'Participants',
  'Выбрать из телефонной книги': 'Choose from the phone book',
  'Найти в мессенджере': 'Find in the messenger',
  'Найдено в мессенджере: {count}': 'Found in the messenger: {count}',
  'выбрано: {count}': 'selected: {count}',
  'Контактов пока нет — добавьте пользователей из телефонной книги.':
    'No contacts yet — add people from the phone book.',
  '{current} из {count}': '{current} of {count}',

  // --- Медиа, папки, блокировки, служебные диалоги ---
  Загрузка: 'Loading',
  Пауза: 'Pause',
  Слушать: 'Listen',
  'Воспроизвести видеосообщение': 'Play the video message',
  'Включить звук': 'Unmute',
  'Выключить звук': 'Mute',
  'Смотреть «{name}» на весь экран': 'Watch “{name}” full screen',
  'В записи будет как есть, без зеркала': 'The recording will be as is, without mirroring',
  'Предпросмотр зеркальный — в записи будет как есть':
    'The preview is mirrored — the recording will be as is',
  'Запретить писать': 'Block writing',
  'Только звонки': 'Calls only',
  'Скрыть список': 'Hide the list',
  'Добавить чаты': 'Add chats',
  'Никого не нашли — проверьте логин или телефон':
    'No one was found — check the username or the phone number',
  'Контактов пока нет. Найдите человека по логину или телефону и добавьте его.':
    'No contacts yet. Find someone by username or phone number and add them.',
  'Отпустите файл, чтобы прикрепить': 'Release the file to attach it',
  'Откройте чат, чтобы прикрепить файл': 'Open a chat to attach the file',
  'Выберите чат для пересылки': 'Choose a chat to forward to',
  'Пересылаю…': 'Forwarding…',
  'Включён — приложение закрыто для всех, кроме вас':
    'On — the app is closed for everyone except you',
  'Выключен — работает как обычно': 'Off — everything works as usual',
  'Сохраняем…': 'Saving…',
  'Выберите чат': 'Choose a chat',
  'Отправляю…': 'Sending…',
  'Свернуть реакции': 'Collapse the reactions',
  'Ещё реакции': 'More reactions',
  'Удалить чаты': 'Delete the chats',
  'Удалить чат': 'Delete the chat',

  // --- Ошибки и подписи из кода (composables, stores, utils) ---
  'Не удалось выполнить поиск': 'Search failed',
  'Не удалось расшифровать': 'Could not decrypt',
  'Не удалось поставить напоминание': 'Could not set the reminder',
  'Не удалось убрать напоминание': 'Could not remove the reminder',
  'Файл слишком большой': 'The file is too large',
  'Отправим только текст': 'We will send the text only',
  'Не удалось отправить': 'Could not send',
  'Не удалось заблокировать пользователя': 'Could not block the user',
  'Не удалось изменить запрет звонков': 'Could not change the calls ban',
  'Запись видео': 'Recording video',
  'Запись голоса': 'Recording voice',
  'Не удалось отложить сообщение': 'Could not schedule the message',
  'Не удалось отменить отправку': 'Could not cancel the sending',
  'Pismo для Android': 'Pismo for Android',
  'Сессия завершена. Войдите заново — другим устройствам доступ закрыт.':
    'The session has ended. Sign in again — other devices have lost access.',
  'Не удалось загрузить истории': 'Could not load the stories',
  'Не удалось поставить реакцию': 'Could not add the reaction',
  'Не удалось удалить историю': 'Could not delete the story',
  'Нет встроенного перевода': 'No built-in translation available',
  'Отправка… {percent}%': 'Sending… {percent}%',
  'Отправка…': 'Sending…',
  'Сохранённые сообщения': 'Saved messages',

  // --- Тексты разметки, найденные при сплошной проверке ---
  'Доступна новая версия приложения': 'A new version of the app is available',
  'Проверяем ссылку-приглашение…': 'Checking the invite link…',
  'Ссылка недействительна': 'The link is no longer valid',
  'Эта ссылка-приглашение уже использована, истекла или не существует. Обратитесь к тому, кто её отправил, за новой ссылкой.':
    'This invite link has already been used, has expired or does not exist. Ask the person who sent it for a new one.',
  'На страницу входа': 'Go to sign-in',
  'Регистрация по приглашению': 'Sign-up by invitation',
  'Придумайте пароль, чтобы завершить создание аккаунта.':
    'Create a password to finish setting up your account.',
  'Минимум {count} символов': 'At least {count} characters',
  'Создать аккаунт': 'Create account',
  'Приложение столкнулось с ошибкой и не смогло продолжить. Перезагрузка обычно помогает — данные и переписка не потеряны.':
    'The app hit an error and could not continue. Reloading usually helps — your data and chats are not lost.',
  'Скорость {speed} — нажмите, чтобы изменить': 'Speed {speed} — tap to change',
  'Не задан ключ Giphy. Добавьте': 'No Giphy key is set. Add',
  '(см. .env.example) и перезапустите frontend.': '(see .env.example) and restart the frontend.',
  Авто: 'Auto',
  'Скачиваем модель распознавания… {percent}%': 'Downloading the speech model… {percent}%',
  '{target} — отметьте папки, где чат должен быть виден. Порядок внутри папки расставляется в «Папки чатов».':
    '{target} — tick the folders where the chat should be visible. The order inside a folder is set in “Chat folders”.',
  'Убрать из папки': 'Remove from the folder',
  'Больше {count} папок не поместится в строку фильтров.':
    'No more than {count} folders fit in the filter row.',
  'Удалить папку «{name}»?': 'Delete the folder “{name}”?',
  'Как звучит новое сообщение в чате «{title}». Настройка действует только на этом устройстве; при выключенном «Звуке сообщений» в профиле здесь всё равно будет тихо.':
    'How a new message sounds in the chat “{title}”. The setting applies to this device only; with “Message sound” turned off in your profile it will still be silent here.',
  'Как звучит новое сообщение. Настройка действует только на этом устройстве; при выключенном «Звуке сообщений» в профиле здесь всё равно будет тихо.':
    'How a new message sounds. The setting applies to this device only; with “Message sound” turned off in your profile it will still be silent here.',
  'в среднем {average} в активный день': '{average} on an average active day',
  'Сообщений за 30 дней: {count}': 'Messages in 30 days: {count}',
  'Из телефонной книги: {count}': 'From the phone book: {count}',
  'Аккаунт и все данные будут удалены': 'The account and all data will be deleted',
  'профиль, аватар, переписка, вложения, push-подписки. Восстановить их не получится.':
    'profile, avatar, chats, attachments, push subscriptions. They cannot be restored.',
  'Введите {code} для подтверждения': 'Enter {code} to confirm',
  'Открыто: {label}': 'Opened from: {label}',
  'Ключ восстановлен (устройство {device}…). Перечитываем переписку…':
    'The key has been restored (device {device}…). Re-reading your chats…',
  'Вы: {body}': 'You: {body}',
  'Включён с {time}': 'Enabled since {time}',
  'Последнее переключение: {time}': 'Last toggled: {time}',
  'Откроется один раз и сгорит после просмотра': 'It opens once and is gone after viewing',
  'У «{name}» новое устройство — так бывает, когда входят с телефона или компьютера.':
    '“{name}” has a new device — this happens when they sign in from a phone or a computer.',
  'Вернём вас к этому сообщению в выбранное время. Уведомление придёт, даже если приложение закрыто — из чата «{title}».':
    'We will bring you back to this message at the chosen time. The notification will arrive even if the app is closed — from the chat “{title}”.',
  'Вернём вас к этому сообщению в выбранное время. Уведомление придёт, даже если приложение закрыто.':
    'We will bring you back to this message at the chosen time. The notification will arrive even if the app is closed.',
  'Напоминание уже стоит: {label}': 'A reminder is already set: {label}',
  'Жалоба на': 'Report on',
  ' — сообщение: «{preview}»': ' — message: “{preview}”',
  '. Мы проверим её и примем меры.': '. We will review it and take action.',
  'Что считается нарушением —': 'What counts as a violation —',
  'Сравните этот код с': 'Compare this code with',
  '— лично, по телефону или голосом. Если код совпадает, переписку читаете только вы двое: ключи не подменены, и сервер в середине отсутствует.':
    '— in person, by phone or by voice. If the code matches, only the two of you can read the chat: the keys are not substituted and there is no server in the middle.',
  'Короткая версия (30 цифр):': 'Short version (30 digits):',
  'ближайшее {time}': 'next {time}',
  'Мы прислали уведомление о входе с нового устройства ({device} · {ip}). Если вы этого не делали — закройте доступ чужим.':
    'We have sent a notice about a sign-in from a new device ({device} · {ip}). If it was not you, close access to strangers.',
  'Мы прислали уведомление о входе с нового устройства. Если вы этого не делали — закройте доступ чужим.':
    'We have sent a notice about a sign-in from a new device. If it was not you, close access to strangers.',
  'Возможно, ссылка устарела, чат удалён или в адресе опечатка. Проверьте адрес или вернитесь в приложение.':
    'The link may be outdated, the chat deleted, or the address mistyped. Check the address or go back to the app.',

  // --- Тексты в коде: истории, отправка файлов, обработчики ошибок ---
  'Pismo — мессенджер': 'Pismo — messenger',
  'Парольная фраза короче {count} символов': 'The passphrase is shorter than {count} characters',
  'Сервис GIF вернул ошибку ({status})': 'The GIF service returned an error ({status})',
  'Пустой список ICE-серверов': 'The ICE server list is empty',
  'Распознавание не ответило': 'Speech recognition did not respond',
  'Распознавание не получило звук': 'Speech recognition received no audio',
  'Стикер недоступен ({status})': 'The sticker is unavailable ({status})',
  'Открыть файл': 'Open the file',
  'Ответить {name}…': 'Reply to {name}…',
  'Сервер ответил {status}': 'The server responded with {status}',
  'Не удалось отправить «{name}»': 'Could not send “{name}”',
  'Не удалось отправить {failed} из {total} файлов': 'Could not send {failed} of {total} files',
  '{name}: реакция на вашу историю': '{name}: reacted to your story',
  'Логин «{login}» не найден': 'Username “{login}” was not found',

  // --- Профиль: журнал безопасности, ключ шифрования, документы ---
  'История хранится 180 дней и видна только вам. Если увидели незнакомый вход — смените пароль и нажмите «Выйти на всех устройствах».':
    'The history is kept for 180 days and is visible only to you. If you see an unfamiliar sign-in, change your password and tap “Sign out on all devices”.',
  'Резервная копия': 'Backup copy',
  'Ключ сквозного шифрования хранится только в этом браузере: переустановка приложения или потеря телефона уносят с собой переписку зашифрованных чатов. Сохраните копию ключа — она вернёт доступ на новом устройстве.':
    'The end-to-end encryption key is stored only in this browser: reinstalling the app or losing the phone takes the chats from encrypted conversations with it. Save a copy of the key — it will restore access on a new device.',
  'Правила сообщества': 'Community rules',
  'Политика конфиденциальности': 'Privacy policy',
  'Пользовательское соглашение': 'Terms of service',

  // --- Утилиты: подписи, ошибки, время ---
  'Не удалось загрузить голосовое ({status})': 'Could not load the voice message ({status})',
  'работает: {count}': 'works: {count}',
  'с оговоркой: {count}': 'with caveats: {count}',
  'недоступно: {count}': 'unavailable: {count}',
  '{date}: сообщений не было': '{date}: no messages',
  'Год не раньше {year}': 'The year must be {year} or later',
  'Неизвестная ошибка': 'Unknown error',
  'Слишком длинный текст для QR (больше {max} знаков)':
    'The text is too long for a QR code (more than {max} characters)',
  'Не беспокоить с {start} до {end}{night}; {calls}':
    'Do not disturb from {start} to {end}{night}; {calls}',
  'Через неделю в {time}': 'In a week at {time}',
  '{count} мин': '{count} min',
  '{count} ч': '{count} h',
  '{count} дн': '{count} d',

  // --- Удаление чатов и поле даты ---
  'Удалить выбранные чаты ({count})?': 'Delete the selected chats ({count})?',
  'Удалить чат с': 'Delete the chat with',
  'ДД.ММ.ГГГГ': 'DD.MM.YYYY'
}
