"""Randevu iş kuralları: doğrulama, çakışma kontrolü, kilitler."""

from __future__ import annotations

import re
import secrets
import sqlite3
from datetime import date, datetime, timedelta
from typing import Any

from .config import settings
from .db import get_db
from .utils import clock_of, combine_local, minutes_of, now_local, today_local, utc_now_iso

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


class ServiceError(Exception):
    """Kullanıcıya gösterilecek iş kuralı hatası."""

    status_code = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ValidationError(ServiceError):
    status_code = 400


class NotFoundError(ServiceError):
    status_code = 404


class ConflictError(ServiceError):
    status_code = 409


class LockedError(ServiceError):
    status_code = 423


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) < 10 or len(digits) > 15:
        raise ValidationError("Telefon numarası 10–15 haneli olmalı. Örnek: 0532 123 45 67")
    return digits


def _new_code() -> str:
    return "RND-" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))


def _unique_code(connection: sqlite3.Connection) -> str:
    for _ in range(20):
        code = _new_code()
        row = connection.execute("SELECT 1 FROM bookings WHERE code = ?", (code,)).fetchone()
        if row is None:
            return code
    raise ServiceError("Randevu kodu üretilemedi, lütfen tekrar deneyin.")


def _clean_payload(data: dict[str, Any]) -> dict[str, Any]:
    full_name = str(data.get("full_name") or "").strip()
    email = str(data.get("email") or "").strip().lower()
    phone_raw = str(data.get("phone") or "").strip()
    classroom = str(data.get("classroom") or "").strip()
    booking_date = str(data.get("date") or "").strip()
    start_time = str(data.get("start_time") or "").strip()
    end_time = str(data.get("end_time") or "").strip()
    note = str(data.get("note") or "").strip()

    if len(full_name) < 2:
        raise ValidationError("Ad soyad en az 2 karakter olmalı.")
    if len(full_name) > 100:
        raise ValidationError("Ad soyad en fazla 100 karakter olabilir.")
    if not EMAIL_RE.match(email) or len(email) > 160:
        raise ValidationError("Geçerli bir e-posta adresi girin.")
    phone_digits = normalize_phone(phone_raw)
    if len(note) > 500:
        raise ValidationError("Not en fazla 500 karakter olabilir.")
    if classroom not in settings.classrooms:
        raise ValidationError("Geçersiz sınıf seçimi.")

    try:
        day = date.fromisoformat(booking_date)
    except ValueError as exc:
        raise ValidationError("Geçerli bir tarih seçin.") from exc

    try:
        start_minutes = minutes_of(start_time)
        end_minutes = minutes_of(end_time)
    except (ValueError, AttributeError) as exc:
        raise ValidationError("Geçerli bir saat aralığı seçin.") from exc

    open_minutes = minutes_of(settings.open_time)
    close_minutes = minutes_of(settings.close_time)

    if start_minutes >= end_minutes:
        raise ValidationError("Bitiş saati başlangıçtan sonra olmalı.")
    if start_minutes < open_minutes or end_minutes > close_minutes:
        raise ValidationError(
            f"Randevular {settings.open_time}–{settings.close_time} arasında olmalı."
        )
    if start_minutes % settings.slot_minutes or end_minutes % settings.slot_minutes:
        raise ValidationError(f"Saatler {settings.slot_minutes} dakikalık aralıklarla seçilmeli.")

    today = today_local()
    if day < today:
        raise ValidationError("Geçmiş bir tarihe randevu oluşturulamaz.")
    if day > today + timedelta(days=settings.booking_horizon_days):
        raise ValidationError(
            f"En fazla {settings.booking_horizon_days} gün sonrası için randevu alınabilir."
        )

    start_at = combine_local(day.isoformat(), clock_of(start_minutes))
    if start_at <= now_local():
        raise ValidationError("Seçilen başlangıç saati geçmişte kaldı. Lütfen ileri bir saat seçin.")

    return {
        "full_name": full_name,
        "email": email,
        "phone": phone_raw,
        "phone_digits": phone_digits,
        "classroom": classroom,
        "booking_date": day.isoformat(),
        "start_time": clock_of(start_minutes),
        "end_time": clock_of(end_minutes),
        "note": note or None,
    }


