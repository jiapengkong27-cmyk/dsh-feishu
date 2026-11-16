param(
  [string]$Root = "",
  [string]$LarkCli = "",
  [string]$TaskName = "FeishuCLIBridgeSender"
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Root) {
  $dshHome = $env:DSH_HOME
  if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE ".dsh" }
  $Root = Join-Path $dshHome "feishu-bridge"
}

if (-not (Get-Command wscript.exe -ErrorAction SilentlyContinue)) {
  throw "wscript.exe not found: this bridge targets Windows"
}

Write-Output "installing bridge into $Root"
New-Item -ItemType Directory -Force $Root | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Root "events") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Root "outbox") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Root "outbox\failed") | Out-Null

foreach ($f in @("sender.ps1", "bridge.ps1", "enqueue.ps1")) {
  Copy-Item (Join-Path $scriptRoot $f) (Join-Path $Root $f) -Force
}

# Hidden launcher. Written as UTF-16 because the path may contain non-ASCII text;
# the scheduled task only ever runs this file.
$senderPath = Join-Path $Root "sender.ps1"
$launcher = Join-Path $Root "run-hidden.vbs"
$vbs = @"
' Run sender.ps1 in a hidden window (UTF-16 VBS so non-ASCII paths survive)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""$senderPath""", 0, False
"@
Set-Content -Path $launcher -Value $vbs -Encoding Unicode

if ($LarkCli) {
  @{ larkCli = $LarkCli } | ConvertTo-Json | Set-Content -Path (Join-Path $Root "config.json") -Encoding UTF8
  Write-Output "lark-cli pinned in config.json: $LarkCli"
}

$action = 'wscript.exe //B "' + $launcher + '"'
schtasks /Create /F /SC MINUTE /MO 1 /TN $TaskName /TR $action | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks /Create failed with exit code $LASTEXITCODE" }

$query = schtasks /Query /TN $TaskName /FO LIST /V 2>&1 | Select-String -Pattern "Status:|Task To Run:"
$query | ForEach-Object { Write-Output $_.Line.Trim() }

Write-Output ""
Write-Output "bridge ready."
Write-Output "  root : $Root"
Write-Output "  task : $TaskName (every minute)"
Write-Output "  next : run  powershell -File `"$Root\sender.ps1`"  once to start the subscriber and flush the queue"