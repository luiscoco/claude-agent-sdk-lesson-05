import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApiHandler, type AppOptions } from '../src/server/app.js';
import { DEFAULT_CONFIG, type Approval, type Event } from '../src/shared/lesson.js';
import { createEventParser } from '../src/shared/sse.js';
async function host(options: AppOptions = {}) {
  const app = createApiHandler({ liveAvailable: false, ...options });
  const server = createServer((req, res) => {
    void app(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    dispose: () => app.dispose(),
    post: (url: string, value: unknown, headers: Record<string, string> = {}) =>
      fetch(base + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(value),
      }),
    async close() {
      await app.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
async function untilApproval(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Event[] = [];
  const parse = createEventParser((value) => events.push(value as Event));
  while (!events.some((e) => e.kind === 'approval')) {
    const part = await reader.read();
    assert.equal(part.done, false);
    parse(decoder.decode(part.value, { stream: true }));
  }
  return {
    approval: events.find((e) => e.kind === 'approval')!.data as Approval,
    async rest() {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        parse(decoder.decode(part.value, { stream: true }));
      }
      return events;
    },
  };
}
test('metadata and source expose only intended public information', async () => {
  const h = await host();
  try {
    const meta = await (await fetch(h.base + '/api/meta')).json();
    assert.equal(meta.version, '0.3.310');
    assert.equal(meta.liveAvailable, false);
    assert.equal(meta.tools.length, 4);
    assert.ok(
      meta.builtinFamilies
        .find((f: { family: string }) => f.family === 'Commands')
        .names.includes('Bash'),
    );
    const source = await (await fetch(h.base + '/api/source?path=.env')).json();
    assert.equal(source.filename, 'src/server/tools.ts');
    assert.match(source.content, /createSdkMcpServer/);
    assert.ok(!source.content.includes('sk-ant-'));
  } finally {
    await h.close();
  }
});
test('local read streams real MCP results and no SDK permission callbacks', async () => {
  const h = await host();
  try {
    const response = await h.post('/api/run', { mode: 'local', config: DEFAULT_CONFIG });
    assert.equal(response.status, 200);
    const trace = await response.text();
    assert.match(trace, /Real MCP call result/);
    assert.match(trace, /"callbackCalls":0/);
    assert.match(trace, /"readCalls":1/);
    assert.match(trace, /"searchCalls":1/);
  } finally {
    await h.close();
  }
});
test('HTTP approval is bound to the current run and cannot be replayed or modify arguments', async () => {
  const h = await host();
  try {
    const response = await h.post('/api/run', {
      mode: 'local',
      config: { ...DEFAULT_CONFIG, scenario: 'note' },
    });
    const stream = await untilApproval(response);
    const request = stream.approval;
    assert.equal((await h.post('/api/run', { mode: 'local', config: DEFAULT_CONFIG })).status, 409);
    assert.equal(
      (
        await h.post('/api/decision', {
          runId: randomUUID(),
          requestId: request.requestId,
          decision: 'approve',
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await h.post('/api/decision', {
          runId: request.runId,
          requestId: request.requestId,
          decision: 'approve',
          input: { title: 'Injected' },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.post('/api/decision', {
          runId: request.runId,
          requestId: request.requestId,
          decision: 'approve',
        })
      ).status,
      200,
    );
    const replay = await h.post('/api/decision', {
      runId: request.runId,
      requestId: request.requestId,
      decision: 'approve',
    });
    assert.ok([404, 409].includes(replay.status));
    const trace = await stream.rest();
    const report = trace.find((e) => e.kind === 'result')!.data as {
      counters: { mutations: number };
      notes: { title: string }[];
    };
    assert.equal(report.counters.mutations, 1);
    assert.equal(report.notes[0]?.title, DEFAULT_CONFIG.title);
  } finally {
    await h.close();
  }
});
test('expired HTTP approval ends without a mutation', async () => {
  const h = await host({ approvalMs: 15 });
  try {
    const response = await h.post('/api/run', {
      mode: 'local',
      config: { ...DEFAULT_CONFIG, scenario: 'note' },
    });
    const trace = await response.text();
    assert.match(trace, /Approval expired/);
    assert.match(trace, /"saveCalls":0/);
    assert.match(trace, /"mutations":0/);
  } finally {
    await h.close();
  }
});
test('request boundaries reject missing credentials, unknown policies, oversized and cross-origin input', async () => {
  const h = await host();
  try {
    assert.equal((await h.post('/api/run', { mode: 'live', config: DEFAULT_CONFIG })).status, 409);
    assert.equal(
      (
        await h.post('/api/run', {
          mode: 'local',
          config: { ...DEFAULT_CONFIG, permissionMode: 'bypassPermissions' },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await h.post(
          '/api/run',
          { mode: 'local', config: DEFAULT_CONFIG },
          { Origin: 'https://example.com' },
        )
      ).status,
      403,
    );
    assert.equal((await h.post('/api/run', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await h.post('/api/run', { padding: 'x'.repeat(9000) })).status, 400);
    assert.equal((await fetch(h.base + '/api/unknown')).status, 404);
  } finally {
    await h.close();
  }
});
test('host shutdown cancels pending approvals before releasing the active run', async () => {
  const h = await host();
  try {
    const response = await h.post('/api/run', {
      mode: 'local',
      config: { ...DEFAULT_CONFIG, scenario: 'note' },
    });
    const stream = await untilApproval(response);
    await h.dispose();
    const events = await stream.rest();
    assert.ok(
      events.some(
        (event) =>
          event.kind === 'decision' && (event.data as { approved: boolean }).approved === false,
      ),
    );
    assert.ok(events.some((event) => event.kind === 'done' && event.detail === 'cancelled'));
    assert.ok(!events.some((event) => event.title === 'Note saved'));
  } finally {
    await h.close();
  }
});
