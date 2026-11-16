/**
 * Regression check for the Client half: renders the capsule and the board with a
 * stub React and asserts the action set of each connection state (connected /
 * disconnected by hand / broken). No browser or DSH host needed:
 *
 *   node dsh-feishu-observer/scripts/smoke-client.mjs
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
  useRef() { return { current: null } },
}

const factory = module.factory(() => React)

let renderer = null
const ctx = {
  locale: { getSnapshot: () => ({ active: 'zh' }) },
  slots: {
    inject(_name, run) { run() },
    register(_spec, render) { renderer = render; return () => undefined },
  },
}
factory.apply(ctx)
if (typeof renderer !== 'function') throw new Error('no shell.overlay renderer registered')

// ---- render helpers ---------------------------------------------------------
function walk(node, out) {
  if (node === null || node === undefined || node === false || node === true) return
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out)
    return
  }
  if (typeof node.type === 'function') {
    walk(node.type(node.props), out)
    return
  }
  walk(node.children, out)
  const label = node.props && (node.props['aria-label'] || node.props.title)
  if (typeof label === 'string') out.push(label)
}

/** useState call order in FeishuObserver: 0 snapshot, 2 open, 7 locale. */
function render(snapshot, open) {
  cell = []
  seed = { 0: snapshot, 2: Boolean(open), 7: 'zh' }
  hookIndex = 0
  const out = []
  walk(renderer({}), out)
  return out.join('\u0001')
}

const base = {
  version: '1.0.8',
  checkedAt: new Date().toISOString(),
  checking: false,
  overall: 'ok',
  checks: [{ id: 'cli', label: 'lark-cli 工具', status: 'ok', critical: true, latencyMs: 0, detail: '已安装' }],
  diagnosis: null,
  history: [],
  pollSeconds: 30,
  config: { chatLabel: 'Feishu Bot' },
  online: { ok: true },
}

const cases = [
  ['connected', { ...base, paused: false }, ['飞书 · 已连接', '立即检测', '断开连接', '发送测试消息']],
  ['disconnected', {
    ...base,
    paused: true,
    pausedAt: new Date().toISOString(),
    overall: 'paused',
    checks: [],
    diagnosis: {
      at: new Date().toISOString(),
      trigger: 'disconnect',
      resolved: true,
      steps: [{ label: '停止事件总线', status: 'ok', detail: '事件总线已停止' }],
    },
  }, ['飞书 · 已断开', '已手动断开', '恢复连接', '最近一次操作']],
  ['broken', {
    ...base,
    paused: false,
    overall: 'down',
    checks: [{ id: 'bus', label: '事件长连接', status: 'fail', critical: true, detail: '未运行' }],
  }, ['飞书 · 连接中断', '当前异常']],
]

const forbidden = {
  disconnected: ['立即检测', '断开连接', '发送测试消息'],
  connected: ['飞书 · 已断开', '恢复连接'],
  broken: ['飞书 · 已断开'],
}

let failures = 0
for (const [name, snapshot, expected] of cases) {
  let text
  try {
    text = render(snapshot, true)
  } catch (error) {
    failures += 1
    console.log('FAIL ' + name + ': render threw ' + (error && error.stack ? error.stack : error))
    continue
  }
  const missing = expected.filter((want) => text.indexOf(want) === -1)
  const extra = (forbidden[name] || []).filter((want) => text.indexOf(want) !== -1)
  if (missing.length) {
    failures += 1
    console.log('FAIL ' + name + ': missing ' + missing.map((item) => '"' + item + '"').join(', '))
  }
  if (extra.length) {
    failures += 1
    console.log('FAIL ' + name + ': offers ' + extra.map((item) => '"' + item + '"').join(', '))
  }
  if (!missing.length && !extra.length) console.log('case ' + name + ': ok')
}

// The sidebar board can own the UI: with showCapsule off the pill renders nothing.
for (const [name, snapshot] of [
  ['hidden', { ...base, paused: false, config: { chatLabel: 'Feishu Bot', showCapsule: false } }],
  ['loading', null],
]) {
  let text
  try {
    text = render(snapshot, true)
  } catch (error) {
    failures += 1
    console.log('FAIL ' + name + ': render threw ' + (error && error.stack ? error.stack : error))
    continue
  }
  if (text !== '') {
    failures += 1
    console.log('FAIL ' + name + ': expected no output, got "' + text.slice(0, 60) + '"')
  } else {
    console.log('case ' + name + ': ok')
  }
}

console.log(failures === 0 ? 'ALL RENDER CHECKS PASSED' : failures + ' RENDER CHECK FAILURES')
process.exitCode = failures === 0 ? 0 : 1