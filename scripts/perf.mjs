#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:4790/' },
    throttle: { type: 'string', default: '4' },
    dpr: { type: 'string', default: '2' },
    width: { type: 'string', default: '1920' },
    height: { type: 'string', default: '1080' },
    chrome: { type: 'string' },
    only: { type: 'string' },
    screenshots: { type: 'string' },
    json: { type: 'boolean', default: false }
  }
})

const VIEWS = [
  { name: 'seoul-z10', hash: '37.55,126.98,10z' },
  { name: 'seoul-z12', hash: '37.55,126.98,12z' },
  { name: 'seoul-z16', hash: '37.5665,126.978,16z' },
  { name: 'paris-z12', hash: '48.8566,2.3522,12z' }
]

const ACTIONS = ['pan', 'wheel-burst', 'zoom-in-out']

const INSTRUMENT = `(() => {
  const s = window.__perf = { longtasks: [], loafs: [], draws: [], frames: [], errors: [] }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) s.longtasks.push({ start: e.startTime, duration: e.duration })
    }).observe({ type: 'longtask', buffered: true })
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        s.loafs.push({
          start: e.startTime,
          duration: e.duration,
          render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
          scripts: e.scripts.map((x) => ({ name: (x.invoker || '') + ' ' + (x.sourceFunctionName || ''), duration: x.duration }))
        })
      }
    }).observe({ type: 'long-animation-frame', buffered: true })
  } catch (e) {}
  const put = CanvasRenderingContext2D.prototype.putImageData
  CanvasRenderingContext2D.prototype.putImageData = function (...a) {
    const r = put.apply(this, a)
    s.draws.push(performance.now())
    return r
  }
  let last = performance.now()
  const tick = (t) => { s.frames.push(t - last); last = t; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  addEventListener('error', (e) => s.errors.push(String(e.message)))
})()`

function findChrome() {
  if (args.chrome) return args.chrome
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache/ms-playwright')
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : []
  for (const d of dirs) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = join(base, d, sub)
      if (existsSync(p)) return p
    }
  }
  throw new Error('no chromium found, pass --chrome')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'cafeperf-'))
  const proc = spawn(findChrome(), [
    '--headless=new', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    `--window-size=${args.width},${args.height}`, 'about:blank'
  ], { stdio: 'ignore' })
  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100)
  const port = readFileSync(portFile, 'utf8').split('\n')[0]
  const cleanup = () => {
    try { proc.kill('SIGKILL') } catch (e) { return }
    try { rmSync(profile, { recursive: true, force: true }) } catch (e) { return }
  }
  return { port, cleanup }
}

class Cdp {
  static async connect(port) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const page = targets.find((t) => t.type === 'page')
    const cdp = new Cdp(new WebSocket(page.webSocketDebuggerUrl))
    await new Promise((resolve, reject) => {
      cdp.ws.onopen = resolve
      cdp.ws.onerror = reject
    })
    return cdp
  }

  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = []
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg))
      }
    }
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
    return r.result.value
  }
}

const W = +args.width
const H = +args.height

async function mouse(cdp, type, x, y, extra = {}) {
  await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })
}

async function pan(cdp) {
  const x0 = W / 2
  const y0 = H / 2
  await mouse(cdp, 'mouseMoved', x0, y0, { button: 'none' })
  await mouse(cdp, 'mousePressed', x0, y0, { clickCount: 1, buttons: 1 })
  for (let i = 1; i <= 20; i++) {
    await mouse(cdp, 'mouseMoved', x0 - i * 20, y0 - i * 10, { buttons: 1 })
    await sleep(20)
  }
  await mouse(cdp, 'mouseReleased', x0 - 400, y0 - 200, { clickCount: 1 })
}

async function wheelBurst(cdp) {
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 10; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: W / 2 + 100, y: H / 2 + 50, deltaX: 0, deltaY: dir * 25, modifiers: 2
      })
      await sleep(30)
    }
    await sleep(150)
  }
}

async function zoomInOut(cdp) {
  for (const sel of ['.leaflet-control-zoom-in', '.leaflet-control-zoom-in', '.leaflet-control-zoom-out', '.leaflet-control-zoom-out']) {
    const box = await cdp.eval(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    await mouse(cdp, 'mouseMoved', box.x, box.y, { button: 'none' })
    await mouse(cdp, 'mousePressed', box.x, box.y, { clickCount: 1, buttons: 1 })
    await mouse(cdp, 'mouseReleased', box.x, box.y, { clickCount: 1 })
    await sleep(350)
  }
}

const RUNNERS = { pan, 'wheel-burst': wheelBurst, 'zoom-in-out': zoomInOut }

async function waitQuiet(cdp, quietMs = 1200, maxMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const q = await cdp.eval(`(() => {
      const s = window.__perf
      const now = performance.now()
      const lastLt = s.longtasks.length ? Math.max(...s.longtasks.map((t) => t.start + t.duration)) : 0
      const lastDraw = s.draws.length ? s.draws[s.draws.length - 1] : 0
      const busy = document.getElementById('head').classList.contains('loading')
      return { quietFor: now - Math.max(lastLt, lastDraw), busy, draws: s.draws.length }
    })()`)
    if (!q.busy && q.draws > 0 && q.quietFor > quietMs) return
    await sleep(200)
  }
}

