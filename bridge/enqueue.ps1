param(
  [Parameter(Mandatory = $true)][string]$ChatId,
  [Parameter(Mandatory = $true)][string]$Text,
  [string]$MessageId = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Outbox = Join-Path $Root "outbox"
New-Item -ItemType Directory -Force $Outbox | Out-Null

$item = [pscustomobject]@{
  kind = "text"
  chat_id = $ChatId
  text = $Text
  message_id = $MessageId
  queued_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
}
$name = [guid]::NewGuid().ToString("N") + ".json"
$item | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $Outbox $name) -Encoding UTF8
Write-Output ("queued:" + $name)