"""Публикует раздел ``docs/changelog.md`` в канал «Новости приложения».

Правило проекта: раздел журнала **про функционал** (то, что видно человеку в
интерфейсе) дублируется постом в канал новостей (id 16). Вручную тут два шага —
переписать раздел человеческим языком и не забыть отметить в журнале номер поста.
Скрипт делает их вместе:

1. находит раздел по части заголовка и отказывается работать, если раздел уже
   опубликован или помечен как «в канал не идёт»;
2. берёт текст поста — из блока-черновика ``<!-- пост в канал … -->``, если он в
   разделе есть (так текст пишет человек), иначе собирает из заголовка и пунктов
   раздела, выкидывая служебное (пути к файлам, пометки о публикации); публикация
   СОБРАННОГО текста требует ``--force``: она нужна только тогда, когда человек
   глазами проверил пост в сухом прогоне;
3. публикует его той же функцией, что и обычное сообщение из API, и дописывает в
   конец раздела отметку «опубликован пост #NNN».

Запуск (в контейнере ``web``, где есть доступ к БД):

    poetry run python -m scripts.publish_changelog --list
    poetry run python -m scripts.publish_changelog --section "История: жест"
    poetry run python -m scripts.publish_changelog --section "История: жест" --publish

Без ``--publish`` ничего не отправляется: печатается готовый текст и состояние
раздела (сухой прогон). Пометку в журнал скрипт пишет только при публикации —
``--no-marker`` оставляет журнал как есть.
"""

import argparse
import asyncio
import re
from dataclasses import dataclass
from pathlib import Path

#: Журнал изменений — в корне репозитория, рядом с ``backend``.
CHANGELOG_PATH = Path(__file__).resolve().parents[2] / "docs" / "changelog.md"

#: Канал новостей приложения.
DEFAULT_CHANNEL_ID = 16

#: Лимит длины сообщения канала (см. ``api_v1/messages``).
MAX_POST_CHARS = 4000

#: Заголовок раздела журнала: ``## Заголовок (2026-09-29)``.
SECTION_RE = re.compile(r"^##[ \t]+(?!#)(?P<title>.+?)[ \t]*$", re.MULTILINE)

#: Блок-черновик поста внутри раздела (текст пишет человек, скрипт не трогает).
DRAFT_RE = re.compile(
    r"<!--[ \t]*пост в канал[ \t]*\n(?P<body>.*?)-->", re.DOTALL | re.IGNORECASE
)

#: Отметка о публикации: «опубликован пост #451», «в канал ушёл пост #440».
#: Внутри раздела может стоять лишняя разметка («посты **#448**»), поэтому
#: между словом и номером допускаем звёздочки.
PUBLISHED_RE = re.compile(
    r"(?:опубликован\w*|выложен\w*|в канал\w*)[^\n]{0,40}пост\w*[\s*]*#(\d+)",
    re.IGNORECASE,
)

#: Пометка «в канал это не публикуем» (инфраструктура, рефакторинг, доки).
INTERNAL_RE = re.compile(
    r"в канал[^.\n]{0,40}не (?:публику\w*|ид[ёе]т|идут)", re.IGNORECASE
)

#: Вложенный код и жирный текст в тексте поста не нужны — канал их не рисует.
CODE_RE = re.compile(r"`[^`]*`")

#: Пустые скобки, оставшиеся от вырезанного кода: «вынесен в ()» → «вынесен в».
EMPTY_BRACKETS_RE = re.compile(r"\(\s*\)")

#: Пробел перед знаком препинания — после вырезания кода он остаётся лишним.
SPACE_BEFORE_PUNCT_RE = re.compile(r"\s+([,.:;!?])")

#: Дата в конце заголовка раздела: « (2026-09-29)».
DATE_SUFFIX_RE = re.compile(r"\s*\((?:19|20)\d\d-\d\d-\d\d\)\s*$")


