"""Локализация серверных текстов (русский → английский).

Зачем: интерфейс бывает английским, а тексты ошибок, push-уведомлений, писем и
журнала безопасности приходят с сервера — без перевода человек видел бы русские
строки посреди английского интерфейса.

Как устроено (нарочно так же, как во фронтенде — `frontend/src/i18n/index.ts`):

* КЛЮЧ — сам русский текст, значение — английский перевод (`core/i18n_en.py`).
  Отдельные «ключи-идентификаторы» не нужны: текст и есть ключ, исходник читается
  как обычный код, а поиск по репозиторию находит и текст, и перевод.
* Чего нет в каталоге — остаётся русским. Это фолбэк, а не ошибка: перевести
  можно постепенно, ничего не ломая.
* Язык берём ТОЛЬКО из профиля (`Profile.language`) — как и в приложении.
  Для авторизованных запросов локаль ставит `get_current_user` (см. ContextVar
  ниже), для фоновых задач, писем и push — вызывающий код передаёт `lang`
  языком ПОЛУЧАТЕЛЯ, а не отправителя.
* Подстановки — `{name}`: у русской и английской строк они одинаковые (порядок
  слов разный, поэтому склейка из кусков запрещена).

Если язык неизвестен (запрос без авторизации, профиль пуст, локаль не из списка)
— русский: ровно то же поведение, что было до перевода.
"""

from __future__ import annotations

import contextvars
from typing import Any

from core.i18n_en import EN

DEFAULT_LOCALE = "ru"

#: Языки, которые реально есть в приложении (`LOCALES` во фронтенде).
SUPPORTED_LOCALES = ("ru", "en")

#: Язык текущего запроса/задачи. ContextVar, а не глобальная переменная: один
#: процесс обслуживает запросы разных людей одновременно, и язык одного не
#: должен «протечь» в текст для другого.
_locale: contextvars.ContextVar[str] = contextvars.ContextVar(
    "pismo_locale", default=DEFAULT_LOCALE
)

#: Задан ли язык ЯВНО (заголовком запроса или кодом). Нужно, чтобы не ходить в
#: БД за профилем там, где клиент уже прислал язык: приложение шлёт `X-Locale`
#: на каждом запросе, и лишний SELECT на ровном месте не нужен.
_explicit: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "pismo_locale_explicit", default=False
)


def normalize_locale(value: str | None) -> str:
    """Приводит значение из профиля к поддерживаемому языку.

    Пустое/неизвестное значение (`None`, `''`, `'de'`) — русский: лучше показать
    понятный русский текст, чем угадывать язык или отдавать пустоту.
    """
    if not value:
        return DEFAULT_LOCALE
    lang = value.strip().lower().replace("_", "-")
    short = lang.split("-")[0]
    return short if short in SUPPORTED_LOCALES else DEFAULT_LOCALE


def set_locale(value: str | None) -> str:
    """Запоминает язык для текущего запроса. Возвращает то, что запомнили."""
    lang = normalize_locale(value)
    _locale.set(lang)
    return lang


def set_locale_from_client(value: str | None) -> bool:
    """Ставит язык из заголовка клиента. `False` — заголовка нет/он пустой.

    Приложение присылает язык профиля (`X-Locale`), поэтому обычно в БД за ним
    ходить не нужно: см. `get_current_user`.
    """
    if not value or not value.strip():
        return False
    set_locale(value)
    _explicit.set(True)
    return True


def locale_is_explicit() -> bool:
    """Прислал ли клиент язык сам (значит, профиль читать не нужно)."""
    return _explicit.get()


def current_locale() -> str:
    """Язык текущего запроса/задачи (по умолчанию русский)."""
    return _locale.get()


async def locale_of_user(session: Any, user_id: int) -> str:
    """Язык профиля пользователя — для писем, push и SMS.

    Уведомление читает ПОЛУЧАТЕЛЬ, а действие мог совершить кто-то другой
    (или фоновая задача), поэтому язык здесь берём из БД, а не из запроса.
    """
    from sqlalchemy import select  # локально: модуль остаётся «листовым»

    from core.models import Profile

    language = await session.scalar(
        select(Profile.language).where(Profile.user_id == user_id)
    )
    return normalize_locale(language)


def t(text: str, *, lang: str | None = None, **vars: Any) -> str:
    """Русский текст → текст на языке запроса (или на языке `lang`).

    `lang` нужен там, где язык известен не «из запроса»: push, письмо, SMS —
    их получатель может быть не тем, кто инициировал действие.
    """
    locale = normalize_locale(lang) if lang is not None else _locale.get()
    template = EN.get(text, text) if locale == "en" else text
    for key, value in vars.items():
        template = template.replace("{" + key + "}", str(value))
    return template
