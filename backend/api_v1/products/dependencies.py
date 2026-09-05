"""Зависимости для работы с товарами."""

from typing import Annotated

from fastapi import Depends, HTTPException, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Product, db_helper

from . import crud


async def product_by_id(
    product_id: Annotated[int, Path],
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Product:
    """Возвращает товар по id или вызывает 404."""
    product = await crud.get_product(session=session, product_id=product_id)
    if product is not None:
        return product

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Товар {product_id} не найден!",
    )
