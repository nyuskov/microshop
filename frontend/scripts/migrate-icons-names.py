"""Заменяет имена иконок в шаблонах на вызов `icon('имя')`.

Иконки в разметке были прямыми именами Material Symbols (`name="close"`).
Теперь набор другой (Font Awesome), и имя превращает `icon()` из
src/utils/icons.ts. Скрипт разовый: правит ТОЛЬКО атрибут `name` внутри тега
`<q-icon>`, ничего больше не трогает.
"""

from __future__ import annotations

import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parent.parent / "src"
QICON = re.compile(r"<q-icon\b[^>]*>", re.DOTALL)


def patch_tag(tag: str) -> str:
    def static(match: re.Match[str]) -> str:
        return f":name=\"icon('{match.group(1)}')\""

    def dynamic(match: re.Match[str]) -> str:
        expr = match.group(1).strip()
        if expr.startswith("icon("):
            return match.group(0)
        return f':name="icon({expr})"'

    # Сначала статические имена, затем выражения (уже с icon(...) не трогаем).
    tag = re.sub(r'\bname="([a-z0-9_]+)"', static, tag)
    # Динамические значения: перед нами уже не осталось статических.
    tag = re.sub(r':name="([^"]*)"', dynamic, tag)
    return tag


def main() -> int:
    changed_files = 0
    changed_attrs = 0
    for path in sorted(SRC.rglob("*.vue")):
        text = path.read_text(encoding="utf-8")
        if "<q-icon" not in text:
            continue
        new_tags = 0

        def repl(match: re.Match[str]) -> str:
            nonlocal new_tags
            original = match.group(0)
            patched = patch_tag(original)
            if patched != original:
                new_tags += patched.count(':name="icon')
                return patched
            return original

        new_text = QICON.sub(repl, text)
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
            changed_files += 1
            changed_attrs += new_tags
            print(f"{path.relative_to(SRC.parent)}: {new_tags}")
    print(f"файлов: {changed_files}, атрибутов: {changed_attrs}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
