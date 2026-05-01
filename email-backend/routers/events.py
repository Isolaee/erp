import asyncio
import json
from fastapi import APIRouter, Request, Depends
from fastapi.responses import StreamingResponse
from middleware.auth import get_current_user_id
from services.notifier import subscribe, unsubscribe

router = APIRouter()


@router.get("")
async def sse_events(
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    q = subscribe(user_id)

    async def generate():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            unsubscribe(user_id, q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
