import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { SDKMessage, query } from '@anthropic-ai/claude-agent-sdk';
import { ToolRun } from '../src/server/runner.js';
import { DEFAULT_CONFIG, FULL_NAME, type Approval } from '../src/shared/lesson.js';
import { ConfigSchema, childEnvironment } from '../src/server/config.js';
const result = (): SDKMessage =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Test result',
    permission_denials: [],
    total_cost_usd: 0.001,
    session_id: randomUUID(),
  }) as unknown as SDKMessage;
test('local read dispatches actual MCP calls without a model query', async () => {
  const run = new ToolRun(() => {}, new AbortController().signal);
  let queries = 0;
  const report = await run.execute(DEFAULT_CONFIG, 'local', () => {
    queries++;
    throw new Error('Unexpected model query');
  });
  assert.equal(queries, 0);
  assert.equal(report.counters.readCalls, 1);
  assert.equal(report.counters.searchCalls, 1);
  assert.equal(report.counters.callbackCalls, 0);
  assert.equal(report.counters.mutations, 0);
});
test('local approved and denied notes preserve distinct execution evidence', async () => {
  for (const decision of ['approve', 'deny'] as const) {
    let run: ToolRun;
    run = new ToolRun((event) => {
      if (event.kind === 'approval')
        queueMicrotask(() => run.broker.decide((event.data as Approval).requestId, decision));
    }, new AbortController().signal);
    const report = await run.execute({ ...DEFAULT_CONFIG, scenario: 'note' }, 'local');
    assert.equal(report.counters.saveCalls, decision === 'approve' ? 1 : 0);
    assert.equal(report.counters.mutations, decision === 'approve' ? 1 : 0);
    assert.equal(report.counters.callbackCalls, 0);
  }
});
test('local dontAsk and deny paths never dispatch guarded handlers', async () => {
  for (const config of [
    { ...DEFAULT_CONFIG, scenario: 'note' as const, permissionMode: 'dontAsk' as const },
    { ...DEFAULT_CONFIG, scenario: 'command' as const },
  ]) {
    let approvals = 0;
    const run = new ToolRun((event) => {
      if (event.kind === 'approval') approvals++;
    }, new AbortController().signal);
    const report = await run.execute(config, 'local');
    assert.equal(approvals, 0);
    assert.equal(report.counters.saveCalls, 0);
    assert.equal(report.counters.commandCalls, 0);
  }
});
test('live request uses streaming input, fixed capabilities, SDK policy and cleanup', async () => {
  let request!: Parameters<typeof query>[0];
  let closes = 0;
  const run = new ToolRun(() => {}, new AbortController().signal);
  const report = await run.execute(DEFAULT_CONFIG, 'live', (input) => {
    request = input;
    return {
      async *[Symbol.asyncIterator]() {
        yield result();
      },
      close() {
        closes++;
      },
    };
  });
  assert.equal(report.sdkOk, true);
  assert.equal(closes, 1);
  assert.equal(typeof request.prompt, 'object');
  assert.deepEqual(request.options?.tools, []);
  assert.deepEqual(request.options?.allowedTools, [
    FULL_NAME('read_repo_note'),
    FULL_NAME('search_repo_notes'),
  ]);
  assert.equal(request.options?.permissionMode, 'default');
  assert.equal(request.options?.persistSession, false);
  assert.equal(request.options?.maxBudgetUsd, 0.25);
  assert.equal(request.options?.abortController?.signal.aborted, true);
  assert.deepEqual((request.options?.mcpServers?.workshop as { tools: unknown }).tools, [
    { name: 'save_review_note', permission_policy: 'always_ask' },
    { name: 'run_command', permission_policy: 'always_deny' },
  ]);
});
test('SDK callback denies unknown provenance and grants only a reviewed note', async () => {
  let run: ToolRun;
  run = new ToolRun((event) => {
    if (event.kind === 'approval')
      queueMicrotask(() => run.broker.decide((event.data as Approval).requestId, 'approve'));
  }, new AbortController().signal);
  const report = await run.execute({ ...DEFAULT_CONFIG, scenario: 'note' }, 'live', (request) => ({
    async *[Symbol.asyncIterator]() {
      const callback = request.options!.canUseTool!;
      const args = { title: 'Review', body: 'Test' };
      const context = {
        signal: new AbortController().signal,
        mcpServer: { name: 'workshop', source: 'sdk' },
      };
      assert.equal(
        (
          await callback(FULL_NAME('save_review_note'), args, {
            ...context,
            mcpServer: { name: 'workshop', source: 'project' },
          } as never)
        )?.behavior,
        'deny',
      );
      assert.equal(
        (await callback(FULL_NAME('save_review_note'), args, context as never))?.behavior,
        'allow',
      );
      assert.equal(run.broker.consume(args), true);
      assert.equal(run.broker.consume(args), false);
      yield result();
    },
    close() {},
  }));
  assert.equal(report.counters.callbackCalls, 2);
});
test('stream failure and missing results both close the query', async () => {
  for (const fail of [false, true]) {
    let closes = 0;
    const run = new ToolRun(() => {}, new AbortController().signal);
    await assert.rejects(
      run.execute(DEFAULT_CONFIG, 'live', () => ({
        async *[Symbol.asyncIterator]() {
          if (fail) throw new Error('Stream failed');
        },
        close() {
          closes++;
        },
      })),
      fail ? /Stream failed/ : /without a result/,
    );
    assert.equal(closes, 1);
    assert.equal(run.broker.pendingCount, 0);
  }
});
test('abort during pending approval cannot save a note', async () => {
  const controller = new AbortController();
  const run = new ToolRun((event) => {
    if (event.kind === 'approval') queueMicrotask(() => controller.abort());
  }, controller.signal);
  await assert.rejects(run.execute({ ...DEFAULT_CONFIG, scenario: 'note' }, 'local'), /abort/i);
  assert.equal(run.store.counters.mutations, 0);
  assert.equal(run.broker.pendingCount, 0);
});
test('pre-aborted requests and invalid configurations never start query', async () => {
  for (const invalid of [false, true]) {
    const controller = new AbortController();
    if (!invalid) controller.abort();
    const run = new ToolRun(() => {}, controller.signal);
    let calls = 0;
    await assert.rejects(
      run.execute(
        invalid ? { ...DEFAULT_CONFIG, permissionMode: 'bypassPermissions' } : DEFAULT_CONFIG,
        'live',
        () => {
          calls++;
          throw new Error('Unexpected');
        },
      ),
    );
    assert.equal(calls, 0);
  }
});
test('config and child environment reject unrelated capability and credential input', () => {
  assert.equal(ConfigSchema.safeParse({ ...DEFAULT_CONFIG, command: 'arbitrary' }).success, false);
  const env = childEnvironment({
    PATH: 'bin',
    ANTHROPIC_API_KEY: 'server-test-key',
    UNRELATED_SECRET: 'omit',
  });
  assert.equal(env.PATH, 'bin');
  assert.equal(env.ANTHROPIC_API_KEY, 'server-test-key');
  assert.equal(env.UNRELATED_SECRET, undefined);
});
