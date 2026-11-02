import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { FIXTURE_ROOT } from './paths.js';
import { NoteSchema } from './config.js';
import type { ApprovalBroker } from './approvals.js';
import type { Counters, Event, Note } from '../shared/lesson.js';
export interface Store {
  notes: Note[];
  counters: Counters;
}
export const createStore = (): Store => ({
  notes: [],
  counters: {
    readCalls: 0,
    searchCalls: 0,
    saveCalls: 0,
    commandCalls: 0,
    mutations: 0,
    callbackCalls: 0,
  },
});
const fileSchema = z.enum(['README.md', 'architecture.json']);
export async function readNote(file: 'README.md' | 'architecture.json') {
  const root = await realpath(FIXTURE_ROOT);
  const target = await realpath(path.join(root, file));
  if (!target.startsWith(root + path.sep)) throw new Error('The note leaves the fixed fixture.');
  const text = await readFile(target, 'utf8');
  if (text.length > 16000) throw new Error('Note too large.');
  return { file, text };
}
const envelope = (data: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  structuredContent: data,
});
export function createWorkshopServer(
  store: Store,
  broker: ApprovalBroker,
  emit: (event: Event) => void,
) {
  const hosted = createSdkMcpServer({
    name: 'tool-policy-workshop',
    version: '1.0.0',
    tools: [
      tool(
        'read_repo_note',
        'Read one bundled repository note. Only README.md and architecture.json are available.',
        { file: fileSchema },
        async ({ file }) => {
          store.counters.readCalls++;
          const note = await readNote(file);
          emit({ kind: 'handler', title: 'Read handler', detail: `Read ${file}; no mutation.` });
          return envelope(note);
        },
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
      tool(
        'search_repo_notes',
        'Search literal text in the two bundled notes. Returns matching lines without changing files.',
        { query: z.string().trim().min(1).max(60) },
        async ({ query }) => {
          store.counters.searchCalls++;
          const matches = [];
          for (const file of ['README.md', 'architecture.json'] as const) {
            const note = await readNote(file);
            for (const [line, text] of note.text.split('\n').entries())
              if (text.toLowerCase().includes(query.toLowerCase()))
                matches.push({ file, line: line + 1, text });
          }
          emit({
            kind: 'handler',
            title: 'Search handler',
            detail: `Found ${matches.length} matching lines; no mutation.`,
          });
          return envelope({ matches });
        },
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
      tool(
        'save_review_note',
        'Save one review note to this run’s in-memory board. Requires explicit one-time learner approval; never edits repository files.',
        NoteSchema.shape,
        async (input) => {
          store.counters.saveCalls++;
          if (!broker.consume(input))
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'No matching one-time approval grant. No note was saved.',
                },
              ],
              isError: true,
            };
          store.notes.push(structuredClone(input));
          store.counters.mutations++;
          emit({
            kind: 'handler',
            title: 'Note saved',
            detail: 'One approved in-memory note was added. No file was edited.',
            data: input,
          });
          return envelope({ saved: true, note: input });
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        'run_command',
        'A prohibited command example for learning denial behavior. Never executes a shell or external command.',
        { command: z.literal('show_status') },
        async () => {
          store.counters.commandCalls++;
          return {
            content: [
              { type: 'text' as const, text: 'Command execution is disabled. No command ran.' },
            ],
            isError: true,
          };
        },
        { annotations: { readOnlyHint: false, openWorldHint: false } },
      ),
    ],
  });
  // Policies belong on the returned SDK server CONFIG, not on the tool definitions above.
  return {
    ...hosted,
    tools: [
      { name: 'save_review_note', permission_policy: 'always_ask' as const },
      { name: 'run_command', permission_policy: 'always_deny' as const },
    ],
  };
}
