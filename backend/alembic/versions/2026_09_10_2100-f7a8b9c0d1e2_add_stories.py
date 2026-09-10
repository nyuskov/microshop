"""Истории (статусы): публикации на 24 часа и их просмотры

Revision ID: f7a8b9c0d1e2
Revises: a3c4d5e6f7b8
Create Date: 2026-09-10 21:00

1) ``stories`` — медиа-публикация автора со сроком жизни (по умолчанию 24 часа):
   в БД ссылка на файл в общем каталоге media + подпись.
2) ``story_views`` — кто и когда смотрел: по ним считается «есть новое» в ленте,
   непросмотренность своей истории и число просмотров.
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, None] = "a3c4d5e6f7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Создаёт таблицы историй и просмотров."""
    op.create_table(
        "stories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("caption", sa.String(length=255), nullable=True),
        sa.Column("media_url", sa.String(length=255), nullable=False),
        sa.Column("media_name", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("media_size", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_stories_user_id"), "stories", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_stories_created_at"), "stories", ["created_at"], unique=False
    )
    op.create_index(
        op.f("ix_stories_expires_at"), "stories", ["expires_at"], unique=False
    )
    op.create_index(
        "ix_stories_user_created", "stories", ["user_id", "created_at"], unique=False
    )

    op.create_table(
        "story_views",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("story_id", sa.Integer(), nullable=False),
        sa.Column("viewer_id", sa.Integer(), nullable=False),
        sa.Column(
            "viewed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["story_id"], ["stories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["viewer_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "story_id", "viewer_id", name="uq_story_views_story_viewer"
        ),
    )
    op.create_index(
        op.f("ix_story_views_story_id"), "story_views", ["story_id"], unique=False
    )
    op.create_index(
        op.f("ix_story_views_viewer_id"), "story_views", ["viewer_id"], unique=False
    )


def downgrade() -> None:
    """Удаляет истории и просмотры."""
    op.drop_index(op.f("ix_story_views_viewer_id"), table_name="story_views")
    op.drop_index(op.f("ix_story_views_story_id"), table_name="story_views")
    op.drop_table("story_views")
    op.drop_index("ix_stories_user_created", table_name="stories")
    op.drop_index(op.f("ix_stories_expires_at"), table_name="stories")
    op.drop_index(op.f("ix_stories_created_at"), table_name="stories")
    op.drop_index(op.f("ix_stories_user_id"), table_name="stories")
    op.drop_table("stories")
