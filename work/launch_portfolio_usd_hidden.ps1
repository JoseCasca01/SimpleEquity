param(
  [switch]$NoOpen,
  [switch]$SmokeTest,
  [int]$PreferredPort = 47821
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$NodeExe = Join-Path $Root "runtime\node.exe"
$AppScript = Join-Path $Root "work\portfolio_desktop_app.mjs"
$LogsDir = Join-Path $Root "logs"
$UserDataDir = Join-Path $Root "user-data\edge"

function Find-FreePort {
  param([int]$StartPort)

  for ($Port = $StartPort; $Port -lt ($StartPort + 50); $Port++) {
    $Listener = $null
    try {
      $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
      $Listener.Start()
      return $Port
    } catch {
    } finally {
      if ($Listener) {
        $Listener.Stop()
      }
    }
  }

  return $StartPort
}

function Wait-ForServer {
  param(
    [string]$Url,
    [int]$TimeoutMs = 30000
  )

  $Deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $Deadline) {
    try {
      $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1
      if ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 300) {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  return $false
}

function Find-Edge {
  $Roots = @(
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)},
    $env:LOCALAPPDATA
  ) | Where-Object { $_ }

  foreach ($RootPath in $Roots) {
    $Candidate = Join-Path $RootPath "Microsoft\Edge\Application\msedge.exe"
    if (Test-Path -LiteralPath $Candidate) {
      return $Candidate
    }
  }

  return ""
}

function Start-DesktopProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string]$Arguments = "",
    [string]$WorkingDirectory = "",
    [switch]$Hidden
  )

  $Info = [System.Diagnostics.ProcessStartInfo]::new()
  $Info.FileName = $FilePath
  $Info.Arguments = $Arguments
  if ($WorkingDirectory) {
    $Info.WorkingDirectory = $WorkingDirectory
  }
  $Info.UseShellExecute = $false
  $Info.CreateNoWindow = [bool]$Hidden
  if ($Hidden) {
    $Info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  }

  $Process = [System.Diagnostics.Process]::new()
  $Process.StartInfo = $Info
  [void]$Process.Start()
  return $Process
}

if (!(Test-Path -LiteralPath $NodeExe)) {
  $NodeExe = "node.exe"
}

if (!(Test-Path -LiteralPath $AppScript)) {
  throw "Could not find the app script: $AppScript"
}

New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
New-Item -ItemType Directory -Force -Path $UserDataDir | Out-Null

$Port = Find-FreePort -StartPort $PreferredPort
$Url = "http://127.0.0.1:$Port/index.html"
$StatusUrl = "http://127.0.0.1:$Port/api/status"
$NodeArgs = "`"$AppScript`" --no-open --port $Port"
$NodeProcess = $null

try {
  $NodeProcess = Start-DesktopProcess -FilePath $NodeExe -Arguments $NodeArgs -WorkingDirectory $Root -Hidden

  if (!(Wait-ForServer -Url $StatusUrl)) {
    throw "The app did not start in time. Check the logs at: $LogsDir"
  }

  if ($SmokeTest) {
    $Payload = Invoke-RestMethod -Uri $StatusUrl -TimeoutSec 3
    Write-Output (@{
      ok = $true
      totalTickers = $Payload.totalTickers
      url = $Url
    } | ConvertTo-Json -Depth 4)
    return
  }

  if ($NoOpen) {
    Write-Output "SimpleEquity: $Url"
    while ($NodeProcess -and !$NodeProcess.HasExited) {
      Start-Sleep -Seconds 2
    }
    return
  }

  $EdgeExe = Find-Edge
  if ($EdgeExe) {
    $EdgeArgs = "--app=$Url --user-data-dir=`"$UserDataDir`""
    $EdgeProcess = Start-DesktopProcess -FilePath $EdgeExe -Arguments $EdgeArgs
    $EdgeProcess.WaitForExit()
  } else {
    [void](Start-DesktopProcess -FilePath "cmd.exe" -Arguments "/c start `"`" `"$Url`"" -Hidden)
    while ($NodeProcess -and !$NodeProcess.HasExited) {
      Start-Sleep -Seconds 2
    }
  }
} finally {
  if ($NodeProcess -and !$NodeProcess.HasExited) {
    Stop-Process -Id $NodeProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
