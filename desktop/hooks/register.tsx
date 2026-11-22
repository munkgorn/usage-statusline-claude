import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { LimitWindow, Loop, Usage, Workspace } from '../types'
import { buildAgentsRowSvg, buildLimitsSvg, buildPathSvg } from './svg'

const MAIN = 'main'
const KEEP_FINISHED = 8

const loops = atom({ plugin: 'agent-activity', key: 'loops' } as const, {})
const usage = atom({ plugin: 'agent-activity', key: 'usage' } as const, null)
// Bumped once a minute so the reset countdowns redraw while nothing else moves.
const tick = atom({ plugin: 'agent-activity', key: 'tick' } as const, 0)
const workspace = atom({ plugin: 'agent-activity', key: 'workspace' } as const, null)

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

// Desktop lays a body out in cells of its monospace metric; measured at about 9.2px
// (a 31-cell pane and an 85-cell band). Width and height both go to Svg, or the
// desktop frames it at its default 150px tall.
const PX_PER_CELL = 9.2
const AUTO_CLOSE_MS = 20_000

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  const ran = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 3000 }).catch(() => null)

  return ran !== null && ran.exitCode === 0 ? ran.stdout.trim() : ''
}

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path

// The session's directory with its git branch, the way the CLI status line reads
// it: a linked worktree's git dir lives under <main>/.git/worktrees/<name>, and
// the common git dir names the main checkout whatever folder the worktree is in.
const readWorkspace = async ($: EngineInterface): Promise<Workspace> => {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  const gitDir = await git($, cwd, ['rev-parse', '--absolute-git-dir'])
  const inGit = gitDir !== ''
  const commonDir = inGit ? await git($, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']) : ''
  const top = inGit ? await git($, cwd, ['rev-parse', '--show-toplevel']) : ''
  const branch = inGit ? (await git($, cwd, ['symbolic-ref', '--short', 'HEAD'])) || (await git($, cwd, ['rev-parse', '--short', 'HEAD'])) : ''
  const status = inGit ? await git($, cwd, ['status', '--porcelain']) : ''
  const mainRoot = commonDir.endsWith('/.git') ? commonDir.slice(0, -'/.git'.length) : top

  return {
    path: home !== '' && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd,
    absPath: cwd,
    repo: mainRoot === '' ? undefined : baseName(mainRoot),
    isRepoRoot: top !== '' && top === cwd,
    isWorktree: gitDir.includes('/worktrees/') || cwd.includes('/.claude/worktrees/'),
    branch: branch === '' ? undefined : branch,
    dirty: status === '' ? 0 : status.split('\n').length,
  }
}

// Copies the full path: the surface's clipboard where it has one, else macOS's.
const copyPath = async ($: EngineInterface, text: string, surface?: RenderSurface) => {
  const copied = await $.ui.copy({ text, surface }).catch(() => ({ isCopied: false }))
  const isCopied =
    copied.isCopied || (await $.process.run(['pbcopy'], { stdin: text, timeoutMs: 3000 }).catch(() => null))?.exitCode === 0
  $.ui.toast(isCopied ? `Copied ${text}` : 'Could not copy the path')
}

const refreshWorkspace = async ($: EngineInterface) => {
  const ws = await readWorkspace($)
  await update($, workspace, () => ws)
}

const blank = (id: string, order: number): Loop => ({
  id,
  label: id === MAIN ? 'Main' : id.slice(0, 8),
  type: id === MAIN ? 'main' : 'subagent',
  status: 'idle',
  running: [],
  toolCount: 0,
  order,
})

const patch = (all: Record<string, Loop>, id: string, fn: (one: Loop) => Loop) => {
  const one = all[id] ?? blank(id, Object.keys(all).length)
  const next = { ...all, [id]: fn(one) }

  const finished = Object.values(next)
    .filter(l => l.id !== MAIN && (l.status === 'done' || l.status === 'failed' || l.status === 'aborted'))
    .sort((a, b) => b.order - a.order)
  for (const old of finished.slice(KEEP_FINISHED)) delete next[old.id]

  return next
}

let clearTimer: { cancel: () => void } | undefined

const isFinished = (l: Loop) => l.id !== MAIN && l.status !== 'working' && l.status !== 'idle'

// Once no subagent works, the finished ones stay on screen a while, then leave
// (and the agents row with them); a new spawn cancels it.
const scheduleClear = async ($: EngineInterface) => {
  clearTimer?.cancel()
  const all = Object.values(await read($, loops))
  if (all.some(l => l.id !== MAIN && l.status === 'working')) return
  clearTimer = $.clock.after(AUTO_CLOSE_MS, () => {
    void update($, loops, all => Object.fromEntries(Object.entries(all).filter(([, l]) => !isFinished(l))))
  })
}

// Main and its subagents for the agents row; nothing while no subagent is around.
// Only loops an Agent call spawned count: the engine's own forks (compaction,
// memory) run turns under ids of their own that agent.spawn never named.
const agentRowLoops = (all: Record<string, Loop>): Loop[] => {
  const list = Object.values(all).sort((a, b) => a.order - b.order)
  const agents = list.filter(l => l.id !== MAIN && l.isSpawned)
  if (agents.length === 0) return []
  const main = list.find(l => l.id === MAIN) ?? blank(MAIN, 0)

  return [main, ...agents.filter(l => l.status === 'working'), ...agents.filter(l => l.status !== 'working')]
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
      clearTimer?.cancel()
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
    }

    return ran
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    await update($, loops, all => patch(all, id, one => ({ ...one, status: 'working' })))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const status =
      e.reason === 'aborted' ? 'aborted' : e.reason === 'answer' ? (id === MAIN ? 'idle' : 'done') : 'failed'
    await update($, loops, all => patch(all, id, one => ({ ...one, status, running: [] })))
    if (id !== MAIN) await scheduleClear($)
    else void refreshWorkspace($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const call = { id: e.tool_use_id, tool: e.tool }
    await update($, loops, all =>
      patch(all, id, one => ({
        ...one,
        status: 'working',
        running: [...one.running, call],
        toolCount: one.toolCount + 1,
      })),
    )
    try {
      return await next(e)
    } finally {
      await update($, loops, all =>
        patch(all, id, one => ({ ...one, running: one.running.filter(r => r.id !== call.id) })),
      )
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'desktop') return next(e)
    await read($, tick)
    const u = await read($, usage)
    const now = await $.clock.now()
    const { Box, Button, Svg } = $.ui.resolve(e)
    const width = e.props.bodyColumns * PX_PER_CELL
    const ws = await read($, workspace)
    const agentsRow = buildAgentsRowSvg(agentRowLoops(await read($, loops)), now, width)
    const limits = buildLimitsSvg(u, e.props.isWorking, now, width)
    const five = u?.limits.find(l => l.kind === 'five_hour')
    const week = u?.limits.find(l => l.kind === 'seven_day')
    const alt = `Context ${u?.contextPercent ?? '--'}%, 5h ${five?.percentUsed ?? '--'}%, week ${week?.percentUsed ?? '--'}%`
    const COPY_W = 70
    const pathDrawn = ws === null ? null : buildPathSvg(ws, now, width - COPY_W)

    return (
      <Box flexDirection="column">
        {agentsRow !== null && (
          <Svg source={agentsRow.source} alt="Agents at work" width={agentsRow.width} height={agentsRow.height} isInteractive />
        )}
        {ws !== null && pathDrawn !== null && (
          <Box flexDirection="row" alignItems="center">
            <Svg source={pathDrawn.source} alt={ws.path} width={pathDrawn.width} height={pathDrawn.height} isInteractive />
            <Button key="copy-path" plain dimColor label="Copy" onPress={press => copyPath($, ws.absPath, press.surface)} />
          </Box>
        )}
        <Svg source={limits.source} alt={alt} width={limits.width} height={limits.height} isInteractive />
      </Box>
    )
  })
}
