"""Политика паролей: длина, чёрный список, привязка к данным аккаунта.

Правила намеренно «правила длины и здравого смысла», без обязательных
заглавных/цифр/символов: композиционные требования (NIST SP 800-63B) не повышают
стойкость — люди пишут ``Password1!`` и обходят их. Вместо этого: минимальная
длина, чёрный список частых паролей, запрет пароля из данных самого аккаунта
(номер, e-mail, логин), однообразных и последовательных строк.

Модуль используется и сервером (``password/register``, ``password/set``), и
фронтендом — те же проверки в UI, чтобы человек не получал ошибку уже после
отправки формы.
"""

MIN_LENGTH = 10
MAX_LENGTH = 128

# Минимальная длина повторяющегося/последовательного фрагмента.
_REPEAT_RUN = 4
_SEQUENCE_RUN = 4

# Частые пароли (нижний регистр). Полные топ-1000 живут в отдельных словарях;
# здесь — то, что реально встречается в утечках и вбивается «на скорость».
COMMON_PASSWORDS: frozenset[str] = frozenset(
    {
        "123456",
        "1234567",
        "12345678",
        "123456789",
        "1234567890",
        "111111",
        "1111111",
        "11111111",
        "222222",
        "333333",
        "444444",
        "555555",
        "666666",
        "777777",
        "888888",
        "999999",
        "000000",
        "121212",
        "112233",
        "131313",
        "159753",
        "654321",
        "987654321",
        "qwerty",
        "qwerty123",
        "qwertyuiop",
        "qwerty1",
        "qwerty12",
        "qwer1234",
        "qwe123",
        "qweasd",
        "qweasdzxc",
        "qazwsx",
        "qazwsxedc",
        "1q2w3e",
        "1q2w3e4r",
        "1q2w3e4r5t",
        "1qaz2wsx",
        "1qazxsw2",
        "zaq12wsx",
        "q1w2e3r4",
        "asdfgh",
        "asdfghjkl",
        "zxcvbnm",
        "zxcvbn",
        "asdasd",
        "password",
        "password1",
        "password123",
        "passw0rd",
        "p@ssw0rd",
        "pass1234",
        "parol",
        "parol123",
        "admin",
        "admin123",
        "administrator",
        "root",
        "toor",
        "test",
        "test123",
        "guest",
        "master",
        "welcome",
        "welcome1",
        "letmein",
        "trustno1",
        "hello",
        "hello123",
        "monkey",
        "dragon",
        "sunshine",
        "princess",
        "superman",
        "batman",
        "football",
        "soccer",
        "baseball",
        "basketball",
        "iloveyou",
        "iloveu",
        "loveyou",
        "love123",
        "mylove",
        "privet",
        "privet123",
        "michael",
        "jordan",
        "harley",
        "ranger",
        "hunter",
        "buster",
        "thomas",
        "tigger",
        "robert",
        "andrey",
        "sergey",
        "dmitry",
        "alexey",
        "vladimir",
        "nikita",
        "natasha",
        "tatiana",
        "ekaterina",
        "moskva",
        "russia",
        "samsung",
        "iphone",
        "android",
        "google",
        "telegram",
        "whatsapp",
        "vkontakte",
        "yandex",
        "freedom",
        "whatever",
        "starwars",
        "pokemon",
        "computer",
        "internet",
        "secret",
        "default",
        "changeme",
        "qwertyui",
        "йцукен",
        "йцукенгшщз",
        "пароль",
        "привет",
        "любовь",
        "россия",
        "москва",
        "наташа",
        "андрей",
        "сергей",
        "любимый",
        "люблю",
    }
)


def _has_same_char_run(password: str, run: int) -> bool:
    """Есть ли подряд ``run`` одинаковых символов (``aaaa``, ``1111``)."""
    streak = 1
    for previous, current in zip(password, password[1:]):
        streak = streak + 1 if current == previous else 1
        if streak >= run:
            return True
    return False


def _has_sequence_run(password: str, run: int) -> bool:
    """Есть ли подряд ``run`` символов, идущих по алфавиту/цифрам подряд."""
    streak = 1
    for previous, current in zip(password, password[1:]):
        step = ord(current) - ord(previous)
        streak = streak + 1 if step in (1, -1) else 1
        if streak >= run:
            return True
    return False


def _only_digits(password: str) -> bool:
    return password.isdigit()


def _digits(value: str) -> str:
    return "".join(char for char in value if char.isdigit())


def _contains_personal_data(
    password: str, *, phone_number: str | None, email: str | None, username: str | None
) -> str | None:
    """Ищет в пароле данные самого аккаунта (номер, e-mail, логин)."""
    candidate = password.lower()

    if phone_number:
        phone_digits = _digits(phone_number)
        # Сравниваем и полный номер, и «национальную» часть без кода страны.
        if len(phone_digits) >= 10 and (
            phone_digits in _digits(password) or phone_digits[-10:] in _digits(password)
        ):
            return "номер телефона"

    if email:
        local_part = email.split("@", 1)[0].lower()
        if len(local_part) >= 3 and local_part in candidate:
            return "адрес почты"

    if username and len(username) >= 3 and username.lower() in candidate:
        return "логин"

    return None


def password_problem(
    password: str,
    *,
    phone_number: str | None = None,
    email: str | None = None,
    username: str | None = None,
) -> str | None:
    """Возвращает причину отказа или ``None``, если пароль допустим.

    Сообщение готово к показу пользователю (используется в 400 от API и в UI).
    """
    if len(password) < MIN_LENGTH:
        return f"Пароль должен быть не короче {MIN_LENGTH} символов."
    if len(password) > MAX_LENGTH:
        return f"Пароль не может быть длиннее {MAX_LENGTH} символов."

    normalized = password.strip().lower()
    if normalized in COMMON_PASSWORDS:
        return "Такой пароль слишком часто встречается — выберите другой."
    if _only_digits(password):
        return "Пароль не должен состоять только из цифр."
    if _has_same_char_run(password, _REPEAT_RUN):
        return f"Пароль не должен содержать {_REPEAT_RUN} одинаковых символа подряд."
    if _has_sequence_run(password, _SEQUENCE_RUN):
        return "Пароль не должен быть простой последовательностью символов."

    personal = _contains_personal_data(
        password,
        phone_number=phone_number,
        email=email,
        username=username,
    )
    if personal:
        return f"Пароль не должен содержать {personal}."

    return None
