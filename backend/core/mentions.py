"""Упоминания в тексте сообщения: `@логин`.

Нужны, чтобы отличить обычное сообщение от обращения к человеку: получателя
упомянули — push-уведомление помечаем отдельно (см. ``tasks/notifications``).

Правило то же, что на клиенте (`frontend/src/utils/mentions.ts`): `@` и от 2 до
64 символов — буквы, цифры, `_`, `.`, `-`. Держать их согласованными важно:
подсветка в интерфейсе и пометка в уведомлении должны совпадать.
"""

import re

#: Упоминание: `@логин` (см. MENTION_RE во фронтенде).
MENTION_RE = re.compile(r"@[a-zA-Z0-9_.-]{2,64}")

#: Границы слова: `почта@пример.ру` упоминанием не считаем.
_WORD_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_.-@")


def mentioned_logins(text: str | None) -> set[str]:
    """Логины, упомянутые в тексте (в нижнем регистре, без символа `@`).

    Возвращает множество: один и тот же логин может встретиться несколько раз.
    """
    if not text:
        return set()
    logins: set[str] = set()
    for match in MENTION_RE.finditer(text):
        start = match.start()
        # Упоминание считаем только на границе слова: иначе `почта@пример.ру`
        # превратилось бы в упоминание пользователя «пример».
        if start > 0 and text[start - 1].lower() in _WORD_CHARS:
            continue
        logins.add(match.group(0)[1:].lower())
    return logins


def mentions_login(text: str | None, login: str | None) -> bool:
    """Упомянут ли в тексте конкретный логин (регистр не важен)."""
    if not login:
        return False
    return login.lower() in mentioned_logins(text)


__all__ = ("MENTION_RE", "mentioned_logins", "mentions_login")
