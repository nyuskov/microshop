"""Health-проверки, доступные и под `/api/v1`.

Наружу на проде (nginx) проксируются только `/api/` и `/media/`, всё остальное
отдаёт SPA-фолбэк (`try_files ... /index.html`) с кодом 200. Из-за этого запрос
к корневому `/health` через `https://pismo.space` возвращает HTML, а не JSON, и
мониторинг не может отличить «API жив» от «API упал». Поэтому те же проверки
доступны по проксируемому пути `/api/v1/health`, а корневые — сохранены для
healthcheck'ов docker и локальной отладки.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Response
from sqlalchemy import text

from core.models import db_helper

logger = logging.getLogger("pismo")

router = APIRouter(prefix="/health", tags=["Базовый функционал"])


@router.get(
    "",
    summary="Liveness-проверка",
)
async def health() -> dict[str, str]:
    """Жив ли процесс (без обращения к БД)."""
    return {"status": "ok"}


@router.get(
    "/ready",
    summary="Readiness-проверка (доступность БД)",
)
async def health_ready(response: Response) -> dict[str, str]:
    """Готов ли сервис принимать трафик (проверка соединения с БД)."""
    try:
        async with db_helper.session_factory() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "ok"}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Readiness check failed: %s", exc)
        response.status_code = 503
        return {"status": "error", "database": "unreachable"}
