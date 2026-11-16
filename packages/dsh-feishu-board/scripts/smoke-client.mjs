/**
 * Regression check for the Client half: renders the sidebar entry and the page
 * for each connection state with a stub React, asserting the controls each state
 * offers. No browser or DSH host needed:
 *
 *   node dsh-feishu-board/scripts/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CLIENT = fileURLToPath(new URL('../client.js', import.meta.url))
const source = readFileSync(CLIENT, 'utf8')

let module = null
const win = { __ModuleLoader__: { load: (value) => { module = value } } }
new Function('window', source)(win)
if (!module) throw new Error('client module did not register')

// ---- stub React -------------------------------------------------------------
let cell = []
let hookIndex = 0
let seed = null
let refCount = 0

function createElement(type, props, ...children) {
  return { type, props: props || {}, children: children.flat(Infinity) }
}

const React = {
  createElement,
  useState(initial) {
    const index = hookIndex++
    if (seed && index in seed) return [seed[index], () => undefined]
    if (!(index in cell)) cell[index] = typeof initial === 'function' ? initial() : initial
    return [cell[index], (next) => { cell[index] = typeof next === 'function' ? next(cell[index]) : next }]
  },
  useEffect() { return undefined },
  useRef() { refCount += 1; return { current: null } },
}

const factory = module.factory(() => React)

// The plugin injects its stylesheet into document.head at apply time, so the
// sidebar entry and header chip are styled while the board page is unmounted.
const styleEl = { textContent: '', attrs: {}, remove() { this.removed = true }, setAttribute(k, v) { this.attrs[k] = v } }
globalThis.document = {
  createElement: () => styleEl,
  head: { appendChild() {} },
}

const registrations = new Map()
const ctx = {
  locale: { getSnapshot: () => ({ active: 'zh' }) },
  effect(run) {
    const dispose = run()
    return () => { if (typeof dispose === 'function') dispose() }
  },
  slots: {
    inject(_name, run) { run() },
    register(spec, render) { registrations.set(spec.name + ':' + (spec.id || spec.key), { spec, render }); return () => undefined },
  },
}
factory.apply(ctx)

if (!styleEl.textContent.includes('.fb-chipbtn') || !styleEl.textContent.includes('.fb-icon-dot')) {
  throw new Error('plugin stylesheet was not injected with the indicator rules')
}

for (const key of ['sidebar.panellist:feishu-board', 'main:feishu-board', 'conversation.session.header.utilities:feishu-board-status']) {
  if (!registrations.has(key)) throw new Error('missing registration ' + key)
}
const iconRender = registrations.get('sidebar.panellist:feishu-board').render
const pageRender = registrations.get('main:feishu-board').render
const chipRender = registrations.get('conversation.session.header.utilities:feishu-board-status').render

// ---- render helpers ---------------------------------------------------------
function walk(node, out) {
  if (node === null || node === undefined || node === false || node === true) return
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return }
  if (Array.isArray(node)) { for (const item of node) walk(item, out); return }
  if (typeof node.type === 'function') { walk(node.type(node.props), out); return }
  walk(node.children, out)
  const label = node.props && (node.props['aria-label'] || node.props.title)
  if (typeof label === 'string') out.push(label)
}

function renderWith(renderer, props, seeds) {
  cell = []
  seed = seeds || {}
  hookIndex = 0
  refCount = 0
  const out = []
  walk(renderer(props), out)
  return out.join('\u0001')
}

const base = {
  version: '1.0.8',
  checkedAt: new Date().toISOString(),
  checking: false,
  overall: 'ok',
  checks: [
    { id: 'cli', label: 'lark-cli 工具', status: 'ok', critical: true, latencyMs: 12, detail: '已安装 · 可直接调用' },
    { id: 'bus', label: '事件长连接', status: 'ok', critical: true, latencyMs: 301, detail: '总线运行中 · 1 个消费者' },
  ],
  diagnosis: null,
  history: [{ at: new Date().toISOString(), level: 'info', kind: 'boot', text: '飞书连接监控已启动，开始检测' }],
  pollSeconds: 30,
  config: { chatLabel: 'Feishu Bot' },
  online: { ok: true },
}

/** BoardPage hook order: 0 snapshot, 1 error, 2 missing, 7 locale. */
const page = (snapshot, extra) => renderWith(pageRender, { ctx }, { 0: snapshot, 7: 'zh', ...(extra || {}) })

