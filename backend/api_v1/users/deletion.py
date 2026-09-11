"""Удаление аккаунта пользователя вместе с его данными.

Требование RuStore (и 152-ФЗ): у пользователя должна быть возможность удалить
аккаунт прямо в приложении. Удаление безвозвратное:

* сообщения пользователя (файлы на диске — best-effort), реакции;
* участие в чатах, mute, блокировки, жалобы, профиль, аватар;
* ключи E2EE, push-подписки (Web Push и RuStore), refresh-сессии, OTP-коды,
  привязка Telegram.

Чаты, где остались другие участники, сохраняются — у собеседника остаётся
история без удалённых сообщений. Чаты, в которых не осталось участников,
удаляются вместе с оставшимися сообщениями.
"""

import logging
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import (
    Chat,
    ChatGroupKey,
    ChatMute,
    Contact,
    DeviceKey,
    Message,
    MessageReaction,
    OtpCode,
    Profile,
    PushSubscription,
    RefreshSession,
    RuStorePushToken,
    TelegramBindLink,
    User,
    UserBlock,
    UserReport,
    user_chat_association_table,
)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
MEDIA_DIR = BASE_DIR / "media"
AVATAR_DIR = MEDIA_DIR / "avatars"


def _remove_file(path: Path) -> None:
    """Удаляет файл с диска (best-effort: файла может уже не быть)."""
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:  # noqa: BLE001 - удаление данных не должно падать
        logger.warning("Не удалось удалить файл %s: %s", path, exc)


def _remove_media_file(file_url: str | None) -> None:
    """Удаляет файл вложения по его URL (``/media/<name>``)."""
    if not file_url or not file_url.startswith("/media/"):
        return
    name = Path(file_url).name
    if not name:
        return
    _remove_file(MEDIA_DIR / name)


def _remove_avatar(avatar_url: str | None) -> None:
    """Удаляет файл аватара (``/media/avatars/<name>``)."""
    if not avatar_url or not avatar_url.startswith("/media/avatars/"):
        return
    name = Path(avatar_url).name
    if not name:
        return
    _remove_file(AVATAR_DIR / name)


async def delete_user_account(session: AsyncSession, user: User) -> None:
    """Полностью удаляет аккаунт пользователя и связанные с ним данные."""
    user_id = user.id

    # 1. Файлы сообщений и аватар — до удаления строк в БД (иначе теряем URL).
    file_urls = (
        (
            await session.execute(
                select(Message.file_url).where(Message.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    for file_url in file_urls:
        _remove_media_file(file_url)
    _remove_avatar(user.avatar_url)

    # 2. Данные, ссылающиеся на пользователя.
    await session.execute(
        delete(MessageReaction).where(MessageReaction.user_id == user_id)
    )
    await session.execute(delete(Message).where(Message.user_id == user_id))
    await session.execute(
        delete(user_chat_association_table).where(
            user_chat_association_table.c.user_id == user_id
        )
    )
    await session.execute(delete(ChatMute).where(ChatMute.user_id == user_id))
    # Контакты: и «моя книжка», и записи других людей обо мне (иначе остались бы
    # битые ссылки на удалённый аккаунт).
    await session.execute(delete(Contact).where(Contact.owner_id == user_id))
    await session.execute(delete(Contact).where(Contact.contact_user_id == user_id))
    await session.execute(delete(DeviceKey).where(DeviceKey.user_id == user_id))
    # Обёртки ключа группы: свои — удаляем, в чужих проставляем NULL
    # (обёртку всё равно сможет расшифровать только её владелец).
    await session.execute(delete(ChatGroupKey).where(ChatGroupKey.user_id == user_id))
    await session.execute(
        update(ChatGroupKey)
        .where(ChatGroupKey.wrapped_by == user_id)
        .values(wrapped_by=None)
    )
    await session.execute(
        delete(PushSubscription).where(PushSubscription.user_id == user_id)
    )
    await session.execute(
        delete(RuStorePushToken).where(RuStorePushToken.user_id == user_id)
    )
    await session.execute(
        delete(RefreshSession).where(RefreshSession.user_id == user_id)
    )
    await session.execute(
        delete(TelegramBindLink).where(TelegramBindLink.user_id == user_id)
    )
    await session.execute(
        delete(UserBlock).where(
            (UserBlock.blocker_id == user_id) | (UserBlock.blocked_id == user_id)
        )
    )
    await session.execute(
        delete(UserReport).where(
            (UserReport.reporter_id == user_id) | (UserReport.reported_id == user_id)
        )
    )
    if user.phone_number:
        await session.execute(
            delete(OtpCode).where(OtpCode.phone_number == user.phone_number)
        )
    await session.execute(delete(Profile).where(Profile.user_id == user_id))

    # 3. Чаты, в которых не осталось участников (личные диалоги, «Сохранённые»).
    empty_chat_ids = (
        (
            await session.execute(
                select(Chat.id).where(
                    ~Chat.id.in_(select(user_chat_association_table.c.chat_id))
                )
            )
        )
        .scalars()
        .all()
    )
    if empty_chat_ids:
        await session.execute(
            delete(Message).where(Message.chat_id.in_(empty_chat_ids))
        )
        await session.execute(delete(Chat).where(Chat.id.in_(empty_chat_ids)))

    # 4. Сам пользователь.
    await session.execute(delete(User).where(User.id == user_id))
    await session.commit()
    logger.info("Аккаунт пользователя %s удалён вместе с данными", user_id)
