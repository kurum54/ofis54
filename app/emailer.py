"""E-posta gönderimi ve e-posta şablonları.

SMTP ayarları boşsa e-postalar gerçekten gönderilmez; `logs/outbox`
klasörüne .eml dosyası olarak yazılır. Böylece uygulama demo modunda
da çalışır ve gönderilecek içerikler incelenebilir.
"""

from __future__ import annotations

import logging
import re
import smtplib
import ssl
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Any

from .config import settings
from .utils import format_date_long_tr

log = logging.getLogger("randevu.email")


def _safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._@-]+", "_", value)


def _write_outbox(to: str, message: EmailMessage) -> Path:
    settings.outbox_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    path = settings.outbox_dir / f"{stamp}-{_safe_filename(to)}.eml"
    path.write_text(message.as_string(), encoding="utf-8")
    return path


def send_email(to: str, subject: str, html: str, text: str) -> tuple[str, str]:
    """E-postayı gönderir. (durum, açıklama) döndürür.

    durum: "sent" | "simulated" | "error"
    """
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = to
    message.set_content(text)
    message.add_alternative(html, subtype="html")

    if not settings.smtp_configured:
        try:
            path = _write_outbox(to, message)
            log.info("Demo modu: e-posta outbox'a yazıldı -> %s", path)
            return "simulated", str(path)
        except Exception as exc:  # pragma: no cover
            log.exception("Outbox yazılamadı")
            return "error", str(exc)

    try:
        if settings.smtp_port == 465:
            server: smtplib.SMTP = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=25,
                context=ssl.create_default_context(),
            )
        else:
            server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=25)
            if settings.smtp_tls:
                server.starttls(context=ssl.create_default_context())
        with server:
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(message)
        log.info("E-posta gönderildi -> %s", to)
        return "sent", f"{settings.smtp_host}:{settings.smtp_port}"
    except Exception as exc:
        log.exception("E-posta gönderilemedi -> %s", to)
        return "error", str(exc)


def _layout(title: str, intro: str, booking: dict[str, Any], footer_note: str = "") -> str:
    return f"""\
<!DOCTYPE html>
<html lang="tr">
<head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:0;padding:24px;background:#f4f4f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
    <div style="background:#0f766e;padding:22px 28px;color:#ffffff;">
      <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">{settings.app_name}</div>
      <div style="font-size:21px;font-weight:700;margin-top:6px;">{title}</div>
    </div>
    <div style="padding:26px 28px;">
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">{intro}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:9px 0;color:#6b7280;width:38%;">Randevu kodu</td><td style="padding:9px 0;font-weight:700;">{booking['code']}</td></tr>
        <tr><td style="padding:9px 0;color:#6b7280;">Sınıf</td><td style="padding:9px 0;font-weight:600;">{booking['classroom']}</td></tr>
        <tr><td style="padding:9px 0;color:#6b7280;">Tarih</td><td style="padding:9px 0;font-weight:600;">{format_date_long_tr(booking['booking_date'])}</td></tr>
        <tr><td style="padding:9px 0;color:#6b7280;">Saat</td><td style="padding:9px 0;font-weight:600;">{booking['start_time']} – {booking['end_time']}</td></tr>
        <tr><td style="padding:9px 0;color:#6b7280;">Ad soyad</td><td style="padding:9px 0;">{booking['full_name']}</td></tr>
      </table>
      <div style="margin:24px 0 8px;">
        <a href="{booking['manage_url']}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:14px;">Randevumu Görüntüle</a>
      </div>
      <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
        Randevunuzu görüntülemek, düzenlemek veya iptal etmek için yukarıdaki bağlantıyı kullanabilirsiniz.
        Randevuya {settings.lock_days} günden az kaldığında düzenleme kilitlenir.
      </p>
      {f'<p style="margin:12px 0 0;font-size:12px;color:#6b7280;">{footer_note}</p>' if footer_note else ''}
    </div>
  </div>
</body>
</html>"""


def _plain(booking: dict[str, Any], intro: str) -> str:
    return (
        f"{intro}\n\n"
        f"Randevu kodu: {booking['code']}\n"
        f"Sınıf: {booking['classroom']}\n"
        f"Tarih: {format_date_long_tr(booking['booking_date'])}\n"
        f"Saat: {booking['start_time']} - {booking['end_time']}\n"
        f"Ad soyad: {booking['full_name']}\n\n"
        f"Randevu yönetimi: {booking['manage_url']}\n\n"
        f"{settings.app_name}"
    )


def build_confirmation(booking: dict[str, Any]) -> tuple[str, str, str]:
    title = "Randevunuz onaylandı"
    intro = (
        f"Merhaba {booking['full_name']}, randevunuz başarıyla oluşturuldu. "
        "Aşağıdaki bilgileri kontrol edebilirsiniz."
    )
    subject = (
        f"Randevunuz onaylandı – {format_date_long_tr(booking['booking_date'])}, "
        f"{booking['start_time']}"
    )
    return subject, _layout(title, intro, booking), _plain(booking, intro)


def build_reminder(booking: dict[str, Any]) -> tuple[str, str, str]:
    title = "Randevunuz yaklaşıyor"
    intro = (
        f"Merhaba {booking['full_name']}, {booking['classroom']} için randevunuz yaklaşıyor. "
        "Bilgilerinizi aşağıda bulabilirsiniz."
    )
    subject = (
        f"Randevu hatırlatması – {format_date_long_tr(booking['booking_date'])}, "
        f"{booking['start_time']}"
    )
    return subject, _layout(title, intro, booking), _plain(booking, intro)


def build_cancellation(booking: dict[str, Any]) -> tuple[str, str, str]:
    title = "Randevunuz iptal edildi"
    intro = (
        f"Merhaba {booking['full_name']}, {booking['classroom']} için olan randevunuz iptal edildi. "
        "Dilediğiniz zaman yeni bir randevu oluşturabilirsiniz."
    )
    subject = (
        f"Randevunuz iptal edildi – {format_date_long_tr(booking['booking_date'])}, "
        f"{booking['start_time']}"
    )
    return subject, _layout(title, intro, booking), _plain(booking, intro)
