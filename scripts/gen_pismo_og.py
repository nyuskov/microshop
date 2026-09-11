#!/usr/bin/env python3
"""Генерирует картинку для превью ссылок на сторонних сайтах (og:image).

Когда ссылку на pismo.space вставляют в Telegram, VK, WhatsApp и т.п., они
показывают карточку: заголовок, описание и картинку из мета-тегов
(`frontend/index.html`). Эта картинка — `frontend/public/og.png`, 1200×630
(стандарт Open Graph, показывается «широкой» карточкой).

Рисунок: фирменный градиент и белая «плашка-письмо» с хвостиком и клапаном
конверта — тот же мотив, что у иконок приложения (см. gen_pismo_icons). Текста
в картинке нет: заголовок и описание подставляют сами сайты, а без текста
картинка не зависит от шрифтов и выглядит одинаково везде.

Запуск: python3 scripts/gen_pismo_og.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gen_pismo_icons import (  # noqa: E402  (путь к модулю задаётся выше)
    BRAND_BOTTOM,
    BRAND_TOP,
    Canvas,
    _geometry,
    png_bytes,
)

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "..", "frontend", "public", "og.png")

WIDTH = 1200
HEIGHT = 630

# Сглаживание «плашки»: слой рисуем в 2× и усредняем 2×2 при вставке.
MARK_SUPERSAMPLE = 2
# Сторона квадратного слоя с плашкой (меньше высоты картинки, чтобы были поля).
MARK_SIDE = 360
# Насколько плашка крупнее «иконочной» (в иконке она занимает ~60% ширины).
MARK_SCALE = 1.15
# Внутренняя рамка: тонкая полупрозрачная линия по краю картинки.
FRAME_INSET = 26
FRAME_ALPHA = 0.14


def gradient_buffer(width: int, height: int) -> bytearray:
    """Вертикальный фирменный градиент во всю картинку (непрозрачный)."""
    buf = bytearray(width * height * 4)
    stride = width * 4
    for y in range(height):
        t = y / (height - 1) if height > 1 else 0.0
        r, g, b = (
            round(BRAND_TOP[i] + (BRAND_BOTTOM[i] - BRAND_TOP[i]) * t) for i in range(3)
        )
        buf[y * stride : (y + 1) * stride] = bytes((r, g, b, 255)) * width
    return buf


def blend(
    buf: bytearray, width: int, x: int, y: int, r: int, g: int, b: int, alpha: float
) -> None:
    """Накладывает цвет с прозрачностью на пиксель."""
    if alpha <= 0 or x < 0 or y < 0 or x >= width:
        return
    offset = (y * width + x) * 4
    if offset >= len(buf):
        return
    buf[offset] = round(buf[offset] * (1 - alpha) + r * alpha)
    buf[offset + 1] = round(buf[offset + 1] * (1 - alpha) + g * alpha)
    buf[offset + 2] = round(buf[offset + 2] * (1 - alpha) + b * alpha)


def draw_frame(
    buf: bytearray, width: int, height: int, inset: int, alpha: float
) -> None:
    """Тонкая белая рамка «карточки» по краю картинки."""
    for y in range(inset, height - inset):
        blend(buf, width, inset, y, 255, 255, 255, alpha)
        blend(buf, width, width - inset - 1, y, 255, 255, 255, alpha)
    for x in range(inset, width - inset):
        blend(buf, width, x, inset, 255, 255, 255, alpha)
        blend(buf, width, x, height - inset - 1, 255, 255, 255, alpha)


def build_mark_mask() -> tuple[int, int, bytearray]:
    """Слой с белой «плашкой-письмом»: альфа-маска с «дыркой»-клапаном.

    Клапан рисуем не цветом фона, а «в прозрачность»: тогда на картинке сквозь
    него видно градиент (он разный сверху и снизу — так плашка выглядит объёмно).
    """
    side = MARK_SIDE * MARK_SUPERSAMPLE
    canvas = Canvas(side)
    geo = _geometry(side, MARK_SCALE)
    white = (255, 255, 255, 255)
    canvas.rounded_rect(geo["box"], geo["radius"], white)
    canvas.triangle(geo["tail"], white)
    left, apex, right = geo["flap"]
    canvas.segment(left, apex, geo["flap_width"], white, erase=True)
    canvas.segment(apex, right, geo["flap_width"], white, erase=True)
    return side, side, canvas.buf


def paste_mark(
    buf: bytearray, width: int, height: int, layer: bytearray, layer_side: int
) -> None:
    """Вставляет слой плашки в центр картинки, усредняя 2×2 (сглаживание)."""
    step = MARK_SUPERSAMPLE
    left = (width - MARK_SIDE) // 2
    top = (height - MARK_SIDE) // 2
    layer_stride = layer_side * 4
    samples = step * step
    for y in range(MARK_SIDE):
        for x in range(MARK_SIDE):
            alpha_sum = 0
            for dy in range(step):
                row = (y * step + dy) * layer_stride
                for dx in range(step):
                    alpha_sum += layer[row + (x * step + dx) * 4 + 3]
            alpha = alpha_sum / samples / 255
            if alpha <= 0:
                continue
            blend(buf, width, left + x, top + y, 255, 255, 255, alpha)


def main() -> None:
    buf = gradient_buffer(WIDTH, HEIGHT)
    draw_frame(buf, WIDTH, HEIGHT, FRAME_INSET, FRAME_ALPHA)
    layer_side, _, layer = build_mark_mask()
    paste_mark(buf, WIDTH, HEIGHT, layer, layer_side)

    data = png_bytes(WIDTH, HEIGHT, buf)
    with open(OUT, "wb") as handle:
        handle.write(data)
    print(f"saved og.png ({WIDTH}×{HEIGHT}, {len(data) // 1024} КБ)")


if __name__ == "__main__":
    main()
