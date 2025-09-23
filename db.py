import asyncio

from typing import List
from typing import Optional
from sqlalchemy import ForeignKey, text
from sqlalchemy import String
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship
from sqlalchemy.ext.asyncio import create_async_engine


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "user_account"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(30))
    fullname: Mapped[Optional[str]]
    addresses: Mapped[List["Address"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"User(id={self.id!r}, name={self.name!r}, fullname={self.fullname!r})"


class Address(Base):
    __tablename__ = "address"
    id: Mapped[int] = mapped_column(primary_key=True)
    email_address: Mapped[str]
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    user: Mapped["User"] = relationship(back_populates="addresses")

    def __repr__(self) -> str:
        return f"Address(id={self.id!r}, email_address={self.email_address!r})"


# Define your PostgreSQL connection string using the asyncpg driver
DATABASE_URL = "postgresql+asyncpg://postgres:Xx123456@localhost:5432/postgres"

# Create the asynchronous engine
engine = create_async_engine(
    DATABASE_URL,
    echo=True,  # Set to True to log SQL statements for debugging
    future=True,  # Enable future-style API for SQLAlchemy 2.0
)


async def connect_and_query(query: str):
    async with engine.connect() as conn:
        result = await conn.execute(text(query))
        print(result.scalar())
