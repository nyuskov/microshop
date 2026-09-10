"""Квоты на медиа: сколько файлов пользователь держит на сервере.

Зачем: размер одного файла был ограничен (15 МБ) и частота загрузок тоже, а
накопление — нет. Один пользователь мог залить десятки гигабайт (скриптом или
просто активно пользуясь кружками) и забить диск прод-сервера. Диск в мониторинге
виден, но узнавать о проблеме по письму «мало места» поздновато — поэтому квота.

Что считаем: файлы, которые пользователь **сам загрузил** (сообщения с файлом и
без ``forwarded_from_id``). Пересланные сообщения переиспользуют тот же файл на
диске (`file_url` копируется), поэтому за них никто второй раз не платит — иначе
одно и то же вложение «весило» бы у всех, кто его переслал.

Что НЕ считаем: аватар — он один на аккаунт и ограничен 8 МБ, то есть в худшем
случае 1.6% квоты 500 МБ. Медиа звонков на сервер не попадает вовсе (WebRTC).

Освобождение места автоматическое: квота считается по БД, поэтому удаление
сообщения сразу уменьшает занятое. Файлы, на которые не осталось ссылок, убирает
ночная задача ``tasks.media_tasks.cleanup_orphan_media``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.models import Message

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MediaUsage:
    """Сколько занято и сколько разрешено (в байтах и файлах)."""

    used_bytes: int
    quota_bytes: int
    files: int

    @property
    def free_bytes(self) -> int:
        """Сколько ещё можно загрузить."""
        return max(0, self.quota_bytes - self.used_bytes)

    @property
    def percent(self) -> int:
        """Занято в процентах (0..100) — для индикатора в профиле."""
        if self.quota_bytes <= 0:
            return 0
        return min(100, round(self.used_bytes * 100 / self.quota_bytes))


def human_size(num_bytes: int) -> str:
    """Человекочитаемый размер: 1536 → «1.5 КБ» (для текстов сообщений)."""
    value = float(max(0, num_bytes))
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if value < 1024 or unit == "ГБ":
            if unit == "Б":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} ГБ"


async def media_usage(session: AsyncSession, *, user_id: int) -> MediaUsage:
    """Считает занятое пользователем место и число его файлов."""
    stmt = select(
        func.coalesce(func.sum(Message.file_size), 0), func.count(Message.id)
    ).where(
        Message.user_id == user_id,
        Message.file_url.is_not(None),
        Message.forwarded_from_id.is_(None),
    )
    total_bytes, files = (await session.execute(stmt)).one()
    return MediaUsage(
        used_bytes=int(total_bytes or 0),
        quota_bytes=settings.media_quota_bytes,
        files=int(files or 0),
    )


async def enforce_media_quota(
    session: AsyncSession, *, user_id: int, incoming_bytes: int
) -> None:
    """Не даёт загрузить файл, если он не влезает в квоту (иначе 413).

    Проверяем ДО записи файла на диск: иначе мусор пришлось бы убирать ночной
    задачей. Сообщение в ошибке — с конкретными цифрами, чтобы человек понимал,
    что делать (удалить старые файлы или ждать).
    """
    quota = settings.media_quota_bytes
    if quota <= 0:
        return
    usage = await media_usage(session, user_id=user_id)
    if usage.used_bytes + incoming_bytes <= quota:
        return

    logger.info(
        "Квота медиа: пользователю %s отказано (занято %s из %s, файл %s)",
        user_id,
        human_size(usage.used_bytes),
        human_size(quota),
        human_size(incoming_bytes),
    )
    raise HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=(
            f"Хранилище заполнено: занято {human_size(usage.used_bytes)} "
            f"из {human_size(quota)}. Удалите старые файлы, чтобы загрузить новые."
        ),
    )


__all__ = ["MediaUsage", "enforce_media_quota", "human_size", "media_usage"]
