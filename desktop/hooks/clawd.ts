import type { LoopStatus, Place } from '../types'

// Pixel Claudes drawn as SVG rects on a grid of `u`-pixel squares. Motion is CSS
// only, so the desktop frame animates them between redraws.

type Px = [x: number, y: number, w: number, h: number, fill: string]

const O = '#d97757'
const K = '#141414'
const TEAR = '#6cb8f2'
const LENS = 'rgba(190,225,255,.38)'
const FRAME = '#1d222b'
const CLOUD = '#eef3f9'
const CLOUD_HI = '#ffffff'
const CLOUD_LO = '#c3d0df'

// MacBook finishes, one per agent in spawn order: lid, edge, logo.
const LAPTOPS: Array<[string, string, string]> = [
  ['#d6d9de', '#a9aeb6', '#b4b8bf'], // Silver
  ['#7d7e83', '#56575c', '#a7a9ae'], // Space Gray
  ['#2f2f33', '#1c1c1f', '#6a6a70'], // Space Black
  ['#2e3442', '#1f2430', '#6c7484'], // Midnight
  ['#e8dcc6', '#c2b59c', '#cdbfa5'], // Starlight
  ['#e6d2aa', '#bfa77b', '#cbb68c'], // Gold
  ['#ebc6bd', '#c49b90', '#d2aca2'], // Rose Gold
  ['#c3d8e8', '#97b1c4', '#a9c2d4'], // Sky Blue
  ['#f2f2f0', '#cfcfcb', '#dcdcd8'], // White
  ['#bbb8b0', '#8f8c84', '#a29f97'], // Titanium
]
export const SEATS = LAPTOPS.length

type Mood = 'normal' | 'stress' | 'happy' | 'sad' | 'surprise'
const MOODS: Mood[] = ['normal', 'stress', 'happy', 'sad', 'surprise']
const MOOD_SLOT_MS = 1400
const MOOD_MS = MOODS.length * MOOD_SLOT_MS

// Each redraw is a fresh document, so a negative delay keeps every loop in the
// phase it would have reached had it never restarted.
export const phase = (now: number, ms: number) => `${(-(((now % ms) + ms) % ms) / 1000).toFixed(3)}s`

const rects = (list: Px[], u: number) =>
  list.map(([x, y, w, h, f]) => `<rect x="${x * u}" y="${y * u}" width="${w * u}" height="${h * u}" fill="${f}"/>`).join('')

const g = (cls: string, inner: string) => (cls === '' ? inner : `<g class="${cls}">${inner}</g>`)

// One eye at column x, top row y; side -1 is the left eye, so x + side is its outer edge.
const eye = (m: Mood, x: number, y: number, side: -1 | 1): Px[] => {
  if (m === 'stress') return [[x, y + 1, 1, 1, K], [x + side, y - 1, 1, 1, K], [x, y, 1, 1, K]]
  if (m === 'happy') return [[x - 1, y + 1, 1, 1, K], [x, y, 1, 1, K], [x + 1, y + 1, 1, 1, K]]
  if (m === 'sad') return [[x, y + 1, 1, 1, K], [x - side, y - 1, 1, 1, K], [x, y, 1, 1, K]]
  if (m === 'surprise') {
    const a = side < 0 ? x - 1 : x
    return [[a, y - 1, 2, 3, K], [a, y - 1, 1, 1, '#ffffff']]
  }
  return [[x, y, 1, 2, K]]
}

const eyes = (m: Mood, y: number): Px[] => [
  ...eye(m, 7, y, -1),
  ...eye(m, 12, y, 1),
  ...(m === 'sad' ? ([[6, y + 2, 1, 1, TEAR]] as Px[]) : []),
]

const moodCycle = (y: number, u: number) => MOODS.map((m, i) => g(`md md${i}`, rects(eyes(m, y), u))).join('')

