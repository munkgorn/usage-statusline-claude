import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { LimitWindow, Loop, Usage, Workspace } from '../types'
import { SEATS } from './clawd'
import { CELL_W, LABEL_LEFT, LABEL_RIGHT, bandLabels, blankFor, buildAgentsSvg, buildBandSvg } from './svg'

const PANE = 'agents'
const KEEP_FINISHED = 8
// How long the pane stays after the last agent finishes, unless another spawns.
const CLOSE_AFTER_MS = 60_000

// The shape tags decline what an earlier version stored, which outlives a reload.
const loops = atom({ plugin: 'agent-activity', key: 'loops' } as const, {}, { shape: 'loops-2' })
const usage = atom({ plugin: 'agent-activity', key: 'usage' } as const, null)
// Bumped once a minute so the reset countdowns redraw while nothing else moves.
const tick = atom({ plugin: 'agent-activity', key: 'tick' } as const, 0)
const workspace = atom({ plugin: 'agent-activity', key: 'workspace' } as const, null, { shape: 'workspace-2' })

type Measured = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: LimitWindow[]
}

const toUsage = (m: Measured): Usage => ({
  contextTokens: m.context.tokens,
  contextWindow: m.context.window,
  contextPercent: m.context.percent,
  limits: m.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
})

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  // The session folder may be an untrusted repo: its core.fsmonitor would run on `git status`.
  const ran = await $.process
    .run(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { timeoutMs: 3000 })
    .catch(() => null)

  return ran !== null && ran.exitCode === 0 ? ran.stdout.trim() : ''
}

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path

// The session's directory with its git branch, the way the CLI status line reads
// it: a linked worktree's git dir lives under <main>/.git/worktrees/<name>, and
// the common git dir names the main checkout whatever folder the worktree is in.
const readWorkspace = async ($: EngineInterface): Promise<Workspace> => {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  // shortcut: CLAUDE_CODE_REMOTE is a guess at what marks a Claude Code cloud session;
  // swap in the engine's own signal if one turns up.
  const isCloud = (await $.env.get('CLAUDE_CODE_REMOTE')) === 'true'
  const gitDir = await git($, cwd, ['rev-parse', '--absolute-git-dir'])
  const inGit = gitDir !== ''
  const commonDir = inGit ? await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']) : ''
  const top = inGit ? await git($, cwd, ['rev-parse', '--show-toplevel']) : ''
  const branch = inGit ? (await git($, cwd, ['symbolic-ref', '--short', 'HEAD'])) || (await git($, cwd, ['rev-parse', '--short', 'HEAD'])) : ''
  const mainRoot = commonDir.endsWith('/.git') ? commonDir.slice(0, -'/.git'.length) : top
  const isWorktree = gitDir.includes('/worktrees/') || cwd.includes('/.claude/worktrees/')

  return {
    path: home !== '' && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd,
    absPath: cwd,
    repo: mainRoot === '' ? undefined : baseName(mainRoot),
    isRepoRoot: top !== '' && top === cwd,
    isWorktree,
    place: isCloud ? 'cloud' : isWorktree ? 'worktree' : 'local',
    branch: branch === '' ? undefined : branch,
  }
}

// Copies to the surface's clipboard where it has one, else macOS's.
const copy = async ($: EngineInterface, text: string, surface?: RenderSurface) => {
  const copied = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  if (!copied.isCopied) await $.process.run(['pbcopy'], { stdin: text, timeoutMs: 3000 }).catch(() => null)
}

const refreshWorkspace = async ($: EngineInterface) => {
  const ws = await readWorkspace($)
  await update($, workspace, () => ws)
}

// The next free laptop color: one past the newest agent's, so agents side by side differ.
const nextSeat = (all: Record<string, Loop>) => {
  const newest = Object.values(all).sort((a, b) => b.order - a.order)[0]

  return newest === undefined ? 0 : (newest.seat + 1) % SEATS
}

const patch = (all: Record<string, Loop>, id: string, fn: (one: Loop) => Loop) => {
  const order = Math.max(-1, ...Object.values(all).map(l => l.order)) + 1
  const one = all[id] ?? {
    id,
    label: id.slice(0, 8),
    type: 'agent',
    status: 'idle',
    running: [],
    toolCount: 0,
    order,
    seat: nextSeat(all),
  }
  const next = { ...all, [id]: fn(one) }

  const finished = Object.values(next)
    .filter(l => l.status !== 'working' && l.status !== 'idle')
    .sort((a, b) => b.order - a.order)
  for (const old of finished.slice(KEEP_FINISHED)) delete next[old.id]

  return next
}

