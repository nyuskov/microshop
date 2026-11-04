# Сторонние компоненты и лицензии

Проект распространяется по [AGPL-3.0-or-later](LICENSE). Ниже — компоненты и
ассеты, которые используются в репозитории или поставляются вместе с ним.

## Ассеты, лежащие в репозитории

| Что | Файлы | Лицензия |
| --- | --- | --- |
| Roboto, Roboto Mono (subset woff2) | `frontend/src/assets/fonts/roboto-*` | Apache License 2.0 (Google) |
| Material Symbols Rounded (subset woff2) | `frontend/src/assets/fonts/material-symbols-rounded-subset.woff2` | Apache License 2.0 (Google) |
| Golos Text (subset woff2) | `frontend/src/assets/fonts/golos-*` | SIL Open Font License 1.1 |
| Lucide (subset woff2) | `frontend/src/assets/fonts/lucide-subset.woff2` | ISC License |
| Данные эмодзи (Unicode) | генерируется `frontend/scripts/build-emoji-catalog.py` | Unicode License v3 |
| Наборы стикеров Pismo | генерируются `frontend/scripts/build-standard-stickers.py` | AGPL-3.0 (этот проект) |

Шрифты — это сабсеты (только используемые глифы), собранные скриптами проекта;
исходные лицензии распространяются и на сабсеты.

## Ключевые зависимости

| Компонент | Лицензия |
| --- | --- |
| Vue 3, Vue Router, Pinia, Vite, Quasar | MIT |
| Quasar Extras (Material Symbols) | Apache-2.0 / MIT |
| FastAPI, SQLAlchemy, Alembic, pydantic, uvicorn | MIT / BSD-3-Clause |
| PostgreSQL | PostgreSQL License |
| Celery, RabbitMQ | BSD-3-Clause / MPL-2.0 |
| Whisper-модели (`Xenova/whisper-*`) | MIT (OpenAI), скачиваются в `/stt/`, в репозитории не лежат |
| Pillow / pillow-heif | HPND / BSD-3-Clause |
| onnxruntime-web | MIT |

Полные списки с версиями — `backend/poetry.lock` и `frontend/pnpm-lock.yaml`.
Проверить лицензии установленных пакетов:

```bash
cd backend && poetry run pip-licenses --format=table
cd frontend && pnpm licenses list --prod
```

Если вы нашли компонент без указания лицензии — пожалуйста, сообщите
(см. [SECURITY.md](SECURITY.md) или обычный issue).
