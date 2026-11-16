param(
  [string]$LarkCli = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EventsDir = Join-Path $Root "events"
$Outbox = Join-Path $Root "outbox"
$FailedDir = Join-Path $Outbox "failed"
$StatusPath = Join-Path $Root "status.json"
$Log = Join-Path $Root "sender.log"

# lark-cli: -LarkCli wins, then <root>/config.json, then PATH.
if (-not $LarkCli) {
  $ConfigPath = Join-Path $Root "config.json"
  if (Test-Path $ConfigPath) {
    try {
      $cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($cfg.larkCli) { $LarkCli = [string]$cfg.larkCli }
    } catch { }
  }
}
if (-not $LarkCli) {
  foreach ($name in @("lark-cli.cmd", "lark-cli.exe", "lark-cli")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { $LarkCli = $cmd.Source; break }
  }
}
if (-not $LarkCli) {
  throw "lark-cli not found: pass -LarkCli <path>, set 'larkCli' in $ConfigPath, or add it to PATH"
}

New-Item -ItemType Directory -Force $EventsDir, $Outbox, $FailedDir | Out-Null

function Log($msg) {
  Add-Content -Path $Log -Value ("[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $msg) -Encoding UTF8
}

function Get-ConsumerAlive {
  try {
    $out = & $LarkCli event status 2>&1 | Out-String
    return ($out -match "Active consumers:\s+[1-9]")
  } catch { return $false }
}

function Ensure-Consumer {
  if (Get-ConsumerAlive) { return $true }
  Log "consumer not alive; starting"
  Start-Process -FilePath $LarkCli `
    -ArgumentList @("event", "consume", "im.message.receive_v1", "--as", "bot", "--timeout", "168h", "--output-dir", $EventsDir) `
    -WindowStyle Hidden -RedirectStandardOutput (Join-Path $Root "consumer.out") -RedirectStandardError (Join-Path $Root "consumer.err")
  Start-Sleep -Seconds 6
  return (Get-ConsumerAlive)
}

function Send-Text($chatId, $text) {
  try {
    $out = & $LarkCli im +messages-send --as bot --chat-id $chatId --text $text 2>&1 | Out-String
    return ($out -match '"ok"\s*:\s*true')
  } catch { return $false }
}

$sent = 0
$failed = 0

$alive = Ensure-Consumer
if (-not $alive) { Log "consumer ensure failed" }

foreach ($f in Get-ChildItem $Outbox -Filter "*.json" -File -ErrorAction SilentlyContinue) {
  try {
    $item = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    $ok = $false
    if ($item.kind -eq "text") {
      $ok = Send-Text $item.chat_id $item.text
    }
    if ($ok) {
      Remove-Item $f.FullName -Force
      $sent++
      Log ("sent text to " + $item.chat_id + " (" + $item.message_id + ")")
    } else {
      $failed++
      Log ("send failed, keeping for retry: " + $f.Name)
    }
  } catch {
    $failed++
    Log ("bad outbox item " + $f.Name + ": " + $_.Exception.Message)
  }
}

$status = [pscustomobject]@{
  time = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  consumer_alive = $alive
  sent_this_run = $sent
  failed_this_run = $failed
}
$status | ConvertTo-Json -Depth 4 | Set-Content -Path $StatusPath -Encoding UTF8
Write-Output ("sender run: alive=" + $alive + " sent=" + $sent + " failed=" + $failed)