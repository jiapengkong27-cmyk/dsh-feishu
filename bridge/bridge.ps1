param(
  [Parameter(Position = 0)][string]$Command = "help",
  [Parameter(Position = 1)][string]$Arg = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$EventsDir = Join-Path $Root "events"
$StatePath = Join-Path $Root "state.json"
$StatusPath = Join-Path $Root "status.json"

New-Item -ItemType Directory -Force $EventsDir | Out-Null
if (-not (Test-Path $StatePath)) { Set-Content -Path $StatePath -Value '{"processed":[]}' -Encoding utf8 }

function Get-State {
  try { return Get-Content $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { return [pscustomobject]@{ processed = @() } }
}

function Save-State($state) {
  $state | ConvertTo-Json -Depth 4 | Set-Content -Path $StatePath -Encoding utf8
}

function Ensure-Consumer {
  # Do NOT call lark-cli here: this script may run inside the restricted bridge session.
  # sender.ps1 (outside DSH sandbox, Windows Task Scheduler) maintains status.json.
  if (Test-Path $StatusPath) {
    try {
      $st = Get-Content $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
      Write-Output ("consumer-alive=" + $st.consumer_alive + " last_sender_run=" + $st.time)
      return
    } catch { }
  }
  Write-Output "consumer-status-missing (sender.ps1 will refresh within 1 minute)"
}

function Get-Pending {
  $state = Get-State
  $done = @{}
  foreach ($id in $state.processed) { $done[[string]$id] = $true }
  $items = @()
  foreach ($f in Get-ChildItem $EventsDir -Filter "*.json" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime) {
    try {
      $ev = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch { continue }
    $mid = [string]$ev.message_id
    if (-not $mid) { continue }
    if ($done.ContainsKey($mid)) { continue }
    $text = ""
    if ($ev.message_type -eq "text") {
      try { $text = ($ev.content | ConvertFrom-Json).text } catch { $text = [string]$ev.content }
    } else {
      $text = "[non-text:" + $ev.message_type + "]"
    }
    $items += [pscustomobject]@{
      message_id = $mid
      chat_id = [string]$ev.chat_id
      chat_type = [string]$ev.chat_type
      sender_id = [string]$ev.sender_id
      create_time = [string]$ev.create_time
      text = $text
    }
  }
  if ($items.Count -eq 0) { Write-Output "no-pending"; return }
  $items | ConvertTo-Json -Depth 4
}

function Mark-Done {
  if (-not $Arg) { Write-Output "error: missing message_id"; return }
  $state = Get-State
  $list = @($state.processed) + @($Arg)
  $state.processed = @($list | Select-Object -Unique)
  Save-State $state
  Write-Output ("marked:" + $Arg)
}

function Drain-Backlog {
  $state = Get-State
  $ids = @($state.processed)
  $count = 0
  foreach ($f in Get-ChildItem $EventsDir -Filter "*.json" -File -ErrorAction SilentlyContinue) {
    try { $ev = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json } catch { continue }
    $mid = [string]$ev.message_id
    if (-not $mid) { continue }
    if ($ids -notcontains $mid) { $ids += $mid; $count++ }
  }
  $state.processed = @($ids | Select-Object -Unique)
  Save-State $state
  Write-Output ("drained:" + $count)
}

function Show-Status {
  if (Test-Path $StatusPath) {
    Get-Content $StatusPath -Raw -Encoding UTF8
  } else {
    "status.json missing"
  }
  $state = Get-State
  Write-Output ("processed-count: " + @($state.processed).Count)
  $pendingFiles = (Get-ChildItem $EventsDir -Filter "*.json" -File -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Output ("event-files: " + $pendingFiles)
}

switch ($Command.ToLower()) {
  "ensure"  { Ensure-Consumer }
  "pending" { Get-Pending }
  "mark"    { Mark-Done }
  "drain"   { Drain-Backlog }
  "status"  { Show-Status }
  default { "usage: bridge.ps1 ensure|pending|mark <message_id>|drain|status" }
}