def _ensure_no_conflict(
    connection: sqlite3.Connection,
    booking_date: str,
    classroom: str,
    start_time: str,
    end_time: str,
    exclude_id: int | None = None,
) -> None:
    sql = (
        "SELECT start_time, end_time FROM bookings "
        "WHERE booking_date = ? AND classroom = ? AND status = 'confirmed'"
    )
    params: list[Any] = [booking_date, classroom]
    if exclude_id is not None:
        sql += " AND id <> ?"
        params.append(exclude_id)
    rows = connection.execute(sql, params).fetchall()
    for row in rows:
        # HH:MM biçimi sözlüksel olarak da doğru sıralanır.
        if start_time < row["end_time"] and end_time > row["start_time"]:
            raise ConflictError(
                f"{classroom}, {row['start_time']}–{row['end_time']} arasında dolu. "
                "Lütfen başka bir saat aralığı seçin."
            )


def hours_until(booking_date: str, start_time: str) -> float:
    delta = combine_local(booking_date, start_time) - now_local()
    return delta.total_seconds() / 3600


def is_edit_locked(booking_date: str, start_time: str, status: str = "confirmed") -> bool:
    if status != "confirmed":
        return True
    return hours_until(booking_date, start_time) < settings.lock_hours


def is_delete_locked(booking_date: str, start_time: str, status: str = "confirmed") -> bool:
    if status != "confirmed":
        return True
    if settings.block_delete_within_days <= 0:
        return False
    return hours_until(booking_date, start_time) < settings.delete_lock_hours


