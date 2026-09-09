#!/usr/bin/env python3
"""Генерирует иконки Microshop (PWA + badge для уведомлений).

Мотив: зелёный фон с градиентом, белый чат-пузырь и три точки внутри —
классический «мессенджер». Badge — монохромный белый силуэт пузыря с
«прозрачными» точками (Android обесцвечивает badge в белый).
"""

import math
import os

from PIL import Image, ImageChops, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
# Папка публичных иконок PWA (относительно репозитория).
OUT = os.path.join(ROOT, "..", "frontend", "public", "icons")
os.makedirs(OUT, exist_ok=True)

SUPERSAMPLE = 4
TOP = (64, 199, 127)
BOTTOM = (18, 137, 76)
WHITE = (255, 255, 255, 255)
DOT = (14, 122, 71, 255)


def _rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def _draw_colored(size: int, content_scale: float) -> Image.Image:
    img = Image.new(
        "RGBA", (size * SUPERSAMPLE, size * SUPERSAMPLE), (0, 0, 0, 0)
    )
    d = ImageDraw.Draw(img)
    S = size * SUPERSAMPLE

    # Вертикальный градиент фона
    for y in range(S):
        t = y / (S - 1)
        color = tuple(
            round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)
        )
        d.line([(0, y), (S, y)], fill=color + (255,))

    c = content_scale
    cx, cy = S / 2, S * 0.47
    bw, bh = S * 0.56 * c, S * 0.335 * c
    # Белый чат-пузырь (скруглённый прямоугольник)
    r = bh * 0.42
    x0, x1 = cx - bw / 2, cx + bw / 2
    y0, y1 = cy - bh / 2, cy + bh / 2
    _rounded(d, [x0, y0, x1, y1], r, WHITE)
    # Хвостик пузыря слева-снизу
    tail = [
        (x0 + bw * 0.16, y1 - bh * 0.04),
        (x0 - bw * 0.05, y1 + bh * 0.30),
        (x0 + bw * 0.28, y1 - bh * 0.02),
    ]
    d.polygon(tail, fill=WHITE)

    # Три точки (цвет фона/акцента) внутри пузыря
    dr = S * 0.058 * c
    gap = S * 0.085 * c
    total = 3 * dr * 2 + 2 * gap
    start_x = cx - total / 2 + dr
    dot_y = cy - bh * 0.02
    for i in range(3):
        x = start_x + i * (2 * dr + gap)
        d.ellipse([x - dr, dot_y - dr, x + dr, dot_y + dr], fill=DOT)

    return img.resize((size, size), Image.LANCZOS).convert("RGBA")


def _draw_badge(size: int) -> Image.Image:
    img = Image.new(
        "RGBA", (size * SUPERSAMPLE, size * SUPERSAMPLE), (0, 0, 0, 0)
    )
    d = ImageDraw.Draw(img)
    S = size * SUPERSAMPLE
    cx, cy = S / 2, S * 0.52
    bw, bh = S * 0.72, S * 0.46
    r = bh * 0.4
    x0, x1 = cx - bw / 2, cx + bw / 2
    y0, y1 = cy - bh / 2, cy + bh / 2
    # Белый силуэт пузыря (Android сам рисует белым, прозрачность — форма)
    _rounded(d, [x0, y0, x1, y1], r, (255, 255, 255, 255))
    tail = [
        (x0 + bw * 0.16, y1 - bh * 0.05),
        (x0 - bw * 0.06, y1 + bh * 0.34),
        (x0 + bw * 0.3, y1 - bh * 0.02),
    ]
    d.polygon(tail, fill=(255, 255, 255, 255))
    # Прозрачные «точки», чтобы силуэт читался как пузырь с точками
    dr = S * 0.078
    gap = S * 0.11
    total = 3 * dr * 2 + 2 * gap
    start_x = cx - total / 2 + dr
    dot_y = cy - bh * 0.02
    erase = Image.new("L", (S, S), 0)
    ed = ImageDraw.Draw(erase)
    for i in range(3):
        x = start_x + i * (2 * dr + gap)
        ed.ellipse([x - dr, dot_y - dr, x + dr, dot_y + dr], fill=255)
    alpha = img.getchannel("A")
    img.putalpha(ImageChops.multiply(alpha, ImageChops.invert(erase)))
    return img.resize((size, size), Image.LANCZOS)


colored = {
    "icon-512.png": (512, 1.0),
    "icon-192.png": (192, 1.0),
    "icon-maskable-512.png": (512, 0.82),
    "apple-touch-icon-180.png": (180, 0.82),
}
for name, (sz, cs) in colored.items():
    im = _draw_colored(sz, cs)
    im.save(os.path.join(OUT, name))
    print("saved", name)

badge = _draw_badge(96)
badge.save(os.path.join(OUT, "badge-96.png"))
print("saved badge-96.png")
