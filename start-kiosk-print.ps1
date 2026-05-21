$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appUrl = "http://127.0.0.1:5173"
$printerName = "DS-RX1"
$browserProfile = Join-Path $projectRoot ".chrome-kiosk-profile"

$printer = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
if (-not $printer) {
  Write-Host "Printer '$printerName' was not found. Add it in Windows printers first."
  exit 1
}

rundll32 printui.dll,PrintUIEntry /y /n $printerName

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
