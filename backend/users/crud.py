from users.schemas import CreateUser


def create_user(new_user: CreateUser) -> dict:
    user = new_user.model_dump()
    return {
        "success": True,
        "user": user,
    }
