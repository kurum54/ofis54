"""SQLite veritabanı katmanı."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS bookings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    token           TEXT    NOT NULL UNIQUE,
    code            TEXT    NOT NULL UNIQUE,
    full_name       TEXT    NOT NULL,
    email           TEXT    NOT NULL,
    phone           TEXT    NOT NULL,
    phone_digits    TEXT    NOT NULL,
    classroom       TEXT    NOT NULL,
    booking_date    TEXT    NOT NULL,
    start_time      TEXT    NOT NULL,
    end_time        TEXT    NOT NULL,
    note            TEXT,
    status          TEXT    NOT NULL DEFAULT 'confirmed',
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    cancelled_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings (booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_classroom ON bookings (classroom);
CREATE INDEX IF NOT EXISTS idx_bookings_contact ON bookings (email, phone_digits);

CREATE TABLE IF NOT EXISTS reminder_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id      INTEGER NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
    offset_hours    INTEGER NOT NULL,
    channel         TEXT    NOT NULL,
    status          TEXT    NOT NULL,
    detail          TEXT,
    sent_at         TEXT    NOT NULL,
    UNIQUE (booking_id, offset_hours, channel)
);
"""


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(settings.database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def get_db() -> Iterator[sqlite3.Connection]:
    connection = connect()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db() -> None:
    Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    settings.outbox_dir.mkdir(parents=True, exist_ok=True)
    with get_db() as connection:
        connection.executescript(SCHEMA)
