"""Gmail sync via Google API with OAuth2. Tokens stored per-user in tokens/ directory."""

import json
import os
import base64
import email as email_lib
from email.mime.text import MIMEText
from datetime import datetime, timezone
from pathlib import Path

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
import html2text

from config import get_settings
from db.database import SessionLocal
from db.models import Account, Email, SyncState
from services.notifier import broadcast
from sqlalchemy import select

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
]
TOKENS_DIR = Path("tokens")
_DEFAULT_BASE_URL = "http://localhost:8000"


def _ensure_tokens_dir():
    TOKENS_DIR.mkdir(exist_ok=True)


def _token_file(user_id: str) -> Path:
    return TOKENS_DIR / f"gmail_{user_id}.json"


def _load_credentials(user_id: str) -> Credentials | None:
    path = _token_file(user_id)
    if not path.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(path), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save_credentials(creds, user_id)
    return creds if creds and creds.valid else None


def _save_credentials(creds: Credentials, user_id: str):
    _ensure_tokens_dir()
    _token_file(user_id).write_text(creds.to_json())


def is_gmail_authenticated(user_id: str) -> bool:
    return _load_credentials(user_id) is not None


def _client_config(settings):
    return {
        "web": {
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }


def get_gmail_auth_url(base_url: str, user_id: str) -> str:
    settings = get_settings()
    redirect_uri = f"{base_url}/api/auth/google/callback"
    flow = Flow.from_client_config(_client_config(settings), scopes=SCOPES, redirect_uri=redirect_uri)
    url, _ = flow.authorization_url(access_type="offline", prompt="consent", state=user_id)
    return url


async def handle_gmail_callback(code: str, base_url: str, user_id: str):
    settings = get_settings()
    redirect_uri = f"{base_url}/api/auth/google/callback"
    flow = Flow.from_client_config(_client_config(settings), scopes=SCOPES, redirect_uri=redirect_uri)
    flow.fetch_token(code=code)
    _save_credentials(flow.credentials, user_id)


def _get_service(user_id: str):
    creds = _load_credentials(user_id)
    if not creds:
        raise RuntimeError(f"Gmail not authenticated for user {user_id} — visit /api/auth/google first")
    return build("gmail", "v1", credentials=creds)


def _decode_body(payload: dict) -> str:
    """Recursively extract plain text from a Gmail message payload."""
    mime_type = payload.get("mimeType", "")
    if mime_type == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace") if data else ""
    if mime_type == "text/html":
        data = payload.get("body", {}).get("data", "")
        html = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace") if data else ""
        return html2text.html2text(html)
    parts = payload.get("parts", [])
    for part in parts:
        text = _decode_body(part)
        if text:
            return text
    return ""


def _header(headers: list, name: str) -> str:
    for h in headers:
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


async def sync_gmail(user_id: str):
    creds = _load_credentials(user_id)
    if not creds:
        print(f"[gmail] Not authenticated for user {user_id}, skipping sync")
        return

    service = _get_service(user_id)

    async with SessionLocal() as db:
        profile = service.users().getProfile(userId="me").execute()
        gmail_email = profile["emailAddress"]
        current_history_id = profile.get("historyId", "0")

        acc = (await db.execute(
            select(Account).where(Account.email == gmail_email, Account.user_id == user_id)
        )).scalar_one_or_none()
        if not acc:
            acc = Account(user_id=user_id, email=gmail_email, provider="gmail", display_name=gmail_email)
            db.add(acc)
            await db.commit()
            await db.refresh(acc)

        state_key = f"{user_id}_gmail_history_{gmail_email}"
        state_row = (await db.execute(select(SyncState).where(SyncState.key == state_key))).scalar_one_or_none()
        raw_history_id = state_row.value if state_row else None
        history_id = raw_history_id if raw_history_id and raw_history_id != "0" else None

        fetched = 0
        if history_id:
            try:
                msg_ids_added = []
                label_changed_ids: set[str] = set()
                new_history_id = history_id
                page_token = None
                while True:
                    kwargs: dict = {"userId": "me", "startHistoryId": history_id}
                    if page_token:
                        kwargs["pageToken"] = page_token
                    history = service.users().history().list(**kwargs).execute()
                    for record in history.get("history", []):
                        for msg in record.get("messagesAdded", []):
                            msg_ids_added.append(msg["message"]["id"])
                        for msg in record.get("labelsAdded", []):
                            label_changed_ids.add(msg["message"]["id"])
                        for msg in record.get("labelsRemoved", []):
                            label_changed_ids.add(msg["message"]["id"])
                    new_history_id = history.get("historyId", new_history_id)
                    page_token = history.get("nextPageToken")
                    if not page_token:
                        break
                fetched = await _fetch_and_store_messages(service, acc.id, user_id, msg_ids_added, db)
                await _update_email_labels(service, list(label_changed_ids), db)
            except Exception as e:
                print(f"[gmail] Incremental sync failed ({e}), falling back to full sync")
                fetched, new_history_id = await _full_sync(service, acc.id, user_id, db, current_history_id)
        else:
            fetched, new_history_id = await _full_sync(service, acc.id, user_id, db, current_history_id)

        if state_row:
            state_row.value = str(new_history_id)
            state_row.updated_at = datetime.utcnow()
        else:
            db.add(SyncState(key=state_key, value=str(new_history_id)))

        acc.last_synced_at = datetime.utcnow()
        await db.commit()
        print(f"[gmail] Synced {fetched} new messages for {gmail_email} (user {user_id})")


async def _full_sync(service, account_id: int, user_id: str, db, current_history_id: str = "0") -> tuple[int, str]:
    results = service.users().messages().list(userId="me", maxResults=500).execute()
    msg_ids = [m["id"] for m in results.get("messages", [])]
    fetched = await _fetch_and_store_messages(service, account_id, user_id, msg_ids, db)
    return fetched, current_history_id


def gmail_send(user_id: str, to: str, subject: str, body: str, thread_id: str | None = None) -> str:
    """Send a new email or reply via Gmail API. Returns the sent message ID."""
    service = _get_service(user_id)
    msg = MIMEText(body, "plain", "utf-8")
    msg["To"] = to
    msg["Subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    send_body: dict = {"raw": raw}
    if thread_id:
        send_body["threadId"] = thread_id
    result = service.users().messages().send(userId="me", body=send_body).execute()
    return result["id"]


def modify_gmail_labels(user_id: str, message_id: str, add_labels: list[str], remove_labels: list[str]) -> None:
    service = _get_service(user_id)
    service.users().messages().modify(
        userId="me",
        id=message_id,
        body={"addLabelIds": add_labels, "removeLabelIds": remove_labels},
    ).execute()


async def _update_email_labels(service, msg_ids: list[str], db) -> None:
    for msg_id in msg_ids:
        existing = (await db.execute(select(Email).where(Email.message_id == msg_id))).scalar_one_or_none()
        if not existing:
            continue
        msg = service.users().messages().get(userId="me", id=msg_id, format="minimal").execute()
        label_ids = msg.get("labelIds", [])
        existing.is_read = "UNREAD" not in label_ids
        existing.is_starred = "STARRED" in label_ids
        existing.labels = json.dumps(label_ids)
    if msg_ids:
        await db.commit()


async def _fetch_and_store_messages(service, account_id: int, user_id: str, msg_ids: list[str], db) -> int:
    fetched = 0
    new_emails: list[dict] = []
    for msg_id in msg_ids:
        existing = (await db.execute(select(Email).where(Email.message_id == msg_id))).scalar_one_or_none()
        if existing:
            continue

        msg = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
        payload = msg.get("payload", {})
        headers = payload.get("headers", [])

        date_str = _header(headers, "Date")
        try:
            date = email_lib.utils.parsedate_to_datetime(date_str).astimezone(timezone.utc).replace(tzinfo=None)
        except Exception:
            date = None

        body = _decode_body(payload)
        label_ids = msg.get("labelIds", [])
        subject = _header(headers, "Subject")
        sender = _header(headers, "From")

        db.add(Email(
            account_id=account_id,
            message_id=msg_id,
            thread_id=msg.get("threadId"),
            subject=subject,
            sender=sender,
            recipients=json.dumps([_header(headers, "To")]),
            date=date,
            body_text=body[:50_000],
            is_read="UNREAD" not in label_ids,
            is_starred="STARRED" in label_ids,
            labels=json.dumps(label_ids),
            raw_snippet=msg.get("snippet", ""),
        ))
        new_emails.append({"type": "new_email", "subject": subject, "sender": sender})
        fetched += 1

    if fetched:
        await db.commit()
        for event in new_emails:
            await broadcast(user_id, event)
    return fetched
