from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).parent.parent


class AuthJWT(BaseSettings):
    secret_key: str = (
        "d44c6e681a5a325c9bad6f7a" "ee92d5cb6ebdbf1fd8732f90feef93ab1dbfb93a"
    )
    algorithm: str = "HS256"  # Изменено на HS256
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    # Эти пути больше не нужны для HS256, но мы оставим их для обратной совместимости, если вдруг вернемся к RS256
    # private_key_path: Path = BASE_DIR / "certs" / "jwt-private.pem"
    # public_key_path: Path = BASE_DIR / "certs" / "jwt-public.pem"


class Settings(BaseSettings):
    api_v1_prefix: str = "/api/v1"
    db_url: str = Field(
        default="",
        validation_alias="DATABASE_URL",
    )
    db_echo: bool = True
    auth_jwt: AuthJWT = AuthJWT()


settings = Settings()