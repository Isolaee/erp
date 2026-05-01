from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, Boolean, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from db.database import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(32))  # gmail | outlook | imap
    display_name: Mapped[str] = mapped_column(String(255), default="")
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    emails: Mapped[list["Email"]] = relationship(back_populates="account")


class Email(Base):
    __tablename__ = "emails"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    message_id: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    thread_id: Mapped[Optional[str]] = mapped_column(String(512), index=True, nullable=True)
    subject: Mapped[str] = mapped_column(Text, default="")
    sender: Mapped[str] = mapped_column(String(512), default="")
    recipients: Mapped[str] = mapped_column(Text, default="")  # JSON list
    date: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True, nullable=True)
    body_text: Mapped[str] = mapped_column(Text, default="")
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False)
    labels: Mapped[str] = mapped_column(Text, default="")  # JSON list
    raw_snippet: Mapped[str] = mapped_column(Text, default="")

    account: Mapped["Account"] = relationship(back_populates="emails")


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    google_event_id: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(Text, default="")
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime, index=True, nullable=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    attendees: Mapped[str] = mapped_column(Text, default="")  # JSON list
    calendar_id: Mapped[str] = mapped_column(String(255), default="primary")
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class SyncState(Base):
    __tablename__ = "sync_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
