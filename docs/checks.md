# Свои проверки: что делают и когда запускаются

Кроме обычных линтеров и тестов в проекте есть «самодельные» проверки на грабли,
которые ловились руками (мёртвый CSS, светлые пятна в тёмной теме, разъехавшийся
шрифт иконок). Этот файл — карта: что где лежит и что делать, когда проверка
красная.

## Одной командой

```bash
make check            # бэкенд-линтеры + фронтенд (типы, линт, тесты, стили)
make check-backend    # isort / black / flake8 / mypy
make check-frontend   # vue-tsc / eslint / vitest / стилевые скрипты
make test-backend     # pytest на ОДНОРАЗОВОЙ БД в контейнере (безопасно)
make dead-css         # инструмент: кандидаты на удаление мёртвого CSS
```

Это ровно то, что гоняет CI (`.github/workflows/ci.yml`), только без сборки
docker-образов. Если интерпретатор не в `PATH`: `PY=/путь/к/venv/bin/python make check`.

## В CI (красная проверка = деплоя не будет)

| Проверка | Что ловит | Файл |
| --- | --- | --- |
| `black --check`, `isort --check-only`, `flake8` | формат и стиль бэкенда | `pyproject.toml` |
| `mypy main.py core api_v1` | типы бэкенда (тесты не проверяются) | `pyproject.toml` |
| `pytest` | тесты (в CI — с настоящей PostgreSQL) | `backend/tests/` |
| `vue-tsc --noEmit -p tsconfig.app.json` | типы фронтенда | `frontend/tsconfig.app.json` |
| `eslint --no-cache src` | линт фронтенда | `frontend/eslint.config.js` |
| `check-tokens.mjs` | новые **литеральные цвета** в `<style>` компонентов | `frontend/scripts/style-tokens-baseline.json` |
| `check-contrast.mjs` | контраст токенов WCAG AA (светлая и тёмная темы) | `frontend/src/assets/appearance.css` |
| `check-style-duplicates.mjs` | правила слоя `html .messenger-shell`, которые молча перебивают компоненты | `frontend/scripts/style-duplicates-baseline.json` |
| `check-bundle-size.mjs` | бюджет gzip по `dist/assets` (после сборки) | `frontend/scripts/bundle-size-baseline.json` |
| `gitleaks` | секреты в диффе | `.github/workflows/ci.yml` |
| `smoke_prod.sh` | прод отвечает после деплоя | `scripts/ci/smoke_prod.sh` |

## Только вручную (в CI не годятся)

| Инструмент | Что делает | Почему не в CI |
| --- | --- | --- |
| `node scripts/check-docs-links.mjs` | битые локальные ссылки в README и `docs/*.md` | markdown их не валидирует; после переезда документов ссылки гниют тихо |
| `node scripts/check-dead-css.mjs` | ищет классы из `<style>`, которых нет ни в разметке, ни в скриптах | есть ложные срабатывания: класс собирается из строки (`error-screen--${tone}`), смотреть глазами |
| `frontend/scripts/build_icons.py` + `fetch_icons.py` | собирают урезанный шрифт иконок и `src/assets/icons.css` | качают исходники Lucide, нужен venv с fonttools/brotli |
| `backend/scripts/cleanup_orphan_media.py` | файлы в `media/`, на которые нет ссылок в БД (по умолчанию dry-run) | нужен доступ к прод-медиа |
| `backend/scripts/make_avatar_thumbs.py` | достраивает миниатюры 128px у старых аватаров | разовая операция на проде |

## Тесты-стражи (в общем прогоне vitest)

Часть проверок живёт тестами, потому что требуют чтения исходников:

- `quasarComponents.spec.ts` / `quasarCss.spec.ts` — все `<q-*>` и `v-*` из шаблонов
  подключены в `src/quasar.ts`, а их стили — в `src/assets/quasar-subset.sass`
  (забытый компонент = пустое место, сборка при этом зелёная);
- `icons.spec.ts` — каждое имя иконки из кода есть в `utils/icons.ts` (иначе Quasar
  нарисует имя текстом);
- `component-imports.spec.ts` — компоненты импортируются так, как ожидается;
- `fontWeights.spec.ts` — в шрифтах есть нужные начертания;
- `slideDown.spec.ts`, `globalSearch.spec.ts` — поведение раскрытия панелей и логика
  поиска (эти два появились вместе с переделкой шапки).

## Как обновлять базы

Все три «стилевые» проверки сравнивают с базовым файлом и падают только на НОВЫХ
нарушениях. Когда нарушение осознанное и его нужно зафиксировать:

```bash
cd frontend
node scripts/check-tokens.mjs --update-baseline
node scripts/check-style-duplicates.mjs --update-baseline
node scripts/check-bundle-size.mjs --update-baseline     # база снимается с собранного dist
```

Полезные флаги: `check-style-duplicates.mjs --list` (показать правила по группам),
`--prune` (удалить из `appearance.css` правила-дубликаты), `check-dead-css.mjs <путь>`
(проверить один каталог или файл).
