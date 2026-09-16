import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from api_v1 import router_v1
from api_v1.events.bridge import start_bridge, stop_bridge
from api_v1.health.views import router as health_router
from api_v1.media.views import router as media_router
from core.config import settings

logger = logging.getLogger("pismo")

# Uvicorn не настраивает корневой логгер на уровень INFO, поэтому сообщения
# уровня INFO из модулей приложения (например, OTP-код для входа) не попадали
# бы в консоль. Включаем вывод INFO в stderr (нужно для dev-заглушки SMS).
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Жизненный цикл приложения.

    При старте запускаем фоновый мост realtime-событий (RabbitMQ): он нужен,
    чтобы события, созданные Celery-воркером (например, новое GIF-сообщение),
    доходили до живых WebSocket-сокетов этого процесса. Мост не блокирует старт
    и переподключается сам, если брокер ещё недоступен.
    """
    await start_bridge()
    try:
        yield
    finally:
        await stop_bridge()


app = FastAPI(
    title="Pismo",
    swagger_ui_parameters={"favicon_url": "/favicon.ico"},
    lifespan=lifespan,
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
# Те же health-проверки доступны и на корне (`/health`, `/health/ready`) — их
# используют healthcheck'и docker и локальная отладка; `/api/v1/health` нужен
# мониторингу, т.к. наружу проксируется только `/api/` (см. api_v1/health).
app.include_router(router=health_router)
# Медиа отдаём своим обработчиком, а не StaticFiles: файлы на диске лежат
# зашифрованными, и расшифровать их умеет только приложение (нужны ещё и
# Range-запросы — перемотка видео, докачка больших вложений).
app.include_router(media_router, prefix="/media")


@app.get(
    "/",
    tags=["Базовый функционал"],
    summary="Главная страница",
)
async def read_root() -> dict[str, str]:
    return {"Hello": "World"}


if __name__ == "__main__":
    uvicorn.run("main:app", reload=True)
