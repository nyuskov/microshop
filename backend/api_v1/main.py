from fastapi import FastAPI

from .auth import router as auth_router
from .posts import router as posts_router
from .products import router as products_router
from .orders import router as orders_router
from .users import router as users_router


def include_routers(app: FastAPI):
    app.include_router(auth_router)
    app.include_router(posts_router)
    app.include_router(products_router)
    app.include_router(orders_router)
    app.include_router(users_router)
    # app.include_router(groups_router) # Удаление неправильного подключения