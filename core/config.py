from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    api_v1_prefix: str = "/api/v1"
    db_url: str = ("postgresql+asyncpg://postgres:Xx123456@localhost:5432/micr"
                   "oshop")
    db_echo: bool = True


settings = Settings()
