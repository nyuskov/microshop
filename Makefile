# Проверки перед пушем — одной командой. Ровно то, что гоняет CI
# (.github/workflows/ci.yml, джобы backend и frontend), но без docker-образов.
#
#   make check            # бэкенд-линтеры + фронтенд (типы, линт, тесты, стили)
#   make check-backend    # isort / black / flake8 / mypy
#   make check-frontend   # vue-tsc / eslint / vitest / стилевые скрипты
#   make test-backend     # pytest на одноразовой БД в контейнере
#   make dead-css         # инструмент: кандидаты на удаление мёртвого CSS
#
# Если нужен конкретный интерпретатор:
#   PY=/путь/к/venv/bin/python make check-backend

PY ?= python3
FE ?= frontend
NODE_BIN ?= ./node_modules/.bin

# Одноразовая тестовая БД: тесты делают TRUNCATE всех таблиц, поэтому адрес
# задан здесь жёстко и указывает ТОЛЬКО на контейнер — рабочую dev-базу так не
# вычистить (грабля: тесты один раз уже стирали dev-данные).
TEST_DB_URL ?= postgresql+asyncpg://postgres:test@localhost:55432/microshop_test

.PHONY: check check-backend check-frontend test-backend dead-css invite invites invite-revoke admin

check: check-backend check-frontend

check-backend:
	cd backend && $(PY) -m isort --check-only .
	cd backend && $(PY) -m black --check .
	cd backend && $(PY) -m flake8 . --exclude=.mypy_cache,__pycache__
	cd backend && $(PY) -m mypy --cache-dir=/tmp/mypy_ci main.py core api_v1

check-frontend:
	cd $(FE) && $(NODE_BIN)/vue-tsc --noEmit -p tsconfig.app.json
	cd $(FE) && $(NODE_BIN)/eslint --no-cache src
	cd $(FE) && node scripts/check-tokens.mjs
	cd $(FE) && node scripts/check-contrast.mjs
	cd $(FE) && node scripts/check-style-duplicates.mjs
	cd $(FE) && node scripts/check-geometry.mjs
	cd $(FE) && $(NODE_BIN)/vitest run
	@# Сборка и бюджет веса: это тоже шаги CI. Без них проверка проходила, а сборка
	@# падала на «бюджет размера бандла превышен» — новый импорт незаметно
	@# прибавляет килобайты, а локально это нигде не видно. Собираем во временный
	@# каталог: `dist` в репозитории не нужен, а у разработчика он может быть занят
	@# (например, файлами от root после сборки в Docker).
	cd $(FE) && $(NODE_BIN)/vite build --outDir /tmp/pismo-fe-check --emptyOutDir >/dev/null
	cd $(FE) && node scripts/check-bundle-size.mjs --dist /tmp/pismo-fe-check

test-backend:
	@docker ps --format '{{.Names}}' | grep -qx pismo-test-db || \
		docker run -d --rm --name pismo-test-db \
			-e POSTGRES_PASSWORD=test -e POSTGRES_DB=microshop_test \
			-p 55432:5432 postgres:18-alpine >/dev/null
	@for i in $$(seq 1 30); do docker exec pismo-test-db pg_isready -U postgres -q && break; sleep 1; done
	cd backend && DATABASE_URL=$(TEST_DB_URL) TEST_DATABASE_URL=$(TEST_DB_URL) \
		$(PY) -m alembic upgrade head
	@# Локально pywebpush может быть не установлен (в CI он есть): тогда честно
	@# пропускаем только тесты push и говорим об этом, а не падаем на сборе.
	@cd backend && if $(PY) -c 'import pywebpush' 2>/dev/null; then extra=""; \
		else extra="--ignore=tests/test_push_notifications.py \
			--deselect tests/test_call_signaling.py::test_call_push_expiry"; \
			echo "!!! pywebpush не установлен — тесты push пропущены (в CI идут)"; \
		fi; \
		DATABASE_URL=$(TEST_DB_URL) TEST_DATABASE_URL=$(TEST_DB_URL) \
		$(PY) -m pytest -q $$extra
	@docker stop pismo-test-db >/dev/null 2>&1 || true

