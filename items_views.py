from typing import Annotated, Union
from fastapi import APIRouter, Path

router = APIRouter(prefix="/items", tags=["Товары"],)


@router.get(
    "/",
    summary="Все товары",
)
async def read_items(item_id: int, q: Union[str, None] = None):
    return [
        "Товар 1",
        "Товар 2",
        "Товар 3",
    ]


@router.get(
    "/{item_id}/",
    summary="Конкретный товар",
)
async def read_item(item_id: Annotated[int, Path(ge=1, lt=1_000_000)],
                    q: Union[str, None] = None):
    return {"item_id": item_id, "q": q, }
