from pydantic import BaseModel


class Token(BaseModel):
    """Модель, используемая для ответа токеном при авторизации"""

    access_token: str
    token_type: str


class TokenData(BaseModel):
    """Модель данных для сериализации пользователя"""

    username: str | None = None
