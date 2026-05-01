"""IMAP sync for Roundcube (or any IMAP server)."""

import json
import email as email_lib
import email.policy
from email.mime.text import MIMEText
from datetime import datetime, timezone

import aioimaplib
import aiosmtplib
import html2text

from config import get_settings
from db.database import SessionLocal
from db.models import Account, Email, SyncState
from sqlalchemy import select


async def imap_send(
    to: str,
    subject: str,
    body: str,
    reply_to_message_id: str | None = None,
) -> None:
    """Send an email via SMTP. reply_to_message_id sets In-Reply-To/References headers."""
    settings = get_settings()
    smtp_host = settings.smtp_host or settings.imap_host
    smtp_username = settings.smtp_username or settings.imap_username
    smtp_password = settings.smtp_password or settings.imap_password

    if not smtp_host or not smtp_username:
        raise RuntimeError("SMTP not configured — set SMTP_HOST (or IMAP_HOST) and SMTP_USERNAME in .env")

    msg = MIMEText(body, "plain", "utf-8")
    msg["To"] = to
    msg["From"] = smtp_username
    msg["Subject"] = subject
    if reply_to_message_id:
        msg["In-Reply-To"] = reply_to_message_id
        msg["References"] = reply_to_message_id

    if settings.smtp_ssl:
        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=settings.smtp_port,
            username=smtp_username,
            password=smtp_password,
            use_tls=True,
        )
    else:
        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=settings.smtp_port,
            username=smtp_username,
            password=smtp_password,
            start_tls=True,
        )


async def modify_imap_flags(uid: str, add_flags: list[str], remove_flags: list[str]) -> None:
    settings = get_settings()
    if not settings.imap_host or not settings.imap_username:
        return

    if settings.imap_use_ssl:
        client = aioimaplib.IMAP4_SSL(host=settings.imap_host, port=settings.imap_port)
    else:
        client = aioimaplib.IMAP4(host=settings.imap_host, port=settings.imap_port)

    await client.wait_hello_from_server()
    login_status, _ = await client.login(settings.imap_username, settings.imap_password)
    if login_status != "OK":
        raise RuntimeError(f"IMAP login failed: {login_status}")

    await client.select("INBOX")

    if add_flags:
        flags_str = " ".join(add_flags)
        await client.uid("store", uid, f"+FLAGS ({flags_str})")
    if remove_flags:
        flags_str = " ".join(remove_flags)
        await client.uid("store", uid, f"-FLAGS ({flags_str})")

    await client.logout()


async def sync_imap(user_id: str):
    settings = get_settings()
    if not settings.imap_host or not settings.imap_username:
        print("[imap] Not configured, skipping")
        return
    await _sync_account(user_id)


