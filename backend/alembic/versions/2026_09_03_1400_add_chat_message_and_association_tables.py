"""Add chat, message tables and association table, remove old tables

Revision ID: abcdef123456
Revises: 1234567890ab
Create Date: 2026-09-03 14:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "abcdef123456"
down_revision: Union[str, Sequence[str], None] = "1234567890ab"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Обновляем существующую таблицу user
    # Проверяем, существует ли колонка hashed_password
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    columns = [col['name'] for col in inspector.get_columns('user')]

    if 'hashed_password' in columns:
        op.alter_column('user', 'hashed_password', type_=sa.String(255), nullable=False)
    # NEW: Add phone_number column
    if 'phone_number' not in columns:
        op.add_column('user', sa.Column('phone_number', sa.String(20), nullable=True))
        op.create_index(
            op.f('ix_user_phone_number'), 'user', ['phone_number'], unique=True
        )
    # END NEW
    # NEW: Add first_name and last_name columns
    if 'first_name' not in columns:
        op.add_column('user', sa.Column('first_name', sa.String(32), nullable=True))
    if 'last_name' not in columns:
        op.add_column('user', sa.Column('last_name', sa.String(32), nullable=True))
    # END NEW

    # 2. Создаем таблицу chats
    op.create_table(
        "chats",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_chats_id"), "chats", ["id"], unique=False)

    # 3. Создаем ассоциативную таблицу
    op.create_table(
        "chat_user_association",
        sa.Column(
            "chat_id",
            sa.Integer(),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,  # Добавляем primary_key здесь
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            primary_key=True,  # Добавляем primary_key здесь
        ),
        # Убираем PrimaryKeyConstraint, так как уже указали выше
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

    # 4. Создаем таблицу messages
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
    # Добавляем составной индекс для частых запросов по user_id и chat_id
    op.create_index(
        "ix_messages_user_chat",
        "messages",
        ["user_id", "chat_id"],
        unique=False,
    )

    # 5. Удаляем старые таблицы (если они существуют)
    op.execute('DROP TABLE IF EXISTS "user_group" CASCADE;')
    op.execute('DROP TABLE IF EXISTS "group" CASCADE;')
    op.execute('DROP TABLE IF EXISTS "post" CASCADE;')


def downgrade() -> None:
    # 1. Воссоздаем старые таблицы
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

    op.create_table(
        "post",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_post_id"), "post", ["id"], unique=False)

    # 2. Удаляем новые таблицы (сначала индексы, потом таблицы)
    op.drop_index("ix_messages_user_chat", table_name="messages")
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

    # 3. Откатываем изменения в user
    op.alter_column('user', 'hashed_password', type_=sa.String(128), nullable=False)
    # NEW: Drop first_name and last_name columns
    op.drop_column('user', 'last_name')
    op.drop_column('user', 'first_name')
    # END NEW
    # NEW: Drop phone_number column
    op.drop_index(op.f('ix_user_phone_number'), table_name='user')
    op.drop_column('user', 'phone_number')
    # END NEW
