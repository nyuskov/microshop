__all__ = {
    "Base",
    "DatabaseHelper",
    "db_helper",
    "Order",
    "Post",
    "Product",
    "Profile",
    "User",
    "Group",  # Добавляем Group в экспорт
}

from .base import Base
from .db_helper import DatabaseHelper, db_helper
from .order import Order
from .post import Post
from .product import Product
from .profile import Profile
from .user import User
from .group import Group  # Импортируем Group
