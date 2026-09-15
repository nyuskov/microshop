# Frontend: детали

Вынесено из README. Общая картина и запуск — в [../README.md](../README.md),
список остальных документов — в [README.md](README.md).



### Запуск и проверки

```bash
cd frontend
pnpm install
pnpm dev            # Vite dev (HTTPS :5173)
```

Проверки (нужно запускать **бинарники напрямую через node**, т.к. shims из `.bin/*` могут падать из-за прав `node_modules`):

```bash
node node_modules/vue-tsc/bin/vue-tsc.js --build --force   # типы
node node_modules/eslint/bin/eslint.js --no-cache src      # линт
node node_modules/prettier/bin/prettier.cjs --write <files> # формат
```

`package.json`-скрипты: `dev`, `build`, `type-check`, `lint`, `format`, `test:unit` (vitest).

Проверки в dev **никогда не роняют сайт** (важно для работы с телефона/в браузере):

- eslint-плагин Vite работает в режиме `failOnError: false` — ошибки линта печатаются в лог dev-сервера (и не прерывают загрузку модуля, иначе в браузере был бы белый экран вместо приложения);
- плагин `vite-plugin-checker` показывает ошибки типов **бейджем внизу справа** (`overlay: { initialIsOpen: false, position: 'br' }`) — панель раскрывается по клику и ничем не закрывает интерфейс;
- `server.clearScreen: false` — лог не стирается на каждой пересборке, предупреждения видно «внизу» терминала.

В CI проверки остаются строгими (`.github/workflows/ci.yml`): `vue-tsc --noEmit` и `eslint --no-cache src` запускаются отдельными шагами и падают с ошибкой. Смягчение только в dev-режиме Vite — чтобы правка не оставляла без сайта до следующего коммита.

### Экраны ошибок (404 / 500)

Пользователь никогда не должен видеть пустой экран или голый текст ошибки браузера:

