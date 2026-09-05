"""Эндпоинты для управления пользователями."""

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.utils import get_current_user
from api_v1.users import crud, schemas
from core.models import User, db_helper
from core.security import get_password_hash

router = APIRouter(prefix="/users", tags=["Users"])

AVATAR_DIR = Path(__file__).resolve().parent.parent.parent / "media" / "avatars"
MAX_AVATAR_SIZE = 8 * 1024 * 1024  # 8 МБ
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


@router.get("/", response_model=list[schemas.UserWithDetailsSchema])
async def get_users(
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[User]:
    return await crud.get_users_with_profile(session)


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
    return await crud.search_users_by_query(
        session, query, exclude_user_id=user.id
    )


@router.get("/contacts/", response_model=list[schemas.UserSearchResultSchema])
async def get_contacts(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[User]:
    """Возвращает всех пользователей, кроме текущего (для вкладки «Контакты»)."""
    return await crud.get_contacts(session, exclude_user_id=user.id)


@router.put("/me/avatar/", response_model=schemas.UserAvatarResponse)
async def upload_my_avatar(
    request: Request,
    ext: str = Query(default="png", max_length=8),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    """Загружает фото на аватар текущего пользователя (тело — байты файла)."""
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
            detail="Файл слишком большой (максимум 8 МБ)",
        )

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


@router.get("/{user_id}/", response_model=schemas.UserWithDetailsSchema)
async def get_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    user = await crud.get_user_with_profile(session, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return user


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
    return await crud.create_user(session, user)


@router.get("/{user_id}/chats/", response_model=list[schemas.ChatSchema])
async def get_chats_for_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list:
    user = await crud.get_user_with_chats(session, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return user.chats


@router.get("/{user_id}/posts/", response_model=list[schemas.PostSchema])
async def get_posts_for_user(
    user_id: int,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list:
    return await crud.get_posts_for_user(session, user_id)
