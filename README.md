# Akademi Sınıf Randevu

3 sınıfı olan bir akademi için basit online randevu ve randevu takip uygulaması.
Kişiler tarih, saat aralığı ve sınıf seçerek randevu oluşturur; e-posta ve telefon
bilgileriyle randevularını tekrar bulup düzenleyebilir veya iptal edebilir.

- **Backend:** Python + FastAPI + SQLite
- **Arayüz:** Tek sayfa, vanilla JavaScript (build adımı yok)
- **E-posta:** SMTP ile gerçek gönderim; SMTP boşsa `logs/outbox` klasörüne demo çıktısı
- **SMS:** Şimdilik yok (altyapı sonradan eklenebilir, aşağıya bakın)

## Özellikler

- 3 sınıf (`.env` üzerinden adları değiştirilebilir)
- Tarih + başlangıç/bitiş saati + sınıf seçimi
- Ad soyad, e-posta, telefon ve isteğe bağlı not
- Aynı sınıfta çakışan randevuların engellenmesi
- Onay e-postası
- Randevudan **24 saat** ve **2 saat** önce hatırlatma e-postası
- Randevu kodu (`RND-XXXXXX`) ve e-postayla gelen yönetim bağlantısı
- E-posta + telefon ile randevu sorgulama
- Randevu düzenleme ve iptal etme
- **3 günden az kaldıysa düzenleme kilidi** (varsayılan; `.env` ile değiştirilebilir)
- İptal edilen saatlerin yeniden rezervasyona açılması
- `/admin` yönetim panosu: randevu listesi, filtreler, hatırlatma kayıtları
- Türkçe arayüz, mobil uyumlu tasarım

## Hızlı başlangıç (Windows)

Python 3.10 veya üzeri gerekir. Bilgisayarda Python yoksa:

```powershell
winget install -e --id Python.Python.3.12
```

Kurulumdan sonra terminali kapatıp yeniden açın ve `python --version` ile kontrol edin.

Proje klasöründe `run.bat` dosyasına çift tıklayın. Betik:

1. `.venv` sanal ortamını oluşturur,
2. bağımlılıkları kurar,
3. `.env` dosyası yoksa `.env.example` dosyasından kopyalar,
4. uygulamayı `http://127.0.0.1:8000` adresinde başlatır.

İlk çalıştırmadan sonra `.env` dosyasını açıp en azından `ADMIN_PASSWORD` ve SMTP
bilgilerini düzenleyin. Uygulamayı durdurmak için terminalde `Ctrl+C` kullanın.

### Elle kurulum

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Adresler:

| Sayfa | Adres |
| --- | --- |
| Randevu sayfası | http://127.0.0.1:8000 |
| Yönetim paneli | http://127.0.0.1:8000/admin |
| API dokümantasyonu | http://127.0.0.1:8000/docs |

Varsayılan yönetim şifresi `admin123`'tür. **Mutlaka değiştirin.**

## Ayarlar (`.env`)

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `APP_NAME` | `Akademi Sınıf Randevu` | Uygulama adı |
| `CLASSROOMS` | `Sınıf A,Sınıf B,Sınıf C` | Virgülle ayrılmış sınıf adları |
| `OPEN_TIME` / `CLOSE_TIME` | `09:00` / `21:00` | Randevu alınabilecek saat aralığı |
| `SLOT_MINUTES` | `30` | Randevu aralığı (dakika) |
| `LOCK_DAYS` | `3` | Randevuya bu kadar günden az kaldıysa düzenleme kilitlenir |
| `BLOCK_DELETE_WITHIN_DAYS` | `0` | `0` = iptal her zaman serbest. Silmeyi de kilitlemek için gün sayısı girin |
| `BOOKING_HORIZON_DAYS` | `90` | Kaç gün sonrasına kadar randevu alınabilir |
| `REMINDER_HOURS` | `24,2` | Kaç saat önce hatırlatma gönderilsin |
| `BASE_URL` | `http://127.0.0.1:8000` | E-postalardaki bağlantılarda kullanılan adres |
| `ADMIN_PASSWORD` | `admin123` | `/admin` şifresi |
| `DATABASE_FILE` | `data/randevu.db` | SQLite veritabanı yolu |
| `SMTP_HOST` | boş | Örn. `smtp.gmail.com` |
| `SMTP_PORT` | `587` | `465` için otomatik SSL kullanılır |
| `SMTP_USER` | boş | SMTP kullanıcı adı |
| `SMTP_PASSWORD` | boş | SMTP şifresi / uygulama şifresi |
| `SMTP_FROM` | `Akademi Randevu <randevu@example.com>` | Gönderen adresi |
| `SMTP_TLS` | `true` | STARTTLS kullanılsın mı |

