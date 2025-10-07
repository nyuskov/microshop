from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).parent.parent


class DBSettings(BaseModel):
    url: str = "postgresql+asyncpg://postgres:Xx123456@localhost:5432/microshop"
    echo: bool = True


class AuthJWT(BaseModel):
    secret_key: str = (
        "d44c6e681a5a325c9bad6f7a" "ee92d5cb6ebdbf1fd8732f90feef93ab1dbfb93a"
    )
    algorithm: str = "RS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 30
    private_key_path: Path = BASE_DIR / "certs" / "jwt-private.pem"
    public_key_path: Path = BASE_DIR / "certs" / "jwt-public.pem"


class Settings(BaseSettings):
    api_v1_prefix: str = "/api/v1"
    db: DBSettings = DBSettings()
    auth_jwt: AuthJWT = AuthJWT()


settings = Settings()
