export const VERSION = '0.3.310';
export const SERVER_KEY = 'workshop';
export const FULL_NAME = (name: string) => `mcp__${SERVER_KEY}__${name}`;
export const TOOLS = [
  {
    name: 'read_repo_note',
    title: 'Read a repository note',
    family: 'Files',
    policy: 'allow',
    effect: 'Read one bundled fixture note.',
    schema: 'file: README.md | architecture.json',
  },
  {
    name: 'search_repo_notes',
    title: 'Search the fixture',
    family: 'Search',
    policy: 'allow',
    effect: 'Find literal text in two bundled notes.',
    schema: 'query: string (1–60 characters)',
  },
  {
    name: 'save_review_note',
    title: 'Save a review note',
    family: 'Mutation',
    policy: 'ask',
    effect: 'Add one note to this run’s in-memory review board.',
    schema: 'title: string (1–80); body: string (1–400)',
  },
  {
    name: 'run_command',
    title: 'Blocked command example',
    family: 'Commands',
    policy: 'deny',
    effect: 'Always blocked. No shell or subprocess exists in this handler.',
    schema: 'command: "show_status"',
  },
] as const;
export type Scenario = 'read' | 'note' | 'command';
export type Mode = 'local' | 'live';
export interface Config {
  scenario: Scenario;
  permissionMode: 'default' | 'dontAsk';
  title: string;
  body: string;
}
export const DEFAULT_CONFIG: Config = {
  scenario: 'read',
  permissionMode: 'default',
  title: 'Review unknown task IDs',
  body: 'Add a focused test for completing a task that does not exist.',
};
export const SCENARIOS = {
  read: {
    title: 'Inspect without changes',
    description: 'Read and search the fixture. No approval should be needed.',
  },
  note: {
    title: 'Request one change',
    description: 'Approve or deny one in-memory review note. No project file changes.',
  },
  command: {
    title: 'Observe a blocked tool',
    description: 'Request the command example and inspect the denial. Nothing executes.',
  },
} as const;
export interface Event {
  kind:
    | 'host'
    | 'message'
    | 'policy'
    | 'handler'
    | 'approval'
    | 'decision'
    | 'result'
    | 'error'
    | 'done';
  title: string;
  detail: string;
  data?: unknown;
}
export interface Note {
  title: string;
  body: string;
}
export interface Approval {
  runId: string;
  requestId: string;
  tool: string;
  input: Note;
  expiresAt: string;
}
export interface Counters {
  readCalls: number;
  searchCalls: number;
  saveCalls: number;
  commandCalls: number;
  mutations: number;
  callbackCalls: number;
}
export interface Report {
  runId: string;
  mode: Mode;
  scenario: Scenario;
  sdkOk?: boolean;
  text: string;
  notes: Note[];
  counters: Counters;
  permissionDenials: number;
  costUsd?: number;
}
export interface Metadata {
  version: string;
  liveAvailable: boolean;
  model: string;
  tools: typeof TOOLS;
  scenarios: typeof SCENARIOS;
  builtinFamilies: { family: string; names: string[] }[];
}
export const QUIZ = [
  {
    question: 'Which setting restricts available built-in tools?',
    answers: ['tools', 'allowedTools', 'A readOnlyHint annotation'],
    correct: 0,
  },
  {
    question: 'A tool matches allowedTools. Is canUseTool guaranteed to run?',
    answers: [
      'Yes, for every tool',
      'No; earlier approval can skip the callback',
      'Only when the handler fails',
    ],
    correct: 1,
  },
  {
    question: 'Where does an SDK-hosted per-tool permission_policy go?',
    answers: [
      'Inside the Zod schema',
      'In the handler result',
      'On the returned server config’s tools array',
    ],
    correct: 2,
  },
  {
    question: 'What should happen to an always_ask tool in dontAsk mode?',
    answers: [
      'It is denied without a host approval prompt',
      'It becomes always_allow',
      'The annotation approves it',
    ],
    correct: 0,
  },
] as const;
export const GUIDE = [
  {
    group: 'Built-in tool families',
    name: 'Files, search, commands, tasks',
    text: 'Read, Glob and Grep inspect a project; Write and Edit change it; Bash executes commands; TaskCreate, TaskUpdate, TaskGet and TaskList track work. This lab does not enable those built-ins.',
  },
  {
    group: 'Capability contract',
    name: 'tool(name, description, schema, handler)',
    text: 'SDK 0.3.310 uses positional arguments and a raw Zod shape. The handler returns an MCP content envelope. Schema validation and permission decisions serve different jobs.',
  },
  {
    group: 'Availability and approval',
    name: 'tools ≠ allowedTools',
    text: 'tools selects built-in availability. allowedTools auto-approves named calls. It does not remove other tools or guarantee the permission callback runs.',
  },
  {
    group: 'Host decisions',
    name: 'permissionMode / canUseTool',
    text: 'default lets permission requests reach the host. dontAsk denies requests that would prompt. This app exposes neither bypassPermissions nor acceptEdits.',
  },
  {
    group: 'SDK-hosted policies',
    name: 'always_ask / always_deny',
    text: 'Add policies to the config returned by createSdkMcpServer(). In default mode, always_ask overrides ordinary auto-allow rules. SDK-hosted always_allow is not an enforced policy in this version; use allowedTools for ordinary pre-approval.',
  },
  {
    group: 'Layered enforcement',
    name: 'Handler guards and one-use grants',
    text: 'The note handler independently requires an argument-matched one-use approval grant. MCP transport itself does not enforce SDK query policy. Even a direct call cannot save a note without a host grant.',
  },
  {
    group: 'Annotations',
    name: 'readOnlyHint is metadata',
    text: 'Annotations describe behavior to callers. They do not enforce file scope, approval, or a sandbox. This sample reads only two fixed notes and keeps all changes in memory.',
  },
  {
    group: 'Operational behavior',
    name: 'Denial, cancellation and cleanup',
    text: 'A tool denial can coexist with a successful final SDK answer explaining it. A missing result or failed stream is a separate run failure. Pending approvals expire or are cancelled with the run.',
  },
] as const;
