from fastapi import APIRouter, Response
import secrets

router = APIRouter(tags=["General"])


@router.get("/set-csrf-token")
def set_csrf_token(response: Response):
    """
    Endpoint to generate and set a CSRF token as a cookie.
    Also returns the token in the response body for immediate use by the frontend.
    """
    csrf_token = secrets.token_urlsafe(32)  # Generate a secure random token
    # Set the token in a cookie with HttpOnly and SameSite flags for security
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        httponly=True,  # Prevents client-side JS from accessing the cookie
        samesite="lax",  # Balances security and usability for CSRF
        max_age=3600,  # Optional: set a reasonable expiration time (e.g., 1 hour)
        # secure=True,  # Uncomment if using HTTPS in production
    )
    # Return the token in the response body as well, so the frontend can use it immediately
    return {"csrf_token": csrf_token}
