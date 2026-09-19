"""Предустановленные (публичные) наборы стикеров

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-09-19 19:00

У паков появляется ``is_preset`` — «публичный» набор. Его ставит суперадмин, и
любой человек может добавить набор себе целиком одним запросом
(``POST /stickers/presets/{id}/copy/``), без повторных загрузок файлов.

Зачем понадобилось: по сообщению пак не определить — отправленный стикер уходит
обычным вложением (новая картинка на сервере, а не строка из пака), поэтому
«добавить весь набор» возможно только для того, что лежит на сервере как
публичное. Предустановленные наборы приложения при этом никуда не деваются: они
остаются статикой в приложении (``frontend/public/stickers``).

Совместимость: существующие паки остаются личными (``false``), данные не трогаются.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет флаг публичного набора и индекс для его списка."""
    op.add_column(
        "sticker_packs",
        sa.Column(
            "is_preset",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_index(
        "ix_sticker_packs_preset_position",
        "sticker_packs",
        ["is_preset", "position"],
    )


def downgrade() -> None:
    """Убирает флаг публичного набора."""
    op.drop_index("ix_sticker_packs_preset_position", table_name="sticker_packs")
    op.drop_column("sticker_packs", "is_preset")
