from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.security import HTTPBasic, HTTPBasicCredentials

router = APIRouter(prefix="/auth", tags=["Аутентификация"])

security = HTTPBasic()


@router.get("/basic-auth/")
def basic_auth_credentials(
    credentials: Annotated[HTTPBasicCredentials, Depends(security)],
):
    return {
        "message": "ok",
        "username": credentials.username,
        "password": credentials.password,
    }
