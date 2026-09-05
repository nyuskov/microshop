from fastapi import APIRouter

from .auth.jwt import router as jwt_router
from .auth.views import router as auth_router
from .chats.views import router as chats_router
from .general import router as general_router
from .messages.views import router as messages_router
from .posts.views import router as posts_router
from .products.views import router as products_router
from .telegram.views import router as telegram_router
from .users.views import router as users_router

router_v1 = APIRouter()

router_v1.include_router(general_router)
router_v1.include_router(auth_router)
router_v1.include_router(jwt_router)
router_v1.include_router(users_router)
router_v1.include_router(products_router, prefix="/products")
router_v1.include_router(posts_router, prefix="/posts")
router_v1.include_router(chats_router)
router_v1.include_router(messages_router)
router_v1.include_router(telegram_router, prefix="/telegram")
