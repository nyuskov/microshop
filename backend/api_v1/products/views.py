"""Эндпоинты для работы с товарами."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Product, db_helper

from . import crud
from .dependencies import product_by_id
from .schemas import Product as ProductSchema
from .schemas import ProductCreate, ProductUpdate, ProductUpdatePartial

router = APIRouter(tags=["Товары"])


@router.get("/", summary="Получение всех товаров", response_model=list[ProductSchema])
async def get_products(
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> list[Product]:
    return await crud.get_products(session)


@router.get(
    "/{product_id}/",
    summary="Получение конкретного товара",
    response_model=ProductSchema,
)
async def get_product(product: Product = Depends(product_by_id)) -> Product:
    return product


@router.post(
    "/",
    summary="Создание товара",
    response_model=ProductSchema,
    status_code=status.HTTP_201_CREATED,
)
async def create_product(
    product_in: ProductCreate,
    session: AsyncSession = Depends(db_helper.session_dependency),
) -> Product:
    return await crud.create_product(session=session, product_in=product_in)


@router.put(
    "/{product_id}/",
    summary="Полное обновление товара",
    response_model=ProductSchema,
)
async def update_product(
    product_up: ProductUpdate,
    session: AsyncSession = Depends(db_helper.session_dependency),
    product: Product = Depends(product_by_id),
) -> Product:
    return await crud.update_product(
        session=session, product=product, product_up=product_up
    )


@router.patch(
    "/{product_id}/",
    summary="Частичное обновление товара",
    response_model=ProductSchema,
)
async def update_product_partial(
    product_up: ProductUpdatePartial,
    session: AsyncSession = Depends(db_helper.session_dependency),
    product: Product = Depends(product_by_id),
) -> Product:
    return await crud.update_product(
        session=session, product=product, product_up=product_up, partial=True
    )


@router.delete(
    "/{product_id}/",
    summary="Удаление товара",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_product(
    session: AsyncSession = Depends(db_helper.session_dependency),
    product: Product = Depends(product_by_id),
) -> None:
    await crud.delete_product(session=session, product=product)
