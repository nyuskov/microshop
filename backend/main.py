from contextlib import asynccontextmanager

import asyncio

# import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api_v1 import router_v1
from core.config import settings
from users.views import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI()

app = FastAPI(lifespan=lifespan)
app.include_router(router=router_v1, prefix=settings.api_v1_prefix)
app.include_router(users_router)

origins = ["*"]  # Allows all origins

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
