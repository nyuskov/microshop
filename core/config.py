from pydantic import BaseModel
from pydantic_settings import BaseSettings


class DBSettings(BaseModel):
    url: str = "postgresql+asyncpg://postgres:Xx123456@localhost:5432/microshop"
    echo: bool = True


class Settings(BaseSettings):
    api_v1_prefix: str = "/api/v1"
    db: DBSettings = DBSettings()


settings = Settings()
