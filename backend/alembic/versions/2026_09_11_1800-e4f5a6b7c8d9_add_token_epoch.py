"""«Эпоха» access-токенов: мгновенный отзыв доступа

Access-токен живёт 30 минут и на сервере не хранится, поэтому «выйти на всех
устройствах» раньше убивал только refresh-сессии: украденный access продолжал
работать до истечения. Теперь у пользователя есть счётчик ``token_epoch``,
номер эпохи вшит в токен (claim ``epoch``), а при отзыве счётчик увеличивается —
все выданные ранее токены сразу перестают приниматься.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-09-11 18:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4f5a6b7c8d9"
down_revision: Union[str, Sequence[str], None] = "d3e4f5a6b7c8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Добавляет счётчик эпохи (0 для существующих аккаунтов — не разлогинивает)."""
    op.add_column(
        "user",
        sa.Column(
            "token_epoch",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("user", "token_epoch")
