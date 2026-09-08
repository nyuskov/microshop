from pydantic import BaseModel


class RequestOTPRequest(BaseModel):
    phone_number: str


class VerifyOTPRequest(BaseModel):
    phone_number: str
    otp: str


class OTPResponse(BaseModel):
    detail: str


class PasswordStatusRequest(BaseModel):
    phone_number: str


class PasswordStatusResponse(BaseModel):
    registered: bool
    has_password: bool


class PasswordRequest(BaseModel):
    phone_number: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None
