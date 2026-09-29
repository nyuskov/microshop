"""Публикация раздела журнала в канал новостей: разбор и подготовка текста.

Правило проекта — разделы ``docs/changelog.md`` про функционал дублируются постом
в канал «Новости приложения» (id 16). Здесь проверяем ту часть, которую легко
сломать молча: как скрипт находит раздел, отличает уже опубликованное и
инфраструктурное от «ждёт публикации», что попадает в текст поста и куда встаёт
отметка о публикации. Ни БД, ни сети эти тесты не трогают.
"""

from __future__ import annotations

import pytest

from scripts.publish_changelog import (
    Section,
    compose_post,
    find_section,
    insert_marker,
    post_draft,
    split_sections,
)

CHANGELOG = """# Журнал изменений и улучшений

Вводный текст про то, как устроен журнал.

## История: жест вверх сворачивает просмотр (2026-09-29)

Открытая история закрывалась только жестом вниз.

- Разбор жеста вынесен в `storySwipeResult` (`frontend/src/utils/stories.ts`).
- Мелкое смещение жестом не считается.

## Метрики для Prometheus (2026-09-28)

Приложение само отдаёт метрики.

- В канал «Новости приложения» это не публикуем: инфраструктура.

## Чтение без сети (2026-09-27)

Чат открывается без сети из кэша.

Канал «Новости приложения» (id 16): опубликован пост #449.
"""

DRAFT = """## История: жест вверх сворачивает просмотр (2026-09-29)

Что сделали — по-человечески.

<!-- пост в канал
↕️ Историю можно свернуть движением вверх

Смахнул вверх — и ты снова в переписке.
-->
"""


def sections() -> list[Section]:
    """Разделы разобранного журнала."""
    return split_sections(CHANGELOG)


def test_sections_split_by_second_level_headings():
    titles = [section.title for section in sections()]

    assert titles == [
        "История: жест вверх сворачивает просмотр (2026-09-29)",
        "Метрики для Prometheus (2026-09-28)",
        "Чтение без сети (2026-09-27)",
    ]


def test_section_text_stops_at_the_next_heading():
    first, second = sections()[:2]

    assert "storySwipeResult" in first.text
    assert "Prometheus" not in first.text
    # Следующий раздел начинается ровно там, где кончился предыдущий.
    assert first.end == second.start


def test_state_is_read_from_section_text():
    fresh, internal, published = sections()

    assert fresh.state == "ждёт публикации"
    assert internal.state == "в канал не публикуем"
    assert published.published_post_id == 449


def test_section_is_found_by_part_of_heading():
    assert find_section(sections(), "жест вверх").title.startswith("История")


def test_unknown_and_ambiguous_heading_stop_the_work():
    with pytest.raises(SystemExit, match="нет раздела"):
        find_section(sections(), "опросы")

    with pytest.raises(SystemExit, match="несколько разделов"):
        find_section(sections(), "2026-09")


def test_human_draft_wins_over_composed_text():
    plain = find_section(sections(), "жест вверх")
    drafted = find_section(split_sections(DRAFT), "жест вверх")

    assert post_draft(plain) is None
    assert post_draft(drafted) == (
        "↕️ Историю можно свернуть движением вверх\n"
        "\n"
        "Смахнул вверх — и ты снова в переписке."
    )
    assert compose_post(drafted) == post_draft(drafted)


def test_post_is_composed_from_heading_and_bullets_without_internals():
    post = compose_post(find_section(sections(), "жест вверх"))

    # Дата из заголовка в пост не идёт: подписчику она не нужна.
    assert post.startswith("История: жест вверх сворачивает просмотр\n")
    assert "• Разбор жеста вынесен в" in post
    assert "• Мелкое смещение жестом не считается." in post
    # Вложенный код (пути и имена функций) — внутренние детали: вырезаем.
    assert "frontend/src/utils/stories.ts" not in post
    assert "storySwipeResult" not in post
    # Следы вырезанного кода подчищены: ни пустых скобок, ни пробела под точкой.
    assert "()" not in post
    assert " ." not in post


def test_internal_note_never_reaches_the_post():
    post = compose_post(find_section(sections(), "Метрики"))

    assert post.startswith("Метрики для Prometheus\n")
    assert "не публикуем" not in post
    assert "• В канал" not in post


@pytest.mark.parametrize(
    "tail",
    [
        "Канал «Новости приложения» (id 16): опубликован пост #451.",
        "Посты в канале: опубликованы посты **#448**, **#449**.",
        "В канал «Новости приложения» ушёл пост #440.",
    ],
)
def test_published_marker_recognised_in_any_usual_wording(tail: str):
    """Отметки в журнале писали руками — формулировки разные, а смысл один."""
    text = f"{CHANGELOG}\n{tail}\n"
    section = find_section(split_sections(text), "Чтение без сети")

    assert section.published_post_id is not None


def test_section_without_marker_is_not_considered_published():
    assert find_section(sections(), "жест вверх").published_post_id is None


def test_marker_lands_at_the_end_of_its_own_section():
    section = find_section(sections(), "жест вверх")
    updated = insert_marker(CHANGELOG, section, 451)

    marker_at = updated.index("опубликован пост #451.")
    assert updated.index("История: жест") < marker_at < updated.index("## Метрики")
    # Соседний заголовок остался заголовком — отметка его не «съела».
    assert "\n## Метрики для Prometheus" in updated
    # Разделы после правки по-прежнему разбираются.
    assert find_section(split_sections(updated), "жест вверх").published_post_id == 451


def test_marker_is_not_added_twice():
    section = find_section(sections(), "Чтение без сети")

    assert insert_marker(CHANGELOG, section, 500) == CHANGELOG
