#!/usr/bin/env python3
"""Генерирует иконки Pismo (PWA + badge для уведомлений + favicon.ico).

Мотив — «конверт + пузырь» (Pismo = письмо): белая скруглённая «плашка»
с хвостиком сообщения и «клапаном» конверта, на сине-фиолетовом градиенте.
Badge — монохромный белый силуэт плашки с хвостиком (Android сам рисует
badge белым, поэтому клапан вырезан «в прозрачность»).

Скрипт не требует зависимостей: PNG собирается вручную (zlib + фильтр 0),
сглаживание — суперсэмплинг 4× и box-фильтр.

Запуск: python3 scripts/gen_pismo_icons.py
"""

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
# Папка публичных иконок PWA (относительно репозитория).
OUT = os.path.join(ROOT, "..", "frontend", "public", "icons")

SUPERSAMPLE = 4
# Брендовый градиент (сине-фиолетовый).
BRAND_TOP = (123, 114, 255)
BRAND_BOTTOM = (58, 50, 201)
WHITE = (255, 255, 255, 255)


# --------------------------- PNG (RGBA8) ---------------------------


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def png_bytes(width: int, height: int, rgba: bytearray) -> bytes:
    """Собирает PNG из сырых RGBA-байт (фильтр 0 для каждой строки)."""
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw += rgba[y * stride : (y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _chunk(b"IEND", b"")
    )


# --------------------------- Полотно ---------------------------


class Canvas:
    """RGBA-полотно с примитивами, которые нужны для иконки."""

    def __init__(self, size: int) -> None:
        self.size = size
        self.stride = size * 4
        self.buf = bytearray(size * self.stride)  # прозрачный по умолчанию

    def _put(
        self, x: int, y: int, r: int, g: int, b: int, a: int = 255
    ) -> None:
        offset = y * self.stride + x * 4
        self.buf[offset] = r
        self.buf[offset + 1] = g
        self.buf[offset + 2] = b
        self.buf[offset + 3] = a

    def gradient(self, top=BRAND_TOP, bottom=BRAND_BOTTOM) -> None:
        """Вертикальный градиент во всю иконку (непрозрачно)."""
        size = self.size
        for y in range(size):
            t = y / (size - 1) if size > 1 else 0.0
            color = tuple(
                round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)
            )
            row = bytes((color[0], color[1], color[2], 255)) * size
            self.buf[y * self.stride : (y + 1) * self.stride] = row

    def _span(self, y: int, x_start: float, x_end: float, color) -> None:
        """Закрашивает горизонтальный отрезок строки (color — функция или кортеж)."""
        x0 = max(0, int(x_start + 0.5))
        x1 = min(self.size - 1, int(x_end + 0.5))
        if x1 < x0:
            return
        if color is None:
            for x in range(x0, x1 + 1):
                self._put(x, y, 0, 0, 0, 0)
            return
        fill = color(y) if callable(color) else color
        for x in range(x0, x1 + 1):
            self._put(x, y, *fill)

    def rounded_rect(self, box, radius: float, color) -> None:
        """Закрашивает скруглённый прямоугольник построчно (по отрезкам)."""
        x0, y0, x1, y1 = box
        for y in range(int(y0) - 1, int(y1) + 2):
            if y < y0 or y > y1:
                continue
            if y < y0 + radius:
                dy = (y0 + radius) - y
                dx = (radius * radius - dy * dy) ** 0.5 if dy <= radius else 0.0
                start, end = x0 + radius - dx, x1 - radius + dx
            elif y > y1 - radius:
                dy = y - (y1 - radius)
                dx = (radius * radius - dy * dy) ** 0.5 if dy <= radius else 0.0
                start, end = x0 + radius - dx, x1 - radius + dx
            else:
                start, end = x0, x1
            self._span(y, start, end, color)

    def triangle(self, points, color) -> None:
        """Закрашивает треугольник построчно (пересечение строки с рёбрами)."""
        (ax, ay), (bx, by), (cx, cy) = points
        y_min = max(0, int(min(ay, by, cy)) - 1)
        y_max = min(self.size - 1, int(max(ay, by, cy)) + 1)
        edges = ((ax, ay, bx, by), (bx, by, cx, cy), (cx, cy, ax, ay))
        for y in range(y_min, y_max + 1):
            xs = []
            for x1_, y1_, x2_, y2_ in edges:
                if (y1_ <= y < y2_) or (y2_ <= y < y1_):
                    xs.append(x1_ + (y - y1_) * (x2_ - x1_) / (y2_ - y1_))
            if len(xs) >= 2:
                self._span(y, min(xs), max(xs), color)

    def segment(self, p, q, width: float, color, erase: bool = False) -> None:
        """Толстая линия с круглыми «концами» (расстояние до отрезка)."""
        (px, py), (qx, qy) = p, q
        half = width / 2.0
        y_min = max(0, int(min(py, qy) - half) - 1)
        y_max = min(self.size - 1, int(max(py, qy) + half) + 1)
        x_min = max(0, int(min(px, qx) - half) - 1)
        x_max = min(self.size - 1, int(max(px, qx) + half) + 1)
        dx, dy = qx - px, qy - py
        length_sq = dx * dx + dy * dy
        for y in range(y_min, y_max + 1):
            for x in range(x_min, x_max + 1):
                if length_sq == 0:
                    t = 0.0
                else:
                    t = ((x - px) * dx + (y - py) * dy) / length_sq
                    t = 0.0 if t < 0 else (1.0 if t > 1 else t)
                nx, ny = px + t * dx - x, py + t * dy - y
                if nx * nx + ny * ny <= half * half:
                    if erase:
                        self._put(x, y, 0, 0, 0, 0)
                    else:
                        fill = color(y) if callable(color) else color
                        self._put(x, y, *fill)

    def downsample(self, factor: int) -> tuple:
        """Уменьшает в factor раз усреднением блоков (сглаживание)."""
        size = self.size // factor
        stride = size * 4
        out = bytearray(size * stride)
        src = self.buf
        src_stride = self.stride
        block = factor * factor
        for y in range(size):
            dst_row = y * stride
            for x in range(size):
                r = g = b = a = 0
                for sy in range(factor):
                    base = (y * factor + sy) * src_stride + x * factor * 4
                    for sx in range(factor):
                        offset = base + sx * 4
                        r += src[offset]
                        g += src[offset + 1]
                        b += src[offset + 2]
                        a += src[offset + 3]
                offset = dst_row + x * 4
                out[offset] = r // block
                out[offset + 1] = g // block
                out[offset + 2] = b // block
                out[offset + 3] = a // block
        return size, out


