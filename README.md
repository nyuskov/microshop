# Microshop

## Описание

Это репозиторий для проекта Microshop, включающий в себя фронтенд на Vue.js и бэкенд на Python/FastAPI.

## Установка и настройку

### Frontend (Vue.js)

1. Перейдите в директорию `frontend`: `cd frontend`.
2. Убедитесь, что у вас установлен Node.js (версия, указанная в `engines` в [package.json](file:///home/freedom/Документы/microshop/frontend/node_modules/@babel/core/package.json)).
3. Установите зависимости: `npm install`. (Если возникает ошибка `EACCES`, см. раздел "Проблемы с правами доступа").
4. Установите `vite-plugin-eslint`: `npm install -D vite-plugin-eslint`. (Требует предварительно исправленные права на `node_modules`)
5. Запустите проект в режиме разработки: `npm run dev`.

### Backend (Python/FastAPI)

1. Перейдите в директорию `backend`: `cd backend`.
2. Убедитесь, что у вас установлен Python 3.13.
3. Установите Poetry: `pip install poetry`.
4. Установите зависимости: `poetry install`.
5. Активируйте виртуальное окружение: `poetry shell`.
6. Запустите проект: `uvicorn main:app --reload`.

## Форматирование и линтинг

### Frontend

*   Используется `Prettier` для форматирования кода. Конфигурация находится в [.prettierrc](file:///home/freedom/Документы/microshop/frontend/.prettierrc).
*   Используется `ESLint` для проверки ошибок и стиля кода. Конфигурация находится в [eslint.config.js](file:///home/freedom/Документы/microshop/frontend/eslint.config.js) (новый формат flat config).
*   Плагин `vite-plugin-eslint` интегрирован в Vite (после установки) и будет отображать ошибки ESLint в браузере во время разработки.
*   Скрипт `npm run lint` запускает ESLint и показывает найденные ошибки/предупреждения. Он также исправляет автоисправляемые ошибки.
*   Скрипт `npm run format` запускает Prettier для форматирования кода.
*   Рекомендуется использовать VSCode с расширениями, перечисленными в [.vscode/extensions.json](file:///home/freedom/Документы/microshop/frontend/.vscode/extensions.json), и настройками из [.vscode/settings.json](file:///home/freedom/Документы/microshop/frontend/.vscode/settings.json) для автоматического форматирования при сохранении.

### Backend

*   Используется `Black` для форматирования кода. Конфигурация находится в [pyproject.toml](file:///home/freedom/Документы/microshop/backend/pyproject.toml) (`[tool.black]`).
*   Используется `Flake8` для проверки стиля кода. Конфигурация находится в [.flake8](file:///home/freedom/Документы/microshop/backend/.flake8).
*   Используется `isort` для сортировки импортов. Конфигурация находится в [pyproject.toml](file:///home/freedom/Документы/microshop/backend/pyproject.toml) (`[tool.isort]`).
*   Используется `mypy` для статической проверки типов.
*   Зависимости для разработки (`black`, `flake8`, `isort`, `mypy`) указаны в [pyproject.toml](file:///home/freedom/Документы/microshop/backend/pyproject.toml) в группе `dev`.
*   Рекомендуется использовать VSCode с расширениями, перечисленными в [.vscode/extensions.json](file:///home/freedom/Документы/microshop/backend/.vscode/extensions.json), и настройками из [.vscode/settings.json](file:///home/freedom/Документы/microshop/backend/.vscode/settings.json) для автоматического форматирования при сохранении.

## Проблемы с правами доступа

Если при установке зависимостей в `frontend` возникает ошибка `EACCES`, это может быть связано с тем, что папка `node_modules` или файлы в ней были созданы с правами другого пользователя (например, root). Решением является изменение владельца этой папки на текущего пользователя:

```bash
sudo chown -R $USER:$USER /path/to/microshop/frontend/node_modules
```

Затем повторите установку зависимостей: `npm install`.

Аналогичная проблема может возникнуть с Poetry в `backend`. Если вы получаете ошибки доступа при работе с Poetry, проверьте права на директорию кэша Poetry (обычно `~/.cache/pypoetry`) и измените их при необходимости.

После исправления прав и установки `vite-plugin-eslint`, он будет отображать ошибки линтера в браузере. Без него, ошибки будут видны только при запуске `npm run lint`.