### 3 gün kuralı nasıl çalışıyor?

`LOCK_DAYS=3` iken randevu başlangıcına **72 saatten az** kaldıysa:

- randevu **düzenlenemez** (tarih, saat, sınıf, iletişim bilgileri),
- iptal etme varsayılan olarak **serbesttir** (`BLOCK_DELETE_WITHIN_DAYS=0`).

İptali de kilitlemek isterseniz örneğin `BLOCK_DELETE_WITHIN_DAYS=3` yazın.
Bu durumda son 3 gün içindeki randevular iptal de edilemez.

### E-posta gönderimi

`.env` içindeki `SMTP_*` alanları dolduğunda e-postalar gerçekten gönderilir.
Boş bırakılırsa uygulama **demo modunda** çalışır: e-postalar gönderilmez,
`logs/outbox` klasörüne `.eml` dosyası olarak yazılır. Bu dosyalar herhangi bir
e-posta istemcisinde açılabilir.

**Gmail örneği:**

1. Google hesabında 2 adımlı doğrulamayı açın.
2. Uygulama şifresi oluşturun (Google Hesabı → Güvenlik → Uygulama şifreleri).
3. `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=ornek@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx
SMTP_FROM=Akademi Randevu <ornek@gmail.com>
SMTP_TLS=true
```

Kurumsal e-posta kullanıyorsanız sağlayıcınızın SMTP sunucu bilgilerini kullanın.
Gönderim logları `logs/app.log` dosyasına yazılır.

### SMS hakkında

SMS gönderimi bilinçli olarak bu sürüme eklenmedi. İleride eklemek için:

1. Twilio, NetGSM, İletimerkezi gibi bir sağlayıcıdan API bilgileri alın,
2. `app/emailer.py` yanına `app/sms.py` ekleyip bir `send_sms()` fonksiyonu yazın,
3. `app/reminders.py` içindeki hatırlatma döngüsünde e-postanın yanında SMS'i de çağırın,
4. `reminder_log` tablosunda `channel='sms'` kayıtları tutun.

## Kullanım akışı

1. Kişi ana sayfada tarih, sınıf ve saat aralığını seçer.
2. Ad soyad, e-posta ve telefonunu girer.
3. Randevu oluşturulur; ekranda randevu kodu ve yönetim bağlantısı görünür.
4. Onay e-postası gönderilir.
5. Randevudan 24 saat ve 2 saat önce hatırlatma e-postası gider.
6. Kişi e-postadaki bağlantıyla veya **Randevularım** sekmesinde e-posta + telefon
   ile randevusunu bulur.
7. Randevuya 3 günden fazla varsa düzenleyebilir; her zaman iptal edebilir.
8. İptal edilen saat başka biri tarafından yeniden alınabilir.

## Veritabanı ve yedekleme

Tüm veriler `data/randevu.db` SQLite dosyasında tutulur. Yedek almak için
uygulama kapalıyken bu dosyayı kopyalamanız yeterlidir. Tablolar:

- `bookings` — randevular
- `reminder_log` — gönderilen hatırlatmalar (tekrar gönderimi engeller)

