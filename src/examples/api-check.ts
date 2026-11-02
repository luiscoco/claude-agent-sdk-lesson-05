import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { VERSION } from '../shared/lesson.js';
const directory = path.dirname(
  fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk')),
);
const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
if (pkg.version !== VERSION) throw new Error('Unexpected SDK version.');
console.log(
  'Pinned SDK ' +
    VERSION +
    '. Tool contracts, callbacks, and server policy types compile against the installed declarations.',
);
console.log(
  'SDK-server tools[] carries always_ask / always_deny. Root options.tools selects built-ins. allowedTools provides ordinary auto-approval.',
);
