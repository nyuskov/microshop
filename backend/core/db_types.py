"""Типы колонок с шифрованием «в покое» (см. core/at_rest.py).

Смысл TypeDecorator: шифрование прячется за обычной колонкой. Код, который
создаёт и читает сообщения, продолжает работать со строкой как раньше — шифрует
и расшифровывает сам SQLAlchemy. Иначе пришлось бы вручную оборачивать каждое
место чтения и записи, а забытое место означало бы либо открытый текст в БД
(данные утекли), либо шифротекст в интерфейсе (нечитаемый чат).

Ограничение: по такой колонке нельзя искать SQL-ом (LIKE/ILIKE увидят только
шифротекст) и нельзя сравнивать/сортировать по содержимому. Поиск по тексту
сообщений поэтому выполняется в приложении — см. `messages.crud.search_messages`.
"""

from __future__ import annotations

from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

from core import at_rest


class EncryptedText(TypeDecorator):
    """Текстовая колонка, которая хранится зашифрованной."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect) -> str | None:
        """Перед записью в БД — зашифровать."""
        return at_rest.encrypt_text(value)

    def process_result_value(self, value: str | None, dialect) -> str | None:
        """После чтения из БД — расшифровать (открытое отдаём как есть)."""
        return at_rest.decrypt_text(value)
