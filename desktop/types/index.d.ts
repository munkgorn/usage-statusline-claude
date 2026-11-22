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
  isSpawned?: boolean
}

export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: LimitWindow[]
}

export type Workspace = {
  /** The session's directory, ~ for home. */
  path: string
  /** The same, absolute: what Copy puts on the clipboard. */
  absPath: string
  /** The main checkout's folder name (a worktree's too); absent outside git. */
  repo?: string
  isRepoRoot: boolean
  isWorktree: boolean
  branch?: string
  dirty: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-activity': { loops: Record<string, Loop>; usage: Usage | null; tick: number; workspace: Workspace | null }
  }
}
