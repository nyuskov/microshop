from fastapi import APIRouter, Depends
from fastapi.security import (
    HTTPBearer,
    OAuth2PasswordBearer,
)

from .helpers import (
    create_access_token,
    create_refresh_token,
)
from ..tokens.schemas import Token
from ..users.schemas import UserSchema
from .validation import (
    get_current_active_auth_user,
    get_current_auth_user_for_refresh,
    get_current_token_payload,
    validate_auth_user,
)


http_bearer = HTTPBearer(auto_error=False)
router = APIRouter(
    prefix="/jwt",
    tags=["JSON Web Tokens"],
    dependencies=[Depends(http_bearer)],
)


@router.get("/users/me/")
def auth_user_check_self_info(
    payload: dict = Depends(get_current_token_payload),
    user: UserSchema = Depends(get_current_active_auth_user),
) -> dict:
    OAuth2PasswordBearer
    return {
        "username": user.username,
        "email": user.email,
        "logged_in_at": payload.get("iat"),
    }


@router.post("/login/", response_model=Token)
def auth_user_issue_jwt(
    user: UserSchema = Depends(validate_auth_user),
) -> Token:
    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user)
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post(
    "/refresh/",
    response_model=Token,
    response_model_exclude_none=True,
)
def auth_refresh_jwt(
    user: UserSchema = Depends(get_current_auth_user_for_refresh),
) -> Token:
    access_token = create_access_token(user)

    return Token(
        access_token=access_token,
    )