@dataclass
class Section:
    """Раздел журнала: заголовок и его текст без строки заголовка."""

    title: str
    body: str
    #: Смещение начала ВСЕГО раздела в файле (для вставки отметки).
    start: int
    #: Смещение конца раздела (начало следующего заголовка или конец файла).
    end: int
    text: str

    @property
    def published_post_id(self) -> int | None:
        """Номер поста, если раздел уже опубликован."""
        found = PUBLISHED_RE.search(self.text)
        return int(found.group(1)) if found else None

    @property
    def is_internal(self) -> bool:
        """Пометка «в канал не публикуем»: инфраструктура, рефакторинг, доки."""
        return bool(INTERNAL_RE.search(self.text))

    @property
    def state(self) -> str:
        """Состояние раздела для ``--list`` и проверок."""
        post_id = self.published_post_id
        if post_id is not None:
            return f"опубликован пост #{post_id}"
        if self.is_internal:
            return "в канал не публикуем"
        return "ждёт публикации"


def split_sections(text: str) -> list[Section]:
    """Разбивает журнал на разделы по заголовкам второго уровня."""
    matches = list(SECTION_RE.finditer(text))
    sections: list[Section] = []
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        sections.append(
            Section(
                title=match.group("title").strip(),
                body=text[match.end() : end],
                start=start,
                end=end,
                text=text[start:end],
            )
        )
    return sections


def find_section(sections: list[Section], query: str) -> Section:
    """Раздел по части заголовка: без совпадений и с несколькими — понятная ошибка."""
    needle = query.strip().casefold()
    found = [section for section in sections if needle in section.title.casefold()]
    if not found:
        raise SystemExit(f"В журнале нет раздела с «{query}» — список даст --list")
    if len(found) > 1:
        titles = "\n".join(f"  • {section.title}" for section in found)
        raise SystemExit(f"Под «{query}» подходит несколько разделов:\n{titles}")
    return found[0]


def post_draft(section: Section) -> str | None:
    """Черновик поста из блока ``<!-- пост в канал … -->`` (если он есть)."""
    found = DRAFT_RE.search(section.text)
    if found is None:
        return None
    draft = found.group("body").strip()
    return draft or None


def _drop_service(text: str) -> bool:
    """Служебная строка раздела: её в пост не берём.

    Те же пометки, по которым определяется состояние раздела: «в канал…не
    публикуем» и «опубликован пост #NNN». Держим их в одном месте, иначе текст
    поста и проверка «уже опубликовано» разъедутся.
    """
    return bool(INTERNAL_RE.search(text) or PUBLISHED_RE.search(text))


def _clean_line(line: str) -> str:
    """Готовит строку к посту: без вложенного кода и жирного шрифта.

    Вложенный код — это внутренние детали (пути к файлам, имена функций),
    подписчику они не нужны. После вырезания подчищаем следы: пустые скобки,
    пробел перед точкой и двойные пробелы.
    """
    cleaned = CODE_RE.sub("", line)
    cleaned = EMPTY_BRACKETS_RE.sub("", cleaned)
    cleaned = cleaned.replace("**", "")
    cleaned = SPACE_BEFORE_PUNCT_RE.sub(r"\1", cleaned)
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip()


def compose_post(section: Section) -> str:
    """Собирает текст поста из раздела: заголовок и пункты, без служебного.

    Черновик человека всегда важнее: если он есть, отдаём его как есть.
    """
    draft = post_draft(section)
    if draft is not None:
        return draft

    title = DATE_SUFFIX_RE.sub("", section.title).strip()
    lines: list[str] = [title, ""]
    for raw in section.body.splitlines():
        if raw.lstrip().startswith("<!--") or raw.rstrip().endswith("-->"):
            continue
        stripped = raw.strip()
        if _drop_service(stripped):
            continue
        if not stripped:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        bullet = re.match(r"^[-*]\s+(?P<text>.*)$", stripped)
        if bullet:
            lines.append(f"• {_clean_line(bullet.group('text'))}")
            continue
        if lines and lines[-1].startswith("• ") and raw[:1] in (" ", "\t"):
            # Продолжение пункта: абзац под тем же «•».
            lines[-1] = f"{lines[-1]} {_clean_line(stripped)}".strip()
            continue
        lines.append(_clean_line(stripped))

    post = "\n".join(lines).strip()
    return re.sub(r"\n{3,}", "\n\n", post)


