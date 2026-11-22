import type { LimitWindow, Loop, Usage, Workspace } from '../types'

const ROW = 52

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

const pad = (n: number) => String(n).padStart(2, '0')

const level = (pct: number) => (pct >= 90 ? 'err' : pct >= 70 ? 'warn' : 'ok')

// The CLI status line's fill scale: green → lime → amber → orange → red.
const fillColor = (pct: number) =>
  pct < 40 ? '#50c878' : pct < 60 ? '#aad264' : pct < 75 ? '#e6c878' : pct < 90 ? '#eb9650' : '#e15546'

const clampWidth = (width: number) => Math.round(Math.max(200, Math.min(1400, width)))

export type Drawn = { source: string; width: number; height: number }

// Each redraw is a fresh document, so a negative delay keeps every loop in the
// phase it would have reached had it never restarted.
const phase = (now: number, ms: number) => `${(-(now % ms) / 1000).toFixed(3)}s`

const base = `
  :root { --text:#1f2328; --sub:#6e7781; --track:#e6e8eb; --line:#d0d7de; --accent:#d97757; --ok:#2da44e; --warn:#bf8700; --err:#cf222e; --glow:#d9775733; }
  @media (prefers-color-scheme: dark) {
    :root { --text:#e6edf3; --sub:#8b949e; --track:#30363d; --line:#3d444d; --accent:#e8875f; --ok:#3fb950; --warn:#d29922; --err:#f85149; --glow:#e8875f40; }
  }
  text { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; fill: var(--text); }
  .sub { font-size: 12px; fill: var(--sub); }
  .ok { fill: var(--ok); } .warn { fill: var(--warn); } .err { fill: var(--err); }
`