const squint = (y: number): Px[] => [[6, y + 1, 2, 1, K], [12, y + 1, 2, 1, K]]
const SWEAT: Px[] = [[17, 4, 1, 1, '#7cc4f5'], [17, 5, 1, 2, '#4aa3e8']]

// ── Band Claude: 20×17 cells, chosen by where the session runs ──────────────

export const BAND_W = 20
export const BAND_H = 17

const BAND_BODY: Px[] = [[4, 6, 12, 8, O], [2, 9, 2, 2, O], [16, 9, 2, 2, O]]
const BAND_LEGS: Px[] = [5, 7, 12, 14].map(x => [x, 14, 1, 2, O] as Px)

const LEAF = '#3fbf5a'
const LEAVES_A: Px[] = [[8, 3, 2, 1, LEAF], [7, 2, 2, 1, LEAF], [11, 2, 2, 1, LEAF], [12, 1, 2, 1, LEAF]]
const LEAVES_B: Px[] = [[8, 2, 2, 1, LEAF], [7, 3, 1, 1, LEAF], [11, 3, 2, 1, LEAF], [12, 2, 2, 1, LEAF]]

const lenses = (): Px[] => [5, 11].map(x => [x + 1, 8, 2, 2, LENS] as Px)
const frames = (): Px[] => [
  ...[5, 11].flatMap(x => [[x, 7, 4, 1, FRAME], [x, 10, 4, 1, FRAME], [x, 8, 1, 2, FRAME], [x + 3, 8, 1, 2, FRAME]] as Px[]),
  [9, 8, 2, 1, FRAME],
  [4, 8, 1, 1, FRAME],
  [15, 8, 1, 1, FRAME],
]

const CLOUD_SEAT: Px[] = [
  [8, 10, 4, 1, CLOUD_HI], [1, 11, 3, 1, CLOUD_HI], [7, 11, 6, 1, CLOUD], [16, 11, 3, 1, CLOUD_HI],
  [0, 12, 20, 3, CLOUD], [1, 15, 18, 1, CLOUD_LO], [0, 14, 1, 1, CLOUD_LO], [19, 14, 1, 1, CLOUD_LO], [8, 11, 4, 1, CLOUD_HI],
]
const PUFF: Px[] = [[15, 1, 3, 1, CLOUD_HI], [14, 2, 5, 1, CLOUD_LO]]

export const bandClawd = (place: Place, isWorking: boolean, isHot: boolean, u: number) => {
  const face = isHot ? rects([...squint(8), ...SWEAT], u) : isWorking ? moodCycle(8, u) : rects(eyes('normal', 8), u)
  if (place === 'cloud') {
    return g(isWorking ? 'fl' : '', rects(BAND_BODY, u) + face) + rects(CLOUD_SEAT, u) + g(isWorking ? 'dr' : '', rects(PUFF, u))
  }
  const body = rects([...BAND_BODY, ...BAND_LEGS], u)
  const extra =
    place === 'worktree'
      ? rects([[10, 3, 1, 3, '#26803a'], [9, 4, 1, 1, LEAF]], u) +
        (isWorking ? g('la', rects(LEAVES_A, u)) + g('lb', rects(LEAVES_B, u)) : rects(LEAVES_A, u))
      : ''
  const glasses =
    place === 'local'
      ? isWorking
        ? g('gl', rects([[6, 8, 1, 1, 'rgba(255,255,255,.95)'], [12, 8, 1, 1, 'rgba(255,255,255,.95)']], u))
        : ''
      : ''
  const inner =
    place === 'local'
      ? body + rects(lenses(), u) + face + rects(frames(), u) + glasses
      : body + face + extra

  return g(isWorking ? 'bob' : '', inner)
}

// ── Agent Claude: 20×16 cells, holding a laptop in its seat's color ─────────

export const AGENT_W = 20
export const AGENT_H = 16