def insert_marker(text: str, section: Section, message_id: int) -> str:
    """Дописывает в конец раздела отметку о публикации.

    Отметка встаёт ПОСЛЕ текста раздела и ПЕРЕД следующим заголовком: так её
    видно там же, где написано про саму правку (в журнале так делали и руками).
    """
    if section.published_post_id is not None:
        return text
    marker = (
        f"Канал «Новости приложения» (id {DEFAULT_CHANNEL_ID}): "
        f"опубликован пост #{message_id}."
    )
    head = text[: section.start]
    body = text[section.start : section.end].rstrip("\n")
    tail = text[section.end :]
    return (
        f"{head}{body}\n\n{marker}\n{tail}" if tail else f"{head}{body}\n\n{marker}\n"
    )


def publish(text: str, *, channel_id: int, phone: str | None) -> int:
    """Публикует пост в канал и возвращает его id (импорт — на момент вызова)."""
    # Импорт внутри функции: чистые части модуля тестируются без БД и моделей.
    from scripts.post_news import publish_post

    return asyncio.run(publish_post(channel_id=channel_id, text=text, phone=phone))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--list", action="store_true", help="Показать разделы и их состояние."
    )
    parser.add_argument(
        "--section", default=None, help="Часть заголовка раздела журнала (однозначная)."
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="Опубликовать пост в канал (без флага — сухой прогон).",
    )
    parser.add_argument(
        "--no-marker",
        dest="marker",
        action="store_false",
        help="Не дописывать в журнал отметку о публикации.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Публиковать раздел без черновика или с пометкой «не публикуем».",
    )
    parser.add_argument(
        "--file",
        default=str(CHANGELOG_PATH),
        help="Путь к журналу (по умолчанию docs/changelog.md в корне репозитория).",
    )
    parser.add_argument(
        "--channel-id",
        dest="channel_id",
        type=int,
        default=DEFAULT_CHANNEL_ID,
        help=f"id канала (по умолчанию {DEFAULT_CHANNEL_ID}).",
    )
    parser.add_argument(
        "--phone", default=None, help="Номер владельца, от чьего имени пост."
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    path = Path(args.file)
    text = path.read_text(encoding="utf-8")
    sections = split_sections(text)

    if args.list or not args.section:
        if not sections:
            raise SystemExit("В журнале нет разделов — проверьте --file")
        for section in sections:
            print(f"{section.state:<28} {section.title}")
        return

    section = find_section(sections, args.section)
    print(f"Раздел: {section.title}\nСостояние: {section.state}\n")

    if section.published_post_id is not None:
        raise SystemExit(
            f"Раздел уже опубликован (пост #{section.published_post_id}). "
            "Отметку можно поправить руками, если это ошибка."
        )
    if section.is_internal and not args.force:
        raise SystemExit(
            "Раздел помечен «в канал не публикуем» (инфраструктура/рефакторинг/доки). "
            "Если пост всё-таки нужен — повторите с --force."
        )

    post = compose_post(section)
    if not post:
        raise SystemExit("Пост получился пустым — добавьте в раздел текст или черновик")
    if len(post) > MAX_POST_CHARS:
        raise SystemExit(
            f"Пост длиннее лимита канала: {len(post)} знаков > {MAX_POST_CHARS}. "
            "Сократите текст или оставьте черновик короче."
        )
    # Черновик — признак того, что текст писал человек. Без него скрипт собирает
    # пост сам, а так в канал легко уводит служебное: требуем осознанного --force.
    draft = post_draft(section)

    print("--- текст поста ---")
    print(post)
    print(f"--- конец ({len(post)} знаков) ---")

    if not args.publish:
        if draft is None:
            print(
                "\nВнимание: блока «пост в канал» в разделе нет — текст собран "
                "скриптом из пунктов. Для публикации такого текста нужен --force."
            )
        print("\nСухой прогон: ничего не отправлено (для публикации — --publish).")
        return

    if draft is None and not args.force:
        raise SystemExit(
            "В разделе нет блока «пост в канал» — текст собран из пунктов. "
            "Проверьте его выше и повторите с --force, либо напишите черновик."
        )

    message_id = publish(post, channel_id=args.channel_id, phone=args.phone)
    print(f"Опубликовано: пост #{message_id} в канале id={args.channel_id}")
    if args.marker:
        path.write_text(insert_marker(text, section, message_id), encoding="utf-8")
        print(f"Отметка о посте #{message_id} дописана в {path}")


if __name__ == "__main__":
    main()