def serialize(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    remaining = hours_until(data["booking_date"], data["start_time"])
    status = data["status"]
    edit_locked = is_edit_locked(data["booking_date"], data["start_time"], status)
    delete_locked = is_delete_locked(data["booking_date"], data["start_time"], status)
    data["code"] = data["code"]
    data["starts_at"] = combine_local(data["booking_date"], data["start_time"]).isoformat()
    data["hours_until"] = round(remaining, 1)
    data["is_past"] = remaining < 0
    data["edit_locked"] = edit_locked
    data["delete_locked"] = delete_locked
    data["can_edit"] = status == "confirmed" and not edit_locked
    data["can_delete"] = status == "confirmed" and not delete_locked
    data["manage_url"] = f"{settings.base_url}/?token={data['token']}"
    return data


def get_booking_by_token(token: str) -> dict[str, Any]:
    with get_db() as connection:
        row = connection.execute("SELECT * FROM bookings WHERE token = ?", (token,)).fetchone()
    if row is None:
        raise NotFoundError("Randevu bulunamadı. Bağlantı hatalı veya randevu iptal edilmiş olabilir.")
    return serialize(row)


def create_booking(data: dict[str, Any]) -> dict[str, Any]:
    clean = _clean_payload(data)
    timestamp = utc_now_iso()
    with get_db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        _ensure_no_conflict(
            connection,
            clean["booking_date"],
            clean["classroom"],
            clean["start_time"],
            clean["end_time"],
        )
        token = secrets.token_urlsafe(18)
        code = _unique_code(connection)
        cursor = connection.execute(
            """
            INSERT INTO bookings (
                token, code, full_name, email, phone, phone_digits, classroom,
                booking_date, start_time, end_time, note, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
            """,
            (
                token,
                code,
                clean["full_name"],
                clean["email"],
                clean["phone"],
                clean["phone_digits"],
                clean["classroom"],
                clean["booking_date"],
                clean["start_time"],
                clean["end_time"],
                clean["note"],
                timestamp,
                timestamp,
            ),
        )
        row = connection.execute(
            "SELECT * FROM bookings WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return serialize(row)


def update_booking(token: str, data: dict[str, Any]) -> dict[str, Any]:
    with get_db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM bookings WHERE token = ?", (token,)).fetchone()
        if row is None:
            raise NotFoundError("Randevu bulunamadı.")
        if row["status"] != "confirmed":
            raise ConflictError("İptal edilmiş bir randevu düzenlenemez. Yeni randevu oluşturabilirsiniz.")
        if is_edit_locked(row["booking_date"], row["start_time"], row["status"]):
            raise LockedError(
                f"Randevuya {settings.lock_days} günden az kaldığı için düzenlenemez. "
                "Yeni bir randevu oluşturabilirsiniz."
            )

        clean = _clean_payload(data)
        _ensure_no_conflict(
            connection,
            clean["booking_date"],
            clean["classroom"],
            clean["start_time"],
            clean["end_time"],
            exclude_id=row["id"],
        )
        connection.execute(
            """
            UPDATE bookings SET
                full_name = ?, email = ?, phone = ?, phone_digits = ?, classroom = ?,
                booking_date = ?, start_time = ?, end_time = ?, note = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                clean["full_name"],
                clean["email"],
                clean["phone"],
                clean["phone_digits"],
                clean["classroom"],
                clean["booking_date"],
                clean["start_time"],
                clean["end_time"],
                clean["note"],
                utc_now_iso(),
                row["id"],
            ),
        )
        updated = connection.execute(
            "SELECT * FROM bookings WHERE id = ?", (row["id"],)
        ).fetchone()
    return serialize(updated)


def cancel_booking(token: str) -> dict[str, Any]:
    with get_db() as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM bookings WHERE token = ?", (token,)).fetchone()
        if row is None:
            raise NotFoundError("Randevu bulunamadı.")
        if row["status"] == "cancelled":
            return serialize(row)
        if is_delete_locked(row["booking_date"], row["start_time"], row["status"]):
            raise LockedError(
                "Randevuya çok az kaldığı için iptal edilemez. Lütfen akademi ile iletişime geçin."
            )
        connection.execute(
            "UPDATE bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?",
            (utc_now_iso(), utc_now_iso(), row["id"]),
        )
        cancelled = connection.execute(
            "SELECT * FROM bookings WHERE id = ?", (row["id"],)
        ).fetchone()
    return serialize(cancelled)


def find_bookings(email: str, phone: str) -> list[dict[str, Any]]:
    email = (email or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise ValidationError("Geçerli bir e-posta adresi girin.")
    digits = normalize_phone(phone)
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT * FROM bookings
            WHERE lower(email) = ? AND phone_digits = ?
            ORDER BY booking_date DESC, start_time DESC
            """,
            (email, digits),
        ).fetchall()
    return [serialize(row) for row in rows]


def availability_for(day: str) -> dict[str, Any]:
    try:
        parsed = date.fromisoformat(day)
    except ValueError as exc:
        raise ValidationError("Geçerli bir tarih girin.") from exc
    if parsed < today_local() - timedelta(days=1):
        return {
            "date": parsed.isoformat(),
            "classrooms": [{"name": name, "busy": []} for name in settings.classrooms],
        }
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT classroom, start_time, end_time FROM bookings
            WHERE booking_date = ? AND status = 'confirmed'
            ORDER BY start_time
            """,
            (parsed.isoformat(),),
        ).fetchall()
    busy: dict[str, list[dict[str, str]]] = {name: [] for name in settings.classrooms}
    for row in rows:
        busy.setdefault(row["classroom"], []).append(
            {"start": row["start_time"], "end": row["end_time"]}
        )
    return {
        "date": parsed.isoformat(),
        "classrooms": [
            {"name": name, "busy": busy.get(name, [])} for name in settings.classrooms
        ],
    }


def admin_list_bookings(
    date_from: str | None,
    date_to: str | None,
    classroom: str | None,
    status: str | None,
) -> list[dict[str, Any]]:
    today = today_local()
    start = date_from or (today - timedelta(days=7)).isoformat()
    end = date_to or (today + timedelta(days=30)).isoformat()
    sql = "SELECT * FROM bookings WHERE booking_date BETWEEN ? AND ?"
    params: list[Any] = [start, end]
    if classroom:
        sql += " AND classroom = ?"
        params.append(classroom)
    if status and status != "all":
        sql += " AND status = ?"
        params.append(status)
    sql += " ORDER BY booking_date, start_time"
    with get_db() as connection:
        rows = connection.execute(sql, params).fetchall()
    return [serialize(row) for row in rows]


def admin_reminder_log(limit: int = 100) -> list[dict[str, Any]]:
    with get_db() as connection:
        rows = connection.execute(
            """
            SELECT r.*, b.code, b.full_name, b.email, b.classroom, b.booking_date, b.start_time
            FROM reminder_log r
            JOIN bookings b ON b.id = r.booking_id
            ORDER BY r.sent_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]
