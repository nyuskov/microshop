"""БД-тесты блокировок: полная и мягкая («только звонки»).

Повод: блокировка была одна на все случаи — сообщения и звонки запрещены, чат
скрыт. Часто нужно мягче: «не звони мне, но писать можно». Правила разошлись по
применению, и их легко перепутать:

* сообщения и скрытие чата — только ПОЛНАЯ блокировка;
* звонки — любая (в мягкой как раз и просили не звонить).

Тесты проверяют именно это расхождение: если однажды «мягкая» блокировка начнёт
прятать чат или запрещать переписку, здесь будет видно.
"""

from api_v1.moderation import crud
from core.models import User


async def _make_user(session, username: str) -> User:
    user = User(
        username=username,
        phone_number=None,
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def test_full_block_hides_chat_and_blocks_messages(session) -> None:
    """Полная блокировка: сообщения запрещены, человек попадает в «скрытые»."""
    u1 = await _make_user(session, "blk_full_1")
    u2 = await _make_user(session, "blk_full_2")

    await crud.block_user(session, blocker_id=u1.id, blocked_id=u2.id)

    assert await crud.is_blocked_between(session, user_id=u1.id, other_id=u2.id)
    assert await crud.is_blocked_between(session, user_id=u2.id, other_id=u1.id)
    assert u2.id in await crud.get_blocked_ids(session, blocker_id=u1.id)
    # Звонок тоже запрещён: любая блокировка запрещает звонки.
    assert await crud.is_call_blocked_between(session, user_id=u1.id, other_id=u2.id)


async def test_soft_block_keeps_messages_and_blocks_calls(session) -> None:
    """Мягкая блокировка («только звонки»): переписка идёт, звонка нет."""
    u1 = await _make_user(session, "blk_soft_1")
    u2 = await _make_user(session, "blk_soft_2")

    await crud.block_user(
        session, blocker_id=u1.id, blocked_id=u2.id, messages_allowed=True
    )

    # Сообщения не запрещены ни в одну сторону.
    assert not await crud.is_blocked_between(session, user_id=u1.id, other_id=u2.id)
    assert not await crud.is_blocked_between(session, user_id=u2.id, other_id=u1.id)
    # Чат не считается скрытым (в список «скрытых» не попадает).
    assert u2.id not in await crud.get_blocked_ids(session, blocker_id=u1.id)
    # А звонок — запрещён.
    assert await crud.is_call_blocked_between(session, user_id=u1.id, other_id=u2.id)
    assert await crud.is_call_blocked_between(session, user_id=u2.id, other_id=u1.id)


async def test_block_user_switches_kind_instead_of_duplicating(session) -> None:
    """Повторная блокировка меняет вид, а не создаёт вторую запись."""
    u1 = await _make_user(session, "blk_switch_1")
    u2 = await _make_user(session, "blk_switch_2")

    await crud.block_user(session, blocker_id=u1.id, blocked_id=u2.id)
    await crud.block_user(
        session, blocker_id=u1.id, blocked_id=u2.id, messages_allowed=True
    )

    rows = await crud.get_blocked_users(session, blocker_id=u1.id)
    assert [(user.id, allowed) for user, allowed in rows] == [(u2.id, True)]
    assert await crud.get_block_messages_allowed(
        session, blocker_id=u1.id, blocked_id=u2.id
    )


async def test_soft_block_is_ignored_by_other_direction(session) -> None:
    """Мягкая блокировка не мешает собеседнику писать и звонить не запрещает ему."""
    u1 = await _make_user(session, "blk_dir_1")
    u2 = await _make_user(session, "blk_dir_2")

    # u2 запретил звонки u1 (мягкая блокировка), но переписка нужна обоим.
    await crud.block_user(
        session, blocker_id=u2.id, blocked_id=u1.id, messages_allowed=True
    )

    assert not await crud.is_blocked_between(session, user_id=u1.id, other_id=u2.id)
    assert await crud.is_call_blocked_between(session, user_id=u1.id, other_id=u2.id)
    # Для u1 это ЧУЖАЯ блокировка: своего состояния у него нет.
    assert (
        await crud.get_block_messages_allowed(
            session, blocker_id=u1.id, blocked_id=u2.id
        )
        is None
    )


async def test_unblock_removes_soft_block(session) -> None:
    """Снятие блокировки убирает и мягкую: звонки и переписка возвращаются."""
    u1 = await _make_user(session, "blk_rm_1")
    u2 = await _make_user(session, "blk_rm_2")

    await crud.block_user(
        session, blocker_id=u1.id, blocked_id=u2.id, messages_allowed=True
    )
    await crud.unblock_user(session, blocker_id=u1.id, blocked_id=u2.id)

    assert not await crud.is_call_blocked_between(
        session, user_id=u1.id, other_id=u2.id
    )
    assert await crud.get_blocked_users(session, blocker_id=u1.id) == []
    assert (
        await crud.get_block_messages_allowed(
            session, blocker_id=u1.id, blocked_id=u2.id
        )
        is None
    )


async def test_block_list_returns_kind(session) -> None:
    """В списке заблокированных видно, какого вида блокировка у каждого."""
    u1 = await _make_user(session, "blk_list_1")
    u2 = await _make_user(session, "blk_list_2")
    u3 = await _make_user(session, "blk_list_3")

    await crud.block_user(session, blocker_id=u1.id, blocked_id=u2.id)
    await crud.block_user(
        session, blocker_id=u1.id, blocked_id=u3.id, messages_allowed=True
    )

    rows = {
        user.id: allowed
        for user, allowed in await crud.get_blocked_users(session, blocker_id=u1.id)
    }
    assert rows == {u2.id: False, u3.id: True}
