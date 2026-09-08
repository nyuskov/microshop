import logging
import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("microshop.config")

BASE_DIR = Path(__file__).parent.parent

# ВНИМАНИЕ (безопасность): значение ниже — ТОЛЬКО запасной dev-вариант для запуска
# без окружения. Никогда не используйте его на реальном сервере. При docker-запуске
# секрет обязательно приходит из корневого .env (переменная JWT_SECRET_KEY); если он
# не задан — в лог пишется предупреждение (см. конец файла).
_DEV_JWT_SECRET_KEY = "0b7a392c19cb1a102061ec65bb016b50cd506c2257739c6348df9e8d373bc405"


class AuthJWT(BaseSettings):
    """Настройки JWT-аутентификации.

    ``secret_key`` читается из переменной окружения ``JWT_SECRET_KEY``.
    """

    secret_key: str = Field(
        default=_DEV_JWT_SECRET_KEY,
        validation_alias="JWT_SECRET_KEY",
    )
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30


class Settings(BaseSettings):
    """Основные настройки приложения."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    api_v1_prefix: str = "/api/v1"
    db_url: str = Field(
        default="postgresql+asyncpg://postgres:Xx123456@localhost:5432/microshop",
        validation_alias="DATABASE_URL",
    )
    db_echo: bool = False

    # RabbitMQ (брокер Celery + мост realtime-событий web<->worker).
    # В docker задаются как RABBITMQ_URL=amqp://guest:***@rabbitmq:5672/.
    rabbitmq_url: str = Field(
        default="amqp://guest:guest@localhost:5672/",
        validation_alias="RABBITMQ_URL",
    )

    # Очередь/обмен realtime-событий, которые worker публикует, а web слушает,
    # чтобы раздать их в живые WebSocket-соединения (см. lifecycle/ws bridge).
    events_exchange: str = "microshop.events"
    events_queue: str = "microshop.events.web"

    # Разрешённые источники CORS и пр. оставлены как есть.

    auth_jwt: AuthJWT = AuthJWT()
    auth_otp_expire_seconds: int = 300  # 5 минут
    # Сколько неверных попыток ввода OTP допустимо до «сгорания» кода.
    auth_otp_max_attempts: int = 5
    # Минимальная пауза между повторными отправками кода на номер.
    auth_otp_resend_cooldown_seconds: int = 30
    # Максимум запросов кода на ОДИН номер в час (защита от «SMS-бомбинга»
    # номера жертвы с распределённых IP; не зависит от IP-лимитов).
    auth_otp_request_per_phone_per_hour: int = 10
    # На сколько секунд блокируется ввод кода для номера после «сгорания»
    # (превышения попыток) — чтобы нельзя было бесконечно циклить
    # «новый код → 5 попыток перебора».
    auth_otp_verify_lockout_seconds: int = 120

    # Rate limiting публичных auth-эндпоинтов (лимит запросов в минуту с одного IP).
    auth_otp_request_limit_per_minute: int = 5
    auth_otp_verify_limit_per_minute: int = 10
    auth_token_login_limit_per_minute: int = 20

    # Лимиты загрузок (в байтах), переопределяются через env.
    max_upload_size_bytes: int = 15 * 1024 * 1024
    max_avatar_size_bytes: int = 8 * 1024 * 1024
    # Как часто обновлять last_seen пользователя при активности (секунды).
    last_seen_update_seconds: int = 10

    # Разрешённые источники для CORS
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "https://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:5173",
        ],
        validation_alias="CORS_ORIGINS",
    )


settings = Settings()

if not os.getenv("JWT_SECRET_KEY"):
    logger.warning(
        "JWT_SECRET_KEY не задан в окружении: используется НЕБЕЗОПАСНЫЙ dev-секрет. "
        "Для docker-запуска задайте JWT_SECRET_KEY в корневом .env (см. .env.example)."
    )