- **внутри приложения** — маршрут `/:pathMatch(.*)*` рисует `views/NotFound.vue` («Страница не найдена» в стиле приложения с кнопками «К чатам»/«Назад»); фатальные ошибки рендера/обработчиков ловят `main.ts` (`app.config.errorHandler` + `window.onerror`) и показывают `FatalErrorScreen.vue` с перезагрузкой;
- **статически** — `public/404.html` и `public/500.html` (одна палитра с приложением, без внешних ресурсов и service worker'а). Их отдаёт nginx: `error_page 404 =404 /404.html` (нет файла/ассета — статус остаётся 404) и `error_page 500 502 503 504 =500 /500.html`. Ответы `/api/` и `/media/` не перехватываются (`proxy_intercept_errors` выключен), поэтому JSON-ошибки бэкенда уходят клиенту как есть.

### Ключевые точки

- `main.ts` — Quasar 2 (Dialog/Notify, lang ru, **Material Symbols Rounded** — `@quasar/extras/material-symbols-rounded`; Quasar рендерит `<q-icon>` с классом `.material-icons`, на него в `quasar.css` повешен алиас шрифта), тема/оформление через `stores/theme.ts` (`data-theme`, токены `--ms-*`; тема ставится ДО первого кадра inline-скриптом в `index.html`, чтобы не мигала; темы — светлая, тёмная, «по системе» и **AMOLED** — флаг `amoled` в состоянии, уточнение тёмной: `html[data-theme='amoled']` даёт чистый чёрный фон окна и ленты, а «поднятые» поверхности остаются чуть светлее), инициализация auth.
- Оформление: токены тем `--ms-*` + `color-scheme` и глобальные оверрайды над scoped-стилями — в `assets/appearance.css`; `assets/quasar.css` приводит Material-компоненты к токенам; базовая геометрия кнопок (`.icon-btn`/`.round-btn`) — общая в `appearance.css`; «пустые состояния» — общий компонент `components/common/EmptyState.vue`. Полей с родными контролами браузера нет: выпадающие списки — `components/common/SelectField.vue` (свой слой с расчётом координат, `utils/select.ts`), дата — маскированный ввод `ДД.ММ.ГГГГ` (`utils/dateInput.ts`); следит `__tests__/nativeControls.spec.ts`.
- Серии сообщений (подряд идущие сообщения одного автора): границы считает `utils/thread.ts::seriesKindFor` (тот же автор + пауза < 5 минут; разделитель дня разрывает серию), `MessageThread` отдаёт `series: single|first|middle|last` в `MessageRow` — от этого зависят скругления пузыря (срез только у первого) и отступы, им же определяется имя автора в группах.
- **Типографика**: служебный текст (время сообщения, плашка статуса, счётчики, подписи диалогов) берёт размер из шкалы `--ms-fs-*`, и каждое её значение умножено на `--ms-text-scale` — поэтому настройка «Размер текста» (мелкий/обычный/крупный) двигает и подписи, а не только сообщения и список чатов. Фиксированные `font-size` мельче 12px запрещены; для тесных мест (кружок пересылки 18px, «+» в кружке истории 14px) допустим `calc(Npx * var(--ms-text-scale, 1))`. Следит за этим `__tests__/smallText.spec.ts`.
- **Тач-таргеты**: до 600px кнопки `.icon-btn`/`.round-btn` — 38px (было 32–34), в шапке чата и композере остаются ровно такими же (своих уменьшающих медиазапросов у них больше нет): при 30px и зазоре 2px палец попадал в соседнюю кнопку. Чипы фильтров остаются компактными (пять должны влезать в 390px) — у них расширена только область нажатия (`::after` с `inset: -4px -2px`), сам размер не изменился.
- PWA/иконки: `public/favicon.svg` (градиентная «письмо-пузырь»), PNG-набор `public/icons/` (`icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon-180`, `badge-96`) + `manifest.webmanifest` (name/short_name Pismo, `theme_color #5a50e0`). Иконки генерируются скриптом `scripts/gen_pismo_icons.py` (stdlib, без зависимостей).
- localStorage/кеши: ключи приложения — `pismo_*` (`pismo_drafts`, `pismo_pinned_chats`, `pismo_call_kind`, `pismo_e2ee_v1_<uid>`); ключи прежнего названия (`microshop_*`) переносятся один раз миграцией в `utils/storage.ts` (вызов в `main.ts` до инициализации настроек). Кэши service worker — `pismo-v*` / `pismo-auth` (старые `microshop-*` чистятся в `activate`).
- `router/index.ts` — `/` → `Messenger.vue`, `/auth/login/` → `Login`; guard на auth.
- `stores/auth.ts`:
  - состояние: `user`, `current_user`, `isAuthenticated`, `accessToken`, `refreshToken` (в localStorage);
  - методы: `initializeApp`, `requestOtp`, `loginWithOtp`, `fetchUser`, `updateCurrentUser`, `logout`, `refreshTokens`;
  - `ApiUser`/`ApiUserProfile` — типы.
- `services/api.ts` — axios-инстанс `api` (baseURL из `src/config.ts`: `API_ORIGIN + /api/v1`), `registerAuth(tokenProvider, onRefresh)`, интерцепторы (Bearer + авто-refresh на 401); экспорт `api`, `uploadAvatar`/`removeAvatar`. Адреса API/WS/media централизованы в `src/config.ts`.
- `services/chatService.ts` — `mediaUrl`, `fetchMyChats`, `openPrivateChat`, `fetchMessages`, `fetchPinnedMessages`, `sendNewMessage`, `sendAttachmentMessage`, `setMessagePinned`, `setMessageReaction`/`removeMessageReaction`, `deleteMessage`, `searchMessages`, `forwardMessage`, `editMessage`, `searchUsers`, `fetchContacts`; тип `SearchUserResult`.
- `types/index.ts` — `Chat`, `ChatUser`, `Message`, `MessageFile`, `ReactionSummary`, `CreateMessageRequest`, `OpenPrivateChatRequest`, `User`, `Profile`, `Group`.
- **Бейджи/чтение**: сообщение считается прочитанным, когда собеседник открыл/читает чат (`GET /messages/{chat_id}/` помечает входящие `is_read`). На фронте: свои сообщения показывают `✓✓` (синее — прочитано); `unread_count` — бейджи в списке чатов.

### Экраны

- `Messenger.vue` — адаптивный Telegram-подобный вид: `q-layout` + `q-drawer` (панель «Чаты/Контакты»). Раскладка по ширине окна: **< 600 px — телефон** (список и нить на одном экране, drawer поверх чата, навигация по истории приложения — `utils/mobileNav.ts`, кнопка «назад» в шапке), **600–1023 px — планшет** (две панели: список 320 px + нить), **≥ 1024 px — десктоп** (две панели, список 380 px). В коде это `isPhone = $q.screen.lt.sm`, `isDesktop = $q.screen.gt.sm` и `twoPane = !isPhone` (от последнего зависят история приложения и возврат к списку; `$q.screen` меняется динамически при повороте экрана). Дальше: список диалогов (пины/онлайн/«печатает…»), окно чата (пузыри вправо/влево, day-разделители, reply-цитата, закреплённые сверху, файлы/картинки, реакции, hover-действия, inline-поиск по сообщениям). Модалка «Настройки» (`UserProfile`) — список разделов (Аккаунт, Безопасность, Приватность, Уведомления, Хранилище, Внешний вид, О приложении); оформление (`AppearanceSettings`) встроено в раздел «Внешний вид». Ниже десктопа окно настроек полноэкранное (`:maximized` у `q-dialog` + класс `.ms-modal-full`): карточка оставляла по краям полоски чата и два вложенных скролла, теперь прокрутка одна — `.ms-modal-body`. Ещё модалки: «Информация о чате» (`ChatInfo`), вход (`LoginModal`), лайтбокс изображений (`ImageLightbox`). На широком экране (≥ 1280 px) «Информация о чате/группе» показывается правой колонкой 340 px рядом с перепиской (`.chat-rail`, режим `panel` у `ChatInfo`/`GroupChatInfo` — та же карточка без рамки, прокрутка внутри), открыть/закрыть — клик по названию чата или пункт «Информация о чате» в «⋯»; каналы остаются в модалке. Обновления — WS-события + fallback-polling 20 с.
- **Админская панель** (только аккаунт с `is_superuser`): «шестерёнка» внизу слева в списке чатов (`ChatSidebar`, `.admin-gear`) открывает настройки сразу на экране «Администрирование». Там собраны служебные разделы: «Приглашения» (`InvitesSettings.vue` — создать ссылку, скопировать/поделиться, отозвать) и «Жалобы» (диалог модерации открывается через `emit('open-moderation')` — сам диалог живёт в `MessengerModerationOverlays`). Из меню «⋯» и из обычных настроек эти пункты убраны. Начальный экран настроек передаётся пропом `start-section`: профиль грузится отдельным чанком, и на первом открытии вызов `profileRef.openAdmin()` не долетает — компонента ещё нет.
- **Согласие при регистрации**: `components/common/ConsentCheckbox.vue` — обязательная галка на шаге подтверждения кода для нового номера и на шаге создания пароля (плюс `InviteRegister`). При обычном входе галки нет. Факт согласия уходит в запрос регистрации (`accept_terms`).
- **Поле телефона**: `components/common/PhoneInput.vue` — единое поле для входа, приглашения и профиля; ввод разбирается целиком (`localPhoneDigits`) и форматируется в маску, каретка остаётся на той же цифре. У `q-input` id поля задаётся пропом `for` (иначе `<label for=…>` не связан с полем).
- `UserProfile.vue` — редактирование профиля + аватар (клик по аватару → выбор файла, удаление фото, кнопка «Выйти»); телефон — только для чтения (логин аккаунта, класс `.readonly-field`), в запрос обновления не отправляется.
- `Login.vue` / `LoginModal.vue` — вход по номеру: шаги `phone → password | otp → create` (автофокус поля), исходя из `password/status`; `LoginModal` держит диалог открытым после подтверждения кода (`pendingPassword`), пока пользователь не задаст пароль.
- Компоненты мессенджера вынесены в `components/messenger/` (`ChatSidebar`, `ChatHeader`, `MessageThread`, `MessageRow`, `MessageComposer`, `PinnedBar`, `InlineSearchBar`, `ChatPlaceholder`, `ChatInfo`, `ForwardDialog`, `FileDropOverlay`); медиа — в `components/media/` (лайтбокс, голос/видео/кружки, GIF-пикер); звонки — `components/calls/`. Недоступное видеосообщение (`RoundVideoMessage`, класс `broken`) рисуется компактной плашкой в токенах темы (`--ms-surface-2`/`--ms-muted`), а не кругом 300px с чёрной подложкой; у него нет `role="button"` и кнопки плавающего окна — играть нечего. Реактивное присутствие/печать — `composables/usePeerActivity`, realtime-оркестрация — `composables/useRealtimeSync`, запись — `useRecordButton`, перетаскивание файлов в окно — `useFileDrop` (слушатели на `window`: бросить файл можно в любое место, `preventDefault` не даёт браузеру открыть файл вместо чата).

### Иконки (Lucide) и шрифты

Иконки в разметке задаются **логическим именем** через `icon()`: `<q-icon :name="icon('close')" />`. Какое имя какому глифу соответствует — решает `src/utils/icons.ts` (`ICON_MAP`), а `icon()` превращает имя в классы иконки (`icon-lucide icon-x`) — набор **Lucide** (тонкий штрих 2px, скруглённые концы; самый ходовой современный стиль).

Почему так:
- Quasar по префиксу `icon-` понимает, что получил **список классов**, а не имя лигатуры. Любое другое значение он рисует ТЕКСТОМ внутри `<i class="material-icons">` — это и была ошибка «иконка как текст».
- Смена набора иконок — правка одного файла `ICON_MAP` (+ пересборка CSS), а не 250 мест в шаблонах.
- Незнакомое имя `icon()` возвращает как есть: его отрисует резервный шрифт Material (Quasar подключён), то есть ошибка видна, а не превращается в пустоту.

Сборка (нужны `fonttools` + `brotli`: `python3 -m venv /tmp/fonts-venv && /tmp/fonts-venv/bin/pip install fonttools brotli`):

| Скрипт | Что делает |
| --- | --- |
| `scripts/fetch_icons.py` | скачивает сборку Lucide (шрифт + карта имён) в `node_modules/.cache/pismo-icons` — в git не хранится |
| `scripts/build_icons.py` | читает `ICON_MAP`, сверяет имена с набором Lucide, режет шрифт до нужных глифов (~16 КБ вместо 281 КБ) и пишет `src/assets/icons.css` |
| `scripts/build-icons-font.py` | резервный шрифт Material Symbols Rounded (урезанный до имён из `src`) — им рисуются внутренние элементы Quasar и имена, которых нет в `ICON_MAP` |
| `scripts/migrate-icons-names.py` | одноразовая миграция: `name="close"` → `:name="icon('close')"` |

**Добавили иконку — допишите её в `ICON_MAP` и прогоните `build_icons.py`** (при первом запуске — ещё `fetch_icons.py`), иначе она отрендерится пустотой. Страж в тестах (`src/__tests__/icons.spec.ts`) проверяет, что все имена из шаблонов есть в мэппинге и что для каждой иконки есть правило в CSS.

Исключение — глифы, которых в наборе нет: они нарисованы вручную в `src/assets/icons-drawn.css` (SVG в data-URI, показывается через `mask`, краска — `currentColor`), имена перечислены в `DRAWN_GLYPHS` (`src/utils/icons.ts`). Сборка шрифта такие имена пропускает, а `icon()` отдаёт им классы `icon-drawn icon-<глиф>` вместо `icon-lucide …`. Файл **не генерируется** — правки в нём пересборка не затирает. Сейчас так нарисован один глиф: `round-video` — видеосообщение («кружок» в квадрате со скруглёнными углами, как в Telegram).

Шрифты (локально, без внешних запросов; собирает `scripts/fetch_fonts.py`) — три роли:

- `--ms-font` → **Roboto** — обычный текст;
- `--ms-font-display` → **Golos Text** — заголовки, названия чатов, шапки диалогов;
- `--ms-font-mono` → **Roboto Mono** — цифры (код из SMS, телефон, таймеры), `tabular-nums`.

Наборы — кириллица + латиница с `unicode-range`, поэтому браузер грузит только нужное (русская страница — ~65 КБ на все три вместо внешней загрузки с Google Fonts).

**Если имени нет в резервном шрифте, Vue отрендерит текст буквами** — тихо и заметно. Проверка (в браузере, консоль на любой странице приложения):

```js
for (const n of ['forum', 'auto_stories', 'group']) {
  const s = document.createElement('span')
  s.style.fontSize = '24px'
  s.textContent = n
  document.body.appendChild(s)
  console.log(n, s.getBoundingClientRect().width) // иконка ≈ 24px, текст сильно шире
  s.remove()
}
```

Список имён из `@quasar/extras/material-symbols-rounded/icons.json` для такой проверки **не годится**: в шрифте есть легаси-лигатуры (`push_pin`, `delete_outline`, `done`, `help_outline`…), которых в JSON нет, — поэтому резервный шрифт собирается по именам, найденным прямо в `src`. Галочки прочтения — текстовые `✓✓`. Не используйте классы PrimeIcons `pi pi-*` (шрифт не подключён).

