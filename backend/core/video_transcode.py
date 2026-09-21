"""Проверка и перекодирование видео перед публикацией истории.

Зачем: телефон умеет записать видео в формате, который браузер не декодирует.
Ролик из старого аппарата (MPEG-4 Visual ``mp4v`` + звук ``samr``/AMR в
3GP-контейнере) не открывается ни Chromium, ни WebView Android-приложения —
тег ``<video>`` остаётся чёрным, и история выглядит сломанной (см.
``docs/gotchas.md``). Поэтому перед сохранением файла мы спрашиваем кодеки у
``ffprobe``, а непроигрываемое перекодируем в H.264/AAC.

Что важно:

* **ffmpeg в образе**. Проверка работает только если в образе есть ffmpeg
  (``apk add ffmpeg``, см. ``backend/Dockerfile``). Если его нет, загрузку НЕ
  отклоняем: пишем предупреждение в лог и сохраняем файл как раньше — иначе
  окружение без ffmpeg перестало бы принимать видео совсем.
* **Клиент тоже проверяет**. Публикующий клиент сам пробует проиграть файл и
  присылает ``transcode=1``, если его браузер не смог: тогда перекодируем даже
  формально совместимое видео (например, HEVC, который тянет не всякий браузер).
* **Лучше отказ, чем чёрный экран**. Если файл не читается, видеодорожки в нём
  нет (аудио историей быть не может) или перекодировать не удалось — 415 с
  понятным текстом. Молчаливое сохранение означало бы ту же чёрную историю.
* **Временные файлы**. ffmpeg не умеет читать наше шифрованное хранилище
  (``core/media_crypto.py``), поэтому исходник и результат перекодирования лежат
  в приватном каталоге ``TemporaryDirectory`` и удаляются сразу после работы.
  Это осознанный компромисс: на время перекодирования файл существует на диске
  расшифрованным (в постоянном хранилище он снова шифруется).
* **HEVC не перекодируем по умолчанию**. Видео с телефонов на iOS записывается в
  HEVC, и перекодирование каждого такого ролика в запросе публикации — лишняя
  минута ожидания для автора. Ограничиваемся проверкой: если браузер автора сам
  сообщил, что не играет (``transcode=1``), перекодируем и HEVC.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

#: Кодеки, которые декодируют браузеры (Chromium/Safari/WebView).
WEB_VIDEO_CODECS = {"h264", "hevc", "vp8", "vp9", "av1"}
WEB_AUDIO_CODECS = {"aac", "opus", "vorbis", "mp3"}
#: Контейнеры, которые браузеры разбирают сами (имена форматов из ffprobe).
WEB_FORMATS = {"mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm"}

#: Сколько секунд ждём ffprobe и ffmpeg. Перекодирование идёт в самом запросе
#: публикации (клиент ждёт с запасом), поэтому таймаут — страховка от зависшего
#: процесса, а не обычный ход событий.
PROBE_TIMEOUT_SECONDS = 15
TRANSCODE_TIMEOUT_SECONDS = 120

#: Приводим картинку к чётным сторонам: с нечётными yuv420p не кодируется.
SCALE_FILTER = "scale=trunc(iw/2)*2:trunc(ih/2)*2"

#: Ответ на видео, которое не удалось ни прочитать, ни перекодировать.
UNSUPPORTED_VIDEO_DETAIL = (
    "Этот формат видео не проигрывается в браузере, и перекодировать его не удалось. "
    "Выберите другой файл."
)


@dataclass(frozen=True)
class VideoInfo:
    """Что внутри файла: кодеки и контейнер (по данным ffprobe)."""

    video_codec: str | None
    audio_codec: str | None
    format_name: str

    def playable(self) -> bool:
        """Проиграет ли это браузер без перекодирования."""
        if self.format_name not in WEB_FORMATS:
            return False
        if self.video_codec not in WEB_VIDEO_CODECS:
            return False
        # Звука может не быть вовсе; неподдерживаемый звук ломает ролик так же,
        # как неподдерживаемое видео (Chromium отказывается от всей дорожки).
        return self.audio_codec is None or self.audio_codec in WEB_AUDIO_CODECS


@dataclass(frozen=True)
class PreparedVideo:
    """Видео, готовое к сохранению: исходное или перекодированное."""

    data: bytes
    suffix: str
    mime: str
    transcoded: bool


def is_available() -> bool:
    """Есть ли в образе ffmpeg и ffprobe (без них проверка невозможна)."""
    return bool(shutil.which("ffprobe") and shutil.which("ffmpeg"))


async def _run(command: list[str], *, timeout: int) -> tuple[int, bytes, bytes]:
    """Запускает внешнюю программу и ждёт её (без блокировки event loop)."""
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        logger.warning("Превышено время работы %s (%s с)", command[0], timeout)
        return -1, b"", b"timeout"
    return process.returncode or 0, stdout, stderr


def _short(stderr: bytes) -> str:
    """Последняя строка вывода ffmpeg — для лога (целиком он длинный)."""
    text = stderr.decode("utf-8", errors="replace").strip()
    return text.splitlines()[-1][:200] if text else ""


async def probe(path: Path) -> VideoInfo | None:
    """Кодеки и контейнер файла. ``None`` — файл не читается как видео."""
    code, stdout, stderr = await _run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_entries",
            "stream=codec_type,codec_name",
            "-show_entries",
            "format=format_name",
            str(path),
        ],
        timeout=PROBE_TIMEOUT_SECONDS,
    )
    if code != 0:
        logger.warning("ffprobe не прочитал видео: %s", _short(stderr))
        return None
    try:
        payload = json.loads(stdout or b"{}")
    except ValueError:
        logger.warning("ffprobe вернул не JSON")
        return None
    streams = payload.get("streams") or []
    video = next(
        (
            item.get("codec_name")
            for item in streams
            if item.get("codec_type") == "video"
        ),
        None,
    )
    audio = next(
        (
            item.get("codec_name")
            for item in streams
            if item.get("codec_type") == "audio"
        ),
        None,
    )
    format_name = (payload.get("format") or {}).get("format_name") or ""
    return VideoInfo(video_codec=video, audio_codec=audio, format_name=format_name)


async def _transcode(source: Path, target: Path) -> bool:
    """Перекодирует файл в H.264/AAC (mp4, готовый к потоковой отдаче)."""
    code, _, stderr = await _run(
        [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-i",
            str(source),
            "-map",
            "0:v:0",
            # ``?`` — звуковой дорожки может не быть, это не ошибка.
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            SCALE_FILTER,
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-ac",
            "2",
            # moov в начале файла: браузер начинает показ, не скачав его целиком.
            "-movflags",
            "+faststart",
            str(target),
        ],
        timeout=TRANSCODE_TIMEOUT_SECONDS,
    )
    if code != 0:
        logger.warning("ffmpeg не смог перекодировать видео: %s", _short(stderr))
        return False
    return target.exists() and target.stat().st_size > 0


async def prepare_video(
    data: bytes,
    *,
    suffix: str,
    mime: str,
    force: bool = False,
) -> PreparedVideo:
    """Проверяет видео и, если нужно, перекодирует его.

    ``force`` — клиент сообщил, что его браузер этот файл не проигрывает.
    Возвращает либо исходные байты, либо результат перекодирования (mp4).
    """
    if not is_available():
        # Худший случай — та же чёрная история, что и раньше, поэтому не отказ,
        # а предупреждение: работоспособность загрузки важнее проверки.
        logger.warning(
            "ffmpeg недоступен: видео сохраняется без проверки кодека "
            "(в образе нет ffmpeg, см. backend/Dockerfile)"
        )
        return PreparedVideo(data=data, suffix=suffix, mime=mime, transcoded=False)

    with tempfile.TemporaryDirectory(prefix="story-video-") as tmp:
        source = Path(tmp) / f"source{suffix}"
        source.write_bytes(data)
        info = await probe(source)
        if info is None:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=UNSUPPORTED_VIDEO_DETAIL,
            )
        if info.video_codec is None:
            # Аудио (mp3/m4a) расширением проходит белый список медиа, но
            # историей быть не может: в просмотрщике это тот же чёрный экран.
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="История может быть фото или видео",
            )
        if info.playable() and not force:
            return PreparedVideo(data=data, suffix=suffix, mime=mime, transcoded=False)

        target = Path(tmp) / "story.mp4"
        if not await _transcode(source, target):
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=UNSUPPORTED_VIDEO_DETAIL,
            )
        transcoded = target.read_bytes()

    logger.info(
        "Видео истории перекодировано: %s -> H.264/AAC (%s байт было, %s стало)",
        f"{info.video_codec}/{info.audio_codec}",
        len(data),
        len(transcoded),
    )
    return PreparedVideo(
        data=transcoded, suffix=".mp4", mime="video/mp4", transcoded=True
    )
