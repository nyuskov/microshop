from typing import List # Добавим импорт List
from pydantic import BaseModel

from api_v1.users.schemas import PublicUserSchema # Импортируем схему пользователя


class GroupBase(BaseModel):
    name: str
    description: str | None = None


class GroupCreate(GroupBase):
    pass


class GroupUpdate(GroupBase):
    pass


class GroupUpdatePartial(GroupBase):
    name: str | None = None
    description: str | None = None


class Group(GroupBase):
    id: int
    users: List[PublicUserSchema] = [] # Явно добавляем поле users с типом списка схемы пользователя

    class Config:
        from_attributes = True


# --- Новая схема для обновления пользователей в группе ---
class GroupUsersUpdate(BaseModel):
    user_ids: list[int]
# --- Конец новой схемы ---