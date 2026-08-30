"""change hashed_password type to varchar

Revision ID: a1b2c3d4e5f6  # Обновлено до имени файла
Revises: 84d8e3f8ae3d  # ЗАМЕНЕН НА РЕАЛЬНЫЙ ID ПОСЛЕДНЕЙ СУЩЕСТВУЮЩЕЙ МИГРАЦИИ
Create Date: 2026-08-30 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"  # Обновлено до имени файла
down_revision: Union[str, None] = (
    "06563a2a8e6e"  # ЗАМЕНЕН НА РЕАЛЬНЫЙ ID ПОСЛЕДНЕЙ СУЩЕСТВУЮЩЕЙ МИГРАЦИИ
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Изменяем тип колонки hashed_password на VARCHAR(255)
    # Предполагается, что старый тип был LargeBinary или bytea
    op.alter_column(
        table_name="user",  # Имя таблицы
        column_name="hashed_password",  # Имя колонки
        type_=sa.String(length=255),  # Новый тип
        # existing_type=sa.LargeBinary(length=1024), # Раскомментируйте и укажите старый тип, если он отличается
        existing_nullable=False,  # Укажите nullable, как в вашей модели
    )


def downgrade() -> None:
    # Возврат к старому типу
    op.alter_column(
        table_name="user",
        column_name="hashed_password",
        type_=sa.LargeBinary(length=1024),  # Старый тип
        # type_=sa.VARCHAR, # Или другой, если был другой
        existing_nullable=False,  # Укажите nullable
    )
