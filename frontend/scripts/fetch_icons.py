"""Скачивает сборку иконок Lucide (шрифт + карта имён) в кэш сборки.

Lucide — SVG-набор (тонкий штрих 2px, скруглённые концы), у него есть готовая
шрифтовая сборка в пакете `lucide-static`. Кладём её в кэш (в git не храним:
из неё собирается урезанный шрифт `src/assets/fonts/lucide-subset.woff2`).

Запуск: python3 frontend/scripts/fetch_icons.py
"""

from __future__ import annotations

import io
import json
import pathlib
import sys
import tarfile
import urllib.request

FRONTEND = pathlib.Path(__file__).resolve().parent.parent
CACHE = FRONTEND / "node_modules/.cache/pismo-icons"
NEEDED = (
    "package/font/lucide.woff2",
    "package/font/codepoints.json",
    "package/font/lucide.css",
)


def main() -> int:
    registry = "https://registry.npmjs.org/lucide-static/latest"
    with urllib.request.urlopen(registry, timeout=30) as response:
        meta = json.load(response)
    tarball = meta["dist"]["tarball"]

    CACHE.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(tarball, timeout=60) as response:
        data = response.read()

    found = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if member.name not in NEEDED:
                continue
            target = CACHE / pathlib.Path(member.name).name
            extracted = tar.extractfile(member)
            if extracted is None:
                continue
            target.write_bytes(extracted.read())
            found += 1
            print(
                f"{target.relative_to(FRONTEND)} — {target.stat().st_size / 1024:.0f} КБ"
            )

    if found != len(NEEDED):
        print(f"не нашли всё нужное: {found} из {len(NEEDED)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
