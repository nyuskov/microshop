"""Юнит-тесты формирования push-уведомлений (без сети и БД).

Проверяем то, что видит получатель: крупная иконка уведомления должна быть
аватаром отправителя, а если аватара нет — иконкой приложения (не пустой
ссылкой, иначе уведомление остаётся вообще без иконки).
"""

from types import SimpleNamespace

import pytest

from tasks import notifications


def test_push_icon_prefers_thumb() -> None:
    """Есть миниатюра — берём её: устройство тянет картинку на маленькую иконку."""
    user = SimpleNamespace(
        avatar_url="/media/avatars/user_7_ab12cd.png",
        avatar_thumb_url="/media/avatars/user_7_ab12cd_t128.jpg",
    )
    assert notifications._push_icon(user) == "/media/avatars/user_7_ab12cd_t128.jpg"


def test_push_icon_uses_sender_avatar() -> None:
    """Миниатюры нет (старый аватар) — показываем оригинал, а не иконку приложения."""
    user = SimpleNamespace(
        avatar_url="/media/avatars/user_7_ab12cd.png", avatar_thumb_url=None
    )
    assert notifications._push_icon(user) == "/media/avatars/user_7_ab12cd.png"


def test_push_icon_falls_back_to_app_icon() -> None:
    """Нет отправителя/аватара — иконка Pismo (и никаких пробелов в поле)."""
    default = notifications.PUSH_ICON_DEFAULT
    assert notifications._push_icon(None) == default
    for avatar_url in (None, "", "   "):
        user = SimpleNamespace(avatar_url=avatar_url, avatar_thumb_url=None)
        assert notifications._push_icon(user) == default


def test_rustore_message_carries_avatar_in_data() -> None:
    """Android-канал: аватар едет в data (картинку по URL тянет устройство).

    Сам блок notification не трогаем: уведомление рисует SDK RuStore, а `icon`
    в FCM-формате — это имя drawable-ресурса, а не ссылка.
    """
    message = notifications._rustore_message(
        title="Заголовок",
        body="Текст",
        channel_id=notifications.PUSH_CHANNEL_MESSAGES,
        data={
            "type": "message",
            "peer_id": 5,
            "peer_avatar": "/media/avatars/user_5_ff.png",
        },
    )
    assert message["notification"] == {"title": "Заголовок", "body": "Текст"}
    assert message["data"]["peer_avatar"] == "/media/avatars/user_5_ff.png"
    # Значения data приводятся к строкам (требование Push API), None — выкидывается.
    assert message["data"]["peer_id"] == "5"


def test_rustore_message_drops_empty_avatar() -> None:
    """Без аватара ключа в data быть не должно (лишний мусор в payload)."""
    message = notifications._rustore_message(
        title="t",
        body="b",
        channel_id=notifications.PUSH_CHANNEL_CALLS,
        data={"type": "call", "peer_avatar": None},
    )
    assert "peer_avatar" not in message["data"]


async def test_call_record_skips_message_push(monkeypatch: pytest.MonkeyPatch) -> None:
    """Запись о звонке не порождает push «Новое сообщение».

    Иначе после разговора (или после отмены звонка) участникам приходило
    уведомление о «новом сообщении» — хотя это системная отметка о звонке,
    и человек о нём уже знает.
    """
    from api_v1.events import service

    enqueued: list[tuple] = []

    async def _members(session: object, chat_id: int) -> list[int]:
        return [1, 2]

    async def _muted(session: object, chat_id: int) -> set[int]:
        return set()

    async def _broadcast(recipients: list[int], payload: dict) -> None:
        return None

    monkeypatch.setattr(service, "chat_member_ids", _members)
    monkeypatch.setattr(service, "muted_user_ids", _muted)
    monkeypatch.setattr(service.events_manager, "broadcast", _broadcast)
    monkeypatch.setattr(
        service, "_maybe_enqueue_message_push", lambda *args: enqueued.append(args)
    )

    payload = {"type": "message.new", "chat_id": 1, "message_id": 5, "sender_id": 1}

    # Отметка о звонке: события сокетам идут, push — нет.
    await service.notify_chat(object(), chat_id=1, payload=payload, push=False)
    assert enqueued == []

    # Обычное сообщение уведомляет как раньше (флаг ничего не сломал).
    await service.notify_chat(object(), chat_id=1, payload=payload)
    assert len(enqueued) == 1


def test_group_by_title_uses_personal_contact_name() -> None:
    """Заголовок уведомления — личное имя контакта у каждого получателя.

    Один общий push на всех не подходит: у кого отправитель записан как «Мама»,
    тот видит «Мама», остальные — обычное имя из профиля.
    """
    groups = notifications._group_by_title([1, 2, 3], {2: "Мама"}, "Иван Петров")
    assert groups == {"Иван Петров": [1, 3], "Мама": [2]}


def test_group_by_title_without_personal_names() -> None:
    """Нет личных имён — все получатели в одной группе (один запрос в RuStore)."""
    assert notifications._group_by_title([4, 5], {}, "Иван") == {"Иван": [4, 5]}
