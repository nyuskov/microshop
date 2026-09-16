from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from core.db_types import EncryptedText

from .base import Base
from .mixins import IdIntPkMixin, UserRelationMixin


class Profile(IdIntPkMixin, UserRelationMixin, Base):
    _user_id_unique = True
    _user_back_populates = "profile"

    # Профиль: имя/фамилия в этой таблице не используются (живут в `user`), а
    # «о себе» показывается в карточке профиля — этот текст шифруем.
    first_name: Mapped[str | None] = mapped_column(String(40))
    last_name: Mapped[str | None] = mapped_column(String(40))
    bio: Mapped[str | None] = mapped_column(EncryptedText)
    birth_date: Mapped[str | None] = mapped_column(String(10))  # Format: YYYY-MM-DD
    language: Mapped[str | None] = mapped_column(String(10))  # e.g., 'en', 'ru'
    country: Mapped[str | None] = mapped_column(String(10))  # e.g., 'US', 'RU'
    notifications_enabled: Mapped[bool] = mapped_column(default=True)
    privacy_mode: Mapped[bool] = mapped_column(default=False)
    # Показывать текст сообщения прямо в push. Выключают те, кто не хочет,
    # чтобы содержимое переписки читалось с экрана заблокированного телефона
    # (и попадало в галерею уведомлений). Имя отправителя остаётся — иначе
    # непонятно, открывать ли приложение вообще.
    notification_preview: Mapped[bool] = mapped_column(default=True)

    # ---------- Тихие часы (не беспокоить) ----------
    # Время хранится в МИНУТАХ от полуночи по местному времени пользователя:
    # так не нужно разбирать строки вида «23:30» и легко сравнивать границы
    # окна. Часового пояс — сдвиг от UTC в минутах: его присылает клиент при
    # сохранении настроек (у устройства он всегда актуален, серверу не нужна
    # база часовых поясов). По умолчанию окно 23:00–08:00 и звонки разрешены:
    # человека будят звонком, а не сообщением.
    quiet_hours_enabled: Mapped[bool] = mapped_column(default=False)
    quiet_hours_start: Mapped[int] = mapped_column(default=23 * 60)
    quiet_hours_end: Mapped[int] = mapped_column(default=8 * 60)
    quiet_hours_allow_calls: Mapped[bool] = mapped_column(default=True)
    quiet_hours_offset: Mapped[int] = mapped_column(default=0)
