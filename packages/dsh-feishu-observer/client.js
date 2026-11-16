/**
 * dsh-feishu-observer — Client half.
 *
 * A frame-wide status pill (shell.overlay) that opens a live connection board:
 * per-check status, auto-diagnosis steps, event history and manual actions.
 */
window.__ModuleLoader__.load({
  id: 'dsh-feishu-observer',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useRef = React.useRef

    const TEXT = {
      zh: {
        pillUnknown: '飞书 · 检测中',
        pillOk: '飞书 · 已连接',
        pillDown: '飞书 · 连接中断',
        pillDegraded: '飞书 · 部分异常',
        pillOffline: '飞书 · 看板离线',
        pillStale: '飞书 · 状态未知',
        pillPaused: '飞书 · 已断开',
        pillChecking: '飞书 · 检测中',
        pillRepairing: '飞书 · 自动修复中',
        title: '飞书连接',
        subtitle: 'DSH ↔ 飞书',
        openHint: '点击查看飞书连接详情',
        checks: '连接检查',
        diag: '自检与修复',
        history: '事件记录',
        btnCheck: '立即检测',
        btnRepair: '一键排查修复',
        btnTest: '发送测试消息',
        btnPause: '断开连接',
        btnPauseConfirm: '再点一次确认',
        btnResume: '恢复连接',
        pausing: '正在断开…',
        resuming: '正在恢复…',
        pauseTitle: '已手动断开',
        pauseSince: '自 {time} 起暂停检测、自动修复与消息收发',
        pauseNote: '断开期间的飞书消息不会补发；恢复后桥接会重新订阅。',
        pauseEmptyChecks: '检测已暂停，恢复连接后重新开始',
        operations: '最近一次操作',
        pausedBadge: '已断开',
        btnClose: '关闭看板',
        lastCheck: '上次检测',
        never: '尚未检测',
        auto: '每 {n} 秒检测',
        target: '通知目标',
        checking: '检测中…',
        working: '处理中…',
        retry: '重试',
        offline: '无法从 DSH 宿主读取连接状态',
        offlineHint: '宿主可能正在重启，或连接看板插件未激活。',
        connecting: '正在连接 DSH 宿主…',
        noHistory: '暂无事件记录',
        onlineOn: '本次启动已通知',
        onlineOff: '本次启动未通知',
        noDiag: '连接中断时会自动：探测网络 → 重启桥接订阅 → 复查连接',
        emptyChecks: '正在执行首次检查…',
        close: '关闭',
        autoOpened: '检测到连接中断，已自动展开看板',
        repaired: '修复完成',
        stateOk: '连接正常',
        stateDown: '连接中断',
        stateDegraded: '部分异常',
        stateUnknown: '检测中',
        criticalTitle: '当前异常',
        diagnosisAt: '排查时间',
        resolved: '已恢复',
        unresolved: '未完全恢复',
        staleTitle: '看板暂时读不到宿主数据',
        staleNote: '以下为最后一次成功检测的结果，数据截至 {time}。',
        showMore: '显示更多',
        showLess: '收起',
        colon: '：',
        comma: '、',
        info: '提示',
      },
      en: {
        pillUnknown: 'Feishu · checking',
        pillOk: 'Feishu · connected',
        pillDown: 'Feishu · disconnected',
        pillDegraded: 'Feishu · degraded',
        pillOffline: 'Feishu · board offline',
        pillStale: 'Feishu · status unknown',
        pillPaused: 'Feishu · disconnected by you',
        pillChecking: 'Feishu · checking',
        pillRepairing: 'Feishu · repairing',
        title: 'Feishu connection',
        subtitle: 'DSH ↔ Feishu',
        openHint: 'Open Feishu connection details',
        checks: 'Checks',
        diag: 'Diagnosis & repair',
        history: 'Timeline',
        btnCheck: 'Check now',
        btnRepair: 'Diagnose & repair',
        btnTest: 'Send test message',
        btnPause: 'Disconnect',
        btnPauseConfirm: 'Click again to confirm',
        btnResume: 'Reconnect',
        pausing: 'Disconnecting…',
        resuming: 'Reconnecting…',
        pauseTitle: 'Disconnected by you',
        pauseSince: 'Detection, auto-repair and messaging paused since {time}',
        pauseNote: 'Messages sent while disconnected are not replayed; the bridge resubscribes on reconnect.',
        pauseEmptyChecks: 'Detection is paused until you reconnect',
        operations: 'Last action',
        pausedBadge: 'disconnected',
        btnClose: 'Close board',
        lastCheck: 'Last check',
        never: 'not yet',
        auto: 'check every {n}s',
        target: 'Notify',
        checking: 'Checking…',
        working: 'Working…',
        retry: 'Retry',
        offline: 'Cannot read status from the DSH host',
        offlineHint: 'The host may be restarting, or the plugin is not active.',
        connecting: 'Connecting to the DSH host…',
        noHistory: 'No events yet',
        onlineOn: 'Notified this launch',
        onlineOff: 'Not notified this launch',
        noDiag: 'On a broken link it probes the network, restarts the bridge and rechecks automatically.',
        emptyChecks: 'Running the first check…',
        close: 'Close',
        autoOpened: 'Disconnected — the board opened automatically.',
        repaired: 'Repair finished',
        stateOk: 'Connected',
        stateDown: 'Disconnected',
        stateDegraded: 'Degraded',
        stateUnknown: 'Checking',
        criticalTitle: 'Failing checks',
        diagnosisAt: 'Diagnosed at',
        resolved: 'recovered',
        unresolved: 'not fully recovered',
        staleTitle: 'The host is not answering the board',
        staleNote: 'Showing the last successful check from {time}.',
        showMore: 'Show more',
        showLess: 'Show less',
        colon: ': ',
        comma: ', ',
        info: 'info',
      },
    }

    const CHECK_LABELS = {
      zh: {
        cli: 'lark-cli 工具',
        auth: '飞书授权',
        bus: '事件长连接',
        sender: '桥接发送器',
        api: '开放平台接口',
        inbound: '消息入站',
        online: '上线通知',
      },
      en: {
        cli: 'lark-cli',
        auth: 'Authorization',
        bus: 'Event stream',
        sender: 'Bridge sender',
        api: 'Open platform API',
        inbound: 'Inbound messages',
        online: 'Online notice',
      },
    }

    const STATUS_COLOR = {
      ok: 'var(--dsw-alias-state-success-primary, #2ea566)',
      warn: 'var(--dsw-alias-state-warn-primary, #d89614)',
      fail: 'var(--dsw-alias-state-error-primary, #d54941)',
      skip: 'var(--dsw-alias-state-idle-primary, #8a8f99)',
      idle: 'var(--dsw-alias-state-idle-primary, #8a8f99)',
    }

    const STATUS_GLYPH = { ok: '✓', warn: '!', fail: '✕', skip: '–', idle: '·' }

    const CSS = `
.fobs-root{position:fixed;right:16px;bottom:72px;z-index:30;pointer-events:none;font-family:inherit;}
.fobs-pill{pointer-events:auto;display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 11px;border-radius:16px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);
  font-size:12px;font-weight:500;line-height:1;cursor:pointer;transition:border-color .15s ease,background .15s ease;
  box-shadow:0 4px 16px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);backdrop-filter:blur(8px);}
.fobs-pill:hover{border-color:var(--dsw-alias-border-l2);}
.fobs-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.fobs-pill-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;}
.fobs-pill-dot.fobs-live{animation:fobs-pulse 1.6s ease-in-out infinite;}
.fobs-pill-metric{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-weight:400;}
.fobs-pill-chevron{color:var(--dsw-alias-label-secondary);font-size:9px;line-height:1;margin-left:1px;}
.fobs-panel{pointer-events:auto;position:fixed;right:16px;bottom:116px;width:400px;max-width:calc(100vw - 32px);
  max-height:min(72vh, 680px);display:flex;flex-direction:column;overflow:hidden;border-radius:16px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);
  box-shadow:0 18px 48px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);backdrop-filter:blur(14px);}
.fobs-head{display:flex;align-items:center;gap:10px;padding:14px 16px 12px;}
.fobs-head-main{flex:1;min-width:0;}
.fobs-head-title{font-size:14px;font-weight:600;letter-spacing:.1px;}
.fobs-head-sub{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.fobs-iconbtn{width:30px;height:30px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);
  cursor:pointer;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;}
.fobs-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.fobs-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.fobs-alert{margin:0 16px 10px;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent);
  color:var(--dsw-alias-label-primary);}
.fobs-alert b{color:var(--dsw-alias-state-error-primary);}
.fobs-alert.fobs-warn{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);}
.fobs-alert.fobs-warn b{color:var(--dsw-alias-state-warn-primary);}
.fobs-flash{margin:0 16px 10px;padding:8px 12px;border-radius:8px;font-size:12px;line-height:1.4;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);}
.fobs-flash.fobs-ok{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent);}
.fobs-flash.fobs-error{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent);color:var(--dsw-alias-state-error-primary);}
.fobs-body{overflow-y:auto;padding:0 8px 8px;flex:1 1 auto;}
.fobs-stale .fobs-body{opacity:.6;}
.fobs-section{margin:4px 8px 12px;}
.fobs-section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--dsw-alias-label-secondary);margin:0 2px 6px;}
.fobs-check{display:flex;gap:9px;padding:7px 8px;border-radius:9px;align-items:flex-start;}
.fobs-check:hover{background:var(--dsw-alias-bg-layer-2);}
.fobs-check-mark{width:16px;height:16px;border-radius:50%;flex:0 0 auto;margin-top:1px;display:flex;align-items:center;
  justify-content:center;font-size:10px;font-weight:700;color:var(--dsw-alias-label-primary-inverted, #fff);}
.fobs-check.fobs-muted .fobs-check-mark{opacity:.42;}
.fobs-check-main{flex:1;min-width:0;}
.fobs-check-label{font-size:12.5px;font-weight:500;display:flex;align-items:center;gap:6px;}
.fobs-check-detail{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;line-height:1.45;word-break:break-word;}
.fobs-check-hint{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px;line-height:1.45;}
.fobs-check-hint::before{content:"! ";color:var(--dsw-alias-state-warn-primary);font-weight:700;}
.fobs-latency{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:2px;}
.fobs-actions{display:flex;gap:8px;padding:2px 16px 12px;flex-wrap:wrap;}
.fobs-btn{height:30px;padding:0 12px;border-radius:9px;font-size:12px;font-weight:500;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}
.fobs-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);}
.fobs-btn:disabled{opacity:.55;cursor:progress;}
.fobs-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.fobs-btn.fobs-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted, #fff);}
.fobs-btn.fobs-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 42%, transparent);}
.fobs-btn.fobs-danger:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);}
.fobs-btn.fobs-confirm{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-inverted, #fff);}
.fobs-paused{margin:0 16px 10px;padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5;
  background:var(--dsw-alias-bg-layer-2);border:1px dashed var(--dsw-alias-border-l2);}
.fobs-paused b{color:var(--dsw-alias-label-primary);}
.fobs-paused-note{color:var(--dsw-alias-label-secondary);margin-top:4px;}
.fobs-btn.fobs-link{height:auto;padding:0;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:11px;}
.fobs-diag-sum{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;margin-bottom:6px;}
.fobs-diag-step{display:flex;gap:8px;padding:5px 8px;font-size:11.5px;line-height:1.5;}
.fobs-diag-step .fobs-step-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;margin-top:6px;}
.fobs-diag-step .fobs-step-label{font-weight:500;}
.fobs-diag-step .fobs-step-detail{color:var(--dsw-alias-label-secondary);}
.fobs-history-item{display:flex;gap:8px;padding:4px 8px;font-size:11.5px;line-height:1.5;}
.fobs-history-time{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:0 0 auto;}
.fobs-history-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;margin-top:6px;}
.fobs-history-text{flex:1;min-width:0;word-break:break-word;}
.fobs-empty{padding:10px 8px;font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;}
.fobs-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 16px 11px;
  border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);}
.fobs-foot b{font-weight:500;color:var(--dsw-alias-label-primary);}
.fobs-skeleton{padding:18px 16px;font-size:12px;color:var(--dsw-alias-label-secondary);}
.fobs-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;}
@keyframes fobs-pulse{0%,100%{opacity:1}50%{opacity:.4}}
@media (max-width:520px){.fobs-root{right:8px;bottom:64px}.fobs-panel{right:8px;bottom:108px;width:calc(100vw - 16px);}}
`

    function localeSnapshot(ctx) {
      if (!ctx || !ctx.locale) return null
      try {
        if (typeof ctx.locale.getSnapshot === 'function') return ctx.locale.getSnapshot()
        if (typeof ctx.locale.getLocale === 'function') return ctx.locale.getLocale()
      } catch {
        return null
      }
      return null
    }

    function currentLocale(ctx) {
      const snapshot = localeSnapshot(ctx)
      const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : 'zh'
      return active === 'en' ? 'en' : 'zh'
    }

    function statusColor(status) {
      return STATUS_COLOR[status] || STATUS_COLOR.idle
    }

    function isMutedWarning(check) {
      return Boolean(check) && check.critical === false && check.status === 'warn'
    }

    function displayStatus(check) {
      if (!check) return 'idle'
      if (isMutedWarning(check)) return 'skip'
      return check.status || 'idle'
    }

    function timeText(iso, fallback) {
      if (!iso) return fallback || '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return fallback || '—'
      return date.toLocaleTimeString(undefined, { hour12: false })
    }

    function durationText(ms) {
      const value = Number(ms) || 0
      if (value <= 0) return ''
      return value < 1000 ? Math.round(value) + 'ms' : (value / 1000).toFixed(1) + 's'
    }

    function apiBase() {
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string' ? document.baseURI : ''
      try {
        return new URL('feishu-observer/', base || 'http://dsh.internal/')
      } catch {
        return null
      }
    }

    async function getStatus() {
      const base = apiBase()
      if (!base) throw new Error('看板地址不可用')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 9000)
      try {
        const response = await fetch(new URL('status', base).href, {
          method: 'GET',
          headers: { 'x-dsh-feishu': '1' },
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('看板接口返回 HTTP ' + response.status)
        const body = await response.json()
        if (!body || body.ok !== true) throw new Error((body && body.error && body.error.message) || '看板接口返回异常')
        return body.value
      } finally {
        clearTimeout(timer)
      }
    }

    async function postAction(action) {
      const base = apiBase()
      if (!base) throw new Error('看板地址不可用')
      const response = await fetch(new URL('action', base).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-feishu': '1' },
        credentials: 'same-origin',
        body: JSON.stringify({ action }),
      })
      const body = await response.json().catch(() => null)
      if (!body) throw new Error('看板接口返回了无法解析的内容')
      if (body.ok !== true) {
        const message = (body.error && body.error.message) || '操作失败'
        const error = new Error(message)
        error.snapshot = body.value
        throw error
      }
      return body.value
    }

    function FeishuObserver(props) {
      const ctx = props.ctx
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState(null)
      const [open, setOpen] = useState(false)
      const [busy, setBusy] = useState(null)
      const [flash, setFlash] = useState(null)
      const [historyAll, setHistoryAll] = useState(false)
      const [confirmPause, setConfirmPause] = useState(false)
      const [locale, setLocale] = useState(() => currentLocale(ctx))
      const panelRef = useRef(null)
      const pillRef = useRef(null)
      const downSeenRef = useRef(false)
      const flashTimerRef = useRef(null)
      const t = TEXT[locale] || TEXT.zh
      const labels = CHECK_LABELS[locale] || CHECK_LABELS.zh

      useEffect(() => {
        if (!ctx.locale || typeof ctx.locale.subscribe !== 'function') return undefined
        return ctx.locale.subscribe(() => setLocale(currentLocale(ctx)))
      }, [])

      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const value = await getStatus()
            if (!alive) return
            setSnapshot((previous) => {
              if (previous && previous.checkedAt && value && value.checkedAt && value.checkedAt < previous.checkedAt) return previous
              return value
            })
            setError(null)
            if (value && value.overall === 'down') {
              if (!downSeenRef.current) {
                downSeenRef.current = true
                setOpen(true)
              }
            } else {
              downSeenRef.current = false
            }
          } catch (caught) {
            if (!alive) return
            setError(caught && caught.message ? caught.message : String(caught))
          }
        }
        load()
        const interval = setInterval(load, 8000)
        return () => {
          alive = false
          clearInterval(interval)
        }
      }, [])

      useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') closeBoard()
        }
        const onPointer = (event) => {
          const panel = panelRef.current
          const pill = pillRef.current
          if (panel && panel.contains(event.target)) return
          if (pill && pill.contains(event.target)) return
          setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('mousedown', onPointer)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('mousedown', onPointer)
        }
      }, [open])

      useEffect(() => {
        if (!open) return undefined
        const panel = panelRef.current
        const closeButton = panel && panel.querySelector('[data-fobs-close]')
        if (closeButton && typeof closeButton.focus === 'function') {
          const timer = setTimeout(() => closeButton.focus(), 0)
          return () => clearTimeout(timer)
        }
        return undefined
      }, [open])

      useEffect(() => {
        if (!flash) return undefined
        clearTimeout(flashTimerRef.current)
        flashTimerRef.current = setTimeout(() => setFlash(null), 5000)
        return () => clearTimeout(flashTimerRef.current)
      }, [flash])

      // The confirm step disarms itself so a stray click never disconnects the bridge later.
      useEffect(() => {
        if (!confirmPause) return undefined
        const timer = setTimeout(() => setConfirmPause(false), 5000)
        return () => clearTimeout(timer)
      }, [confirmPause])

      const closeBoard = () => {
        setOpen(false)
        if (pillRef.current && typeof pillRef.current.focus === 'function') pillRef.current.focus()
      }

      const runAction = async (action) => {
        if (busy) return
        setBusy(action)
        setFlash(null)
        try {
          const value = await postAction(action)
          if (value) {
            setSnapshot((previous) => {
              if (previous && previous.checkedAt && value.checkedAt && value.checkedAt < previous.checkedAt) return previous
              return value
            })
          }
          setFlash({ kind: 'ok', text: (value && value.message) || t.repaired })
        } catch (caught) {
          if (caught && caught.snapshot) {
            setSnapshot((previous) => {
              if (previous && previous.checkedAt && caught.snapshot.checkedAt && caught.snapshot.checkedAt < previous.checkedAt) return previous
              return caught.snapshot
            })
          }
          setFlash({ kind: 'error', text: caught && caught.message ? caught.message : String(caught) })
        } finally {
          setBusy(null)
        }
      }

      const overall = snapshot ? snapshot.overall : 'unknown'
      const checking = Boolean(snapshot && snapshot.checking)
      const paused = Boolean(snapshot && snapshot.paused)
      const down = overall === 'down' && !paused
      const meta = error
        ? snapshot
          ? { color: statusColor('warn'), label: t.pillStale }
          : { color: statusColor('warn'), label: t.pillOffline }
        : paused
          ? { color: statusColor('skip'), label: t.pillPaused }
          : checking
            ? { color: down ? statusColor('fail') : statusColor('warn'), label: down ? t.pillRepairing : t.pillChecking }
            : overall === 'ok'
              ? { color: statusColor('ok'), label: t.pillOk }
              : down
                ? { color: statusColor('fail'), label: t.pillDown }
                : overall === 'degraded'
                  ? { color: statusColor('warn'), label: t.pillDegraded }
                  : { color: statusColor('idle'), label: t.pillUnknown }

      const pulse = !paused && (down || checking)
      const latency = snapshot && overall === 'ok' && !error && !paused ? latencyOf(snapshot) : 0
      const failedLabels = snapshot && snapshot.checks
        ? snapshot.checks.filter((check) => check.status === 'fail').map((check) => labels[check.id] || check.label).join(t.comma)
        : ''
      const history = snapshot && Array.isArray(snapshot.history) ? snapshot.history : []
      const historyItems = history.slice(historyAll ? -40 : -10).reverse()
      const liveText = meta.label + (error && snapshot ? '（' + t.staleTitle + '）' : '')

      const actions = paused
        ? [
            h('button', {
              type: 'button', className: 'fobs-btn fobs-primary', disabled: Boolean(busy),
              onClick: () => runAction('connect'),
            }, busy === 'connect' ? t.resuming : t.btnResume),
          ]
        : [
            h('button', {
              type: 'button', className: 'fobs-btn', disabled: Boolean(busy),
              onClick: () => runAction('check'),
            }, busy === 'check' ? t.checking : t.btnCheck),
            h('button', {
              type: 'button', className: 'fobs-btn' + (overall === 'ok' ? '' : ' fobs-primary'), disabled: Boolean(busy),
              onClick: () => runAction('repair'),
            }, busy === 'repair' ? t.working : t.btnRepair),
            h('button', {
              type: 'button', className: 'fobs-btn', disabled: Boolean(busy),
              onClick: () => runAction('test-send'),
            }, busy === 'test-send' ? t.working : t.btnTest),
            h('button', {
              type: 'button',
              className: 'fobs-btn' + (confirmPause ? ' fobs-confirm' : ' fobs-danger'),
              disabled: Boolean(busy),
              onClick: () => {
                if (!confirmPause) {
                  setConfirmPause(true)
                  return
                }
                setConfirmPause(false)
                void runAction('disconnect')
              },
            }, busy === 'disconnect' ? t.pausing : confirmPause ? t.btnPauseConfirm : t.btnPause),
          ]

      const pill = h('button', {
        ref: pillRef,
        type: 'button',
        className: 'fobs-pill',
        onClick: () => (open ? closeBoard() : setOpen(true)),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-label': t.title + t.colon + meta.label,
        title: error || t.openHint,
      },
        h('span', {
          className: 'fobs-pill-dot' + (pulse ? ' fobs-live' : ''),
          style: { background: meta.color },
        }),
        h('span', null, meta.label),
        latency ? h('span', { className: 'fobs-pill-metric' }, durationText(latency)) : null,
        h('span', { className: 'fobs-pill-chevron', 'aria-hidden': true }, open ? '▴' : '▾'),
      )

      const panel = open ? h('div', {
        ref: panelRef,
        className: 'fobs-panel' + (error && snapshot ? ' fobs-stale' : ''),
        role: 'dialog',
        'aria-labelledby': 'fobs-panel-title',
      },
        h('div', { className: 'fobs-head' },
          h('span', {
            className: 'fobs-pill-dot' + (pulse ? ' fobs-live' : ''),
            style: { background: meta.color, width: 10, height: 10 },
          }),
          h('div', { className: 'fobs-head-main' },
            h('div', { className: 'fobs-head-title', id: 'fobs-panel-title' }, t.title),
            h('div', { className: 'fobs-head-sub' },
              h('span', null, t.subtitle),
              h('span', null, '·'),
              h('span', null, snapshot
                ? t.lastCheck + ' ' + timeText(snapshot.checkedAt, t.never)
                : t.checking),
              snapshot ? h('span', null, '·') : null,
              snapshot ? h('span', null, t.auto.replace('{n}', String(snapshot.pollSeconds || 30))) : null,
            ),
          ),
          h('button', {
            type: 'button',
            className: 'fobs-iconbtn',
            'data-fobs-close': '1',
            'aria-label': t.btnClose,
            title: t.close,
            onClick: closeBoard,
          }, '✕'),
        ),

        error ? h('div', { className: 'fobs-alert' + (snapshot ? ' fobs-warn' : '') },
          h('b', null, snapshot ? t.staleTitle : t.offline),
          h('div', { style: { marginTop: 4 } }, error),
          snapshot
            ? h('div', { style: { marginTop: 4, color: 'var(--dsw-alias-label-secondary)' } },
                t.staleNote.replace('{time}', timeText(snapshot.checkedAt, t.never)))
            : h('div', { style: { marginTop: 4, color: 'var(--dsw-alias-label-secondary)' } }, t.offlineHint),
        ) : null,

        flash ? h('div', { className: 'fobs-flash ' + (flash.kind === 'error' ? 'fobs-error' : 'fobs-ok') }, flash.text) : null,

        !snapshot && !error ? h('div', { className: 'fobs-skeleton' }, t.connecting) : null,

        snapshot ? h('div', { className: 'fobs-body' },
          paused ? h('div', { className: 'fobs-paused' },
            h('b', null, t.pauseTitle),
            h('div', null, t.pauseSince.replace('{time}', timeText(snapshot.pausedAt, t.never))),
            h('div', { className: 'fobs-paused-note' }, t.pauseNote),
          ) : null,

          down ? h('div', { className: 'fobs-alert' },
            h('b', null, t.criticalTitle + t.colon),
            failedLabels,
          ) : null,

          paused ? h('div', { className: 'fobs-section' },
            h('div', { className: 'fobs-section-title' }, t.checks),
            h('div', { className: 'fobs-empty' }, t.pauseEmptyChecks),
          ) : h('div', { className: 'fobs-section' },
            h('div', { className: 'fobs-section-title' }, t.checks),
            !Array.isArray(snapshot.checks) || snapshot.checks.length === 0
              ? h('div', { className: 'fobs-empty' }, t.emptyChecks)
              : snapshot.checks.map((check) => {
                  const state = displayStatus(check)
                  return h('div', {
                    className: 'fobs-check' + (isMutedWarning(check) ? ' fobs-muted' : ''),
                    key: check.id,
                  },
                    h('span', {
                      className: 'fobs-check-mark',
                      style: { background: statusColor(state) },
                      'aria-hidden': true,
                    }, STATUS_GLYPH[state] || '·'),
                    h('div', { className: 'fobs-check-main' },
                      h('div', { className: 'fobs-check-label' }, labels[check.id] || check.label),
                      h('div', { className: 'fobs-check-detail' }, check.detail),
                      check.hint ? h('div', { className: 'fobs-check-hint' }, check.hint) : null,
                    ),
                    check.latencyMs ? h('span', { className: 'fobs-latency' }, durationText(check.latencyMs)) : null,
                  )
                }),
          ),

          h('div', { className: 'fobs-actions' }, ...actions),

          snapshot.diagnosis ? h('div', { className: 'fobs-section' },
            h('div', { className: 'fobs-section-title' },
              paused || (snapshot.diagnosis.trigger === 'disconnect' || snapshot.diagnosis.trigger === 'resume')
                ? t.operations
                : t.diag),
            h('div', { className: 'fobs-diag-sum' },
              h('span', {
                style: { color: paused || snapshot.diagnosis.resolved ? statusColor('ok') : statusColor('warn') },
              }, paused
                ? '✓ ' + t.pausedBadge
                : snapshot.diagnosis.resolved ? '✓ ' + t.resolved : '! ' + t.unresolved),
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontWeight: 400, fontSize: 11 } },
                t.diagnosisAt + ' ' + timeText(snapshot.diagnosis.at)),
            ),
            (Array.isArray(snapshot.diagnosis.steps) ? snapshot.diagnosis.steps : []).map((step, index) => h('div', { className: 'fobs-diag-step', key: index },
              h('span', { className: 'fobs-step-dot', style: { background: statusColor(step.status) } }),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('span', { className: 'fobs-step-label' }, step.label + '　'),
                h('span', { className: 'fobs-step-detail' }, step.detail),
              ),
            )),
          ) : h('div', { className: 'fobs-section' },
            h('div', { className: 'fobs-section-title' }, t.diag),
            h('div', { className: 'fobs-empty' }, t.noDiag),
          ),

          h('div', { className: 'fobs-section' },
            h('div', { className: 'fobs-section-title' }, t.history),
            historyItems.length === 0
              ? h('div', { className: 'fobs-empty' }, t.noHistory)
              : historyItems.map((entry, index) => h('div', { className: 'fobs-history-item', key: (entry && entry.at ? entry.at : '') + '-' + index },
                h('span', { className: 'fobs-history-dot', style: { background: statusColor(entry.level === 'success' ? 'ok' : entry.level === 'error' ? 'fail' : entry.level === 'warn' ? 'warn' : 'idle') } }),
                h('span', { className: 'fobs-history-time' }, timeText(entry.at)),
                h('span', { className: 'fobs-history-text' }, String(entry.text || '')),
              )),
            history.length > 10
              ? h('button', {
                  type: 'button', className: 'fobs-btn fobs-link', style: { margin: '4px 8px 0' },
                  onClick: () => setHistoryAll((value) => !value),
                }, historyAll ? t.showLess : t.showMore)
              : null,
          ),
        ) : null,

        h('div', { className: 'fobs-foot' },
          h('span', null, t.target + t.colon, h('b', null, (snapshot && snapshot.config && snapshot.config.chatLabel) || '—')),
          h('span', null,
            snapshot && snapshot.online && snapshot.online.ok
              ? '✓ ' + t.onlineOn
              : t.onlineOff,
          ),
        ),
      ) : null

      // With the sidebar board installed this pill is optional: `showCapsule: false`
      // renders nothing at all, and nothing flashes before the first status reply.
      const hidden = !snapshot || (snapshot.config && snapshot.config.showCapsule === false)
      if (hidden) return null

      return h('div', { className: 'fobs-root' },
        h('style', null, CSS),
        h('div', { className: 'fobs-sr', role: 'status', 'aria-live': 'polite' }, liveText),
        pill,
        panel,
      )
    }

    function latencyOf(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.checks)) return 0
      const api = snapshot.checks.find((check) => check.id === 'api')
      return api && api.latencyMs ? api.latencyMs : 0
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'feishu-observer',
          order: 30,
        }, (props) => h(FeishuObserver, { ...props, ctx })))
      },
    }
  },
})