import pytest
from httpx import AsyncClient, ASGITransport

from api_v1.users.crud import get_users_with_posts_and_profiles
from core.models import db_helper
from main import app


@pytest.mark.asyncio
async def test_read_root():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
    ) as ac:
        response = await ac.get("/")
        assert response.status_code == 200
        assert response.json() == {"Hello": "World"}


@pytest.mark.asyncio
async def test_get_users():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://test",
    ) as ac:
        response = await ac.get("/api/v1/users/")
        session = db_helper.get_scoped_session()
        users = await get_users_with_posts_and_profiles(session)
        session.close()

        assert response.status_code == 200
        assert response.json() == users
