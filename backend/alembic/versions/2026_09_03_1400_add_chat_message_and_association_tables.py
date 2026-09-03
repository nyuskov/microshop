"""Add chat, message tables and association table, remove old tables

Revision ID: abcdef123456
Revises: 1234567890ab
Create Date: 2026-09-03 14:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql  # Импортируем для ALTER COLUMN

# revision identifiers, used by Alembic.
revision: str = "abcdef123456"
down_revision: Union[str, Sequence[str], None] = "1234567890ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Обновляем существующую таблицу users, если необходимо (например, hashed_password)
    # Предположим, что hashed_password был varchar(128), а стал varchar(255)
    # Проверим, существует ли столбец и какой у него тип, затем изменим.
    # Обычно ALTER COLUMN делается так:
    op.alter_column(
        'user', 'hashed_password', type_=sa.String(255), nullable=False
    )

    # 2. Создаем новую таблицу chats
    op.create_table(
        "chats",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chats_id"), "chats", ["id"], unique=False)

    # 3. Создаем ассоциативную таблицу для связи many-to-many между User и Chat
    op.create_table(
        "chat_user_association",
        sa.Column(
            "chat_id",
            sa.Integer(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint(
            "chat_id", "user_id"
        ),  # Первичный ключ из двух столбцов
    )
    op.create_index(
        op.f("ix_chat_user_association_chat_id"),
        "chat_user_association",
        ["chat_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_chat_user_association_user_id"),
        "chat_user_association",
        ["user_id"],
        unique=False,
    )

    # 4. Создаем новую таблицу messages
    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "timestamp",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "chat_id",
            sa.Integer(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_messages_id"), "messages", ["id"], unique=False)
    op.create_index(
        op.f("ix_messages_timestamp"), "messages", ["timestamp"], unique=False
    )

    # 5. Теперь удаляем старые таблицы *после* создания новых, с использованием CASCADE
    # Удаляем user_group (ассоциативная таблица между User и Group)
    op.execute('DROP TABLE IF EXISTS "user_group" CASCADE;')
    # Удаляем group (связана с user_group)
    op.execute('DROP TABLE IF EXISTS "group" CASCADE;')
    # Удаляем post (может быть связана с user)
    op.execute('DROP TABLE IF EXISTS "post" CASCADE;')


def downgrade() -> None:
    # Обратные действия: воссоздаем старые таблицы, удаляем новые
    # 1. Воссоздаем старые таблицы
    # Воссоздаем user_group
    op.create_table(
        "user_group",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["group.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "group_id"),
    )
    op.create_index(
        op.f("ix_user_group_user_id"), "user_group", ["user_id"], unique=False
    )
    op.create_index(
        op.f("ix_user_group_group_id"), "user_group", ["group_id"], unique=False
    )

    # Воссоздаем group
    op.create_table(
        "group",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_group_id"), "group", ["id"], unique=False)
    op.create_index(op.f("ix_group_name"), "group", ["name"], unique=True)

    # Воссоздаем post
    op.create_table(
        "post",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "author_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_post_id"), "post", ["id"], unique=False)

    # 2. Удаляем новые таблицы
    op.drop_index(op.f("ix_messages_timestamp"), table_name="messages")
    op.drop_index(op.f("ix_messages_id"), table_name="messages")
    op.drop_table("messages")

    op.drop_index(
        op.f("ix_chat_user_association_user_id"),
        table_name="chat_user_association",
    )
    op.drop_index(
        op.f("ix_chat_user_association_chat_id"),
        table_name="chat_user_association",
    )
    op.drop_table("chat_user_association")

    op.drop_index(op.f("ix_chats_id"), table_name="chats")
    op.drop_table("chats")

    # 3. Откатываем изменения в users
    op.alter_column(
        'user', 'hashed_password', type_=sa.String(128), nullable=False
    )  # Возвращаем к старому размеру, если был
