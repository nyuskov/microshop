import asyncio
from sqlalchemy import Result, select
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import db_helper, User, Profile, Post


async def get_user_by_username(
    session: AsyncSession,
    username: str,
) -> User | None:
    stmt = select(User).where(User.username == username)
    # result: Result = await session.execute(stmt)
    # user: User | None = result.scalar_one_or_none()
    user: User | None = await session.scalar(stmt)
    print("found user", username, user)
    return user


async def get_users_with_posts(
    session: AsyncSession,
):
    stmt = (
        select(User)
        .options(
            # joinedload(User.posts),
            selectinload(User.posts),
        )
        .order_by(User.id)
    )
    # result: Result = await session.execute(stmt)
    # users: list[User] = result.unique().scalars()
    users = await session.scalars(stmt)
    for user in users:
        print(user)
        for post in user.posts:
            print("-", post)


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
    users = await session.scalars(stmt)

    for user in users:
        print(user)
        print(user.profile)
        for post in user.posts:
            print("-", post)


async def get_profiles_with_users_and_users_with_posts(
    session: AsyncSession,
):
    stmt = (
        select(Profile)
        .options(
            joinedload(Profile.user).selectinload(User.posts),
        )
        .order_by(Profile.id)
    )
    profiles = await session.scalars(stmt)

    for profile in profiles:
        print(profile)
        print(profile.user)
        for post in profile.user.posts:
            print("-", post)


async def get_posts_with_authors(
    session: AsyncSession,
):
    stmt = select(Post).options(joinedload(Post.user)).order_by(Post.id)
    posts = await session.scalars(stmt)
    for post in posts:
        print("post", post)
        print("author", post.user)


async def show_users_with_profiles(
    session: AsyncSession,
):
    stmt = select(User).options(joinedload(User.profile)).order_by(User.id)
    # result: Result = await session.execute(stmt)
    # users: list[User] = result.scalars()
    users = await session.scalars(stmt)
    for user in users:
        print(user)
        print(user.profile.first_name)


async def create_user(session: AsyncSession, username: str) -> None:
    user = User(username=username)
    session.add(user)
    print("user", user)
    await session.commit()


async def create_posts(
    session: AsyncSession,
    user_id: int,
    *posts_titles: str,
) -> list[Post]:
    posts = [Post(title=title, user_id=user_id) for title in posts_titles]
    session.add_all(posts)
    await session.commit()
    print(posts)
    return posts


async def create_user_profile(
    session: AsyncSession,
    user_id: int,
    first_name: str | None = None,
    last_name: str | None = None,
) -> Profile:
    profile = Profile(
        user_id=user_id,
        first_name=first_name,
        last_name=last_name,
    )
    session.add(profile)
    await session.commit()
    return profile


async def main():
    async with db_helper.session_factory() as session:
        # await create_user(session=session, username="bob")
        # await create_user(session=session, username="john")
        # await create_user(session=session, username="sam")
        # user_sam = await get_user_by_username(session=session, username="sam")
        # user_john = await get_user_by_username(session=session, username="john")

        # await create_user_profile(
        #     session=session,
        #     user_id=user_john.id,
        #     first_name="John",
        #     last_name="Doe"
        # )
        # await create_user_profile(
        #     session=session,
        #     user_id=user_sam.id,
        #     first_name="Sam",
        #     last_name="Fisher"
        # )
        # await show_users_with_profiles(session=session)
        # await create_posts(
        #     session,
        #     user_john.id,
        #     "SQLA 2.0",
        #     "SQLA Joins",
        # )
        # await create_posts(
        #     session,
        #     user_sam.id,
        #     "FastAPI Intro",
        #     "FastAPI Advanced",
        #     "FastAPI More",
        # )
        # await get_users_with_posts(session=session)
        # await get_posts_with_authors(session=session)
        # await get_users_with_posts_and_profiles(session=session)
        await get_profiles_with_users_and_users_with_posts(session=session)


if __name__ == "__main__":
    asyncio.run(main())
