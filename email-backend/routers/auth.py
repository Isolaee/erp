from fastapi import APIRouter, Request, Depends
from fastapi.responses import RedirectResponse
from middleware.auth import get_current_user_id

router = APIRouter()


def _base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


@router.get("/google")
async def google_auth(
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    from services.gmail_sync import get_gmail_auth_url
    url = get_gmail_auth_url(_base_url(request), user_id)
    return {"url": url}


@router.get("/google/callback")
async def google_callback(request: Request, code: str, state: str | None = None):
    # state carries the user_id set in get_gmail_auth_url
    if not state:
        return RedirectResponse("/?auth=google_error&reason=missing_state")
    from services.gmail_sync import handle_gmail_callback
    import asyncio
    await handle_gmail_callback(code, _base_url(request), state)
    asyncio.get_event_loop().create_task(_trigger_gmail_sync(state))
    return RedirectResponse("/?auth=google_ok")


async def _trigger_gmail_sync(user_id: str):
    from services.gmail_sync import sync_gmail
    try:
        await sync_gmail(user_id)
    except Exception as e:
        print(f"[auth] Post-OAuth Gmail sync failed for user {user_id}: {e}")


@router.get("/microsoft")
async def microsoft_auth(
    account: str | None = None,
    user_id: str = Depends(get_current_user_id),
):
    from services.outlook_sync import get_outlook_auth_url
    url = get_outlook_auth_url(account, user_id)
    return {"url": url}


@router.get("/microsoft/callback")
async def microsoft_callback(code: str, state: str | None = None):
    from services.outlook_sync import handle_outlook_callback
    await handle_outlook_callback(code, state)
    return RedirectResponse("/?auth=microsoft_ok")


@router.get("/status")
async def auth_status(user_id: str = Depends(get_current_user_id)):
    from services.gmail_sync import is_gmail_authenticated
    from services.outlook_sync import is_outlook_authenticated
    from config import get_settings
    s = get_settings()
    return {
        "google": is_gmail_authenticated(user_id),
        "microsoft": {acc: is_outlook_authenticated(acc) for acc in s.outlook_account_list},
    }
