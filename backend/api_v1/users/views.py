"""Эндпоинты для управления пользователями."""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.rate_limit import enforce_limit
from api_v1.upload_guard import validate_image_upload
from api_v1.users import crud, deletion, schemas
from core.config import settings
from core.models import User, db_helper
from core.security import get_password_hash, verify_password

router = APIRouter(prefix="/users", tags=["Users"])

AVATAR_DIR = Path(__file__).resolve().parent.parent.parent / "media" / "avatars"
# Лимит размера аватара настраивается через env (Settings.max_avatar_size_bytes).
MAX_AVATAR_SIZE = settings.max_avatar_size_bytes
MAX_AVATAR_MB = MAX_AVATAR_SIZE // (1024 * 1024)
ALLOWED_AVATAR_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}


def _remove_avatar_file(avatar_url: str | None) -> None:
    """Удаляет файл аватара (best-effort)."""
    if not avatar_url or not avatar_url.startswith("/media/avatars/"):
        return
    path = AVATAR_DIR / Path(avatar_url).name
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


@router.get("/search/", response_model=list[schemas.UserSearchResultSchema])
async def search_users(
    q: str = Query(default="", min_length=1, max_length=64),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[User]:
    """Ищет пользователей по логину или номеру телефона."""
    query = q.strip()
    if not query:
        return []
    await enforce_limit(
        scope="users:search",
        value=str(user.id),
        limit=settings.user_search_limit_per_minute,
        window_seconds=60,
        detail="Слишком много запросов. Попробуйте позже.",
    )
    return await crud.search_users_by_query(session, query, exclude_user_id=user.id)


@router.get("/contacts/", response_model=list[schemas.UserSearchResultSchema])
async def get_contacts(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[User]:
    """Возвращает всех пользователей, кроме текущего (для вкладки «Контакты»)."""
    return await crud.get_contacts(session, exclude_user_id=user.id)


@router.post("/match-by-phone/", response_model=list[schemas.UserSearchResultSchema])
async def match_users_by_phone(
    payload: schemas.PhoneMatchRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[User]:
    """Находит пользователей мессенджера по номерам из телефонной книги."""
    return await crud.get_users_by_phones(
        session, payload.phones, exclude_user_id=user.id
    )


@router.put("/me/avatar/", response_model=schemas.UserAvatarResponse)
async def upload_my_avatar(
    request: Request,
    ext: str = Query(default="png", max_length=8),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Загружает фото на аватар текущего пользователя (тело — байты файла)."""
    await enforce_limit(
        scope="users:avatar",
        value=str(user.id),
        limit=settings.avatar_upload_limit_per_minute,
        window_seconds=60,
        detail="Слишком много запросов. Попробуйте позже.",
    )
    ext = ext.lower().lstrip(".")
    if ext not in ALLOWED_AVATAR_EXTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недопустимый формат файла",
        )

    content = await request.body()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пустой файл",
        )
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Файл слишком большой (максимум {MAX_AVATAR_MB} МБ)",
        )

    validate_image_upload(f"avatar.{ext}", content)

    db_user = await session.get(User, user.id)
    if db_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )

    _remove_avatar_file(db_user.avatar_url)
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"user_{db_user.id}_{uuid.uuid4().hex}.{ext}"
    (AVATAR_DIR / stored_name).write_bytes(content)

    db_user.avatar_url = f"/media/avatars/{stored_name}"
    await session.commit()
    return {"avatar_url": db_user.avatar_url}


@router.delete("/me/avatar/", response_model=schemas.UserAvatarResponse)
async def delete_my_avatar(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Удаляет аватар текущего пользователя."""
    db_user = await session.get(User, user.id)
    if db_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    _remove_avatar_file(db_user.avatar_url)
    db_user.avatar_url = None
    await session.commit()
    return {"avatar_url": None}


@router.post(
    "/",
    response_model=schemas.UserCreatedResponseSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    user_in: schemas.CreateUser,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    user = User(**user_in.model_dump(exclude={"password"}))
    user.hashed_password = get_password_hash(user_in.password)
    # Пароль задан явно — разрешаем вход по телефону+паролю.
    user.password_set = True
    return await crud.create_user(session, user)


@router.delete("/me/", status_code=status.HTTP_204_NO_CONTENT)
async def delete_me(
    payload: schemas.DeleteAccountRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Response:
    """Безвозвратно удаляет аккаунт и все данные пользователя.

    Нужно для RuStore/152-ФЗ (удаление аккаунта из приложения). Пароль
    проверяем, только если он был задан самим пользователем (аккаунты из OTP
    могли иметь случайный пароль — им достаточно подтверждающей строки).
    """
    db_user = await session.get(User, user.id)
    if db_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    if payload.confirm != schemas.DELETE_ACCOUNT_CONFIRM:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Для подтверждения введите {schemas.DELETE_ACCOUNT_CONFIRM}",
        )
    if db_user.password_set:
        if not payload.password or not verify_password(
            payload.password, db_user.hashed_password
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Неверный пароль",
            )
    await deletion.delete_user_account(session, db_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
