# Microshop — мессенджер

> Полное описание проекта: стек, структура, запуск, API, модель данных, проверки и подводные камни. Обновляется вместе с кодом — используйте его как единую точку входа вместо перечитывания кода.

## 1. Что это за проект

Веб-приложение-мессенджер (личные переписки 1-на-1 в стиле Telegram) с регистрацией/входом по номеру телефона через SMS-код (OTP).

> Актуальное состояние фиксируется в этом разделе; ниже в README часть разделов описывает более ранние итерации и обновляется постепенно — при расхождении ориентируйтесь на код и этот раздел.

Реализовано на данный момент:

- **Мессенджер** (адаптивный, десктоп + мобильный drawer):
  - список диалогов: превью, время, счётчик непрочитанных, галочки прочтения ✓✓, **закреплённые чаты** (пин вверху), **онлайн-точка** на аватаре и «печатает…» в превью;
  - поиск: **люди** (логин/телефон) и **глобальный поиск по сообщениям во всех чатах** (вкладки «Люди | Сообщения», переход к сообщению с подсветкой);
  - вкладка **«Контакты»** (все пользователи + поиск);
  - отправка текста (поле многострочное: Enter — отправить, Shift+Enter — перенос), **файлов/картинок/GIF**, **ответ (reply)**, **закрепление сообщений**, **реакции-эмодзи**, hover-действия (ответить/реакция/пин/копировать/редактировать/переслать/удалить), **редактирование**, **пересылка** (диалог с выбором нескольких чатов);
  - **голосовые и видео-«кружки»** (запись в чате + плеер), **аудио/видеозвонки 1-1** (WebRTC, сигналинг по WS);
  - **просмотр изображений на весь экран** (лайтбокс: листание по всем картинкам треда, скачивание);
  - **«Информация о чате»** (карточка собеседника + общие изображения/файлы);
  - **переход к цитируемому сообщению** по клику на reply-цитату (с подсветкой);
  - **удаление чата** с модалкой «только у меня / для всех» (кнопки пин/удалить — на строке диалога);
  - **черновики** текста при переключении чатов (по пользователю, в localStorage); в списке показывается «Черновик: …»;
  - realtime: WebSocket-канал (message/chat.read/presence/typing) + «страховочный» polling 20 с; **уведомления** о новых сообщениях внутри приложения (когда чат не открыт) + счётчик непрочитанных в заголовке вкладки;
  - **присутствие**: «в сети» / «был(а) N … назад» (по `user.last_seen` + WS online/offline) в списке и шапке;
  - **темы и оформление**: тёмная/светлая/системная, акцентный цвет, цвет «моих» сообщений, обои (пресеты или своё фото) — сохраняются в localStorage.
- **Профиль и настройки** (`UserProfile`): имя/логин/email/**телефон** (маска +7)/био/**текст-статус**/дата рождения/язык/страна, уведомления, приватный режим, **аватар** (загрузка/удаление), выход.
- **Вход по телефону** (шаг «номер +7» → «код из SMS»; OTP-коды в БД с попытками/кулдауном; rate-limit по IP).
- Backend-качество: refresh-токены с ротацией/отзывом, rate-limit, pg_trgm-поиск, X-Request-ID и лог медленных запросов, Celery+RabbitMQ (SMS/GIF/очистка медиа по расписанию), health-эндпоинты, pytest, CI (black/isort/flake8/mypy/vue-tsc/eslint/vitest).
- Legacy-модули `products`/`posts`/`telegram` — с мессенджером не связаны (кандидаты на удаление).

Ограничения (сознательные/текущие): только личные чаты (групповых нет — фича убрана); WebRTC-звонки без TURN (работают в локальных сетях); SMS — заглушка (код печатается в лог контейнера `web`); Web Push/PWA-уведомления не реализованы; секреты должны задаваться через `.env` (см. раздел 9).

## 2. Стек

