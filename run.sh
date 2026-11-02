#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"


if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3.10+ bulunamadı. Lütfen Python kurun."
  exit 1
fi

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
pip install -r requirements.txt

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ".env dosyası oluşturuldu. SMTP ve ADMIN_PASSWORD ayarlarını düzenleyebilirsiniz."
fi

echo ""
echo "Uygulama başlatılıyor: http://127.0.0.1:8000"
echo "Yönetim paneli:        http://127.0.0.1:8000/admin"
echo "Durdurmak için Ctrl+C"
echo ""

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
