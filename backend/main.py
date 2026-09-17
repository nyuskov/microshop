import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import jwt
import uvicorn
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api_v1 import router_v1
from api_v1.auth.utils import REFRESH_TOKEN_TYPE, decode_jwt
from api_v1.events.bridge import start_bridge, stop_bridge
from api_v1.health.views import router as health_router
from api_v1.media.views import router as media_router
from api_v1.users.crud import get_user_by_id
from core import maintenance
from core.config import settings
from core.models import db_helper

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


# --- Режим технических работ -----------------------------------------------------
# Рубильник живёт в БД (см. core/maintenance.py), а здесь — заглушка: пока он
# включён, обычные запросы к API получают 503 с машиночитаемым кодом, и
# приложение показывает экран «идут технические работы».

#: Адреса, до которых заглушка НЕ доходит: проверки живости (иначе мониторинг
#: принял бы плановые работы за упавший сервис), сам рубильник (статус +
#: переключение) и эндпоинты входа — владелец должен суметь войти и выключить
#: режим, а не искать ssh.
MAINTENANCE_EXEMPT_PREFIXES = (
    f"{settings.api_v1_prefix}/health",
    f"{settings.api_v1_prefix}/system/maintenance",
    f"{settings.api_v1_prefix}/auth/",
    f"{settings.api_v1_prefix}/jwt/",
)


async def _request_from_superuser(request: Request) -> bool:
    """Запрос от администратора? (проверяем только когда режим включён)

    Зависимостью (`get_current_user`) тут не обойтись: решение нужно ДО
    маршрутизации, когда сессии из `Depends` ещё нет. Проверка намеренно
    «мягкая» — при любой осечке считаем, что это не администратор.
    """
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return False
    try:
        payload = decode_jwt(token)
    except jwt.InvalidTokenError:
        return False
    # Refresh-токен не должен открывать доступ как access (как в get_current_user).
    if payload.get("type") == REFRESH_TOKEN_TYPE:
        return False
    subject = str(payload.get("sub", ""))
    if not subject.isdigit():
        return False
    try:
        async with db_helper.session_factory() as session:
            user = await get_user_by_id(session, int(subject))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Техработы: не удалось проверить администратора: %s", exc)
        return False
    return user is not None and user.is_active and user.is_superuser


@app.middleware("http")
async def maintenance_guard(request: Request, call_next):
    """Во время техработ отвечает 503 всем, кроме администратора.

    Перехватываем только запросы к API: статику и медиа отдаёт nginx, а клиент
    всё равно показывает полноэкранную заглушку (см.
    `frontend/src/components/common/MaintenanceScreen.vue`). WebSocket сюда не
    попадает (это не HTTP-запрос) — уже открытые соединения доживают до
    переподключения, вреда в этом нет.
    """
    path = request.url.path
    if (
        request.method == "OPTIONS"  # CORS-preflight не должен получать 503
        or not path.startswith(settings.api_v1_prefix)
        or path.startswith(MAINTENANCE_EXEMPT_PREFIXES)
    ):
        return await call_next(request)

    state = await maintenance.current_state()
    if not state.enabled:
        return await call_next(request)
    if await _request_from_superuser(request):
        return await call_next(request)

    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": {
                "code": maintenance.MAINTENANCE_CODE,
                "message": state.message,
            }
        },
        # Клиенту не нужно частить: приложение и так опрашивает статус.
        headers={"Retry-After": "300"},
    )


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
