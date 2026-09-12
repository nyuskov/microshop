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

    ``secret_key_previous`` (``JWT_SECRET_KEY_PREVIOUS``) — поддержка ротации:
    токены подписываются ТОЛЬКО текущим ключом, а проверяются текущим и предыдущим.
    Без этого смена ключа мгновенно разлогинила бы всех (refresh-токены живут
    30 дней). Процедура — docs/jwt-rotation.md.
    """

    secret_key: str = Field(
        default=_DEV_JWT_SECRET_KEY,
        validation_alias="JWT_SECRET_KEY",
    )
    secret_key_previous: str | None = Field(
        default=None,
        validation_alias="JWT_SECRET_KEY_PREVIOUS",
    )
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30

    def accepted_secrets(self) -> list[str]:
        """Секреты, которыми можно ПРОВЕРЯТЬ токены (текущий, затем предыдущий)."""
        secrets = [self.secret_key]
        previous = (self.secret_key_previous or "").strip()
        if previous and previous != self.secret_key:
            secrets.append(previous)
        return secrets


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
    # Защита входа по паролю от перебора: после N неудач по одному и тому же
    # идентификатору (номер/логин) вход временно блокируется, задержка растёт
    # вдвое с каждой следующей неудачей и упирается в max.
    auth_login_max_failures: int = 5
    auth_login_lockout_seconds: int = 60
    auth_login_lockout_max_seconds: int = 1800

    # --- Отправка кодов на e-mail (подтверждение адреса, вход, сброс пароля) ---
    # Если SMTP не задан — канал выключен: код уходит в лог воркера (dev), а
    # фронт не предлагает вход/восстановление по почте.
    smtp_host: str | None = Field(default=None, validation_alias="SMTP_HOST")
    smtp_port: int = Field(default=587, validation_alias="SMTP_PORT")
    smtp_user: str | None = Field(default=None, validation_alias="SMTP_USER")
    smtp_password: str | None = Field(default=None, validation_alias="SMTP_PASSWORD")
    # Адрес отправителя (From) — обязателен вместе с хостом.
    smtp_from: str | None = Field(default=None, validation_alias="SMTP_FROM")
    smtp_from_name: str = Field(default="Pismo", validation_alias="SMTP_FROM_NAME")
    # STARTTLS для порта 587 (обычно) или неявный TLS для 465 (тогда smtp_ssl).
    smtp_starttls: bool = Field(default=True, validation_alias="SMTP_STARTTLS")
    smtp_ssl: bool = Field(default=False, validation_alias="SMTP_SSL")
    # Лимиты канала: код стоит денег/репутации, а эндпоинты публичные.
    auth_email_resend_cooldown_seconds: int = 60
    auth_email_per_address_per_hour: int = 5
    auth_email_daily_limit: int = 100
    auth_email_verify_max_attempts: int = 5
    # 2FA на новом устройстве: сколько живёт «challenge» (подтверждение входа).
    # Больше — человек успеет сходить в почту, меньше — окно для перебора кода.
    auth_device_challenge_expire_seconds: int = 600
    # Лимит попыток подтверждения входа с нового устройства (по IP, в минуту).
    auth_device_verify_limit_per_minute: int = 10

    # --- TURN (ретрансляция медиа WebRTC) ---
    # Адреса TURN берём из env, например:
    # `turn:<ip>:3478?transport=udp,turn:<ip>:3478?transport=tcp`
    # (можно добавить `turns:...:5349?transport=tcp`, когда откроется порт).
    turn_urls: str = Field(default="", validation_alias="TURN_URLS")
    # Общий секрет TURN REST API: coturn (--use-auth-secret) и мы считаем по нему
    # HMAC-SHA1. В клиентский бандл он не попадает — статического пароля больше нет.
    turn_secret: str | None = Field(default=None, validation_alias="TURN_SECRET")
    turn_realm: str = Field(default="pismo.space", validation_alias="TURN_REALM")
    # Срок жизни выданных кредов. Час — с запасом на долгий звонок; после
    # истечения coturn перестанет пускать новые allocation, но идущий звонок
    # уже отпущен (allocation переиспользуется до завершения).
    turn_ttl_seconds: int = Field(default=3600, validation_alias="TURN_TTL_SECONDS")

    # --- Модерация UGC ---
    # Сколько жалоб от РАЗНЫХ пользователей скрывает сообщение автоматически до
    # разбора модератором (0 — авто-скрытие выключено, решает только человек).
    moderation_auto_hide_reports: int = 3

    # --- Квоты на медиа ---
    # Сколько файлов (загруженных самим пользователем) можно держать на сервере.
    # Ограничивает накопление: диск прод-сервера конечен, а пересланные сообщения
    # переиспользуют файл и в квоту не второй раз не считаются. 0 или меньше —
    # квота выключена.
    media_quota_bytes: int = 500 * 1024 * 1024
    # Порог предупреждения в профиле (проценты): «хранилище почти заполнено».
    media_quota_warn_percent: int = 90
    # Суточные лимиты на отправку кодов — защита баланса шлюза: каждый код это
    # деньги, а эндпоинт публичный. Глобальный лимит закрывает весь сервис
    # (лучше потерять регистрации, чем остаток на счету), лимит на IP не даёт
    # одному источнику перебирать номера. Счётчики in-memory → на процесс web,
    # при рестарте сбрасываются.
    auth_otp_daily_limit: int = 50
    auth_otp_per_ip_daily_limit: int = 20
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
    # Контакты (записная книжка): добавление, переименование, удаление.
    contact_write_limit_per_minute: int = 30
    # Тревожная кнопка «это были не я»: сколько минут живёт подписанный токен
    # в push-уведомлении (потом решение принимается уже в приложении).
    auth_panic_token_expire_minutes: int = 60
    # Жалобы на пользователей/контент (модерация UGC): не чаще N раз в час.
    user_report_limit_per_hour: int = 20
    avatar_upload_limit_per_minute: int = 10
    # Сколько групп можно создать в час (лимит на аккаунт).
    group_create_limit_per_hour: int = 20

    # Лимиты загрузок (в байтах), переопределяются через env.
    max_upload_size_bytes: int = 15 * 1024 * 1024

    # Истории (статусы): сколько часов живёт публикация до исчезновения.
    story_ttl_hours: int = 24
    # Реакции и просмотры историй: каждый тап — запись в БД, поэтому лимит на
    # аккаунт (без него реакции можно молотить скриптом). Просмотр — листание
    # ленты, поэтому лимит выше реакции.
    story_react_limit_per_minute: int = 60
    story_view_limit_per_minute: int = 240
    max_avatar_size_bytes: int = 8 * 1024 * 1024
    # Как часто обновлять last_seen пользователя при активности (секунды).
    last_seen_update_seconds: int = 10

    # --- Предпросмотр внешних ссылок (карточка ссылки в сообщении) ---
    # Сервер сам ходит по ссылке из сообщения и достаёт заголовок/описание/картинку
    # (как это делают Telegram и WhatsApp). Это хождение наружу — самая опасная
    # часть, поэтому ограничено по времени, размеру, числу переходов и адресам
    # (только публичные IP — см. core/link_preview.py).
    link_preview_timeout_seconds: float = 6.0
    link_preview_max_bytes: int = 512 * 1024
    link_preview_max_redirects: int = 3
    # Успешную карточку держим неделю, неудачную — час: сайт мог «отлежаться».
    link_preview_cache_hours: int = 24 * 7
    link_preview_failure_cache_minutes: int = 60
    # Картинку превью скачиваем к себе (а не отдаём клиенту чужой адрес): так
    # превью работает и там, где сайт запрещает прямые ссылки, а IP пользователя
    # не утекает на сторонний сайт.
    link_preview_image_max_bytes: int = 4 * 1024 * 1024
    link_preview_limit_per_minute: int = 30
    # Прокси для хождения по ссылкам (``http://user:pass@host:port`` или пусто).
    # С российского сервера часть сайтов недоступна напрямую (например,
    # youtube.com — таймаут на TLS). Если задать прокси за пределами РФ,
    # превью таких ссылок заработает без правок кода.
    link_preview_proxy_url: str | None = None

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
