from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

# Создаем глобальный экземпляр PasswordHash, использующий argon2
password_hasher = PasswordHash(hashers=[Argon2Hasher()])


def get_password_hash(password: str) -> str:
    """Хеширует пароль и возвращает хеш."""
    return password_hasher.hash(password)
