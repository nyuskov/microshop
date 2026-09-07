"""Drop legacy tables (posts/products/telegram removed)

Legacy-фичи (posts, products, telegram, группы) удалены из кода. Убираем их
таблицы из БД, если они остались от прошлых версий.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-07 16:50:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, Sequence[str], None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # CASCADE — на случай сохранившихся FK (например, order -> product).
    op.execute("DROP TABLE IF EXISTS \"order\" CASCADE")
    op.execute("DROP TABLE IF EXISTS product CASCADE")
    op.execute("DROP TABLE IF EXISTS post CASCADE")
    op.execute("DROP TABLE IF EXISTS \"group\" CASCADE")


def downgrade() -> None:
    # Удаление необратимо (таблицы legacy больше не нужны).
    pass
