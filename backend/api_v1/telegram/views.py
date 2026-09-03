from fastapi import APIRouter

router = APIRouter()


@router.post("/webhook")
async def telegram_webhook():
    """
    Эндпоинт для получения webhook от Telegram.
    TODO: Реализовать логику обработки сообщений.
    """
    return {"status": "ok"}