| Слой | Технологии |
|---|---|
| Backend | Python 3.13, FastAPI 0.115, SQLAlchemy 2 (async), asyncpg, Alembic, pydantic v2, pwdlib(Argon2), fastapi-users 15 (JWT) |
| Frontend | Vue 3 (Composition API), TypeScript, Vite 7, Pinia, Vue Router, **Quasar 2 + @quasar/extras (Material-иконки)**, axios |
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
├── entry.sh                   # dump_db.sh && docker compose down -v && build && up
├── dump_db.sh                 # сохранить дамп БД в ./db_dump (вызывается из entry.sh)
├── restore_db.sh              # восстановить БД из дампа вручную
├── cron_dump_db.sh            # обёртка дампа для cron: лог + ротация архива (см. разд. 4)
├── install_cron_backup.sh     # установка ежедневного дампа в crontab пользователя
├── db_dump/                   # дампы БД: microshop_latest.sql + archive/ + logs/ (в .gitignore)
└── queries.sql                # черновик SQL-запросов
```

> Файл `backend/api_v1/groups/` — пустой остаток удалённой фичи «группы» (модели нет).

## 4. Запуск

### Основной (Docker Compose) — рекомендуется

Контейнеры: `web` (FastAPI :8000 HTTPS + авто-миграции), `db` (Postgres), `rabbitmq` (брокер Celery/mост realtime, management UI :15672), `worker` (фоновые задачи Celery), `beat` (планировщик периодических задач), `frontend` (Vite :5173 HTTPS), `nginx` (:8080 HTTP, dev-прокси к frontend и API).

```bash
./entry.sh                 # = dump_db.sh && docker compose down -v --rmi all && build && up
# или вручную (данные в volume сохранятся):
docker compose up --build  # из корня microshop
```

После старта:

- **Backend (HTTPS)**: https://localhost:8000 — Swagger: https://localhost:8000/docs (OpenAPI: `/openapi.json`).
- **Frontend (HTTPS)**: https://localhost:5173 (нужно принять самоподписанный сертификат).
- **Nginx (HTTP, отладка)**: http://localhost:8080.

`entry.sh` делает полный сброс (`down -v --rmi all`), но **перед этим снимает дамп БД**, а при старте на пустом volume база **автоматически восстанавливается из дампа** — данные не теряются.

### Резервное копирование БД (дамп/восстановление)

| Что | Команда | Когда срабатывает |
|---|---|---|
| Автодамп перед сбросом | `./entry.sh` | дамп в `./db_dump/microshop_latest.sql`, затем `down -v` |
| Ручной дамп | `./dump_db.sh` | в любой момент (сервис `db` поднимет сам, если нужно) |
| **Автодамп по cron** | `./install_cron_backup.sh` (однократно) | ежедневно в 03:00 — см. ниже |
| Авто-restore | `docker compose up` | только когда volume БД создан заново/пуст (после `down -v`): postgres сам выполняет `./db_dump/*.sql` из `/docker-entrypoint-initdb.d` |
| Ручной restore | `./restore_db.sh [файл.sql]` | перезаписывает данные в запущенной БД (осторожно!) |

- Актуальный дамп: `db_dump/microshop_latest.sql`; архивные копии по датам — `db_dump/archive/`. Папка `db_dump/` в `.gitignore` (в git лежат только пустые `.gitkeep`).

#### Автоматический дамп по cron (регулярное резервное копирование)

Задача ставится в **crontab пользователя** на хосте (там, где запускается `docker compose`) и ежедневно снимает дамп БД:

```bash
./install_cron_backup.sh            # ежедневно в 03:00
# при необходимости другое расписание, например каждые 6 часов:
CRON_SCHEDULE='0 */6 * * *' ./install_cron_backup.sh
```

Что происходит по расписанию (скрипт `./cron_dump_db.sh`):

- запускается `./dump_db.sh` — обновляется `db_dump/microshop_latest.sql` и создаётся архивная копия `db_dump/archive/microshop_<дата>.sql`;
- пишется лог в `db_dump/logs/cron.log`;
- хранится только последние **30** архивных копий (лимит задаётся переменной `ARCHIVE_KEEP`, лог — `DUMP_LOG_FILE`).

Проверка/удаление задачи:

```bash
crontab -l | grep '# microshop-db-backup'              # посмотреть задачу
crontab -l | grep -v '# microshop-db-backup' | crontab -   # удалить
```
- Дамп полный (`pg_dump --clean`), включает и схему, и данные, и таблицу `alembic_version`. Поэтому после restore миграции на старте `web` — no-op; если позже появятся новые миграции — применятся поверх восстановленных данных.
- Если БД пустая (нет таблиц), `dump_db.sh` не затирает прежний дамп.

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
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672/` | URL RabbitMQ (брокер Celery + мост realtime) |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | — | учётка RabbitMQ (для контейнера `rabbitmq` и URL) |
| `CORS_ORIGINS` | `https://localhost:5173`, `http(s)://localhost:5173` | CORS |
| — | `api_v1_prefix=/api/v1` | префикс API |
| — | `auth_otp_expire_seconds=300` | время жизни OTP |

