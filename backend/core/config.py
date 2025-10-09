from pathlib import Path

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

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


class AccessToken(BaseModel):
    lifetime_seconds: int = 3600
    reset_password_token_secret: str = (
        "bc7489b3d5c3fb681ae66c0b7782dfd2232e98c1f7501f8d6907d833566bb35d"
    )
    verification_token_secret: str = (
        "5a75baedbfe91ea0f34b91ef9d7bf3de50e0eb068aff17170d4c9029f6cdbb3c"
    )


class Settings(BaseSettings):
    api_v1_prefix: str = "/api/v1"
    api_v1_auth_prefix: str = "/auth"
    db: DBSettings = DBSettings()
    auth_jwt: AuthJWT = AuthJWT()
    access_token: AccessToken = AccessToken()


settings = Settings()
