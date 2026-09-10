# Pismo — мессенджер

> Полное описание проекта: стек, структура, запуск, API, модель данных, проверки и подводные камни. Обновляется вместе с кодом — используйте его как единую точку входа вместо перечитывания кода.

## 1. Что это за проект

Веб-приложение-мессенджер (личные переписки 1-на-1 в стиле Telegram) с регистрацией/входом по номеру телефона: код подтверждения на номер (когда подключён шлюз) + пароль для последующих входов.

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
- **Профиль и настройки** (`UserProfile`): имя/логин/email/био/**текст-статус**/дата рождения/язык/страна, уведомления, приватный режим, **аватар** (загрузка/удаление), выход. **Телефон — логин аккаунта: в профиле он только для чтения** (замена — через поддержку, `nyuskov@gmail.com`).
- **Вход/регистрация по номеру телефона**: 1) вводится номер → `POST /auth/password/status/` говорит, есть ли аккаунт/пароль и доступна ли доставка кода; 2) если пароль есть — вход по нему (`/auth/password/login/`); 3) если пароля нет, но канал доставки настроен (`otp_available`) — сначала код на номер (`/auth/request-otp/` → `/auth/verify-otp/`), затем «придумайте пароль» (`/auth/password/set/`), чтобы дальше входить без SMS; 4) если канал доставки не настроен — пароль предлагается сразу (иначе регистрация была бы невозможна).
- Backend-качество: refresh-токены с ротацией/отзывом, rate-limit, pg_trgm-поиск, X-Request-ID и лог медленных запросов, Celery+RabbitMQ (SMS/GIF/очистка медиа по расписанию), health-эндпоинты, pytest, CI (black/isort/flake8/mypy/vue-tsc/eslint/vitest).
- **Модерация пользовательского контента** (требование RuStore к UGC): «Пожаловаться» на собеседника и на конкретное сообщение (причины + комментарий), «Заблокировать» (диалог скрывается, сообщения в обе стороны блокируются, список «Заблокированные»), «Удалить аккаунт» в профиле (пароль + подтверждение). Разбор жалоб — служебный экран «Жалобы» для `is_superuser` (статусы `new/in_review/resolved/rejected`, заметка модератора, вкладка «Журнал»), эндпоинты `GET/PATCH /moderation/reports/`; инструкция — `docs/rustore.md`, §9.1.
- **Автоматика модерации** (`MODERATION_AUTO_HIDE_REPORTS=3`): три жалобы от РАЗНЫХ пользователей на одно сообщение скрывают его до разбора, автор получает письмо; счёт идут именно разные заявители, иначе один человек мог бы скрыть чужой контент. Скрытое видят все, **кроме автора** — он видит пометку «Скрыто до проверки модератором» (и причину) и может отредактировать сообщение. Скрытое не отдаётся в поиске, закреплённых и превью чатов, его нельзя переслать. Решение модератора (`resolved`) оставляет скрытие, `rejected` — восстанавливает контент; заявителю уходит письмо с решением. Все действия (включая действия автомата) пишутся в журнал `moderation_actions` (`GET /moderation/journal/`), есть возврат всех сообщений автора одним действием (`POST /moderation/users/{id}/unhide/`).
- **Мобильное приложение для RuStore** (`android/`): WebView-оболочка над тем же веб-клиентом (pismo.space) + RuStore Push SDK вместо Web Push; сборка AAB/APK без установки Android SDK на хост (`scripts/rustore/build_android.sh`, образ `android/Dockerfile.build`), ключ подписи, App Links, политика конфиденциальности, скриншоты — см. `docs/rustore.md`.
- Legacy-модули `products`/`posts`/`telegram` — с мессенджером не связаны (кандидаты на удаление).

