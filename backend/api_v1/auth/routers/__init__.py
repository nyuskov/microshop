"""Роутеры модуля аутентификации."""

from fastapi import APIRouter

from .devices import router as devices_router
from .email_codes import router as email_codes_router
from .otp import router as otp_router
from .password import router as password_router
from .sessions import router as sessions_router

router = APIRouter(prefix="/auth", tags=["Аутентификация"])

router.include_router(devices_router)
router.include_router(email_codes_router)
router.include_router(otp_router)
router.include_router(password_router)
router.include_router(sessions_router)

__all__ = [
    "devices_router",
    "email_codes_router",
    "otp_router",
    "password_router",
    "router",
    "sessions_router",
]
