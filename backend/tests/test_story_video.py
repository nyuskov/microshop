"""Истории с видео: проверка кодека и перекодирование (``core/video_transcode.py``).

Повод: автор загрузил ролик из телефона (MPEG-4 Visual ``mp4v`` + звук AMR в
3GP-контейнере), открыл свою историю и увидел чёрный экран — Chromium такие
дорожки не декодирует вовсе (``DEMUXER_ERROR_NO_SUPPORTED_STREAMS``), а Safari
иногда играет, поэтому «у одного работает, у другого нет».

Здесь проверяем обе стороны: решение «проиграет ли браузер» (юнит-тесты, идут
всегда) и реальное перекодирование (пропускается, если ffmpeg нет в окружении —
в образе бэкенда он есть, см. ``backend/Dockerfile``).
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi import HTTPException

from core import video_transcode
from core.video_transcode import UNSUPPORTED_VIDEO_DETAIL, VideoInfo, prepare_video

MP4_FORMAT = "mov,mp4,m4a,3gp,3g2,mj2"

#: Без ffmpeg проверять нечего — сам факт его отсутствия проверяет отдельный тест.
needs_ffmpeg = pytest.mark.skipif(
    not video_transcode.is_available(),
    reason="в окружении нет ffmpeg/ffprobe",
)

#: Без БД запускаем только юнит-тесты (они работают с файлами в tmp).
needs_db = pytest.mark.skipif(
    os.getenv("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL не задан (нужен PostgreSQL для API-тестов)",
)


def _make_media(args: list[str], *, name: str = "out.mp4") -> bytes:
    """Готовит медиафайл через ffmpeg и возвращает его байты."""
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / name
        completed = subprocess.run(
            ["ffmpeg", "-nostdin", "-y", *args, str(target)],
            capture_output=True,
            check=False,
        )
        assert completed.returncode == 0, completed.stderr.decode(errors="replace")
        return target.read_bytes()


def _legacy_video() -> bytes:
    """Видео в том самом формате из жалобы: mp4v + AAC в mp4-контейнере.

    Звук кодируем AAC: AMR-кодировщика в обычных сборках ffmpeg нет, а на
    решение о перекодировании влияет уже видеокодек.
    """
    return _make_media(
        [
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=64x64:rate=10:duration=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
        ]
    )


def _modern_video() -> bytes:
    """Обычный ролик, который браузер играет сам (H.264 + AAC)."""
    return _make_media(
        [
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=64x64:rate=10:duration=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-shortest",
        ]
    )


def _audio_only() -> bytes:
    """Только звук (m4a): расширение из белого списка медиа, но не история."""
    return _make_media(
        ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac"],
        name="out.m4a",
    )


async def _probe_bytes(data: bytes, suffix: str) -> VideoInfo | None:
    """Кодеки файла по его байтам (временный файл живёт только внутри вызова)."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"media{suffix}"
        path.write_bytes(data)
        return await video_transcode.probe(path)


# --- Решение «проиграет ли браузер» ------------------------------------


@pytest.mark.parametrize(
    ("video_codec", "audio_codec", "format_name", "expected"),
    [
        ("h264", "aac", MP4_FORMAT, True),
        ("h264", None, MP4_FORMAT, True),
        # Тот самый случай: MPEG-4 Visual + AMR — Chromium отказывается целиком.
        ("mp4v", "samr", MP4_FORMAT, False),
        # HEVC играет iPhone и большинство телефонов, поэтому не перекодируем.
        ("hevc", "aac", MP4_FORMAT, True),
        # Неподдерживаемый звук ломает ролик не хуже неподдерживаемого видео.
        ("h264", "amr_nb", MP4_FORMAT, False),
        # Контейнер, которого в браузере нет вовсе.
        ("h264", "aac", "avi", False),
    ],
)
def test_playable_matrix(
    video_codec: str | None, audio_codec: str | None, format_name: str, expected: bool
) -> None:
    info = VideoInfo(
        video_codec=video_codec, audio_codec=audio_codec, format_name=format_name
    )
    assert info.playable() is expected


@pytest.mark.asyncio
async def test_missing_ffmpeg_keeps_file(monkeypatch: pytest.MonkeyPatch) -> None:
    """Без ffmpeg загрузка не ломается: файл сохраняется как раньше."""
    monkeypatch.setattr(video_transcode, "is_available", lambda: False)
    prepared = await prepare_video(b"anything", suffix=".mp4", mime="video/mp4")
    assert prepared.transcoded is False
    assert prepared.data == b"anything"


# --- Реальное перекодирование -----------------------------------------


