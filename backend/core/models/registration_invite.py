"""Персональное приглашение на регистрацию (закрытый доступ «по инвайтам»).

Проект работает без публичной регистрации (см. ``Settings.registration_enabled``
и ``REGISTRATION_ENABLED``): доступ для новых людей открывает только владелец
сервиса — вручную создаёт одноразовую ссылку через CLI-скрипт
``scripts/create_invite.py`` и передаёт её лично приглашённому человеку.

По ссылке `/invite/<token>` человек сам придумывает пароль (см.
``api_v1/auth/routers/invites.py``), а не получает готовый аккаунт с паролем от
владельца — это удобнее и не требует пересылать пароль в открытом канале.

Токен — секрет ссылки (``secrets.token_urlsafe``), угадать его нельзя.
Приглашение можно ограничить конкретным номером телефона (``phone_number``) —
тогда им сможет воспользоваться только этот номер, и сроком действия
(``expires_at``). Использованное приглашение помечается ``used_at``/
``used_by_user_id`` и повторно не работает.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RegistrationInvite(Base):
    """Одноразовое приглашение на регистрацию нового аккаунта."""

    __tablename__ = "registration_invites"

    id: Mapped[int] = mapped_column(primary_key=True)

    #: Секрет ссылки: `/invite/<token>`. Уникален во всей таблице.
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    #: Если задан — приглашением можно воспользоваться только с этого номера.
    #: NULL — приглашение «на предъявителя», номер вводит сам приглашённый.
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)

    #: Заметка для владельца сервиса (например, «для Пети», не показывается
    #: приглашённому).
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    #: Необязательный срок годности ссылки (NULL — бессрочно).
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    #: Когда и кем использовано (NULL — ещё не использовано).
    used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    used_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    #: Когда владелец отозвал ссылку вручную (NULL — не отзывалась).
    #: Отдельно от ``used_at``: «по ссылке зарегистрировались» и «ссылку
    #: погасили» — разные события, и в списке приглашений их важно различать.
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


__all__ = ("RegistrationInvite",)
