@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "BGREMOVAL_DIR=%PROJECT_DIR%..\bgremoval"
set "BGREMOVAL_REPO=https://github.com/Craftech360-projects/bgremoval.git"

cd /d "%PROJECT_DIR%"

where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed or not available in PATH.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo Python is not installed or not available in PATH.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Node/npm is not installed or not available in PATH.
  pause
  exit /b 1
)

if not exist "%BGREMOVAL_DIR%\.git" (
  echo Cloning bgremoval into "%BGREMOVAL_DIR%"...
  git clone "%BGREMOVAL_REPO%" "%BGREMOVAL_DIR%"
  if errorlevel 1 (
    echo Failed to clone bgremoval.
    pause
    exit /b 1
  )
) else (
  echo bgremoval repo already exists at "%BGREMOVAL_DIR%".
)

cd /d "%BGREMOVAL_DIR%"

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment for bgremoval...
  python -m venv .venv
  if errorlevel 1 (
    echo Failed to create Python virtual environment.
    pause
    exit /b 1
  )
)

echo Installing bgremoval Python dependencies...
call ".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 (
  echo Failed to upgrade pip.
  pause
  exit /b 1
)

call ".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Failed to install bgremoval dependencies.
  pause
  exit /b 1
)

echo Starting bgremoval API on http://127.0.0.1:8765 ...
start "bgremoval API" /D "%BGREMOVAL_DIR%" cmd /k ""%BGREMOVAL_DIR%\.venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8765"

cd /d "%PROJECT_DIR%"

if not exist "node_modules" (
  echo Installing photo booth npm dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install photo booth npm dependencies.
    pause
    exit /b 1
  )
)

echo Starting photo booth app with kiosk printing...
call npm run kiosk

endlocal
