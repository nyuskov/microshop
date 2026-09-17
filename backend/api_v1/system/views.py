"""Служебные эндпоинты: проверка связи и режим технических работ.

Эндпоинты работают и во время самих техработ (см. ``maintenance_guard`` в
``main.py``): статус нужен приложению, чтобы понять, что показывать, а
переключатель — администратору, чтобы режим выключить (иначе это можно было бы
сделать только по ssh).

Публичный статус отдаётся без авторизации и опрашивается клиентами (при запуске,
при возвращении на вкладку и раз в 30 секунд), поэтому у него собственный
IP-лимит: 30-секундный опрос с запасом укладывается в лимит даже для нескольких
открытых вкладок.

Отдельный ``/ping/`` — самый дешёвый маяк связи: клиент проверяет по нему, есть
ли интернет, пока плашка «нет сети» висит (раз в 2 секунды). Поэтому он не
трогает базу, не требует авторизации и не расходует лимит статуса техработ.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_superuser
from core import maintenance
from core.models import User, db_helper
from core.rate_limit import client_ip, enforce_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["Служебное"])

#: Лимит публичного статуса (запросов в минуту с одного IP).
STATUS_LIMIT_PER_MINUTE = 60

#: Длина текста, который администратор оставляет пользователям.
MESSAGE_MAX_LENGTH = 300


class MaintenanceResponse(BaseModel):
    """Состояние режима технических работ."""

    enabled: bool
    #: Что показывать на экране (задаёт администратор, иначе текст по умолчанию).
    message: str
    #: Когда режим переключили в текущее состояние.
    since: datetime | None = None


class MaintenanceUpdateRequest(BaseModel):
    """Запрос администратора на включение/выключение режима."""

    enabled: bool
    message: str | None = Field(default=None, max_length=MESSAGE_MAX_LENGTH)


def _to_response(state: maintenance.MaintenanceState) -> MaintenanceResponse:
    return MaintenanceResponse(
        enabled=state.enabled, message=state.message, since=state.since
    )


class PingResponse(BaseModel):
    """Ответ маяка связи."""

    ok: bool = True
    #: Время сервера: заодно видно, что ответил именно наш бэкенд.
    server_time: datetime


@router.get(
    "/ping/",
    response_model=PingResponse,
    summary="Проверка связи (публичный маяк)",
)
async def ping() -> PingResponse:
    """Отвечает мгновенно, без базы и авторизации.

    Клиент считает связь восстановленной, как только получил любой ответ отсюда;
    ошибка сети (или таймаут) означает, что интернета по-прежнему нет.
    """
    return PingResponse(server_time=datetime.now(timezone.utc))


@router.get(
    "/maintenance/",
    response_model=MaintenanceResponse,
    summary="Режим технических работ (публичный статус)",
)
async def maintenance_status(
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> MaintenanceResponse:
    """Включён ли сейчас режим технических работ.

    Доступен без входа: приложение показывает экран техработ ещё до авторизации,
    а сам запрос работает и когда весь остальной API отвечает 503.
    """
    await enforce_limit(
        scope="system:maintenance-status",
        value=client_ip(request),
        limit=STATUS_LIMIT_PER_MINUTE,
        window_seconds=60,
        detail="Слишком много запросов. Попробуйте позже.",
    )
    return _to_response(await maintenance.read_state(session))


@router.put(
    "/maintenance/",
    response_model=MaintenanceResponse,
    summary="Включить или выключить технические работы",
)
async def set_maintenance(
    request_data: MaintenanceUpdateRequest,
    admin: User = Depends(get_current_superuser),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> MaintenanceResponse:
    """Переключает режим (только администратор сервиса).

    Включение — событие уровня безопасности: до этого API отвечал всем, а после
    отвечает только администратору, поэтому пишем в лог, кто и что переключил.
    """
    state = await maintenance.write_state(
        session,
        enabled=request_data.enabled,
        message=request_data.message,
        user_id=admin.id,
    )
    logger.warning(
        "Режим технических работ %s (администратор id=%s)",
        "ВКЛЮЧЁН" if state.enabled else "выключен",
        admin.id,
    )
    return _to_response(state)
