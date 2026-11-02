import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ApprovalBroker } from '../src/server/approvals.js';
import { FULL_NAME, type Approval, type Event } from '../src/shared/lesson.js';
const note = { title: 'Review', body: 'Test unknown task IDs.' };
function broker(timeoutMs = 500) {
  const controller = new AbortController();
  const events: Event[] = [];
  const gate = new ApprovalBroker(
    randomUUID(),
    controller.signal,
    (e) => events.push(e),
    timeoutMs,
  );
  const latest = () => events.findLast((e) => e.kind === 'approval')!.data as Approval;
  return { controller, events, gate, latest };
}
test('one approval grants exactly one matching mutation', async () => {
  const { gate, latest } = broker();
  try {
    const waiting = gate.request(FULL_NAME('save_review_note'), note);
    const approval = latest();
    assert.equal(gate.decide(approval.requestId, 'approve'), true);
    assert.equal(await waiting, true);
    assert.equal(gate.consume({ ...note, body: 'Different' }), false);
    assert.equal(gate.consume(note), true);
    assert.equal(gate.consume(note), false);
    assert.equal(gate.decide(approval.requestId, 'approve'), false);
  } finally {
    gate.close();
  }
});
test('denial grants no mutation', async () => {
  const { gate, latest } = broker();
  try {
    const waiting = gate.request(FULL_NAME('save_review_note'), note);
    gate.decide(latest().requestId, 'deny');
    assert.equal(await waiting, false);
    assert.equal(gate.consume(note), false);
  } finally {
    gate.close();
  }
});
test('expired approval is a denial and cannot be replayed', async () => {
  const { gate, latest } = broker(10);
  const waiting = gate.request(FULL_NAME('save_review_note'), note);
  const id = latest().requestId;
  assert.equal(await waiting, false);
  assert.equal(gate.decide(id, 'approve'), false);
  assert.equal(gate.consume(note), false);
  gate.close();
});
test('run abort resolves pending decisions and invalidates grants', async () => {
  const { gate, latest, controller } = broker();
  const first = gate.request(FULL_NAME('save_review_note'), note);
  gate.decide(latest().requestId, 'approve');
  assert.equal(await first, true);
  const waiting = gate.request(FULL_NAME('save_review_note'), { ...note, title: 'Another' });
  controller.abort();
  assert.equal(await waiting, false);
  assert.equal(gate.consume(note), false);
  assert.equal(gate.pendingCount, 0);
  gate.close();
});
test('permission callback cancellation resolves its pending approval', async () => {
  const { gate } = broker();
  const callback = new AbortController();
  const waiting = gate.request(FULL_NAME('save_review_note'), note, callback.signal);
  callback.abort();
  assert.equal(await waiting, false);
  assert.equal(gate.pendingCount, 0);
  gate.close();
});
test('close denies pending requests and prevents later approvals', async () => {
  const { gate, latest } = broker();
  const waiting = gate.request(FULL_NAME('save_review_note'), note);
  const id = latest().requestId;
  gate.close();
  assert.equal(await waiting, false);
  assert.equal(gate.decide(id, 'approve'), false);
  assert.equal(await gate.request(FULL_NAME('save_review_note'), note), false);
  gate.close();
});
test('pending approvals are bounded and unrelated tools cannot acquire note grants', async () => {
  const { gate } = broker();
  const requests = Array.from({ length: 4 }, () =>
    gate.request(FULL_NAME('save_review_note'), note),
  );
  assert.equal(gate.pendingCount, 4);
  assert.equal(await gate.request(FULL_NAME('save_review_note'), note), false);
  assert.equal(await gate.request(FULL_NAME('run_command'), note), false);
  gate.close();
  assert.deepEqual(await Promise.all(requests), [false, false, false, false]);
});
test('approval arguments are copied rather than retaining mutable caller input', async () => {
  const { gate, latest } = broker();
  const input = { ...note };
  const waiting = gate.request(FULL_NAME('save_review_note'), input);
  input.body = 'Changed later';
  assert.equal(latest().input.body, note.body);
  gate.decide(latest().requestId, 'approve');
  assert.equal(await waiting, true);
  assert.equal(gate.consume(input), false);
  assert.equal(gate.consume(note), true);
  gate.close();
});
