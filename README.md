# Microshop — мессенджер

> Полное описание проекта: стек, структура, запуск, API, модель данных, проверки и подводные камни. Обновляется вместе с кодом — используйте его как единую точку входа вместо перечитывания кода.

## 1. Что это за проект

Веб-приложение-мессенджер (личные переписки 1-на-1 в стиле Telegram) с регистрацией/входом по номеру телефона через SMS-код (OTP).

Реализовано на данный момент:

- **Мессенджер** (UI в стиле Telegram Web):
  - список диалогов (с превью, временем, счётчиком непрочитанных, галочками прочтения ✓✓);
  - поиск людей по логину или телефону и старт личного чата;
  - вкладка **«Контакты»** (все пользователи + поиск);
  - отправка текста, **файлов и картинок**, **ответ (reply)** на сообщение, **закрепление** сообщений, **реакции-эмодзи**, действия при наведении (копировать/удалить/закрепить/ответить), поиск по сообщениям;
  - обновление сообщений **по polling** (3 с), без WebSocket;
  - нижняя навигация: Контакты / Чаты (с бейджем непрочитанных) / Настройки.
- **Профиль и настройки** (`UserProfile`): редактирование имени/логина/email/телефона/био/даты рождения/языка/страны, переключатели уведомлений и приватного режима, **загрузка/удаление фото аватара**, выход из аккаунта.
- **Вход по телефону** (шаг «номер +7» → шаг «код из SMS») с красивым оформлением.
- Бэкенд-модули кроме мессенджера: `products`, `posts`, `telegram` — **legacy/дополнительные**, с мессенджером не связаны.

Ограничения (сознательные): только личные чаты (групповых нет); нет WebSocket; SMS-отправка — заглушка (код печатается в лог контейнера `web`); тёмная тема частично.

## 2. Стек

| Слой | Технологии |
|---|---|
| Backend | Python 3.13, FastAPI 0.115, SQLAlchemy 2 (async), asyncpg, Alembic, pydantic v2, pwdlib(Argon2), fastapi-users 15 (JWT) |
| Frontend | Vue 3 (Composition API), TypeScript, Vite 7, Pinia, Vue Router, PrimeVue 4 + PrimeIcons, axios |
| База данных | PostgreSQL (в docker) |
| Инфраструктура | Docker Compose, Nginx (dev-прокси), HTTPS на самоподписанных сертификатах |
| Пакеты | Backend — Poetry; Frontend — pnpm |

## 3. Структура репозитория

```
microshop/
├── backend/                  # FastAPI
│   ├── main.py               # создание app, CORS, роутер v1, mount /media
│   ├── core/
│   │   ├── config.py         # Settings (DATABASE_URL, JWT, CORS, prefix)
│   │   ├── security.py       # хеширование паролей (argon2)
│   │   └── models/           # ORM-модели + db_helper (session_dependency)
│   ├── api_v1/               # фиче-модули: auth, users, chats, messages,
│   │   │                     #   posts, products, telegram, tokens, general
│   │   ├── __init__.py       # router_v1: сборка всех роутеров (prefix /api/v1)
│   │   ├── auth/             # OTP-логин, fastapi-users/JWT, get_current_user
│   │   ├── users/            # профили, поиск, контакты, аватар
│   │   ├── chats/            # личные чаты 1-1 (crud/schemas/views)
│   │   └── messages/         # сообщения: reply/pin/reactions/files/чтение
│   ├── alembic/versions/     # миграции (см. раздел 7)
│   ├── media/                # загруженные файлы сообщений и аватары (/media)
│   └── certs/                # самоподписанные сертификаты (HTTPS)
├── frontend/                 # Vue 3 + Vite
│   └── src/
│       ├── views/Messenger.vue   # главный экран (лента + чат) + модалки
│       ├── views/UserProfile.vue # настройки профиля (аватар, поля, выход)
│       ├── components/Login.vue, LoginModal.vue  # вход по телефону
│       ├── components/…          # прочие (Posts/Products/Groups — legacy UI)
│       ├── stores/auth.ts        # Pinia: токены, текущий пользователь
│       ├── stores/theme.ts       # тема light/dark
│       ├── services/api.ts       # axios-клиент (Authorization) + пользователи/аватар
│       ├── services/chatService.ts # чаты/сообщения/поиск/контакты/файлы/реакции
│       ├── services/errors.ts    # getErrorMessage
│       ├── types/index.ts        # Chat/Message/ChatUser/… типы API
│       └── router/index.ts       # маршруты: "/" → Messenger, "/auth/login/"
├── docker-compose.yaml        # основной дев-стек: web+db+frontend(nginx)
├── docker-compose.dev.yaml    # лёгкий вариант (см. раздел 4)
├── entry.sh                   # docker compose down -v && build && up
└── queries.sql                # черновик SQL-запросов
```

