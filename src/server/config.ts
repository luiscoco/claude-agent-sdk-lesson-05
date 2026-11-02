import { z } from 'zod';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { CONFIG_DIRECTORY } from './paths.js';
export const NoteSchema = z.strictObject({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(400),
});
export const ConfigSchema = z.strictObject({
  scenario: z.enum(['read', 'note', 'command']),
  permissionMode: z.enum(['default', 'dontAsk']),
  title: NoteSchema.shape.title,
  body: NoteSchema.shape.body,
});
export function childEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NonNullable<Options['env']> {
  const allowed = [
    'PATH',
    'Path',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'OS',
    'SystemDrive',
    'CLAUDE_CODE_GIT_BASH_PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
    'ANTHROPIC_API_KEY',
  ];
  const env: Record<string, string> = {};
  for (const key of allowed) if (source[key]) env[key] = source[key]!;
  return { ...env, CLAUDE_CONFIG_DIR: CONFIG_DIRECTORY };
}
export const redact = (text: string) => text.replace(/sk-ant-[\w-]+/g, '[redacted]').slice(0, 5000);
