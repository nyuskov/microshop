"""Add pg_trgm GIN indexes for user search.

Поиск пользователей идёт по ``ILIKE '%q%'`` (username/phone_number) — обычный
btree-индекс тут не помогает. Включаем расширение pg_trgm и добавляем GIN-индексы
с операторным классом ``gin_trgm_ops``.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-09-07
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        'CREATE INDEX ix_user_username_trgm ON "user" '
        "USING gin (username gin_trgm_ops)"
    )
    op.execute(
        'CREATE INDEX ix_user_phone_number_trgm ON "user" '
        "USING gin (phone_number gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_user_username_trgm")
    op.execute("DROP INDEX IF EXISTS ix_user_phone_number_trgm")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
