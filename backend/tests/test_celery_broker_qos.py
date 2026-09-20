"""QoS у брокера: воркер НЕ просит global QoS (в RabbitMQ 4.x это deprecated).

Зачем тест: в RabbitMQ 4.x ``global_qos`` запрещён по умолчанию — на каждом
подключении воркера брокер пишет в лог ошибку про deprecated-фичу, а сама фича
«будет удалена в будущей мажорной версии независимо от конфигурации». Кто просит
глобальный QoS: Celery решает это по признаку
``kombu.Connection.qos_semantics_matches_spec``, а для RabbitMQ >= 3.3 kombu
отдаёт False → ``a_global=True``. ``core/celery_app.py`` переопределяет признак
на True (per-consumer prefetch, как рекомендует RabbitMQ) — тест стережёт, что
шим на месте: без него проверки ниже падают (для версии 4.x признак снова False).
"""

from __future__ import annotations

from celery.worker.consumer.tasks import Tasks  # type: ignore[import-untyped]
from kombu.transport import pyamqp  # type: ignore[import-untyped]

import core.celery_app  # noqa: F401 — импорт применяет шим QoS к транспорту kombu


class _ServerProps(dict):
    """Свойства сервера, как их видит kombu у RabbitMQ: product + version."""

    def __init__(self, version: str) -> None:
        super().__init__(product="RabbitMQ", version=version)


class _Connection:
    """Подключение-заглушка: признак берём у (пропатченного) транспорта kombu."""

    server_properties = _ServerProps("4.3.6")

    @property
    def qos_semantics_matches_spec(self) -> bool:
        """Ровно то, что читает Celery у подключения kombu."""
        check = pyamqp.Transport.qos_semantics_matches_spec
        return check(None, self)


class _FakeConf:
    """Настройки без автоопределения quorum-очередей (брокера в тесте нет)."""

    worker_detect_quorum_queues = False


class _FakeApp:
    conf = _FakeConf()


class _FakeConsumer:
    """Минимум, который читает ``Tasks.qos_global``: app.conf и connection."""

    app = _FakeApp()
    connection = _Connection()


def test_transport_reports_matching_qos_semantics() -> None:
    """Признак True у RabbitMQ 4.x: kombu больше не считает семантику «чужой»."""
    check = pyamqp.Transport.qos_semantics_matches_spec
    assert check(None, _Connection()) is True


def test_celery_asks_for_consumer_level_prefetch() -> None:
    """Та же формула, что в Celery: ``not признак`` — значит, не глобальный QoS."""
    assert Tasks.qos_global(None, _FakeConsumer()) is False  # type: ignore[arg-type]
