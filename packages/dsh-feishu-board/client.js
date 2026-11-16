/**
 * dsh-feishu-board — Client half.
 *
 * One left-sidebar entry (`sidebar.panellist`) plus the page it opens (`main`).
 * Both read the same live state and drive the same actions through
 * dsh-feishu-observer's `/feishu-observer/*` routes, so the capsule and this page
 * never disagree and there is exactly one owner of the bridge.
 */
window.__ModuleLoader__.load({
  id: 'dsh-feishu-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useRef = React.useRef

    const TEXT = {
      zh: {
        title: '飞书连接',
        subtitle: 'DSH ↔ 飞书 · 桥接检查、断联开关与事件记录',
        pillOk: '已连接',
        pillDegraded: '部分异常',
        pillDown: '连接中断',
        pillChecking: '检测中',
        pillPaused: '已手动断开',
        pillUnknown: '状态未知',
        setupTitle: '还没配置接收通知的会话',
        setupNote: '在插件配置里填写 chatId，上线 / 断开 / 恢复通知才会发出；连接检测与断开、恢复操作现在就能用。',
        lastCheck: '上次检测',
        never: '尚未检测',
        auto: '每 {n} 秒复查',
        target: '通知目标',
        checks: '连接检查',
        actions: '常用操作',
        diag: '自检与修复',
        operations: '最近一次操作',
        history: '事件记录',
        btnCheck: '立即检测',
        btnRepair: '一键排查修复',
        btnTest: '发送测试消息',
        btnPause: '断开飞书连接',
        btnPauseConfirm: '再点一次确认断开',
        btnResume: '恢复飞书连接',
        checking: '检测中…',
        working: '处理中…',
        disconnecting: '正在断开…',
        resuming: '正在恢复…',
        done: '操作完成',
        pauseTitle: '已手动断开',
        pauseSince: '自 {time} 起暂停检测、自动修复与消息收发',
        pauseNote: '断开期间的飞书消息不会补发；恢复后桥接会重新订阅。',
        pauseEmptyChecks: '检测已暂停，恢复连接后重新开始',
        pausedBadge: '已断开',
        resolved: '已恢复',
        unresolved: '未完全恢复',
        noDiag: '连接中断时会自动：探测网络 → 重启桥接订阅 → 复查连接',
        diagnosisAt: '排查时间',
        noHistory: '暂无事件记录',
        showMore: '显示更多',
        showLess: '收起',
        colon: '：',
        comma: '、',
        connecting: '正在读取连接状态…',
        missingTitle: '找不到连接看板服务',
        missingNote: '这个页面通过 dsh-feishu-observer 插件的 /feishu-observer 接口读取状态。请确认该插件已安装并启用，然后刷新页面。',
        staleTitle: '暂时读不到最新状态',
        staleNote: '下面显示的是最后一次成功检测的结果，数据截至 {time}。',
        retry: '重试',
        criticalTitle: '当前异常',
        sidebarLabel: '飞书',
        openHint: '打开飞书连接面板',
        pausedHint: '飞书已手动断开',
      },
      en: {
        title: 'Feishu connection',
        subtitle: 'DSH ↔ Feishu · checks, the disconnect switch and the timeline',
        pillOk: 'Connected',
        pillDegraded: 'Degraded',
        pillDown: 'Disconnected',
        pillChecking: 'Checking',
        pillPaused: 'Disconnected by you',
        pillUnknown: 'Unknown',
        setupTitle: 'No notification chat configured',
        setupNote: 'Set chatId in the plugin config to receive online, disconnect and reconnect notices; checks and actions already work.',
        lastCheck: 'Last check',
        never: 'not yet',
        auto: 'rechecked every {n}s',
        target: 'Notify',
        checks: 'Checks',
        actions: 'Actions',
        diag: 'Diagnosis & repair',
        operations: 'Last action',
        history: 'Timeline',
        btnCheck: 'Check now',
        btnRepair: 'Diagnose & repair',
        btnTest: 'Send test message',
        btnPause: 'Disconnect Feishu',
        btnPauseConfirm: 'Click again to confirm',
        btnResume: 'Reconnect Feishu',
        checking: 'Checking…',
        working: 'Working…',
        disconnecting: 'Disconnecting…',
        resuming: 'Reconnecting…',
        done: 'Done',
        pauseTitle: 'Disconnected by you',
        pauseSince: 'Detection, auto-repair and messaging paused since {time}',
        pauseNote: 'Messages sent while disconnected are not replayed; the bridge resubscribes on reconnect.',
        pauseEmptyChecks: 'Detection is paused until you reconnect',
        pausedBadge: 'disconnected',
        resolved: 'recovered',
        unresolved: 'not fully recovered',
        noDiag: 'On a broken link it probes the network, restarts the bridge and rechecks automatically.',
        diagnosisAt: 'Diagnosed at',
        noHistory: 'No events yet',
        showMore: 'Show more',
        showLess: 'Show less',
        colon: ': ',
        comma: ', ',
        connecting: 'Reading the link status…',
        missingTitle: 'The connection service is not answering',
        missingNote: 'This page reads its state from the dsh-feishu-observer plugin (/feishu-observer). Make sure that plugin is installed and enabled, then reload the page.',
        staleTitle: 'The host is not answering',
        staleNote: 'Showing the last successful check from {time}.',
        retry: 'Retry',
        criticalTitle: 'Failing checks',
        sidebarLabel: 'Feishu',
        openHint: 'Open the Feishu connection panel',
        pausedHint: 'Feishu is disconnected by you',
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
      unknown: 'var(--dsw-alias-state-idle-primary, #8a8f99)',
    }

    const STATUS_GLYPH = { ok: '✓', warn: '!', fail: '✕', skip: '–', idle: '·' }

    const CSS = `
.fb-root{flex:1;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;font-family:inherit;container-type:inline-size;}
.fb-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;
  padding:18px 24px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);}
[data-platform='darwin'] .fb-head{padding-top:calc(18px + var(--dsh-frame-top-clearance,0px));}
.fb-head-main{min-width:0;}
.fb-title-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:26px;}
.fb-mark{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#3370ff,#7b5cff);
  display:grid;place-items:center;color:#fff;flex:0 0 auto;}
.fb-title{margin:0;font-size:17px;font-weight:600;letter-spacing:.01em;white-space:nowrap;}
.fb-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 9px 2px 8px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  font-size:11px;color:var(--dsw-alias-label-secondary);}
.fb-chip-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}
.fb-sub{margin:6px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);}
.fb-sub b{font-weight:500;color:var(--dsw-alias-label-primary);}
.fb-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  padding:16px 24px 28px;display:flex;flex-direction:column;gap:14px;}
/* Flex items shrink by default: without this the cards would be squeezed into the
   viewport instead of overflowing, and the page would have nothing to scroll. */
.fb-scroll > *{flex:0 0 auto;}
.fb-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:14px;align-items:start;}
/* The main column width depends on the sidebar, so query the page's own width. */
@container (max-width:760px){.fb-grid{grid-template-columns:1fr;}}
.fb-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;}
.fb-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.fb-card-title{font-size:12px;font-weight:600;letter-spacing:.02em;}
.fb-card-note{font-size:11px;color:var(--dsw-alias-label-secondary);}
.fb-card-body{padding:6px 8px 10px;}
.fb-row{display:flex;gap:10px;padding:8px;border-radius:9px;align-items:flex-start;}
.fb-row:hover{background:var(--dsw-alias-bg-layer-2);}
.fb-row-mark{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:10px;
  font-weight:700;color:var(--dsw-alias-label-primary-inverted,#fff);flex:0 0 auto;margin-top:1px;}
.fb-row-main{flex:1;min-width:0;}
.fb-row-label{font-size:12.5px;font-weight:500;}
.fb-row-detail{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;word-break:break-word;}
.fb-row-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px;line-height:1.45;}
.fb-row-hint::before{content:"! ";color:var(--dsw-alias-state-warn-primary);font-weight:700;}
.fb-latency{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;
  margin-top:3px;white-space:nowrap;}
.fb-actions{padding:12px 14px 14px;display:flex;flex-direction:column;gap:8px;}
.fb-actions-note{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;}
.fb-btn{height:32px;padding:0 14px;border-radius:9px;font-size:12.5px;font-weight:500;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);white-space:nowrap;}
.fb-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);}
.fb-btn:disabled{opacity:.55;cursor:progress;}
.fb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.fb-btn.fb-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);
  color:var(--dsw-alias-label-primary-inverted,#fff);}
.fb-btn.fb-danger{color:var(--dsw-alias-state-error-primary);
  border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 42%,transparent);}
.fb-btn.fb-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);}
.fb-btn.fb-confirm{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);
  color:var(--dsw-alias-label-primary-inverted,#fff);}
.fb-btn.fb-link{height:auto;padding:2px 0;border:0;background:transparent;
  color:var(--dsw-alias-brand-primary);font-size:11.5px;align-self:flex-start;}
.fb-paused{padding:12px 14px;border-radius:12px;border:1px dashed var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-1);}
.fb-paused-title{font-size:12.5px;font-weight:600;}
.fb-paused-line{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px;}
.fb-step{display:flex;gap:9px;padding:6px 14px;font-size:11.5px;line-height:1.5;}
.fb-step-dot{width:6px;height:6px;border-radius:50%;margin-top:7px;flex:0 0 auto;}
.fb-step-label{font-weight:500;}
.fb-step-detail{color:var(--dsw-alias-label-secondary);}
.fb-history{display:flex;gap:9px;padding:5px 14px;font-size:11.5px;line-height:1.5;}
.fb-history-time{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:0 0 auto;}
.fb-history-dot{width:6px;height:6px;border-radius:50%;margin-top:6px;flex:0 0 auto;}
.fb-history-text{flex:1;min-width:0;word-break:break-word;}
.fb-empty{padding:14px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;}
.fb-flash{padding:9px 12px;border-radius:10px;font-size:12px;border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);}
.fb-flash.fb-ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);}
.fb-flash.fb-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);
  color:var(--dsw-alias-state-error-primary);}
.fb-alert{padding:10px 12px;border-radius:10px;font-size:12px;
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);
  border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);}
.fb-alert b{color:var(--dsw-alias-state-error-primary);}
.fb-alert.fb-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);}
.fb-alert .fb-alert-sub{margin-top:4px;color:var(--dsw-alias-label-secondary);}
.fb-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;}
.fb-icon-dot{position:absolute;right:-1px;bottom:-1px;width:6px;height:6px;border-radius:50%;box-sizing:border-box;}
.fb-chipbtn{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;font-weight:500;line-height:1;cursor:pointer;}
.fb-chipbtn:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);}
.fb-chipbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.fb-chipbtn-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;box-sizing:border-box;}
.fb-chipbtn-label{white-space:nowrap;}
/* A hollow ring means "not connected on purpose / unknown" without relying on colour. */
.fb-dot-hollow{background:transparent;border:1.5px solid var(--dsw-alias-state-idle-primary,#8a8f99);}
.fb-dot-pulse{animation:fb-pulse 1.5s ease-in-out infinite;}
@keyframes fb-pulse{0%,100%{opacity:1}50%{opacity:.3}}
@media (max-width:960px){
  .fb-grid{grid-template-columns:1fr;}
  .fb-head{padding:14px 16px 12px;}
  .fb-scroll{padding:14px 16px 20px;}
}
`

    // ---- helpers -----------------------------------------------------------
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

    function httpError(message, code) {
      const error = new Error(message)
      error.code = code || 0
      return error
    }

    async function requestStatus() {
      const base = apiBase()
      if (!base) throw httpError('看板地址不可用', 0)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 9000)
      try {
        const response = await fetch(new URL('status', base).href, {
          method: 'GET',
          headers: { 'x-dsh-feishu': '1' },
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (response.status === 403 || response.status === 404) throw httpError('连接看板服务不可用', response.status)
        if (!response.ok) throw httpError('连接看板接口返回 HTTP ' + response.status, response.status)
        const body = await response.json()
        if (!body || body.ok !== true) {
          throw httpError((body && body.error && body.error.message) || '连接看板接口返回异常', 0)
        }
        return body.value
      } finally {
        clearTimeout(timer)
      }
    }

    async function postAction(action) {
      const base = apiBase()
      if (!base) throw httpError('看板地址不可用', 0)
      const response = await fetch(new URL('action', base).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-feishu': '1' },
        credentials: 'same-origin',
        body: JSON.stringify({ action }),
      })
      if (response.status === 403 || response.status === 404) throw httpError('连接看板服务不可用', response.status)
      const body = await response.json().catch(() => null)
      if (!body) throw httpError('连接看板接口返回了无法解析的内容', 0)
      if (body.ok !== true) {
        const error = httpError((body.error && body.error.message) || '操作失败', 0)
        error.snapshot = body.value
        throw error
      }
      return body.value
    }

    /** Keep the newest checkedAt: a slow response must not rewind the board. */
    function newest(previous, next) {
      if (!next) return previous
      if (previous && previous.checkedAt && next.checkedAt && next.checkedAt < previous.checkedAt) return previous
      return next
    }

    // ---- ambient status feed -----------------------------------------------
    /**
     * One poller behind every always-on indicator (sidebar dot, header chip).
     * The board page keeps its own faster loop because it also drives actions.
     */
    const statusFeed = {
      value: null,
      timer: null,
      inflight: false,
      listeners: new Set(),
    }

    async function refreshStatus() {
      if (statusFeed.inflight) return
      statusFeed.inflight = true
      try {
        statusFeed.value = await requestStatus()
      } catch {
        /* keep the last known state so a flaky read does not blink the indicator */
      } finally {
        statusFeed.inflight = false
        for (const listener of statusFeed.listeners) {
          try {
            listener()
          } catch {
            /* a broken indicator must not stop the feed */
          }
        }
      }
    }

    function subscribeStatus(listener) {
      statusFeed.listeners.add(listener)
      if (!statusFeed.timer) {
        void refreshStatus()
        statusFeed.timer = setInterval(refreshStatus, 20000)
      }
      return () => {
        statusFeed.listeners.delete(listener)
        if (statusFeed.listeners.size === 0 && statusFeed.timer) {
          clearInterval(statusFeed.timer)
          statusFeed.timer = null
        }
      }
    }

    /** The single place that turns a snapshot into a tone, a label and a shape. */
    function statusMeta(snapshot, t) {
      if (!snapshot) return { tone: STATUS_COLOR.skip, label: t.pillUnknown, hollow: true, pulse: false }
      if (snapshot.paused) return { tone: STATUS_COLOR.skip, label: t.pillPaused, hollow: true, pulse: false }
      const overall = snapshot.overall || 'unknown'
      if (overall === 'ok') return { tone: STATUS_COLOR.ok, label: t.pillOk, hollow: false, pulse: false }
      if (overall === 'degraded') return { tone: STATUS_COLOR.warn, label: t.pillDegraded, hollow: false, pulse: false }
      if (overall === 'down') return { tone: STATUS_COLOR.fail, label: t.pillDown, hollow: false, pulse: true }
      return { tone: STATUS_COLOR.skip, label: t.pillUnknown, hollow: true, pulse: false }
    }

    function dotClassName(base, meta) {
      return base
        + (meta.hollow ? ' fb-dot-hollow' : '')
        + (meta.pulse ? ' fb-dot-pulse' : '')
    }

    function dotStyle(meta) {
      return meta.hollow ? { borderColor: meta.tone } : { background: meta.tone }
    }

    function FeishuMark(props) {
      const edge = Number(props && props.size) || 18
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        style: { display: 'block' },
      },
        h('path', {
          d: 'M4 8.2A4.2 4.2 0 0 1 8.2 4h7.6A4.2 4.2 0 0 1 20 8.2v5.4a4.2 4.2 0 0 1-4.2 4.2h-5.3l-4.7 3.1c-.5.3-1.2-.1-1.2-.7v-2.9A4.2 4.2 0 0 1 4 13.6V8.2Z',
          fill: 'currentColor',
        }),
      )
    }

    // ---- sidebar entry -----------------------------------------------------
    function BoardIcon(props) {
      const edge = Number(props && props.size) || 18
      const active = Boolean(props && props.active)
      const ctx = props && props.ctx
      const [snapshot, setSnapshot] = useState(statusFeed.value)
      const t = TEXT[currentLocale(ctx)] || TEXT.zh

      useEffect(() => subscribeStatus(() => setSnapshot(statusFeed.value)), [])

      const meta = statusMeta(snapshot, t)

      return h('span', {
        className: 'fb-icon',
        style: { width: edge, height: edge, color: 'currentColor', opacity: active ? 1 : 0.92 },
        title: t.title + t.colon + meta.label,
        'aria-hidden': 'true',
      },
        h(FeishuMark, { size: edge }),
        h('span', { className: dotClassName('fb-icon-dot', meta), style: dotStyle(meta) }),
      )
    }

    // ---- header indicator --------------------------------------------------
    /**
     * Always-on status next to the Session utilities, so the link is readable
     * while working in any conversation; clicking it opens the board.
     */
    function StatusChip(props) {
      const ctx = props && props.ctx
      const [snapshot, setSnapshot] = useState(statusFeed.value)
      const t = TEXT[currentLocale(ctx)] || TEXT.zh

      useEffect(() => subscribeStatus(() => setSnapshot(statusFeed.value)), [])

      const meta = statusMeta(snapshot, t)

      const open = () => {
        try {
          const layout = ctx && typeof ctx.get === 'function' ? ctx.get('layout') : undefined
          if (layout && typeof layout.selectPanel === 'function') layout.selectPanel('feishu-board')
        } catch {
          /* navigation is a convenience, not a requirement */
        }
      }

      return h('button', {
        type: 'button',
        className: 'fb-chipbtn',
        title: t.title + t.colon + meta.label + ' · ' + t.openHint,
        'aria-label': t.title + t.colon + meta.label,
        onClick: open,
      },
        h('span', { className: dotClassName('fb-chipbtn-dot', meta), style: dotStyle(meta) }),
        h('span', { className: 'fb-chipbtn-label' }, t.sidebarLabel),
      )
    }

    // ---- page --------------------------------------------------------------
    function BoardPage(props) {
      const ctx = props.ctx
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState(null)
      const [missing, setMissing] = useState(false)
      const [busy, setBusy] = useState(null)
      const [flash, setFlash] = useState(null)
      const [confirmPause, setConfirmPause] = useState(false)
      const [allHistory, setAllHistory] = useState(false)
      const [locale, setLocale] = useState(() => currentLocale(ctx))
      const missingRef = useRef(false)
      const flashTimer = useRef(null)
      const t = TEXT[locale] || TEXT.zh
      const labels = CHECK_LABELS[locale] || CHECK_LABELS.zh

      useEffect(() => {
        if (!ctx.locale || typeof ctx.locale.subscribe !== 'function') return undefined
        return ctx.locale.subscribe(() => setLocale(currentLocale(ctx)))
      }, [])

      useEffect(() => {
        let alive = true
        const load = async () => {
          if (missingRef.current) return
          try {
            const value = await requestStatus()
            if (!alive) return
            setSnapshot((previous) => newest(previous, value))
            setError(null)
          } catch (caught) {
            if (!alive) return
            const code = caught && caught.code
            if (code === 403 || code === 404) {
              missingRef.current = true
              setMissing(true)
              setSnapshot(null)
              return
            }
            setError(caught && caught.message ? caught.message : String(caught))
          }
        }
        void load()
        const interval = setInterval(load, 6000)
        return () => {
          alive = false
          clearInterval(interval)
        }
      }, [])

      useEffect(() => {
        if (!flash) return undefined
        clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => setFlash(null), 5000)
        return () => clearTimeout(flashTimer.current)
      }, [flash])

      useEffect(() => {
        if (!confirmPause) return undefined
        const timer = setTimeout(() => setConfirmPause(false), 5000)
        return () => clearTimeout(timer)
      }, [confirmPause])

      const runAction = async (action) => {
        if (busy) return
        setBusy(action)
        setFlash(null)
        try {
          const value = await postAction(action)
          if (value) setSnapshot((previous) => newest(previous, value))
          setFlash({ kind: 'ok', text: (value && value.message) || t.done })
        } catch (caught) {
          if (caught && caught.snapshot) setSnapshot((previous) => newest(previous, caught.snapshot))
          if (caught && (caught.code === 403 || caught.code === 404)) {
            missingRef.current = true
            setMissing(true)
          }
          setFlash({ kind: 'error', text: caught && caught.message ? caught.message : String(caught) })
        } finally {
          setBusy(null)
        }
      }

      const paused = Boolean(snapshot && snapshot.paused)
      // Notices need a target chat; everything else works without one.
      const notConfigured = Boolean(snapshot && snapshot.config && !snapshot.config.chatId)
      const checking = Boolean(snapshot && snapshot.checking)
      const overall = snapshot ? snapshot.overall : 'unknown'
      const down = overall === 'down' && !paused
      const meta = paused
        ? { label: t.pillPaused, color: STATUS_COLOR.skip }
        : checking
          ? { label: t.pillChecking, color: STATUS_COLOR.warn }
          : overall === 'ok'
            ? { label: t.pillOk, color: STATUS_COLOR.ok }
            : overall === 'degraded'
              ? { label: t.pillDegraded, color: STATUS_COLOR.warn }
              : down
                ? { label: t.pillDown, color: STATUS_COLOR.fail }
                : { label: t.pillUnknown, color: STATUS_COLOR.idle }

      const failedLabels = snapshot && Array.isArray(snapshot.checks)
        ? snapshot.checks.filter((check) => check.status === 'fail').map((check) => labels[check.id] || check.label).join(t.comma)
        : ''
      const history = snapshot && Array.isArray(snapshot.history) ? snapshot.history : []
      const historyItems = history.slice(allHistory ? -60 : -12).reverse()
      const diagnosis = snapshot ? snapshot.diagnosis : null
      const pollSeconds = snapshot && snapshot.pollSeconds ? snapshot.pollSeconds : 30
      const chatLabel = (snapshot && snapshot.config && snapshot.config.chatLabel) || '—'

      const subline = h('p', { className: 'fb-sub' },
        h('b', null, t.lastCheck),
        ' ' + timeText(snapshot && snapshot.checkedAt, t.never) + ' · ' + t.auto.replace('{n}', String(pollSeconds)),
        ' · ' + t.target + t.colon + chatLabel,
      )

      const pauseButton = h('button', {
        type: 'button',
        className: 'fb-btn ' + (confirmPause ? 'fb-confirm' : 'fb-danger'),
        disabled: Boolean(busy),
        onClick: () => {
          if (!confirmPause) {
            setConfirmPause(true)
            return
          }
          setConfirmPause(false)
          void runAction('disconnect')
        },
      }, busy === 'disconnect' ? t.disconnecting : confirmPause ? t.btnPauseConfirm : t.btnPause)

      const resumeButton = h('button', {
        type: 'button',
        className: 'fb-btn fb-primary',
        disabled: Boolean(busy),
        onClick: () => void runAction('connect'),
      }, busy === 'connect' ? t.resuming : t.btnResume)

      return h('div', { className: 'fb-root' },
        h('div', { className: 'fb-head' },
          h('div', { className: 'fb-head-main' },
            h('div', { className: 'fb-title-row' },
              h('span', { className: 'fb-mark' }, h(FeishuMark, { size: 16 })),
              h('h1', { className: 'fb-title' }, t.title),
              h('span', { className: 'fb-chip' },
                h('span', { className: 'fb-chip-dot', style: { background: meta.color } }),
                meta.label,
              ),
            ),
            subline,
          ),
          // No header-level action: the same connect/disconnect control lives once,
          // in the 常用操作 card, so the page has a single place for every action.
        ),

        h('div', { className: 'fb-scroll' },
          flash ? h('div', { className: 'fb-flash ' + (flash.kind === 'error' ? 'fb-error' : 'fb-ok') }, flash.text) : null,

          missing ? h('div', { className: 'fb-alert' },
            h('b', null, t.missingTitle),
            h('div', { className: 'fb-alert-sub' }, t.missingNote),
          ) : null,

          notConfigured ? h('div', { className: 'fb-alert fb-warn' },
            h('b', null, t.setupTitle),
            h('div', { className: 'fb-alert-sub' }, t.setupNote),
          ) : null,

          error && snapshot ? h('div', { className: 'fb-alert fb-warn' },
            h('b', null, t.staleTitle),
            h('div', { className: 'fb-alert-sub' }, error + ' · ' + t.staleNote.replace('{time}', timeText(snapshot.checkedAt, t.never))),
          ) : null,

          paused ? h('div', { className: 'fb-paused' },
            h('div', { className: 'fb-paused-title' }, t.pauseTitle),
            h('div', { className: 'fb-paused-line' }, t.pauseSince.replace('{time}', timeText(snapshot.pausedAt, t.never))),
            h('div', { className: 'fb-paused-line' }, t.pauseNote),
          ) : null,

          down ? h('div', { className: 'fb-alert' },
            h('b', null, t.criticalTitle + t.colon),
            ' ' + failedLabels,
          ) : null,

          h('div', { className: 'fb-grid' },
            h('div', { className: 'fb-card' },
              h('div', { className: 'fb-card-head' },
                h('span', { className: 'fb-card-title' }, t.checks),
                snapshot && !paused ? h('span', { className: 'fb-card-note' }, snapshot.checks.length + ' ' + (locale === 'en' ? 'items' : '项')) : null,
              ),
              h('div', { className: 'fb-card-body' },
                paused
                  ? h('div', { className: 'fb-empty' }, t.pauseEmptyChecks)
                  : !snapshot
                    ? h('div', { className: 'fb-empty' }, t.connecting)
                    : (Array.isArray(snapshot.checks) ? snapshot.checks : []).map((check) => {
                        const state = displayStatus(check)
                        return h('div', { className: 'fb-row', key: check.id },
                          h('span', { className: 'fb-row-mark', style: { background: statusColor(state) }, 'aria-hidden': true },
                            STATUS_GLYPH[state] || '·'),
                          h('div', { className: 'fb-row-main' },
                            h('div', { className: 'fb-row-label' }, labels[check.id] || check.label),
                            h('div', { className: 'fb-row-detail' }, check.detail),
                            check.hint ? h('div', { className: 'fb-row-hint' }, check.hint) : null,
                          ),
                          check.latencyMs ? h('span', { className: 'fb-latency' }, durationText(check.latencyMs)) : null,
                        )
                      }),
              ),
            ),

            h('div', { className: 'fb-card' },
              h('div', { className: 'fb-card-head' }, h('span', { className: 'fb-card-title' }, t.actions)),
              h('div', { className: 'fb-actions' },
                ...(paused
                  ? [
                      resumeButton,
                      h('div', { className: 'fb-actions-note', key: 'note' }, t.pauseEmptyChecks),
                    ]
                  : [
                      h('button', {
                        type: 'button', className: 'fb-btn fb-primary', disabled: Boolean(busy),
                        onClick: () => void runAction('check'),
                      }, busy === 'check' ? t.checking : t.btnCheck),
                      h('button', {
                        type: 'button', className: 'fb-btn', disabled: Boolean(busy),
                        onClick: () => void runAction('repair'),
                      }, busy === 'repair' ? t.working : t.btnRepair),
                      h('button', {
                        type: 'button', className: 'fb-btn', disabled: Boolean(busy),
                        onClick: () => void runAction('test-send'),
                      }, busy === 'test-send' ? t.working : t.btnTest),
                      h('div', { style: { height: 4 }, key: 'gap' }),
                      pauseButton,
                    ]),
              ),
            ),
          ),

          diagnosis ? h('div', { className: 'fb-card' },
            h('div', { className: 'fb-card-head' },
              h('span', { className: 'fb-card-title' },
                paused || diagnosis.trigger === 'disconnect' || diagnosis.trigger === 'resume' ? t.operations : t.diag),
              h('span', { className: 'fb-card-note' },
                (paused ? t.pausedBadge : diagnosis.resolved ? '✓ ' + t.resolved : '! ' + t.unresolved)
                + ' · ' + t.diagnosisAt + ' ' + timeText(diagnosis.at)),
            ),
            h('div', { style: { padding: '8px 0 10px' } },
              (Array.isArray(diagnosis.steps) ? diagnosis.steps : []).map((step, index) => h('div', { className: 'fb-step', key: index },
                h('span', { className: 'fb-step-dot', style: { background: statusColor(step.status) } }),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('span', { className: 'fb-step-label' }, step.label + '　'),
                  h('span', { className: 'fb-step-detail' }, step.detail),
                ),
              )),
            ),
          ) : h('div', { className: 'fb-card' },
            h('div', { className: 'fb-card-head' }, h('span', { className: 'fb-card-title' }, t.diag)),
            h('div', { className: 'fb-empty' }, t.noDiag),
          ),

          h('div', { className: 'fb-card' },
            h('div', { className: 'fb-card-head' },
              h('span', { className: 'fb-card-title' }, t.history),
              h('span', { className: 'fb-card-note' }, history.length + ' ' + (locale === 'en' ? 'entries' : '条')),
            ),
            h('div', { style: { padding: '8px 0 10px' } },
              historyItems.length === 0
                ? h('div', { className: 'fb-empty' }, t.noHistory)
                : historyItems.map((entry, index) => h('div', { className: 'fb-history', key: (entry && entry.at ? entry.at : '') + '-' + index },
                    h('span', {
                      className: 'fb-history-dot',
                      style: {
                        background: statusColor(entry.level === 'success' ? 'ok' : entry.level === 'error' ? 'fail' : entry.level === 'warn' ? 'warn' : 'idle'),
                      },
                    }),
                    h('span', { className: 'fb-history-time' }, timeText(entry.at)),
                    h('span', { className: 'fb-history-text' }, String(entry.text || '')),
                  )),
              history.length > 12
                ? h('div', { style: { padding: '2px 14px 0' } },
                    h('button', {
                      type: 'button', className: 'fb-btn fb-link',
                      onClick: () => setAllHistory((value) => !value),
                    }, allHistory ? t.showLess : t.showMore),
                  )
                : null,
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // The stylesheet is plugin-scoped, not page-scoped: the sidebar entry and the
        // header chip must be styled while the board page is not mounted.
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-feishu-board', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-feishu-board: styles')

        // Sidebar entry: the id doubles as the `main` key the shell dispatches.
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'feishu-board',
          order: 16,
          label: () => (currentLocale(ctx) === 'en'
            ? TEXT.en.sidebarLabel
            : TEXT.zh.sidebarLabel),
        }, (props) => h(BoardIcon, { ...props, ctx })))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'feishu-board',
        }, (props) => h(BoardPage, { ...props, ctx })))

        // Ambient indicator: readable from any conversation, clicks through to the page.
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'feishu-board-status',
          order: 5,
        }, (props) => h(StatusChip, { ...props, ctx })))
      },
    }
  },
})