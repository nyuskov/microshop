"""Тесты политики паролей (``core.passwords``).

Проверяем то, что реально повышает стойкость: длину, чёрный список, запрет
пароля из данных аккаунта, однообразные и последовательные строки.
"""

import pytest

from core.passwords import MAX_LENGTH, MIN_LENGTH, password_problem


def test_short_password_rejected() -> None:
    """Пароль короче минимума не принимаем (и говорим, сколько нужно)."""
    problem = password_problem("a" * (MIN_LENGTH - 1))

    assert problem is not None
    assert str(MIN_LENGTH) in problem


def test_too_long_password_rejected() -> None:
    assert password_problem("aB3" * MAX_LENGTH) is not None


@pytest.mark.parametrize(
    "password",
    ["1234567890", "qwertyuiop", "password123", "пароль", "11111111111"],
)
def test_common_and_weak_passwords_rejected(password: str) -> None:
    assert password_problem(password) is not None


def test_digits_only_rejected() -> None:
    """Даже длинный пароль из одних цифр — это 10^10 вариантов, слишком мало."""
    problem = password_problem("9483726150")

    assert problem is not None
    assert "цифр" in problem


def test_repeated_characters_rejected() -> None:
    problem = password_problem("korova1111moloko")

    assert problem is not None
    assert "одинаковых" in problem


def test_sequential_characters_rejected() -> None:
    problem = password_problem("vesnaabcd12345x")

    assert problem is not None
    assert "последовательностью" in problem


def test_phone_number_inside_password_rejected() -> None:
    """Свой номер в пароле — первое, что подберёт любой, кто знает номер."""
    problem = password_problem("korova79991234567", phone_number="+7 (999) 123-45-67")

    assert problem is not None
    assert "телефона" in problem


def test_email_and_username_inside_password_rejected() -> None:
    assert password_problem("nyuskov-super-pass", email="alerts@example.com") is not None
    # Логин ищем без учёта регистра, поэтому «pismoSpace» внутри пароля — отказ.
    assert password_problem("vesna-pismosPace-42", username="pismoSpace") is not None


def test_password_without_account_data_accepted() -> None:
    """Пароль без данных аккаунта и не из чёрного списка — принимаем."""
    assert password_problem("vesna-listopad-42", username="pismoSpace") is None


def test_good_passphrase_accepted() -> None:
    """Длинная фраза без данных аккаунта — то, что мы хотим от пользователя."""
    assert password_problem("vesna-listopad-42") is None
    assert password_problem("Молоко-корова-77!") is None


def test_password_equal_to_short_login_accepted() -> None:
    """Слишком короткий логин не считаем «данными аккаунта» (ложные срабатывания)."""
    assert password_problem("vesna-listopad-42", username="ab") is None
