"""Zamanlanmış e-posta hatırlatmaları."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

from .config import settings
from .db import get_db
from .emailer import build_reminder, send_email
from .services import serialize
from .utils import combine_local, now_local, utc_now_iso

log = logging.getLogger("randevu.reminders")

CHECK_INTERVAL_SECONDS = 60


def _already_logged(connection, booking_id: int, offset: int) -> bool:
    row = connection.execute(
        "SELECT 1 FROM reminder_log WHERE booking_id = ? AND offset_hours = ? AND channel = 'email'",
        (booking_id, offset),
    ).fetchone()
    return row is not None


def send_due_reminders() -> list[dict[str, Any]]:
    """Zamanı gelen hatırlatmaları gönderir, gönderilenlerin listesini döndürür."""
    now = now_local()
    sent: list[dict[str, Any]] = []

    with get_db() as connection:
        rows = connection.execute("SELECT * FROM bookings WHERE status = 'confirmed'").fetchall()

        for row in rows:
            start_at: datetime = combine_local(row["booking_date"], row["start_time"])
            if now >= start_at:
                continue

            # En yakın (en küçük) hatırlatma eşiği geçerli olur; böylece
            # son dakikada oluşturulan randevuya tek e-posta gider.
            due_offsets = [
                offset
                for offset in sorted(settings.reminder_hours)
                if now >= start_at - timedelta(hours=offset)
            ]
            if not due_offsets:
                continue
            offset = due_offsets[0]
            if _already_logged(connection, row["id"], offset):
                continue

            booking = serialize(row)
            subject, html, text = build_reminder(booking)
            status, detail = send_email(booking["email"], subject, html, text)
            connection.execute(
                """
                INSERT OR IGNORE INTO reminder_log
                    (booking_id, offset_hours, channel, status, detail, sent_at)
                VALUES (?, ?, 'email', ?, ?, ?)
                """,
                (row["id"], offset, status, detail, utc_now_iso()),
            )
            sent.append(
                {
                    "booking_id": row["id"],
                    "code": row["code"],
                    "email": row["email"],
                    "offset_hours": offset,
                    "status": status,
                    "detail": detail,
                }
            )
            log.info(
                "Hatırlatma işlendi: %s (%s saat) -> %s [%s]",
                row["code"],
                offset,
                booking["email"],
                status,
            )

    return sent


async def reminder_loop() -> None:
    await asyncio.sleep(5)
    while True:
        try:
            sent = await asyncio.to_thread(send_due_reminders)
            if sent:
                log.info("%d hatırlatma işlendi.", len(sent))
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Hatırlatma döngüsünde hata oluştu")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
