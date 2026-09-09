"""Add group chats (is_group, avatar, roles in association table)

Добавляет поддержку групповых чатов:
  * chats.is_group — признак группового чата;
  * chats.avatar_url — аватар группы;
  * chats.description — описание группы;
  * chats.creator_id — создатель группы (FK на user, SET NULL при удалении);
  * chat_user_association.role — роль участника (creator/admin/member);
  * chat_user_association.joined_at — время вступления;
  * chat_user_association.last_read_message_id — курсор прочтения для групп.

Revision ID: f3a4b5c6d7e8
Revises: f2a3b4c5d6e7
Create Date: 2026-09-10 10:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, Sequence[str], None] = "f2a3b4c5d6e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Признаки группы + инфо группы.
    op.add_column(
        "chats",
        sa.Column(
            "is_group",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "chats",
        sa.Column("avatar_url", sa.String(length=2048), nullable=True),
    )
    op.add_column(
        "chats",
        sa.Column("description", sa.String(length=1024), nullable=True),
    )
    op.add_column(
        "chats",
        sa.Column(
            "creator_id",
            sa.Integer(),
            sa.ForeignKey("user.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Роли и курсор прочтения в ассоциативной таблице.
    op.add_column(
        "chat_user_association",
        sa.Column(
            "role",
            sa.String(length=16),
            nullable=False,
            server_default="member",
        ),
    )
    op.add_column(
        "chat_user_association",
        sa.Column(
            "joined_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column(
        "chat_user_association",
        sa.Column("last_read_message_id", sa.Integer(), nullable=True),
    )

    # Заполняем создателя для существующих приватных чатов нельзя однозначно —
    # оставляем NULL. Все существующие членства помечаются ролью "member"
    # серверным дефолтом выше.


def downgrade() -> None:
    op.drop_column("chat_user_association", "last_read_message_id")
    op.drop_column("chat_user_association", "joined_at")
    op.drop_column("chat_user_association", "role")

    op.drop_column("chats", "creator_id")
    op.drop_column("chats", "description")
    op.drop_column("chats", "avatar_url")
    op.drop_column("chats", "is_group")
