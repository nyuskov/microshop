"""Собирает каталог эмодзи для панели (`src/utils/emojiCatalog.ts`).

Зачем генератор, а не список руками: эмодзи — это данные Unicode, их больше
тысячи, и рукописный список быстро отстаёт от жизни. Источник — официальный
`emoji-test.txt` (тот же набор и порядок, что в системных клавиатурах и в
Telegram): в нём есть группы, подгруппы и статус каждой последовательности.

Что делаем:

1. скачиваем `emoji-test.txt` в кэш (если файла нет) — в git его не держим,
   это 250 КБ данных, которые всё равно обновляются вместе с Unicode;
2. берём только `fully-qualified` последовательности (RGI-набор: то, что
   реально рисуется как один эмодзи);
3. выбрасываем группу `Component` (это «запчасти» для конструктора: цвета кожи,
   волосы) и все варианты с цветом кожи — панель их не показывает, а без них
   список короче примерно втрое;
4. пишем группы по-русски, каждая со своим значком для полоски вкладок.

Запуск (интернет нужен только для первого скачивания):
    python3 frontend/scripts/build-emoji-catalog.py
"""

from __future__ import annotations

import pathlib
import sys
import urllib.request

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
CACHE = FRONTEND / "node_modules/.cache/pismo-emoji"
SOURCE = CACHE / "emoji-test.txt"
OUT = FRONTEND / "src/utils/emojiCatalog.ts"

#: Официальный список Unicode. Версия фиксирована: каталог в приложении должен
#: меняться вместе с релизом, а не «сам собой» при каждой сборке.
SOURCE_URL = "https://unicode.org/Public/emoji/15.1/emoji-test.txt"

#: Цвета кожи (U+1F3FB..U+1F3FF): варианты одной и той же эмоции, в панели не
#: нужны — их слишком много, а интерфейса выбора тона у нас нет.
SKIN_TONES = range(0x1F3FB, 0x1F400)

#: Группы из файла → ключ, русское название и значок для вкладки.
#:
#: Значок — первый эмодзи группы: он и понятен без подписи, и не требует
#: отдельной иконки в шрифте.
GROUPS: list[tuple[str, str, str]] = [
    ("Smileys & Emotion", "smileys", "Смайлы"),
    ("People & Body", "people", "Люди"),
    ("Animals & Nature", "nature", "Природа"),
    ("Food & Drink", "food", "Еда"),
    ("Travel & Places", "travel", "Места"),
    ("Activities", "activities", "Занятия"),
    ("Objects", "objects", "Предметы"),
    ("Symbols", "symbols", "Символы"),
    ("Flags", "flags", "Флаги"),
]

#: Группы-«запчасти»: в панели их показывать нечего.
SKIP_GROUPS = {"Component"}

#: Сколько эмодзи в строке файла — только ради читаемого diff.
PER_LINE = 16


def download() -> None:
    """Скачивает `emoji-test.txt` в кэш (в git файл не попадает)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    print(f"Скачиваем {SOURCE_URL}")
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:  # noqa: S310
        SOURCE.write_bytes(response.read())


def parse(path: pathlib.Path) -> dict[str, list[str]]:
    """Читает `emoji-test.txt` → «группа → эмодзи по порядку»."""
    result: dict[str, list[str]] = {}
    group: str | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        if raw.startswith("# group:"):
            group = raw.split(":", 1)[1].strip()
            continue
        if not group or raw.startswith("#"):
            continue
        data, _, comment = raw.partition("#")
        _, _, status = data.partition(";")
        if status.strip() != "fully-qualified":
            continue
        # В комментарии первый «токен» — сам эмодзи, дальше название и версия.
        char = comment.strip().split(" ", 1)[0]
        if not char:
            continue
        if group in SKIP_GROUPS:
            continue
        if any(ord(symbol) in SKIN_TONES for symbol in char):
            continue
        bucket = result.setdefault(group, [])
        if char not in bucket:
            bucket.append(char)
    return result


def write_catalog(groups: dict[str, list[str]]) -> None:
    """Пишет `src/utils/emojiCatalog.ts`."""
    lines: list[str] = [
        "/**",
        " * Каталог эмодзи: все доступные по группам, как в системной клавиатуре.",
        " *",
        " * Файл сгенерирован `frontend/scripts/build-emoji-catalog.py` из",
        f" * официального списка Unicode ({SOURCE_URL.rsplit('/', 1)[-1]}) —",
        " * руками не правим: изменение затрут при следующей сборке каталога.",
        " *",
        " * Почему просто список, без паков: эмодзи — это данные Unicode, а не",
        " * чей-то набор. Человеку нужно быстро найти нужный символ, поэтому",
        " * группы идут в привычном порядке (смайлы → люди → природа → …), а",
        " * внутри группы — как в клавиатуре. Варианты с цветом кожи не",
        " * включены: их слишком много, а выбора тона в интерфейсе нет.",
        " */",
        "",
        "export interface EmojiCategory {",
        "  /** Ключ группы (латиницей, для хранения выбранной вкладки). */",
        "  key: string",
        "  /** Подпись для вкладки (полоска внизу панели). */",
        "  title: string",
        "  /** Значок вкладки: первый эмодзи группы. */",
        "  icon: string",
        "  items: string[]",
        "}",
        "",
        "export const EMOJI_CATEGORIES: EmojiCategory[] = [",
    ]
    for source_group, key, title in GROUPS:
        items = groups.get(source_group, [])
        if not items:
            print(
                f"!!! группа «{source_group}» пуста — проверьте источник",
                file=sys.stderr,
            )
            continue
        lines.append("  {")
        lines.append(f"    key: '{key}',")
        lines.append(f"    title: '{title}',")
        lines.append(f"    icon: '{items[0]}',")
        lines.append("    // prettier-ignore")
        lines.append("    items: [")
        for start in range(0, len(items), PER_LINE):
            chunk = ", ".join(f"'{item}'" for item in items[start : start + PER_LINE])
            lines.append(f"      {chunk},")
        lines.append("    ]")
        lines.append("  },")
        print(f"{title:10} {len(items):5} эмодзи")
    lines.append("]")
    lines.append("")
    lines.append("/** Группа по ключу (неизвестный ключ — `undefined`). */")
    lines.append(
        "export const emojiCategoryByKey = (\n"
        "  key: string\n"
        "): EmojiCategory | undefined => EMOJI_CATEGORIES.find((item) => item.key === key)"
    )
    lines.append("")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Готово: {OUT.relative_to(FRONTEND)}")


def main() -> None:
    if not SOURCE.exists():
        download()
    write_catalog(parse(SOURCE))


if __name__ == "__main__":
    main()
