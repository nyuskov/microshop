"""Шифрование «в покое» для остального пользовательского текста

Тексты сообщений и файлы media закрыты (см. `core/at_rest.py`,
`core/media_crypto.py`), но в БД оставались открытыми другие места, где человек
пишет сам: черновики неотправленных сообщений, комментарии и предложенные посты
каналов, подписи к историям, личные имена контактов («Мама»), комментарии и
заметки по жалобам, заметки модерации, заметка к приглашению, «о себе» в профиле,
имя/фамилия/статус пользователя и заголовки карточек ссылок. Копии дампа хватало,
чтобы всё это прочитать.

Новая колонка шифруется типом `EncryptedText`, а шифротекст длиннее открытого
текста (base64 + nonce + тег), поэтому «короткие» varchar-колонки здесь
расширяются до `text` — иначе запись упала бы на переполнении. В PostgreSQL смена
varchar → text не переписывает таблицу (меняются только метаданные), так что
миграция мгновенная; существующие значения остаются как есть и читаются без
расшифровки (`at_rest.decrypt_text` пропускает незашифрованное).

Что остаётся открытым и почему:
* `username`, `phone_number`, `email` — идентификаторы: уникальные индексы,
  поиск в SQL, лимиты по номеру;
* `chats.name`, `chats.channel_username` — по названию идёт поиск каналов/чатов;
* `messages.file_name` — по имени файла идёт поиск в SQL;
* `link_previews.url` — ключ кэша (уникальный индекс);
* служебные коды: `reason`, `status`, `action`, `kind`, `mime_type` — не текст
  пользователя, а значения из фиксированных списков.

Revision ID: b7c8d9e0f1a2
Revises: a6b7c8d9e0f1
Create Date: 2026-09-16 18:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "a6b7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: Колонки, которым нужно больше места под шифротекст: (таблица, колонка, длина).
COLUMNS: tuple[tuple[str, str, int | None], ...] = (
    ("contacts", "custom_name", 120),
    ("stories", "caption", 255),
    ("user_reports", "comment", 1000),
    ("user_reports", "note", 1000),
    ("registration_invites", "note", 200),
    # Таблица называется `user` и в SQL требует кавычек — их ставит alembic.
    ("user", "first_name", 32),
    ("user", "last_name", 32),
    ("user", "status", 140),
    # `bio` изначально varchar без длины.
    ("profile", "bio", None),
    ("link_previews", "title", 300),
    ("link_previews", "description", 600),
    ("link_previews", "site_name", 120),
)


def upgrade() -> None:
    for table, column, length in COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.Text(),
            existing_type=sa.String(length=length),
            existing_nullable=True,
        )


def downgrade() -> None:
    # ВНИМАНИЕ: обратный переход сузит колонки. Если данные уже зашифрованы
    # (ключ `AT_REST_KEY` задан), шифротекст в них длиннее прежнего лимита, и
    # шаг упадёт на переполнении. Перед откатом верните текст в открытый вид
    # (прогоните приложение/скрипт без ключа) либо оставьте колонки типа text.
    for table, column, length in COLUMNS:
        op.alter_column(
            table,
            column,
            type_=sa.String(length=length),
            existing_type=sa.Text(),
            existing_nullable=True,
        )
