param(
  [string]$Repo = "dsh-feishu",
  [string]$Owner = "",
  [string]$Message = "feat: Feishu link for DSH (observer + board + Windows bridge)",
  [string]$Proxy = "",
  [string]$GitExe = "",
  [switch]$Public
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $root
Set-Location $root

function Note($text) { Write-Host $text -ForegroundColor Cyan }
function Warn($text) { Write-Host $text -ForegroundColor Yellow }

if ($Proxy) {
  $env:HTTP_PROXY = $Proxy
  $env:HTTPS_PROXY = $Proxy
}

Note "repo: $root"

# --- 1. tooling ---------------------------------------------------------------
$git = if ($GitExe) { $GitExe } else { (Get-Command git -ErrorAction SilentlyContinue).Source }
if (-not $git -or -not (Test-Path $git)) {
  Warn "git not found."
  Warn "  winget install --id Git.Git -e --source winget"
  Warn "  or https://git-scm.com/download/win"
  Warn "  or pass -GitExe <path to git.exe> (a portable MinGit works)"
  exit 1
}
Write-Host ("git " + (& $git --version))

$gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
$ghReady = $false
if ($gh) {
  & $gh auth status 2>&1 | Out-Null
  $ghReady = ($LASTEXITCODE -eq 0)
  if (-not $ghReady) { Warn "gh is installed but not signed in (gh auth login)." }
} else {
  Warn "gh (GitHub CLI) not found; the repository will be created in the browser instead."
}

# --- 2. network ---------------------------------------------------------------
$reachable = $false
try {
  $args = @{ UseBasicParsing = $true; TimeoutSec = 15; Uri = "https://api.github.com/zen" }
  if ($Proxy) { $args.Proxy = $Proxy }
  Invoke-WebRequest @args | Out-Null
  $reachable = $true
} catch {
  Warn "api.github.com is unreachable (a proxy/VPN is required on some networks)."
}
if ($reachable) { Note "github.com reachable" }

# --- 3. local repository ------------------------------------------------------
if (-not (Test-Path (Join-Path $root ".git"))) {
  & $git init -b main | Out-Null
  Note "initialised git repository (branch main)"
} else {
  Note "existing git repository detected"
}
if ($Proxy) {
  & $git config http.proxy $Proxy
  Note "git http.proxy = $Proxy (local to this repository)"
}

& $git add -A
$staged = (& $git diff --cached --name-only | Measure-Object).Count
if ($staged -eq 0) {
  Note "nothing new to commit"
} else {
  & $git -c user.name="$env:USERNAME" -c user.email="$env:USERNAME@users.noreply.github.com" commit -m $Message | Out-Null
  Note "committed $staged file(s)"
}

# --- 4. remote ----------------------------------------------------------------
$remote = (& $git remote get-url origin 2>$null)
if ($LASTEXITCODE -eq 0 -and $remote) {
  Note "origin already set: $remote"
} elseif ($ghReady) {
  $visibility = if ($Public) { "--public" } else { "--private" }
  $target = if ($Owner) { "$Owner/$Repo" } else { $Repo }
  & $gh repo create $target $visibility --source . --push
  if ($LASTEXITCODE -ne 0) { throw "gh repo create failed" }
  Note "repository created and pushed: $target"
  exit 0
} else {
  if (-not $Owner) { $Owner = "<your-github-account>" }
  Warn ""
  Warn "Create the empty repository (no README, no .gitignore) at:"
  Warn "  https://github.com/new?name=$Repo"
  Warn "then run:"
  Warn "  git remote add origin https://github.com/$Owner/$Repo.git"
  Warn "  git push -u origin main"
  exit 0
}

if ($reachable) {
  & $git push -u origin HEAD
  Note "pushed"
} else {
  Warn "Push skipped: github.com unreachable. Start your proxy and run: git push -u origin HEAD"
}