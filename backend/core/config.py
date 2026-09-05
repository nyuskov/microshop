from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).parent.parent


class AuthJWT(BaseSettings):
    """Настройки JWT-аутентификации."""

    secret_key: str = Field(
        default="d44c6e681a5a325c9bad6f7aee92d5cb6ebdbf1fd8732f90feef93ab1dbfb93a",
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
    auth_jwt: AuthJWT = AuthJWT()
    auth_otp_expire_seconds: int = 300  # 5 минут

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
