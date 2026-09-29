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
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_superuser, request_from_admin
from api_v1.calls.manager import call_manager
from api_v1.events.manager import events_manager
from core import maintenance, metrics
from core.config import settings
from core.i18n import t
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
    #: Настоящее состояние режима, если смотреть глазами администратора.
    #:
    #: Администратору `enabled` отдаём `false`, чтобы приложение перед ним не
    #: закрывалось ТЕМ ЖЕ ответом, который получает обычный пользователь: иначе
    #: кэшированный клиент (старая PWA, ещё не обновлённое приложение Android),
    #: который о своей роли ничего не знает, показал бы заглушку администратору.
    #: Панель техработ читает именно это поле.
    actual_enabled: bool | None = None


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

    Запрос с токеном администратора получает `enabled=false` (настоящее состояние
    — в `actual_enabled`): администратор работает в приложении во время техработ,
    и заглушка не должна его закрывать даже в клиенте, который о ролях не знает.
    """
    await enforce_limit(
        scope="system:maintenance-status",
        value=client_ip(request),
        limit=STATUS_LIMIT_PER_MINUTE,
        window_seconds=60,
        detail=t("Слишком много запросов. Попробуйте позже."),
    )
    state = await maintenance.read_state(session)
    response = _to_response(state)
    if state.enabled and await request_from_admin(request):
        # Администратора заглушка не касается: пусть клиент (даже старый, который
        # про роли не знает) получит «режим выключен», а настоящее состояние —
        # в `actual_enabled`, по нему панель покажет переключатель правильно.
        response.enabled = False
        response.actual_enabled = True
    return response


@router.put(
    "/maintenance/",
    response_model=MaintenanceResponse,
    summary="Включить или выключить технические работы",
)
async def set_maintenance(
    request_data: MaintenanceUpdateRequest,
    owner: User = Depends(get_current_superuser),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> MaintenanceResponse:
    """Переключает режим (только ВЛАДЕЛЕЦ сервиса).

    Включить техработы значит остановить сервис для всех — это право владельца
    (``is_superuser``); администратору (``is_admin``) доступны модерация,
    приглашения и обход заглушки, но не рубильник.

    Включение — событие уровня безопасности: до этого API отвечал всем, а после
    отвечает только администратору, поэтому пишем в лог, кто и что переключил.
    """
    state = await maintenance.write_state(
        session,
        enabled=request_data.enabled,
        message=request_data.message,
        user_id=owner.id,
    )
    logger.warning(
        "Режим технических работ %s (владелец id=%s)",
        "ВКЛЮЧЁН" if state.enabled else "выключен",
        owner.id,
    )
    return _to_response(state)


@router.get("/metrics/")
async def prometheus_metrics(request: Request) -> Response:
    """Метрики для Prometheus (текстовый exposition-формат 0.0.4).

    Доступ закрыт токеном ``METRICS_TOKEN``: метрики рассказывают про нагрузку и
    внутреннее устройство сервиса, публично их отдавать нельзя. Пока токен не
    задан, эндпоинта как будто нет (404) — включение метрик ничего не ломает по
    умолчанию. Сравниваем через ``compare_digest``: по времени ответа нельзя
    подобрать токен посимвольно.

    Токен принимаем и заголовком ``X-Metrics-Token``, и параметром ``token`` —
    так проще и в ``curl``, и в конфиге Prometheus (``params``).

    Работать эндпоинт должен и во время техработ (см. ``MAINTENANCE_EXEMPT_PREFIXES``
    в ``main.py``): именно тогда по метрикам и видно, что происходит.
    """
    token = settings.metrics_token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=t("Не найдено")
        )
    given = (
        request.headers.get("X-Metrics-Token")
        or request.query_params.get("token")
        or ""
    )
    if not secrets.compare_digest(given, token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=t("Неверный токен метрик"),
        )

    # Гауги, которые знает только API-слой: живые сокеты и пул соединений БД.
    for kind, manager in (("events", events_manager), ("calls", call_manager)):
        users, sockets = manager.connection_stats()
        metrics.gauge("pismo_ws_users", {"kind": kind}, users)
        metrics.gauge("pismo_ws_sockets", {"kind": kind}, sockets)
    pool = db_helper.engine.pool
    # У разных движков пул разный (QueuePool, NullPool, StaticPool), а в типах
    # SQLAlchemy размер и занятость не обещаны — читаем защитно и молча
    # пропускаем, если пул их не умеет.
    checked_out = getattr(pool, "checkedout", None)
    pool_size = getattr(pool, "size", None)
    if callable(checked_out) and callable(pool_size):
        try:
            busy = int(checked_out())
            total = int(pool_size())
            metrics.gauge("pismo_db_pool_connections", {"state": "checked_out"}, busy)
            metrics.gauge(
                "pismo_db_pool_connections", {"state": "free"}, max(0, total - busy)
            )
        except (AttributeError, NotImplementedError, TypeError):
            pass

    return Response(
        content=metrics.render(),
        media_type="text/plain; version=0.0.4; charset=utf-8",
    )