async def _sync_account(user_id: str):
    settings = get_settings()

    if settings.imap_use_ssl:
        client = aioimaplib.IMAP4_SSL(host=settings.imap_host, port=settings.imap_port)
    else:
        client = aioimaplib.IMAP4(host=settings.imap_host, port=settings.imap_port)

    await client.wait_hello_from_server()
    login_status, _ = await client.login(settings.imap_username, settings.imap_password)
    if login_status != "OK":
        print(f"[imap] Login failed: {login_status}")
        return

    async with SessionLocal() as db:
        acc = (await db.execute(
            select(Account).where(Account.email == settings.imap_username, Account.user_id == user_id)
        )).scalar_one_or_none()
        if not acc:
            acc = Account(user_id=user_id, email=settings.imap_username, provider="imap", display_name=settings.imap_username)
            db.add(acc)
            await db.commit()
            await db.refresh(acc)

        state_key = f"{user_id}_imap_uidvalidity_{settings.imap_username}"
        state_row = (await db.execute(select(SyncState).where(SyncState.key == state_key))).scalar_one_or_none()
        last_uid = int(state_row.value) if state_row and state_row.value else 0

        select_status, select_data = await client.select("INBOX")
        print(f"[imap] SELECT INBOX: {select_status}, data={select_data}")
        if select_status != "OK":
            print(f"[imap] Failed to select INBOX")
            return

        # Search for messages newer than last synced UID
        if last_uid > 0:
            search_status, data = await client.uid("search", f"UID {last_uid + 1}:*")
        else:
            search_status, data = await client.uid("search", "ALL")

        print(f"[imap] SEARCH: status={search_status}, raw_data={data!r}")
        uid_list = data[0].decode().split() if data and data[0] else []
        uid_list = [u for u in uid_list if int(u) > last_uid]
        print(f"[imap] UIDs to fetch: {uid_list[:20]}{'...' if len(uid_list) > 20 else ''} (total {len(uid_list)})")

        fetched = 0
        max_uid = last_uid

        for uid in uid_list[-200:]:  # cap at 200 per sync
            uid_int = int(uid)
            msg_id_key = f"imap_uid_{settings.imap_username}_{uid}"
            existing = (await db.execute(select(Email).where(Email.message_id == msg_id_key))).scalar_one_or_none()
            if existing:
                max_uid = max(max_uid, uid_int)
                continue

            fetch_status, msg_data = await client.uid("fetch", uid, "(RFC822 FLAGS)")
            print(f"[imap] FETCH uid={uid}: status={fetch_status}, parts={len(msg_data) if msg_data else 0}, types={[type(p).__name__ for p in (msg_data or [])]}")
            if not msg_data or not msg_data[0]:
                print(f"[imap] uid={uid}: empty fetch response, skipping")
                continue

            raw = None
            flags = []
            for part in msg_data:
                if isinstance(part, (bytes, bytearray)) and part not in (b")", b" "):
                    # First element is the IMAP header line (FLAGS, size), subsequent bytes element is the email
                    if raw is None:
                        raw = part  # tentatively the header
                    else:
                        raw = part  # overwrite with actual email content
                if isinstance(part, (bytes, str)):
                    part_str = part.decode() if isinstance(part, bytes) else part
                    if "FLAGS" in part_str:
                        try:
                            flags_section = part_str.split("FLAGS")[1].strip().strip("()").split()
                            if flags_section:
                                flags = flags_section
                        except Exception:
                            pass

            if not raw:
                continue

            msg = email_lib.message_from_bytes(raw, policy=email_lib.policy.default)

            date = None
            try:
                date_str = msg.get("Date", "")
                date = email_lib.utils.parsedate_to_datetime(date_str).astimezone(timezone.utc).replace(tzinfo=None)
            except Exception:
                pass

            body_text = _extract_body(msg)

            db.add(Email(
                account_id=acc.id,
                message_id=msg_id_key,
                thread_id=msg.get("Message-ID", uid),
                subject=str(msg.get("Subject", "")),
                sender=str(msg.get("From", "")),
                recipients=json.dumps([str(msg.get("To", ""))]),
                date=date,
                body_text=body_text[:50_000],
                is_read="\\Seen" in flags,
                is_starred="\\Flagged" in flags,
                labels=json.dumps(flags),
                raw_snippet=body_text[:200],
            ))
            fetched += 1
            max_uid = max(max_uid, uid_int)

        if fetched:
            await db.commit()

        if max_uid > last_uid:
            if state_row:
                state_row.value = str(max_uid)
                state_row.updated_at = datetime.utcnow()
            else:
                db.add(SyncState(key=state_key, value=str(max_uid)))

        acc.last_synced_at = datetime.utcnow()
        await db.commit()

    await client.logout()
    print(f"[imap] Synced {fetched} new messages for {settings.imap_username}")


def _extract_body(msg) -> str:
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                break
            if ct == "text/html" and not body:
                html = part.get_payload(decode=True).decode("utf-8", errors="replace")
                body = html2text.html2text(html)
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            raw = payload.decode("utf-8", errors="replace")
            if msg.get_content_type() == "text/html":
                body = html2text.html2text(raw)
            else:
                body = raw
    return body
