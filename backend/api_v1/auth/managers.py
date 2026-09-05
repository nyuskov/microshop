import logging
from typing import Optional

from fastapi import Request
from fastapi_users.manager import BaseUserManager, IntegerIDMixin
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

from core.models import User

logger = logging.getLogger(__name__)


# User не строго удовлетворяет UserProtocol fastapi-users из-за nullable email
class UserManager(IntegerIDMixin, BaseUserManager[User, int]):  # type: ignore[type-var]
    def __init__(
        self, user_db: SQLAlchemyUserDatabase[User, int]  # type: ignore[type-var]
    ):
        super().__init__(user_db)

    async def get(self, id: int) -> User:
        """Возвращает пользователя по id, нормализуя пустой email в None."""
        user = await super().get(id)
        if user is not None and user.email == "":
            user.email = None
        return user

    async def on_after_register(self, user: User, request: Optional[Request] = None):
        logger.info("User %s has registered.", user.id)

    async def on_after_forgot_password(
        self, user: User, token: str, request: Optional[Request] = None
    ):
        logger.info("User %s has requested password reset.", user.id)

    async def on_after_request_verify(
        self, user: User, token: str, request: Optional[Request] = None
    ):
        logger.info("Verification requested for user %s.", user.id)
