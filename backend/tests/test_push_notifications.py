"""Юнит-тесты формирования push-уведомлений (без сети и БД).

Проверяем то, что видит получатель: крупная иконка уведомления должна быть
аватаром отправителя, а если аватара нет — иконкой приложения (не пустой
ссылкой, иначе уведомление остаётся вообще без иконки).
"""

from types import SimpleNamespace

from tasks import notifications


def test_push_icon_uses_sender_avatar() -> None:
    """Есть аватар — показываем его вместо иконки приложения."""
    user = SimpleNamespace(avatar_url="/media/avatars/user_7_ab12cd.png")
    assert notifications._push_icon(user) == "/media/avatars/user_7_ab12cd.png"


def test_push_icon_falls_back_to_app_icon() -> None:
    """Нет отправителя/аватара — иконка Pismo (и никаких пробелов в поле)."""
    default = notifications.PUSH_ICON_DEFAULT
    assert notifications._push_icon(None) == default
    assert notifications._push_icon(SimpleNamespace(avatar_url=None)) == default
    assert notifications._push_icon(SimpleNamespace(avatar_url="")) == default
    assert notifications._push_icon(SimpleNamespace(avatar_url="   ")) == default


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
