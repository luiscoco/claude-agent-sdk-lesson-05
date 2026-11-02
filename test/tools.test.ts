import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ApprovalBroker } from '../src/server/approvals.js';
import { createStore, createWorkshopServer } from '../src/server/tools.js';
import { FULL_NAME, type Approval } from '../src/shared/lesson.js';
async function host() {
  let approval: Approval | undefined;
  const gate = new ApprovalBroker(randomUUID(), new AbortController().signal, (event) => {
    if (event.kind === 'approval') approval = event.data as Approval;
  });
  const store = createStore();
  const server = createWorkshopServer(store, gate, () => {});
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(b);
  await client.connect(a);
  return {
    gate,
    store,
    server,
    client,
    approval: () => approval!,
    async close() {
      gate.close();
      await client.close();
      await server.instance.close();
    },
  };
}
test('real MCP discovery exposes schemas and SDK config carries separate policies', async () => {
  const h = await host();
  try {
    const listed = await h.client.listTools();
    assert.deepEqual(listed.tools.map((t) => t.name).sort(), [
      'read_repo_note',
      'run_command',
      'save_review_note',
      'search_repo_notes',
    ]);
    assert.deepEqual(h.server.tools, [
      { name: 'save_review_note', permission_policy: 'always_ask' },
      { name: 'run_command', permission_policy: 'always_deny' },
    ]);
  } finally {
    await h.close();
  }
});
test('read and search use real fixture content without mutations', async () => {
  const h = await host();
  try {
    const read = await h.client.callTool({
      name: 'read_repo_note',
      arguments: { file: 'README.md' },
    });
    const search = await h.client.callTool({
      name: 'search_repo_notes',
      arguments: { query: 'TODO' },
    });
    assert.ok(!read.isError);
    assert.match(JSON.stringify(read), /Tiny Tasks/);
    assert.match(JSON.stringify(search), /unknown task ID/);
    assert.equal(h.store.counters.readCalls, 1);
    assert.equal(h.store.counters.searchCalls, 1);
    assert.equal(h.store.counters.mutations, 0);
  } finally {
    await h.close();
  }
});
test('schema rejects arbitrary paths before a read handler runs', async () => {
  const h = await host();
  try {
    const result = await h.client.callTool({
      name: 'read_repo_note',
      arguments: { file: '../../.env' },
    });
    assert.equal(result.isError, true);
    assert.equal(h.store.counters.readCalls, 0);
  } finally {
    await h.close();
  }
});
test('direct MCP mutation cannot bypass the handler approval guard', async () => {
  const h = await host();
  try {
    const input = { title: 'Review', body: 'One note.' };
    assert.equal(
      (await h.client.callTool({ name: 'save_review_note', arguments: input })).isError,
      true,
    );
    assert.equal(h.store.counters.saveCalls, 1);
    assert.equal(h.store.counters.mutations, 0);
    const waiting = h.gate.request(FULL_NAME('save_review_note'), input);
    h.gate.decide(h.approval().requestId, 'approve');
    assert.equal(await waiting, true);
    assert.ok(!(await h.client.callTool({ name: 'save_review_note', arguments: input })).isError);
    assert.equal(h.store.counters.mutations, 1);
    assert.equal(
      (await h.client.callTool({ name: 'save_review_note', arguments: input })).isError,
      true,
    );
    assert.equal(h.store.notes.length, 1);
  } finally {
    await h.close();
  }
});
test('command stub refuses execution even on a direct MCP call', async () => {
  const h = await host();
  try {
    const result = await h.client.callTool({
      name: 'run_command',
      arguments: { command: 'show_status' },
    });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /No command ran/);
    assert.equal(h.store.counters.commandCalls, 1);
    assert.equal(h.store.counters.mutations, 0);
  } finally {
    await h.close();
  }
});
