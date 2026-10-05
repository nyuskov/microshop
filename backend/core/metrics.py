"""Метрики приложения в формате Prometheus.

Зачем: наблюдаемость сейчас — почтовый мониторинг раз в 15 минут
(`scripts/monitoring/check_prod.sh`) и строка о медленном запросе в логе.
Инцидент видно по факту «сайт не открывается», а деградацию — нет: сколько
запросов, какая доля ошибок, растёт ли время ответа, сколько живых сокетов,
сколько соединений занято в пуле БД.

Почему своё, а не внешний сервис: Sentry и облачные метрики — это передача
данных за границу (см. `docs/rkn-notification.md`). Мы отдаём метрики текстом на
своём сервере, а снимает их Prometheus там же (или разово `curl`). Ничего никуда
не уезжает.

Почему без библиотеки: формат exposition 0.0.4 — несколько строк текста, а
зависимость в проде ради этого не нужна (и лишний пакет в образе).

Что важно при съёмке:

* ключ серии — ШАБЛОН маршрута (`/api/v1/messages/{chat_id}/`), а не реальный
  путь: иначе сканеры, перебирающие `/wp-admin/...`, раздули бы память до
  нуля свободной. Число серий ограничено (`MAX_SERIES`), лишние сворачиваются в
  `other`;
* счётчики живут в памяти процесса: у нас два слота `web` (blue/green), и
  Prometheus увидит ДВА набора с `instance` разных слотов — это нормально, сумма
  по `instance` даёт общую картину. Слот, который вот-вот погасят, просто исчезнет
  из выдачи (счётчики обнулятся) — по этой причине для графиков берём `rate()`, а
  не абсолютные значения.
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

#: Сколько серий (метод + маршрут) помним. Всё, что сверх, сворачиваем в `other`.
MAX_SERIES = 200

#: Границы корзин гистограммы времени ответа (секунды). Шаг подобран под наш
#: профиль: обычный ответ — единицы миллисекунд, тяжёлый — десятки, «болит» —
#: от половины секунды.
BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)

#: Что писать в HELP для гаугов, которые заполняет вызывающая сторона.
_GAUGE_HELP = {
    "pismo_ws_users": "Люди с открытым WebSocket-каналом",
    "pismo_ws_sockets": "Открытые WebSocket-соединения",
    "pismo_db_pool_connections": "Соединения в пуле БД",
    "pismo_process_uptime_seconds": "Время с запуска процесса",
}

_started_at = time.monotonic()

#: Счётчики запросов: (метод, маршрут, класс кода) → число.
_requests: dict[tuple[str, str, str], int] = defaultdict(int)
#: Время ответа: (метод, маршрут) → сумма секунд.
_seconds_sum: dict[tuple[str, str], float] = defaultdict(float)
#: Время ответа: (метод, маршрут) → число наблюдений.
_seconds_count: dict[tuple[str, str], int] = defaultdict(int)
#: Корзины гистограммы: (метод, маршрут) → счётчики по BUCKETS (не кумулятивные,
#: кумулятивными их делаем при выводе — так не нужно переписывать прошлые корзины).
_buckets: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0] * len(BUCKETS))
#: Маршруты, которые уже занимают серию (для ограничения кардинальности).
_known_routes: set[tuple[str, str]] = set()

#: Гауги текущей съёмки: (метрика, подпись) → значение.
_gauges: dict[tuple[str, tuple[tuple[str, str], ...]], float] = {}
#: Порядок вывода гаугов (чтобы выдача была стабильной и читаемой глазами).
_gauge_order: list[tuple[str, tuple[tuple[str, str], ...]]] = []

#: Что писать в HELP для доменных счётчиков (их увеличивает вызывающая сторона).
#: Список закрытый: метрика без описания в выдачу не попадёт, а кардинальность
#: остаётся под нашим контролем (подписи задаём мы, а не клиент).
_COUNTER_HELP = {
    "pismo_client_errors_total": (
        "Отчёты о падении приложения, присланные клиентами (экран «500»)"
    ),
}

#: Доменные счётчики: (метрика, подпись) → значение.
_counters: dict[tuple[str, tuple[tuple[str, str], ...]], int] = defaultdict(int)
#: Порядок вывода доменных счётчиков.
_counter_order: list[tuple[str, tuple[tuple[str, str], ...]]] = []


def count(name: str, labels: dict[str, str] | None = None, value: int = 1) -> None:
    """Увеличивает доменный счётчик — то, что не является HTTP-запросом.

    Пример: отчёты о падении приложения (``pismo_client_errors_total``). Запрос
    клиента учитывается отдельно, в ``pismo_http_requests_total``, поэтому здесь
    считается именно СОБЫТИЕ, а не факт обращения к эндпоинту.
    """
    if name not in _COUNTER_HELP:
        return
    key = (name, tuple(sorted((labels or {}).items())))
    if key not in _counters:
        _counter_order.append(key)
    _counters[key] += value


def _label(value: str) -> str:
    """Экранирует значение подписи по правилам exposition-формата."""
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def _status_class(status_code: int) -> str:
    """Класс кода ответа (`2xx`, `4xx`, …) — детальные коды дают лишние серии."""
    return f"{status_code // 100}xx"


def _route_key(method: str, route: str | None) -> tuple[str, str]:
    """Определяет серию запроса и следит за пределом кардинальности."""
    path = route or "unmatched"
    key = (method, path)
    if key in _known_routes:
        return key
    if len(_known_routes) >= MAX_SERIES:
        return (method, "other")
    _known_routes.add(key)
    return key


def observe_request(
    method: str, route: str | None, status_code: int, seconds: float
) -> None:
    """Записывает один обработанный HTTP-запрос.

    Вызывается из middleware на КАЖДЫЙ запрос, поэтому работа минимальная: три
    обращения к словарям и один индекс корзины.
    """
    key = _route_key(method.upper(), route)
    _requests[(key[0], key[1], _status_class(status_code))] += 1
    _seconds_sum[key] += seconds
    _seconds_count[key] += 1
    buckets = _buckets[key]
    for index, edge in enumerate(BUCKETS):
        if seconds <= edge:
            buckets[index] += 1
            break


def gauge(name: str, labels: dict[str, str], value: float) -> None:
    """Записывает гaуг текущей съёмки (значение живёт до следующего `render`)."""
    key = (name, tuple(sorted(labels.items())))
    if key not in _gauges:
        _gauge_order.append(key)
    _gauges[key] = float(value)


def _render_counter(
    name: str, help_text: str, rows: list[tuple[str, int]]
) -> list[str]:
    lines = [f"# HELP {name} {help_text}", f"# TYPE {name} counter"]
    lines += [f"{name}{labels} {value}" for labels, value in rows]
    return lines


def render() -> str:
    """Собирает текст метрик в формате Prometheus exposition 0.0.4."""
    lines: list[str] = []

    request_rows = [
        (
            f'{{method="{_label(method)}",route="{_label(path)}",'
            f'status="{status}"}}',
            count,
        )
        for (method, path, status), count in sorted(_requests.items())
    ]
    lines += _render_counter(
        "pismo_http_requests_total",
        "Обработанные HTTP-запросы (маршрут — шаблон, не реальный путь)",
        request_rows,
    )

    # Доменные счётчики (см. `count`). HELP и TYPE — по одному разу на метрику,
    # дальше только серии: иначе экспозиция нарушает формат при нескольких подписях.
    described: set[str] = set()
    for counter_key in _counter_order:
        counter_name, counter_labels = counter_key
        if counter_name not in described:
            described.add(counter_name)
            lines.append(f"# HELP {counter_name} {_COUNTER_HELP[counter_name]}")
            lines.append(f"# TYPE {counter_name} counter")
        label_text = ",".join(f'{k}="{_label(v)}"' for k, v in counter_labels)
        braces = f"{{{label_text}}}" if label_text else ""
        lines.append(f"{counter_name}{braces} {_counters[counter_key]}")

    lines += [
        "# HELP pismo_http_request_seconds Время обработки HTTP-запросов",
        "# TYPE pismo_http_request_seconds histogram",
    ]
    for method, path in sorted(_seconds_count):
        labels = f'method="{_label(method)}",route="{_label(path)}"'
        counted = _seconds_count[(method, path)]
        cumulative = 0
        for index, edge in enumerate(BUCKETS):
            cumulative += _buckets[(method, path)][index]
            lines.append(
                f"pismo_http_request_seconds_bucket"
                f'{{{labels},le="{edge}"}} {cumulative}'
            )
        # «+Inf» обязан быть равен общему числу наблюдений (по формату), поэтому
        # последней корзиной ставим именно его, а не сумму корзин: наблюдения
        # медленнее 10 с в корзины не попадают.
        lines.append(
            f'pismo_http_request_seconds_bucket{{{labels},le="+Inf"}} {counted}'
        )
        lines.append(
            f"pismo_http_request_seconds_sum{{{labels}}} "
            f"{_seconds_sum[(method, path)]:.6f}"
        )
        lines.append(f"pismo_http_request_seconds_count{{{labels}}} {counted}")

    # Гауги: время жизни процесса считаем сами, остальные ставит тот, кто знает
    # их значение (сокеты, пул БД) — см. api_v1/system/views.py.
    gauge("pismo_process_uptime_seconds", {}, time.monotonic() - _started_at)

    for key in _gauge_order:
        gauge_name, gauge_labels = key
        value = _gauges[key]
        if gauge_name not in _GAUGE_HELP:
            continue
        label_text = ",".join(f'{k}="{_label(v)}"' for k, v in gauge_labels)
        braces = f"{{{label_text}}}" if label_text else ""
        lines.append(f"# HELP {gauge_name} {_GAUGE_HELP[gauge_name]}")
        lines.append(f"# TYPE {gauge_name} gauge")
        lines.append(f"{gauge_name}{braces} {value:.0f}")

    return "\n".join(lines) + "\n"


def reset_for_tests() -> None:
    """Чистит состояние (только для тестов: счётчики живут на процесс)."""
    _requests.clear()
    _seconds_sum.clear()
    _seconds_count.clear()
    _buckets.clear()
    _known_routes.clear()
    _gauges.clear()
    _gauge_order.clear()
    _counters.clear()
    _counter_order.clear()


def snapshot() -> dict[str, Any]:
    """Слепок состояния — для тестов и отладки (в метрики не попадает)."""
    return {
        "routes": len(_known_routes),
        "requests": sum(_requests.values()),
        "series": len(_requests),
    }


__all__ = (
    "BUCKETS",
    "MAX_SERIES",
    "count",
    "gauge",
    "observe_request",
    "render",
    "reset_for_tests",
    "snapshot",
)