Ограничения (сознательные/текущие): групповые чаты есть, но звонки/E2EE — только для личных 1-1; E2EE — без forward secrecy (один ключ на устройство, старая история не читается с нового устройства, медиа не шифруются); push идут через Web Push (PWA/браузер) и RuStore Push (Android-приложение), секреты должны задаваться через `.env` (см. раздел 9). Вход/регистрация — **по номеру телефона и паролю**: подтверждение номера кодом включается автоматически, как только в `.env` прода заданы SMS Aero (`SMS_AERO_*`) или Telegram Gateway (`TELEGRAM_GATEWAY_TOKEN`); пока канал не подключён, код доставить нечем и экран входа сразу предлагает создать пароль — то есть номер при регистрации не подтверждается (осознанный временный компромисс).

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
│   ├── main.py               # app, CORS, X-Request-ID, /health, mount /media
│   ├── core/
│   │   ├── config.py         # Settings (DATABASE_URL, JWT, RabbitMQ, лимиты, CORS)
│   │   ├── security.py       # хеширование паролей (argon2)
│   │   ├── celery_app.py     # Celery (worker/beat): брокер RabbitMQ
│   │   ├── amqp.py           # fanout-мост realtime web<->worker
│   │   └── models/           # ORM-модели + db_helper (session_dependency)
│   ├── api_v1/               # фиче-модули (роутеры собирает api_v1/__init__.py)
│   │   ├── auth/             # OTP-логин, fastapi-users/JWT, get_current_user
│   │   ├── users/            # профиль, поиск/контакты, аватар
│   │   ├── chats/            # личные чаты 1-1
│   │   ├── messages/         # сообщения: reply/pin/reactions/файлы/пересылка
│   │   ├── calls/            # WebRTC-сигналинг (WS /ws/calls)
│   │   ├── events/           # realtime-канал (WS /ws/events) + мост
│   │   ├── rate_limit.py     # in-memory скользящий лимит (+ enforce_limit)
│   │   ├── upload_guard.py   # валидация вложений (magic bytes, SSRF-guard)
│   │   └── tokens/           # схема Token (использует auth)
│   ├── alembic/versions/     # миграции (см. раздел 5)
│   ├── scripts/              # cleanup_orphan_media.py (очистка медиа-сирот)
│   ├── media/                # загруженные файлы сообщений и аватары (/media)
│   ├── tests/                # pytest: unit + БД/API-интеграция (см. раздел 5)
│   └── certs/                # самоподписанные сертификаты (HTTPS, dev)
├── frontend/                 # Vue 3 + TS + Pinia + Quasar (pnpm)
│   └── src/
│       ├── views/            # Messenger.vue, UserProfile.vue, AppearanceSettings.vue
│       ├── components/       # Login.vue/LoginModal.vue; messenger/, media/, calls/, common/
│       ├── stores/           # auth, theme (оформление), realtime, call
│       ├── composables/      # usePeerActivity, useRealtimeSync, useRecordButton, useCallButton
│       ├── services/         # api, chatService, giphy, recorder, errors
│       ├── utils/            # user, phone, media, thread
│       ├── types/index.ts    # Chat/Message/ChatUser/… типы API
│       ├── config.ts         # API_ORIGIN / API_BASE_URL / WS_ORIGIN / mediaUrl
│       ├── router/index.ts   # "/" → Messenger, "/auth/login/" → Login
│       └── __tests__/        # vitest (unit-тесты)
├── android/                  # Android-приложение для RuStore (WebView + RuStore Push SDK)
├── scripts/rustore/          # сборка AAB/APK, ключ подписи, assetlinks, скриншоты
├── docker-compose.yaml       # дев-стек: db + rabbitmq + web + worker + beat + frontend + nginx
├── docker-compose.dev.yaml   # лёгкий вариант (web+db+nginx)
├── docker-compose.prod.yaml  # прод-стек (см. docs/production.md)
├── nginx/                    # dev-прокси (dev.conf и пр.)
├── entry.sh                  # dump_db.sh && docker compose down -v && build && up
├── dump_db.sh / restore_db.sh              # дамп/восстановление БД
├── backup_media.sh           # снимок media-файлов в db_dump (зовёт cron_dump_db.sh)
├── cron_dump_db.sh / install_cron_backup.sh # ежедневный бэкап (БД + media) по cron
├── backup_offsite.example.sh # пример выгрузки бэкапов в облако (rclone)
├── scripts/backup/           # бэкап прода → ~/Документы/pismo_backup (см. docs/local-backup.md)
├── scripts/monitoring/       # проверка прода + оповещения по e-mail (см. docs/monitoring.md)
├── scripts/ci/               # смоук-тест прода после деплоя (smoke_prod.sh)
├── db_dump/                  # дампы БД + media: latest + archive/ + logs/ (в .gitignore)
├── docs/                     # production.md, offsite-backup.md, local-backup.md, email-smtp.md, monitoring.md, jwt-rotation.md, rustore.md, privacy-policy.md, terms-of-service.md, community-guidelines.md, rkn-notification.md, rkn-checklist.md, pd-internal-documents.md, feature-proposals.md
├── .github/workflows/ci.yml  # backend (lint+mypy+pytest c Postgres) + frontend + deploy + smoke
└── queries.sql
```

> Модули `posts`/`products`/`telegram`/`groups` и их таблицы **удалены** из кода/БД
> (миграция `f6a7b8c9d0e1`); остались лишь root-owned `__pycache__` в `api_v1/`
> (не удаляются без sudo, в git не попадают).

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
| Ручной бэкап media | `./backup_media.sh` | в любой момент — файлы вложений/аватаров в `db_dump/` |
| **Бэкап прода на локальную машину** | `./scripts/backup/pull_prod_backup.sh` | БД + media + `.env` в `~/Документы/pismo_backup`, см. `docs/local-backup.md` |
| **Автодамп по cron** | `./install_cron_backup.sh` (однократно) | ежедневно в 03:00 — БД **и** media, см. ниже |
| Авто-restore | `docker compose up` | только когда volume БД создан заново/пуст (после `down -v`): postgres сам выполняет `./db_dump/*.sql` из `/docker-entrypoint-initdb.d` |
| Ручной restore | `./restore_db.sh [файл.sql]` | перезаписывает данные в запущенной БД (осторожно!) |

- Актуальный дамп БД: `db_dump/microshop_latest.sql`; актуальный снимок media:
  `db_dump/media_latest.tar.gz`; архивные копии по датам — `db_dump/archive/`
  (`microshop_<дата>.sql` и `media_<дата>.tar.gz`). Папка `db_dump/` в `.gitignore`
  (в git лежат только пустые `.gitkeep`).

#### Автоматический дамп по cron (регулярное резервное копирование)

Задача ставится в **crontab пользователя** на хосте (там, где запускается `docker compose`) и ежедневно снимает дамп БД:

```bash
./install_cron_backup.sh            # ежедневно в 03:00
# при необходимости другое расписание, например каждые 6 часов:
CRON_SCHEDULE='0 */6 * * *' ./install_cron_backup.sh
```

Что происходит по расписанию (скрипт `./cron_dump_db.sh`):

- запускается `./dump_db.sh` — обновляется `db_dump/microshop_latest.sql` и создаётся архивная копия `db_dump/archive/microshop_<дата>.sql`;
- запускается `./backup_media.sh` — обновляется `db_dump/media_latest.tar.gz` (вложения/аватары из `backend/media` либо docker-тома `*_media_data`) и создаётся архив `db_dump/archive/media_<дата>.tar.gz`;
- пишется лог в `db_dump/logs/cron.log`;
- хранится только последние **30** архивных копий каждого типа (лимит задаётся переменной `ARCHIVE_KEEP`, лог — `DUMP_LOG_FILE`).

Проверка/удаление задачи:

```bash
crontab -l | grep '# microshop-db-backup'              # посмотреть задачу
crontab -l | grep -v '# microshop-db-backup' | crontab -   # удалить
```

#### Бэкап прод-сервера на локальную машину (в `~/Документы/pismo_backup`)

`scripts/backup/pull_prod_backup.sh` запускается **локально** и по ssh выкачивает с
прода дамп БД, архив `media`, продовый `.env` (права 600) и метаданные (ревизия git,
контейнеры, размеры). Копии ротируются (14/7/14), всё пишется через `.part` с проверкой
`gzip -t`, от двух одновременных запусков защищает `flock`.

```bash
./scripts/backup/install_local_cron.sh     # ежедневно в 04:15 (локальный crontab)
./scripts/backup/pull_prod_backup.sh       # или вручную
crontab -l | grep -v '# pismo-prod-backup' | crontab -   # удалить задачу
```

Проверено 10.09.2026: дамп восстановлен в отдельную БД, содержимое совпало с продом
(`users=5`, `alembic_version=e3f4a5b6c7d8`), скрипт работает и в окружении cron
(`env -i PATH=/usr/bin:/bin`, без ssh-агента). Полная инструкция, разбор структуры
папки и команды восстановления — `docs/local-backup.md`.

#### Автопроверка бэкапа (раз в неделю)

«Бэкап есть» и «бэкап восстанавливается» — разные вещи, поэтому раз в неделю
локальный cron разворачивает последний дамп в **отдельную БД на прод-сервере** и
проверяет его:

```bash
./scripts/backup/install_verify_cron.sh      # воскресенье 05:00 (маркер # pismo-backup-verify)
./scripts/backup/verify_prod_backup.sh       # или вручную
./scripts/backup/verify_prod_backup.sh --dry-run    # план без работы
./scripts/backup/verify_prod_backup.sh --no-alert   # без письма при провале
```

Что проверяется: целостность архива (`gzip -t`), отсутствие ошибок при
восстановлении (`psql -v ON_ERROR_STOP=1`), наличие ревизии alembic, непустые
данные (аккаунты) и достаточное число таблиц. Дамп льётся по ssh прямо в `psql`
(на сервере файл не остаётся), временная БД `microshop_verify` удаляется в том
числе при ошибке (`trap`). Провал → письмо (SMTP) + запись в
`~/Документы/pismo_backup/logs/verify.log`.

Критерий именно «копия восстановилась и не пустая», а не «равна текущему проду»:
прод продолжает жить (новые сообщения, миграции), поэтому сравнение с текущими
данными давало бы ложные тревоги.

#### Мониторинг прода (сайт, БД, брокер, диск, свежесть бэкапа)

`scripts/monitoring/check_prod.sh` запускается **локально** по cron и проверяет
`https://pismo.space/`, `/api/v1/health`, `/api/v1/health/ready` (это БД),
`/api/v1/auth/channels/`, доступ без токена к защищённым эндпоинтам (должен быть
401), состояние контейнеров, свободное место на диске сервера и свежесть
последнего дампа. Обнаружив проблему, скрипт **пишет письмо по SMTP**
(настройки берутся в том числе из продового `.env`, поэтому настраивать ничего не
нужно); SMS через SMS Aero — опция `ALERT_SMS=1`. Повторные письма об одной проблеме
— не чаще раза в 3 часа, при восстановлении приходит «прод снова в норме».