export const agentClawd = (seat: number, status: LoopStatus, u: number) => {
  const isOn = status === 'working'
  const [lid, edge, logo] = LAPTOPS[((seat % SEATS) + SEATS) % SEATS] ?? LAPTOPS[0]!
  const body = rects([[4, 5, 12, 8, O], ...[5, 7, 12, 14].map(x => [x, 13, 1, 2, O] as Px)], u)
  const mood: Mood = status === 'done' ? 'happy' : status === 'failed' || status === 'aborted' ? 'sad' : 'normal'
  const face = isOn ? moodCycle(7, u) : rects(eyes(mood, 7), u)
  const glow = isOn ? g('gw', rects([[5, 9, 10, 1, 'rgba(207,230,255,.85)']], u)) : ''
  const laptop = rects([[4, 10, 12, 4, lid], [4, 13, 12, 1, edge], [3, 14, 14, 1, edge], [9, 11, 2, 2, logo]], u)
  const hands = isOn
    ? g('ta', rects([[2, 10, 2, 2, O]], u)) + g('tb', rects([[16, 10, 2, 2, O]], u))
    : rects([[2, 10, 2, 2, O], [16, 10, 2, 2, O]], u)

  return g(isOn ? 'bob' : '', body + face) + glow + laptop + hands
}

// ── Motion ──────────────────────────────────────────────────────────────────

const moodDelay = (now: number, i: number) => phase(now + (MOODS.length - i) * MOOD_SLOT_MS, MOOD_MS)

/** The keyframes every Claude uses, for one drawing at grid size `u`. */
export const clawdStyle = (u: number, now: number) => `
  .bob { animation: bob 3.4s steps(1) infinite ${phase(now, 3400)}; }
  @keyframes bob { 0% { transform: translateY(0) } 33% { transform: translateY(-${u}px) } 83% { transform: translateY(0) } }
  .md { opacity: 0; animation: md ${MOOD_MS / 1000}s steps(1) infinite; }
  @keyframes md { 0% { opacity: 1 } 20% { opacity: 0 } 100% { opacity: 0 } }
  ${MOODS.map((_, i) => `.md${i} { animation-delay: ${moodDelay(now, i)}; }`).join(' ')}
  .la { animation: sw 1.2s steps(1) infinite ${phase(now, 1200)}; }
  .lb { animation: sw 1.2s steps(1) infinite ${phase(now + 600, 1200)}; }
  @keyframes sw { 0% { opacity: 1 } 50% { opacity: 0 } }
  .gl { animation: gl 1.4s steps(1) infinite ${phase(now, 1400)}; }
  @keyframes gl { 0% { opacity: 0 } 50% { opacity: 1 } }
  .fl { animation: fl 2.8s steps(1) infinite ${phase(now, 2800)}; }
  @keyframes fl { 0% { transform: translateY(0) } 50% { transform: translateY(-${u}px) } }
  .dr { animation: dr 4.2s steps(1) infinite ${phase(now, 4200)}; }
  @keyframes dr { 0% { transform: translateX(0) } 33% { transform: translateX(-${u}px) } 66% { transform: translateX(-${2 * u}px) } }
  .gw { animation: gw .56s steps(1) infinite ${phase(now, 560)}; }
  @keyframes gw { 0% { opacity: .5 } 50% { opacity: 1 } }
  .ta { animation: ta .56s steps(1) infinite ${phase(now, 560)}; }
  .tb { animation: ta .56s steps(1) infinite ${phase(now + 280, 560)}; }
  @keyframes ta { 0% { transform: translateY(0) } 50% { transform: translateY(${u}px) } }
`

/** Shifts one agent's mood and bob off the others', so they don't move in lockstep. */
export const agentOffsetStyle = (cls: string, now: number, k: number) => {
  const t = now + k * 2900

  return `.${cls} .bob { animation-delay: ${phase(t, 3400)}; } ${MOODS.map((_, i) => `.${cls} .md${i} { animation-delay: ${moodDelay(t, i)}; }`).join(' ')}`
}