const relative = (ms: number) => {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)

  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${pad(m)}m`
}

// ── Limits band: one row above the prompt ───────────────────────────────────

const PAD = 10
const LEAD = PAD + 18
const PATH_H = 24
const LIMIT_H = 30

const bandStyle = (now: number) => `${base}
  .lbl { font-size: 12.5px; font-weight: 600; fill: var(--sub); }
  .path { font-size: 12.5px; fill: #5ec3d7; }
  .pathhit { fill: transparent; } .pathgrp { cursor: default; }
  .pathgrp:hover .pathhit { fill: #5ec3d71f; }
  .fullpath { opacity: 0; pointer-events: none; transition: opacity .12s; }
  .pathgrp:hover ~ .fullpath { opacity: 1; }
  .fullbg { fill: #f6f8fa; stroke: var(--line); }
  @media (prefers-color-scheme: dark) { .fullbg { fill: #2d333b; } }
  .fulltext { font-size: 11.5px; fill: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .last { font-size: 12.5px; font-weight: 700; fill: #5ec3d7; }
  .wt { fill: #e6aa50; }
  .branch { font-size: 12.5px; font-weight: 600; fill: var(--ok); }
  .icon { fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .chipwt { fill: #e6aa5026; } .chipwt-t { font-size: 10.5px; font-weight: 700; fill: #e6aa50; }
  .pct { font-size: 13px; font-weight: 700; }
  .fill { animation: grow .9s cubic-bezier(.2,.8,.2,1) 1 both; transform-box: fill-box; transform-origin: left; }
  @keyframes grow { from { transform: scaleX(.92) } to { transform: scaleX(1) } }
  .up { animation: up 1.6s ease-in-out infinite ${phase(now, 1600)}; }
  @keyframes up { 50% { transform: translateY(-1.5px) } }
  .down { animation: down 1.6s ease-in-out infinite ${phase(now, 1600)}; }
  @keyframes down { 50% { transform: translateY(1.5px) } }
  .track { fill: var(--track); }
  .shine { fill: url(#shine); animation: shine 2.6s ease-in-out infinite ${phase(now, 2600)}; }
  @keyframes shine { from { transform: translateX(-60px) } to { transform: translateX(400px) } }
  .hot { animation: hot 1.2s ease-in-out infinite ${phase(now, 1200)}; }
  @keyframes hot { 50% { opacity: .45 } }
  .live { fill: var(--accent); transform-box: fill-box; transform-origin: center; animation: live 1.6s ease-in-out infinite ${phase(now, 1600)}; }
  @keyframes live { 0%, 100% { opacity: .35; transform: scale(.75) } 50% { opacity: 1; transform: scale(1.15) } }
`

type Pace = { text: string; color: string; isUp: boolean; expected: number }

type Segment = { label: string; short: string; pct?: number; tail: string; pace?: Pace }

const HOUR = 3_600_000
const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }

// How far usage is from an even burn across the window, as the CLI status line
// shows it: ±3 points is noise; under is green, over goes gray → orange → red.
export const paceOf = (l: LimitWindow | undefined, now: number): Pace | undefined => {
  const window = l === undefined ? undefined : WINDOW_MS[l.kind]
  if (l?.resetsAt === undefined || window === undefined) return undefined
  const elapsed = Math.max(0, Math.min(window, window - (new Date(l.resetsAt).getTime() - now)))
  const expected = (elapsed * 100) / window
  const delta = Math.round(l.percentUsed - expected)
  if (Math.abs(delta) < 3) return { text: '', color: '', isUp: false, expected }
  const isUp = delta > 0
  const color = !isUp ? '#50c878' : delta < 10 ? '#969ba5' : delta < 25 ? '#eb9650' : '#e15546'

  return { text: `${isUp ? '↑' : '↓'}${Math.abs(delta)}%`, color, isUp, expected }
}

const textW = (t: string, px: number) => t.length * px

type Layout = { labelW: number; barW: number; pctW: number; isShort: boolean; hasTail: boolean }

const PCT_W = 48
const LABEL_PX = 7.2
const TAIL_PX = 6.9

// One layout for all three columns, sized by the widest label and tail, so each
// column's bar, % and tail sit at the same offset. The bar gives way first, then
// the tails, then the long labels.
const layoutFor = (segs: Segment[], w: number): Layout => {
  const widest = (f: (s: Segment) => string, px: number) => Math.max(...segs.map(s => textW(f(s), px)))
  let isShort = false
  let hasTail = segs.some(s => s.tail !== '')
  const labelW = () => widest(s => (isShort ? s.short : s.label), LABEL_PX) + 10
  const tailW = () => (hasTail ? widest(s => s.tail + (s.pace?.text ? ' ' + s.pace.text : ''), TAIL_PX) + 8 : 0)
  const room = () => w - labelW() - PCT_W - tailW()
  if (room() < 30) isShort = true
  if (room() < 30) hasTail = false

  return { labelW: labelW(), barW: Math.max(24, room()), pctW: PCT_W, isShort, hasTail }
}

const segment = (s: Segment, x: number, l: Layout, i: number) => {
  const y = LIMIT_H / 2
  const bx = x + l.labelW
  const p = Math.max(0, Math.min(100, s.pct ?? 0))
  const fillW = (l.barW * p) / 100
  const color = fillColor(p)
  const pace = s.pace
  // The stretch between where usage is and where an even burn would be.
  const tx = bx + l.barW + l.pctW
  const tail = l.hasTail && s.tail !== '' ? `<text class="sub" x="${tx}" y="${y + 4}">${esc(s.tail)}</text>` : ''
  const px = tx + (s.tail === "" ? 0 : textW(s.tail, TAIL_PX) + 6)
  const paceText =
    l.hasTail && pace !== undefined && pace.text !== ''
      ? `<text class="${pace.isUp ? 'up' : 'down'}" x="${px}" y="${y + 4}" fill="${pace.color}" font-size="12px" font-weight="700">${pace.text}</text>`
      : ''

  return `
    <text class="lbl" x="${x}" y="${y + 4.5}">${l.isShort ? s.short : s.label}</text>
    <clipPath id="c${i}"><rect x="${bx}" y="${y - 4}" width="${fillW.toFixed(1)}" height="8" rx="4"/></clipPath>
    <rect class="track" x="${bx}" y="${y - 4}" width="${l.barW}" height="8" rx="4"/>
    ${s.pct === undefined ? '' : `<rect class="fill${p >= 90 ? ' hot' : ''}" x="${bx}" y="${y - 4}" width="${fillW.toFixed(1)}" height="8" rx="4" fill="${color}"/>`}
    ${s.pct === undefined || p < 2 ? '' : `<g clip-path="url(#c${i})"><rect class="shine" x="${bx - 40}" y="${y - 4}" width="40" height="8"/></g>`}
    <text class="pct" x="${bx + l.barW + 8}" y="${y + 4.5}" fill="${s.pct === undefined ? 'var(--sub)' : color}">${s.pct === undefined ? '--' : Math.round(p) + '%'}</text>
    ${tail}${paceText}`
}

const folderIcon = (x: number, y: number) =>
  `<path class="icon" stroke="#5ec3d7" d="M${x} ${y - 4} h4 l1.5 1.8 h6.5 v7.2 h-12 z"/>`

const treeIcon = (x: number, y: number) =>
  `<path class="icon" stroke="#e6aa50" d="M${x + 2} ${y - 5} v10 M${x + 2} ${y - 1} h5 M${x + 2} ${y + 4} h5"/>` +
  `<circle class="wt" cx="${x + 9}" cy="${y - 1}" r="1.8"/><circle class="wt" cx="${x + 9}" cy="${y + 4}" r="1.8"/><circle class="wt" cx="${x + 2}" cy="${y - 5}" r="1.8"/>`

const branchIcon = (x: number, y: number) =>
  `<path class="icon" stroke="var(--ok)" d="M${x + 2} ${y - 5} v10 M${x + 9} ${y - 3} q0 4 -7 5"/>` +
  `<circle class="icon" stroke="var(--ok)" cx="${x + 2}" cy="${y - 5}" r="1.6"/><circle class="icon" stroke="var(--ok)" cx="${x + 2}" cy="${y + 5}" r="1.6"/><circle class="icon" stroke="var(--ok)" cx="${x + 9}" cy="${y - 4.5}" r="1.6"/>`

// Path line: parent dirs dim, last dir bold; a worktree swaps the folder for a tree
// glyph, paints the last dir amber and adds a chip. The branch follows, *N when dirty.
// What the path row shows: the repo's own folder first, then where in it the
// session is ("axebee-portal/…/fix-login" for a worktree or a subdir), so the
// project reads at a glance; outside git, the last parent and the folder.
export const shortPath = (ws: Workspace): { head: string; last: string } => {
  const dirs = ws.path.split('/').filter(d => d !== '')
  const last = dirs[dirs.length - 1] ?? ws.path
  if (ws.repo !== undefined && (ws.isWorktree || !ws.isRepoRoot)) {
    if (last === ws.repo) return { head: '', last }
    const isChild = !ws.isWorktree && dirs[dirs.length - 2] === ws.repo
    return { head: `${cut(ws.repo, 24)}/${isChild ? '' : '…/'}`, last }
  }
  if (dirs.length < 2) return { head: ws.path.startsWith('~') ? '' : '/', last }
  return { head: `…/${cut(dirs[dirs.length - 2] ?? '', 22)}/`, last }
}

const pathRow = (ws: Workspace, W: number) => {
  const y = PATH_H / 2
  const { head: parent, last } = shortPath(ws)
  const branch = ws.branch === undefined ? '' : ws.branch + (ws.dirty > 0 ? ` *${ws.dirty}` : '')
  const chip = ws.isWorktree ? 'worktree' : ''
  let x = PAD
  const parts: string[] = []
  parts.push(ws.isWorktree ? treeIcon(x, y) : folderIcon(x, y))
  x = LEAD
  const pathW = textW(parent, 6.9) + textW(last, 7.4)
  // Hovering the short path lays the whole one over the row in a pill (the
  // desktop frame shows no <title> tooltip); one longer than the band keeps its end.
  const fullChars = Math.max(20, Math.floor((W - x - 24) / 7))
  const full = ws.path.length <= fullChars ? ws.path : '…' + ws.path.slice(-(fullChars - 1))
  const fullW = textW(full, 7) + 16
  parts.push(`<g class="pathgrp">
    <rect x="${x - 4}" y="${y - 9}" width="${pathW + 8}" height="18" rx="4" class="pathhit"/>
    <text x="${x}" y="${y + 4}"><tspan class="path" opacity=".7">${esc(parent)}</tspan><tspan class="last${ws.isWorktree ? ' wt' : ''}">${esc(last)}</tspan></text></g>`)
  // Drawn after the chip and branch so it covers them; shown by the path's hover.
  const fullPill = `<g class="fullpath">
      <rect x="${x - 8}" y="${y - 10}" width="${fullW}" height="20" rx="6" class="fullbg"/>
      <text x="${x}" y="${y + 4}" class="fulltext">${esc(full)}</text>
    </g>`
  x += pathW + 12
  if (chip !== '') {
    const cw = textW(chip, 6.2) + 12
    parts.push(`<rect class="chipwt" x="${x}" y="${y - 8}" width="${cw}" height="16" rx="8"/><text class="chipwt-t" x="${x + cw / 2}" y="${y + 3.5}" text-anchor="middle">${chip}</text>`)
    x += cw + 10
  }
  if (branch !== '') {
    parts.push(branchIcon(x, y))
    parts.push(`<text class="branch" x="${x + 16}" y="${y + 4}">${esc(branch)}</text>`)
  }
  parts.push(fullPill)

  return parts.join('')
}

const resetTail = (l: LimitWindow | undefined, now: number) =>
  l?.resetsAt ? `↻ ${relative(Math.max(0, new Date(l.resetsAt).getTime() - now))}` : ''

const svgDoc = (W: number, H: number, style: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${style}</style>${body}</svg>`

// The band is three drawings stacked by the render hook, so a native Button can
// sit beside the path (an Svg takes no presses): agents, path, limits.
export const buildAgentsRowSvg = (loops: Loop[], now: number, width: number): Drawn | null => {
  const W = clampWidth(width)
  const row = agentsRow(loops, W, 0)
  if (row.height === 0) return null

  return { source: svgDoc(W, row.height, bandStyle(now) + agentsRowStyle(now), row.svg), width: W, height: row.height }
}

export const buildPathSvg = (ws: Workspace, now: number, width: number): Drawn => {
  const W = clampWidth(width)

  return { source: svgDoc(W, PATH_H, bandStyle(now), pathRow(ws, W)), width: W, height: PATH_H }
}

export const buildLimitsSvg = (u: Usage | null, isWorking: boolean, now: number, width: number): Drawn => {
  const W = clampWidth(width)
  const five = u?.limits.find(l => l.kind === 'five_hour')
  const week = u?.limits.find(l => l.kind === 'seven_day')
  const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
  const segs: Segment[] = [
    {
      label: 'Ctx',
      short: 'Ctx',
      pct: u?.contextPercent,
      tail: u?.contextTokens === undefined ? '' : `${k(u.contextTokens)} / ${k(u.contextWindow)}`,
    },
    { label: '5h', short: '5h', pct: five?.percentUsed, tail: resetTail(five, now), pace: paceOf(five, now) },
    { label: 'Week', short: 'Wk', pct: week?.percentUsed, tail: resetTail(week, now), pace: paceOf(week, now) },
  ]
  const segW = (W - LEAD - PAD) / 3
  const layout = layoutFor(segs, segW - 16)
  const dot = isWorking
    ? `<circle class="live" cx="${PAD + 6}" cy="${LIMIT_H / 2}" r="4"/>`
    : `<circle cx="${PAD + 6}" cy="${LIMIT_H / 2}" r="3" fill="var(--sub)" opacity=".4"/>`
  const body = `<defs><linearGradient id="shine" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  ${dot}${segs.map((s, i) => segment(s, LEAD + i * segW, layout, i)).join('')}`

  return { source: svgDoc(W, LIMIT_H, bandStyle(now), body), width: W, height: LIMIT_H }
}

// ── Agents row: a pixel Claude per loop, with a speech bubble ───────────────

const AGENT_ROW_H = 48
const CELL = 3

// 12×8 sprite: body, arms, eyes; legs drawn apart so they can step.
const BODY: Array<[number, number, number, number]> = [
  [1, 1, 10, 5], // body
  [0, 3, 1, 1], // left arm
  [11, 3, 1, 1], // right arm
]
const EYES: Array<[number, number]> = [
  [3, 2],
  [8, 2],
]
const LEGS_A: Array<[number, number]> = [
  [2, 6],
  [7, 6],
]
const LEGS_B: Array<[number, number]> = [
  [4, 6],
  [9, 6],
]

const px = (x: number, y: number, w: number, h: number, cls: string) =>
  `<rect class="${cls}" x="${x * CELL}" y="${y * CELL}" width="${w * CELL}" height="${h * CELL}"/>`

const sprite = (l: Loop, x: number, y: number) => {
  const isOn = l.status === 'working'
  const tone = l.status === 'failed' || l.status === 'aborted' ? 'gray' : 'claude'
  const badge =
    l.status === 'done'
      ? `<circle cx="${10 * CELL}" cy="-1" r="5" fill="var(--ok)"/><path d="M${10 * CELL - 2.5} -1 l1.8 1.8 l3 -3.4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
      : l.status === 'failed'
        ? `<circle cx="${10 * CELL}" cy="-1" r="5" fill="var(--err)"/><path d="M${10 * CELL - 2} -3 l4 4 M${10 * CELL + 2} -3 l-4 4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`
        : ''

  return `<g transform="translate(${x} ${y})">
    <g class="${isOn ? 'bob' : 'rest'}">
      ${BODY.map(([a, b, w, h]) => px(a, b, w, h, tone)).join('')}
      <g class="${isOn ? 'blink' : ''}">${EYES.map(([a, b]) => px(a, b, 1, 2, 'eye')).join('')}</g>
    </g>
    <g class="${isOn ? 'stepA' : ''}">${LEGS_A.map(([a, b]) => px(a, b, 1, 2, tone)).join('')}</g>
    <g class="${isOn ? 'stepB' : ''}">${LEGS_B.map(([a, b]) => px(a, b, 1, 2, tone)).join('')}</g>
    ${badge}
  </g>`
}

const bubble = (l: Loop, x: number, y: number, w: number, isMain: boolean) => {
  const isOn = l.status === 'working'
  const tools = l.running.map(r => r.tool)
  const said = isOn
    ? tools.length === 0
      ? 'thinking'
      : tools.join(', ')
    : l.status === 'idle'
      ? 'waiting'
      : `${l.status} · ${l.toolCount} tools`
  const nameChars = Math.max(6, Math.floor((w - 20) / 7))
  const name = cut(isMain ? 'Main' : l.label, nameChars)
  // The agent type rides along only where it fits after the name.
  const showType = !isMain && name.length * 7 + 8 + l.type.length * 5.8 <= w - 20
  const sayChars = Math.max(6, Math.floor((w - 34) / 6.8))
  const shown = cut(said, sayChars)
  const h = 36
  const dots = isOn
    ? [0, 1, 2]
        .map(i => `<circle class="dot d${i + 1}" cx="${x + 10 + shown.length * 6.8 + 6 + i * 6}" cy="${y + 26}" r="1.8"/>`)
        .join('')
    : ''

  return `<g class="${isOn ? '' : 'dim'}">
    <path class="bubble${isOn ? ' on' : ''}" d="M${x + 8} ${y} h${w - 16} q8 0 8 8 v${h - 16} q0 8 -8 8 h${-(w - 16)} q-8 0 -8 -8 v-6 l-6 -4 l6 -4 v${-(h - 30)} q0 -8 8 -8 z"/>
    <text class="bname" x="${x + 10}" y="${y + 14}">${esc(name)}${showType ? ` <tspan class="btype">${esc(l.type)}</tspan>` : ''}</text>
    <text class="${isOn ? 'bsay' : 'bsay idle'}" x="${x + 10}" y="${y + 29}">${esc(shown)}</text>
    ${dots}
  </g>`
}

const agentsRowStyle = (now: number) => `
  .claude { fill: var(--accent); } .gray { fill: var(--sub); } .eye { fill: #1f1f1f; }
  .bob { animation: bob .5s steps(2) infinite ${phase(now, 500)}; }
  @keyframes bob { 50% { transform: translateY(-2px) } }
  .stepA { animation: step .5s steps(1) infinite ${phase(now, 500)}; }
  .stepB { animation: step .5s steps(1) infinite ${phase(now - 250, 500)}; }
  @keyframes step { 50% { transform: translateY(-2px) } }
  .blink { transform-box: fill-box; transform-origin: center; animation: blink2 3.2s infinite ${phase(now, 3200)}; }
  @keyframes blink2 { 0%, 92%, 100% { transform: scaleY(1) } 96% { transform: scaleY(.1) } }
  .bubble { fill: var(--track); stroke: var(--line); stroke-width: 1; }
  .bubble.on { stroke: var(--accent); stroke-opacity: .6; }
  .bname { font-size: 12px; font-weight: 700; }
  .btype { font-size: 10.5px; font-weight: 500; fill: var(--sub); }
  .bsay { font-size: 11.5px; fill: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .bsay.idle { fill: var(--sub); font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .dim { opacity: .55; }
  .dot { fill: var(--accent); animation: blinkdot 1.2s infinite ${phase(now, 1200)}; }
  .dot.d2 { animation-delay: ${phase(now - 200, 1200)}; } .dot.d3 { animation-delay: ${phase(now - 400, 1200)}; }
  @keyframes blinkdot { 0%, 60%, 100% { opacity: .15 } 30% { opacity: 1 } }
`

const SPRITE_W = 12 * CELL + 10

// Main first, then each subagent: sprite + bubble per slot, wrapping into rows.
const agentsRow = (loops: Loop[], W: number, top: number) => {
  if (loops.length === 0) return { svg: '', height: 0 }
  const slotW = Math.max(190, Math.min(300, (W - 2 * PAD) / loops.length))
  const perRow = Math.max(1, Math.floor((W - 2 * PAD) / slotW))
  const svg = loops
    .map((l, i) => {
      const x = (i % perRow) * slotW + PAD
      const y = top + Math.floor(i / perRow) * AGENT_ROW_H + 6
      return sprite(l, x, y + 10) + bubble(l, x + SPRITE_W, y, slotW - SPRITE_W - 10, i === 0)
    })
    .join('')

  return { svg, height: Math.ceil(loops.length / perRow) * AGENT_ROW_H + 4 }
}
