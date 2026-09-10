from pydantic import BaseModel, Field


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=5, max_length=2048)
    p256dh: str = Field(min_length=1, max_length=512)
    auth: str = Field(min_length=1, max_length=512)


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(min_length=5, max_length=2048)


class RuStorePushTokenRequest(BaseModel):
    """Push-токен устройства, выданный RuStore Push SDK в Android-приложении."""

    token: str = Field(min_length=8, max_length=512)


class PushPublicKeyResponse(BaseModel):
    """Публичный VAPID-ключ для создания подписки на клиенте."""

    public_key: str = ""
    enabled: bool = False
