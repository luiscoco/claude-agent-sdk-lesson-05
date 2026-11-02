import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ToolRun } from '../server/runner.js';
import { redact } from '../server/config.js';
import { DEFAULT_CONFIG, type Config, type Approval } from '../shared/lesson.js';
if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.ANTHROPIC_API_KEY) throw new Error('Configure your own server-side API key.');
console.log(
  'REAL SDK CHECKS — billable model calls; up to $0.25 per run. Approval test drivers affect only in-memory notes.',
);
const cases: { label: string; config: Config; decision: 'approve' | 'deny' }[] =
  process.argv.includes('--all')
    ? [
        { label: 'read-only', config: DEFAULT_CONFIG, decision: 'deny' },
        {
          label: 'approved note',
          config: { ...DEFAULT_CONFIG, scenario: 'note' },
          decision: 'approve',
        },
        {
          label: 'declined note',
          config: { ...DEFAULT_CONFIG, scenario: 'note' },
          decision: 'deny',
        },
        {
          label: 'dontAsk note',
          config: { ...DEFAULT_CONFIG, scenario: 'note', permissionMode: 'dontAsk' },
          decision: 'deny',
        },
        {
          label: 'blocked command',
          config: { ...DEFAULT_CONFIG, scenario: 'command' },
          decision: 'deny',
        },
      ]
    : [{ label: 'read-only', config: DEFAULT_CONFIG, decision: 'deny' }];
for (const item of cases) {
  let run: ToolRun;
  let approvals = 0;
  run = new ToolRun((event) => {
    if (event.kind === 'approval') {
      approvals++;
      queueMicrotask(() => run.broker.decide((event.data as Approval).requestId, item.decision));
    }
  }, new AbortController().signal);
  try {
    const report = await run.execute(item.config, 'live');
    assert.equal(report.sdkOk, true);
    assert.equal(report.counters.commandCalls, 0);
    if (item.label === 'approved note') {
      assert.equal(report.counters.mutations, 1);
      assert.ok(approvals >= 1);
    } else assert.equal(report.counters.mutations, 0);
    if (item.label === 'read-only') {
      assert.ok(report.counters.readCalls >= 1);
      assert.ok(report.counters.searchCalls >= 1);
      assert.equal(approvals, 0);
    }
    if (item.label === 'dontAsk note') assert.equal(approvals, 0);
    console.log(JSON.stringify({ case: item.label, verified: true, approvals, report }));
  } catch (error) {
    console.log(
      JSON.stringify({
        case: item.label,
        verified: false,
        error: redact(error instanceof Error ? error.message : 'Live check failed.'),
      }),
    );
    process.exitCode = 1;
  }
}
