import { expect, mock, test } from 'claude-code/testing'

const SCROLL = { offset: 0, bodyRows: 30 }
const BAND = {
  plugin: 'agent-activity',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 6, bodyColumns: 120, scroll: SCROLL, view: {} },
} as const
const PANE = {
  plugin: 'agent-activity',
  component: 'Pane',
  requestId: 'agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: SCROLL, view: {} },
} as const

test('band shows the limits; the agents pane shows only spawned agents, then closes', async ($, on) => {
  const clock = mock.clock(on)
  on('agent.spawn', async () => ({ model: 'haiku', agentId: 'a1' }))
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('session.measure', async (_, e) => ({ changed: e.changed }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  await $.session.measure({
    context: { tokens: 420_000, window: 1_000_000, percent: 86 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 37, resetsAt: '2030-01-01T05:00:00Z' },
      { kind: 'seven_day', percentUsed: 62, resetsAt: '2030-01-04T00:00:00Z' },
    ],
    changed: ['context', 'rateLimits'],
  })
  await $.turn.start({ text: 'hi', turnId: 't0' })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = String((await band.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('86%')
  expect(svg).toContain('62%')
  expect(svg).toContain('420k/1M')
  // Near-full context paints the grid red and makes it twinkle while Claude works.
  expect(svg).toContain('#f8595e')
  expect(svg).toContain('class="tw')
  await band.unmount()

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...BAND, surface })
    expect(await other.find({ type: 'Svg' })).toBeUndefined()
    await other.unmount()
  }

  await $.agent.spawn({ prompt: 'look around', description: 'Scan repo', subagentType: 'Explore' } as never)
  await $.turn.start({ text: 'look around', turnId: 't1', agentId: 'a1' })

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const agents = String((await pane.find({ type: 'Svg' }))?.props.source)
  expect(agents).toContain('Scan repo')
  expect(agents).toContain('Explore')
  expect(agents).toContain('thinking')
  expect(agents).not.toContain('Main')
  await pane.unmount()

  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
  const done = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const finished = String((await done.find({ type: 'Svg' }))?.props.source)
  expect(finished).toContain('done · 0 tools')
  expect(finished).toContain('stroke="#3fb950"')
  await done.unmount()

  await clock.advance(61_000)
  const empty = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await empty.find({ type: 'Svg' })).toBeUndefined()
})
