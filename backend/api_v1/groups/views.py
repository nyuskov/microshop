from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from api_v1.auth.validation import (
    get_current_active_admin_user,
)  # Импорт правильной зависимости
from api_v1.groups import crud
from core.models import (
    db_helper,
    Group as ORMGroup,
)  # Переименовываем ORM модель для ясности
from api_v1.groups.schemas import (
    GroupCreate,
    GroupUpdate,
    GroupUpdatePartial,
    Group,
)  # Импортируем Pydantic-схему Group

router = APIRouter(tags=["Groups"])


@router.get("/")
async def get_groups(
    user: Annotated[
        dict, Depends(get_current_active_admin_user)
    ],  # Использование правильной зависимости
    session: AsyncSession = Depends(
        db_helper.session_dependency
    ),  # Исправлено: session_dependency вместо scoped_session_dependency
) -> list[Group]:  # Используем Pydantic-схему Group, а не ORM модель
    return await crud.get_all_groups(session)


@router.get("/{group_id}/")
async def get_group(
    user: Annotated[
        dict, Depends(get_current_active_admin_user)
    ],  # Использование правильной зависимости
    group_id: int,
    session: AsyncSession = Depends(
        db_helper.session_dependency
    ),  # Исправлено: session_dependency вместо scoped_session_dependency
) -> Group:  # Используем Pydantic-схему Group, а не ORM модель
    group = await crud.get_group_by_id(session, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )
    return group


@router.post(
    "/",
    status_code=status.HTTP_201_CREATED,
)
async def create_group(
    user: Annotated[
        dict, Depends(get_current_active_admin_user)
    ],  # Использование правильной зависимости
    group_in: GroupCreate,
    session: AsyncSession = Depends(
        db_helper.session_dependency
    ),  # Исправлено: session_dependency вместо scoped_session_dependency
) -> Group:  # Используем Pydantic-схему Group, а не ORM модель
    return await crud.create_group(session, group_in.model_dump())


@router.patch("/{group_id}/")
async def update_group_partial(
    user: Annotated[
        dict, Depends(get_current_active_admin_user)
    ],  # Использование правильной зависимости
    group_id: int,
    group_update: GroupUpdatePartial,
    session: AsyncSession = Depends(
        db_helper.session_dependency
    ),  # Исправлено: session_dependency вместо scoped_session_dependency
) -> Group:  # Используем Pydantic-схему Group, а не ORM модель
    group = await crud.get_group_by_id(session, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )
    group_update_dict = group_update.model_dump(exclude_unset=True)
    return await crud.update_group(session, group, group_update_dict)


@router.put("/{group_id}/")
async def update_group(
    user: Annotated[
        dict, Depends(get_current_active_admin_user)
    ],  # Использование правильной зависимости
    group_id: int,
    group_update: GroupUpdate,
    session: AsyncSession = Depends(
        db_helper.session_dependency
    ),  # Исправлено: session_dependency вместо scoped_session_dependency
) -> Group:  # Используем Pydantic-схему Group, а не ORM модель
    group = await crud.get_group_by_id(session, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )
    return await crud.update_group(session, group, group_update.model_dump())


@router.delete(
    "/{group_id}/",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_group(
    user: Annotated[
        dict, Depends(get_current_active_admin_user)
    ],  # Использование правильной зависимости
    group_id: int,
    session: AsyncSession = Depends(
        db_helper.session_dependency
    ),  # Исправлено: session_dependency вместо scoped_session_dependency
):
    group = await crud.get_group_by_id(session, group_id)
    if group is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found",
        )
    await crud.delete_group(session, group)