В docker-стеке `DATABASE_URL` задаётся в `docker-compose.yaml` для сервиса `web`. Файл `.env.dev` в корне сейчас закомментирован (не используется).

#### Фоновые задачи: Celery + RabbitMQ

Брокер очередей **RabbitMQ** (`rabbitmq`), воркер **Celery** (`worker`) и планировщик **`beat`** поднимаются в том же compose-стеке автоматически. Учётка RabbitMQ задаётся в `.env`: `RABBITMQ_USER`, `RABBITMQ_PASSWORD` (guest между контейнерами не работает — RabbitMQ пускает его только с localhost). Management UI: http://localhost:15672.

Что уже переведено на фоновые задачи:

| Задача | Модуль | Что делает | Вызывается |
|---|---|---|---|
| `send_sms_otp` | `tasks/otp_tasks.py` | доставка OTP-кода (SMS-заглушка) | эндпоинт `POST /auth/request-otp/` |
| `download_gif_message` | `tasks/media_tasks.py` | скачивание GIF (Giphy/Tenor) + создание сообщения | `POST /messages/gif/` (отвечает 202) |
| `cleanup_orphan_media` | `tasks/media_tasks.py` | очистка файлов media без ссылок в БД | **celery beat** ежедневно в 04:00 UTC |
| `send_email` | `tasks/notifications.py` | каркас e-mail/уведомлений (заглушка) | — (структура для будущих) |

**Важные следствия для разработки:**

- **Код OTP для входа** печатается в лог контейнера `web` (как и до Celery) —
  `docker compose logs -f web | grep SMS-заглушка`; воркер дополнительно
  логирует его при фактической «отправке» (`docker compose logs -f worker`).
- **GIF** создаётся асинхронно: эндпоинт отвечает `202 Accepted`, воркер скачивает файл в общий media и создаёт сообщение в БД, затем через **RabbitMQ-мост** web раздаёт `message.new` в живые WebSocket-сокеты (включая отправителя, т.к. свои сообщения фронт не добавляет локально). Если RabbitMQ недоступен — web-мост сам переподключается в фоне.
- Realtime (presence/typing/chat.read) **не** переводилось на воркер: WebSocket-соединения живут в процессе `web`, поэтому доставка в сокеты остаётся в `web` (in-process manager). Воркер лишь *публикует* события в мост.
- Ручной запуск: `docker compose exec worker poetry run celery -A core.celery_app inspect active` (диагностика). Логи: `docker compose logs -f worker beat`.