# --------------------------- Мотив иконки ---------------------------


def _geometry(size: int, content_scale: float) -> dict:
    """Геометрия «конверт + пузырь» для холста заданного размера."""
    s = float(size)
    c = content_scale
    half_w = s * 0.30 * c
    half_h = s * 0.23 * c
    cx, cy = s / 2, s * 0.5
    x0, x1 = cx - half_w, cx + half_w
    y0, y1 = cy - half_h, cy + half_h
    return {
        "size": s,
        "box": (x0, y0, x1, y1),
        "radius": half_h * 0.52,
        "tail": (
            (x0 + half_w * 0.34, y1 - half_h * 0.04),
            (x0 - half_w * 0.04, y1 + half_h * 0.42),
            (x0 + half_w * 0.72, y1 - half_h * 0.02),
        ),
        "flap": (
            (x0 + half_w * 0.22, y0 + half_h * 0.30),
            (cx, y0 + half_h * 0.86),
            (x1 - half_w * 0.22, y0 + half_h * 0.30),
        ),
        "flap_width": s * 0.032 * c,
    }


def draw_icon(size: int, content_scale: float) -> bytes:
    """Цветная иконка: градиент + белая «плашка» с хвостиком и клапаном."""
    supersampled = size * SUPERSAMPLE
    canvas = Canvas(supersampled)
    canvas.gradient()

    geo = _geometry(supersampled, content_scale)

    def flap_color(y: int) -> tuple:
        t = y / (supersampled - 1)
        return tuple(
            round(BRAND_TOP[i] + (BRAND_BOTTOM[i] - BRAND_TOP[i]) * t)
            for i in range(3)
        )

    canvas.rounded_rect(geo["box"], geo["radius"], WHITE)
    canvas.triangle(geo["tail"], WHITE)
    # Клапан конверта — «вырезан» по фону (цвет градиента в этой строке).
    left, apex, right = geo["flap"]
    canvas.segment(left, apex, geo["flap_width"], flap_color)
    canvas.segment(apex, right, geo["flap_width"], flap_color)

    out_size, pixels = canvas.downsample(SUPERSAMPLE)
    return png_bytes(out_size, out_size, pixels)


def draw_badge(size: int) -> bytes:
    """Badge: белый силуэт плашки с хвостиком, клапан — «прозрачный»."""
    supersampled = size * SUPERSAMPLE
    canvas = Canvas(supersampled)
    geo = _geometry(supersampled, 1.0)
    canvas.rounded_rect(geo["box"], geo["radius"], WHITE)
    canvas.triangle(geo["tail"], WHITE)
    left, apex, right = geo["flap"]
    canvas.segment(left, apex, geo["flap_width"], WHITE, erase=True)
    canvas.segment(apex, right, geo["flap_width"], WHITE, erase=True)

    out_size, pixels = canvas.downsample(SUPERSAMPLE)
    return png_bytes(out_size, out_size, pixels)


def ico_bytes(entries) -> bytes:
    """ICO с PNG-содержимым (поддерживается всеми актуальными браузерами)."""
    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory = bytearray()
    payload = b""
    for size, data in entries:
        side = 0 if size >= 256 else size
        directory += struct.pack(
            "<BBBBHHII", side, side, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)
        payload += data
    return header + bytes(directory) + payload


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    files = {
        "icon-512.png": draw_icon(512, 1.0),
        "icon-192.png": draw_icon(192, 1.0),
        "apple-touch-icon-180.png": draw_icon(180, 1.0),
        # maskable: контент в «безопасной зоне» (Android обрезает края).
        "icon-maskable-512.png": draw_icon(512, 0.78),
        "badge-96.png": draw_badge(96),
    }
    for name, data in files.items():
        with open(os.path.join(OUT, name), "wb") as handle:
            handle.write(data)
        print("saved", name)

    # favicon.ico — те же формы в 16/32/48 (PNG внутри ICO).
    entries = [(side, draw_icon(side, 1.0)) for side in (16, 32, 48)]
    ico = ico_bytes(entries)
    with open(
        os.path.join(ROOT, "..", "frontend", "public", "favicon.ico"), "wb"
    ) as handle:
        handle.write(ico)
    print("saved favicon.ico")


if __name__ == "__main__":
    main()
