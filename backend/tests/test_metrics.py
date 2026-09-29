"""Метрики: формат выдачи и ограничение кардинальности.

Проверяем то, что легко сломать молча: кумулятивные корзины гистограммы (иначе
графики врут), `+Inf`, совпадающий с числом наблюдений, сворачивание лишних
маршрутов в `other` (защита памяти от сканеров) и экранирование подписей.
"""

import pytest

from core import metrics


@pytest.fixture(autouse=True)
def _clean() -> None:
    """Каждый тест начинает со чистых счётчиков: они живут на процесс."""
    metrics.reset_for_tests()
    yield
    metrics.reset_for_tests()


def test_request_counter_and_histogram() -> None:
    metrics.observe_request("GET", "/api/v1/chats/", 200, 0.003)
    metrics.observe_request("GET", "/api/v1/chats/", 200, 0.4)
    metrics.observe_request("POST", "/api/v1/messages/", 500, 12.0)

    text = metrics.render()

    assert (
        'pismo_http_requests_total{method="GET",route="/api/v1/chats/",status="2xx"} 2'
        in text
    )
    assert (
        'pismo_http_requests_total{method="POST",route="/api/v1/messages/",'
        'status="5xx"} 1' in text
    )
    # Корзины кумулятивные: 0.003 попало только в первую, 0.4 — во все до 0.5.
    assert (
        'pismo_http_request_seconds_bucket{method="GET",route="/api/v1/chats/",'
        'le="0.005"} 1' in text
    )
    assert (
        'pismo_http_request_seconds_bucket{method="GET",route="/api/v1/chats/",'
        'le="0.5"} 2' in text
    )
    assert (
        'pismo_http_request_seconds_count{method="GET",'
        'route="/api/v1/chats/"} 2' in text
    )


def test_inf_matches_observations_even_for_slow_requests() -> None:
    """Медленный запрос не влезает в последнюю корзину, но обязан войти в `+Inf`."""
    metrics.observe_request("GET", "/api/v1/slow/", 200, 42.0)

    text = metrics.render()

    assert 'route="/api/v1/slow/",le="+Inf"} 1' in text
    assert 'route="/api/v1/slow/",le="10.0"} 0' in text


def test_unknown_route_gets_own_series() -> None:
    """Запрос без маршрута (404 на неизвестный путь) — отдельная серия."""
    metrics.observe_request("GET", None, 404, 0.001)

    assert 'route="unmatched"' in metrics.render()


def test_cardinality_is_capped() -> None:
    """Сканер, перебирающий пути, не должен раздувать память сериями."""
    for index in range(metrics.MAX_SERIES + 20):
        metrics.observe_request("GET", f"/api/v1/scan-{index}/", 404, 0.001)

    text = metrics.render()

    assert 'route="other"' in text
    assert metrics.snapshot()["routes"] <= metrics.MAX_SERIES
    # Уже известные маршруты остаются под своими именами.
    assert 'route="/api/v1/scan-0/"' in text


def test_gauges_need_help_text() -> None:
    """Выводим только те гауги, у которых есть HELP/TYPE (иначе метрика-мусор)."""
    metrics.gauge("pismo_ws_sockets", {"kind": "events"}, 3)
    metrics.gauge("pismo_неизвестный", {}, 1)

    text = metrics.render()

    assert 'pismo_ws_sockets{kind="events"} 3' in text
    assert "# TYPE pismo_ws_sockets gauge" in text
    assert "pismo_неизвестный" not in text
    assert "pismo_process_uptime_seconds" in text


def test_labels_are_escaped() -> None:
    """Подпись с кавычкой не должна ломать формат (иначе Prometheus не прочтёт)."""
    metrics.gauge("pismo_ws_users", {"kind": 'event"s'}, 1)

    assert 'pismo_ws_users{kind="event\\"s"} 1' in metrics.render()
