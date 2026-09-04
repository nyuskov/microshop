"""Add fields to Profile model

Revision ID: fedcba654321
Revises: abcdef123456
Create Date: 2026-09-05 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "fedcba654321"
down_revision: Union[str, Sequence[str], None] = "abcdef123456"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Добавляем новые колонки в таблицу profile
    op.add_column('profile', sa.Column('birth_date', sa.String(10), nullable=True))
    op.add_column('profile', sa.Column('language', sa.String(10), nullable=True))
    op.add_column('profile', sa.Column('country', sa.String(10), nullable=True))
    op.add_column(
        'profile',
        sa.Column('notifications_enabled', sa.Boolean(), nullable=True, default=True),
    )
    op.add_column(
        'profile',
        sa.Column('privacy_mode', sa.Boolean(), nullable=True, default=False),
    )

    # Устанавливаем значения по умолчанию для новых колонок с типом Boolean
    op.execute(
        "UPDATE profile SET notifications_enabled = true WHERE notifications_enabled IS NULL"
    )
    op.execute("UPDATE profile SET privacy_mode = false WHERE privacy_mode IS NULL")


def downgrade() -> None:
    # Удаляем колонки из таблицы profile
    op.drop_column('profile', 'privacy_mode')
    op.drop_column('profile', 'notifications_enabled')
    op.drop_column('profile', 'country')
    op.drop_column('profile', 'language')
    op.drop_column('profile', 'birth_date')
