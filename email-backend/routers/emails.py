from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, or_
from db.database import get_db
from db.models import Email, Account
from middleware.auth import get_current_user_id
import json

router = APIRouter()


@router.get("")
async def list_emails(
    account_id: int | None = None,
    search: str | None = None,
    unread_only: bool = False,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    stmt = (
        select(Email, Account.email.label("account_email"), Account.provider)
        .join(Account)
        .where(Account.user_id == user_id)
        .order_by(desc(Email.date))
        .limit(limit)
        .offset(offset)
    )
    if account_id:
        stmt = stmt.where(Email.account_id == account_id)
    if unread_only:
        stmt = stmt.where(Email.is_read == False)  # noqa: E712
    if search:
        term = f"%{search}%"
        stmt = stmt.where(
            or_(Email.subject.ilike(term), Email.sender.ilike(term), Email.body_text.ilike(term))
        )

    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": e.id,
            "account_id": e.account_id,
            "account_email": account_email,
            "provider": provider,
            "message_id": e.message_id,
            "thread_id": e.thread_id,
            "subject": e.subject,
            "sender": e.sender,
            "recipients": json.loads(e.recipients) if e.recipients else [],
            "date": e.date.isoformat() if e.date else None,
            "is_read": e.is_read,
            "is_starred": e.is_starred,
            "labels": json.loads(e.labels) if e.labels else [],
            "snippet": e.raw_snippet,
        }
        for e, account_email, provider in rows
    ]


@router.get("/accounts/list")
async def list_accounts(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    rows = (await db.execute(select(Account).where(Account.user_id == user_id))).scalars().all()
    return [
        {
            "id": a.id,
            "email": a.email,
            "provider": a.provider,
            "display_name": a.display_name,
            "last_synced_at": a.last_synced_at.isoformat() if a.last_synced_at else None,
        }
        for a in rows
    ]


@router.get("/{email_id}")
async def get_email(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    stmt = (
        select(Email, Account.email.label("account_email"), Account.provider)
        .join(Account)
        .where(Email.id == email_id, Account.user_id == user_id)
    )
    row = (await db.execute(stmt)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Email not found")
    e, account_email, provider = row
    return {
        "id": e.id,
        "account_id": e.account_id,
        "account_email": account_email,
        "provider": provider,
        "message_id": e.message_id,
        "thread_id": e.thread_id,
        "subject": e.subject,
        "sender": e.sender,
        "recipients": json.loads(e.recipients) if e.recipients else [],
        "date": e.date.isoformat() if e.date else None,
        "body_text": e.body_text,
        "is_read": e.is_read,
        "is_starred": e.is_starred,
        "labels": json.loads(e.labels) if e.labels else [],
        "snippet": e.raw_snippet,
    }


class LabelUpdate(BaseModel):
    add: list[str] = []
    remove: list[str] = []


class SendEmailBody(BaseModel):
    account_id: int
    to: str
    subject: str
    body: str


class ReplyEmailBody(BaseModel):
    body: str


def _parse_email_address(sender: str) -> str:
    if "<" in sender and ">" in sender:
        return sender.split("<")[1].rstrip(">").strip()
    return sender.strip()


@router.post("/send")
async def send_email(
    body: SendEmailBody,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    account = (await db.execute(
        select(Account).where(Account.id == body.account_id, Account.user_id == user_id)
    )).scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if account.provider == "gmail":
        from services.gmail_sync import gmail_send
        sent_id = gmail_send(user_id, body.to, body.subject, body.body)
    elif account.provider == "outlook":
        from services.outlook_sync import outlook_send
        await outlook_send(user_id, account.email, body.to, body.subject, body.body)
        sent_id = None
    elif account.provider == "imap":
        from services.imap_sync import imap_send
        await imap_send(body.to, body.subject, body.body)
        sent_id = None
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {account.provider}")

    return {"ok": True, "sent_id": sent_id}


@router.post("/{email_id}/reply")
async def reply_email(
    email_id: int,
    body: ReplyEmailBody,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    stmt = select(Email, Account).join(Account).where(Email.id == email_id, Account.user_id == user_id)
    row = (await db.execute(stmt)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Email not found")
    email, account = row

    reply_to = _parse_email_address(email.sender)
    reply_subject = email.subject if email.subject.startswith("Re:") else f"Re: {email.subject}"

    if account.provider == "gmail":
        from services.gmail_sync import gmail_send
        sent_id = gmail_send(user_id, reply_to, reply_subject, body.body, thread_id=email.thread_id)
    elif account.provider == "outlook":
        from services.outlook_sync import outlook_reply
        await outlook_reply(user_id, account.email, email.message_id, body.body)
        sent_id = None
    elif account.provider == "imap":
        from services.imap_sync import imap_send
        await imap_send(reply_to, reply_subject, body.body, reply_to_message_id=email.thread_id)
        sent_id = None
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {account.provider}")

    return {"ok": True, "sent_id": sent_id}


@router.patch("/{email_id}/labels")
async def update_labels(
    email_id: int,
    body: LabelUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    stmt = select(Email, Account).join(Account).where(Email.id == email_id, Account.user_id == user_id)
    row = (await db.execute(stmt)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Email not found")
    email, account = row

    current = set(json.loads(email.labels) if email.labels else [])
    current.update(body.add)
    current.difference_update(body.remove)
    email.labels = json.dumps(sorted(current))

    if account.provider == "gmail":
        if "UNREAD" in body.add:
            email.is_read = False
        if "UNREAD" in body.remove:
            email.is_read = True
        if "STARRED" in body.add:
            email.is_starred = True
        if "STARRED" in body.remove:
            email.is_starred = False
    elif account.provider == "imap":
        if "\\Seen" in body.add:
            email.is_read = True
        if "\\Seen" in body.remove:
            email.is_read = False
        if "\\Flagged" in body.add:
            email.is_starred = True
        if "\\Flagged" in body.remove:
            email.is_starred = False

    await db.commit()

    try:
        if account.provider == "gmail":
            from services.gmail_sync import modify_gmail_labels
            modify_gmail_labels(user_id, email.message_id, body.add, body.remove)
        elif account.provider == "imap":
            from services.imap_sync import modify_imap_flags
            uid = email.message_id.rsplit("_", 1)[-1]
            await modify_imap_flags(uid, body.add, body.remove)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Provider label sync failed for email %d: %s", email_id, exc)

    return {"id": email_id, "labels": sorted(current)}
