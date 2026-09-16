"""Тесты «белого списка» сигнальных сообщений звонков.

Сервер — ретранслятор: он пропускает только типы из ``RELAY_MESSAGE_TYPES``.
Если новый тип клиента (например, пересогласование SDP для демонстрации экрана)
забыть добавить в набор, фронтенд молча перестанет получать сообщения — тест
фиксирует этот контракт.
"""

import time

import pytest

from api_v1.calls.views import RELAY_MESSAGE_TYPES, _track_call_event


def test_relay_whitelist_covers_call_flow() -> None:
    """Базовые шаги звонка + пересогласование/демонстрация экрана пересылаются."""
    required = {
        "call-offer",
        "call-answer",
        "ice-candidate",
        "call-cancel",
        "call-decline",
        "call-end",
    }
    assert required <= RELAY_MESSAGE_TYPES


def test_relay_whitelist_covers_screen_share() -> None:
    """Демонстрация экрана требует пересогласования SDP и статуса показа."""
    screen_share = {
        "call-renegotiate",
        "call-renegotiate-answer",
        "call-screen",
    }
    assert screen_share <= RELAY_MESSAGE_TYPES


def test_relay_whitelist_covers_call_rejoin() -> None:
    """Возврат в идущий звонок после перезагрузки страницы пересылается.

    Без этого звонок «слетал» бы при обновлении страницы: собеседник не узнал бы,
    что у второй стороны новое соединение и нужен новый SDP.
    """
    assert "call-rejoin" in RELAY_MESSAGE_TYPES


async def test_track_call_event_ignores_unknown_types() -> None:
    """Новые типы не должны ломать запись истории звонков (и не создавать её)."""
    # Пересогласование приходит с чужим/отсутствующим call_id — обработчик обязан
    # молча выйти, а не упасть.
    await _track_call_event("call-screen", 1, 2, {"sharing": True})
    await _track_call_event("call-renegotiate", 1, 2, {"call_id": "unknown"})
    await _track_call_event("call-renegotiate-answer", 1, 2, {"call_id": "unknown"})


