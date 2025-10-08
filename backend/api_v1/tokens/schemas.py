from pydantic import BaseModel


class Token(BaseModel):
    """Модель, используемая для ответа токеном при авторизации"""

    access_token: str
    refresh_token: str | None = None
    token_type: str = "Bearer"


class TokenData(BaseModel):
    """Модель данных для сериализации пользователя"""

    username: str | None = None