```bash
./scripts/monitoring/install_local_cron.sh       # каждые 15 минут (локальный crontab)
./scripts/monitoring/check_prod.sh --dry-run     # отчёт без отправки писем
./scripts/monitoring/check_prod.sh --test-alert  # проверить, что письма доходят
crontab -l | grep -v '# pismo-monitor' | crontab -   # удалить задачу
```

Лог: `~/Документы/pismo_backup/logs/monitor.log`. Подробности — `docs/monitoring.md`.

#### Деплой и смоук-тест (CI)

Пуш в `main` → GitHub Actions прогоняет backend/frontend/секреты, затем job `deploy`
по ssh на прод-сервере: `git reset --hard origin/main`, `docker compose up -d --build
--force-recreate`, прогон миграций и **проверка, что БД стоит на той же ревизии,
что и код** (`alembic current` == `alembic heads`). После деплоя отдельный job
`smoke` запускает `scripts/ci/smoke_prod.sh` — проверяет сайт, `/api/v1/health`,
`/api/v1/health/ready`, `/api/v1/auth/channels/` и что защищённый эндпоинт требует
токен. Если шаг падает — деплой считается неуспешным (приходит письмо от GitHub).

Почему это нужно: `docker compose up -d` завершается успешно и когда внутри всё
сломалось (роутер не собрался, миграция не применилась) — раньше это не замечалось.

> Все health-проверки снаружи есть **только** по пути `/api/v1/health*`: nginx
> проксирует на бэкенд лишь `/api/` и `/media/`, а `/health` отдаёт SPA-фолбэк
> (200 + HTML), из-за чего проверка по коду ответа обманывала.

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
| `JWT_SECRET_KEY_PREVIOUS` | — | предыдущий секрет для плановой ротации ключа (`docs/jwt-rotation.md`): токены подписываются текущим, проверяются текущим и предыдущим |
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
| `send_sms_otp` | `tasks/otp_tasks.py` | доставка OTP-кода (код в Telegram → SMS Aero → Gateway → лог) | эндпоинт `POST /auth/request-otp/` |
| `download_gif_message` | `tasks/media_tasks.py` | скачивание GIF (Giphy/Tenor) + создание сообщения | `POST /messages/gif/` (отвечает 202) |
| `cleanup_orphan_media` | `tasks/media_tasks.py` | очистка файлов media без ссылок в БД | **celery beat** ежедневно в 04:00 UTC |
| `send_email` | `tasks/notifications.py` | служебные письма (уведомления о безопасности), SMTP → dev-лог | `POST /auth/password/set/`, `/auth/sessions/revoke-all/`, `/auth/password/reset/confirm/`, вход с нового устройства, смена e-mail |

**Каналы доставки кода входа** завязаны на номер (Telegram-аккаунт на этом номере или сам телефон), поэтому чужой номер зарегистрировать нельзя; e-mail для подтверждения не используется намеренно — адрес не доказывает владение номером. Сначала идёт «код в Telegram» (≈2,5 ₽, доставляет инфраструктура SMS Aero — свой egress к Telegram не нужен), SMS — только если Telegram не доставил.
⚠️ **Защита баланса шлюза**: `request-otp` ограничен суточными лимитами `AUTH_OTP_DAILY_LIMIT=50` (весь сервис) и `AUTH_OTP_PER_IP_DAILY_LIMIT=20` (один IP) — при исчерпании 429 и в лог `web` пишется предупреждение. Счётчики in-memory (на процесс `web`, сбрасываются при рестарте).
⚠️ **SMS Aero без договора (ИП/ООО) отклоняет все SMS**: `status=6`, `rejectReason=«Необходимо заключить договор»`, деньги при этом не списываются (поле `cost` в ответе — справочное, а не списание). То есть без договора единственный рабочий канал — «код в Telegram», а людям без Telegram код не доходит (в UI есть подсказка с адресом поддержки). Для рекламных рассылок в кабинете модератор дополнительно требует согласия абонентов (ст. 18.1 ФЗ «О рекламе», ст. 44.1 ФЗ «О связи») и наименование организации в тексте — авторизационных кодов это не касается.

**Важные следствия для разработки:**

- **Код OTP для входа** печатается в лог ТОЛЬКО если не настроен канал доставки:
  `web` пишет «SMS-заглушка» при постановке задачи (`enqueue_sms_otp`), а `worker` —
  если канал есть в конфиге, но доставка не удалась. При рабочем SMS Aero код не
  логируется (только id сообщения шлюза).
