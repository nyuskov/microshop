import logging
import time
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from api_v1 import router_v1
from core.config import settings
from core.models import db_helper

logger = logging.getLogger("microshop")

# Uvicorn не настраивает корневой логгер на уровень INFO, поэтому сообщения
# уровня INFO из модулей приложения (например, OTP-код для входа) не попадали
# бы в консоль. Включаем вывод INFO в stderr (нужно для dev-заглушки SMS).
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

app = FastAPI(
    title="Microshop",
    swagger_ui_parameters={"favicon_url": "/favicon.ico"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_request_id_and_log_slow(request: Request, call_next):
    """Проставляет X-Request-ID в ответ и логирует медленные запросы (>1 c)."""
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    if elapsed_ms > 1000:
        logger.warning(
            "Slow request: %s %s (%.0f ms) id=%s",
            request.method,
            request.url.path,
            elapsed_ms,
            request_id,
        )
    return response


# Каталог для файлов сообщений (создаётся при необходимости)
MEDIA_DIR = Path(__file__).resolve().parent / "media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

app.include_router(router=router_v1, prefix=settings.api_v1_prefix)
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.get(
    "/",
    tags=["Базовый функционал"],
    summary="Главная страница",
)
async def read_root() -> dict[str, str]:
    return {"Hello": "World"}


@app.get(
    "/health",
    tags=["Базовый функционал"],
    summary="Liveness-проверка",
)
async def health() -> dict[str, str]:
    """Жив ли процесс (без обращения к БД)."""
    return {"status": "ok"}


@app.get(
    "/health/ready",
    tags=["Базовый функционал"],
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


if __name__ == "__main__":
    uvicorn.run("main:app", reload=True)
