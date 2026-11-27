export type LoopStatus = 'working' | 'idle' | 'done' | 'failed' | 'aborted'

export type RunningTool = { id: string; tool: string }

export type Loop = {
  id: string
  label: string
  type: string
  status: LoopStatus
  running: RunningTool[]
  toolCount: number
  order: number
  /** Which of the ten laptop colors this agent holds. */
  seat: number
  isSpawned?: boolean
}

export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: LimitWindow[]
}

/** Which Claude the band draws: the sprout, the glasses, or the cloud rider. */
export type Place = 'worktree' | 'local' | 'cloud'

export type Workspace = {
  /** The session's directory, ~ for home. */
  path: string
  /** The same, absolute: what a press on the folder label copies. */
  absPath: string
  /** The main checkout's folder name (a worktree's too); absent outside git. */
  repo?: string
  isRepoRoot: boolean
  isWorktree: boolean
  place: Place
  branch?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-activity': {
      loops: Shaped<Record<string, Loop>>
      usage: Usage | null
      tick: number
      workspace: Shaped<Workspace | null>
    }
  }
}
