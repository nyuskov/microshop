import logging
import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("pismo.config")

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

    # Rate limiting «дорогих»/«писательских» АВТОРИЗОВАННЫХ эндпоинтов.
    # Ключ — пользователь (а не IP): защита от злоупотребления/случайного
    # runaway на уровне аккаунта (спам сообщениями, тяжёлый поиск, загрузки).
    message_send_limit_per_minute: int = 30
    message_forward_limit_per_minute: int = 20
    message_upload_limit_per_minute: int = 10
    message_search_limit_per_minute: int = 60
    user_search_limit_per_minute: int = 60
    # Жалобы на пользователей/контент (модерация UGC): не чаще N раз в час.
    user_report_limit_per_hour: int = 20
    avatar_upload_limit_per_minute: int = 10
    # Сколько групп можно создать в час (лимит на аккаунт).
    group_create_limit_per_hour: int = 20

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

    # --- Доставка OTP через Telegram ---
    # Основной канал — Telegram Gateway (официальный API, SMS на телефон).
    # Резервный — обычный Telegram-бот (код в личку пользователю, который
    # «привязал» свой чат). Если оба не настроены — код логируется (dev-режим).
    telegram_gateway_token: str | None = Field(
        default=None, validation_alias="TELEGRAM_GATEWAY_TOKEN"
    )
    telegram_gateway_base_url: str = Field(
        default="https://gateway.telegram.org",
        validation_alias="TELEGRAM_GATEWAY_BASE_URL",
    )
    # Токен обычного бота (@BotFather). Нужен и для доставки кода в личку, и
    # для привязки чата по /start bind_<код>.
    telegram_bot_token: str | None = Field(
        default=None, validation_alias="TELEGRAM_BOT_TOKEN"
    )
    # Username бота (для ссылки t.me/<username>?start=...). Если пусто — привязка
    # вернёт только код, без готовой ссылки.
    telegram_bot_username: str | None = Field(
        default=None, validation_alias="TELEGRAM_BOT_USERNAME"
    )
    # Как часто воркер опрашивает бота на новые /start (сек).
    telegram_poll_interval_seconds: int = 5
    # Срок жизни кода привязки Telegram (сек).
    telegram_bind_link_ttl_seconds: int = 600

    # --- Доставка OTP через SMS-шлюз SMS Aero (основной канал) ---
    # Аккаунт https://smsaero.ru: логин (email) и API-ключ. Если не заданы —
    # код пишется в лог (dev-режим). API v2: gate.smsaero.ru/v2/sms/send
    # (старый хост gateway.smsaero.ru больше не существует).
    sms_aero_base_url: str = Field(
        default="https://gate.smsaero.ru",
        validation_alias="SMS_AERO_BASE_URL",
    )
    sms_aero_email: str | None = Field(default=None, validation_alias="SMS_AERO_EMAIL")
    sms_aero_api_key: str | None = Field(
        default=None, validation_alias="SMS_AERO_API_KEY"
    )
    # Подпись отправителя — обязательный параметр запроса. Бесплатная подпись
    # «SMS Aero» работает без регистрации, но тариф на неё дороже (у некоторых
    # операторов в разы); свою подпись регистрируют в кабинете SMS Aero.
    sms_aero_sign: str = Field(default="SMS Aero", validation_alias="SMS_AERO_SIGN")

    # --- Web Push уведомления (PWA, когда приложение закрыто) ---
    # VAPID-ключи генерируются один раз (см. README). Пока они не заданы —
    # push выключен (публичный ключ пустой, отправка не выполняется).
    web_push_vapid_public_key: str | None = Field(
        default=None, validation_alias="WEB_PUSH_VAPID_PUBLIC_KEY"
    )
    web_push_vapid_private_key: str | None = Field(
        default=None, validation_alias="WEB_PUSH_VAPID_PRIVATE_KEY"
    )
    # Контакт для push-сервиса (mailto:).
    web_push_vapid_subject: str = Field(
        default="mailto:nyuskov@gmail.com",
        validation_alias="WEB_PUSH_VAPID_SUBJECT",
    )

    # --- RuStore Push (Android-приложение из RuStore) ---
    # ID проекта и сервисный токен: RuStore Консоль → Push-уведомления → Проекты.
    # Пока не заданы — канал выключен (Web Push для PWA работает как обычно).
    rustore_push_project_id: str | None = Field(
        default=None, validation_alias="RUSTORE_PUSH_PROJECT_ID"
    )
    rustore_push_service_token: str | None = Field(
        default=None, validation_alias="RUSTORE_PUSH_SERVICE_TOKEN"
    )
    # Базовый адрес Push API RuStore и таймаут запроса.
    rustore_push_api_url: str = Field(
        default="https://vkpns.rustore.ru/v1",
        validation_alias="RUSTORE_PUSH_API_URL",
    )
    rustore_push_timeout: float = 10.0
    # Время жизни push-сообщения (формат duration: "3600s").
    rustore_push_ttl: str = "3600s"


settings = Settings()

if not os.getenv("JWT_SECRET_KEY"):
    logger.warning(
        "JWT_SECRET_KEY не задан в окружении: используется НЕБЕЗОПАСНЫЙ dev-секрет. "
        "Для docker-запуска задайте JWT_SECRET_KEY в корневом .env (см. .env.example)."
    )
