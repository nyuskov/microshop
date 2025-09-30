from sqlalchemy import Result, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from core.models.user import User
from users.schemas import CreateUser


async def get_users(session: AsyncSession) -> list[User]:
    stmt = select(User).order_by(User.id)
    result: Result = await session.execute(stmt)
    users = result.scalars().all()
    return list(users)


# async def get_user_by_username(
#     session: AsyncSession,
#     username: str,
# ) -> User | None:
#     stmt = select(User).where(User.username == username)
#     # result: Result = await session.execute(stmt)
#     # user: User | None = result.scalar_one_or_none()
#     user: User | None = await session.scalar(stmt)
#     user_data: object = (
#         {
#             "username": user.username,
#         }
#         if user is not None
#         else {}
#     )
#     return user_data


# async def get_users_with_posts(
#     session: AsyncSession,
# ):
#     stmt = (
#         select(User)
#         .options(
#             # joinedload(User.posts),
#             selectinload(User.posts),
#         )
#         .order_by(User.id)
#     )
#     # result: Result = await session.execute(stmt)
#     # users: list[User] = result.unique().scalars()
#     users = []
#     for user in await session.scalars(stmt):
#         users.append(
#             {
#                 "username": user.username,
#                 "posts": ", ".join([post.title for post in user.posts]),
#             }
#         )
#     return list(users)


async def get_users_with_posts_and_profiles(
    session: AsyncSession,
):
    stmt = (
        select(User)
        .options(
            joinedload(User.profile),
            selectinload(User.posts),
        )
        .order_by(User.id)
    )
    users = []
    for user in await session.scalars(stmt):
        users.append(
            {
                "username": user.username,
                "bio": user.profile and user.profile.bio,
                "first_name": user.profile and user.profile.first_name,
                "last_name": user.profile and user.profile.last_name,
                "posts": ", ".join([post.title for post in user.posts]),
            }
        )

    return list(users)


def create_user(new_user: CreateUser) -> dict:
    user = new_user.model_dump()
    return {
        "success": True,
        "user": user,
    }
