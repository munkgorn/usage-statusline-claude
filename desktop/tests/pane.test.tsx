import { expect, mock, test } from 'claude-code/testing'

const SCROLL = { offset: 0, bodyRows: 30 }
const BAND = {
  plugin: 'agent-activity',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 85, scroll: SCROLL, view: {} },
} as const

test('band shows limits and a Claude per agent while subagents are around', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', async () => ({ model: 'haiku', agentId: 'a1' }))
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('session.measure', async (_, e) => ({ changed: e.changed }))
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })

  await $.session.measure({
    context: { tokens: 42_000, window: 200_000, percent: 21 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 37, resetsAt: '2030-01-01T05:00:00Z' },
      { kind: 'seven_day', percentUsed: 92, resetsAt: '2030-01-04T00:00:00Z' },
    ],
    changed: ['context', 'rateLimits'],
  })
  await $.turn.start({ text: 'hi', turnId: 't0' })

  const quiet = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const before = String((await quiet.find({ type: 'Svg' }))?.props.source)
  expect(before).toContain('92%')
  expect(before).not.toContain('class="bubble')
  await quiet.unmount()

  await $.agent.spawn({ prompt: 'look around', description: 'Scan repo', subagentType: 'Explore' } as never)
  await $.turn.start({ text: 'look around', turnId: 't1', agentId: 'a1' })

  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = String((await desk.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('Scan repo')
  expect(svg).toContain('class="bob"')
  expect(svg.match(/class="bubble/g)?.length).toBe(2)
  await desk.unmount()

  for (const surface of ['terminal', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...BAND, surface })
    expect(await other.find({ type: 'Svg' })).toBeUndefined()
    expect(await other.find({ type: 'Text', text: /92%/ })).toBeUndefined()
    await other.unmount()
  }

  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
  const after = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(String((await after.find({ type: 'Svg' }))?.props.source)).toContain('done · 0 tools')
})
