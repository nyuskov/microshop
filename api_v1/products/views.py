from fastapi import APIRouter, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from core.models import db_helper
from . import crud
from .dependencies import product_by_id
from .schemas import Product, ProductCreate, ProductUpdate, ProductUpdatePartial


router = APIRouter(tags=["Товары"],)


@router.get(
    "/",
    summary="Получение всех товаров",
    response_model=list[Product],
)
async def get_products(
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    return await crud.get_products(session)


@router.get(
    "/{product_id}/",
    summary="Получение конкреного товара",
    response_model=Product,
)
async def get_product(
    product: Product = Depends(product_by_id),
) -> Product:
    return product


@router.post(
    "/",
    summary="Создание товара",
    response_model=Product,
)
async def create_product(
    product_in: ProductCreate,
    session: AsyncSession = Depends(db_helper.session_dependency),
):
    return await crud.create_product(session=session, product_in=product_in)


@router.put(
    "/{product_id}/",
    summary="Обновление товара",
    response_model=Product,
)
async def update_product(
    product_up: ProductUpdate,
    session: AsyncSession = Depends(db_helper.session_dependency),
    product: Product = Depends(product_by_id),
):
    return await crud.update_product(
        session=session, product=product,
        product_up=product_up)


@router.patch(
    "/{product_id}/",
    summary="Обновление товара",
    response_model=Product,
)
async def update_product_partial(
    product_up: ProductUpdatePartial,
    session: AsyncSession = Depends(db_helper.session_dependency),
    product: Product = Depends(product_by_id),
):
    return await crud.update_product(
        session=session, product=product,
        product_up=product_up, partial=True)
