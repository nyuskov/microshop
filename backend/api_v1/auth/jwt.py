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
from ..users.schemas import UserSchema, PublicUserSchema  # Импортируем PublicUserSchema
from .validation import (
    get_current_active_auth_user,
    get_current_auth_user_for_refresh,
    get_current_token_payload,
    validate_auth_user,
    get_current_db_user,  # Импортируем новую зависимость
)
from core.models.user import User  # Импортируем модель User

http_bearer = HTTPBearer(auto_error=False)
router = APIRouter(
    prefix="/jwt",
    tags=["JSON Web Tokens"],
    dependencies=[Depends(http_bearer)],
)


@router.get("/users/me/", response_model=PublicUserSchema)  # Указываем новую схему
def auth_user_check_self_info(
    # payload: dict = Depends(get_current_token_payload),
    user: User = Depends(
        get_current_db_user
    ),  # Используем новую зависимость, возвращающую модель User
):
    # OAuth2PasswordBearer
    # Возвращаем модель User, Pydantic заполнит PublicUserSchema автоматически благодаря from_attributes=True
    return user


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