> Файл `backend/api_v1/groups/` — пустой остаток удалённой фичи «группы» (модели нет).

## 4. Запуск

### Основной (Docker Compose) — рекомендуется

Контейнеры: `web` (FastAPI :8000 HTTPS + авто-миграции), `db` (Postgres), `frontend` (Vite :5173 HTTPS), `nginx` (:8080 HTTP, dev-прокси к frontend и API).

```bash
./entry.sh                 # = docker compose down -v --rmi all && build && up
# или вручную:
docker compose up --build  # из корня microshop
```

После старта:

- **Backend (HTTPS)**: https://localhost:8000 — Swagger: https://localhost:8000/docs (OpenAPI: `/openapi.json`).
- **Frontend (HTTPS)**: https://localhost:5173 (нужно принять самоподписанный сертификат).
- **Nginx (HTTP, отладка)**: http://localhost:8080.

`entry.sh` использует `-v` (удаляет volume БД) — данные стираются при каждом запуске.

### Лёгкий вариант (docker-compose.dev.yaml)

Поднимает `web`+`db`+`nginx`. `nginx` проксирует `/api` на `web:8000`, а фронтенд — на **Vite на хосте** (`172.17.0.1:5173`), поэтому Vite нужно запускать отдельно (`pnpm dev`).

### Локально без Docker (отладка кода/тулинга)

- Backend: `cd backend && poetry install && poetry run uvicorn main:app --reload` (нужна доступная БД по `DATABASE_URL`).
- Frontend: `cd frontend && pnpm install && pnpm dev` (Vite требует сертификаты в `/app/certs_from_backend` — при запуске на хосте смонтируйте/укажите путь в `vite.config.ts`).

### Переменные окружения

Настройки в `backend/core/config.py` (pydantic-settings):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://postgres:Xx123456@localhost:5432/microshop` | URL БД |
| `JWT_SECRET_KEY` | (значение в коде) | секрет HS256 |
| `CORS_ORIGINS` | `https://localhost:5173`, `http(s)://localhost:5173` | CORS |
| — | `api_v1_prefix=/api/v1` | префикс API |
| — | `auth_otp_expire_seconds=300` | время жизни OTP |

В docker-стеке `DATABASE_URL` задаётся в `docker-compose.yaml` для сервиса `web`. Файл `.env.dev` в корне сейчас закомментирован (не используется).

## 5. Backend — детали

### Аутентификация (важно)

- Вход по телефону (OTP):
  1. `POST /api/v1/auth/request-otp/` с `{phone_number}` (формат `+7 (___) ___-__-__`). **SMS — заглушка**: код печатается в лог контейнера `web` (`Sending SMS to …: Your OTP code is …`).
  2. `POST /api/v1/auth/verify-otp/` с `{phone_number, otp}` → `{access_token}`. Если пользователя нет — он создаётся автоматически с `username=phone_<hex>` и случайным паролем.
- Вход по паролю (для отладки/тестов): `POST /api/v1/auth/token/` (OAuth2 form `username`/`password`) → `{access_token}`.
- Все «личные» эндпоинты требуют заголовок `Authorization: Bearer <access_token>`.
- `/jwt/*` — fastapi-users: `POST /jwt/auth/login|logout`, `GET/PATCH /jwt/users/me/`.
- Custom-эндпоинты (`chats`, `messages`, `users/…`) используют `get_current_user` (`api_v1/auth/utils.py`), который принимает **те же** JWT от fastapi-users (в `decode_jwt` отключена проверка `aud`, субъект сверяется с БД). Защищённые от собственных токенов.

### Профиль и аватар