- **GIF** создаётся асинхронно: эндпоинт отвечает `202 Accepted`, воркер скачивает файл в общий media и создаёт сообщение в БД, затем через **RabbitMQ-мост** web раздаёт `message.new` в живые WebSocket-сокеты (включая отправителя, т.к. свои сообщения фронт не добавляет локально). Если RabbitMQ недоступен — web-мост сам переподключается в фоне.
- Realtime (presence/typing/chat.read) **не** переводилось на воркер: WebSocket-соединения живут в процессе `web`, поэтому доставка в сокеты остаётся в `web` (in-process manager). Воркер лишь *публикует* события в мост.
- Ручной запуск: `docker compose exec worker poetry run celery -A core.celery_app inspect active` (диагностика). Логи: `docker compose logs -f worker beat`.

Локально без Docker (для отладки тасок) нужен поднятый RabbitMQ (напр. `docker compose up -d rabbitmq`) и `RABBITMQ_URL`; воркер запускается `cd backend && poetry run celery -A core.celery_app worker --loglevel=INFO`.

## 5. Backend — детали

### Аутентификация (важно)

Порядок шагов на экране входа (он же — бэкенд-контракт):

1. `POST /api/v1/auth/password/status/` с `{phone_number}` →
   `{registered, has_password, otp_available}`:
   - `has_password=true` → шаг «введите пароль» (`/auth/password/login/`);
   - `has_password=false` и `otp_available=true` → сначала код на номер
     (`/auth/request-otp/` → `/auth/verify-otp/`), затем `POST /auth/password/set/` —
     чтобы дальше входить по паролю и не платить за SMS каждый раз;
   - `otp_available=false` (не настроен ни один канал доставки) → сразу создание
     пароля (`/auth/password/register/`), иначе регистрация была бы невозможна.
     В этом режиме номер при регистрации НЕ подтверждается (§ ограничения).
2. `otp_available` считается true, если заданы `SMS_AERO_*` (шлюз шлёт код на
   номер) или `TELEGRAM_GATEWAY_TOKEN`; обычный Telegram-бот учитывается только
   для аккаунтов с уже привязанным чатом (`tg_chat_id`).
3. Аккаунт, созданный кодом, помечается `password_set=false` (внутри — случайный
   пароль), поэтому `/auth/password/set/` для него не требует `current_password`,
   а для аккаунта с паролем — требует (несовпадение → 400).
4. Телефон — логин аккаунта: `PATCH /jwt/users/me/` с `phone_number` → 422
   (`UserUpdateWithProfileSchema._reject_phone_number_change`), в профиле поле
   только для чтения.
5. Также работает OAuth2 form `username`/`password` (`POST /auth/token/`).

**Политика паролей и защита входа:**

- Правила пароля — `core/passwords.py` (зеркало на фронте — `utils/passwordPolicy.ts`):
  минимум **10** символов, чёрный список частых паролей, запрет пароля из данных
  аккаунта (номер, e-mail, логин), 4+ одинаковых символа подряд и простых
  последовательностей. Композиционные требования («заглавная+цифра») сознательно
  не используются — NIST SP 800-63B их не рекомендует.
- **Перебор пароля** ограничен на уровне аккаунта: `password_login_attempts`
  (`auth/login_guard.py`) считает неудачи по номеру/логину; после
  `auth_login_max_failures=5` вход блокируется на 1 мин, затем задержка удваивается
  до `auth_login_lockout_max_seconds=1800`. Лимиты «по IP» обходятся сменой адреса.
- **Смена пароля отзывает все refresh-сессии** и возвращает новую пару токенов
  (текущее устройство остаётся, остальные вылетают); есть отдельный
  `POST /auth/sessions/revoke-all/`. Повторное использование уже отозванного
  refresh-токена тоже отзывает все сессии — семейный отзыв (защита от кражи).
- Флаги `password_set` и `password_weak` отдаются в `GET /jwt/users/me/`.
  `password_weak` ставится при входе (только там пароль виден в открытом виде),
  поэтому профиль показывает предложение сменить старый слабый пароль.
**E-mail-канал (второй после номера):** включён, когда заданы `SMTP_*` (см. `.env.example`).
Пока SMTP не задан — канал выключен: профиль пишет «отправка писем на сервере выключена»,
а на экране входа нет входа по e-mail. Как включить (пароль приложения у Gmail/Яндекса
и разовая настройка продового `.env` скриптом) — `docs/email-smtp.md`;
быстрая проверка состояния: `curl -s https://pismo.space/api/v1/auth/channels/`.

- Адрес подтверждается кодом из письма (`POST /auth/email/request-verification/` →
  `.../confirm-verification/`) — только после этого он годится для входа без пароля и
  восстановления доступа; при смене адреса через профиль `email_verified` сбрасывается.
- Вход по коду из письма (`/auth/email/login/request|confirm/`) и сброс пароля
  (`/auth/password/reset/request|confirm/`). Ответ на «запрос кода» одинаковый
  независимо от того, есть ли такой адрес (защита от перебора базы), а код живёт
  `auth_otp_expire_seconds`, одноразовый, с лимитом попыток и cooldown отправки.
- Сброс пароля отзывает все refresh-сессии и сразу выдаёт токены этому устройству.
- Ошибки валидации пароля проверяются ДО расхода кода, чтобы неудачная попытка не
  сжигала код из письма.
- Коды писем хранятся в `email_codes` (хеш, попытки, срок), письма отправляет воркер
  (задача `tasks.otp_tasks.send_email_code`), при незаданном SMTP код пишется в лог.
- `GET /auth/channels/` сообщает клиенту, включён ли e-mail-канал, чтобы экран входа
  не показывал недоступные кнопки.

**Уведомления о критичных действиях (`api_v1/auth/security_notifications.py`):**
письмо уходит на **подтверждённый** e-mail аккаунта при смене пароля, сбросе пароля,
выходе на всех устройствах, смене адреса (письмо идёт на **прежний** адрес — так
владелец узнаёт о подмене) и при **входе с нового устройства**.

- Канал — только e-mail: Telegram недоступен из РФ-сетей, SMS Aero без договора
  отклоняет SMS, а у владельца нет других рабочих каналов.
- Если подтверждённого адреса нет, письмо не отправляется (чужой/ошибочный ящик не
  должен получать сведения об аккаунте) — в лог идёт запись; поэтому в профиле
  («Безопасность») и есть просьба подтвердить адрес.
- «Вход с нового устройства»: отпечаток браузера/приложения (`login_devices`,
  sha256 от User-Agent) + последний IP и время; **первый** вход аккаунта молчит
  (это регистрация), повторный вход с того же устройства — тоже.
- Суточный лимит: не более 20 писем на пользователя (защита от рассылки-спама).
- Задача `tasks.notifications.send_email`; при незаданном SMTP текст пишется в лог
  воркера (dev).

