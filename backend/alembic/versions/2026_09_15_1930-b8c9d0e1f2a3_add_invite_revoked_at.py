"""Отзыв персонального приглашения на регистрацию (`registration_invites.revoked_at`)

Владельцу нужен способ погасить ссылку, не дожидаясь, пока ей воспользуются
(например, ссылка ушла не тому человеку или попала в публичный чат). Раньше
единственным «гасителем» была регистрация (``used_at``) или срок годности
(``expires_at``).

Отдельное поле, а не ``expires_at = now()``: в списке приглашений важно видеть
ЧТО произошло — «истекло само» или «отозвано вручную». ``used_at`` для этого не
годится: он означает «по этой ссылке зарегистрировались».

Revision ID: b8c9d0e1f2a3
Revises: f4f71cf4525b
Create Date: 2026-09-15 19:30:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "f4f71cf4525b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "registration_invites",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("registration_invites", "revoked_at")
