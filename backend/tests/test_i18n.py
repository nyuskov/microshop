"""Тесты локализации серверных текстов (`core/i18n.py`)."""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

from core.i18n import (
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    current_locale,
    normalize_locale,
    set_locale,
    set_locale_from_client,
    t,
)
from core.i18n_en import EN

BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def _reset_request_locale():
    """Сбрасывает язык запроса после каждого теста.

    `t()` читает ContextVar, а он живёт в процессе: без сброса язык, поставленный
    одним тестом, «протёк» бы в остальные (и в чужие проверки текстов).
    """
    yield
    set_locale(DEFAULT_LOCALE)


def test_unknown_locale_falls_back_to_russian() -> None:
    """Пустой и неизвестный язык — русский: лучше понятный текст, чем пустота."""
    assert normalize_locale(None) == "ru"
    assert normalize_locale("") == "ru"
    assert normalize_locale("de") == "ru"
    assert normalize_locale("EN") == "en"
    assert normalize_locale("en-US") == "en"
    assert normalize_locale("ru_RU") == "ru"


def test_translates_known_text_and_keeps_unknown() -> None:
    """Переведённое — по-английски, непереведённое остаётся русским."""
    assert t("Чат не найден", lang="en") == "The chat was not found"
    assert (
        t("Такого текста нет в каталоге", lang="en") == "Такого текста нет в каталоге"
    )
    assert t("Чат не найден", lang="ru") == "Чат не найден"


def test_substitutes_variables_in_both_languages() -> None:
    """Подстановки работают и в переводе, и в русском исходнике."""
    assert t("Вы в муте ещё примерно {minutes} мин", lang="ru", minutes=5) == (
        "Вы в муте ещё примерно 5 мин"
    )
    assert (
        t("Вы в муте ещё примерно {minutes} мин", lang="en", minutes=5)
        == "You are muted for about 5 min more"
    )


def test_request_locale_is_used_when_lang_not_given() -> None:
    """Язык запроса берётся из ContextVar (его ставит middleware)."""
    set_locale("en")
    try:
        assert current_locale() == "en"
        assert t("Чат не найден") == "The chat was not found"
    finally:
        set_locale(DEFAULT_LOCALE)
    assert t("Чат не найден") == "Чат не найден"


def test_client_header_beats_profile_default() -> None:
    """Заголовок клиента помечает язык как явный — тогда в БД не ходят."""
    assert set_locale_from_client("en") is True
    assert set_locale_from_client("") is False
    assert set_locale_from_client(None) is False


def test_catalog_values_are_translated() -> None:
    """В каталоге нет пустых значений и «переводов», равных исходнику."""
    assert len(EN) > 100
    same = [key for key, value in EN.items() if not value.strip() or value == key]
    assert same == []
    assert set(SUPPORTED_LOCALES) == {"ru", "en"}


def test_catalog_keys_have_matching_placeholders() -> None:
    """Набор подстановок в переводе совпадает с исходником.

    Иначе `{name}` из русского текста остался бы в английском как есть (или
    наоборот — перевод подставлял бы то, чего вызывающий код не передаёт).
    """
    placeholder = re.compile(r"\{(\w+)\}")
    broken: list[str] = []
    for key, value in EN.items():
        if set(placeholder.findall(key)) != set(placeholder.findall(value)):
            broken.append(key)
    assert broken == []


def test_catalog_keys_are_used_in_code() -> None:
    """Каждый ключ каталога встречается в исходниках — «мёртвых» нет.

    Ключ здесь — сам русский текст, поэтому достаточно поиска литерала. Так
    каталог не превращается в свалку из текстов, которые уже переписали.

    Сравниваем «сжатые» варианты: длинный текст в исходнике часто собран из
    нескольких строк конкатенацией, поэтому кавычки, переносы и лишние пробелы
    убираем, а `\\n` внутри литерала превращаем в настоящий перенос (в каталоге
    это именно перенос строки, а не две буквы).
    """

    def squeeze(text: str) -> str:
        return (
            text.replace("\\n", "\n")
            .replace('"', "")
            .replace("'", "")
            .replace(" ", "")
            .replace("\t", "")
            .replace("\n", "")
        )

    sources = []
    for path in (
        list(BACKEND.glob("api_v1/**/*.py"))
        + list(BACKEND.glob("core/**/*.py"))
        + list(BACKEND.glob("tasks/**/*.py"))
        + [BACKEND / "main.py"]
    ):
        if "__pycache__" in path.parts or path.name.startswith("i18n"):
            continue
        sources.append(path.read_text(encoding="utf-8"))
    joined = squeeze("\n".join(sources))

    unused = [key for key in EN if squeeze(key) not in joined]
    assert unused == []


def test_no_f_strings_with_cyrillic_details_left() -> None:
    """В `detail=` не осталось русских f-строк: их нельзя перевести на лету.

    Проверка «сторожевая»: если кто-то снова напишет `detail=f"...русский..."`,
    текст уйдёт англоязычному человеку по-русски.
    """
    pattern = re.compile(r'detail=f"[^"]*[А-Яа-яЁё]')
    offenders: list[str] = []
    for path in (BACKEND / "api_v1").rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
            if pattern.search(line):
                offenders.append(f"{path.relative_to(BACKEND)}:{number}")
    assert offenders == []


def test_catalog_is_a_plain_dict_of_strings() -> None:
    """Каталог — обычный словарь строк (его читает и `t()`, и тесты)."""
    module = ast.parse((BACKEND / "core" / "i18n_en.py").read_text(encoding="utf-8"))
    assign = next(
        node
        for node in module.body
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "EN"
    )
    value = ast.literal_eval(assign.value)
    assert isinstance(value, dict)
    assert all(isinstance(k, str) and isinstance(v, str) for k, v in value.items())


@pytest.mark.parametrize("value", ["en", "ru", None, "de"])
def test_t_never_returns_empty(value: str | None) -> None:
    """`t()` всегда что-то возвращает: пустой строки в интерфейсе быть не должно."""
    assert t("Чат не найден", lang=value)
