from users import crud
from users.schemas import CreateUser
from fastapi import APIRouter

router = APIRouter(prefix="/users", tags=["Пользователи"],)


@router.post(
    "/",
    summary="Создание пользователя",
)
async def create_user(new_user: CreateUser):
    return crud.create_user(new_user=new_user)