@needs_ffmpeg
@pytest.mark.asyncio
async def test_legacy_video_is_transcoded() -> None:
    """Непроигрываемое видео превращается в H.264/AAC (mp4, faststart)."""
    prepared = await prepare_video(_legacy_video(), suffix=".mp4", mime="video/mp4")

    assert prepared.transcoded is True
    assert (prepared.suffix, prepared.mime) == (".mp4", "video/mp4")
    info = await _probe_bytes(prepared.data, prepared.suffix)
    assert info is not None
    assert info.video_codec == "h264"
    assert info.playable()


@needs_ffmpeg
@pytest.mark.asyncio
async def test_supported_video_kept_as_is() -> None:
    """Совместимый файл не трогаем: перекодирование — это процессор и время."""
    original = _modern_video()
    prepared = await prepare_video(original, suffix=".mp4", mime="video/mp4")

    assert prepared.transcoded is False
    assert prepared.data == original


@needs_ffmpeg
@pytest.mark.asyncio
async def test_client_can_ask_for_transcode() -> None:
    """``transcode=1`` от клиента перекодирует даже совместимый файл."""
    prepared = await prepare_video(
        _modern_video(), suffix=".mp4", mime="video/mp4", force=True
    )
    assert prepared.transcoded is True
    assert prepared.mime == "video/mp4"


@needs_ffmpeg
@pytest.mark.asyncio
async def test_audio_only_rejected() -> None:
    """Аудио историей быть не может: в просмотрщике это тот же чёрный экран."""
    with pytest.raises(HTTPException) as excinfo:
        await prepare_video(_audio_only(), suffix=".m4a", mime="audio/mp4")
    assert excinfo.value.status_code == 415
    assert excinfo.value.detail == "История может быть фото или видео"


@needs_ffmpeg
@pytest.mark.asyncio
async def test_unreadable_file_rejected() -> None:
    """Мусор с расширением видео — понятный отказ, а не чёрная история."""
    with pytest.raises(HTTPException) as excinfo:
        await prepare_video(b"not a video at all", suffix=".mp4", mime="video/mp4")
    assert excinfo.value.status_code == 415
    assert excinfo.value.detail == UNSUPPORTED_VIDEO_DETAIL


# --- Через API ---------------------------------------------------------

# Фикстура API-теста живёт в test_stories_api — импортируем её сюда, чтобы не
# дублировать настройку окружения (как это делают остальные БД-тесты).
from tests.test_stories_api import _ApiCtx  # noqa: E402
from tests.test_stories_api import api as api_fixture  # noqa: E402,F401


@pytest_asyncio.fixture
async def api(api_fixture: _ApiCtx) -> _ApiCtx:  # noqa: F811
    """Тот же контекст API-тестов, что и в test_stories_api."""
    return api_fixture


@needs_db
@needs_ffmpeg
@pytest.mark.asyncio
async def test_publish_transcodes_legacy_video(api: _ApiCtx) -> None:
    """История с непроигрываемым видео публикуется уже в H.264."""
    author = await api.make_user()
    response = await api.publish(
        await api.token_for(author),
        name="1000013648.mp4",
        mime="video/mp4",
        content=_legacy_video(),
    )
    assert response.status_code == 201, response.text

    # Раздача медиа публичная (имя — uuid), поэтому проверяем тот самый файл,
    # который получит зритель.
    url = response.json()["media_url"]
    downloaded = await api.client.get(url)
    assert downloaded.status_code == 200

    info = await _probe_bytes(downloaded.content, Path(url).suffix)
    assert info is not None
    assert info.video_codec == "h264"
    assert info.playable()


@needs_db
@needs_ffmpeg
@pytest.mark.asyncio
async def test_publish_audio_story_rejected(api: _ApiCtx) -> None:
    """Аудиофайл историей не публикуется (иначе в ленте чёрный экран)."""
    author = await api.make_user()
    response = await api.publish(
        await api.token_for(author),
        name="voice.m4a",
        mime="audio/mp4",
        content=_audio_only(),
    )
    assert response.status_code == 415, response.text
    assert response.json()["detail"] == "История может быть фото или видео"


@needs_db
@pytest.mark.asyncio
async def test_publish_rate_limit(api: _ApiCtx) -> None:
    """Публикации ограничены по частоте: перекодирование ест процессор."""
    from core.config import settings

    author = await api.make_user()
    token = await api.token_for(author)
    for _ in range(settings.story_publish_limit_per_minute):
        assert (await api.publish(token)).status_code == 201

    blocked = await api.publish(token)
    assert blocked.status_code == 429