## Yönetim paneli

`/admin` adresinde:

- tarih aralığı, sınıf ve duruma göre randevu listesi,
- kişi iletişim bilgileri ve randevu kodları,
- hangi randevunun düzenlemeye kilitli olduğu,
- gönderilen / demo modunda yazılan / hata alan hatırlatmalar,
- "Hatırlatmaları çalıştır" düğmesiyle manuel kontrol.

## Yayına alma notları

- Uygulamayı bir VPS'e veya Docker destekli bir platforma koyabilirsiniz.
  `uvicorn app.main:app --host 0.0.0.0 --port 8000` yeterlidir; üretimde
  `--reload` kullanmayın ve önüne bir reverse proxy (Nginx/Caddy) koyun.
- `.env` içindeki `BASE_URL` değerini gerçek alan adınız yapın; e-postalardaki
  bağlantılar bu adresi kullanır.
- `ADMIN_PASSWORD` için güçlü bir şifre seçin.
- HTTPS kullanın; aksi halde e-posta ve telefon bilgileri açık gider.
- SQLite tek sunucu için yeterlidir. Çok yoğun kullanımda PostgreSQL'e geçmek
  gerekebilir.
- Kişisel veriler (ad, e-posta, telefon) saklandığı için KVKK aydınlatma metni
  ve saklama politikası eklemeniz önerilir.

## API özeti

| Metot | Yol | Açıklama |
| --- | --- | --- |
| `GET` | `/api/config` | Sınıflar, saatler, kilit bilgisi |
| `GET` | `/api/availability?date=YYYY-MM-DD` | Günün dolu aralıkları |
| `POST` | `/api/bookings` | Randevu oluştur |
| `GET` | `/api/bookings?email=...&phone=...` | Randevuları bul |
| `GET` | `/api/bookings/{token}` | Tek randevu |
| `PUT` | `/api/bookings/{token}` | Randevu düzenle |
| `DELETE` | `/api/bookings/{token}` | Randevu iptal et |
| `GET` | `/api/admin/bookings` | Yönetim listesi (`X-Admin-Key`) |
| `GET` | `/api/admin/reminders` | Hatırlatma kayıtları |
| `POST` | `/api/admin/reminders/run` | Hatırlatmaları hemen çalıştır |

## Sorun giderme

- **E-posta gelmiyor:** `SMTP_*` alanlarının dolu olduğundan emin olun.
  `logs/app.log` ve `logs/outbox` klasörüne bakın. Gmail kullanıyorsanız normal
  şifre değil uygulama şifresi gerekir.
- **Saatler kayık görünüyor:** `TIMEZONE=Europe/Istanbul` olmalı. Windows'ta
  `tzdata` paketi `requirements.txt` içinde gelir.
- **Port kullanımda:** `--port 8001` gibi başka bir port seçin.
- **Telefondan erişim:** Uvicorn'u `--host 0.0.0.0` ile başlatın ve `BASE_URL`
  değerini bilgisayarın yerel IP'si yapın (ör. `http://192.168.1.20:8000`).
  Windows Güvenlik Duvarı'nda 8000 portuna izin vermeniz gerekebilir.

## Proje yapısı

```
app/
  main.py        FastAPI rotaları ve uygulama başlangıcı
  config.py      .env ayarları
  db.py          SQLite şeması ve bağlantı
  services.py    Randevu kuralları, çakışma kontrolü, kilitler
  emailer.py     SMTP gönderimi ve e-posta şablonları
  reminders.py   Zamanlanmış hatırlatma döngüsü
  utils.py       Tarih/saat yardımcıları
static/
  index.html     Randevu arayüzü
  admin.html     Yönetim panosu
  css/styles.css
  js/app.js
  js/admin.js
data/            SQLite veritabanı (çalışınca oluşur)
logs/            Uygulama logu ve demo e-posta çıktıları
```