# Инструмент, а не проверка: бывают ложные срабатывания (классы собираются из
# строк), поэтому печатает кандидатов и ничего не роняет. Подробности — в шапке
# скрипта и в docs/checks.md.
dead-css:
	cd $(FE) && node scripts/check-dead-css.mjs

# ---------- Приглашения на регистрацию (закрытый доступ «по инвайтам») ----------
# Публичной регистрации нет: новый аккаунт заводится только по одноразовой
# ссылке, которую владелец передаёт лично. Раньше для этого нужно было помнить
# docker-пути и модуль скрипта — теперь это команды make.
#
#   make invite                            # ссылка на localhost:8080
#   make invite NOTE="для Пети"            # с заметкой для себя
#   make invite PHONE=+79991234567         # только для этого номера
#   make invite DAYS=7                     # срок действия
#   make invites                           # список выданных (без полных токенов)
#   make invite-revoke ID=3                # погасить ссылку
#   make admin PHONE=+79991234567          # выдать аккаунту права владельца
#
# На проде — те же команды, но с прод-сервисом и файлом compose:
#   make invite SERVICE=web-blue INVITE_BASE_URL=https://pismo.space \
#     COMPOSE="docker compose -p microshop-test -f docker-compose.prod.yaml"
# (активный слот — `cat ~/.microshop-deploy/active-web-slot`)
#
# Приглашения можно выдавать и из приложения: профиль → «Приглашения»
# (доступно аккаунту с флагом is_superuser, см. `make admin`).
COMPOSE ?= docker compose
SERVICE ?= web
DB_SERVICE ?= db
DB_USER ?= postgres
DB_NAME ?= microshop
INVITE_BASE_URL ?= http://localhost:8080

invite:
	@$(COMPOSE) exec -T $(SERVICE) poetry run python -m scripts.create_invite \
		$(if $(PHONE),--phone $(PHONE)) \
		$(if $(NOTE),--note "$(NOTE)") \
		$(if $(DAYS),--expires-days $(DAYS)) \
		--base-url $(INVITE_BASE_URL)

invites:
	@$(COMPOSE) exec -T $(DB_SERVICE) psql -U $(DB_USER) -d $(DB_NAME) -c \
		"SELECT id, left(token, 8) AS token_head, phone_number, note, created_at, expires_at, used_at, revoked_at FROM registration_invites ORDER BY id DESC LIMIT 25"

# Погашение ссылки: помечаем revoked_at (как кнопка «отозвать» в приложении).
# Полный токен не нужен — хватает id из `make invites`.
invite-revoke:
	@case "$(ID)" in ''|*[!0-9]*) echo 'Укажи числовой ID: make invite-revoke ID=3 (список — make invites)'; exit 1;; esac
	@$(COMPOSE) exec -T $(DB_SERVICE) psql -U $(DB_USER) -d $(DB_NAME) -c \
		"UPDATE registration_invites SET revoked_at = now() WHERE id = $(ID) AND used_at IS NULL AND revoked_at IS NULL"

# Права владельца нужны только для экрана «Приглашения» и разбора жалоб.
# Номер сравниваем по цифрам: в базе он может лежать как «+7 (911) 111-22-33».
admin:
	@printf '%s' '$(PHONE)' | grep -Eq '^[+0-9() -]{10,20}$$' || { echo 'Укажи номер: make admin PHONE=+79991234567'; exit 1; }
	@$(COMPOSE) exec -T $(DB_SERVICE) psql -U $(DB_USER) -d $(DB_NAME) -c \
		"UPDATE \"user\" SET is_superuser = true WHERE regexp_replace(phone_number, '[^0-9]', '', 'g') = regexp_replace('$(PHONE)', '[^0-9]', '', 'g')"
