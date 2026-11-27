import type { LimitWindow, Loop, Usage, Workspace } from '../types'
import { AGENT_H, AGENT_W, BAND_H, agentClawd, agentOffsetStyle, bandClawd, clawdStyle, phase } from './clawd'

/** Desktop lays a body out in cells of its monospace metric, about 9.2px across. */
export const CELL_W = 9.2
// shortcut: a guess at one cell row's height on desktop; the labels' text line has
// to sit on the band's top border, so retune this if they float off it.
const ROW_PX = 19
/** Where the folder label starts and the branch label ends, in cells. */
export const LABEL_LEFT = 6
export const LABEL_RIGHT = 3

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)

const pad = (n: number) => String(n).padStart(2, '0')

const clampWidth = (width: number) => Math.round(Math.max(200, Math.min(1400, width)))

export type Drawn = { source: string; width: number; height: number }

const relative = (ms: number) => {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)

  return h >= 24 ? `${Math.floor(h / 24)}d${h % 24}h` : `${h}h${pad(m)}m`
}

const svgDoc = (W: number, H: number, style: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${style}</style>${body}</svg>`

const base = `
  :root { --text:#1f2328; --sub:#6e7781; --bg:#ffffff; --cell:rgba(0,0,0,.08); --line:#d0d7de; --tile:#f6f8fa; --bub:#eaeef2; }
  @media (prefers-color-scheme: dark) {
    :root { --text:#e6edf3; --sub:#8b949e; --bg:#0d1117; --cell:rgba(255,255,255,.07); --line:#30363d; --tile:#0d1117; --bub:#262626; }
  }
  text { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--text); }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
`

// Fill levels for the context grid, light to bright: green, then orange from 50%, red from 80%.
type Ramp = [string, string, string, string]
const GREEN: Ramp = ['#0e4429', '#006d32', '#26a641', '#39d353']
const ORANGE: Ramp = ['#5a2a06', '#9a4a0e', '#db6d1c', '#f7963f']
const RED: Ramp = ['#5d0f12', '#8e1b1f', '#d1383d', '#f8595e']
const rampOf = (pct: number): Ramp => (pct >= 80 ? RED : pct >= 50 ? ORANGE : GREEN)
/** A percentage's own color: plain under 50%, the ramp's brightest above. */
const pctColor = (pct: number | undefined) => (pct === undefined || pct < 50 ? 'var(--text)' : rampOf(pct)[3])

// What the folder label shows: the repo's own folder first, then where in it the
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

export type Labels = { folder?: { head: string; last: string }; branch?: string }

/** The two labels on the band's top border, each held under half its width. */
export const bandLabels = (ws: Workspace | null, columns: number): Labels => {
  if (ws === null) return {}
  const room = Math.max(12, Math.floor(columns * 0.45) - LABEL_LEFT)
  let { head, last } = shortPath(ws)
  if (head.length + last.length > room) last = cut(last, Math.max(8, room - head.length))
  if (head.length + last.length > room) head = ''

  return { folder: { head, last }, branch: ws.branch === undefined ? undefined : cut(ws.branch, room) }
}

const folderIcon = (x: number, y: number) =>
  `<path class="icon" stroke="#5ec3d7" d="M${x} ${y - 4} h4 l1.5 1.8 h6.5 v7.2 h-12 z"/>`

const treeIcon = (x: number, y: number) =>
  `<path class="icon" stroke="#e6aa50" d="M${x + 2} ${y - 5} v10 M${x + 2} ${y - 1} h5 M${x + 2} ${y + 4} h5"/>` +
  `<circle fill="#e6aa50" cx="${x + 9}" cy="${y - 1}" r="1.8"/><circle fill="#e6aa50" cx="${x + 9}" cy="${y + 4}" r="1.8"/><circle fill="#e6aa50" cx="${x + 2}" cy="${y - 5}" r="1.8"/>`

const branchIcon = (x: number, y: number) =>
  `<path class="icon" stroke="#3fb950" d="M${x + 2} ${y - 5} v10 M${x + 9} ${y - 3} q0 4 -7 5"/>` +
  `<circle class="icon" stroke="#3fb950" cx="${x + 2}" cy="${y - 5}" r="1.6"/><circle class="icon" stroke="#3fb950" cx="${x + 2}" cy="${y + 5}" r="1.6"/><circle class="icon" stroke="#3fb950" cx="${x + 9}" cy="${y - 4.5}" r="1.6"/>`

const resetOf = (l: LimitWindow | undefined, now: number) =>
  l?.resetsAt ? `↻ ${relative(Math.max(0, new Date(l.resetsAt).getTime() - now))}` : ''

// ── Band: one row above the prompt ──────────────────────────────────────────

const BAND_PX = 60
const TOP = ROW_PX / 2
const CH = 7.5 // 12.5px monospace
// Measured on desktop: a no-break space in the band's own text is about CH / 1.71 wide.
const BLANK_PX = CH / 1.71

/** No-break spaces as wide as a top-border label drawn in the SVG, its icon included. */
export const blankFor = (text: string) => '\u00a0'.repeat(Math.ceil((text.length * CH + 26) / BLANK_PX))
const U = 2 // band Claude's pixel size
const GRID_STEP = 9 // 7px square + 2px gap
const TWINKLE_S = [1.6, 2.1, 2.6, 1.9, 2.9, 2.3]

const bandStyle = (now: number) => `${base}
  .fill { fill: none; }
  .edge { fill: none; stroke: #e8743b; stroke-width: 1.5; }
  .tag { font-size: 12.5px; }
  .icon { fill: none; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .lbl { font-size: 12.5px; fill: var(--sub); }
  .sub { font-size: 12.5px; fill: var(--sub); opacity: .8; }
  .pct { font-size: 12.5px; font-weight: 700; }
  .sep { fill: var(--line); }
  ${TWINKLE_S.map((s, i) => `.tw${i} { animation: tw ${s}s ease-in-out infinite ${phase(now + i * 377, s * 1000)}; }`).join(' ')}
  @keyframes tw { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
  ${clawdStyle(U, now)}
`

// The same cells every redraw, so the grid doesn't reshuffle as it refreshes.
const levelAt = (i: number) => {
  const v = (((i + 1) * 2654435761) >>> 0) % 100

  return v < 35 ? 0 : v < 70 ? 1 : v < 90 ? 2 : 3
}

const ctxGrid = (pct: number | undefined, x: number, y: number, w: number, isWorking: boolean) => {
  const cols = Math.max(4, Math.floor((w + 2) / GRID_STEP))
  const n = cols * 3
  const p = Math.max(0, Math.min(100, pct ?? 0))
  const on = Math.round((n * p) / 100)
  const ramp = rampOf(p)
  const cells: string[] = []
  for (let i = 0; i < n; i++) {
    const cx = x + Math.floor(i / 3) * GRID_STEP
    const cy = y + (i % 3) * GRID_STEP
    const isLit = i < on
    // The leading edge burns brightest, so where the fill stops reads at a glance.
    const lvl = (i >= on - 6 ? 3 - (levelAt(i) % 2) : levelAt(i)) as 0 | 1 | 2 | 3
    const tw = isWorking && isLit && levelAt(i * 7) < 2 ? ` class="tw${i % TWINKLE_S.length}"` : ''
    cells.push(`<rect${tw} x="${cx}" y="${cy}" width="7" height="7" rx="2" fill="${isLit ? ramp[lvl] : 'var(--cell)'}"/>`)
  }

  return cells.join('')
}

type Item = { text: string; cls: string; fill?: string } | 'sep'

export const buildBandSvg = (
  u: Usage | null,
  ws: Workspace | null,
  labels: Labels,
  isWorking: boolean,
  now: number,
  width: number,
): Drawn => {
  const W = clampWidth(width)
  const cy = Math.round(TOP + (BAND_PX - TOP) / 2)
  const five = u?.limits.find(l => l.kind === 'five_hour')
  const week = u?.limits.find(l => l.kind === 'seven_day')
  const ctx = u?.contextPercent
  const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
  const pctText = (p: number | undefined) => (p === undefined ? '--' : `${Math.round(p)}%`)

  // Frame, its top edge cut (by a mask, so nothing is painted over the page) where the
  // labels sit. The labels are drawn here so they line up with the cut; the render
  // lays clear Buttons over them for the presses.
  const gaps: string[] = []
  const icons: string[] = []
  if (labels.folder !== undefined) {
    const { head, last } = labels.folder
    const x = LABEL_LEFT * CELL_W
    const color = ws?.isWorktree ? '#e6aa50' : '#5ec3d7'
    gaps.push(`<rect x="${x - 24}" y="0" width="${(head.length + last.length) * CH + 32}" height="${TOP + 2}" fill="#000"/>`)
    icons.push(ws?.isWorktree ? treeIcon(x - 18, TOP) : folderIcon(x - 18, TOP))
    icons.push(
      `<text class="tag" x="${x}" y="${TOP + 4.5}" style="fill:${color}"><tspan opacity=".7">${esc(head)}</tspan><tspan font-weight="700">${esc(last)}</tspan></text>`,
    )
  }
  if (labels.branch !== undefined) {
    const end = W - LABEL_RIGHT * CELL_W
    const x = end - labels.branch.length * CH
    gaps.push(`<rect x="${x - 24}" y="0" width="${end - x + 32}" height="${TOP + 2}" fill="#000"/>`)
    icons.push(branchIcon(x - 18, TOP))
    icons.push(`<text class="tag" x="${x}" y="${TOP + 4.5}" style="fill:#3fb950" font-weight="700">${esc(labels.branch)}</text>`)
  }
  const frame = `x="1" y="${TOP}" width="${W - 2}" height="${BAND_PX - TOP - 1}" rx="18"`
  const parts: string[] = [
    `<mask id="cut"><rect width="${W}" height="${BAND_PX}" fill="#fff"/>${gaps.join('')}</mask>`,
    `<rect class="fill" ${frame}/>`,
    `<rect class="edge" ${frame} mask="url(#cut)"/>`,
    ...icons,
  ]

  const place = ws?.place ?? 'local'
  parts.push(`<g transform="translate(16 ${cy - (BAND_H * U) / 2})">${bandClawd(place, isWorking, (ctx ?? 0) >= 80, U)}</g>`)

  const left = 66
  parts.push(`<text class="lbl" x="${left}" y="${cy + 4.5}">Ctx</text>`)
  parts.push(`<text class="pct" x="${left + 30}" y="${cy + 4.5}" fill="${pctColor(ctx)}">${pctText(ctx)}</text>`)
  const gridX = left + 30 + 4 * CH + 10

  const withResets = (on: boolean): Item[] => [
    ...(u?.contextTokens === undefined ? [] : [{ text: `${k(u.contextTokens)}/${k(u.contextWindow)}`, cls: 'sub' }]),
    'sep',
    { text: '5h', cls: 'lbl' },
    { text: pctText(five?.percentUsed), cls: 'pct', fill: pctColor(five?.percentUsed) },
    ...(on && resetOf(five, now) !== '' ? [{ text: resetOf(five, now), cls: 'sub' }] : []),
    'sep',
    { text: 'Wk', cls: 'lbl' },
    { text: pctText(week?.percentUsed), cls: 'pct', fill: pctColor(week?.percentUsed) },
    ...(on && resetOf(week, now) !== '' ? [{ text: resetOf(week, now), cls: 'sub' }] : []),
  ]
  const widthOf = (items: Item[]) => items.reduce((s, it) => s + (it === 'sep' ? 21 : it.text.length * CH + 7), 0)
  // The grid gives way first, then the reset times.
  let items = withResets(true)
  if (W - 16 - widthOf(items) - gridX - 14 < 60) items = withResets(false)
  const gridW = Math.max(36, W - 16 - widthOf(items) - gridX - 14)
  parts.push(ctxGrid(ctx, gridX, cy - 12, gridW, isWorking))

  let x = gridX + gridW + 14
  for (const it of items) {
    if (it === 'sep') {
      parts.push(`<rect class="sep" x="${x + 6}" y="${cy - 8}" width="1" height="16"/>`)
      x += 21
      continue
    }
    parts.push(`<text class="${it.cls}" x="${x}" y="${cy + 4.5}"${it.fill ? ` fill="${it.fill}"` : ''}>${esc(it.text)}</text>`)
    x += it.text.length * CH + 7
  }

  return { source: svgDoc(W, BAND_PX, bandStyle(now), parts.join('')), width: W, height: BAND_PX }
}

// ── Agents pane: a card per subagent, a speech cloud over its Claude ────────

const CARD_W = 150
const CARD_H = 138
const AU = 3 // agent Claude's pixel size

const paneStyle = (now: number, count: number) => `${base}
  .bub { fill: #f1f3f6; } .bub.off { fill: var(--bub); }
  .say { font-size: 11px; fill: #2a2f3a; } .say.off { fill: var(--sub); }
  .tile { fill: var(--tile); }
  .name { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 12px; font-weight: 600; }
  .type { font-size: 10.5px; fill: var(--sub); }
  .dot { fill: #2a2f3a; animation: dot 1.2s infinite ${phase(now, 1200)}; }
  .dot.d2 { animation-delay: ${phase(now - 200, 1200)}; } .dot.d3 { animation-delay: ${phase(now - 400, 1200)}; }
  @keyframes dot { 0%, 60%, 100% { opacity: .2 } 30% { opacity: 1 } }
  ${clawdStyle(AU, now)}
  ${Array.from({ length: count }, (_, i) => agentOffsetStyle(`s${i}`, now, i)).join(' ')}
`

const said = (l: Loop) => {
  if (l.status !== 'working') return `${l.status} · ${l.toolCount} tools`
  const tools = [...new Set(l.running.map(r => r.tool))]

  return tools.length === 0 ? 'thinking' : tools.join(', ')
}

const badge = (l: Loop, x: number, y: number) => {
  if (l.status === 'done') {
    return `<circle cx="${x}" cy="${y}" r="9" fill="var(--bg)"/><circle cx="${x}" cy="${y}" r="7.5" fill="none" stroke="#3fb950" stroke-width="1.6"/><path d="M${x - 3.2} ${y} l2.2 2.2 l4.2 -4.4" fill="none" stroke="#3fb950" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (l.status === 'failed' || l.status === 'aborted') {
    return `<circle cx="${x}" cy="${y}" r="9" fill="var(--bg)"/><circle cx="${x}" cy="${y}" r="7.5" fill="none" stroke="#f85149" stroke-width="1.6"/><path d="M${x - 2.6} ${y - 2.6} l5.2 5.2 M${x + 2.6} ${y - 2.6} l-5.2 5.2" stroke="#f85149" stroke-width="1.6" stroke-linecap="round"/>`
  }
  return ''
}

const card = (l: Loop, k: number, x0: number, y0: number, cw: number) => {
  const cx = x0 + cw / 2
  const isOn = l.status === 'working'
  const off = isOn ? '' : ' off'
  const text = cut(said(l), Math.max(6, Math.floor((cw - 40) / 6.6)))
  const bw = Math.min(cw - 6, text.length * 6.6 + 20 + (isOn ? 16 : 0))
  const bx = cx - bw / 2
  const dots = isOn
    ? [0, 1, 2].map(i => `<circle class="dot d${i + 1}" cx="${bx + 10 + text.length * 6.6 + 4 + i * 5}" cy="${y0 + 12}" r="1.6"/>`).join('')
    : ''
  const tileY = y0 + 38
  const spriteW = AGENT_W * AU
  const spriteH = AGENT_H * AU

  return `
    <rect class="bub${off}" x="${bx}" y="${y0}" width="${bw}" height="22" rx="11"/>
    <circle class="bub${off}" cx="${cx}" cy="${y0 + 26}" r="3.5"/><circle class="bub${off}" cx="${cx + 6}" cy="${y0 + 31}" r="2"/>
    <text class="say${off}" x="${bx + 10}" y="${y0 + 15}">${esc(text)}</text>${dots}
    <rect class="tile" x="${cx - 38}" y="${tileY}" width="76" height="60" rx="10"/>
    <g class="s${k}" transform="translate(${cx - spriteW / 2} ${tileY + (60 - spriteH) / 2})">${agentClawd(l.seat, l.status, AU)}</g>
    ${badge(l, cx + 36, tileY + 2)}
    <text class="name" x="${cx}" y="${y0 + 114}" text-anchor="middle">${esc(cut(l.label, Math.floor((cw - 8) / 7)))}</text>
    <text class="type" x="${cx}" y="${y0 + 129}" text-anchor="middle">${esc(cut(l.type, Math.floor((cw - 8) / 6.3)))}</text>`
}

export const buildAgentsSvg = (loops: Loop[], now: number, width: number): Drawn => {
  const W = clampWidth(width)
  const perRow = Math.max(1, Math.floor((W - 8) / CARD_W))
  const cw = (W - 8) / perRow
  const body = loops.map((l, i) => card(l, i, 4 + (i % perRow) * cw, 6 + Math.floor(i / perRow) * CARD_H, cw)).join('')
  const H = Math.max(1, Math.ceil(loops.length / perRow)) * CARD_H + 10

  return { source: svgDoc(W, H, paneStyle(now, loops.length), body), width: W, height: H }
}
