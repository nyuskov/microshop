from fastapi import APIRouter

from .auth.views import router as auth_router
from .auth.jwt import router as jwt_router

# from .products.views import router as products_router # Удаляем импорт
from .users.views import router as users_router

# from .posts.views import router as posts_router # Импортируем новый роутер - УДАЛЯЕМ
# from .groups.views import router as groups_router # Импорт роутера для групп - УДАЛЯЕМ
from .telegram.views import router as telegram_router  # Импорт роутера для Telegram
from .chats.views import router as chats_router  # Новый импорт
from .messages.views import router as messages_router  # Новый импорт

router_v1 = APIRouter()
# router_v1.include_router( # Удаляем регистрацию
#     router=products_router,
#     prefix="/products",
# )
router_v1.include_router(
    router=auth_router,
)
router_v1.include_router(
    router=users_router,
)
router_v1.include_router(
    router=jwt_router,
)
# # Подключаем роутер для постов - КОММЕНТИРУЕМ
# router_v1.include_router(
#     router=posts_router,
#     prefix="/posts",
# )
# # Подключаем роутер для групп - УДАЛЯЕМ
# router_v1.include_router(
#     router=groups_router,
#     prefix="/groups",
# )
# Подключаем роутер для Telegram
router_v1.include_router(
    router=telegram_router,
    prefix="/telegram",
)
# Подключаем роутер для чатов
router_v1.include_router(
    router=chats_router,
)
# Подключаем роутер для сообщений
router_v1.include_router(
    router=messages_router,
)
