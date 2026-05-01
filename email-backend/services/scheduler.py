from apscheduler.schedulers.asyncio import AsyncIOScheduler
from config import get_settings

_scheduler = AsyncIOScheduler()


async def _get_all_user_ids() -> list[str]:
    from db.database import SessionLocal
    from db.models import Account
    from sqlalchemy import select, distinct
    async with SessionLocal() as db:
        rows = (await db.execute(select(distinct(Account.user_id)))).scalars().all()
        return list(rows)


async def _sync_all():
    from services.gmail_sync import sync_gmail
    from services.outlook_sync import sync_outlook
    from services.imap_sync import sync_imap
    from services.google_calendar import sync_events

    user_ids = await _get_all_user_ids()
    if not user_ids:
        return

    for user_id in user_ids:
        try:
            await sync_gmail(user_id)
        except Exception as e:
            print(f"[scheduler] Gmail sync error for user {user_id}: {e}")

        try:
            await sync_outlook(user_id)
        except Exception as e:
            print(f"[scheduler] Outlook sync error for user {user_id}: {e}")

        try:
            await sync_imap(user_id)
        except Exception as e:
            print(f"[scheduler] IMAP sync error for user {user_id}: {e}")

        try:
            await sync_events(user_id)
        except Exception as e:
            print(f"[scheduler] Calendar sync error for user {user_id}: {e}")


async def start_scheduler():
    settings = get_settings()
    _scheduler.add_job(_sync_all, "interval", seconds=settings.sync_interval_seconds, id="sync_all")
    _scheduler.start()
    _scheduler.add_job(_sync_all, "date", id="sync_initial")


async def stop_scheduler():
    _scheduler.shutdown(wait=False)
