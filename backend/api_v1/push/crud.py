"""CRUD для Web Push-подписок и push-токенов RuStore."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import PushSubscription, RuStorePushToken


async def upsert_subscription(
    session: AsyncSession,
    *,
    user_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
) -> PushSubscription:
    """Сохраняет подписку (обновляя, если endpoint уже зарегистрирован)."""
    stmt = select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    sub = (await session.execute(stmt)).scalar_one_or_none()
    if sub is None:
        sub = PushSubscription(
            user_id=user_id, endpoint=endpoint, p256dh=p256dh, auth=auth
        )
        session.add(sub)
    else:
        sub.user_id = user_id
        sub.p256dh = p256dh
        sub.auth = auth
    await session.commit()
    await session.refresh(sub)
    return sub


async def delete_subscription(session: AsyncSession, *, endpoint: str) -> None:
    """Удаляет подписку по endpoint (если она есть)."""
    await session.execute(
        delete(PushSubscription).where(PushSubscription.endpoint == endpoint)
    )
    await session.commit()


async def delete_subscription_by_id(
    session: AsyncSession, *, subscription_id: int
) -> None:
    """Удаляет подписку по id."""
    await session.execute(
        delete(PushSubscription).where(PushSubscription.id == subscription_id)
    )
    await session.commit()


async def get_subscriptions_for_users(
    session: AsyncSession, user_ids: list[int]
) -> list[PushSubscription]:
    """Возвращает все push-подписки перечисленных пользователей."""
    if not user_ids:
        return []
    stmt = select(PushSubscription).where(PushSubscription.user_id.in_(user_ids))
    result = await session.execute(stmt)
    return list(result.scalars().all())


# ------------------------------------------------------------------ RuStore Push


async def upsert_rustore_token(
    session: AsyncSession, *, user_id: int, token: str
) -> RuStorePushToken:
    """Сохраняет push-токен RuStore (обновляя владельца, если токен уже есть).

    Токен уникален: при переустановке приложения или смене аккаунта он может
    «переехать» к другому пользователю — тогда просто меняем владельца.
    """
    stmt = select(RuStorePushToken).where(RuStorePushToken.token == token)
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        row = RuStorePushToken(user_id=user_id, token=token)
        session.add(row)
    else:
        row.user_id = user_id
    await session.commit()
    await session.refresh(row)
    return row


async def delete_rustore_token(session: AsyncSession, *, token: str) -> None:
    """Удаляет push-токен RuStore (например, при выходе из аккаунта)."""
    await session.execute(
        delete(RuStorePushToken).where(RuStorePushToken.token == token)
    )
    await session.commit()


async def delete_rustore_tokens(session: AsyncSession, *, tokens: list[str]) -> None:
    """Удаляет несколько токенов (устаревшие/невалидные)."""
    if not tokens:
        return
    await session.execute(
        delete(RuStorePushToken).where(RuStorePushToken.token.in_(tokens))
    )
    await session.commit()


async def get_rustore_tokens_for_users(
    session: AsyncSession, user_ids: list[int]
) -> list[RuStorePushToken]:
    """Возвращает push-токены RuStore перечисленных пользователей."""
    if not user_ids:
        return []
    stmt = select(RuStorePushToken).where(RuStorePushToken.user_id.in_(user_ids))
    result = await session.execute(stmt)
    return list(result.scalars().all())
