/**
 * dsh-feishu-observer — Host half.
 *
 * Watches the DSH <-> Feishu link (lark-cli auth, event bus, bridge sender,
 * open-platform API), records a timeline, diagnoses and repairs a broken link,
 * and sends an "online" notice to Feishu when DSH starts.
 *
 * The browser half polls `/feishu-observer/status` and triggers
 * `/feishu-observer/action` for manual checks.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import net from 'node:net'

const DEFAULTS = {
  /** Chat that receives online / break / manual notices. Empty = notices disabled. */
  chatId: '',
  /** Display name of that chat; falls back to the id. */
  chatLabel: '',
  /** lark-cli entry. Empty = discovered from PATH. */
  larkCli: '',
  /** Bridge working directory. Empty = <DSH_HOME>/feishu-bridge. */
  bridgeDir: '',
  senderScript: '',
  senderTask: 'FeishuCLIBridgeSender',
  stateDir: '',
  pollSeconds: 30,
  probeSeconds: 120,
  onlineCooldownMinutes: 0,
  senderStaleSeconds: 180,
  senderDeadSeconds: 600,
  inboundQuietHours: 24,
  notifyOnStart: true,
  notifyOnRecover: true,
  notifyOnBreak: true,
  /** Tell Feishu when the user manually unplugs the link, and when it comes back. */
  notifyOnDisconnect: true,
  notifyOnReconnect: true,
  historyLimit: 80,
  /** Show the floating capsule. The sidebar board keeps working without it. */
  showCapsule: true,
  /** Schedules paused while the link is manually disconnected (matched by title prefix). */
  pauseSchedules: [],
}

const VERSION = '1.1.0'
const HISTORY_MAX = 200

function nowIso() {
  return new Date().toISOString()
}

function clock(date) {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function dateText(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function clampText(value, limit) {
  const text = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim()
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text
}

/** How long the link stayed unplugged, in the roughest useful unit. */
function quietDuration(ms) {
  const value = Number(ms) || 0
  if (value < 60000) return '不到 1 分钟'
  const minutes = Math.round(value / 60000)
  if (minutes < 60) return minutes + ' 分钟'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? hours + ' 小时' : hours + ' 小时 ' + rest + ' 分钟'
}

function parseJsonLoose(text) {
  if (typeof text !== 'string') return undefined
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

/**
 * Hidden command launcher.
 *
 * Spawning a console child straight from the Electron host makes Windows
 * allocate a console, and the user's default terminal then flashes a window
 * every time the connection is checked. wscript.exe (a GUI-subsystem host)
 * runs a small batch file with a hidden window, so the child inherits a
 * hidden console and nothing appears on screen.
 */

/** Paths inside the batch file must be ASCII: cmd reads it in the OEM code page. */
function isAsciiPath(value) {
  return /^[\x20-\x7E]+$/.test(String(value))
}

function ensureHiddenRunner(dir) {
  mkdirSync(dir, { recursive: true })
  const runner = join(dir, 'run-hidden.vbs')
  const content = [
    'Dim sh, scriptPath, workdir',
    'scriptPath = WScript.Arguments(0)',
    'workdir = WScript.Arguments(1)',
    'Set sh = CreateObject("WScript.Shell")',
    'If workdir <> "" Then sh.CurrentDirectory = workdir',
    'sh.Run Chr(34) & scriptPath & Chr(34), 0, True',
  ].join('\r\n')
  writeFileSync(runner, content, 'ascii')
  return runner
}

function quoteWin(value) {
  return '"' + String(value) + '"'
}

/** Direct pipe-captured spawn: used only for non-ASCII paths, where a batch cannot carry them. */
function spawnDirect(exe, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20000
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    let out = ''
    const finish = (code, timedOut) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, out, err: '', ms: Date.now() - started, timedOut })
    }
    let child
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL')
      } catch {
        /* gone */
      }
      finish(-2, true)
    }, timeoutMs)
    try {
      child = spawn(exe, args, {
        cwd: options.cwd || process.cwd(),
        env: options.env || process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      finish(-1, false)
      return
    }
    child.stdout?.on('data', (chunk) => {
      out += chunk.toString('utf8')
      if (out.length > 262144) out = out.slice(-262144)
    })
    child.stderr?.on('data', (chunk) => {
      out += chunk.toString('utf8')
      if (out.length > 262144) out = out.slice(-262144)
    })
    child.on('error', () => finish(-1, false))
    child.on('close', (code) => finish(code === null ? -1 : code, false))
  })
}

function spawnHidden(tempRoot, exe, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 20000
  const dir = join(tempRoot, 'jobs', Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7))
  const outFile = join(dir, 'out.txt')
  const codeFile = join(dir, 'code.txt')
  const batFile = join(dir, 'run.bat')
  const workdir = options.cwd || tempRoot
  const parts = [quoteWin(exe), ...args.map(quoteWin)]
  if (!isAsciiPath(dir) || !isAsciiPath(outFile) || !isAsciiPath(batFile) || ![exe, ...args].every(isAsciiPath)) {
    return spawnDirect(exe, args, { ...options, timeoutMs })
  }
  mkdirSync(dir, { recursive: true })
  const batch = [
    '@echo off',
    parts.join(' ') + ' 1>' + quoteWin(outFile) + ' 2>&1',
    'echo %ERRORLEVEL% > ' + quoteWin(codeFile),
  ].join('\r\n') + '\r\n'
  try {
    writeFileSync(batFile, batch, 'ascii')
  } catch {
    return spawnDirect(exe, args, { ...options, timeoutMs })
  }
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    let child
    const read = (file) => {
      try {
        return readFileSync(file, 'utf8')
      } catch {
        return ''
      }
    }
    // 作业目录清理必须容错：sender.ps1 会用 Start-Process 拉起 168h 的
    // `lark-cli event consume` 订阅进程，它继承了本作业 out.txt 的重定向句柄，
    // Windows 下删除目录会 EPERM；而这里位于 ChildProcess 的 close 监听中，
    // 抛出即变成 host 级未捕获异常（整机崩溃）。失败只允许静默重试。
    const removeJobDir = (attempt = 0) => {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        if (attempt >= 3) return
        const retry = setTimeout(() => removeJobDir(attempt + 1), 1000 * (attempt + 1))
        if (typeof retry.unref === 'function') retry.unref()
      }
    }
    const finish = (timedOut) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const out = read(outFile).slice(0, 262144)
      const rawCode = read(codeFile).trim()
      const parsed = rawCode === '' ? -1 : Number(rawCode)
      removeJobDir()
      resolve({
        code: timedOut ? -2 : (Number.isFinite(parsed) ? parsed : -1),
        out,
        err: '',
        ms: Date.now() - started,
        timedOut,
      })
    }
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      setTimeout(() => finish(true), 300)
    }, timeoutMs)
    try {
      child = spawn('wscript.exe', ['//B', '//Nologo', ensureHiddenRunner(tempRoot), batFile, workdir], {
        cwd: workdir,
        env: options.env || process.env,
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch {
      finish(false)
      return
    }
    child.on('error', () => finish(false))
    child.on('close', () => finish(false))
  })
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const socket = net.connect({ host, port })
    const finish = (result) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* noop */
      }
      resolve({ ...result, ms: Date.now() - started })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ ok: true }))
    socket.once('timeout', () => finish({ ok: false, error: '连接超时' }))
    socket.once('error', (error) => finish({ ok: false, error: error && error.code ? error.code : String(error) }))
  })
}

function overallOf(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return 'unknown'
  const critical = new Set(['cli', 'auth', 'bus', 'sender', 'api'])
  const down = checks.some((check) => check.status === 'fail' && critical.has(check.id))
  if (down) return 'down'
  const soft = checks.some((check) => check.status === 'warn' && critical.has(check.id))
  return soft ? 'degraded' : 'ok'
}

