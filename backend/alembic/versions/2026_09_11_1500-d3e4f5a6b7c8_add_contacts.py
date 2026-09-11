"""Контакты пользователя («записная книжка») + псевдонимы

Таблица ``contacts``: по строке на пару (владелец, контакт). ``custom_name`` —
как владелец называет человека; виден только владельцу.

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-09-11 15:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, Sequence[str], None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицу контактов."""
    op.create_table(
        "contacts",
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("contact_user_id", sa.Integer(), nullable=False),
        sa.Column("custom_name", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contact_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "contact_user_id"),
    )
    # Список контактов читается по владельцу (порядок задаёт клиент).
    op.create_index("ix_contacts_owner_id", "contacts", ["owner_id"])
    # Обратный поиск: «кто добавил меня» (например, для отображения имени в push).
    op.create_index("ix_contacts_contact_user_id", "contacts", ["contact_user_id"])


def downgrade() -> None:
    op.drop_index("ix_contacts_contact_user_id", table_name="contacts")
    op.drop_index("ix_contacts_owner_id", table_name="contacts")
    op.drop_table("contacts")