**2FA на новом устройстве + список активных входов
(`api_v1/auth/device_guard.py`, `device.py`, `refresh_sessions.py`):**

- Вход с устройства, которого у аккаунта не было, **не выдаёт токены**: сервер
  отправляет код на подтверждённый e-mail и отвечает `428` с телом
  `{detail, code_sent_to, challenge_token, expires_in}`. Клиент показывает шаг
  «Новое устройство» и зовёт `POST /auth/login/verify-device/` с challenge и кодом.
- `challenge_token` — короткоживущий JWT (отдельные `aud`/`type`, по умолчанию 10 мин),
  привязанный к подписи устройства: подтвердить вход можно только с того же браузера или
  приложения. Как access/refresh он непригоден.
- Первое устройство аккаунта (регистрация) и повторный вход с известного устройства —
  без кода. Если подтвердить нечем (нет подтверждённого e-mail или выключен SMTP),
  вход не блокируется: устройство запоминается, а владельцу уходит письмо-предупреждение
  (запирать человека вне собственного аккаунта нельзя).
- Вход по коду из письма (`/auth/email/login/confirm/`) и сброс пароля кодом
  (`/auth/password/reset/confirm/`) 2FA не требуют — владелец ящика уже доказал доступ;
  устройство при этом запоминается без лишнего письма.
- `GET /auth/sessions/` — активные входы (устройство, IP, время, «текущий» по подписи
  User-Agent); `DELETE /auth/sessions/{id}/` — завершить один вход (чужая сессия → 404).
  В профиле это блок «Безопасность» → «Активные входы», рядом «Выйти на всех устройствах».
- Данные устройства живут в `refresh_sessions` (подпись, User-Agent, IP) и переносятся
  при ротации refresh-токена, поэтому список показывает и «старые» входы.

**Журнал безопасности аккаунта (`api_v1/auth/audit.py`, таблица `security_events`):**
входы (успешные и неудачные — с привязкой к аккаунту, если номер зарегистрирован),
блокировка перебора, запросы кодов, запрос/подтверждение кода для нового устройства,
смена и сброс пароля, смена и подтверждение e-mail, отзыв сессий, удаление аккаунта.

- `GET /auth/security-log/` — история владельцу (только свои записи), профиль
  показывает блок «Безопасность» → «Последние действия»;
- хранится 180 дней (`audit.RETENTION_DAYS`), старые записи подчищает еженедельная
  задача `tasks.security_tasks.prune_security_events`;
- запись события никогда не ломает вход/смену пароля: ошибки логируются и гасятся
  (журнал важнее для разбора, а не для доступа);
- при удалении аккаунта записи остаются (`user_id` → NULL): сам факт «входили»
  полезен при разборе инцидентов.

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
| GET | `/` | корень: «Hello World» | — |
| GET | `/health` | liveness (healthcheck docker) | — |
| GET | `/api/v1/health` | то же, но по пути, который проксируется наружу | — |
| GET | `/health/ready` | readiness (проверка БД, 503 при недоступности) | — |
| GET | `/api/v1/health/ready` | то же по проксируемому пути (мониторинг, CI) | — |
| POST | `/auth/password/status/` | есть ли аккаунт/пароль у номера и доступна ли доставка кода | — |
| POST | `/auth/password/register/` | создать аккаунт/пароль → токен (без подтверждения номера) | — |
| POST | `/auth/password/login/` | вход по номеру+паролю → токен | — |
| POST | `/auth/password/set/` | задать/сменить пароль → `{detail, access_token, refresh_token}` (смена требует `current_password`, отзывает прочие сессии) | токен |
| POST | `/auth/sessions/revoke-all/` | выйти на всех устройствах (отзыв всех refresh-сессий, письмо владельцу) | токен |
| GET | `/auth/sessions/` | активные входы: устройство, IP, время, «текущий» | токен |
| DELETE | `/auth/sessions/{id}/` | завершить один вход (чужой → 404) | токен |
| POST | `/auth/login/verify-device/` | 2FA нового устройства: challenge + код из письма → токены | — |
| GET | `/auth/security-log/?limit=` | журнал безопасности аккаунта (входы, смены, отзывы) | токен |
| GET | `/auth/channels/` | какие каналы входа доступны (`otp_available`, `email_otp_available`) | — |
| POST | `/auth/email/request-verification/` | письмо с кодом на адрес (привязать к аккаунту) | токен |
| POST | `/auth/email/confirm-verification/` | подтвердить адрес кодом (`email_verified`) | токен |
| POST | `/auth/email/login/request/` | вход без пароля: код на подтверждённый e-mail | — |
| POST | `/auth/email/login/confirm/` | код из письма → токены | — |
| POST | `/auth/password/reset/request/` | код для восстановления пароля | — |
| POST | `/auth/password/reset/confirm/` | код + новый пароль → токены (прочие сессии отозваны) | — |
| POST | `/auth/token/` | вход по логину+паролю (OAuth2 form) | — |
| POST | `/auth/request-otp/` | запросить код на номер (SMS/Telegram) | — |
| POST | `/auth/verify-otp/` | проверить код → токен (пароль ещё не задан) | — |
| POST | `/jwt/auth/login`, `/jwt/auth/logout` | fastapi-users | — |
| POST | `/jwt/auth/refresh` | ротация refresh-токена → новая пара access+refresh | токен (refresh) |
| GET | `/jwt/users/me/` | мой профиль | токен |
| PATCH | `/jwt/users/me/` | обновить профиль | токен |
| GET | `/messages/search/?q=&chat_id=` | поиск по тексту/имени файла (без chat_id — по всем чатам) | токен |
| WS | `/ws/events?token=` | realtime-события (message/chat.read/presence/typing) | токен |
| WS | `/ws/calls?token=` | сигналинг WebRTC-звонков | токен |
| GET | `/chats/` | мои чаты + `unread_count` + `last_message` | токен |
| POST | `/chats/private/` | найти/создать личный чат `{user_id}` | токен |
| DELETE | `/chats/{chat_id}/?for_all=` | удалить чат: `for_all=true` — у всех, иначе только у меня (204) | токен |
| POST | `/messages/` | текст `{chat_id, text, reply_to_id?}` | токен |
| POST | `/messages/forward/` | переслать в другой чат `{message_id, chat_id, reply_to_id?}` | токен |
| PATCH | `/messages/{message_id}/` | отредактировать текст `{text}` (только автор) | токен |
| POST | `/messages/attachment/` | файл (query: chat_id, filename, caption?, reply_to_id?, mime?) | токен |
| POST | `/messages/gif/` | GIF: URL → очередь (Celery скачивает и создаёт сообщение, 202) | токен |
| GET | `/messages/{chat_id}/` | история (входящие помечаются прочитанными). Без параметров — последние **100**; `limit`/`before_id` — пагинация «вверх» | токен |
| GET | `/messages/{chat_id}/pinned/` | закреплённые | токен |
| PATCH | `/messages/{message_id}/pin/` | закрепить/открепить `{is_pinned}` | токен |
| PUT | `/messages/{message_id}/reaction/` | поставить реакцию `{emoji}` | токен |
| DELETE | `/messages/{message_id}/reaction/` | снять свою реакцию | токен |
| DELETE | `/messages/{message_id}/` | удалить (только своё) | токен |
| GET | `/users/search/?q=` | поиск по логину/телефону (исключает себя) | токен |
| GET | `/users/contacts/` | все, кроме меня (для «Контактов») | токен |
| POST | `/users/` | создать пользователя (для тестов/отладки) | — |
| PUT | `/users/me/avatar/` | загрузить аватар (raw bytes) | токен |
| GET | `/users/me/storage/` | занятое место и квота на медиа (для профиля) | токен |
| DELETE | `/users/me/avatar/` | удалить аватар | токен |
| DELETE | `/users/me/` | удалить аккаунт `{password?, confirm:"УДАЛИТЬ"}` → 204 (204/400/403) | токен |
| POST | `/moderation/reports/` | жалоба на пользователя/сообщение `{user_id, reason, comment?, chat_id?, message_id?}` (причины: `spam/abuse/fraud/violence/other`) | токен |
| GET | `/moderation/blocks/` | список заблокированных мной | токен |
| PUT | `/moderation/blocks/{user_id}/` | заблокировать (диалог скрыт, сообщения в обе стороны — 403) | токен |
| DELETE | `/moderation/blocks/{user_id}/` | снять блокировку | токен |
| GET | `/moderation/reports/?status=&reason=&limit=&offset=` | **админ**: список жалоб (`total` + `items`) | токен, `is_superuser` |
| PATCH | `/moderation/reports/{report_id}/` | **админ**: статус разбора `{status: new/in_review/resolved/rejected, note?}`; `resolved` скрывает контент, `rejected` возвращает | токен, `is_superuser` |
| GET | `/moderation/journal/?limit=&offset=` | **админ**: журнал модерации (`total`, `hidden_messages`, `items`) | токен, `is_superuser` |
| POST | `/moderation/users/{user_id}/unhide/` | **админ**: снять скрытие со всех сообщений автора | токен, `is_superuser` |

