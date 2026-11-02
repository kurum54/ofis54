"""Uygulama ayarları (.env dosyasından okunur)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _csv(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _hour_list(name: str, default: str) -> tuple[int, ...]:
    values: list[int] = []
    for item in _csv(name, default):
        try:
            values.append(int(item))
        except ValueError:
            continue
    # Büyükten küçüğe: önce 24 saat, sonra 2 saat hatırlatması denenir.
    return tuple(sorted(set(values), reverse=True)) or (24,)


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off", ""}


@dataclass(frozen=True)
class Settings:
    app_name: str
    timezone: str
    classrooms: tuple[str, ...]
    open_time: str
    close_time: str
    slot_minutes: int
    lock_days: int
    block_delete_within_days: int
    booking_horizon_days: int
    reminder_hours: tuple[int, ...]
    base_url: str
    admin_password: str
    database_path: Path
    logs_dir: Path
    outbox_dir: Path
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from: str
    smtp_tls: bool

    @property
    def smtp_configured(self) -> bool:
        """Gerçek e-posta gönderimi yapılandırılmış mı?"""
        return bool(self.smtp_host and self.smtp_from)

    @property
    def lock_hours(self) -> int:
        return self.lock_days * 24

    @property
    def delete_lock_hours(self) -> int:
        return self.block_delete_within_days * 24


settings = Settings(
    app_name=os.getenv("APP_NAME", "Akademi Sınıf Randevu"),
    timezone=os.getenv("TIMEZONE", "Europe/Istanbul"),
    classrooms=tuple(_csv("CLASSROOMS", "Sınıf A,Sınıf B,Sınıf C")),
    open_time=os.getenv("OPEN_TIME", "09:00"),
    close_time=os.getenv("CLOSE_TIME", "21:00"),
    slot_minutes=_int("SLOT_MINUTES", 30),
    lock_days=_int("LOCK_DAYS", 3),
    block_delete_within_days=_int("BLOCK_DELETE_WITHIN_DAYS", 0),
    booking_horizon_days=_int("BOOKING_HORIZON_DAYS", 90),
    reminder_hours=_hour_list("REMINDER_HOURS", "24,2"),
    base_url=os.getenv("BASE_URL", "http://127.0.0.1:8000").rstrip("/"),
    admin_password=os.getenv("ADMIN_PASSWORD", "admin123"),
    database_path=BASE_DIR / os.getenv("DATABASE_FILE", "data/randevu.db"),
    logs_dir=BASE_DIR / "logs",
    outbox_dir=BASE_DIR / "logs" / "outbox",
    smtp_host=os.getenv("SMTP_HOST", "").strip(),
    smtp_port=_int("SMTP_PORT", 587),
    smtp_user=os.getenv("SMTP_USER", "").strip(),
    smtp_password=os.getenv("SMTP_PASSWORD", ""),
    smtp_from=os.getenv("SMTP_FROM", "Akademi Randevu <randevu@example.com>").strip(),
    smtp_tls=_bool("SMTP_TLS", True),
)
