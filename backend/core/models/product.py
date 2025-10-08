from sqlalchemy.orm import Mapped

from .base import Base
from .mixins import IdIntPkMixin


class Product(IdIntPkMixin, Base):
    name: Mapped[str]
    price: Mapped[int]
    description: Mapped[str]
