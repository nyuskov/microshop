"""Фоновая задача берёт СВОЙ движок БД, а не общий движок web-процесса.

Две поломки, найденные по логам прода 23.09.2026 (обе видны только в воркере):

- ``tasks.call_tasks.prune_call_signals`` звал ``store.prune_expired_signals()``
  без сессии, а та работает через общий ``db_helper``. У фоновой задачи свой цикл
  событий на каждый запуск (``tasks/base.run_async``), поэтому соединения из пула
  общего движка оставались привязаны к ПРОШЛОМУ циклу: задача падала с
  ``InterfaceError: cannot perform operation: another operation is in progress``
  и ``RuntimeError: ... attached to a different loop`` (29 падений за сутки).
- ``tasks.story_tasks.delete_expired_stories`` считал результат
  ``make_session(engine)`` фабрикой и вызывал его:
  ``TypeError: 'AsyncSession' object is not callable`` — уборка просроченных
  историй не выполнялась ни разу.

Тесты запускают тела задач напрямую (без Celery и без БД): движок и сессия
подменяются заглушками, поэтому проверяется именно правило «свой движок на
задачу» и «сессия отдаётся готовой», а не SQL. Живой SQL этих задач проверяется
в ``test_call_signaling.py``/``test_stories_api.py``.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest


class _FakeEngine:
    """Движок-заглушка: важно только то, что задача его закрывает."""

    def __init__(self) -> None:
        self.disposed = False

    async def dispose(self) -> None:
        self.disposed = True


class _FakeSession:
    """Сессия-заглушка: считает запросы и коммиты, работает как контекст."""

    def __init__(self) -> None:
        self.executes = 0
        self.commits = 0
        self.closed = False

    async def __aenter__(self) -> "_FakeSession":
        return self

    async def __aexit__(self, *exc_info: object) -> bool:
        self.closed = True
        return False

    async def execute(self, *args: object, **kwargs: object) -> None:
        self.executes += 1

    async def commit(self) -> None:
        self.commits += 1


def test_story_task_uses_ready_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """``delete_expired_stories`` не вызывает сессию как функцию и закрывает движок."""
    from api_v1.stories import crud
    from tasks import story_tasks

    engine = _FakeEngine()
    session = _FakeSession()
    seen: list[object] = []

    async def fake_delete_expired(given: object) -> int:
        seen.append(given)
        return 3

    monkeypatch.setattr(story_tasks, "make_engine", lambda: engine)
    monkeypatch.setattr(story_tasks, "make_session", lambda _engine: session)
    monkeypatch.setattr(crud, "delete_expired", fake_delete_expired)

    assert story_tasks.delete_expired_stories() == {"removed": 3}
    assert seen == [session]
    assert session.commits == 1
    assert session.closed is True
    assert engine.disposed is True


def test_call_prune_task_passes_own_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """Задача чисток звонков отдаёт в store СВОЮ сессию, а не общий ``db_helper``."""
    from api_v1.calls import store
    from tasks import call_tasks

    engine = _FakeEngine()
    session = _FakeSession()
    seen: list[object] = []

    async def fake_prune(given: object = None) -> None:
        seen.append(given)

    monkeypatch.setattr(call_tasks, "make_engine", lambda: engine)
    monkeypatch.setattr(call_tasks, "make_session", lambda _engine: session)
    monkeypatch.setattr(store, "prune_expired_signals", fake_prune)

    assert call_tasks.prune_call_signals() == {"ok": True}
    assert seen == [
        session
    ], "в воркере общий движок нельзя: пул тянется из прошлого цикла"
    assert engine.disposed is True


def test_prune_without_session_keeps_shared_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Из web-процесса сессию не передают — работает общий ``db_helper``, как раньше."""
    from api_v1.calls import store

    session = _FakeSession()
    used: list[bool] = []

    def session_factory() -> _FakeSession:
        used.append(True)
        return session

    monkeypatch.setattr(
        store, "db_helper", SimpleNamespace(session_factory=session_factory)
    )

    asyncio.run(store.prune_expired_signals())

    assert used == [True]
    assert session.executes == 2, "обе таблицы чистим (парковки и очередь)"
    assert session.commits == 1
