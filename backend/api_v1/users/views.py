"""Эндпоинты для управления пользователями."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth import audit
from api_v1.auth.utils import get_current_user
from api_v1.users import crud, deletion, schemas
from core.avatar_store import remove_avatar_files, store_avatar
from core.config import settings
from core.i18n import t
from core.image_convert import HEIC_EXTS, heic_to_jpeg, looks_like_heic
from core.media_quota import media_usage
from core.models import User, db_helper
from core.presence import scrub_last_seen
from core.rate_limit import enforce_limit
from core.security import get_password_hash, verify_password
from core.upload_guard import validate_image_upload

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me/storage/", response_model=schemas.UserStorageResponse)
async def get_my_storage(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> dict[str, int]:
    """Сколько медиа пользователь держит на сервере и сколько ему разрешено.

    Нужно, чтобы профиль показывал заполненность хранилища ДО того, как загрузка
    начнёт падать с 413 («хранилище заполнено»). Удаление сообщений освобождает
    место сразу — счётчики берутся из БД.
    """
    usage = await media_usage(session, user_id=user.id)
    return {
        "used_bytes": usage.used_bytes,
        "quota_bytes": usage.quota_bytes,
        "files": usage.files,
        "percent": usage.percent,
    }


# Лимит размера аватара настраивается через env (Settings.max_avatar_size_bytes).
MAX_AVATAR_SIZE = settings.max_avatar_size_bytes
MAX_AVATAR_MB = MAX_AVATAR_SIZE // (1024 * 1024)
ALLOWED_AVATAR_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}


def _remove_my_avatar_files(db_user: User) -> None:
    """Удаляет файлы аватара и миниатюры (best-effort)."""
    remove_avatar_files(db_user.avatar_url, db_user.avatar_thumb_url)


def _search_payloads(rows: list[User]) -> list[dict[str, Any]]:
    """Список людей для поиска/контактов без скрытого присутствия.

    Присутствие скрывает сам человек (см. `core.presence`): чужие настройки его
    не касаются. Отдаём словари, а не ORM-объекты: `last_seen` на модели
    подменять нельзя — SQLAlchemy записал бы NULL в БД.
    """
    payloads: list[dict[str, Any]] = []
    for row in rows:
        item = schemas.UserSearchResultSchema.model_validate(row).model_dump()
        payloads.append(scrub_last_seen(item, row))
    return payloads


@router.get("/search/", response_model=list[schemas.UserSearchResultSchema])
async def search_users(
    q: str = Query(default="", min_length=1, max_length=64),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Ищет пользователей по логину или номеру телефона."""
    query = q.strip()
    if not query:
        return []
    await enforce_limit(
        scope="users:search",
        value=str(user.id),
        limit=settings.user_search_limit_per_minute,
        window_seconds=60,
        detail=t("Слишком много запросов. Попробуйте позже."),
    )
    found = await crud.search_users_by_query(session, query, exclude_user_id=user.id)
    return _search_payloads(found)


@router.get("/by-username/{username}", response_model=schemas.UserLinkPreviewSchema)
async def get_user_by_link(
    username: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    """Пользователь по ссылке-профилю (`https://pismo.space/u/<логин>`).

    Так открываются ссылки, которыми делятся вне мессенджера: приложение по
    логину находит человека и открывает (или создаёт) с ним личный чат.

    Номер телефона в ответе не отдаём — см. `UserLinkPreviewSchema`. Регистр
    логина не важен. Лимит запросов общий с поиском людей: перебирать логины
    по ссылкам так же неудобно, как и через поиск.
    """
    await enforce_limit(
        scope="users:search",
        value=str(user.id),
        limit=settings.user_search_limit_per_minute,
        window_seconds=60,
        detail=t("Слишком много запросов. Попробуйте позже."),
    )
    found = await crud.find_user_by_username(session, username)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Пользователь не найден"),
        )
    return found


@router.get("/contacts/", response_model=list[schemas.UserSearchResultSchema])
async def get_contacts(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Возвращает всех пользователей, кроме текущего (для вкладки «Контакты»)."""
    rows = await crud.get_contacts(session, exclude_user_id=user.id)
    return _search_payloads(rows)


@router.post("/match-by-phone/", response_model=list[schemas.UserSearchResultSchema])
async def match_users_by_phone(
    payload: schemas.PhoneMatchRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[dict[str, Any]]:
    """Находит пользователей мессенджера по номерам из телефонной книги."""
    rows = await crud.get_users_by_phones(
        session, payload.phones, exclude_user_id=user.id
    )
    return _search_payloads(rows)


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
        detail=t("Слишком много запросов. Попробуйте позже."),
    )
    ext = ext.lower().lstrip(".")
    # HEIC (фото с телефона) принимаем наравне с JPEG: ниже он перекодируется в
    # JPEG, иначе аватар с Samsung не поставить вовсе (браузеры HEIC не показывают).
    if ext not in (ALLOWED_AVATAR_EXTS | HEIC_EXTS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Недопустимый формат файла"),
        )

    content = await request.body()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t("Пустой файл"),
        )
    if len(content) > MAX_AVATAR_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=t("Файл слишком большой (максимум {mb} МБ)", mb=MAX_AVATAR_MB),
        )

    # Фото с телефона в HEIC перекодируем в JPEG: браузеры HEIC не показывают, а
    # хранить и раздавать нечитаемую картинку незачем (`core/image_convert.py`).
    if looks_like_heic(content):
        content = heic_to_jpeg(content)
        ext = "jpg"

    validate_image_upload(f"avatar.{ext}", content)

    db_user = await session.get(User, user.id)
    if db_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Пользователь не найден"),
        )

    _remove_my_avatar_files(db_user)
    # Оригинал и миниатюра для списков через одну точку входа — см. avatar_store.
    avatar_url, avatar_thumb_url = store_avatar(
        content, prefix=f"user_{db_user.id}", extension=ext
    )

    db_user.avatar_url = avatar_url
    db_user.avatar_thumb_url = avatar_thumb_url
    await session.commit()
    return {
        "avatar_url": db_user.avatar_url,
        "avatar_thumb_url": db_user.avatar_thumb_url,
    }


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
            detail=t("Пользователь не найден"),
        )
    _remove_my_avatar_files(db_user)
    db_user.avatar_url = None
    db_user.avatar_thumb_url = None
    await session.commit()
    return {"avatar_url": None, "avatar_thumb_url": None}


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
    request: Request,
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
            detail=t("Пользователь не найден"),
        )
    if payload.confirm != schemas.DELETE_ACCOUNT_CONFIRM:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=t(
                "Для подтверждения введите {code}", code=schemas.DELETE_ACCOUNT_CONFIRM
            ),
        )
    if db_user.password_set:
        if not payload.password or not verify_password(
            payload.password, db_user.hashed_password
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=t("Неверный пароль"),
            )
    # Пишем событие до удаления: строка журнала переживёт аккаунт
    # (FK ON DELETE SET NULL), и в истории останется сам факт удаления.
    await audit.log_security_event(
        session,
        event="account_deleted",
        user_id=db_user.id,
        request=request,
        detail=t("аккаунт удалён пользователем"),
    )
    await deletion.delete_user_account(session, db_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
