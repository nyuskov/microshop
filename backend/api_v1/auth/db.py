from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

from core.models import User
from core.models.db_helper import db_helper


async def get_user_db(session: AsyncSession = Depends(db_helper.session_dependency)):
    yield SQLAlchemyUserDatabase(session, User)
