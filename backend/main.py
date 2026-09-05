import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_v1 import router_v1
from core.config import settings

app = FastAPI(
    title="Microshop",
    swagger_ui_parameters={"favicon_url": "/favicon.ico"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router=router_v1, prefix=settings.api_v1_prefix)


@app.get(
    "/",
    tags=["Базовый функционал"],
    summary="Главная страница",
)
async def read_root() -> dict[str, str]:
    return {"Hello": "World"}


if __name__ == "__main__":
    uvicorn.run("main:app", reload=True)
