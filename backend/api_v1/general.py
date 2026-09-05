import secrets

from fastapi import APIRouter, Response

router = APIRouter(tags=["General"])


@router.get("/set-csrf-token")
def set_csrf_token(response: Response) -> dict[str, str]:
    """Генерирует CSRF-токен и устанавливает его в cookie."""
    csrf_token = secrets.token_urlsafe(32)
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        httponly=True,
        samesite="lax",
        max_age=3600,
        secure=True,
    )
    return {"csrf_token": csrf_token}
