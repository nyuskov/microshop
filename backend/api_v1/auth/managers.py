from typing import Optional
from fastapi import Depends, Request
from fastapi_users.manager import BaseUserManager, UUIDIDMixin, IntegerIDMixin
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from fastapi_users import exceptions
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import User
from core.models.db_helper import db_helper
from .db import get_user_db


# Define custom manager
class UserManager(IntegerIDMixin, BaseUserManager[User, int]):
    def __init__(self, user_db: SQLAlchemyUserDatabase[User, int]):
        super().__init__(user_db)

    async def get(self, id: int) -> User:
        """
        Get a user by id.

        Override to handle cases where email might be an empty string
        and convert it to None to satisfy Pydantic schema validation.
        """
        print(
            f"CustomUserManager.get called with id: {id}"
        )  # <-- Отладочный вывод
        user = await super().get(id)
        print(
            f"User fetched: {user}, email: {user.email}"
        )  # <-- Отладочный вывод
        if user and user.email == "":
            # Create a new instance or modify in place if SQLAlchemy allows
            # Modifying in place is usually safe for attributes loaded from DB
            user.email = None
            print("Email changed to None")  # <-- Отладочный вывод
        return user

    async def on_after_register(
        self, user: User, request: Optional[Request] = None
    ):
        print(f"User {user.id} has registered.")

    async def on_after_forgot_password(
        self, user: User, token: str, request: Optional[Request] = None
    ):
        print(f"User {user.id} has forgot their password. Reset token: {token}")

    async def on_after_request_verify(
        self, user: User, token: str, request: Optional[Request] = None
    ):
        print(
            f"Verification requested for user {user.id}. Verification token: {token}"
        )
