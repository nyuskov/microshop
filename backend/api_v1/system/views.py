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
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import (
    get_current_superuser,
    get_optional_user,
    request_from_admin,
)
from api_v1.calls.manager import call_manager
from api_v1.events.manager import events_manager
from core import maintenance, metrics
from core.celery_app import get_task
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


# --- Отчёты о падении приложения (свой «Sentry») -----------------------------

#: Сколько символов текста ошибки принимаем: хватает на «Cannot read properties
#: of undefined (reading 'x')» вместе с контекстом.
ERROR_MESSAGE_MAX_LENGTH = 1000
#: Стек обрезаем: интересна верхушка (где упало), хвост — это фреймворк.
ERROR_STACK_MAX_LENGTH = 2000
#: Страница, на которой упало (только путь, без query).
ERROR_PAGE_MAX_LENGTH = 200
#: Сборка клиента: «commit дата» из `__BUILD_INFO__` (см. vite.config.ts).
ERROR_BUILD_MAX_LENGTH = 80
#: Лимит отчётов с одного клиента в минуту: больше приложение и не пришлёт
#: (см. MAX_SHOWS в frontend/src/utils/fatalError.ts), а эндпоинт публичный.
CLIENT_ERROR_LIMIT_PER_MINUTE = 10
#: Не чаще одного письма в это время: одно и то же падение может прийти с
#: нескольких устройств, а письмо должно остаться сигналом, а не потоком.
#: Пропущенные отчёты всё равно есть в логе и в счётчике метрик.
CLIENT_ERROR_MAIL_INTERVAL_SECONDS = 300

#: Когда последний раз ставили письмо об ошибке клиента (monotonic, на процесс).
_last_error_mail_at = 0.0


class ClientErrorRequest(BaseModel):
    """Отчёт приложения о необработанной ошибке (экран «500»)."""

    message: str = Field(min_length=1, max_length=ERROR_MESSAGE_MAX_LENGTH)
    stack: str | None = Field(default=None, max_length=ERROR_STACK_MAX_LENGTH)
    page: str = Field(default="", max_length=ERROR_PAGE_MAX_LENGTH)
    build: str = Field(default="", max_length=ERROR_BUILD_MAX_LENGTH)


def _mail_client_error(payload: ClientErrorRequest, who: str) -> None:
    """Ставит владельцу письмо с текстом ошибки (отправляет воркер).

    Письмо — единственный способ узнать текст ошибки, не заходя на сервер по ssh,
    поэтому в нём есть и сборка, и страница, и стек. Транспорт тот же, что у писем
    о безопасности (`tasks.notifications.send_email`), — SMTP настраивается один раз.
    """
    global _last_error_mail_at
    now = time.monotonic()
    if now - _last_error_mail_at < CLIENT_ERROR_MAIL_INTERVAL_SECONDS:
        return
    _last_error_mail_at = now
    body = "\n".join(
        [
            f"Приложение упало на устройстве пользователя ({who}).",
            f"Сборка: {payload.build or 'неизвестна'}",
            f"Страница: {payload.page or 'неизвестна'}",
            "",
            payload.message,
            "",
            payload.stack or "(стек не пришёл)",
        ]
    )
    try:
        get_task("tasks.notifications.send_email").delay(
            "Pismo: приложение упало у пользователя",
            settings.alert_email,
            body,
        )
    except Exception:  # очередь недоступна — отчёт и так в логе и в метрике
        logger.warning("Письмо об ошибке клиента не поставлено в очередь")


@router.post(
    "/client-error/",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Отчёт приложения о падении (свой «Sentry»)",
)
async def report_client_error(
    payload: ClientErrorRequest,
    request: Request,
    user: User | None = Depends(get_optional_user),
) -> Response:
    """Принимает отчёт о необработанной ошибке на устройстве пользователя.

    Зачем свой эндпоинт, а не Sentry: внешний сервис — это передача данных за
    границу, поэтому в проекте и метрики свои (см. `docs/rkn-notification.md`).
    Нужен ровно один факт — «что упало, в какой сборке, на какой странице»:
    текст идёт в лог (`web`, ищите «Ошибка на клиенте»), счётчик — в метрику для
    алерта, письмо — владельцу (то же, что у писем о безопасности).

    Вход не обязателен: падать может и экран входа, а токен к этому моменту
    может быть уже потерян. Если токен есть — в отчёте будет id человека.
    """
    await enforce_limit(
        scope="system:client-error",
        value=str(user.id) if user is not None else client_ip(request),
        limit=CLIENT_ERROR_LIMIT_PER_MINUTE,
        window_seconds=60,
        detail=t("Слишком много отчётов об ошибках."),
    )
    who = f"user={user.id}" if user is not None else f"ip={client_ip(request)}"
    logger.warning(
        "Ошибка на клиенте (%s, сборка %s, страница %s): %s%s",
        who,
        payload.build or "неизвестна",
        payload.page or "неизвестна",
        payload.message,
        f"\n{payload.stack}" if payload.stack else "",
    )
    metrics.count("pismo_client_errors_total", {"kind": "fatal"})
    _mail_client_error(payload, who)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