- `GET/PATCH /api/v1/jwt/users/me/` — профиль (схема `UserWithDetailsSchema`, включает `id`, `username`, `avatar_url`, `profile`, `chats`).
- `PUT /api/v1/users/me/avatar/?ext=png` — загрузка фото аватара. Тело запроса = **сырые байты** файла (без multipart), `ext` из белого списка `png/jpg/jpeg/gif/webp`, лимит 8 МБ. Возвращает `{avatar_url}` (`/media/avatars/…`).
- `DELETE /api/v1/users/me/avatar/` — удаление аватара (и файла). Возвращает `{avatar_url: null}`.
- `avatar_url` отдаётся в профиле, поиске/контактах и участниках чатов.

### Медиафайлы

- Каталог `backend/media/`, раздаётся приложением: `/media/...` (FastAPI `StaticFiles`, см. `main.py`).
- Файлы сообщений кладутся в `backend/media/` корень, аватары — в `backend/media/avatars/`.
- `backend/media/` добавлен в `.gitignore`.
- Загрузка файла-сообщения идёт **без python-multipart**: `POST /api/v1/messages/attachment/`, тело = байты, метаданные в query (см. ниже).

### Полный список эндпоинтов (актуально)

> Префикс всех маршрутов ниже: `/api/v1`.

| Метод | Путь | Описание | Доступ |
|---|---|---|---|
| GET | `/` | health «Hello World» | — |
| POST | `/auth/request-otp/` | запросить SMS-код | — |
| POST | `/auth/verify-otp/` | проверить код → токен | — |
| POST | `/auth/token/` | вход по логину+паролю | — |
| GET | `/auth/basic-auth/`, `/auth/basic-auth-username/` | отладочные | Basic |
| POST | `/jwt/auth/login`, `/jwt/auth/logout` | fastapi-users | — |
| GET | `/jwt/users/me/` | мой профиль | токен |
| PATCH | `/jwt/users/me/` | обновить профиль | токен |
| GET | `/set-csrf-token` | CSRF-токен в cookie | — |
| GET | `/chats/` | мои чаты + `unread_count` + `last_message` | токен |
| POST | `/chats/private/` | найти/создать личный чат `{user_id}` | токен |
| POST | `/messages/` | текст `{chat_id, text, reply_to_id?}` | токен |
| POST | `/messages/attachment/` | файл (query: chat_id, filename, caption?, reply_to_id?, mime?) | токен |
| GET | `/messages/{chat_id}/` | история (входящие помечаются прочитанными) | токен |
| GET | `/messages/{chat_id}/pinned/` | закреплённые | токен |
| PATCH | `/messages/{message_id}/pin/` | закрепить/открепить `{is_pinned}` | токен |
| PUT | `/messages/{message_id}/reaction/` | поставить реакцию `{emoji}` | токен |
| DELETE | `/messages/{message_id}/reaction/` | снять свою реакцию | токен |
| DELETE | `/messages/{message_id}/` | удалить (только своё) | токен |
| GET | `/users/` | все пользователи (с профилями) | — |
| GET | `/users/contacts/` | все, кроме меня (для «Контактов») | токен |
| GET | `/users/search/?q=` | поиск по логину/телефону (исключает себя) | токен |
| GET | `/users/{user_id}/` | пользователь по id | — |
| GET | `/users/{user_id}/chats/`, `/users/{user_id}/posts/` | вложенные списки | — |
| POST | `/users/` | создать пользователя | — |
| PUT | `/users/me/avatar/` | загрузить аватар (raw bytes) | токен |
| DELETE | `/users/me/avatar/` | удалить аватар | токен |
| GET/POST/PUT/PATCH/DELETE | `/products/…`, `/posts/…`, `/telegram/webhook` | **legacy** (с мессенджером не связаны) | разное |

Проверка доступа к чату/сообщениям: только участник чата (иначе `403`); чат с самим собой — `400`; чужие сообщения удалять — `403`.

### Модель данных (основное)

