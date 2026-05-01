from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime
from db.database import get_db
from db.models import CalendarEvent
from middleware.auth import get_current_user_id
import json

router = APIRouter()


class EventCreate(BaseModel):
    title: str
    description: str = ""
    location: str = ""
    start_time: datetime
    end_time: datetime
    attendees: list[str] = []
    calendar_id: str = "primary"
    reminder_minutes: int | None = None


class EventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    location: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    attendees: list[str] | None = None


@router.get("")
async def list_events(
    start: datetime | None = None,
    end: datetime | None = None,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    stmt = select(CalendarEvent).where(CalendarEvent.user_id == user_id).order_by(CalendarEvent.start_time)
    if start:
        stmt = stmt.where(CalendarEvent.start_time >= start)
    if end:
        stmt = stmt.where(CalendarEvent.start_time <= end)
    events = (await db.execute(stmt)).scalars().all()
    return [_event_dict(e) for e in events]


@router.post("")
async def create_event(
    body: EventCreate,
    user_id: str = Depends(get_current_user_id),
):
    from services.google_calendar import create_calendar_event
    event = await create_calendar_event(
        user_id=user_id,
        title=body.title,
        description=body.description,
        location=body.location,
        start_time=body.start_time,
        end_time=body.end_time,
        attendees=body.attendees,
        calendar_id=body.calendar_id,
        reminder_minutes=body.reminder_minutes,
    )
    return event


@router.put("/{event_id}")
async def update_event(
    event_id: str,
    body: EventUpdate,
    user_id: str = Depends(get_current_user_id),
):
    from services.google_calendar import update_calendar_event
    event = await update_calendar_event(user_id, event_id, body.model_dump(exclude_none=True))
    return event


@router.delete("/{event_id}")
async def delete_event(
    event_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from services.google_calendar import delete_calendar_event
    await delete_calendar_event(event_id)
    return {"deleted": event_id}


@router.post("/sync")
async def sync_calendar(user_id: str = Depends(get_current_user_id)):
    from services.google_calendar import sync_events
    count = await sync_events(user_id)
    return {"synced": count}


def _event_dict(e: CalendarEvent) -> dict:
    return {
        "id": e.google_event_id,
        "title": e.title,
        "description": e.description,
        "location": e.location,
        "start_time": e.start_time.isoformat() if e.start_time else None,
        "end_time": e.end_time.isoformat() if e.end_time else None,
        "is_all_day": e.is_all_day,
        "attendees": json.loads(e.attendees) if e.attendees else [],
        "calendar_id": e.calendar_id,
    }
