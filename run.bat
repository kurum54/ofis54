@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo Python bulunamadi.
  echo Python 3.10+ kurun: winget install -e --id Python.Python.3.12
  echo Kurulumdan sonra bu pencereyi kapatip yeniden acin.
  echo.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Sanal ortam olusturuluyor...
  python -m venv .venv
  if errorlevel 1 (
    echo Sanal ortam olusturulamadi.
    pause
    exit /b 1
  )
)

call ".venv\Scripts\activate.bat"

echo Bagimliliklar kontrol ediliyor...
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo Bagimliliklar kurulamadi.
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo .env dosyasi olusturuldu. SMTP ve ADMIN_PASSWORD ayarlarini duzenleyebilirsiniz.
)

echo.
echo Uygulama baslatiliyor: http://127.0.0.1:8000
echo Yonetim paneli:        http://127.0.0.1:8000/admin
echo Durdurmak icin Ctrl+C
echo.

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
pause