- `user` — `id`, `username` (уник.), `phone_number` (уник., null), `first_name`, `last_name`, `email` (nullable), `hashed_password`, `avatar_url`, профиль, чаты (m2m), сообщения, посты.
- `profile` — 1:1 к `user`: `bio`, `birth_date` (строка `YYYY-MM-DD`), `language`, `country`, `notifications_enabled`, `privacy_mode`.
- `chats` — `id`, `name`; участники через m2m `chat_user_association`. **Личный чат = ровно 2 участника**.
- `messages` — `id`, `text`, `timestamp` (default now()), `user_id`, `chat_id`, `reply_to_id` (self FK), `is_read`, `is_pinned`, `file_name/file_url/mime_type/file_size`.
- `message_reactions` — PK `(message_id, user_id)`, `emoji` (по одной реакции на пользователя).
- `post`/`product`/`order`/`group` — legacy/частично удалённые (группы и старые таблицы постов удалены миграциями; фича групп убрана).

### Миграции (Alembic, история)

Порядок применения соответствует алфавитному списку файлов в `backend/alembic/versions/`:

1. `2025_09_26_1500-af1092652727` — create_product_table
2. `2025_09_26_1535-0cc3c27eafd7` — create_user_table
3. `2025_09_26_1543-53f8b30a4eeb` — create_post_table
4. `2025_09_27_0020-34fafed7eb55` — create_profile_table
5. `2025_10_05_2010-62dfe3e7b819` — create_order_table
6. `2025_10_07_1324-06563a2a8e6e` — add_users_api_to_user_model
7. `2026_05_14_1200_a1b2c3d4e5f6` — change_hashed_password_type_to_varchar
8. `2026_05_15_1200_create_group_and_user_group_tables` — (потом удалено, фича групп убрана)
9. `2026_09_03_1400_add_chat_message_and_association_tables` — чаты/сообщения/ассоциации, удаление старых group/post
10. `2026_09_05_1200_add_fields_to_profile_model` — поля профиля
11. `2026_09_05_1530-ee0f5b7a9c21` — расширение messages (reply/read/pin/file) + `message_reactions`
12. `2026_09_05_1700-9f3a2b6c4d01` — `user.avatar_url`

Применение: `cd backend && poetry run alembic upgrade head`. В docker-стеке миграции выполняются автоматически при старте контейнера `web`.

### Проверки backend (должны проходить)

```bash
cd backend
poetry run flake8 . --exclude=.mypy_cache,__pycache__
poetry run isort .
poetry run black .
poetry run mypy main.py core api_v1
```

Замечания:

- Poetry env живёт в `~/.cache/pypoetry/virtualenvs/backend-*` (можно использовать и на хосте, и в контейнере).
- `mypy` лучше запускать с `--cache-dir=/tmp/<xxx>`, чтобы не плодить `root`-овые `.mypy_cache` в репозитории.
- `api_v1/users/schemas.py` **исключён из Black** (`tool.black.exclude`) — форматируйте вручную.
- В alembic-версиях допустимы строки длиннее 88 (per-file-ignore E501).

## 6. Frontend — детали

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

### Ключевые точки

- `main.ts` — PrimeVue (aura), тема через `data-theme=dark/light` (`stores/theme.ts`), инициализация auth.
- `router/index.ts` — `/` → `Messenger.vue`, `/auth/login/` → `Login`; guard на auth.
- `stores/auth.ts`:
  - состояние: `user`, `current_user`, `isAuthenticated`, `accessToken`, `refreshToken` (в localStorage);
  - методы: `initializeApp`, `requestOtp`, `loginWithOtp`, `fetchUser`, `updateCurrentUser`, `logout`, `refreshTokens`;
  - `ApiUser`/`ApiUserProfile` — типы.
- `services/api.ts` — axios-инстанс `api` (baseURL `https://localhost:8000/api/v1`, добавляет `Authorization`); экспортирует функции по пользователям/группам и `uploadAvatar`/`removeAvatar`; также `export { api }`.
- `services/chatService.ts` — `mediaUrl`, `fetchMyChats`, `openPrivateChat`, `fetchMessages`, `fetchPinnedMessages`, `sendNewMessage`, `sendAttachmentMessage`, `setMessagePinned`, `setMessageReaction`/`removeMessageReaction`, `deleteMessage`, `searchUsers`, `fetchContacts`; тип `SearchUserResult`.
- `types/index.ts` — `Chat`, `ChatUser`, `Message`, `MessageFile`, `ReactionSummary`, `CreateMessageRequest`, `OpenPrivateChatRequest`, `User`, `Profile`, `Group`.
- **Бейджи/чтение**: сообщение считается прочитанным, когда собеседник открыл/читает чат (`GET /messages/{chat_id}/` помечает входящие `is_read`). На фронте: свои сообщения показывают `✓✓` (синее — прочитано); `unread_count` — бейджи в списке чатов и в нижней навигации.

