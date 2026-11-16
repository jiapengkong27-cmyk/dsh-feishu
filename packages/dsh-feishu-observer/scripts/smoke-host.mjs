/**
 * Host-half smoke test: mounts the plugin with a stub Cordis context and drives
 * the local HTTP route, asserting the unconfigured defaults and the auth gate.
 *
 *   node scripts/smoke-host.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply } from '../index.js'

const routes = []
const ctx = {
  logger: { info() {}, warn() {} },
  effect(run) {
    const dispose = run()
    return () => { if (typeof dispose === 'function') dispose() }
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  get() {
    return undefined
  },
}

const workDir = mkdtempSync(join(tmpdir(), 'fobs-smoke-'))
apply(ctx, { stateDir: workDir, bridgeDir: join(workDir, 'bridge'), pollSeconds: 9999 })

function fail(message) {
  console.log('FAIL ' + message)
  process.exitCode = 1
}

if (routes.length !== 1) fail('expected exactly one HTTP route, got ' + routes.length)
const route = routes[0]
if (!route || route.path !== '/feishu-observer') fail('route path is ' + (route && route.path))

function request(method, path, headers, body) {
  const chunks = []
  const res = {
    headersSent: false,
    status: 0,
    writeHead(status) { this.status = status; this.headersSent = true },
    end(chunk) { if (chunk) chunks.push(String(chunk)) },
    destroy() {},
    payload() { return chunks.join('') },
  }
  const req = Object.assign(
    (async function* () {
      if (body) yield Buffer.from(body, 'utf8')
    })(),
    { method, url: path, headers: headers || {} },
  )
  return route.handler(req, res).then(() => res)
}

const auth = { 'x-dsh-feishu': '1' }

const forbidden = await request('GET', '/feishu-observer/status', {})
if (forbidden.status !== 403) fail('missing header should be 403, got ' + forbidden.status)

const status = await request('GET', '/feishu-observer/status', auth)
const statusBody = JSON.parse(status.payload())
if (status.status !== 200 || statusBody.ok !== true) fail('status route did not return ok')
const value = statusBody.value || {}
if (value.config.chatId !== '') fail('default chatId should be empty, got ' + JSON.stringify(value.config.chatId))
if (value.config.chatLabel !== '—') fail('empty chatLabel should fall back to a dash, got ' + value.config.chatLabel)
if (value.paused !== false) fail('fresh state should not be paused')
if (value.overall !== 'unknown') fail('before the first probe overall should be unknown, got ' + value.overall)
if (!Array.isArray(value.history)) fail('history should be an array')

const unknown = await request('POST', '/feishu-observer/action', { ...auth, 'content-type': 'application/json' }, '{"action":"nope"}')
const unknownBody = JSON.parse(unknown.payload())
if (unknownBody.ok !== false) fail('unknown action should fail')

const unconfiguredSend = await request('POST', '/feishu-observer/action', { ...auth, 'content-type': 'application/json' }, '{"action":"test-send"}')
const unconfiguredBody = JSON.parse(unconfiguredSend.payload())
if (unconfiguredBody.ok !== false) fail('test-send without chatId should fail')
if (!/chatId/.test(JSON.stringify(unconfiguredBody.error || {}))) fail('the failure should name chatId')

rmSync(workDir, { recursive: true, force: true })

if (process.exitCode) {
  console.log('HOST CHECKS FAILED')
} else {
  console.log('HOST CHECKS PASSED (route, auth gate, defaults, unconfigured guard)')
}
process.exit(process.exitCode || 0)