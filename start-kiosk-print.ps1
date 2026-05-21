$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:5173"
$printerName = "DS-RX1"
$browserProfile = Join-Path $projectRoot ".chrome-kiosk-profile"
$bgRemovalDir = Resolve-Path (Join-Path $projectRoot "..\bgremoval") -ErrorAction SilentlyContinue
$bgRemovalUrl = "http://127.0.0.1:8765/health"

$printer = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if (-not $printer) {
  Write-Host "Printer '$printerName' was not found. Add it in Windows printers first."
  exit 1
}

rundll32 printui.dll,PrintUIEntry /y /n $printerName

try {
  Invoke-WebRequest -UseBasicParsing -Uri $bgRemovalUrl -TimeoutSec 2 | Out-Null
  Write-Host "bgremoval API is already running."
} catch {
  if (-not $bgRemovalDir) {
    Write-Host "bgremoval folder was not found next to this project. Run start-full-system.bat once to clone and install it."
    exit 1
  }

  $bgRemovalPython = Join-Path $bgRemovalDir ".venv\Scripts\python.exe"
  if (-not (Test-Path $bgRemovalPython)) {
    Write-Host "bgremoval virtual environment was not found. Run start-full-system.bat once to install it."
    exit 1
  }

  Write-Host "Starting bgremoval API on http://127.0.0.1:8765 ..."
  Start-Process -FilePath $bgRemovalPython -ArgumentList "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8765" -WorkingDirectory $bgRemovalDir -WindowStyle Hidden
  Start-Sleep -Seconds 3

  try {
    Invoke-WebRequest -UseBasicParsing -Uri $bgRemovalUrl -TimeoutSec 5 | Out-Null
  } catch {
    Write-Host "bgremoval API did not start successfully."
    exit 1
  }
}

Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev", "--", "--port", "5173", "--strictPort" -WorkingDirectory $projectRoot -WindowStyle Hidden
Start-Sleep -Seconds 3

$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
)

$browserPath = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browserPath) {
  Write-Host "Chrome or Edge was not found."
  exit 1
}

Start-Process -FilePath $browserPath -ArgumentList @(
  "--kiosk-printing",
  "--disable-print-preview",
  "--no-first-run",
  "--user-data-dir=$browserProfile",
  "--app=$appUrl"
)