Проверка доступа к чату/сообщениям: только участник чата (иначе `403`); чат с самим собой — `400`; чужие сообщения удалять — `403`.

> Публичные «читающие» эндпоинты `users` (`GET /users/`, `GET /users/{user_id}/`,
> `GET /users/{user_id}/chats/`) и legacy `products`/`posts`/`telegram` **удалены**
> (не использовались мессенджером и открывали чужие данные).
>
> На «дорогие»/«писательские» эндпоинты действует **per-user rate limit**
> (в минуту, ключ — `user.id`): отправка/пересылка/загрузка/GIF и поиск по
> сообщениям и людям; лимиты задаются в `core/config.py` (`*_limit_per_minute`).
>
> **Модерация (требование RuStore к UGC):** жалоба, блокировка и удаление
> аккаунта есть в интерфейсе приложения («Пожаловаться»/«Заблокировать» —
> в шапке чата и в меню сообщения, «Заблокированные» — в «⋯» списка чатов,
> «Удалить аккаунт» — в профиле). Разбор жалоб — служебный экран «Жалобы»
> в меню «⋯», видимый только пользователю с `user.is_superuser = true`
> (назначение и инструкция для модератора — `docs/rustore.md`, §9.1).
> Жалобы лежат в `user_reports` (статусы `new → in_review → resolved/rejected`),
> автоблокировки по жалобе нет — решение принимает модератор вручную.

### Модель данных (основное)

- `user` — `id`, `username` (уник.), `phone_number` (уник., null), `first_name`, `last_name`, `email` (nullable), `hashed_password`, `avatar_url`, `status` (текст-статус), `last_seen` (присутствие); профиль (1:1), чаты (m2m), сообщения.
- `profile` — 1:1 к `user`: `bio`, `birth_date`, `language`, `country`, `notifications_enabled`, `privacy_mode`.
- `chats` — `id`, `name`; участники через m2m `chat_user_association`. **Личный чат = ровно 2 участника**.
- `messages` — `id`, `text`, `timestamp` (default now()), `user_id`, `chat_id`, `reply_to_id` (self FK), `is_read`, `is_pinned`, `edited_at`, `file_name/file_url/mime_type/file_size`, поля пересылки `forwarded_from_id`/`forwarded_sender_id`/`forwarded_sender_name`/`forwarded_chat_id` (снимок «от кого»). Индекс `(chat_id, timestamp)`.
- `message_reactions` — PK `(message_id, user_id)`, `emoji` (по одной реакции на пользователя).
- `otp_codes` — OTP-коды телефонов (хеш кода, попытки, срок); `refresh_sessions` — refresh-токены с отзывом/ротацией.
- `device_keys` — публичный ключ E2EE на устройство; `push_subscriptions` — Web Push-подписки; `rustore_push_tokens` — токены RuStore Push; `chat_mutes` — «без уведомлений» (PK `user_id+chat_id`); `telegram_bind_links` — коды привязки Telegram.
- `user_blocks` — блокировки 1-1 (уникальная пара `blocker_id+blocked_id`); `user_reports` — жалобы (`reporter_id`, `reported_id`, `reason`, `comment`, контекст `chat_id`/`message_id`, `status`, `note`, `created_at`, `reviewed_at`).
- Legacy-таблицы `post`/`product`/`order`/`group` — **удалены** (миграция `f6a7b8c9d0e1`); моделей нет.

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
13. `2026_09_06_1200-c9e8f7a6b5c4` — `user.status`
14. `2026_09_06_1300-d5e6f7a8b9c0` — `user.last_seen`
15. `2026_09_07_1200-c3d4e5f6a7b8` — pg_trgm + GIN-индексы (поиск users)
16. `2026_09_07_1500-a1f2e3d4b5c6` — `otp_codes`
17. `2026_09_07_1540-d4e5f6a7b8c9` — `refresh_sessions`
18. `2026_09_07_1600-b2c3d4e5f6a7` — индекс `messages (chat_id, timestamp)`
19. `2026_09_07_1620-e5f6a7b8c9d0` — `messages.edited_at`
20. `2026_09_07_1650-f6a7b8c9d0e1` — DROP legacy-таблиц (`product`/`post`/`order`/`group`)
21. `2026_09_07_1800-f0e1d2c3b4a5` — пересылка: forward-поля в `messages`
22. `2026_09_08_1000-a7b8c9d0e1f2` — Telegram-привязка (`user.tg_chat_id` + `telegram_bind_links`)
23. `2026_09_08_1800-b4c5d6e7f8a9` — `user.password_set`
24. `2026_09_08_2000-b5c6d7e8f9a0` — `push_subscriptions` (Web Push)
25. `2026_09_09_1000-c6d7e8f9a0b1` — `chat_mutes`
26. `2026_09_09_1100-e2ee01c0de5a` — E2EE (`device_keys`, `messages.encrypted`)
27. `2026_09_09_1200-c8d9e0f1a2b3` — `chats.e2ee_enabled` (обычные/зашифрованные чаты)
28. `2026_09_09_1400-d0e1f2a3b4c5` — записи о звонках в `messages` (тип/исход)
29. `2026_09_09_1500-e1f2a3b4c5d6` — `chats.is_self` (чат «Сохранённые сообщения»)
30. `2026_09_09_1600-f2a3b4c5d6e7` — аватар автора в снимке пересылки
31. `2026_09_10_1000-f3a4b5c6d7e8` — групповые чаты (роли, аватар, курсор чтения)
32. `2026_09_10_1200-a9b0c1d2e3f4` — `rustore_push_tokens`
33. `2026_09_10_1400-b0c1d2e3f4a5` — модерация: `user_blocks`, `user_reports`
34. `2026_09_10_1600-c1d2e3f4a5b6` — разбор жалоб: `user_reports.note`/`reviewed_at` + индекс — **голова**

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
- Тесты: `poetry run pytest -q` (unit-тесты идут всегда; БД/API-интеграция — только при заданном `TEST_DATABASE_URL`, см. `backend/tests/`; для HTTP-тестов нужен `httpx` из dev-зависимостей). mypy по тестам не гоняется (`main.py core api_v1`).

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

