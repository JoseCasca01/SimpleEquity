$ErrorActionPreference = "Stop"

$InstallDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "SimpleEquity.lnk"
$LegacyDesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Portfolio USD.lnk"
$StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\SimpleEquity"
$LegacyStartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Portfolio USD"

Remove-Item -LiteralPath $DesktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $LegacyDesktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $StartMenuDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $LegacyStartMenuDir -Recurse -Force -ErrorAction SilentlyContinue

$TempCmd = Join-Path $env:TEMP ("simpleequity-uninstall-" + [guid]::NewGuid().ToString("N") + ".cmd")
$InstallDirEscaped = $InstallDir.Replace('"', '""')
@"
@echo off
timeout /t 2 /nobreak >nul
rmdir /s /q "$InstallDirEscaped"
del "%~f0"
"@ | Set-Content -LiteralPath $TempCmd -Encoding ASCII

Start-Process -FilePath $TempCmd -WindowStyle Hidden
Write-Host "SimpleEquity removed."