### Экраны

- `Messenger.vue` — Telegram-подобный вид: панель «Чаты/Контакты», поиск людей, лист диалогов, окно чата (пузыри вправо/влево, day-разделители, reply-цитата, закреплённые сверху, файлы/картинки, реакции, hover-действия, поиск по сообщениям), нижняя навигация. Модалки «Настройки профиля» (`UserProfile`) и входа (`LoginModal`). Polling каждые 3 с.
- `UserProfile.vue` — редактирование профиля + аватар (клик по аватару → выбор файла, удаление фото, кнопка «Выйти»).
- `Login.vue` / `LoginModal.vue` — вход по SMS (шаг телефон → OTP, автофокус кода).
- Прочие (`Users.vue`, `Posts.vue`, `Products.vue`, `GroupsPage.vue`, `ManageGroupUsers.vue`, `SettingsView.vue`) — legacy-UI; `SettingsView` сейчас не используется.

### Особенности PrimeIcons

В выбранном наборе иконок **нет** `pi-pin`, `pi-smile`, `pi-check-double` — используйте `pi-bookmark`, `pi-face-smile`, галочки текстом `✓✓`.

## 7. Общие правила и «грабли» (важно помнить)

- Приватный чат — это `Chat` ровно с 2 участниками в `chat_user_association`; поиск/создание — через `chats/crud.get_or_create_private_chat`.
- В модели `Message` поле `timestamp` уже было в БД (default `now()`) — оно отображается в модели, **без** отдельной миграции.
- Маска телефона обязана содержать `+7` (маска `+7 (999) 999-99-99`), иначе валидация «11 цифр, начинается с 7» не сработает.
- `ApiUser.username` обязателен (не `null`) — при сохранении профиля нельзя слать `username: null`.
- Загрузка файлов/аватара — **без** `python-multipart` (сырое тело запроса). Не добавляйте `UploadFile`/`File`, иначе понадобится эта зависимость.
- Сериализация сообщений — dict-хелперы в `messages/crud.py` (`message_to_dict`, `message_basic_to_dict`); реакции агрегируются `{emoji, count, reacted_by_me}`.
- Не регенерируйте `.mypy_cache`/`__pycache__` в репо (часть файлов `root`-овые, не удалить без sudo). Mypy — с `--cache-dir=/tmp/...`.
- Тестовая авторизация «по коду»: код печатается в лог контейнера `web`.
- Перед e2e-проверкой API удобно создать временных пользователей через `POST /users/` + `POST /auth/token/`, а после удалить их по `username`-префиксу.

## 8. Частые команды

```bash
# Backend: применить миграции (в контейнере)
docker exec microshop-web-1 poetry run alembic upgrade head

# Backend: автоформат + линт (на хосте)
cd backend && poetry run isort . && poetry run black . && poetry run flake8 . --exclude=.mypy_cache,__pycache__ && poetry run mypy --cache-dir=/tmp/ms-mypy main.py core api_v1

# Frontend: типы + линт
cd frontend && node node_modules/vue-tsc/bin/vue-tsc.js --build --force && node node_modules/eslint/bin/eslint.js --no-cache src

# Посмотреть код SMS-заглушки (для OTP-теста)
docker logs microshop-web-1 | grep 'Sending SMS'

# SQL напрямую в БД
docker exec -it microshop-db-1 psql -U postgres -d microshop
```

## 9. Известные ограничения / TODO

- Групповые чаты не реализованы (модель личных чатов).
- Нет WebSocket — используется polling 3 с.
- SMS-провайдер не подключён (код пишется в лог).
- Dark-тема и оформление профиля/логина не полностью адаптированы под тёмный режим.
- Удаление аватара/файлов не затрагивает записи истории (намеренно).
- Legacy-модули (products/posts/telegram) не поддерживаются в рамках мессенджера.
