import asyncio
from contextlib import asynccontextmanager

# import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_v1 import router_v1
from core.config import settings
from core.middleware import SimpleMiddleware
from core.models import db_helper


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await db_helper.dispose()


app = FastAPI(
    lifespan=lifespan,
    swagger_ui_parameters={"favicon_url": "/favicon.ico"},
)
app.include_router(router=router_v1, prefix=settings.api_v1_prefix)

origins = ["*"]  # Allows all origins

app.add_middleware(SimpleMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (GET, POST, PUT, DELETE, etc.)
    allow_headers=["*"],  # Allows all headers
)


@app.get(
    "/",
    tags=["Базовый функционал"],
    summary="Главная страница",
)
async def read_root():
    return {"Hello": "World"}


if __name__ == "__main__":
    # uvicorn.run("main:app", reload=True)
    asyncio.run(app())