Локально без Docker (для отладки тасок) нужен поднятый RabbitMQ (напр. `docker compose up -d rabbitmq`) и `RABBITMQ_URL`; воркер запускается `cd backend && poetry run celery -A core.celery_app worker --loglevel=INFO`.

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
| POST | `/jwt/auth/login`, `/jwt/auth/logout` | fastapi-users | — |
| POST | `/jwt/auth/refresh` | ротация refresh-токена → новая пара access+refresh | токен (refresh) |
| GET | `/jwt/users/me/` | мой профиль | токен |
| PATCH | `/jwt/users/me/` | обновить профиль | токен |
| GET | `/messages/search/?q=&chat_id=` | поиск по тексту/имени файла (без chat_id — по всем чатам) | токен |
| WS | `/ws/events?token=` | realtime-события (message/chat.read/presence/typing) | токен |
| WS | `/ws/calls?token=` | сигналинг WebRTC-звонков | токен |
| GET | `/chats/` | мои чаты + `unread_count` + `last_message` | токен |
| POST | `/chats/private/` | найти/создать личный чат `{user_id}` | токен |
| POST | `/messages/` | текст `{chat_id, text, reply_to_id?}` | токен |
| POST | `/messages/attachment/` | файл (query: chat_id, filename, caption?, reply_to_id?, mime?) | токен |
| POST | `/messages/gif/` | GIF: URL → очередь (Celery скачивает и создаёт сообщение, 202) | токен |
| GET | `/messages/{chat_id}/` | история (входящие помечаются прочитанными; `limit`/`before_id` — пагинация) | токен |
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
poetry run mypy main.py core api_v1 tasks
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

- `main.ts` — Quasar 2 (Dialog/Notify, lang ru, Material-иконки), тема/оформление через `stores/theme.ts` (`data-theme`, токены `--ms-*`), инициализация auth.
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

- `Messenger.vue` — адаптивный Telegram-подобный вид: `q-layout` + `q-drawer` (панель «Чаты/Контакты»; на мобильном — выдвижной drawer), список диалогов (пины/онлайн/«печатает…»), окно чата (пузыри вправо/влево, day-разделители, reply-цитата, закреплённые сверху, файлы/картинки, реакции, hover-действия, inline-поиск по сообщениям). Модалки: «Настройки профиля» (`UserProfile`), «Оформление» (`AppearanceSettings`), «Информация о чате» (`ChatInfo`), вход (`LoginModal`), лайтбокс изображений (`ImageLightbox`). Обновления — WS-события + fallback-polling 20 с.
- `UserProfile.vue` — редактирование профиля + аватар (клик по аватару → выбор файла, удаление фото, кнопка «Выйти»); телефон — нативный input с маской `+7 (…)`.
- `Login.vue` / `LoginModal.vue` — вход по SMS (шаг телефон → OTP, автофокус кода).
- Компоненты мессенджера вынесены в `components/messenger/` (`ChatSidebar`, `ChatHeader`, `MessageThread`, `MessageRow`, `MessageComposer`, `PinnedBar`, `InlineSearchBar`, `ChatPlaceholder`, `ChatInfo`, `ForwardDialog`); медиа — в `components/media/` (лайтбокс, голос/видео/кружки, GIF-пикер); звонки — `components/calls/`. Реактивное присутствие/печать — `composables/usePeerActivity`, realtime-оркестрация — `composables/useRealtimeSync`, запись — `useRecordButton`.

### Иконки (Material)

После миграции на Quasar используются Material-иконки через `<q-icon name="…">` (напр. `call`, `videocam`, `mic`, `push_pin`, `sentiment_satisfied_alt`, `check`, `send`, `download`…). Галочки прочтения — текстовые `✓✓`. Не используйте классы PrimeIcons `pi pi-*` (шрифт не подключён).

## 7. Общие правила и «грабли» (важно помнить)

- Приватный чат — это `Chat` ровно с 2 участниками в `chat_user_association`; поиск/создание — через `chats/crud.get_or_create_private_chat`.
- В модели `Message` поле `timestamp` уже было в БД (default `now()`) — оно отображается в модели, **без** отдельной миграции.
- Маска телефона обязана содержать `+7` (маска `+7 (999) 999-99-99`), иначе валидация «11 цифр, начинается с 7» не сработает.
- `ApiUser.username` обязателен (не `null`) — при сохранении профиля нельзя слать `username: null`.
- Загрузка файлов/аватара — **без** `python-multipart` (сырое тело запроса). Не добавляйте `UploadFile`/`File`, иначе понадобится эта зависимость.
- Сериализация сообщений — dict-хелперы в `messages/crud.py` (`message_to_dict`, `message_basic_to_dict`); реакции агрегируются `{emoji, count, reacted_by_me}`.
- Не регенерируйте `.mypy_cache`/`__pycache__` в репо (часть файлов `root`-овые, не удалить без sudo). Mypy — с `--cache-dir=/tmp/...`.
- Тестовая авторизация «по коду»: код печатается в лог контейнера **`web`** (`docker compose logs -f web | grep SMS-заглушка`); отправка OTP уходит в Celery-воркер, который тоже логирует код при «отправке».
- Перед e2e-проверкой API удобно создать временных пользователей через `POST /users/` + `POST /auth/token/`, а после удалить их по `username`-префиксу.

