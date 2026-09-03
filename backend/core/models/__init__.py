__all__ = {
    "Base",
    "DatabaseHelper",
    "db_helper",
    # "Order", # Убираем из экспорта
    # "Post", # Убираем из экспорта
    # "Product", # Убираем из экспорта
    "Profile",
    "User",
    # "Group", # Убираем Group из экспорта
    "Chat",  # Новая модель
    "Message",  # Новая модель
    "user_chat_association_table",  # Добавляем таблицу в экспорт
}

from .base import Base
from .db_helper import DatabaseHelper, db_helper

# from .order import Order # Убираем из импортов
# from .post import Post # Убираем из импортов
# from .product import Product # Убираем из импортов
from .profile import Profile
from .user import User

# from .group import Group # Убираем импорт Group
from .chat import Chat, user_chat_association_table  # Импортируем таблицу
from .message import Message
