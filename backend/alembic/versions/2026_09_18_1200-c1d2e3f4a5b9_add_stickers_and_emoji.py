"""Стикеры (паки и картинки) и настройки паков эмодзи

Revision ID: c1d2e3f4a5b9
Revises: f1a2b3c4d5e6
Create Date: 2026-09-18 12:00

Две независимые вещи в одной ревизии — потому что обе про одно: дать человеку
свои эмодзи и стикеры.

* ``sticker_packs`` + ``stickers`` — собственные наборы картинок-стикеров.
  Отдельные таблицы нужны, чтобы стикер был переиспользуемым: отправили его
  сколько угодно раз, а на диске файл один.
* ``emoji_pack_choices`` + ``emoji_favorites`` — какой набор эмодзи-паков
  включён у человека и что лежит в «Моих». Каталог паков живёт в клиенте,
  сервер хранит только ключи, поэтому здесь нет ни названий, ни эмодзи.

Совместимость: только новые таблицы, существующие данные не трогаются.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b9"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицы стикеров и настроек эмодзи."""
    op.create_table(
        "sticker_packs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column(
            "title", sa.String(length=60), nullable=False, comment="Название набора"
        ),
        sa.Column(
            "position",
            sa.Integer(),
            server_default="0",
            nullable=False,
            comment="Порядок пака в панели стикеров",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_sticker_packs_owner_position",
        "sticker_packs",
        ["owner_id", "position"],
        unique=False,
    )

    op.create_table(
        "stickers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("pack_id", sa.Integer(), nullable=False),
        sa.Column(
            "file_url",
            sa.String(length=255),
            nullable=False,
            comment="Путь вида /media/<имя> (как у вложений)",
        ),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column(
            "position",
            sa.Integer(),
            server_default="0",
            nullable=False,
            comment="Порядок стикера внутри пака",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["pack_id"], ["sticker_packs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_stickers_pack_position", "stickers", ["pack_id", "position"], unique=False
    )

    op.create_table(
        "emoji_pack_choices",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "pack_key",
            sa.String(length=40),
            nullable=False,
            comment="Ключ пака из каталога клиента (frontend/src/utils/emojiPacks.ts)",
        ),
        sa.Column(
            "position",
            sa.Integer(),
            server_default="0",
            nullable=False,
            comment="Порядок вкладок в панели эмодзи",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "pack_key"),
    )

    op.create_table(
        "emoji_favorites",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "emoji",
            sa.String(length=64),
            nullable=False,
            comment="Эмодзи-последовательность (флаг/семья — до 64 символов)",
        ),
        sa.Column(
            "position",
            sa.Integer(),
            server_default="0",
            nullable=False,
            comment="Порядок в разделе «Мои»",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "emoji"),
    )


def downgrade() -> None:
    """Удаляет таблицы: стикеры и выбор паков исчезают."""
    op.drop_table("emoji_favorites")
    op.drop_table("emoji_pack_choices")
    op.drop_index("ix_stickers_pack_position", table_name="stickers")
    op.drop_table("stickers")
    op.drop_index("ix_sticker_packs_owner_position", table_name="sticker_packs")
    op.drop_table("sticker_packs")
