#!/usr/bin/env python3
"""Генерирует ресурсы Android-приложения Pismo.

Мотив тот же, что и у иконок PWA (см. ``scripts/gen_pismo_icons.py``): белая
«плашка-письмо» с хвостиком сообщения и клапаном конверта на сине-фиолетовом
градиенте. Так иконка в RuStore/на рабочем столе совпадает с иконкой PWA.

Создаёт:
    mipmap-*/ic_launcher.png            — обычная иконка (fallback);
    mipmap-*/ic_launcher_round.png      — круглая иконка;
    drawable-*/ic_launcher_background.png  — фон adaptive-иконки (градиент);
    drawable-*/ic_launcher_foreground.png  — «письмо» для adaptive-иконки;
    drawable-*/ic_notification.png      — монохромная иконка уведомлений;
    drawable-*/splash_logo.png          — логотип сплэша.

Запуск: python3 scripts/gen_android_icons.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from gen_pismo_icons import (  # noqa: E402  (путь добавляется выше)
    BRAND_BOTTOM,
    BRAND_TOP,
    SUPERSAMPLE,
    WHITE,
    Canvas,
    _geometry,
    png_bytes,
)

ROOT = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(ROOT, "..", "android", "app", "src", "main", "res")

# Плотности Android: суффикс каталога → множитель (1dp = N px).
DENSITIES = (
    ("mdpi", 1.0),
    ("hdpi", 1.5),
    ("xhdpi", 2.0),
    ("xxhdpi", 3.0),
    ("xxxhdpi", 4.0),
)

# Размеры в dp.
LAUNCHER_DP = 48.0
ADAPTIVE_DP = 108.0  # canvas adaptive-иконки (видимая зона ~72dp)
NOTIFICATION_DP = 24.0
SPLASH_DP = 96.0

# Акцентный оттенок для клапана на прозрачном фоне (сплэш, тёмный фон).
BRAND_LIGHT = BRAND_TOP + (255,)


def _flap_gradient(size: int):
    """Функция цвета клапана — совпадает с фоном (эффект «выреза» на иконке)."""

    def color(y: int):
        t = y / (size - 1) if size > 1 else 0.0
        return tuple(
            round(BRAND_TOP[i] + (BRAND_BOTTOM[i] - BRAND_TOP[i]) * t)
            for i in range(3)
        )

    return color


def render(
    size: int,
    content_scale: float = 1.0,
    gradient_bg: bool = True,
    flap_mode: str = "gradient",
):
    """Рисует бренд-мотив и возвращает (size, RGBA-байты).

    flap_mode: ``gradient`` (клапан «сквозь» фон), ``erase`` (прозрачный вырез),
    ``color`` (брендовый цвет), ``none`` (без клапана).
    """
    supersampled = size * SUPERSAMPLE
    canvas = Canvas(supersampled)
    if gradient_bg:
        canvas.gradient()

    geo = _geometry(supersampled, content_scale)
    canvas.rounded_rect(geo["box"], geo["radius"], WHITE)
    canvas.triangle(geo["tail"], WHITE)

    left, apex, right = geo["flap"]
    width = geo["flap_width"]
    if flap_mode == "erase":
        canvas.segment(left, apex, width, WHITE, erase=True)
        canvas.segment(apex, right, width, WHITE, erase=True)
    elif flap_mode == "gradient":
        color = _flap_gradient(supersampled)
        canvas.segment(left, apex, width, color)
        canvas.segment(apex, right, width, color)
    elif flap_mode == "color":
        canvas.segment(left, apex, width, BRAND_LIGHT)
        canvas.segment(apex, right, width, BRAND_LIGHT)

    return canvas.downsample(SUPERSAMPLE)


def _circle_mask(size: int, pixels: bytearray) -> bytearray:
    """Зануляет альфу за пределами круга (для круглой иконки)."""
    out = bytearray(pixels)
    center = (size - 1) / 2.0
    radius = size / 2.0
    for y in range(size):
        dy = y - center
        for x in range(size):
            dx = x - center
            if dx * dx + dy * dy > radius * radius:
                offset = (y * size + x) * 4
                out[offset + 3] = 0
    return out


def _write(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)


def _save_png(path: str, size: int, pixels: bytearray) -> None:
    _write(path, png_bytes(size, size, pixels))


def main() -> None:
    for density, factor in DENSITIES:
        # 1. Обычная и круглая иконки (используются как fallback и в лаунчерах,
        #    которым нужен растровый вариант).
        launcher_px = int(round(LAUNCHER_DP * factor))
        size, pixels = render(launcher_px)
        _save_png(
            os.path.join(RES, f"mipmap-{density}", "ic_launcher.png"),
            size,
            pixels,
        )
        size, pixels = render(launcher_px)
        _save_png(
            os.path.join(RES, f"mipmap-{density}", "ic_launcher_round.png"),
            size,
            _circle_mask(size, pixels),
        )

        # 2. Adaptive-иконка: фон-градиент + «письмо» в безопасной зоне.
        adaptive_px = int(round(ADAPTIVE_DP * factor))
        size, pixels = render(adaptive_px, gradient_bg=True, flap_mode="none")
        _save_png(
            os.path.join(
                RES, f"drawable-{density}", "ic_launcher_background.png"
            ),
            size,
            pixels,
        )
        size, pixels = render(
            adaptive_px, content_scale=0.8, gradient_bg=False, flap_mode="erase"
        )
        _save_png(
            os.path.join(
                RES, f"drawable-{density}", "ic_launcher_foreground.png"
            ),
            size,
            pixels,
        )

        # 3. Иконка уведомлений: белый силуэт (Android красит его сам).
        notification_px = int(round(NOTIFICATION_DP * factor))
        size, pixels = render(
            notification_px, gradient_bg=False, flap_mode="erase"
        )
        _save_png(
            os.path.join(RES, f"drawable-{density}", "ic_notification.png"),
            size,
            pixels,
        )

        # 4. Логотип сплэша (на тёмном фоне — клапан брендового цвета).
        splash_px = int(round(SPLASH_DP * factor))
        size, pixels = render(splash_px, gradient_bg=False, flap_mode="color")
        _save_png(
            os.path.join(RES, f"drawable-{density}", "splash_logo.png"),
            size,
            pixels,
        )

        print(f"готово: {density}")


if __name__ == "__main__":
    main()
