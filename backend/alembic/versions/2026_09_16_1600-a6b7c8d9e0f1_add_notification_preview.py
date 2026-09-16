"""Скрыть текст сообщения в уведомлениях (`profile.notification_preview`)

Push показывает текст нового сообщения прямо на экране блокировки — это удобно,
но переписку видит любой, кто взял телефон в руки, а уведомления оседают в
галерее. Настройка даёт выбор: показывать текст или только имя отправителя.

Default — true (как было). Меняем только вид push: сама переписка не затрагивается.

Revision ID: a6b7c8d9e0f1
Revises: f5a6b7c8d9e0
Create Date: 2026-09-16 16:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a6b7c8d9e0f1"
down_revision: Union[str, None] = "f5a6b7c8d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "profile",
        sa.Column(
            "notification_preview",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("profile", "notification_preview")
