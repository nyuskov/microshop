from datetime import datetime
from typing import TYPE_CHECKING

from fastapi_users.db import SQLAlchemyBaseUserTable
from sqlalchemy import BigInteger, Boolean, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .associations import user_chat_association_table
from .base import Base
from .mixins import IdIntPkMixin

if TYPE_CHECKING:
    from .chat import Chat
    from .message import Message
    from .profile import Profile


class User(IdIntPkMixin, SQLAlchemyBaseUserTable[int], Base):
    __tablename__ = "user"

    username: Mapped[str] = mapped_column(String(32), unique=True)
    phone_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=True)
    first_name: Mapped[str] = mapped_column(String(32), nullable=True)
    last_name: Mapped[str] = mapped_column(String(32), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    # Задал ли пользователь собственный пароль (вход по телефону+пароль).
    # У аккаунтов, созданных через OTP/SMS, пароль случайный и password_set=False:
    # при входе по телефону им предлагается придумать свой пароль.
    password_set: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
        nullable=False,
    )
    # Пароль не проходит текущую политику (короткий/из чёрного списка/содержит
    # данные аккаунта). Ставится при входе: только там есть открытый пароль, а
    # значит можно проверить уже существующие «старые» пароли. Фронт по этому
    # флагу показывает предложение сменить пароль.
    password_weak: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
        nullable=False,
    )
    # email может отсутствовать при входе по телефону, поэтому nullable
    email: Mapped[str | None] = mapped_column(  # type: ignore[assignment]
        String(length=320), nullable=True
    )
    # Подтверждён ли адрес кодом из письма. Только подтверждённый e-mail можно
    # использовать для входа без пароля и восстановления доступа; при смене
    # адреса флаг сбрасывается (см. users/views).
    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=text("false"),
        nullable=False,
    )
    avatar_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Текст-статус пользователя (например «в работе», «🚀»), задаётся в профиле.
    status: Mapped[str | None] = mapped_column(String(140), nullable=True)
    # Время последней активности — для присутствия («в сети» / «был(а) N назад»).
    last_seen: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ID Telegram-чата с нашим ботом (привязка) — для доставки OTP в личку,
    # когда Telegram Gateway недоступен/не настроен.
    tg_chat_id: Mapped[int | None] = mapped_column(
        BigInteger, unique=True, nullable=True
    )

    profile: Mapped["Profile"] = relationship(back_populates="user")

    chats: Mapped[list["Chat"]] = relationship(
        "Chat",
        secondary=user_chat_association_table,
        primaryjoin="User.id == chat_user_association.c.user_id",
        secondaryjoin="Chat.id == chat_user_association.c.chat_id",
        back_populates="users",
    )

    messages: Mapped[list["Message"]] = relationship(
        "Message",
        primaryjoin="User.id == Message.user_id",
        back_populates="user",
    )

    def __str__(self):
        return f"{self.__class__.__name__}(id={self.id}, username={self.username!r})"

    def __repr__(self):
        return str(self)