/** A paused record only counts when it carries a parseable "when". */
function normalizePause(value) {
  if (!value || typeof value !== 'object' || !value.at) return null
  const at = new Date(value.at)
  if (Number.isNaN(at.getTime())) return null
  const schedules = Array.isArray(value.schedules)
    ? value.schedules
        .filter((item) => item && typeof item.id === 'string')
        .map((item) => ({ id: item.id, title: String(item.title || '') }))
    : []
  return { at: at.toISOString(), detail: String(value.detail || ''), schedules }
}

export const inject = ['webServer']

export function apply(ctx, rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {}
  const cfg = { ...DEFAULTS, ...config }
  const root = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const bootId = Date.now().toString(36) + '-' + process.pid
  const startedAt = nowIso()
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const stateDir = cfg.stateDir || join(dshHome, 'feishu-observer')
  const statePath = join(stateDir, 'state.json')
  const bridgeDir = cfg.bridgeDir || join(dshHome, 'feishu-bridge')
  const senderScript = cfg.senderScript || join(bridgeDir, 'sender.ps1')
  const statusPath = join(bridgeDir, 'status.json')
  const eventsDir = join(bridgeDir, 'events')
  const chatId = String(cfg.chatId || '').trim()
  const chatLabel = String(cfg.chatLabel || '').trim() || (chatId || '—')

  // lark-cli is discovered lazily: `apply` is synchronous, and a PATH lookup
  // needs a process. The first probe resolves it, everything after reuses it.
  let larkCli = String(cfg.larkCli || '').trim()
  let larkCliLooked = Boolean(larkCli)
  const larkPaths = () => {
    if (!larkCli) return { cli: '', exe: '', runJs: '' }
    const base = dirname(larkCli)
    return {
      cli: larkCli,
      exe: join(base, 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe'),
      runJs: join(base, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'),
    }
  }
  const ensureLarkCli = async () => {
    if (larkCliLooked) return larkCli
    larkCliLooked = true
    for (const probe of ['lark-cli.cmd', 'lark-cli']) {
      const found = await spawnHidden(stateDir, 'where.exe', [probe], { timeoutMs: 8000 })
      const first = String(found.out || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0]
      if (found.code === 0 && first) {
        larkCli = first
        break
      }
    }
    return larkCli
  }

  mkdirSync(stateDir, { recursive: true })

  const log = (level, message) => {
    const line = 'dsh-feishu-observer: ' + message
    if (level === 'error') ctx.logger?.warn?.(line)
    else if (level === 'warn') ctx.logger?.warn?.(line)
    else ctx.logger?.info?.(line)
  }

  let state = { history: [], lastOnlineAt: 0, lastNotifyPid: 0, lastNotifyOkAt: 0, lastNotify: null, lastSend: null, pause: null }
  try {
    state = { ...state, ...JSON.parse(readFileSync(statePath, 'utf8')) }
  } catch {
    /* first run */
  }
  if (!Array.isArray(state.history)) state.history = []

  // A manual disconnect survives restarts: while it is set, nothing probes,
  // repairs, or notifies — otherwise the periodic cycle would reconnect the
  // bridge the user just unplugged.
  let pause = normalizePause(state.pause)
  const isPaused = () => Boolean(pause)

  let snapshot = {
    version: VERSION,
    bootId,
    startedAt,
    checkedAt: null,
    checking: false,
    paused: Boolean(pause),
    pausedAt: pause ? pause.at : null,
    pauseDetail: pause ? pause.detail : '',
    overall: pause ? 'paused' : 'unknown',
    headline: pause ? '已手动断开飞书连接' : '正在检测飞书连接…',
    checks: [],
    diagnosis: null,
    online: null,
    lastSend: state.lastSend || null,
    lastInbound: null,
    history: state.history.slice(-HISTORY_MAX),
    pollSeconds: Number(cfg.pollSeconds) || 30,
    probeSeconds: Number(cfg.probeSeconds) || 120,
    config: {
      chatId,
      chatLabel,
      notifyOnStart: cfg.notifyOnStart !== false,
      larkCli,
      bridgeDir,
      showCapsule: cfg.showCapsule !== false,
    },
    hostPlatform: process.platform,
    dshVersion: process.env.DSH_VERSION || '',
  }
  for (let i = 0; i < snapshot.history.length; i++) {
    const entry = snapshot.history[i]
    if (!entry || typeof entry !== 'object') continue
    if (!entry.at) entry.at = startedAt
    if (!entry.level) entry.level = 'info'
  }

  const persist = () => {
    state.history = snapshot.history.slice(-HISTORY_MAX)
    if (snapshot.online && !snapshot.online.skipped) state.lastNotify = snapshot.online
    state.lastSend = snapshot.lastSend || state.lastSend || null
    state.pause = pause
    snapshot.history = state.history.slice(-HISTORY_MAX)
    try {
      writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
    } catch (error) {
      log('warn', 'state save failed: ' + (error && error.message ? error.message : error))
    }
  }

  const remember = (level, kind, text) => {
    const entry = { at: nowIso(), level, kind, text: String(text) }
    snapshot.history.push(entry)
    if (snapshot.history.length > HISTORY_MAX) snapshot.history = snapshot.history.slice(-HISTORY_MAX)
    log(level === 'error' ? 'error' : 'info', text)
    return entry
  }

  const runLark = async (args, options = {}) => {
    // Run the Go binary directly. The npm shim's run.js starts it through Node,
    // which opens a console window for its child on every call (visible flash);
    // launching the binary inside the hidden console keeps it invisible.
    await ensureLarkCli()
    const paths = larkPaths()
    if (!paths.cli) {
      return { code: -1, out: '', err: '找不到 lark-cli：把它加入 PATH，或在插件配置里设置 larkCli', ms: 0, timedOut: false }
    }
    const useExe = existsSync(paths.exe)
    const useRunJs = !useExe && existsSync(paths.runJs)
    const command = useExe ? paths.exe : useRunJs ? process.execPath : paths.cli
    const argv = useExe ? args : useRunJs ? [paths.runJs, ...args] : args
    const env = useRunJs ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env
    return spawnHidden(stateDir, command, argv, {
      cwd: options.cwd || stateDir,
      env,
      timeoutMs: options.timeoutMs || 20000,
    })
  }

  const runPowerShell = (script, timeoutMs) =>
    spawnHidden(stateDir, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', basename(script)], {
      cwd: bridgeDir,
      timeoutMs: timeoutMs || 60000,
    })

  const runPowerShellIn = (dir, script, timeoutMs, env) =>
    spawnHidden(stateDir, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', basename(script)], {
      cwd: dir,
      timeoutMs: timeoutMs || 30000,
      env: env || process.env,
    })

  const runSchtasks = (args, timeoutMs) =>
    spawnHidden(stateDir, 'schtasks.exe', args, { cwd: bridgeDir, timeoutMs: timeoutMs || 25000 })

  /**
   * Helper scripts live in stateDir on purpose: the batch launcher that keeps the
   * console hidden can only carry ASCII paths, and the workspace directory is not.
   */
  const writeHelper = (name, lines) => {
    const file = join(stateDir, name)
    try {
      writeFileSync(file, lines.join('\r\n') + '\r\n', 'ascii')
      return file
    } catch {
      return ''
    }
  }

  const stopConsumers = async () => {
    // The subscriber's command line carries the non-ASCII events directory, so the
    // batch-safe script receives it through the environment instead of a literal.
    const script = writeHelper('stop-consumers.ps1', [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$dir = $env:FOBS_EVENTS_DIR",
      "$all = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -match 'event\\s+consume') })",
      '$targets = @()',
      'if ($dir) { $targets = @($all | Where-Object { $_.CommandLine.IndexOf($dir, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }',
      'if ($targets.Count -eq 0) { $targets = $all }',
      '$ids = @($targets | ForEach-Object { [int]$_.ProcessId })',
      'foreach ($item in $targets) { try { Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue } catch { } }',
      "Write-Output ('stopped=' + $ids.Count)",
      "Write-Output ('pids=' + ($ids -join ','))",
    ])
    if (!script) return { ok: false, count: 0, detail: '无法写入断开脚本' }
    const result = await runPowerShellIn(stateDir, script, 30000, { ...process.env, FOBS_EVENTS_DIR: eventsDir })
    const match = /stopped=(\d+)/.exec(result.out || '')
    const count = match ? Number(match[1]) : 0
    return {
      ok: result.code === 0,
      count,
      detail: result.code === 0
        ? '已结束 ' + count + ' 个订阅进程'
        : '结束进程失败：' + clampText((result.out || result.err || '').trim() || 'code ' + result.code, 120),
    }
  }

  const stopEventBus = async () => {
    const result = await runLark(['event', 'stop', '--force'], { timeoutMs: 30000 })
    const out = String(result.out || '')
    const parsed = parseJsonLoose(out)
    const noBus = /no running bus|no bus|not running/i.test(out)
    const ok = result.code === 0 || noBus || Boolean(parsed && parsed.ok === true)
    return {
      ok,
      detail: ok
        ? '事件总线已停止'
        : '停止事件总线失败：' + clampText((parsed && parsed.error && parsed.error.message) || out.trim() || 'code ' + result.code, 120),
    }
  }

  const scheduleService = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('schedule') : undefined
    } catch {
      return undefined
    }
  }

  /** Pause the DSH schedules that exist only to serve Feishu, so a disconnected link stays quiet. */
  const pauseSchedules = async () => {
    const titles = (Array.isArray(cfg.pauseSchedules) ? cfg.pauseSchedules : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
    const label = '暂停飞书轮询任务'
    if (titles.length === 0) return { label, status: 'skip', detail: '未配置需要暂停的定时任务', paused: [] }
    const service = scheduleService()
    if (!service || typeof service.list !== 'function' || typeof service.edit !== 'function') {
      return { label, status: 'skip', detail: '当前环境没有定时任务服务', paused: [] }
    }
    try {
      const page = await service.list({ limit: 200 })
      const items = Array.isArray(page && page.items) ? page.items : []
      const targets = items.filter((item) => item
        && item.status === 'active'
        && titles.some((title) => String(item.title || '').indexOf(title) === 0))
      const pausedList = []
      for (const item of targets) {
        const result = await service.edit({ id: item.id, action: 'update', patch: { active: false } })
        if (result && result.status === 'paused') pausedList.push({ id: item.id, title: String(item.title || '') })
      }
      return {
        label,
        status: targets.length === 0 ? 'skip' : pausedList.length === targets.length ? 'ok' : 'warn',
        detail: targets.length === 0
          ? '没有需要暂停的轮询任务'
          : '已暂停 ' + pausedList.map((item) => item.title).join('、'),
        paused: pausedList,
      }
    } catch (error) {
      return { label, status: 'warn', detail: clampText(error && error.message ? error.message : error, 120), paused: [] }
    }
  }

  const resumeSchedules = async (entries) => {
    const list = Array.isArray(entries) ? entries : []
    if (list.length === 0) return []
    const service = scheduleService()
    if (!service || typeof service.edit !== 'function') return []
    const resumed = []
    for (const entry of list) {
      try {
        const result = await service.edit({ id: entry.id, action: 'update', patch: { active: true } })
        if (result && result.status === 'active') resumed.push(String(result.title || entry.title || ''))
      } catch {
        /* the task may have been deleted meanwhile */
      }
    }
    return resumed
  }

  const pauseBridge = async () => {
    const steps = []

    // The scheduled task is what recreates the subscriber every minute.
    await runSchtasks(['/End', '/TN', cfg.senderTask]).catch(() => null)
    const disable = await runSchtasks(['/Change', '/TN', cfg.senderTask, '/DISABLE'])
    steps.push({
      label: '停用计划任务 ' + cfg.senderTask,
      status: disable.code === 0 ? 'ok' : 'warn',
      detail: disable.code === 0
        ? '不会再自动拉起订阅与发送'
        : '停用失败：' + clampText((disable.out || '').trim() || 'code ' + disable.code, 120),
    })

    // Kill the subscribers first: a live consumer would restart the bus we stop next.
    const consumers = await stopConsumers()
    steps.push({ label: '结束事件订阅进程', status: consumers.ok ? 'ok' : 'warn', detail: consumers.detail })

    const bus = await stopEventBus()
    steps.push({ label: '停止事件总线', status: bus.ok ? 'ok' : 'warn', detail: bus.detail })

    const schedules = await pauseSchedules()
    steps.push({ label: schedules.label, status: schedules.status, detail: schedules.detail })

    const status = await runLark(['event', 'status'], { timeoutMs: 20000 })
    const running = /Bus:\s+running/i.test(status.out || '')
    steps.push({
      label: '复查断联结果',
      status: running ? 'warn' : 'ok',
      detail: running ? '事件总线仍在运行，可再点一次“断开连接”' : '事件总线已停止，飞书消息不再进入 DSH',
    })
    return { steps, schedules: schedules.paused, quiet: !running }
  }

  /** The bus needs a few seconds to dial Feishu; poll instead of trusting one fixed sleep. */
  const waitForBus = async (timeoutMs) => {
    const started = Date.now()
    const deadline = started + Math.max(4000, Number(timeoutMs) || 20000)
    let last = ''
    while (Date.now() < deadline) {
      const status = await runLark(['event', 'status'], { timeoutMs: 15000 })
      last = status.out || ''
      if (/Bus:\s+running/i.test(last) && /Active consumers:\s+[1-9]/.test(last)) {
        return { ok: true, detail: '事件总线已恢复（' + Math.round((Date.now() - started) / 1000) + ' 秒）' }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    return { ok: false, detail: '事件总线未在限定时间内恢复：' + (clampText(last.replace(/\s+/g, ' ').trim(), 90) || '无输出') }
  }

  const resumeBridge = async (previous) => {
    const steps = []
    const enable = await runSchtasks(['/Change', '/TN', cfg.senderTask, '/ENABLE'])
    steps.push({
      label: '启用计划任务 ' + cfg.senderTask,
      status: enable.code === 0 ? 'ok' : 'warn',
      detail: enable.code === 0
        ? '恢复每分钟心跳与发送'
        : '启用失败：' + clampText((enable.out || '').trim() || 'code ' + enable.code, 120),
    })

    if (existsSync(senderScript)) {
      const result = await runPowerShell(senderScript, 90000)
      steps.push({
        label: '重新拉起桥接订阅',
        status: result.code === 0 ? 'ok' : 'warn',
        detail: result.code === 0
          ? 'sender.ps1 已执行，订阅与待发队列已恢复'
          : 'sender.ps1 退出码 ' + result.code + '：' + clampText((result.out || '').trim(), 100),
      })
    } else {
      steps.push({ label: '重新拉起桥接订阅', status: 'fail', detail: '找不到 sender.ps1：' + senderScript })
    }

    const bus = await waitForBus(20000)
    steps.push({ label: '等待事件总线恢复', status: bus.ok ? 'ok' : 'warn', detail: bus.detail })

    // sender.ps1 wrote its heartbeat before the bus finished dialling, so the
    // sender check would read a stale "consumer not alive" for up to a minute.
    if (bus.ok && existsSync(senderScript)) {
      const refresh = await runPowerShell(senderScript, 60000)
      steps.push({
        label: '刷新桥接心跳',
        status: refresh.code === 0 ? 'ok' : 'warn',
        detail: refresh.code === 0 ? '发送器心跳已更新' : '心跳刷新失败：' + clampText((refresh.out || '').trim(), 80),
      })
    }

    const resumed = await resumeSchedules(previous && previous.schedules)
    steps.push({
      label: '恢复飞书轮询任务',
      status: resumed.length === 0 ? 'skip' : 'ok',
      detail: resumed.length === 0 ? '没有需要恢复的轮询任务' : '已恢复 ' + resumed.join('、'),
    })
    return steps
  }

  const sendFeishu = async (text, idempotencyKey) => {
    if (!chatId) return { ok: false, error: '未配置 chatId：请在插件配置里填写接收通知的会话', ms: 0 }
    const file = join(stateDir, 'outbound-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.txt')
    try {
      writeFileSync(file, text, 'utf8')
    } catch (error) {
      return { ok: false, error: '写入消息文件失败：' + (error && error.message ? error.message : error), ms: 0 }
    }
    const args = [
      'im', '+messages-send',
      '--as', 'bot',
      '--chat-id', chatId,
      '--text', '@' + basename(file),
    ]
    if (idempotencyKey) args.push('--idempotency-key', String(idempotencyKey).slice(0, 50))
    const result = await runLark(args, { cwd: stateDir, timeoutMs: 30000 })
    try {
      rmSync(file, { force: true })
    } catch {
      /* noop */
    }
    const parsed = parseJsonLoose(result.out)
    const ok = Boolean(parsed && parsed.ok === true)
    const error = ok
      ? undefined
      : clampText(
          (parsed && parsed.error && (parsed.error.message || parsed.error.type)) ||
            result.err ||
            result.out ||
            '发送失败（code ' + result.code + '）',
          160,
        )
    const messageId = ok && parsed.data && parsed.data.message_id ? String(parsed.data.message_id) : undefined
    return { ok, error, messageId, ms: result.ms }
  }

  let probeCache = { at: 0, status: 'warn', detail: '尚未探测', latencyMs: 0 }

  const checkCli = async () => {
    await ensureLarkCli()
    const paths = larkPaths()
    const exeOk = Boolean(paths.exe) && existsSync(paths.exe)
    const runJsOk = Boolean(paths.runJs) && existsSync(paths.runJs)
    const cliOk = Boolean(paths.cli) && existsSync(paths.cli)
    if (!paths.cli || (!exeOk && !runJsOk && !cliOk)) {
      return {
        id: 'cli', label: 'lark-cli 工具', status: 'fail', critical: true, latencyMs: 0,
        detail: paths.cli ? '找不到 lark-cli：' + paths.cli : '找不到 lark-cli（PATH 里没有）',
        hint: '安装 lark-cli 并把它加入 PATH，或在插件配置里设置 larkCli 路径。',
      }
    }
    return {
      id: 'cli', label: 'lark-cli 工具', status: 'ok', critical: true, latencyMs: 0,
      detail: exeOk ? '已安装 · 可直接调用' : '已安装',
    }
  }

  const checkAuth = async () => {
    const readAuth = async () => {
      const result = await runLark(['auth', 'status'], { timeoutMs: 20000 })
      return { result, parsed: parseJsonLoose(result.out) }
    }
    let { result, parsed } = await readAuth()
    if (!parsed) {
      return {
        id: 'auth', label: '飞书授权', status: 'fail', critical: true, latencyMs: result.ms,
        detail: '授权状态读取失败（code ' + result.code + '）',
        hint: '运行 lark-cli auth login 重新登录。',
      }
    }
    let bot = parsed.identities && parsed.identities.bot
    let user = parsed.identities && parsed.identities.user
    const isNeedsRefresh = (identity) => Boolean(identity
      && (identity.status === 'needs_refresh' || identity.tokenStatus === 'needs_refresh'))
    let refreshed = false
    // An expired access token is normal: lark-cli renews it on the next user
    // API call. Do that call ourselves so the dashboard is green again and the
    // refresh-token window slides forward (a week from the last use).
    if (isNeedsRefresh(user)) {
      const refreshExpiryMs = user && user.refreshExpiresAt ? Date.parse(user.refreshExpiresAt) : NaN
      if (Number.isFinite(refreshExpiryMs) && refreshExpiryMs > Date.now()) {
        const kick = await runLark(['im', '+chat-list', '--as', 'user', '--types=p2p', '--page-size=1'], { timeoutMs: 25000 })
        if (kick.code === 0 && /"ok"\s*:\s*true/.test(kick.out)) {
          const second = await readAuth()
          if (second.parsed) {
            parsed = second.parsed
            result = second.result
            bot = parsed.identities && parsed.identities.bot
            user = parsed.identities && parsed.identities.user
            refreshed = true
          }
        }
      }
    }
    const botReady = Boolean(bot && bot.status === 'ready')
    const userReady = Boolean(user && (user.status === 'ready' || user.tokenStatus === 'valid'))
    const accessExpiry = user && user.expiresAt ? Date.parse(user.expiresAt) : NaN
    const refreshExpiry = user && user.refreshExpiresAt ? Date.parse(user.refreshExpiresAt) : NaN
    const day = 86400000
    let expiryText = ''
    let authStatus = 'ok'
    let authHint
    if (Number.isFinite(refreshExpiry)) {
      const days = (refreshExpiry - Date.now()) / day
      expiryText = ' · 授权至 ' + dateText(refreshExpiry) + '（访问令牌自动续期）'
      if (days <= 0) {
        authStatus = 'fail'
        authHint = '用户授权已到期，请运行 lark-cli auth login 重新扫码授权。'
      } else if (days <= 3) {
        authStatus = 'warn'
        authHint = '用户授权将在 ' + Math.ceil(days) + ' 天内到期，请运行 lark-cli auth login 续期。'
      }
    } else if (Number.isFinite(accessExpiry)) {
      const minutes = (accessExpiry - Date.now()) / 60000
      expiryText = ' · 访问令牌至 ' + clock(accessExpiry) + '（无刷新令牌）'
      if (minutes <= 0) {
        authStatus = 'fail'
        authHint = '用户授权已过期，请运行 lark-cli auth login 重新扫码授权。'
      } else if (minutes <= 30) {
        authStatus = 'warn'
        authHint = '访问令牌即将到期且没有刷新令牌，请运行 lark-cli auth login 重新授权。'
      }
    }
    if (botReady && userReady) {
      return {
        id: 'auth', label: '飞书授权', status: authStatus, critical: true, latencyMs: result.ms,
        detail: '机器人身份就绪' + expiryText + (refreshed ? ' · 访问令牌已自动续期' : ''),
        hint: authHint,
      }
    }
    if (botReady && isNeedsRefresh(user)) {
      return {
        id: 'auth', label: '飞书授权', status: authStatus === 'fail' ? 'fail' : 'warn', critical: true, latencyMs: result.ms,
        detail: '访问令牌待续期，下一次用户接口调用会自动刷新' + expiryText,
        hint: authStatus === 'fail'
          ? '用户授权已到期，请运行 lark-cli auth login 重新扫码授权。'
          : '自动续期暂未成功；若持续出现，可运行 lark-cli auth login 手动续期。',
      }
    }
    const missing = !botReady ? '机器人身份不可用' : '用户授权不可用'
    return {
      id: 'auth', label: '飞书授权', status: 'fail', critical: true, latencyMs: result.ms,
      detail: missing + (user && user.message ? '（' + user.message + '）' : ''),
      hint: '运行 lark-cli auth login 并完成扫码授权。',
    }
  }

  const checkBus = async () => {
    const result = await runLark(['event', 'status'], { timeoutMs: 20000 })
    const out = result.out || ''
    const running = /Bus:\s+running/i.test(out)
    const consumerMatch = /Active consumers:\s+(\d+)/i.exec(out)
    const consumers = consumerMatch ? Number(consumerMatch[1]) : 0
    const hasMessageConsumer = /im\.message\.receive_v1/.test(out)
    if (running && consumers > 0) {
      return {
        id: 'bus', label: '事件长连接', status: hasMessageConsumer ? 'ok' : 'warn', critical: true, latencyMs: result.ms,
        detail: '总线运行中 · ' + consumers + ' 个消费者' + (hasMessageConsumer ? ' · 已订阅 im.message.receive_v1' : ' · 未订阅消息事件'),
        hint: hasMessageConsumer ? undefined : '重启桥接服务以恢复消息订阅。',
      }
    }
    return {
      id: 'bus', label: '事件长连接', status: 'fail', critical: true, latencyMs: result.ms,
      detail: running ? '总线运行中，但没有活跃消费者' : '事件总线未运行',
      hint: '点击“一键排查修复”，系统会重启桥接订阅。',
    }
  }

  const checkSender = async () => {
    if (!existsSync(statusPath)) {
      return {
        id: 'sender', label: '桥接发送器', status: 'fail', critical: true, latencyMs: 0,
        detail: '找不到桥接状态文件：' + statusPath,
        hint: '确认 bridgeDir 配置指向 feishu-bridge 目录。',
      }
    }
    let parsed
    try {
      parsed = JSON.parse(readFileSync(statusPath, 'utf8').replace(/^\uFEFF/, ''))
    } catch {
      return {
        id: 'sender', label: '桥接发送器', status: 'fail', critical: true, latencyMs: 0,
        detail: '桥接状态文件无法解析',
        hint: '点击“一键排查修复”重新生成心跳。',
      }
    }
    const at = Date.parse(String(parsed.time || '').replace(' ', 'T'))
    const age = Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY
    const ageSeconds = Math.round(age / 1000)
    const alive = parsed.consumer_alive === true
    const sent = Number(parsed.sent_this_run) || 0
    const failed = Number(parsed.failed_this_run) || 0
    if (!Number.isFinite(at)) {
      return {
        id: 'sender', label: '桥接发送器', status: 'fail', critical: true, latencyMs: 0,
        detail: '桥接心跳时间缺失',
        hint: '点击“一键排查修复”重新执行 sender.ps1。',
      }
    }
    if (ageSeconds > Number(cfg.senderDeadSeconds)) {
      return {
        id: 'sender', label: '桥接发送器', status: 'fail', critical: true, latencyMs: 0,
        detail: '心跳已停止 ' + Math.round(ageSeconds / 60) + ' 分钟（计划任务可能被暂停）',
        hint: '点击“一键排查修复”，系统会重新运行 sender.ps1。',
      }
    }
    if (ageSeconds > Number(cfg.senderStaleSeconds) || !alive) {
      return {
        id: 'sender', label: '桥接发送器', status: 'warn', critical: true, latencyMs: 0,
        detail: (alive ? '心跳 ' + ageSeconds + ' 秒前' : '消费者未存活') + ' · 本轮发送 ' + sent + ' 条' + (failed ? ' · 失败 ' + failed + ' 条' : ''),
        hint: ageSeconds > Number(cfg.senderStaleSeconds) ? '发送器心跳偏慢，稍后会自动复查。' : '桥接订阅需要重启。',
      }
    }
    return {
      id: 'sender', label: '桥接发送器', status: 'ok', critical: true, latencyMs: 0,
      detail: '心跳 ' + ageSeconds + ' 秒前 · 本轮发送 ' + sent + ' 条' + (failed ? ' · 失败 ' + failed + ' 条' : ''),
    }
  }

  const checkApi = async (fresh) => {
    const ttl = Number(cfg.probeSeconds) * 1000
    if (!fresh && probeCache.at && Date.now() - probeCache.at < ttl) {
      return {
        id: 'api', label: '开放平台接口', status: probeCache.status, critical: true, latencyMs: probeCache.latencyMs,
        detail: probeCache.detail,
        hint: probeCache.status === 'fail' ? '检查本机网络与代理，点击“立即检测”重试。' : undefined,
      }
    }
    const result = await runLark(['im', '+chat-list', '--as', 'bot', '--types=group', '--page-size=1'], { timeoutMs: 25000 })
    const parsed = parseJsonLoose(result.out)
    if (parsed && parsed.ok === true) {
      probeCache = { at: Date.now(), status: 'ok', detail: '飞书开放平台响应正常（' + result.ms + 'ms）', latencyMs: result.ms }
    } else {
      const reason = clampText(
        (parsed && parsed.error && (parsed.error.message || parsed.error.type)) || result.err || '请求失败',
        120,
      )
      probeCache = { at: Date.now(), status: 'fail', detail: '接口不可达：' + reason, latencyMs: result.ms }
    }
    return {
      id: 'api', label: '开放平台接口', status: probeCache.status, critical: true, latencyMs: probeCache.latencyMs,
      detail: probeCache.detail,
      hint: probeCache.status === 'fail' ? '检查本机网络、VPN/代理后再试。' : undefined,
    }
  }

  const checkInbound = async () => {
    let files = []
    try {
      files = readdirSync(eventsDir).filter((name) => name.endsWith('.json'))
    } catch {
      files = []
    }
    let newest = 0
    for (const name of files) {
      try {
        const info = statSync(join(eventsDir, name))
        if (info.mtimeMs > newest) newest = info.mtimeMs
      } catch {
        /* skip */
      }
    }
    if (newest > 0) {
      const ageHours = (Date.now() - newest) / 3600000
      snapshot.lastInbound = { at: new Date(newest).toISOString(), files: files.length }
      return {
        id: 'inbound', label: '消息入站', status: ageHours > Number(cfg.inboundQuietHours) ? 'warn' : 'ok', critical: false, latencyMs: 0,
        detail: '最近入站 ' + clock(newest) + ' · 事件文件 ' + files.length + ' 个',
        hint: ageHours > Number(cfg.inboundQuietHours) ? '超过 ' + cfg.inboundQuietHours + ' 小时没有收到消息，可发一条消息验证入站。' : undefined,
      }
    }
    snapshot.lastInbound = null
    return {
      id: 'inbound', label: '消息入站', status: 'warn', critical: false, latencyMs: 0,
      detail: '还没有收到过入站消息',
      hint: '在飞书里给机器人发一条消息，观察这里是否刷新。',
    }
  }

  const onlineCheck = () => {
    if (!chatId) {
      return {
        id: 'online', label: '上线通知', status: 'warn', critical: false, latencyMs: 0,
        detail: '未配置 chatId，通知不会发出',
        hint: '在插件配置里填写 chatId（接收通知的飞书会话），看板与自检照常可用。',
      }
    }
    const notice = snapshot.online
    if (notice && notice.bootId === bootId && notice.ok) {
      const what = notice.kind === 'disconnect'
        ? '手动断开通知'
        : notice.kind === 'reconnect'
          ? '手动恢复通知'
          : '本次启动的上线通知'
      return {
        id: 'online', label: '上线通知', status: 'ok', critical: false, latencyMs: notice.ms || 0,
        detail: what + '已发送（' + clock(notice.at) + '）',
      }
    }
    if (notice && notice.bootId === bootId && notice.skipped) {
      return {
        id: 'online', label: '上线通知', status: 'warn', critical: false, latencyMs: 0,
        detail: '本次启动跳过通知：' + (notice.detail || '冷却中'),
      }
    }
    if (notice && notice.bootId === bootId && !notice.ok) {
      return {
        id: 'online', label: '上线通知', status: 'warn', critical: false, latencyMs: notice.ms || 0,
        detail: (notice.kind === 'disconnect' ? '断开通知' : notice.kind === 'reconnect' ? '恢复通知' : '上线通知')
          + '发送失败：' + (notice.error || '未知原因'),
        hint: '检查授权后点击“发送测试消息”验证。',
      }
    }
    return {
      id: 'online', label: '上线通知', status: 'warn', critical: false, latencyMs: 0,
      detail: '本次启动尚未发送上线通知',
    }
  }

  const collectChecks = async (options = {}) => {
    const checks = []
    checks.push(await checkCli())
    checks.push(await checkAuth())
    checks.push(await checkBus())
    checks.push(await checkSender())
    checks.push(await checkApi(Boolean(options.freshProbe)))
    checks.push(await checkInbound())
    checks.push(onlineCheck())
    return checks
  }

  const setCheckResult = (id, patch) => {
    const index = snapshot.checks.findIndex((check) => check.id === id)
    if (index >= 0) snapshot.checks[index] = { ...snapshot.checks[index], ...patch }
  }

  /** Recompute the notice row after a manual notice lands, so it is not stale. */
  const refreshOnlineCheck = () => {
    const fresh = onlineCheck()
    const index = snapshot.checks.findIndex((check) => check.id === 'online')
    if (index >= 0) snapshot.checks[index] = fresh
  }

  const notifyOnline = async (trigger) => {
    if (!chatId) {
      snapshot.online = { bootId, at: nowIso(), ok: false, skipped: true, detail: '未配置 chatId' }
      remember('info', 'notice', '未配置 chatId，跳过上线通知')
      return
    }
    if (cfg.notifyOnStart === false) {
      snapshot.online = { bootId, at: nowIso(), ok: false, skipped: true, detail: '配置已关闭上线通知' }
      return
    }
    const lastOnlineAt = Number(state.lastOnlineAt) || 0
    const cooldownMs = Math.max(0, Number(cfg.onlineCooldownMinutes) || 0) * 60000
    if (trigger === 'boot' && Number(state.lastNotifyPid) === process.pid) {
      const priorOk = Number(state.lastNotifyOkAt) > 0
      snapshot.online = {
        bootId,
        at: nowIso(),
        ok: priorOk,
        skipped: true,
        detail: '本次运行已发送过上线通知',
        messageId: state.lastNotify ? state.lastNotify.messageId || null : null,
      }
      remember('info', 'notice', '跳过重复的上线通知（本次运行已发送过）')
      setCheckResult('online', priorOk
        ? { status: 'ok', detail: '本次启动已通知飞书（此前已发送）' }
        : { status: 'warn', detail: '本次运行已发送过上线通知' })
      return
    }
    if (trigger === 'boot' && cooldownMs > 0 && lastOnlineAt > 0 && Date.now() - lastOnlineAt < cooldownMs) {
      const minutes = Math.ceil((cooldownMs - (Date.now() - lastOnlineAt)) / 60000)
      snapshot.online = { bootId, at: nowIso(), ok: false, skipped: true, detail: '距上次通知不足 ' + cfg.onlineCooldownMinutes + ' 分钟' }
      remember('info', 'notice', '跳过上线通知（冷却中，约 ' + minutes + ' 分钟后可再次通知）')
      setCheckResult('online', { status: 'warn', detail: '本次启动跳过通知：冷却中' })
      return
    }
    const failed = snapshot.checks.filter((check) => check.status === 'fail')
    const line1 = snapshot.overall === 'ok' ? '🟢 DSH 已上线' : '🟠 DSH 已上线（飞书连接异常）'
    const lines = [
      line1,
      '时间：' + clock(new Date()),
      snapshot.overall === 'ok'
        ? '飞书连接：正常 · 事件订阅在线 · 发送通道正常'
        : '飞书连接：异常（' + (failed.map((check) => check.label).join('、') || '检查中') + '）',
      '环境：' + (process.env.DSH_PROFILE || 'desktop') + ' · ' + (process.env.DSH_WEB_URL || 'DSH Web GUI'),
      '在 DSH 界面右下角可查看实时连接状态。',
    ]
    const text = lines.join('\n')
    const result = await sendFeishu(text, 'fobs-online-' + bootId)
    const at = nowIso()
    if (trigger === 'boot') state.lastNotifyPid = process.pid
    snapshot.online = {
      bootId, at, ok: result.ok, error: result.error || null, messageId: result.messageId || null, ms: result.ms,
    }
    if (result.ok) {
      state.lastOnlineAt = Date.now()
      state.lastNotifyOkAt = Date.now()
      snapshot.lastSend = { at, ok: true, detail: '上线通知已送达', messageId: result.messageId || null }
      remember('success', 'send', '上线通知已发送到飞书')
      setCheckResult('online', { status: 'ok', detail: '本次启动已通知飞书（' + clock(at) + '）' })
    } else {
      remember('error', 'send', '上线通知发送失败：' + (result.error || '未知原因'))
      setCheckResult('online', { status: 'warn', detail: '上线通知发送失败：' + clampText(result.error || '未知原因', 80) })
    }
    persist()
  }

  const notifyRecover = async () => {
    if (!chatId) return
    if (cfg.notifyOnRecover === false) return
    const failedBefore = snapshot.diagnosis
      ? snapshot.diagnosis.steps.filter((step) => step.status === 'fail').map((step) => step.label)
      : []
    const fixed = snapshot.diagnosis
      ? snapshot.diagnosis.steps.filter((step) => step.status === 'ok' && /重启|复查|修复/.test(step.label)).map((step) => step.label)
      : []
    const text = [
      '🟢 飞书连接已恢复',
      '时间：' + clock(new Date()),
      '中断原因：' + (failedBefore.length ? failedBefore.join('、') : '短暂异常'),
      '已自动处理：' + (fixed.length ? fixed.join('、') : '重新检测后恢复'),
      '当前状态：正常',
    ].join('\n')
    const result = await sendFeishu(text, 'fobs-recover-' + Date.now().toString(36))
    if (result.ok) {
      snapshot.lastSend = { at: nowIso(), ok: true, detail: '恢复通知已送达', messageId: result.messageId || null }
      remember('success', 'recover', '飞书连接已恢复，已发送恢复通知')
    } else {
      remember('warn', 'recover', '连接已恢复，但恢复通知发送失败：' + (result.error || '未知原因'))
    }
    persist()
  }

  const notifyBreak = async () => {
    if (!chatId) return
    if (cfg.notifyOnBreak === false) return
    const failed = snapshot.checks.filter((check) => check.status === 'fail')
    const text = [
      '🔴 DSH 的飞书连接中断',
      '时间：' + clock(new Date()),
      '异常项：' + (failed.map((check) => check.label).join('、') || '连接检测失败'),
      snapshot.diagnosis && snapshot.diagnosis.resolved === false
        ? '自动修复未成功，请打开 DSH 右下角连接看板查看诊断详情。'
        : '系统正在自动排查修复，结果会显示在 DSH 右下角连接看板。',
    ].join('\n')
    const result = await sendFeishu(text, 'fobs-break-' + Date.now().toString(36))
    if (result.ok) {
      snapshot.lastSend = { at: nowIso(), ok: true, detail: '中断告警已送达', messageId: result.messageId || null }
      remember('warn', 'break', '已发送连接中断告警')
    } else {
      remember('error', 'break', '连接中断，且告警消息发送失败：' + (result.error || '未知原因'))
    }
  }

  /**
   * Manual unplug / replug notices. They go out on the send channel, which does
   * not depend on the event bus, so the "disconnected" line still lands right
   * after the subscription is torn down.
   */
  const notifyManual = async (kind, previousPause) => {
    if (!chatId) {
      remember('info', 'notice', '未配置 chatId，跳过' + (kind === 'disconnect' ? '断开' : '恢复') + '通知')
      return null
    }
    const enabled = kind === 'disconnect' ? cfg.notifyOnDisconnect !== false : cfg.notifyOnReconnect !== false
    if (!enabled) {
      remember('info', 'notice', kind === 'disconnect' ? '配置已关闭手动断开通知' : '配置已关闭手动恢复通知')
      return null
    }
    const at = new Date()
    const checks = Array.isArray(snapshot.checks) ? snapshot.checks : []
    const failed = checks.filter((check) => check.status === 'fail')
    const lines = []
    if (kind === 'disconnect') {
      lines.push('🔴 飞书连接已手动断开')
      lines.push('时间：' + clock(at))
      lines.push('事件订阅与发送已停止，这段时间发来的消息不会补发。')
      lines.push('恢复：DSH 左侧栏「飞书」→ 恢复飞书连接。')
    } else {
      const healthy = snapshot.overall === 'ok'
      lines.push(healthy ? '🟢 飞书连接已恢复' : '🟠 飞书连接已恢复（仍有异常）')
      lines.push('时间：' + clock(at))
      if (previousPause && previousPause.at) {
        const elapsed = Date.now() - Date.parse(previousPause.at)
        if (Number.isFinite(elapsed) && elapsed > 0) lines.push('断开时长：约 ' + quietDuration(elapsed))
      }
      lines.push(healthy
        ? '连接状态：正常（' + checks.length + ' 项检查通过）'
        : '异常项：' + (failed.map((check) => check.label).join('、') || '待复查'))
      lines.push('在 DSH 里可以继续收发消息了。')
    }
    const result = await sendFeishu(lines.join('\n'), 'fobs-manual-' + kind + '-' + Date.now().toString(36))
    snapshot.online = {
      bootId,
      at: nowIso(),
      ok: result.ok,
      kind,
      error: result.error || null,
      messageId: result.messageId || null,
      ms: result.ms,
    }
    if (result.ok) {
      snapshot.lastSend = {
        at: nowIso(),
        ok: true,
        detail: kind === 'disconnect' ? '断开通知已送达' : '恢复通知已送达',
        messageId: result.messageId || null,
      }
      state.lastOnlineAt = Date.now()
      remember('success', 'send', kind === 'disconnect' ? '已发送手动断开通知' : '已发送手动恢复通知')
    } else {
      remember('warn', 'send', (kind === 'disconnect' ? '手动断开通知' : '手动恢复通知')
        + '发送失败：' + (result.error || '未知原因'))
    }
    return snapshot.online
  }

  const restartBridge = async () => {
    if (!existsSync(senderScript)) {
      return {
        label: '重启桥接服务',
        status: 'fail',
        detail: '找不到 sender.ps1：' + senderScript,
        hint: '确认 bridgeDir 配置正确。',
      }
    }
    const result = await runPowerShell(senderScript, 60000)
    const tail = clampText((result.err || result.out || '').replace(/\r?\n/g, ' '), 100)
    const ok = result.code === 0
    return {
      label: '重启桥接服务',
      status: ok ? 'ok' : 'warn',
      detail: ok
        ? '已运行 sender.ps1（' + result.ms + 'ms），桥接订阅已重新拉起'
        : 'sender.ps1 退出码 ' + result.code + (tail ? '：' + tail : ''),
      ms: result.ms,
    }
  }

  const runScheduledTask = async () => {
    if (!cfg.senderTask) return { label: '启动计划任务', status: 'skip', detail: '未配置计划任务名' }
    const schtasks = (args) => spawnHidden(stateDir, 'schtasks.exe', args, { timeoutMs: 20000 })
    let result = await schtasks(['/Run', '/TN', cfg.senderTask])
    let reenabled = false
    if (result.code !== 0) {
      // /Run refuses a disabled task (267011). A disabled sender task is the
      // usual reason the heartbeat starves, so turn it back on and retry.
      const text = String(result.err || result.out || '')
      if (result.code === 267011 || /disabled|禁用的计划任务|已禁用/i.test(text)) {
        const enable = await schtasks(['/Change', '/TN', cfg.senderTask, '/ENABLE'])
        if (enable.code === 0) {
          reenabled = true
          result = await schtasks(['/Run', '/TN', cfg.senderTask])
        }
      }
    }
    const ok = result.code === 0
    return {
      label: '启动计划任务 ' + cfg.senderTask,
      status: ok ? 'ok' : 'warn',
      detail: ok
        ? (reenabled ? '计划任务已被禁用，已重新启用并触发' : '已触发计划任务')
        : '触发失败：' + clampText(result.err || result.out, 100),
      ms: result.ms,
    }
  }

  const repairAndRecheck = async (trigger, before) => {
    const at = nowIso()
    const steps = []
    const failed = before.filter((check) => check.status === 'fail')
    steps.push({
      label: '定位失败项',
      status: failed.length ? 'fail' : 'ok',
      detail: failed.length ? failed.map((check) => check.label + '（' + check.detail + '）').join('；') : '没有失败项',
    })
    const network = await tcpProbe('open.feishu.cn', 443, 4000)
    steps.push({
      label: '网络探测 open.feishu.cn:443',
      status: network.ok ? 'ok' : 'fail',
      detail: network.ok ? '可连通（' + network.ms + 'ms）' : '不可达（' + (network.error || '未知错误') + '）',
      ms: network.ms,
    })
    const bridgeFailed = failed.some((check) => check.id === 'bus' || check.id === 'sender')
    if (bridgeFailed) {
      steps.push(await restartBridge())
      await new Promise((resolve) => setTimeout(resolve, 4000))
      steps.push(await runScheduledTask())
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    if (failed.some((check) => check.id === 'cli')) {
      steps.push({
        label: '修复 lark-cli',
        status: 'fail',
        detail: 'lark-cli 可执行文件不存在，需要重新安装（路径：' + (larkCli || '未解析') + '）',
      })
    }
    if (failed.some((check) => check.id === 'auth')) {
      steps.push({
        label: '修复飞书授权',
        status: 'fail',
        detail: '授权需要人工完成：在终端执行 lark-cli auth login 后扫码，再回到看板点击“立即检测”。',
      })
    }
    if (failed.some((check) => check.id === 'api') && network.ok) {
      steps.push({
        label: '重试开放平台接口',
        status: 'ok',
        detail: '网络可达，已重新探测接口',
      })
    }
    const fresh = await collectChecks({ freshProbe: true })
    const overall = overallOf(fresh)
    steps.push({
      label: '复查连接',
      status: overall === 'ok' ? 'ok' : overall === 'degraded' ? 'warn' : 'fail',
      detail:
        overall === 'ok'
          ? '复查通过，连接已恢复'
          : overall === 'degraded'
            ? '仍有告警：' + fresh.filter((check) => check.status !== 'ok').map((check) => check.label).join('、')
            : '仍异常：' + fresh.filter((check) => check.status === 'fail').map((check) => check.label).join('、'),
    })
    remember(
      overall === 'ok' ? 'success' : 'warn',
      'repair',
      '自动排查完成（' + trigger + '）：' + (overall === 'ok' ? '连接已恢复' : '仍有异常'),
    )
    return { at, trigger, steps, resolved: overall === 'ok', checks: fresh, overall }
  }

  let inflight = null

  const runExclusive = (task) => {
    if (inflight) return inflight
    inflight = Promise.resolve()
      .then(task)
      .catch((error) => {
        snapshot.checking = false
        remember('error', 'check', '连接检测失败：' + (error && error.message ? error.message : error))
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  const runCycle = (trigger) => {
    if (isPaused()) return Promise.resolve()
    return runExclusive(async () => {
    snapshot.checking = true
    let checks = await collectChecks({ freshProbe: trigger === 'manual' || trigger === 'startup' })
    let overall = overallOf(checks)
    if (overall === 'down' || trigger === 'repair') {
      const diagnosis = await repairAndRecheck(trigger, checks)
      checks = diagnosis.checks
      overall = diagnosis.overall
      snapshot.diagnosis = diagnosis
    }
    const previous = snapshot.overall
    snapshot.checks = checks
    snapshot.overall = overall
    snapshot.checkedAt = nowIso()
    snapshot.checking = false
    if (previous === 'down' && overall === 'ok') {
      await notifyRecover()
    } else if (previous !== 'down' && previous !== 'unknown' && previous !== 'paused' && overall === 'down') {
      await notifyBreak()
    }
    if (overall !== previous) {
      remember(overall === 'ok' ? 'success' : overall === 'down' ? 'error' : 'warn', 'state',
        '连接状态：' + (overall === 'ok' ? '正常' : overall === 'down' ? '中断' : '部分异常'))
    }
    persist()
    })
  }

  const boot = async () => {
    if (isPaused()) {
      remember('info', 'pause', '处于手动断开状态：跳过启动检测与上线通知')
      persist()
      return
    }
    remember('info', 'boot', '飞书连接监控已启动，开始检测')
    await runCycle('startup')
    await notifyOnline('boot')
  }

  // ---- HTTP API for the browser half -----------------------------------
  const READ_HEADER = 'x-dsh-feishu'
  const MAX_BODY = 8192

  const writeJson = (res, status, body) => {
    if (res.headersSent === true) {
      res.destroy?.()
      return
    }
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  const readJsonBody = async (req) => {
    const chunks = []
    let total = 0
    for await (const chunk of req) {
      total += chunk.length
      if (total > MAX_BODY) throw new Error('请求体过大')
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (text === '') return {}
    return JSON.parse(text)
  }

  const currentView = () => ({
    ...snapshot,
    now: Date.now(),
    pollSeconds: Number(cfg.pollSeconds) || 30,
    config: {
      chatId,
      chatLabel,
      notifyOnStart: cfg.notifyOnStart !== false,
      showCapsule: cfg.showCapsule !== false,
    },
  })

  const runAction = async (action) => {
    if (action === 'disconnect') {
      if (inflight) await inflight
      if (isPaused()) return '飞书连接本来就处于断开状态'
      const result = await pauseBridge()
      const at = nowIso()
      pause = { at, detail: '手动断开', schedules: result.schedules || [] }
      snapshot.paused = true
      snapshot.pausedAt = at
      snapshot.pauseDetail = pause.detail
      snapshot.overall = 'paused'
      snapshot.checks = []
      snapshot.checking = false
      snapshot.checkedAt = at
      snapshot.diagnosis = { at, trigger: 'disconnect', steps: result.steps, resolved: true }
      remember(result.quiet ? 'warn' : 'error', 'pause', result.quiet
        ? '已手动断开飞书连接，飞书消息不再进入 DSH'
        : '已尝试手动断开，但事件总线仍在运行')
      await notifyManual('disconnect')
      persist()
      return result.quiet ? '已断开飞书连接，飞书消息不会再进入 DSH' : '已停用发送，但事件总线仍在运行，可再点一次断开'
    }
    if (action === 'connect') {
      if (inflight) await inflight
      if (!isPaused()) {
        await runCycle('manual')
        return '飞书连接本来就在运行（' + clock(snapshot.checkedAt) + '）'
      }
      const previous = pause
      pause = null
      snapshot.paused = false
      snapshot.pausedAt = null
      snapshot.pauseDetail = ''
      snapshot.checking = true
      remember('info', 'pause', '正在恢复飞书连接')
      const steps = await resumeBridge(previous)
      const checks = await collectChecks({ freshProbe: true })
      const overall = overallOf(checks)
      snapshot.checks = checks
      snapshot.overall = overall
      snapshot.checkedAt = nowIso()
      snapshot.checking = false
      snapshot.diagnosis = { at: nowIso(), trigger: 'resume', steps, resolved: overall === 'ok' }
      remember(overall === 'ok' ? 'success' : 'warn', 'pause',
        overall === 'ok' ? '飞书连接已恢复' : '已恢复订阅，但连接仍有异常')
      await notifyManual('reconnect', previous)
      refreshOnlineCheck()
      persist()
      return overall === 'ok' ? '已恢复飞书连接' : '已恢复订阅，但仍有异常，请查看看板详情'
    }
    if (isPaused()) throw new Error('已手动断开连接，请先点“恢复连接”')
    if (action === 'check') {
      if (inflight) await inflight
      await runCycle('manual')
      return '检测完成（' + clock(snapshot.checkedAt) + '）'
    }
    if (action === 'repair') {
      if (inflight) await inflight
      let resolved = false
      await runExclusive(async () => {
        snapshot.checking = true
        try {
          const before = snapshot.checks.length ? snapshot.checks : await collectChecks({ freshProbe: true })
          const diagnosis = await repairAndRecheck('manual', before)
          snapshot.diagnosis = diagnosis
          snapshot.checks = diagnosis.checks
          snapshot.overall = diagnosis.overall
          snapshot.checkedAt = nowIso()
          resolved = diagnosis.resolved
          persist()
        } finally {
          snapshot.checking = false
        }
      })
      return resolved ? '排查完成，连接已恢复' : '排查完成，仍有异常，请查看看板详情'
    }
    if (action === 'test-send') {
      const text = [
        '🧪 DSH 连接看板测试消息',
        '时间：' + clock(new Date()),
        '这条消息说明：机器人 → 你的发送通道正常。',
        '收到这条消息即代表 DSH 可以主动给你发飞书消息。',
      ].join('\n')
      const result = await sendFeishu(text, 'fobs-test-' + Date.now().toString(36))
      const at = nowIso()
      if (result.ok) {
        snapshot.lastSend = { at, ok: true, detail: '测试消息已送达', messageId: result.messageId || null }
        remember('success', 'send', '测试消息已发送到飞书')
        persist()
        return '测试消息已送达，请在飞书查看'
      }
      remember('error', 'send', '测试消息发送失败：' + (result.error || '未知原因'))
      persist()
      throw new Error('测试消息发送失败：' + (result.error || '未知原因'))
    }
    if (action === 'online') {
      await notifyOnline('manual')
      return snapshot.online && snapshot.online.ok ? '上线通知已发送' : '上线通知未发送：' + ((snapshot.online && (snapshot.online.error || snapshot.online.detail)) || '未知原因')
    }
    throw new Error('未知操作：' + action)
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/feishu-observer',
    handler: async (req, res) => {
      try {
        if (req.headers[READ_HEADER] !== '1') {
          writeJson(res, 403, { ok: false, error: { message: 'forbidden' } })
          return
        }
        const url = new URL(req.url || '/', 'http://dsh.internal')
        const path = url.pathname
        if (req.method === 'GET' && (path === '/feishu-observer/status' || path === '/feishu-observer/status/')) {
          writeJson(res, 200, { ok: true, value: currentView() })
          return
        }
        if (req.method === 'POST' && (path === '/feishu-observer/action' || path === '/feishu-observer/action/')) {
          const body = await readJsonBody(req)
          const action = String(body && body.action ? body.action : '')
          let message
          try {
            message = await runAction(action)
          } catch (error) {
            writeJson(res, 200, {
              ok: false,
              error: { message: error && error.message ? error.message : String(error) },
              value: currentView(),
            })
            return
          }
          writeJson(res, 200, { ok: true, value: { ...currentView(), message } })
          return
        }
        writeJson(res, 404, { ok: false, error: { message: 'not found' } })
      } catch (error) {
        try {
          writeJson(res, 500, { ok: false, error: { message: error && error.message ? error.message : String(error) } })
        } catch {
          /* response already gone */
        }
      }
    },
  }), 'dsh-feishu-observer: http routes')

  // ---- startup + polling ------------------------------------------------
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void boot()
    }, 1200)
    return () => clearTimeout(timer)
  }, 'dsh-feishu-observer: startup probe')

  ctx.effect(() => {
    const interval = setInterval(() => {
      void runCycle('poll')
    }, Math.max(10, Number(cfg.pollSeconds) || 30) * 1000)
    return () => clearInterval(interval)
  }, 'dsh-feishu-observer: periodic probe')

  log('info', 'host started; dashboard at /feishu-observer (root ' + root + ')')
}