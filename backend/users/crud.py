from fastapi import HTTPException, status
from passlib.context import CryptContext
from sqlalchemy import Result, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from core.models.profile import Profile
from core.models.user import User
from users.schemas import CreateUser


async def get_users(session: AsyncSession) -> list[User]:
    stmt = select(User).order_by(User.id)
    result: Result = await session.execute(stmt)
    users = result.scalars().all()
    return list(users)


async def get_user_by_username(
    session: AsyncSession,
    username: str,
) -> User | None:
    stmt = select(User).where(User.username == username)
    # result: Result = await session.execute(stmt)
    # user: User | None = result.scalar_one_or_none()
    user: User | None = await session.scalar(stmt)
    return user


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
                "hashed_password": user.hashed_password,
                "bio": user.profile and user.profile.bio,
                "first_name": user.profile and user.profile.first_name,
                "last_name": user.profile and user.profile.last_name,
                "posts": ", ".join([post.title for post in user.posts]),
            }
        )

    return list(users)


async def create_user(new_user: CreateUser, session: AsyncSession) -> None:
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    if new_user.password != new_user.password2:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)

    hashed_password = pwd_context.hash(new_user.password)

    user = User(username=new_user.username, hashed_password=hashed_password)
    session.add(user)

    profile = Profile(
        user=user,
        first_name=new_user.first_name,
        last_name=new_user.last_name,
        bio=new_user.bio,
    )
    session.add(profile)

    await session.commit()

    return {"message": "User was created successfully!"}
