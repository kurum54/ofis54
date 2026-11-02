"""FastAPI uygulaması: API, statik arayüz ve zamanlanmış hatırlatmalar."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from datetime import timedelta
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import services
from .config import BASE_DIR, settings
from .db import init_db
from .emailer import build_cancellation, build_confirmation, send_email
from .reminders import reminder_loop, send_due_reminders
from .services import ServiceError
from .utils import now_local, today_local

LOG_DIR = settings.logs_dir
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("randevu.app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    log.info("%s başlatıldı. Veritabanı: %s", settings.app_name, settings.database_path)
    if not settings.smtp_configured:
        log.warning(
            "SMTP yapılandırılmadı. E-postalar gönderilmeyecek, logs/outbox klasörüne yazılacak."
        )
    task = asyncio.create_task(reminder_loop())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)


@app.exception_handler(ServiceError)
async def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


class BookingPayload(BaseModel):
    full_name: str = Field(..., max_length=120)
    email: str = Field(..., max_length=160)
    phone: str = Field(..., max_length=40)
    classroom: str = Field(..., max_length=80)
    date: str
    start_time: str
    end_time: str
    note: str | None = Field(default=None, max_length=600)


def require_admin(x_admin_key: str | None = Header(default=None, alias="X-Admin-Key")) -> None:
    if not settings.admin_password or x_admin_key != settings.admin_password:
        raise HTTPException(status_code=401, detail="Yönetim şifresi hatalı.")


def _send_confirmation(booking: dict[str, Any]) -> None:
    try:
        subject, html, text = build_confirmation(booking)
        send_email(booking["email"], subject, html, text)
    except Exception:
        log.exception("Onay e-postası gönderilemedi")


def _send_cancellation(booking: dict[str, Any]) -> None:
    try:
        subject, html, text = build_cancellation(booking)
        send_email(booking["email"], subject, html, text)
    except Exception:
        log.exception("İptal e-postası gönderilemedi")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "app": settings.app_name, "today": today_local().isoformat()}


@app.get("/api/config")
def public_config() -> dict[str, Any]:
    today = today_local()
    return {
        "app_name": settings.app_name,
        "classrooms": list(settings.classrooms),
        "open_time": settings.open_time,
        "close_time": settings.close_time,
        "slot_minutes": settings.slot_minutes,
        "lock_days": settings.lock_days,
        "delete_lock_days": settings.block_delete_within_days,
        "horizon_days": settings.booking_horizon_days,
        "today": today.isoformat(),
        "max_date": (today + timedelta(days=settings.booking_horizon_days)).isoformat(),
        "reminder_hours": list(settings.reminder_hours),
        "email_configured": settings.smtp_configured,
    }


@app.get("/api/availability")
def availability(date: str = Query(..., min_length=10, max_length=10)) -> dict[str, Any]:
    return services.availability_for(date)


@app.post("/api/bookings", status_code=201)
def create_booking(payload: BookingPayload, background: BackgroundTasks) -> dict[str, Any]:
    booking = services.create_booking(payload.model_dump())
    background.add_task(_send_confirmation, booking)
    return booking


@app.get("/api/bookings")
def list_bookings(
    email: str = Query(..., min_length=3, max_length=160),
    phone: str = Query(..., min_length=3, max_length=40),
) -> dict[str, Any]:
    return {"bookings": services.find_bookings(email, phone)}


@app.get("/api/bookings/{token}")
def get_booking(token: str) -> dict[str, Any]:
    return services.get_booking_by_token(token)


@app.put("/api/bookings/{token}")
def update_booking(token: str, payload: BookingPayload) -> dict[str, Any]:
    return services.update_booking(token, payload.model_dump())


@app.delete("/api/bookings/{token}")
def cancel_booking(token: str, background: BackgroundTasks) -> dict[str, Any]:
    booking = services.cancel_booking(token)
    background.add_task(_send_cancellation, booking)
    return booking


@app.get("/api/admin/bookings", dependencies=[Depends(require_admin)])
def admin_bookings(
    date_from: str | None = None,
    date_to: str | None = None,
    classroom: str | None = None,
    status: str | None = "confirmed",
) -> dict[str, Any]:
    return {
        "bookings": services.admin_list_bookings(date_from, date_to, classroom, status),
    }


@app.get("/api/admin/reminders", dependencies=[Depends(require_admin)])
def admin_reminders(limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
    return {"reminders": services.admin_reminder_log(limit)}


@app.post("/api/admin/reminders/run", dependencies=[Depends(require_admin)])
def run_reminders() -> dict[str, Any]:
    return {"sent": send_due_reminders()}


app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/admin", include_in_schema=False)
def admin_page() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "admin.html")