async function measure(cdp, view, action) {
  await cdp.send('Page.navigate', { url: 'about:blank' })
  await sleep(200)
  await cdp.send('Page.navigate', { url: `${args.url}#${view.hash}` })
  await sleep(500)
  await waitQuiet(cdp, 1500)
  const t0 = await cdp.eval(`(() => { const s = window.__perf; s.longtasks.length = 0; s.loafs.length = 0; s.draws.length = 0; s.frames.length = 0; return performance.now() })()`)
  await RUNNERS[action](cdp)
  const tInputEnd = await cdp.eval('performance.now()')
  await waitQuiet(cdp, 1200)
  return cdp.eval(`(() => {
    const s = window.__perf
    const lt = s.longtasks.filter((t) => t.start >= ${t0})
    const ends = lt.map((t) => t.start + t.duration).concat(s.draws).concat([${tInputEnd}])
    return {
      count: lt.length,
      sum: lt.reduce((a, t) => a + t.duration, 0),
      max: lt.reduce((a, t) => Math.max(a, t.duration), 0),
      draws: s.draws.length,
      maxFrame: s.frames.length ? Math.max(...s.frames) : 0,
      idle: Math.max(...ends) - ${t0},
      settle: Math.max(...ends) - ${tInputEnd},
      view: location.hash,
      frames: s.loafs.filter((f) => f.start >= ${t0}).map((f) => ({
        duration: Math.round(f.duration),
        render: Math.round(f.render),
        scripts: f.scripts.filter((x) => x.duration > 5).map((x) => x.name.trim() + '=' + Math.round(x.duration))
      })),
      errors: s.errors.slice()
    }
  })()`)
}

async function screenshot(cdp, view, path) {
  await cdp.send('Page.navigate', { url: 'about:blank' })
  await sleep(200)
  await cdp.send('Page.navigate', { url: `${args.url}#${view.hash}` })
  await sleep(500)
  await waitQuiet(cdp, 2500)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(path, Buffer.from(data, 'base64'))
}

async function main() {
  const { port, cleanup } = await launch()
  process.on('exit', cleanup)
  process.on('SIGINT', () => process.exit(130))
  const consoleErrors = []
  try {
    const cdp = await Cdp.connect(port)
    cdp.listeners.push((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text)
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    })
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT })
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +args.dpr, mobile: false })

    if (args.screenshots) {
      for (const view of VIEWS.filter((v) => v.name.endsWith('z12'))) {
        const path = `${args.screenshots}-${view.name}.png`
        await screenshot(cdp, view, path)
        console.log(`screenshot ${path}`)
      }
    }

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: +args.throttle })
    const filter = args.only ? new RegExp(args.only) : null
    const rows = []
    for (const view of VIEWS) {
      for (const action of ACTIONS) {
        const name = `${view.name} ${action}`
        if (filter && !filter.test(name)) continue
        const r = await measure(cdp, view, action)
        rows.push({ scenario: name, ...r })
        if (!args.json) process.stderr.write('.')
      }
    }
    if (!args.json) process.stderr.write('\n')

    if (args.json) {
      console.log(JSON.stringify({ rows, consoleErrors }, null, 2))
    } else {
      const fmt = (n) => Math.round(n).toString()
      const header = ['scenario', 'lt#', 'lt sum', 'lt max', 'draws', 'max frame', 'idle', 'settle']
      const lines = rows.map((r) => [r.scenario, r.count, fmt(r.sum), fmt(r.max), r.draws, fmt(r.maxFrame), fmt(r.idle), fmt(r.settle)])
      const widths = header.map((h, i) => Math.max(h.length, ...lines.map((l) => String(l[i]).length)))
      const row = (cells) => '| ' + cells.map((c, i) => (i ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join(' | ') + ' |'
      console.log(`url=${args.url} viewport=${W}x${H}@${args.dpr}x cpu=${args.throttle}x (ms)`)
      console.log(row(header))
      console.log('|' + widths.map((w, i) => (i ? '-'.repeat(w + 1) + ':' : '-'.repeat(w + 2))).join('|') + '|')
      lines.forEach((l) => console.log(row(l)))
      const errors = rows.flatMap((r) => r.errors).concat(consoleErrors)
      console.log(errors.length ? `console errors:\n  ${[...new Set(errors)].join('\n  ')}` : 'console errors: none')
    }
  } finally {
    cleanup()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
