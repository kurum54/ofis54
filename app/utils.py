"""Tarih/saat yardımcıları."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone as dt_timezone

from .config import settings

try:  # Python 3.9+
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]


def _load_timezone():
    if ZoneInfo is not None:
        try:
            return ZoneInfo(settings.timezone)
        except Exception:
            pass
    # Windows'ta tzdata paketi yoksa Türkiye saati (UTC+3) ile devam et.
    return dt_timezone(timedelta(hours=3))


TZ = _load_timezone()

TR_MONTHS = (
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
)

TR_WEEKDAYS = (
    "Pazartesi",
    "Salı",
    "Çarşamba",
    "Perşembe",
    "Cuma",
    "Cumartesi",
    "Pazar",
)


def now_local() -> datetime:
    return datetime.now(TZ)


def today_local() -> date:
    return now_local().date()


def parse_date(value: str) -> date:
    return date.fromisoformat(value)


def parse_time(value: str) -> time:
    return time.fromisoformat(value)


def combine_local(day: str, clock: str) -> datetime:
    return datetime.combine(parse_date(day), parse_time(clock), tzinfo=TZ)


def utc_now_iso() -> str:
    return datetime.now(dt_timezone.utc).isoformat(timespec="seconds")


def minutes_of(clock: str) -> int:
    hour, minute = clock.split(":")
    return int(hour) * 60 + int(minute)


def clock_of(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def format_date_tr(day: str | date) -> str:
    value = parse_date(day) if isinstance(day, str) else day
    return f"{value.day} {TR_MONTHS[value.month - 1]} {value.year}"


def format_date_long_tr(day: str | date) -> str:
    value = parse_date(day) if isinstance(day, str) else day
    return f"{value.day} {TR_MONTHS[value.month - 1]} {value.year}, {TR_WEEKDAYS[value.weekday()]}"


def human_offset(hours: int) -> str:
    if hours >= 24 and hours % 24 == 0:
        days = hours // 24
        return f"{days} gün"
    return f"{hours} saat"