- `main.ts` — Quasar 2 (Dialog/Notify, lang ru, **Material-иконки outlined** — `@quasar/extras/material-icons-outlined`; Quasar рендерит `<q-icon>` с классом `.material-icons`, на него в `quasar.css` повешен алиас шрифта), тема/оформление через `stores/theme.ts` (`data-theme`, токены `--ms-*`; тема ставится ДО первого кадра inline-скриптом в `index.html`, чтобы не мигала), инициализация auth.
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

- `Messenger.vue` — адаптивный Telegram-подобный вид: `q-layout` + `q-drawer` (панель «Чаты/Контакты»; на мобильном — выдвижной drawer), список диалогов (пины/онлайн/«печатает…»), окно чата (пузыри вправо/влево, day-разделители, reply-цитата, закреплённые сверху, файлы/картинки, реакции, hover-действия, inline-поиск по сообщениям). Модалки: «Настройки профиля» (`UserProfile`), «Оформление» (`AppearanceSettings`), «Информация о чате» (`ChatInfo`), вход (`LoginModal`), лайтбокс изображений (`ImageLightbox`). Обновления — WS-события + fallback-polling 20 с.
- `UserProfile.vue` — редактирование профиля + аватар (клик по аватару → выбор файла, удаление фото, кнопка «Выйти»); телефон — только для чтения (логин аккаунта, класс `.readonly-field`), в запрос обновления не отправляется.
- `Login.vue` / `LoginModal.vue` — вход по номеру: шаги `phone → password | otp → create` (автофокус поля), исходя из `password/status`; `LoginModal` держит диалог открытым после подтверждения кода (`pendingPassword`), пока пользователь не задаст пароль.
- Компоненты мессенджера вынесены в `components/messenger/` (`ChatSidebar`, `ChatHeader`, `MessageThread`, `MessageRow`, `MessageComposer`, `PinnedBar`, `InlineSearchBar`, `ChatPlaceholder`, `ChatInfo`, `ForwardDialog`); медиа — в `components/media/` (лайтбокс, голос/видео/кружки, GIF-пикер); звонки — `components/calls/`. Реактивное присутствие/печать — `composables/usePeerActivity`, realtime-оркестрация — `composables/useRealtimeSync`, запись — `useRecordButton`.

### Иконки (Material, outlined)

После миграции на Quasar используются Material-иконки через `<q-icon name="…">` (напр. `call`, `videocam`, `mic`, `push_pin`, `sentiment_satisfied_alt`, `check`, `send`, `download`…). Подключён вариант **outlined** (`material-icons-outlined.css`): Quasar рендерит `<q-icon>` с классом `.material-icons`, которому в `quasar.css` задан `font-family: 'Material Icons Outlined'` — тот же набор имён, более современное начертание. Галочки прочтения — текстовые `✓✓`. Не используйте классы PrimeIcons `pi pi-*` (шрифт не подключён).

## 7. Общие правила и «грабли» (важно помнить)

- Приватный чат — это `Chat` ровно с 2 участниками в `chat_user_association`; поиск/создание — через `chats/crud.get_or_create_private_chat`.
- В модели `Message` поле `timestamp` уже было в БД (default `now()`) — оно отображается в модели, **без** отдельной миграции.
- Маска телефона обязана содержать `+7` (маска `+7 (999) 999-99-99`), иначе валидация «11 цифр, начинается с 7» не сработает.
- `ApiUser.username` обязателен (не `null`) — при сохранении профиля нельзя слать `username: null`.
- Загрузка файлов/аватара — **без** `python-multipart` (сырое тело запроса). Не добавляйте `UploadFile`/`File`, иначе понадобится эта зависимость.
- Сериализация сообщений — dict-хелперы в `messages/crud.py` (`message_to_dict`, `message_basic_to_dict`); реакции агрегируются `{emoji, count, reacted_by_me}`.
- Не регенерируйте `.mypy_cache`/`__pycache__` в репо (часть файлов `root`-овые, не удалить без sudo). Mypy — с `--cache-dir=/tmp/...`.
- Тестовая авторизация «по коду»: код попадает в лог ТОЛЬКО когда доставка не настроена (dev) — `docker compose logs -f worker` (задача Celery `tasks.otp_tasks.send_sms_otp`, строка «SMS-заглушка») или `logs -f web` (`enqueue_sms_otp` пишет код, если не задан ни один канал). При настроенном SMS Aero код в лог НЕ пишется (виден только id сообщения шлюза; код можно взять в кабинете SMS Aero → Отчёты).
- SMS Aero: базовый адрес API — `https://gate.smsaero.ru` (старый `gateway.smsaero.ru` не резолвится — проверено `getent hosts`); подпись (`sign`) в `/v2/sms/send` обязательна, бесплатная — `SMS Aero`.
- Стоимость (аккаунт от 10.09.2026, `/v2/tariffs` и страница цен): «Код в Telegram» — **1,99–2,49 ₽**, авторизац. SMS — 8,30–12,59 ₽ (МТС 8,49), сервисные SMS — 8,49–32,19 ₽, бесплатная подпись дороже всего (Билайн до 46,90 ₽). Поэтому воркер сначала отправляет код в Telegram (`/v2/telegram/send` с `text` + `sign` = автооткат на SMS), а обычное SMS — только если сам вызов упал. Для входа пароль остаётся основным способом: SMS тратится лишь один раз — при регистрации.
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

