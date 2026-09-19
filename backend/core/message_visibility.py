"""Что человек видит в ленте: скрытое модерацией и «удалённое у меня».

Условие выборки одно на все чтения сообщений — лента, закреплённые, поиск,
галерея медиа, превью в списке чатов, счётчик непрочитанных. Держим его здесь, а
не в crud мессенджера, потому что им пользуются ДВА разных модуля
(``api_v1/messages/crud.py`` и ``api_v1/chats/crud.py``), а тянуть один crud в
другой нельзя: ``messages.crud`` уже импортирует ``chats.crud`` — получилось бы
кольцо.

Правила видимости:

* **скрытое модерацией** (``messages.hidden_at``) видит только автор — он должен
  понимать, куда пропало сообщение, и иметь возможность его исправить;
* **«удалённое у меня»** (таблица ``message_deletions``) не видит только тот, кто
  его скрыл: для остальных участников сообщение остаётся на месте.

Второе правило нужно и списку чатов (превью и счётчик непрочитанных), поэтому
здесь есть отдельное ``hidden_for_user_filter``: скрытое модерацией в превью
остаётся последним сообщением с пометкой «скрыто до проверки» — так решили
раньше, и это поведение не меняется.

Забыть это условие в новом запросе легко, а стоит дорого: «удалённое у меня»
всплывёт у человека в списке чатов или в непрочитанных, и выглядит это как
сломанное удаление.
"""

from sqlalchemy import and_, or_, select
from sqlalchemy.sql.elements import ColumnElement

from core.models import Message, MessageDeletion


def hidden_for_user_filter(viewer_id: int) -> ColumnElement[bool]:
    """Условие «сообщение не убрано лично мной» (таблица ``message_deletions``).

    Отдельно от полного фильтра: в превью списка чатов скрытое МОДЕРАЦИЕЙ
    сообщение остаётся последним (клиент рисует «скрыто до проверки»), а
    «удалённое у меня» там показывать нельзя — человек его убрал.
    """
    hidden_for_me = select(MessageDeletion.message_id).where(
        MessageDeletion.user_id == viewer_id
    )
    return Message.id.not_in(hidden_for_me)


def message_visibility_filter(viewer_id: int) -> ColumnElement[bool]:
    """Условие «сообщение видно этому человеку».

    Подставляется в ``WHERE`` выборок сообщений: без него скрытое всплывёт.
    """
    return and_(
        or_(Message.hidden_at.is_(None), Message.user_id == viewer_id),
        hidden_for_user_filter(viewer_id),
    )


__all__ = ("hidden_for_user_filter", "message_visibility_filter")
