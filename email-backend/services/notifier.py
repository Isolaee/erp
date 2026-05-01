import asyncio
from collections import defaultdict
from typing import Any

_subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)


def subscribe(user_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subscribers[user_id].add(q)
    return q


def unsubscribe(user_id: str, q: asyncio.Queue):
    _subscribers[user_id].discard(q)


async def broadcast(user_id: str, event: dict[str, Any]):
    for q in list(_subscribers[user_id]):
        await q.put(event)
