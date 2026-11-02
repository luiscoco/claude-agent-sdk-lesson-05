import type { Options } from '@anthropic-ai/claude-agent-sdk';
/** Compile-checked inventories to discuss. The live lab does NOT execute these recipes. */
export const readonlyBuiltins: Options = {
  tools: ['Read', 'Glob', 'Grep'],
  allowedTools: ['Read', 'Glob', 'Grep'],
  permissionMode: 'dontAsk',
};
export const taskTracking: Options = {
  tools: ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList'],
  permissionMode: 'default',
};
// Adding Bash, Write or Edit expands capability; approval rules and OS boundaries need separate design.
