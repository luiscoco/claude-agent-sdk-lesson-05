import { ToolRun } from '../server/runner.js';
import { DEFAULT_CONFIG, type Approval } from '../shared/lesson.js';
let run: ToolRun;
run = new ToolRun((event) => {
  console.log(event.title + ': ' + event.detail);
  if (event.kind === 'approval')
    queueMicrotask(() => run.broker.decide((event.data as Approval).requestId, 'deny'));
}, new AbortController().signal);
console.log(
  'LOCAL HOST ROUTER — real MCP calls, no SDK query or model request. CLI declines any note approval.',
);
console.log(JSON.stringify(await run.execute(DEFAULT_CONFIG, 'local'), null, 2));
