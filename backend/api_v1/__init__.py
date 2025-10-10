from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer

from .auth.views import router as auth_router
from .auth.jwt import router as jwt_router
from .products.views import router as products_router
from .users.views import router as users_router

http_bearer = HTTPBearer(auto_error=False)

router_v1 = APIRouter(
    dependencies=[Depends(http_bearer)],
)
router_v1.include_router(
    router=products_router,
    prefix="/products",
)
router_v1.include_router(
    router=auth_router,
)
router_v1.include_router(
    router=users_router,
)
router_v1.include_router(
    router=jwt_router,
)
