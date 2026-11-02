import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_ROOT = path.join(PROJECT_ROOT, 'fixtures', 'repository');
export const CONFIG_DIRECTORY = path.join(PROJECT_ROOT, '.local', 'sdk-state');
