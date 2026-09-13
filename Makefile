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

.PHONY: check check-backend check-frontend test-backend dead-css

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
	cd $(FE) && $(NODE_BIN)/vitest run

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
