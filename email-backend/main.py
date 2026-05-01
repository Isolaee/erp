import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from db.database import init_db
from services.scheduler import start_scheduler, stop_scheduler
from routers import emails, calendar, agent, auth, events


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await start_scheduler()
    yield
    await stop_scheduler()


app = FastAPI(title="Email Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # local network only, so wildcard is fine
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(emails.router, prefix="/api/emails", tags=["emails"])
app.include_router(calendar.router, prefix="/api/calendar", tags=["calendar"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(events.router, prefix="/api/events", tags=["events"])

# Serve React build if it exists
frontend_dist = os.getenv("FRONTEND_DIST", os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.isdir(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
