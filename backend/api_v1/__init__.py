from fastapi import APIRouter

from .auth.jwt import router as jwt_router
from .auth.views import router as auth_router
from .calls.views import router as calls_router
from .calls.views import router_rest as calls_rest_router
from .chats.views import router as chats_router
from .events.views import router as events_router
from .health.views import router as health_router
from .keys.views import router as keys_router
from .link_previews.views import router as link_previews_router
from .messages.views import router as messages_router
from .moderation.views import router as moderation_router
from .push.views import router as push_router
from .stories.views import router as stories_router
from .users.views import router as users_router

router_v1 = APIRouter()

router_v1.include_router(auth_router)
router_v1.include_router(health_router)
router_v1.include_router(jwt_router)
router_v1.include_router(users_router)
router_v1.include_router(chats_router)
router_v1.include_router(keys_router)
router_v1.include_router(messages_router)
router_v1.include_router(link_previews_router)
router_v1.include_router(moderation_router)
router_v1.include_router(push_router)
router_v1.include_router(stories_router)
router_v1.include_router(calls_router)
router_v1.include_router(calls_rest_router)
router_v1.include_router(events_router)
