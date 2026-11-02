import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BUILTIN_TOOL_NAMES } from '@anthropic-ai/claude-agent-sdk';
import { VERSION, TOOLS, SCENARIOS, type Event } from '../shared/lesson.js';
import { ConfigSchema, redact } from './config.js';
import { ToolRun, type QueryFactory } from './runner.js';
import { PROJECT_ROOT } from './paths.js';
export function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 8192) throw new Error();
    chunks.push(Buffer.from(chunk));
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
const DecisionSchema = z.strictObject({
  runId: z.uuid(),
  requestId: z.uuid(),
  decision: z.enum(['approve', 'deny']),
});
export interface AppOptions {
  liveAvailable?: boolean;
  queryFactory?: QueryFactory;
  approvalMs?: number;
  runMs?: number;
}
export function createApiHandler(options: AppOptions = {}) {
  let current: ToolRun | undefined;
  let runFinished: Promise<void> | undefined;
  const available = () => options.liveAvailable ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/api/')) return false;
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '')) {
      json(response, 403, { error: 'Use the local application URL.' });
      return true;
    }
    if (request.method === 'GET' && pathname === '/api/meta') {
      const known = new Set<string>(Object.values(BUILTIN_TOOL_NAMES));
      const families = [
        { family: 'Files', names: ['Read', 'Write', 'Edit'] },
        { family: 'Search', names: ['Glob', 'Grep'] },
        { family: 'Commands', names: ['Bash'] },
        { family: 'Task tracking', names: ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'] },
      ];
      json(response, 200, {
        version: VERSION,
        liveAvailable: available(),
        model: process.env.ANTHROPIC_MODEL || 'SDK default',
        tools: TOOLS,
        scenarios: SCENARIOS,
        builtinFamilies: families.map((f) => ({
          ...f,
          names: f.names.filter((n) => known.has(n)),
        })),
      });
      return true;
    }
    if (request.method === 'GET' && pathname === '/api/source') {
      json(response, 200, {
        filename: 'src/server/tools.ts',
        content: await readFile(path.join(PROJECT_ROOT, 'src/server/tools.ts'), 'utf8'),
      });
      return true;
    }
    if (request.method !== 'POST' || !['/api/run', '/api/decision'].includes(pathname)) {
      json(response, 404, { error: 'Unknown API endpoint.' });
      return true;
    }
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
      json(response, 403, { error: 'Cross-origin requests are not allowed.' });
      return true;
    }
    if (!request.headers['content-type']?.startsWith('application/json')) {
      json(response, 415, { error: 'Send application/json.' });
      return true;
    }
    let input: Record<string, unknown>;
    try {
      input = await body(request);
    } catch {
      json(response, 400, { error: 'Provide a JSON object no larger than 8 KB.' });
      return true;
    }
    if (pathname === '/api/decision') {
      const parsed = DecisionSchema.safeParse(input);
      if (!parsed.success) {
        json(response, 400, { error: 'Provide a valid run, request, and one-time decision.' });
        return true;
      }
      if (!current || current.id !== parsed.data.runId) {
        json(response, 404, { error: 'That run is no longer active.' });
        return true;
      }
      if (!current.broker.decide(parsed.data.requestId, parsed.data.decision)) {
        json(response, 409, { error: 'That approval has expired or was already decided.' });
        return true;
      }
      json(response, 200, { ok: true });
      return true;
    }
    const parsed = ConfigSchema.safeParse(input.config);
    if (!parsed.success || !['local', 'live'].includes(String(input.mode))) {
      json(response, 400, {
        error:
          'Choose a valid scenario and permission mode. Note title: 1â€“80 characters; body: 1â€“400.',
      });
      return true;
    }
    const mode = input.mode as 'local' | 'live';
    if (mode === 'live' && !available()) {
      json(response, 409, {
        error: 'Live mode requires your server-side ANTHROPIC_API_KEY. Local mode needs no key.',
      });
      return true;
    }
    if (current) {
      json(response, 409, { error: 'A run is already active. Stop it before starting another.' });
      return true;
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const send = (event: Event) => {
      if (!response.destroyed) response.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const controller = new AbortController();
    const run = new ToolRun(send, controller.signal, {
      approvalMs: options.approvalMs,
      runMs: options.runMs,
    });
    current = run;
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    runFinished = completion;
    const disconnect = () => {
      controller.abort();
      run.cancel();
    };
    response.on('close', disconnect);
    const heartbeat = setInterval(() => {
      if (!response.destroyed) response.write(': waiting\n\n');
    }, 10000);
    try {
      const report = await run.execute(parsed.data, mode, options.queryFactory);
      send({
        kind: 'result',
        title: mode === 'live' ? 'SDK run completed' : 'Local run completed',
        detail: report.text,
        data: report,
      });
      send({
        kind: 'done',
        title: 'Finished',
        detail: report.sdkOk === false ? 'error' : 'success',
      });
    } catch (error) {
      send({
        kind: 'error',
        title: run.controller.signal.aborted ? 'Cancelled' : 'Run failed',
        detail: run.controller.signal.aborted
          ? 'The run was cancelled or reached its time limit.'
          : redact(error instanceof Error ? error.message : 'The run failed.'),
      });
      send({
        kind: 'done',
        title: 'Finished',
        detail: run.controller.signal.aborted ? 'cancelled' : 'error',
      });
    } finally {
      clearInterval(heartbeat);
      response.removeListener('close', disconnect);
      controller.abort();
      current = undefined;
      response.end();
      finish();
      if (runFinished === completion) runFinished = undefined;
    }
    return true;
  };
  return Object.assign(handler, {
    async dispose() {
      current?.cancel();
      await runFinished;
    },
  });
}
