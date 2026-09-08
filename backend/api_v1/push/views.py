"""Эндпоинты управления Web Push-подписками (PWA).

Клиент получает публичный VAPID-ключ (``GET /push/public-key/``), создаёт
подписку через Push API и регистрирует её (``POST /push/subscribe/``). При
новых сообщениях воркер шлёт на endpoint push-уведомление.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import User, db_helper

from ..auth.utils import get_current_user
from . import crud
from .schemas import PushPublicKeyResponse, PushSubscribeRequest, PushUnsubscribeRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/push", tags=["Push-уведомления"])


@router.get("/public-key/", response_model=PushPublicKeyResponse)
async def get_public_key() -> PushPublicKeyResponse:
    """Отдаёт публичный VAPID-ключ (или пустой, если push выключен)."""
    public = settings.web_push_vapid_public_key or ""
    return PushPublicKeyResponse(
        public_key=public,
        enabled=bool(public and settings.web_push_vapid_private_key),
    )


@router.post("/subscribe/", status_code=status.HTTP_200_OK)
async def subscribe(
    payload: PushSubscribeRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Сохраняет подписку текущего пользователя."""
    try:
        await crud.upsert_subscription(
            session,
            user_id=user.id,
            endpoint=payload.endpoint,
            p256dh=payload.p256dh,
            auth=payload.auth,
        )
    except Exception as exc:  # noqa: BLE001 - любую ошибку БД превращаем в 400
        logger.warning("Не удалось сохранить push-подписку: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не удалось сохранить подписку.",
        ) from exc
    return {"ok": True}


@router.post("/unsubscribe/", status_code=status.HTTP_200_OK)
async def unsubscribe(
    payload: PushUnsubscribeRequest,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, bool]:
    """Удаляет подписку по endpoint (идемпотентно)."""
    await crud.delete_subscription(session, endpoint=payload.endpoint)
    return {"ok": True}
