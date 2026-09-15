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

- `main.ts` — Quasar 2 (Dialog/Notify, lang ru, **Material Symbols Rounded** — `@quasar/extras/material-symbols-rounded`; Quasar рендерит `<q-icon>` с классом `.material-icons`, на него в `quasar.css` повешен алиас шрифта), тема/оформление через `stores/theme.ts` (`data-theme`, токены `--ms-*`; тема ставится ДО первого кадра inline-скриптом в `index.html`, чтобы не мигала), инициализация auth.
- Оформление: токены тем `--ms-*` + `color-scheme` и глобальные оверрайды над scoped-стилями — в `assets/appearance.css`; `assets/quasar.css` приводит Material-компоненты к токенам; базовая геометрия кнопок (`.icon-btn`/`.round-btn`) — общая в `appearance.css`; «пустые состояния» — общий компонент `components/common/EmptyState.vue`.
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

- `Messenger.vue` — адаптивный Telegram-подобный вид: `q-layout` + `q-drawer` (панель «Чаты/Контакты»; на мобильном — выдвижной drawer), список диалогов (пины/онлайн/«печатает…»), окно чата (пузыри вправо/влево, day-разделители, reply-цитата, закреплённые сверху, файлы/картинки, реакции, hover-действия, inline-поиск по сообщениям). Модалка «Настройки» (`UserProfile`) — список разделов (Аккаунт, Безопасность, Приватность, Уведомления, Хранилище, Внешний вид, О приложении); оформление (`AppearanceSettings`) встроено в раздел «Внешний вид». Ещё модалки: «Информация о чате» (`ChatInfo`), вход (`LoginModal`), лайтбокс изображений (`ImageLightbox`). Обновления — WS-события + fallback-polling 20 с.
- `UserProfile.vue` — редактирование профиля + аватар (клик по аватару → выбор файла, удаление фото, кнопка «Выйти»); телефон — только для чтения (логин аккаунта, класс `.readonly-field`), в запрос обновления не отправляется.
- `Login.vue` / `LoginModal.vue` — вход по номеру: шаги `phone → password | otp → create` (автофокус поля), исходя из `password/status`; `LoginModal` держит диалог открытым после подтверждения кода (`pendingPassword`), пока пользователь не задаст пароль.
- Компоненты мессенджера вынесены в `components/messenger/` (`ChatSidebar`, `ChatHeader`, `MessageThread`, `MessageRow`, `MessageComposer`, `PinnedBar`, `InlineSearchBar`, `ChatPlaceholder`, `ChatInfo`, `ForwardDialog`, `FileDropOverlay`); медиа — в `components/media/` (лайтбокс, голос/видео/кружки, GIF-пикер); звонки — `components/calls/`. Реактивное присутствие/печать — `composables/usePeerActivity`, realtime-оркестрация — `composables/useRealtimeSync`, запись — `useRecordButton`, перетаскивание файлов в окно — `useFileDrop` (слушатели на `window`: бросить файл можно в любое место, `preventDefault` не даёт браузеру открыть файл вместо чата).

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