const cases = [
  ['connected', page({ ...base, paused: false }), ['飞书连接', '已连接', '断开飞书连接', '立即检测', '一键排查修复', '发送测试消息', '事件记录', 'Feishu Bot'], ['已手动断开']],
  ['disconnected', page({
    ...base,
    paused: true,
    pausedAt: new Date().toISOString(),
    overall: 'paused',
    checks: [],
    diagnosis: { at: new Date().toISOString(), trigger: 'disconnect', resolved: true, steps: [{ label: '停止事件总线', status: 'ok', detail: '事件总线已停止' }] },
  }), ['已手动断开', '恢复飞书连接', '自 ', '最近一次操作'], ['断开飞书连接', '立即检测', '发送测试消息']],
  ['broken', page({
    ...base,
    paused: false,
    overall: 'down',
    checks: [{ id: 'bus', label: '事件长连接', status: 'fail', critical: true, detail: '事件总线未运行' }],
  }), ['连接中断', '当前异常', '断开飞书连接'], ['已手动断开']],
  ['missing-service', page(null, { 2: true }), ['找不到连接看板服务', 'dsh-feishu-observer'], []],
]

let failures = 0
for (const [name, text, wanted, unwanted] of cases) {
  let rendered = text
  try {
    if (rendered instanceof Error) throw rendered
  } catch (error) {
    failures += 1
    console.log('FAIL ' + name + ': ' + (error && error.stack ? error.stack : error))
    continue
  }
  const missing = (wanted || []).filter((want) => rendered.indexOf(want) === -1)
  const extra = (unwanted || []).filter((want) => rendered.indexOf(want) !== -1)
  if (missing.length) {
    failures += 1
    console.log('FAIL ' + name + ': missing ' + missing.map((item) => '"' + item + '"').join(', '))
  }
  if (extra.length) {
    failures += 1
    console.log('FAIL ' + name + ': still offers ' + extra.map((item) => '"' + item + '"').join(', '))
  }
  if (!missing.length && !extra.length) console.log('case ' + name + ': ok')
}

// The sidebar entry must survive an unknown state (opening DSH before the host answers).
try {
  const iconText = renderWith(iconRender, { ctx, size: 18, active: false }, {})
  if (iconText.indexOf('飞书') === -1) {
    failures += 1
    console.log('FAIL sidebar entry: label missing')
  } else {
    console.log('case sidebar-entry: ok')
  }
} catch (error) {
  failures += 1
  console.log('FAIL sidebar entry: ' + (error && error.stack ? error.stack : error))
}

// The ambient header indicator must name the state for every tone.
const chipCases = [
  ['chip-connected', { ...base, paused: false, overall: 'ok' }, ['飞书', '已连接']],
  ['chip-degraded', { ...base, paused: false, overall: 'degraded' }, ['飞书', '部分异常']],
  ['chip-broken', { ...base, paused: false, overall: 'down' }, ['飞书', '连接中断']],
  ['chip-disconnected', { ...base, paused: true, overall: 'paused' }, ['飞书', '已手动断开']],
  ['chip-unknown', null, ['飞书', '状态未知']],
]
for (const [name, snapshot, wanted] of chipCases) {
  try {
    const text = renderWith(chipRender, { ctx }, { 0: snapshot })
    const missing = wanted.filter((want) => text.indexOf(want) === -1)
    if (missing.length) {
      failures += 1
      console.log('FAIL ' + name + ': missing ' + missing.map((item) => '"' + item + '"').join(', '))
    } else {
      console.log('case ' + name + ': ok')
    }
  } catch (error) {
    failures += 1
    console.log('FAIL ' + name + ': render threw ' + (error && error.stack ? error.stack : error))
  }
}

// Render errors must surface as failures rather than empty strings.
for (const [name, snapshot, extra] of [
  ['connected-again', { ...base, paused: false }, {}],
]) {
  try {
    page(snapshot, extra)
  } catch (error) {
    failures += 1
    console.log('FAIL ' + name + ': render threw ' + (error && error.stack ? error.stack : error))
  }
}

// Exactly one disconnect control: the header must not repeat what 常用操作 offers.
{
  const text = page({ ...base, paused: false })
  const occurrences = text.split('断开飞书连接').length - 1
  if (occurrences !== 1) {
    failures += 1
    console.log('FAIL duplicate-action: 断开飞书连接 rendered ' + occurrences + ' times, expected 1')
  } else {
    console.log('case no-duplicate-action: ok')
  }
}

console.log(failures === 0 ? 'ALL RENDER CHECKS PASSED' : failures + ' RENDER CHECK FAILURES')
process.exitCode = failures === 0 ? 0 : 1