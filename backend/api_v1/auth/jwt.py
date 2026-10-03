"""Интеграция fastapi-users: JWT-аутентификация и профиль пользователя."""

from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi_users import BaseUserManager, FastAPIUsers
from fastapi_users import exceptions as fastapi_users_exceptions
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.jwt import decode_jwt as fastapi_users_decode_jwt
from fastapi_users.schemas import BaseUser, BaseUserUpdate
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api_v1.auth.refresh_sessions import rotate_refresh_token
from api_v1.auth.schemas import TokenResponse
from api_v1.auth.utils import (
    REFRESH_TOKEN_AUDIENCE,
    REFRESH_TOKEN_TYPE,
    access_token_problem,
    decode_jwt,
)
from api_v1.users.crud import get_user_by_id
from api_v1.users.schemas import UserUpdateWithProfileSchema, UserWithDetailsSchema
from core.config import settings
from core.i18n import locale_of_user, t
from core.models import Profile, User, db_helper

from . import audit
from .db import get_user_db
from .managers import UserManager
from .security_notifications import email_changed_message, notify_security_event


class UserRead(BaseUser):
    # email опционален, т.к. возможна регистрация по номеру телефона
    email: Optional[str] = Field(default=None)  # type: ignore[assignment]

    @field_validator("email", mode="before")
    @classmethod
    def empty_str_to_none(cls, value: Optional[str]) -> Optional[str]:
        return None if value == "" else value


class UserUpdate(BaseUserUpdate):
    email: Optional[str] = Field(default=None)


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase[User, int] = Depends(  # type: ignore[type-var]
        get_user_db
    ),
) -> UserManager:
    return UserManager(user_db)


class RotatingJWTStrategy(JWTStrategy):
    """JWT-стратегия с поддержкой предыдущего секрета (плановая ротация ключа).

    Подписывает токены ТОЛЬКО текущим секретом, а проверяет текущим и предыдущим
    (``JWT_SECRET_KEY_PREVIOUS``). Иначе смена ключа мгновенно разлогинила бы всех
    пользователей: refresh-токены живут 30 дней, и они подписаны старым ключом.
    Процедура ротации — docs/jwt-rotation.md.
    """

    def __init__(self, *, secrets: list[str], lifetime_seconds: int) -> None:
        super().__init__(secret=secrets[0], lifetime_seconds=lifetime_seconds)
        self._decode_secrets = secrets
        # Подписываем всегда текущим ключом; предыдущий нужен только для чтения.
        self._sign_secret = secrets[0]
        self._lifetime_seconds = int(lifetime_seconds)

    async def write_token(self, user: User) -> str:
        """Выпускает access-токен с номером «эпохи» пользователя.

        Claim ``epoch`` нужен для мгновенного отзыва: access-токены не хранятся
        в БД, и без такого claim'а «выйти на всех устройствах» оставляло бы вору
        доступ ещё на 30 минут. См. ``auth/utils.access_token_problem``.

        Токен собираем сами (а не через ``JWTStrategy.write_token``), чтобы
        добавить свой claim в стандартный payload fastapi-users: состав полей
        остаётся совместимым (``sub``/``aud``/``exp``).
        """
        now = datetime.now(timezone.utc)
        payload = {
            "sub": str(user.id),
            "aud": self.token_audience,
            "epoch": int(user.token_epoch or 0),
            "iat": now,
            "exp": now + timedelta(seconds=self._lifetime_seconds),
        }
        return jwt.encode(payload, self._sign_secret, algorithm=self.algorithm)

    async def read_token(
        self, token: str | None, user_manager: BaseUserManager
    ) -> User | None:
        """Читает токен, пробуя по очереди текущий и предыдущий секреты."""
        if token is None:
            return None

        for secret in self._decode_secrets:
            try:
                data = fastapi_users_decode_jwt(
                    token, secret, self.token_audience, algorithms=[self.algorithm]
                )
            except jwt.PyJWTError:
                continue
            user_id = data.get("sub")
            if user_id is None:
                return None
            try:
                parsed_id = user_manager.parse_id(user_id)
                user = await user_manager.get(parsed_id)
            except (
                fastapi_users_exceptions.UserNotExists,
                fastapi_users_exceptions.InvalidID,
            ):
                return None
            # Заморожённый аккаунт и отозванный токен не проходят и здесь
            # (этот путь используют служебные роутеры fastapi-users: /jwt/users/me).
            return None if access_token_problem(data, user) is not None else user
        return None


def get_jwt_strategy() -> JWTStrategy:
    return RotatingJWTStrategy(
        secrets=settings.auth_jwt.accepted_secrets(),
        lifetime_seconds=settings.auth_jwt.access_token_expire_minutes * 60,
    )


bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")

auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, int](  # type: ignore[type-var]
    get_user_manager=get_user_manager,
    auth_backends=[auth_backend],
)

router = APIRouter(prefix="/jwt", tags=["JWT"])
router.include_router(fastapi_users.get_auth_router(auth_backend), prefix="/auth")


@router.get("/users/me/", response_model=UserWithDetailsSchema)
async def get_me(
    user: User = Depends(fastapi_users.current_user()),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    """Возвращает данные текущего пользователя вместе с профилем и чатами."""
    stmt = (
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.profile), selectinload(User.chats))
    )
    result = await session.execute(stmt)
    return result.scalar_one()


@router.patch("/users/me/", response_model=UserWithDetailsSchema)
async def update_me(
    user_update: UserUpdateWithProfileSchema,
    request: Request,
    current_user: User = Depends(fastapi_users.current_user()),
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> User:
    """Обновляет данные и профиль текущего пользователя."""
    stmt = (
        select(User)
        .where(User.id == current_user.id)
        .options(selectinload(User.profile))
    )
    result = await session.execute(stmt)
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=t("Пользователь не найден"),
        )

    user_data = user_update.model_dump(exclude_unset=True, exclude={"profile"})
    # Смена e-mail сбрасывает подтверждение: адрес мог быть указан ошибочно (или
    # чужим), а подтверждённый e-mail — это канал входа и восстановления пароля.
    email_changed = "email" in user_data and user_data["email"] != user.email
    old_email = str(user.email) if user.email else ""
    old_email_verified = bool(user.email_verified)
    new_email = str(user_data["email"]) if email_changed and user_data["email"] else ""
    for field, value in user_data.items():
        setattr(user, field, value)
    if email_changed:
        user.email_verified = False

    if user_update.profile is not None:
        if user.profile is None:
            user.profile = Profile(user_id=user.id)
            session.add(user.profile)
        profile_data = user_update.profile.model_dump(exclude_unset=True)
        for field, value in profile_data.items():
            setattr(user.profile, field, value)

    await session.commit()

    if email_changed:
        await audit.log_security_event(
            session,
            event="email_changed",
            user_id=user.id,
            request=request,
            detail=t("адрес изменён на {value}", value=new_email or t("удалён")),
        )

    if email_changed and old_email and old_email_verified:
        # Письмо уходит на ПРЕЖНИЙ адрес: если адрес меняет не владелец аккаунта,
        # именно так настоящий владелец об этом узнаёт. Текущий адрес
        # уведомление не получит — он пока не подтверждён (это сделал бы
        # посторонний, кто получил доступ к аккаунту).
        await notify_security_event(
            session,
            user,
            event="email_changed",
            request=request,
            recipient=old_email,
            details=email_changed_message(
                old_email,
                str(user.email) if user.email else None,
                await locale_of_user(session, user.id),
            ),
        )

    stmt = (
        select(User)
        .where(User.id == user.id)
        .options(selectinload(User.profile), selectinload(User.chats))
    )
    result = await session.execute(stmt)
    return result.scalar_one()


@router.post("/auth/refresh", response_model=TokenResponse)
async def refresh_access_token(
    request: Request,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> TokenResponse:
    """Обменивает refresh-токен на новую пару (access + refresh, ротация).

    Фронт держит refresh-токен в сторе и обращается сюда при 401 от API.
    Refresh-токен не является access-токеном (отдельный aud и claim type),
    поэтому сюда нельзя «подсунуть» обычный токен.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=t("Недействительный refresh-токен"),
        headers={"WWW-Authenticate": "Bearer"},
    )
    auth_header = request.headers.get("Authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise unauthorized

    try:
        payload = decode_jwt(token)
    except jwt.InvalidTokenError as exc:
        raise unauthorized from exc

    if (
        payload.get("type") != REFRESH_TOKEN_TYPE
        or payload.get("aud") != REFRESH_TOKEN_AUDIENCE
    ):
        raise unauthorized

    sub_value = str(payload.get("sub", ""))
    if not sub_value.isdigit():
        raise unauthorized

    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti:
        # Токен без идентификатора сессии (старый формат) — не принимаем.
        raise unauthorized

    user = await get_user_by_id(session, int(sub_value))
    if user is None:
        raise unauthorized

    new_refresh_token = await rotate_refresh_token(session, jti=jti, user_id=user.id)
    if new_refresh_token is None:
        # Недействительный / истёкший / повторно использованный токен.
        raise unauthorized

    access_token = await get_jwt_strategy().write_token(user)
    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        refresh_token=new_refresh_token,
    )
