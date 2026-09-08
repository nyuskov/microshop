"""CRUD для Web Push-подписок."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import PushSubscription


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
