import { randomUUID } from 'node:crypto';
import { NoteSchema } from './config.js';
import { FULL_NAME, type Approval, type Event, type Note } from '../shared/lesson.js';
type Emit = (event: Event) => void;
interface Pending {
  approval: Approval;
  finish: (allow: boolean, reason: string) => void;
}
/** Grants authorize one matching note write in this run, independent of the SDK permission pipeline. */
export class ApprovalBroker {
  private pending = new Map<string, Pending>();
  private grants = new Map<string, number>();
  private closed = false;
  constructor(
    readonly runId: string,
    private signal: AbortSignal,
    private emit: Emit,
    private timeoutMs = 45000,
  ) {}
  private key(input: Note) {
    return JSON.stringify(NoteSchema.parse(input));
  }
  request(tool: string, input: Note, callbackSignal: AbortSignal = this.signal): Promise<boolean> {
    if (tool !== FULL_NAME('save_review_note')) return Promise.resolve(false);
    const parsed = NoteSchema.parse(input);
    const signal = AbortSignal.any([this.signal, callbackSignal]);
    if (this.closed || signal.aborted || this.pending.size >= 4) return Promise.resolve(false);
    const approval: Approval = {
      runId: this.runId,
      requestId: randomUUID(),
      tool,
      input: structuredClone(parsed),
      expiresAt: new Date(Date.now() + this.timeoutMs).toISOString(),
    };
    return new Promise((resolve) => {
      const abort = () => finish(false, 'Run or permission request cancelled.');
      const timer = setTimeout(() => finish(false, 'Approval expired.'), this.timeoutMs);
      const finish = (allow: boolean, reason: string) => {
        if (!this.pending.delete(approval.requestId)) return;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (allow && !signal.aborted && !this.closed) {
          const key = this.key(parsed);
          this.grants.set(key, (this.grants.get(key) ?? 0) + 1);
        } else allow = false;
        this.emit({
          kind: 'decision',
          title: allow ? 'Approved once' : 'Denied',
          detail: reason,
          data: { runId: this.runId, requestId: approval.requestId, approved: allow },
        });
        resolve(allow);
      };
      this.pending.set(approval.requestId, { approval, finish });
      signal.addEventListener('abort', abort, { once: true });
      this.emit({
        kind: 'approval',
        title: 'One-time approval requested',
        detail: 'Review the exact note below. This affects only the current run’s in-memory board.',
        data: approval,
      });
    });
  }
  decide(requestId: string, decision: 'approve' | 'deny'): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    if (Date.now() >= Date.parse(pending.approval.expiresAt)) {
      pending.finish(false, 'Approval expired.');
      return false;
    }
    pending.finish(
      decision === 'approve',
      decision === 'approve'
        ? 'The learner approved this note once.'
        : 'The learner declined this note.',
    );
    return true;
  }
  consume(input: Note): boolean {
    if (this.closed || this.signal.aborted) return false;
    const key = this.key(input);
    const count = this.grants.get(key) ?? 0;
    if (!count) return false;
    if (count === 1) this.grants.delete(key);
    else this.grants.set(key, count - 1);
    return true;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of [...this.pending.values()]) pending.finish(false, 'The run closed.');
    this.grants.clear();
  }
  get pendingCount() {
    return this.pending.size;
  }
}