- Групповые чаты есть, но без звонков и E2EE (они только для личных 1-1).
- E2EE — без forward secrecy: один ключ на устройство, старая история с нового устройства не читается, медиа не шифруются.
- Разбор жалоб — вручную модератором (экран «Жалобы» / `GET /moderation/reports/`), плюс авто-скрытие после 3 жалоб от разных пользователей и журнал действий (`GET /moderation/journal/`).
- Realtime — WebSocket-канал + «страховочный» polling 20 с (поллинг 3 с убран).
- Коды входа доставляет SMS Aero (`SMS_AERO_EMAIL`/`SMS_AERO_API_KEY`, см. `.env.example`); без ключей код логируется в dev. Приоритет каналов — «код в Telegram» (≈2,5 ₽, автооткат на SMS), затем SMS (≈9 ₽). ВНИМАНИЕ: хостинг в РФ может не иметь доступа к `api.telegram.org`, поэтому собственные Telegram-каналы (Gateway/бот) там не заработают — но канал «код в Telegram» от SMS Aero работает, т.к. доставляет их инфраструктура. Баланс и цены: `GET /v2/balance`, `/v2/tariffs`.
- Профиль и вход — намеренно «светлые листы» (карточка целиком светлая в обеих темах, читаема в тёмной); остальной интерфейс токенизирован под свет/тьму.
- Удаление аватара/файлов не затрагивает записи истории (намеренно).
- Legacy-модули (`products`/`posts`/`telegram`) и публичные «читающие» `users`-эндпоинты **удалены** (не было ни в роутере, ни в БД).

## 9. Улучшения и безопасность (2026-09-07)

### Окружение и секреты
- Секреты вынесены из кода/композа в корневой **`.env`** (в `.gitignore`); образец — `.env.example`. `docker compose` требует `POSTGRES_PASSWORD` и `JWT_SECRET_KEY`, при отсутствии файла `.env` останавливается с понятной ошибкой.
- `backend/core/config.py`: `JWT_SECRET_KEY` читается из окружения; если не задан — в лог пишется предупреждение (используется только dev-запасной ключ).
- **Требует действий:** смените `JWT_SECRET_KEY`/пароль БД, если значения попадали в публичный git (ротация + пересоздание volume). Старый файл `.env.dev` удалён из индекса.

### Аутентификация (OTP)
- OTP-коды теперь хранятся в **БД** (`otp_codes`, хеш + счётчик попыток), а не в памяти — переживают рестарт и работают при нескольких воркерах.
- Защита от перебора: лимит неверных попыток (`AUTH_OTP_MAX_ATTEMPTS`, по умолч. 5), кулдаун повторной отправки (`AUTH_OTP_RESEND_COOLDOWN_SECONDS`, 30 с, HTTP 429 + `Retry-After`).
- Удалены отладочные эндпоинты `/auth/basic-auth*`.
- Доп. защита (2026-09-08): часовой лимит запросов кода на номер (`AUTH_OTP_REQUEST_PER_PHONE_PER_HOUR`, 10) и блокировка номера после перебора (`AUTH_OTP_VERIFY_LOCKOUT_SECONDS`, 120 с, HTTP 429).

### Загрузка файлов
- Вложения и аватары проверяются: расширение из белого списка + сигнатура (magic bytes) для изображений. HTML/SVG/JS/XML и неизвестные типы отклоняются (защита от stored-XSS через `/media/...`).
- Импорт GIF: запрещены HTTP-редиректы (защита от SSRF), проверяется host, порт/userinfo и что ответ действительно GIF.
- **Квота на медиа** (`api_v1/media_quota.py`, `MEDIA_QUOTA_BYTES`, по умолчанию 500 МБ):
  ограничивает накопление файлов у одного пользователя — размер одного файла был
  ограничен и раньше (15 МБ), а суммарный объём нет. Считаются только файлы,
  загруженные самим пользователем: пересылка переиспользует тот же файл на диске
  (`file_url` копируется), поэтому второй раз в квоту он не попадает. Аватар (один
  файл до 8 МБ) в квоту не входит.
- Превышение → `413` с цифрами («Хранилище заполнено: занято 250.0 МБ из 500.0 МБ»),
  проверка идёт **до** записи файла на диск (и в воркере для GIF). Место
  освобождается сразу после удаления сообщения, потому что квота считается по БД;
  осиротевшие файлы убирает ночная задача `cleanup_orphan_media`.
- `GET /api/v1/users/me/storage/` → `{used_bytes, quota_bytes, files, percent}` —
  профиль показывает индикатор заполненности (и предупреждает заранее при ≥90%).
  Квота `0` выключает ограничение (аварийный режим).

### Присутствие и БД
- `last_seen` больше не обновляется в `get_current_user` (не было лишних commit на каждый read-only запрос); теперь присутствие обновляется в poll-эндпоинте `GET /chats/`.
- При удалении сообщения его файл удаляется с диска (best-effort).
- `GET /messages/{chat_id}/` всегда отдаёт страницу: по умолчанию последние **100** (`DEFAULT_MESSAGE_PAGE_SIZE`); `?limit=`/`?before_id=` — пагинация «вверх». Добавлен индекс `(chat_id, timestamp)`.

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

> Осталось (по состоянию на 2026-09-08): TURN для WebRTC-звонков, Web Push/PWA-уведомления, Sentry/метрики, Redis/общий стор для rate-limit и WS при масштабировании на несколько `web`, e2e-смоук (Playwright). Real-time-канал, декомпозиция `Messenger.vue`, подгрузка старых сообщений, индикатор «печатает», refresh-токены и расширение тестов — сделано.
