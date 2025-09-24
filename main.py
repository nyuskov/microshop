import uvicorn

from typing import Union
from fastapi import FastAPI
from pydantic import BaseModel, EmailStr

app = FastAPI()


class CreateUser(BaseModel):
    email: EmailStr
    name: str


@app.get(
    "/",
    tags=["Базовый функционал"],
    summary="Главная страница",
)
async def read_root():
    return {"Hello": "World"}


@app.get(
    "/items/",
    tags=["Товары"],
    summary="Все товары",
)
async def read_items(item_id: int, q: Union[str, None] = None):
    return [
        "Товар 1",
        "Товар 2",
        "Товар 3",
    ]


@app.get(
    "/items/{item_id}/",
    tags=["Товары"],
    summary="Конкретный товар",
)
async def read_item(item_id: int, q: Union[str, None] = None):
    return {"item_id": item_id, "q": q, }


@app.post(
    "/users/",
    tags=["Пользователи"],
    summary="Создание пользователя",
)
async def create_user(new_user: CreateUser):
    return {"success": True, "message": "Пользователь создан успешно!", }


if __name__ == "__main__":
    uvicorn.run("main:app", reload=True)
