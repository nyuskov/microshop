from typing import TYPE_CHECKING

from fastapi import Depends
from fastapi_users.authentication.strategy.db import (
    AccessTokenDatabase,
    DatabaseStrategy,
)

from .access_tokens import get_access_token_db
from core.config import settings

if TYPE_CHECKING:
    from core.models import AccessToken


def get_database_strategy(
    access_token_db: AccessTokenDatabase["AccessToken"] = Depends(get_access_token_db),
) -> DatabaseStrategy:
    return DatabaseStrategy(
        access_token_db,
        lifetime_seconds=settings.access_token.lifetime_seconds,
    )
