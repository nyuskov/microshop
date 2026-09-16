"""Юнит-тесты формирования push-уведомлений (без сети и БД).

Проверяем то, что видит получатель: крупная иконка уведомления должна быть
аватаром отправителя, а если аватара нет — иконкой приложения (не пустой
ссылкой, иначе уведомление остаётся вообще без иконки).
"""

import json
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


def test_hidden_preview_replaces_text_with_neutral_body() -> None:
    """«Показывать текст сообщения» выключено — тело становится нейтральным.

    Имя отправителя в заголовке остаётся: иначе непонятно, открывать ли чат.
    """
    hidden = SimpleNamespace(notification_preview=False)
    shown = SimpleNamespace(notification_preview=True)
    assert (
        notifications._body_for_user("секрет", hidden) == notifications.PUSH_HIDDEN_BODY
    )
    assert notifications._body_for_user("привет", shown) == "привет"
    # Профиля нет (старый аккаунт) — ведём себя как раньше, показываем текст.
    assert notifications._body_for_user("привет", None) == "привет"


def test_group_by_push_uses_personal_contact_name() -> None:
    """Заголовок уведомления — личное имя контакта у каждого получателя.

    Один общий push на всех не подходит: у кого отправитель записан как «Мама»,
    тот видит «Мама», остальные — обычное имя из профиля.
    """
    groups = notifications._group_by_push(
        [1, 2, 3],
        {2: "Мама"},
        {},
        "Иван Петров",
        "Привет",
    )
    assert groups == {("Иван Петров", "Привет"): [1, 3], ("Мама", "Привет"): [2]}


def test_group_by_push_splits_hidden_preview() -> None:
    """Кто скрыл текст сообщения — уходит отдельной группой с нейтральным телом.

    Иначе одному и тому же push с текстом ушли бы оба: и тот, кто превью
    выключил, — то есть настройка бы не работала.
    """
    groups = notifications._group_by_push(
        [1, 2, 3],
        {},
        {2: notifications.PUSH_HIDDEN_BODY},
        "Иван Петров",
        "секретный текст",
    )
    assert groups == {
        ("Иван Петров", "секретный текст"): [1, 3],
        ("Иван Петров", notifications.PUSH_HIDDEN_BODY): [2],
    }


def test_group_by_push_without_personal_names() -> None:
    """Нет личных имён и разные настройки превью — все в одной группе."""
    assert notifications._group_by_push([4, 5], {}, {}, "Иван", "текст") == {
        ("Иван", "текст"): [4, 5]
    }


async def test_call_cancelled_push_carries_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Тихий push о завершении звонка несёт причину.

    По ней приложение решает, гасить ли у себя «звонит»: канал мог отвалиться, и
    тогда экран звонил бы вечно, хотя вызов уже приняли/отклонили/сняли.
    """
    captured: dict[str, object] = {}

    class FakeSession:
        async def execute(self, _statement: object) -> object:
            subscription = SimpleNamespace(
                id=1, endpoint="https://push.example/1", p256dh="k", auth="a"
            )
            return SimpleNamespace(
                scalars=lambda: SimpleNamespace(all=lambda: [subscription])
            )

        async def close(self) -> None:
            return None

    class FakeEngine:
        async def dispose(self) -> None:
            return None

    async def fake_send(
        session: object,
        subscriptions: object,
        payload: str,
        ttl: object,
        headers: object,
    ) -> None:
        captured["payload"] = payload
        captured["ttl"] = ttl

    monkeypatch.setattr(notifications, "make_engine", lambda: FakeEngine())
    monkeypatch.setattr(notifications, "make_session", lambda _engine: FakeSession())
    monkeypatch.setattr(notifications, "_web_push_to_subscriptions", fake_send)
    monkeypatch.setattr(
        notifications, "_web_push_configured", lambda: True, raising=False
    )

    await notifications._send_call_cancelled_async(7, "call-1", "declined")

    payload = json.loads(str(captured["payload"]))
    assert payload["data"] == {
        "type": "call-cancelled",
        "call_id": "call-1",
        "reason": "declined",
    }
    # Ни заголовка, ни текста: уведомление не показываем, только закрываем.
    assert "title" not in payload
    assert "body" not in payload