// Only loops an Agent call spawned count: the engine's own forks (compaction,
// memory) run turns under ids of their own that agent.spawn never named.
const shownLoops = (all: Record<string, Loop>): Loop[] => {
  const agents = Object.values(all)
    .filter(l => l.isSpawned)
    .sort((a, b) => a.order - b.order)

  return [...agents.filter(l => l.status === 'working'), ...agents.filter(l => l.status !== 'working')]
}

let closeTimer: { cancel: () => void } | undefined

// Once no agent works, the pane stays a minute, then closes and forgets the
// finished ones; a new spawn cancels it.
const scheduleClose = async ($: EngineInterface) => {
  closeTimer?.cancel()
  if (shownLoops(await read($, loops)).some(l => l.status === 'working')) return
  closeTimer = $.clock.after(CLOSE_AFTER_MS, () => {
    void update($, loops, all => Object.fromEntries(Object.entries(all).filter(([, l]) => l.status === 'working')))
    void $.ui.close({ id: PANE }).catch(() => undefined)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const ran = await next(e)
    const now = await $.session.usage()
    await update($, usage, () => toUsage(now))
    await refreshWorkspace($)
    $.clock.every(60_000, () => void update($, tick, n => n + 1))

    return ran
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.agentId) {
      closeTimer?.cancel()
      const id = ran.agentId
      await update($, loops, all =>
        patch(all, id, one => ({
          ...one,
          isSpawned: true,
          label: e.description || one.label,
          type: e.subagentType || one.type,
          status: one.status === 'idle' ? 'working' : one.status,
        })),
      )
      void $.ui.open({ id: PANE, title: 'Agents' }).catch(() => undefined)
    }

    return ran
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      await update($, loops, all => patch(all, id, one => ({ ...one, status: 'working' })))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      void refreshWorkspace($)
      return next(e)
    }
    const id = e.agentId
    const status = e.reason === 'aborted' ? 'aborted' : e.reason === 'answer' ? 'done' : 'failed'
    await update($, loops, all => patch(all, id, one => ({ ...one, status, running: [] })))
    await scheduleClose($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    const id = e.agentId
    const call = { id: e.tool_use_id, tool: e.tool }
    await update($, loops, all =>
      patch(all, id, one => ({ ...one, status: 'working', running: [...one.running, call], toolCount: one.toolCount + 1 })),
    )
    try {
      return await next(e)
    } finally {
      await update($, loops, all => patch(all, id, one => ({ ...one, running: one.running.filter(r => r.id !== call.id) })))
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'desktop') return next(e)
    await read($, tick)
    const u = await read($, usage)
    const ws = await read($, workspace)
    const now = await $.clock.now()
    const { Box, Button, Svg, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const labels = bandLabels(ws, columns)
    const band = buildBandSvg(u, ws, labels, e.props.isWorking, now, columns * CELL_W)
    const five = u?.limits.find(l => l.kind === 'five_hour')
    const week = u?.limits.find(l => l.kind === 'seven_day')
    const alt = `Context ${u?.contextPercent ?? '--'}%, 5h ${five?.percentUsed ?? '--'}%, week ${week?.percentUsed ?? '--'}%`
    // The SVG draws the labels; these Buttons of blank space over them only take the press
    // (a transparent text color does not hide the text on desktop).

    return (
      <Box position="relative" width={columns}>
        <Svg source={band.source} alt={alt} width={band.width} height={band.height} isInteractive />
        {ws !== null && labels.folder !== undefined && (
          <Box position="absolute" top={0} left={LABEL_LEFT - 2}>
            <Button key="copy-folder" plain onPress={press => copy($, ws.absPath, press.surface)}>
              <Text mono>{blankFor(labels.folder.head + labels.folder.last)}</Text>
            </Button>
          </Box>
        )}
        {ws?.branch !== undefined && labels.branch !== undefined && (
          <Box position="absolute" top={0} right={LABEL_RIGHT}>
            <Button key="copy-branch" plain onPress={press => copy($, ws.branch ?? '', press.surface)}>
              <Text mono>{blankFor(labels.branch)}</Text>
            </Button>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const shown = shownLoops(await read($, loops))
    if (e.surface !== 'desktop' || shown.length === 0) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>{shown.length === 0 ? 'No agents running.' : `${shown.length} agents`}</Text>
    }
    const { Svg } = $.ui.resolve(e)
    const drawn = buildAgentsSvg(shown, await $.clock.now(), e.props.bodyColumns * CELL_W)
    const working = shown.filter(l => l.status === 'working').length

    return <Svg source={drawn.source} alt={`${working} of ${shown.length} agents working`} width={drawn.width} height={drawn.height} isInteractive />
  })
}