## 8. Частые команды

```bash
# Backend: применить миграции (в контейнере)
docker exec microshop-web-1 poetry run alembic upgrade head

# Дамп / восстановление БД (см. раздел 4)
./dump_db.sh                 # сохранить дамп в ./db_dump
./restore_db.sh              # восстановить из ./db_dump/microshop_latest.sql

# Backend: автоформат + линт (на хосте)
cd backend && poetry run isort . && poetry run black . && poetry run flake8 . --exclude=.mypy_cache,__pycache__ && poetry run mypy --cache-dir=/tmp/ms-mypy main.py core api_v1 tasks

# Frontend: типы + линт
cd frontend && node node_modules/vue-tsc/bin/vue-tsc.js --build --force && node node_modules/eslint/bin/eslint.js --no-cache src

# Посмотреть код OTP (SMS-заглушка): в web-логе (основное) и в воркере
docker compose logs -f web | grep 'SMS-заглушка'
docker compose logs -f worker | grep 'SMS-заглушка'

# Фоновые задачи (Celery)
docker compose logs -f worker beat          # логи воркера/планировщика
docker compose restart worker beat          # перезапустить после правки тасок
docker compose exec worker poetry run celery -A core.celery_app inspect active

# RabbitMQ management UI: http://localhost:15672 (учётка из .env: RABBITMQ_USER/RABBITMQ_PASSWORD)

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

## 9. Улучшения и безопасность (2026-09-07)

### Окружение и секреты
- Секреты вынесены из кода/композа в корневой **`.env`** (в `.gitignore`); образец — `.env.example`. `docker compose` требует `POSTGRES_PASSWORD` и `JWT_SECRET_KEY`, при отсутствии файла `.env` останавливается с понятной ошибкой.
- `backend/core/config.py`: `JWT_SECRET_KEY` читается из окружения; если не задан — в лог пишется предупреждение (используется только dev-запасной ключ).
- **Требует действий:** смените `JWT_SECRET_KEY`/пароль БД, если значения попадали в публичный git (ротация + пересоздание volume). Старый файл `.env.dev` удалён из индекса.

### Аутентификация (OTP)
- OTP-коды теперь хранятся в **БД** (`otp_codes`, хеш + счётчик попыток), а не в памяти — переживают рестарт и работают при нескольких воркерах.
- Защита от перебора: лимит неверных попыток (`AUTH_OTP_MAX_ATTEMPTS`, по умолч. 5), кулдаун повторной отправки (`AUTH_OTP_RESEND_COOLDOWN_SECONDS`, 30 с, HTTP 429 + `Retry-After`).
- Удалены отладочные эндпоинты `/auth/basic-auth*`.

### Загрузка файлов
- Вложения и аватары проверяются: расширение из белого списка + сигнатура (magic bytes) для изображений. HTML/SVG/JS/XML и неизвестные типы отклоняются (защита от stored-XSS через `/media/...`).
- Импорт GIF: запрещены HTTP-редиректы (защита от SSRF), проверяется host, порт/userinfo и что ответ действительно GIF.

### Присутствие и БД
- `last_seen` больше не обновляется в `get_current_user` (не было лишних commit на каждый read-only запрос); теперь присутствие обновляется в poll-эндпоинте `GET /chats/`.
- При удалении сообщения его файл удаляется с диска (best-effort).
- `GET /messages/{chat_id}/` поддерживает пагинацию: `?limit=` и `?before_id=` (по умолчанию — вся история, как раньше). Добавлен индекс `(chat_id, timestamp)`.

### Docker
- Образы закреплены: `postgres:18`, `nginx:1.27-alpine`; у `db` появился `healthcheck`, `web` стартует после `service_healthy`.
- Релоад управляется переменной `UVICORN_RELOAD` (по умолчанию 1 для разработки, `0` — для «продового» запуска).

### Тесты и CI
- Backend: `pytest` + `pytest-asyncio` (dev). Юнит-тесты: `backend/tests/test_upload_guard.py`, `test_otp_storage.py` (чистые тесты хеширования; БД-тесты выполняются при заданном `TEST_DATABASE_URL`).
- Frontend: устаревший тест-шаблон `App.spec.ts` заменён на `src/__tests__/errors.spec.ts`.
- Добавлен GitHub Actions (`.github/workflows/ci.yml`): backend (black/isort/flake8/mypy/pytest c PostgreSQL-сервисом) и frontend (vue-tsc/eslint/vitest).

### Frontend: адреса и чистка
- Адреса бэкенда централизованы в `src/config.ts` (`API_ORIGIN`, `API_BASE_URL`, `WS_ORIGIN`, `mediaUrl`); переопределяются через `VITE_API_ORIGIN` (см. `frontend/.env.example`).
- Удалены неиспользуемые legacy-компоненты (`Home/Posts/Users/GroupsPage/ManageGroupUsers/Products/Registration/SettingsView`, `auth.js`) и мёртвый scoped-CSS из `Messenger.vue`; из `services/api.ts` убраны неиспользуемые функции групп.

### Ручные шаги после этого обновления
1. `cp .env.example .env` и задайте свои значения (или используйте сгенерированный `.env`).
2. Из-за смены пароля БД пересоздайте volume: `./entry.sh` (снимет дамп и поднимет заново) или `docker compose down -v && docker compose up --build`.
3. Применятся новые миграции (`otp_codes`, индекс `messages`).
4. Если репозиторий публичный — смените/ротируйте секреты из git-истории.

### Итерация 2 (2026-09-07)

- **Refresh-токены заработали**: `POST /jwt/auth/refresh` обменивает refresh на новую пару (access + refresh). Refresh — отдельный JWT (`aud: microshop:refresh`, `type: refresh`), не принимается как access (`get_current_user` отклоняет). Выдаётся при OTP-входе и `/auth/token`. Раньше `/jwt/auth/refresh` не существовал, refreshToken всегда был null, и сессия обрывалась через ~30 мин.
- **Удалён CSRF-рудимент**: эндпоинт `GET /set-csrf-token` (модуль `general.py`) и фронт-хелперы `setCsrfToken`/`getCSRFToken`/`getAddress` — CSRF не используется (JWT в заголовке).
- **Health**: `GET /health` (liveness) и `GET /health/ready` (проверка БД, 503 при недоступности) в `main.py`.
- **Логирование**: SMS-заглушка пишет через `logging` вместо `print`.
- **Зависимости**: `python-jose` удалён; `PyJWT` добавлен явно (именно его использует `import jwt`). Обновился `poetry.lock` (убраны rsa/pyasn1/six).
- **Docker**: `backend/Dockerfile` — не-root пользователь `microshop` (uid 1000, совпадает с uid хоста для dev-тома), venv/кеш poetry в `/home/microshop` (вне `/app`, чтобы не прятаться под bind-томом). `.dockerignore` исключает `backend/media/`, `db_dump/`, `*.sql`, `.env`.
- **Очистка «сирот» медиа**: `backend/scripts/cleanup_orphan_media.py` (dry-run по умолчанию, `--delete` для удаления) — находит файлы в `media/`, на которые нет ссылок в БД. Запуск: `poetry run python -m scripts.cleanup_orphan_media [--delete]` (с доступом к БД, напр. в контейнере `web`).
- `CORS_ORIGINS` можно задать в `.env` (JSON-список), см. `.env.example`.

> Осталось (крупные, по порядку): real-time (WebSocket) для сообщений, декомпозиция `Messenger.vue`, TURN для звонков, подгрузка старых сообщений в UI, индикатор «печатает», расширение тестов.