async def test_call_push_skipped_when_call_already_over(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Push о звонке ставим только пока вызов «висит».

    Иначе человек получал уведомление «Вам звонят» о звонке, который уже
    отменён (зовущий передумал) или принят (абонент сам открыл приложение и
    забрал припаркованный offer).
    """
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    sent: list[tuple] = []

    class _FakeTask:
        def delay(self, *args: object) -> None:
            sent.append(args)

    monkeypatch.setattr(calls_views, "CALL_PUSH_DELAY_SECONDS", 0)
    # Задачу берём из очереди по имени — подменяем точку входа Celery.
    monkeypatch.setattr("core.celery_app.get_task", lambda name: _FakeTask())

    offer = {"type": "call-offer", "call_id": "call-1", "kind": "audio"}

    # 1. Вызов ждёт ответа — push ставим в очередь.
    await call_manager.park_offer(7, dict(offer))
    await calls_views._enqueue_call_push_when_ringing(
        callee_id=7, caller_id=5, offer=offer
    )
    assert len(sent) == 1
    assert sent[0][0] == 7
    assert sent[0][1] == "call-1"
    # Срок годности уезжает в задачу: поздно доставленный push не показываем.
    assert isinstance(sent[0][4], int)

    # 2. Зовущий отменил звонок — уведомление уже не нужно.
    await call_manager.discard_pending_offer(7, "call-1")
    await calls_views._enqueue_call_push_when_ringing(
        callee_id=7, caller_id=5, offer=offer
    )
    assert len(sent) == 1

    # 3. Абонент подключился и забрал offer — тоже не шлём.
    await call_manager.park_offer(7, dict(offer))
    await call_manager.take_pending_offer(7)
    await calls_views._enqueue_call_push_when_ringing(
        callee_id=7, caller_id=5, offer=offer
    )
    assert len(sent) == 1


async def test_has_pending_offer_filters_by_call_id() -> None:
    """Парковка проверяется по конкретному вызову (и не путает разные звонки)."""
    from api_v1.calls.manager import call_manager

    await call_manager.park_offer(9, {"call_id": "call-a"})
    assert await call_manager.has_pending_offer(9, "call-a") is True
    assert await call_manager.has_pending_offer(9, "call-b") is False
    assert await call_manager.has_pending_offer(9) is True
    await call_manager.discard_pending_offer(9, "call-a")


def test_call_push_expiry() -> None:
    """Просроченный push о звонке не отправляем вовсе."""
    from tasks import notifications

    now_ms = int(time.time() * 1000)
    assert notifications._call_push_expired(None) is False
    assert notifications._call_push_expired(now_ms + 5_000) is False
    assert notifications._call_push_expired(now_ms - 1) is True


class _FakeWebSocket:
    """Заглушка WebSocket: менеджеру нужны только accept/send_json/close."""

    def __init__(self, *, fail: bool = False) -> None:
        self.sent: list[dict[str, object]] = []
        self.closed = False
        #: Соединение «мёртвое»: отправка падает (телефон ушёл в сон и т.п.).
        self.fail = fail

    async def accept(self) -> None:
        return None

    async def send_json(self, payload: dict[str, object]) -> None:
        if self.fail:
            raise RuntimeError("соединение закрыто")
        self.sent.append(payload)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = True


def test_relay_whitelist_covers_media_state() -> None:
    """Состояние микрофона/камеры собеседника пересылается.

    Без этого выключенная камера выглядела бы как чёрный экран (и как поломка), а
    выключенный микрофон — как «нас не слышно».
    """
    assert "call-media-state" in RELAY_MESSAGE_TYPES


async def test_message_goes_to_all_user_devices() -> None:
    """Сообщение уходит на ВСЕ устройства человека: телефон, компьютер, второе окно."""
    from api_v1.calls.manager import call_manager

    phone = _FakeWebSocket()
    desktop = _FakeWebSocket()
    await call_manager.connect(1701, phone)
    await call_manager.connect(1701, desktop)
    try:
        delivered = await call_manager.send_to_user(1701, {"type": "call-offer"})

        assert delivered is True
        assert [item["type"] for item in phone.sent] == ["call-offer"]
        assert [item["type"] for item in desktop.sent] == ["call-offer"]
        assert call_manager.is_online(1701) is True
    finally:
        await call_manager.disconnect(1701, phone)
        await call_manager.disconnect(1701, desktop)


async def test_dead_device_is_forgotten() -> None:
    """Мёртвое соединение выкидываем, чтобы оно не «съедало» доставку.

    Иначе звонок считался бы доставленным устройству, которое спит, и не был бы
    припаркован (то есть человек вообще не узнал бы о вызове).
    """
    from api_v1.calls.manager import call_manager

    sleeping = _FakeWebSocket(fail=True)
    alive = _FakeWebSocket()
    await call_manager.connect(1703, sleeping)
    await call_manager.connect(1703, alive)
    try:
        assert await call_manager.send_to_user(1703, {"type": "call-offer"}) is True
        assert [item["type"] for item in alive.sent] == ["call-offer"]

        # Осталось только живое устройство: мёртвое выброшено при отправке.
        sleeping.fail = True
        assert await call_manager.send_to_user(1703, {"type": "ice-candidate"}) is True

        # А если живо только спящее — пользователь считается офлайн.
        await call_manager.disconnect(1703, alive)
        assert await call_manager.send_to_user(1703, {"type": "call-end"}) is False
    finally:
        await call_manager.disconnect(1703, sleeping)
        await call_manager.disconnect(1703, alive)


async def test_answer_on_one_device_silences_others() -> None:
    """Ответили на телефоне — на компьютере в этот же момент звонок замолкает.

    Звонок звонит на все устройства сразу, поэтому остальные надо остановить: иначе
    человек слышит звонок на втором устройстве, пока уже разговаривает.
    """
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    caller = _FakeWebSocket()
    phone = _FakeWebSocket()
    desktop = _FakeWebSocket()
    await call_manager.connect(1705, caller)
    await call_manager.connect(1706, phone)
    await call_manager.connect(1706, desktop)
    try:
        await calls_views._handle_message(
            1705,
            {
                "type": "call-offer",
                "to_user_id": 1706,
                "call_id": "call-multi",
                "kind": "audio",
                "sdp": "offer-sdp",
            },
            caller,
        )
        assert [item["type"] for item in phone.sent] == ["call-offer"]
        assert [item["type"] for item in desktop.sent] == ["call-offer"]

        # Ответил телефон.
        await calls_views._handle_message(
            1706,
            {
                "type": "call-answer",
                "to_user_id": 1705,
                "call_id": "call-multi",
                "sdp": "answer-sdp",
            },
            phone,
        )

        assert caller.sent[-1]["type"] == "call-answer"
        assert [item["type"] for item in desktop.sent] == [
            "call-offer",
            "call-ended-elsewhere",
        ]
        assert desktop.sent[-1]["reason"] == "answered"
        # Телефон, где ответили, такое сообщение не получает — он уже в разговоре.
        assert [item["type"] for item in phone.sent] == ["call-offer"]
    finally:
        await call_manager.disconnect(1705, caller)
        await call_manager.disconnect(1706, phone)
        await call_manager.disconnect(1706, desktop)


async def test_relay_queues_answer_while_caller_offline() -> None:
    """Ответ на звонок не теряется, если у зовущего на секунду отвалился канал.

    Иначе у зовущего звонок продолжает звонить, хотя собеседник уже нажал
    «Ответить» (а отвечающий считает звонок идущим — он своё состояние обновил).
    """
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    # Зовущий (1101) не подключён, отвечающий (1102) шлёт ответ.
    await calls_views._relay_message(
        1102,
        {
            "type": "call-answer",
            "to_user_id": 1101,
            "call_id": "call-queued",
            "sdp": "v=0",
        },
    )

    queued = await call_manager.take_queued_messages(1101)
    assert len(queued) == 1
    assert queued[0]["type"] == "call-answer"
    assert queued[0]["from_user_id"] == 1102
    assert queued[0]["call_id"] == "call-queued"
    # Служебный срок годности клиенту не отдаём.
    assert "_expires_at" not in queued[0]
    # Повторно то же сообщение не «всплывает».
    assert await call_manager.take_queued_messages(1101) == []


async def test_relay_queues_ice_candidates() -> None:
    """ICE-кандидаты тоже придерживаются: без них медиа не поднимется."""
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    await calls_views._relay_message(
        1104,
        {
            "type": "ice-candidate",
            "to_user_id": 1103,
            "call_id": "call-ice",
            "candidate": {"candidate": "candidate:1"},
        },
    )

    queued = await call_manager.take_queued_messages(1103)
    assert [item["type"] for item in queued] == ["ice-candidate"]


async def test_queued_signaling_is_delivered_on_connect() -> None:
    """Абонент вернулся в сеть — придержанный сигналинг уходит ему сразу."""
    from api_v1.calls.manager import call_manager

    await call_manager.queue_message(
        1105, {"type": "call-answer", "call_id": "c-1", "to_user_id": 1105}
    )
    socket = _FakeWebSocket()
    await call_manager.connect(1105, socket)
    try:
        assert [item["type"] for item in socket.sent] == ["call-answer"]
        assert "_expires_at" not in socket.sent[0]
    finally:
        await call_manager.disconnect(1105, socket)


async def test_expired_queued_signaling_is_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Протухшее сообщение не доставляем: звонок давно кончился."""
    from api_v1.calls import manager as calls_manager

    monkeypatch.setattr(calls_manager, "QUEUED_MESSAGE_TTL_SECONDS", -1.0)
    await calls_manager.call_manager.queue_message(1107, {"type": "call-answer"})

    assert await calls_manager.call_manager.take_queued_messages(1107) == []


async def test_queued_signaling_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    """Очередь ограничена: «мёртвый» сокет не должен копить сообщения бесконечно."""
    from api_v1.calls import manager as calls_manager

    monkeypatch.setattr(calls_manager, "MAX_QUEUED_MESSAGES", 3)
    for index in range(5):
        await calls_manager.call_manager.queue_message(
            1109, {"type": "ice-candidate", "index": index}
        )

    queued = await calls_manager.call_manager.take_queued_messages(1109)
    assert [item["index"] for item in queued] == [2, 3, 4]


async def test_closed_app_can_be_called_and_answers_later(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Полный путь «звонок в закрытое приложение».

    Зовущий звонит офлайн-абоненту: offer ждёт в парковке, а зовущему объясняют,
    что уведомления не будет. Абонент открывает приложение — offer приходит к нему,
    и его ответ доходит до зовущего.
    """
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    caller_ws = _FakeWebSocket()
    callee_ws = _FakeWebSocket()
    await call_manager.connect(1401, caller_ws)
    # У абонента нет push-каналов — уведомление отправить некому.
    monkeypatch.setattr(calls_views, "_any_push_channel_configured", lambda: False)
    try:
        await calls_views._handle_message(
            1401,
            {
                "type": "call-offer",
                "to_user_id": 1402,
                "call_id": "call-cold",
                "kind": "audio",
                "sdp": "offer-sdp",
            },
        )
        assert caller_ws.sent[-1]["type"] == "call-parked"
        assert caller_ws.sent[-1]["notified"] is False

        # Собеседник открыл приложение: соединение поднялось, и вызов пришёл.
        await call_manager.connect(1402, callee_ws)
        assert callee_ws.sent[0]["type"] == "call-offer"
        assert callee_ws.sent[0]["call_id"] == "call-cold"

        # Он отвечает — ответ доходит до зовущего.
        await calls_views._handle_message(
            1402,
            {
                "type": "call-answer",
                "to_user_id": 1401,
                "call_id": "call-cold",
                "sdp": "answer-sdp",
            },
        )
        assert caller_ws.sent[-1]["type"] == "call-answer"
        assert caller_ws.sent[-1]["sdp"] == "answer-sdp"
    finally:
        await call_manager.disconnect(1401, caller_ws)
        await call_manager.disconnect(1402, callee_ws)
        await call_manager.discard_pending_offer(1402, "call-cold")


async def test_blocked_pair_cannot_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """Заблокированный не дозвонится: вызов не паркуем и push не шлём.

    Зовущему отвечаем как при недоступности — о самом факте блокировки не сообщаем,
    иначе блокировка превращалась бы в способ сообщить о себе.

    Проверяем именно ``is_call_blocked_between``: он учитывает оба вида блокировки
    — и полную, и мягкую («только звонки»), — тогда как `is_blocked_between`
    отвечает только за запрет переписки.
    """
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    sent: list[tuple] = []
    parked: list[tuple] = []
    spawned: list[object] = []

    async def _blocked(session: object, *, user_id: int, other_id: int) -> bool:
        return True

    async def _fake_send(user_id: int, payload: dict) -> bool:
        sent.append((user_id, payload))
        return True

    async def _fake_park(
        callee_id: int, offer: dict, ttl_seconds: float = 75.0
    ) -> None:
        parked.append((callee_id, offer))

    monkeypatch.setattr(
        calls_views.moderation_crud, "is_call_blocked_between", _blocked
    )
    monkeypatch.setattr(calls_views, "_any_push_channel_configured", lambda: True)
    monkeypatch.setattr(calls_views, "_spawn", spawned.append)
    monkeypatch.setattr(call_manager, "park_offer", _fake_park)
    monkeypatch.setattr(call_manager, "send_to_user", _fake_send)

    # Вызов от заблокированного: не паркуем, уведомление не ставим.
    await calls_views._handle_message(
        1501,
        {
            "type": "call-offer",
            "to_user_id": 1502,
            "call_id": "call-blocked",
            "kind": "audio",
            "sdp": "offer-sdp",
        },
    )
    assert parked == []
    assert spawned == []
    assert [payload["type"] for _, payload in sent] == ["call-unavailable"]
    assert sent[0][0] == 1501

    # Ответ/отбой по такому вызову тоже не пересылаем (память не тратим).
    sent.clear()
    await calls_views._handle_message(
        1501,
        {"type": "call-answer", "to_user_id": 1502, "call_id": "call-blocked"},
    )
    assert sent == []


def test_parked_offer_outlives_caller_ring() -> None:
    """Парковка вызова живёт не меньше, чем зовущий ждёт ответа (60 с).

    Push, холодный старт и вход в аккаунт занимают время: если парковка истечёт
    раньше, человек откроет приложение и не увидит звонка, который всё ещё звонит
    у зовущего.
    """
    import inspect

    from api_v1.calls.manager import call_manager

    default_ttl = (
        inspect.signature(call_manager.park_offer).parameters["ttl_seconds"].default
    )
    assert default_ttl >= 60.0


async def test_offline_call_is_parked_without_push_channels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Вызов паркуем и без push-канала: уведомления выключены — звонок всё равно ждёт.

    Раньше зовущий сразу получал ``call-unavailable`` и позвонить человеку с
    выключенными уведомлениями было нельзя. Теперь вызов остаётся в парковке и
    доставится, как только абонент откроет приложение (в течение срока парковки).
    """
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    parked: list[tuple] = []
    sent: list[tuple] = []
    spawned: list[object] = []

    async def _fake_park(
        callee_id: int, offer: dict, ttl_seconds: float = 75.0
    ) -> None:
        parked.append((callee_id, offer, ttl_seconds))

    async def _fake_send(user_id: int, payload: dict) -> bool:
        sent.append((user_id, payload))
        # Абонент (1202) офлайн: доставка не удалась — вызов уходит в парковку.
        return user_id == 1201

    # Push-каналов нет (нет VAPID/сервисного токена) — уведомление не отправить.
    monkeypatch.setattr(calls_views, "_any_push_channel_configured", lambda: False)
    monkeypatch.setattr(calls_views, "_spawn", spawned.append)
    monkeypatch.setattr(call_manager, "park_offer", _fake_park)
    monkeypatch.setattr(call_manager, "send_to_user", _fake_send)

    await calls_views._relay_message(
        1201,
        {
            "type": "call-offer",
            "to_user_id": 1202,
            "call_id": "call-offline",
            "kind": "audio",
            "sdp": "v=0",
        },
    )

    assert [item[0] for item in parked] == [1202]
    # Зовущему объясняем, что звонок ждёт собеседника, но уведомление не ушло.
    caller_messages = [payload for user_id, payload in sent if user_id == 1201]
    assert [item["type"] for item in caller_messages] == ["call-parked"]
    assert caller_messages[0]["notified"] is False
    # Ни «недоступен», ни задача push без канала не нужны.
    assert all(item["type"] != "call-unavailable" for _, item in sent)
    assert spawned == []


async def test_offline_call_with_push_subscription_is_notified(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Есть подписка — вызов паркуем и ставим push «Вам звонят…»."""
    from api_v1.calls import views as calls_views
    from api_v1.calls.manager import call_manager

    parked: list[tuple] = []
    sent: list[tuple] = []
    spawned: list[object] = []

    async def _fake_park(
        callee_id: int, offer: dict, ttl_seconds: float = 75.0
    ) -> None:
        parked.append((callee_id, offer, ttl_seconds))

    async def _fake_send(user_id: int, payload: dict) -> bool:
        sent.append((user_id, payload))
        # Абонент (1204) офлайн — вызов уходит в парковку.
        return user_id == 1203

    async def _fake_subs(session: object, user_ids: list[int]) -> list[object]:
        return [object()]  # подписка Web Push есть

    async def _no_tokens(session: object, user_ids: list[int]) -> list[object]:
        return []

    monkeypatch.setattr(calls_views, "_any_push_channel_configured", lambda: True)
    monkeypatch.setattr(calls_views, "_spawn", spawned.append)
    monkeypatch.setattr(
        calls_views.push_crud, "get_subscriptions_for_users", _fake_subs
    )
    monkeypatch.setattr(
        calls_views.push_crud, "get_rustore_tokens_for_users", _no_tokens
    )
    monkeypatch.setattr(call_manager, "park_offer", _fake_park)
    monkeypatch.setattr(call_manager, "send_to_user", _fake_send)

    await calls_views._relay_message(
        1203,
        {
            "type": "call-offer",
            "to_user_id": 1204,
            "call_id": "call-notify",
            "kind": "video",
            "sdp": "v=0",
        },
    )

    assert [item[0] for item in parked] == [1204]
    caller_messages = [payload for user_id, payload in sent if user_id == 1203]
    assert caller_messages[0]["notified"] is True
    # Уведомление ставится фоновой задачей (проверка «звонок ещё висит» + push).
    assert len(spawned) == 1
    # Саму задачу не запускаем (внутри пауза и Celery) — закрываем корутину.
    close = getattr(spawned[0], "close", None)
    if callable(close):
        close()


async def test_call_over_is_queued_for_offline_peer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """«Звонок закончился» придерживается для абонента без канала.

    Канал у абонента мог отвалиться прямо во время вызова (телефон в фоне):
    тогда он продолжает «звонить» — со звуком и окном вызова — и узнаёт о
    завершении только по своему таймауту, а если вкладку заморозили, то и
    никогда. Придержанное сообщение доставится при подключении, и приложение
    сразу погасит вызов.
    """
    from api_v1.calls import views as calls_views

    queued: list[tuple[int, dict]] = []
    discarded: list[tuple[int, str | None]] = []

    async def fake_queue(
        user_id: int, payload: dict, ttl_seconds: float | None = None
    ) -> None:
        queued.append((user_id, payload, ttl_seconds))

    async def fake_discard(callee_id: int, call_id: str | None) -> None:
        discarded.append((callee_id, call_id))

    async def fake_send_to_user(user_id: int, payload: dict) -> bool:
        return False  # абонент офлайн

    monkeypatch.setattr(calls_views, "_is_call_blocked", _never_blocked)
    monkeypatch.setattr(calls_views, "_track_call_event", _noop)
    monkeypatch.setattr(calls_views.call_manager, "send_to_user", fake_send_to_user)
    monkeypatch.setattr(calls_views.call_manager, "queue_message", fake_queue)
    monkeypatch.setattr(calls_views.call_manager, "discard_pending_offer", fake_discard)
    monkeypatch.setattr(calls_views, "_notify_call_finished", lambda *a, **kw: None)

    await calls_views._relay_message(
        1501, {"type": "call-cancel", "to_user_id": 1502, "call_id": "call-gone"}
    )

    assert discarded == [(1502, "call-gone")]
    assert len(queued) == 1
    user_id, payload, ttl = queued[0]
    assert user_id == 1502
    assert payload["type"] == "call-cancel"
    assert payload["call_id"] == "call-gone"
    # Срок жизни с запасом: человек может открыть приложение через пару минут,
    # и до этого момента он не должен «звонить».
    assert ttl is not None and ttl >= 300


async def _never_blocked(*args: object, **kwargs: object) -> bool:
    return False


async def _noop(*args: object, **kwargs: object) -> None:
    return None
