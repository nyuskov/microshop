from fastapi import APIRouter

from .auth.jwt import router as jwt_router
from .auth.views import router as auth_router
from .calls.views import router as calls_router
from .chats.views import router as chats_router
from .events.views import router as events_router
from .keys.views import router as keys_router
from .messages.views import router as messages_router
from .push.views import router as push_router
from .users.views import router as users_router

router_v1 = APIRouter()

router_v1.include_router(auth_router)
router_v1.include_router(jwt_router)
router_v1.include_router(users_router)
router_v1.include_router(chats_router)
router_v1.include_router(keys_router)
router_v1.include_router(messages_router)
router_v1.include_router(push_router)
router_v1.include_router(calls_router)
router_v1.include_router(events_router)
