"""Альбомы: метка пачки картинок в сообщении

Revision ID: a8b9c0d1e2f3
Revises: e6f7a8b9c0d1
Create Date: 2026-09-20 12:00

Несколько картинок, отправленных одним действием, уезжают на сервер отдельными
сообщениями (тело запроса — байты одного файла, менять этот путь ради пачки не
хочется). Чтобы лента рисовала их ОДНОЙ сеткой, а не «простынёй» из картинок,
каждое сообщение пачки получает общую метку ``album_id``.

Почему метка, а не отдельная сущность альбома: у сообщений уже есть всё нужное
(автор, чат, время, реакции, удаление, пересылка), а альбом — это только способ
показа. Отдельная таблица потребовала бы своих прав, каскадов и правок во всех
выборках истории ради того же результата.

Индекс на ``album_id`` нужен двум запросам: подсчёту уже сохранённых вложений
пачки (по нему решается, первое это вложение или продолжение — и, значит, кому
уходит push) и ограничению размера альбома.

Совместимость: колонка NULL-ная, старые сообщения остаются как есть — они просто
не собираются в альбомы.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8b9c0d1e2f3"
down_revision: Union[str, None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет метку альбома и индекс по ней."""
    op.add_column(
        "messages",
        sa.Column(
            "album_id",
            sa.String(length=36),
            nullable=True,
            comment="Общая метка картинок одной отправки (альбом)",
        ),
    )
    op.create_index("ix_messages_album_id", "messages", ["album_id"])


def downgrade() -> None:
    """Убирает метку альбома."""
    op.drop_index("ix_messages_album_id", table_name="messages")
    op.drop_column("messages", "album_id")
