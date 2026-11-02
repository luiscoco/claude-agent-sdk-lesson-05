import {
  query,
  type Query,
  type SDKMessage,
  type Options,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { InputQueue } from './input.js';
import { ApprovalBroker } from './approvals.js';
import { createStore, createWorkshopServer } from './tools.js';
import { ConfigSchema, NoteSchema, childEnvironment, redact } from './config.js';
import { FIXTURE_ROOT, CONFIG_DIRECTORY } from './paths.js';
import { FULL_NAME, type Config, type Mode, type Event, type Report } from '../shared/lesson.js';
export type QueryFactory = (
  request: Parameters<typeof query>[0],
) => AsyncIterable<SDKMessage> & Pick<Query, 'close'>;
export type Emit = (event: Event) => void;
export function scenarioPrompt(config: Config) {
  if (config.scenario === 'read')
    return 'Use read_repo_note for README.md and search_repo_notes for TODO, then summarize one issue in two sentences. Do not save notes or request commands.';
  if (config.scenario === 'command')
    return 'For this permissions lesson, call run_command with command="show_status" exactly once to observe the denial, then explain the outcome in one sentence. Do not use other tools or retry.';
  return `Call save_review_note exactly once with ${JSON.stringify({ title: config.title, body: config.body })}. Wait for the learner approval decision. If denied, do not retry or use other tools; explain the outcome briefly.`;
}
export function requestOptions(
  config: Config,
  server: ReturnType<typeof createWorkshopServer>,
  broker: ApprovalBroker,
  store: ReturnType<typeof createStore>,
  controller: AbortController,
  emit: Emit,
): Options {
  return {
    cwd: FIXTURE_ROOT,
    env: childEnvironment(),
    tools: [],
    allowedTools: [FULL_NAME('read_repo_note'), FULL_NAME('search_repo_notes')],
    permissionMode: config.permissionMode,
    mcpServers: { workshop: server },
    settingSources: [],
    skills: [],
    persistSession: false,
    maxTurns: 6,
    maxBudgetUsd: 0.25,
    abortController: controller,
    ...(process.env.ANTHROPIC_MODEL ? { model: process.env.ANTHROPIC_MODEL } : {}),
    canUseTool: async (name, input, context) => {
      store.counters.callbackCalls++;
      const parsed = NoteSchema.safeParse(input);
      if (
        name !== FULL_NAME('save_review_note') ||
        context.mcpServer?.source !== 'sdk' ||
        !parsed.success
      ) {
        emit({
          kind: 'policy',
          title: 'Host denied request',
          detail: 'Unexpected tool, provenance, or arguments.',
        });
        return {
          behavior: 'deny',
          message: 'Only an explicit approval for a valid review note is supported.',
        };
      }
      emit({
        kind: 'policy',
        title: 'canUseTool reached the host',
        detail: 'The SDK requested a decision for the note mutation.',
      });
      const allow = await broker.request(name, parsed.data, context.signal);
      return allow
        ? { behavior: 'allow', updatedInput: parsed.data }
        : {
            behavior: 'deny',
            message: 'The learner declined or the approval expired. Do not retry.',
          };
    },
    hooks: {
      PreToolUse: [
        {
          hooks: [
            async (input) => {
              emit({
                kind: 'policy',
                title: 'PreToolUse observation',
                detail: `Requested ${'tool_name' in input ? String(input.tool_name) : 'tool'}. This hook observes and does not approve.`,
              });
              return {};
            },
          ],
        },
      ],
    },
    includeHookEvents: true,
    systemPrompt:
      'You are a concise TypeScript course tutor demonstrating tool permissions. Use only the requested workshop tools. Make each requested call once. A permission denial is expected in some scenarios: report it accurately without retries or workarounds. Never claim to have executed a shell command or changed a project file.',
  };
}
export class ToolRun {
  readonly id = randomUUID();
  readonly store = createStore();
  readonly controller = new AbortController();
  readonly broker: ApprovalBroker;
  private started = false;
  private abort: () => void;
  private timeout: ReturnType<typeof setTimeout>;
  constructor(
    private emit: Emit,
    private signal: AbortSignal,
    options: { approvalMs?: number; runMs?: number } = {},
  ) {
    this.abort = () => this.controller.abort();
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
    this.timeout = setTimeout(() => this.cancel(), options.runMs ?? 120000);
    this.broker = new ApprovalBroker(
      this.id,
      this.controller.signal,
      emit,
      options.approvalMs ?? 45000,
    );
  }
  cancel() {
    this.controller.abort();
  }
  async execute(input: unknown, mode: Mode, queryFactory: QueryFactory = query): Promise<Report> {
    if (this.started) throw new Error('A run cannot be reused.');
    this.started = true;
    let handle: ReturnType<QueryFactory> | undefined;
    let client: Client | undefined;
    let hosted: ReturnType<typeof createWorkshopServer> | undefined;
    const messages = new InputQueue<SDKUserMessage>();
    try {
      const config = ConfigSchema.parse(input);
      this.controller.signal.throwIfAborted();
      hosted = createWorkshopServer(this.store, this.broker, this.emit);
      this.emit({
        kind: 'host',
        title: mode === 'live' ? 'Real SDK permission run' : 'Local host policy run',
        detail:
          mode === 'live'
            ? 'A streaming-input query uses SDK permission policies.'
            : 'The host router applies allow/ask/deny and calls real MCP tools. This is not the SDK query permission engine.',
        data: { runId: this.id },
      });
      if (mode === 'local') {
        client = new Client({ name: 'lesson-5-host-router', version: '1.0.0' });
        const [a, b] = InMemoryTransport.createLinkedPair();
        await hosted.instance.connect(b);
        await client.connect(a);
        const call = async (name: string, args: Record<string, unknown>) => {
          this.controller.signal.throwIfAborted();
          const result = await client!.callTool({ name, arguments: args });
          this.emit({ kind: 'handler', title: 'Real MCP call result', detail: name, data: result });
          if (result.isError) throw new Error('The local tool reported an error.');
        };
        if (config.scenario === 'read') {
          this.emit({
            kind: 'policy',
            title: 'Host router · allow',
            detail: 'Read-only tools are pre-approved by this local router.',
          });
          await call('read_repo_note', { file: 'README.md' });
          await call('search_repo_notes', { query: 'TODO' });
        } else if (config.scenario === 'command') {
          this.emit({
            kind: 'policy',
            title: 'Host router · deny',
            detail: 'The command example is blocked before MCP dispatch.',
          });
        } else if (config.permissionMode === 'dontAsk') {
          this.emit({
            kind: 'policy',
            title: 'Host router · deny without prompting',
            detail: 'This local demonstration denies the mutation rather than opening approval.',
          });
        } else {
          this.emit({
            kind: 'policy',
            title: 'Host router · ask',
            detail:
              'The host asks before dispatching a mutating MCP call. No SDK canUseTool callback executes in local mode.',
          });
          const allow = await this.broker.request(FULL_NAME('save_review_note'), {
            title: config.title,
            body: config.body,
          });
          this.controller.signal.throwIfAborted();
          if (allow) await call('save_review_note', { title: config.title, body: config.body });
        }
        return this.report(
          config,
          mode,
          'Local policy routing completed. Inspect the handler counters and in-memory board.',
        );
      }
      await mkdir(CONFIG_DIRECTORY, { recursive: true });
      this.controller.signal.throwIfAborted();
      messages.push({
        type: 'user',
        message: { role: 'user', content: scenarioPrompt(config) },
        parent_tool_use_id: null,
        session_id: '',
        uuid: randomUUID(),
      });
      handle = queryFactory({
        prompt: messages,
        options: requestOptions(
          config,
          hosted,
          this.broker,
          this.store,
          this.controller,
          this.emit,
        ),
      });
      let report: Report | undefined;
      for await (const message of handle) {
        this.controller.signal.throwIfAborted();
        if (message.type === 'result') {
          const ok = message.subtype === 'success' && !message.is_error;
          report = this.report(
            config,
            mode,
            redact(message.subtype === 'success' ? message.result : message.errors.join('\n')),
          );
          report.sdkOk = ok;
          report.permissionDenials = message.permission_denials.length;
          report.costUsd = message.total_cost_usd;
          this.emit({
            kind: 'message',
            title: `result · ${message.subtype}`,
            detail: 'A final SDK answer is separate from whether individual tools were permitted.',
          });
          break;
        }
        const raw = message as unknown as Record<string, unknown>;
        this.emit({
          kind: 'message',
          title: `${message.type}${typeof raw.subtype === 'string' ? ' · ' + raw.subtype : ''}`,
          detail: 'Observed a typed SDK message. Full payload omitted.',
        });
      }
      if (!report) throw new Error('The SDK stream ended without a result.');
      return report;
    } finally {
      clearTimeout(this.timeout);
      this.controller.abort();
      this.signal.removeEventListener('abort', this.abort);
      this.broker.close();
      messages.close();
      try {
        handle?.close();
      } finally {
        await client?.close().catch(() => {});
        await hosted?.instance.close().catch(() => {});
        this.emit({
          kind: 'host',
          title: 'Cleanup',
          detail: 'Query, queue, MCP connection, pending approvals, grants, and timers released.',
        });
      }
    }
  }
  private report(config: Config, mode: Mode, text: string): Report {
    return {
      runId: this.id,
      mode,
      scenario: config.scenario,
      text,
      notes: structuredClone(this.store.notes),
      counters: structuredClone(this.store.counters),
      permissionDenials: 0,
    };
  }
}
