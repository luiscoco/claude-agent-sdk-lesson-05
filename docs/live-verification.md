# Manual live verification

Verified on **2 November 2026**, Windows, Node.js 24, SDK **0.3.310**, using **claude-haiku-5-5** and the server-side local key. No key or raw environment values are stored here.

`npm run live:smoke -- --all` completed five real SDK queries:

| Case            | Observed execution evidence                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Read-only       | One read handler and one search handler; zero host permission callbacks and zero mutations.                  |
| Approved note   | One approval, one SDK callback, one save handler, and one in-memory note.                                    |
| Declined note   | One approval declined, one SDK callback, one permission denial, zero save-handler calls, and zero mutations. |
| `dontAsk` note  | No approval prompt or callback; one permission denial and zero save-handler calls.                           |
| Blocked command | One SDK permission denial; zero command-handler calls and no command execution.                              |

All five runs produced successful final SDK answers, including answers explaining tool denial. This confirms that query success and tool permission are separate concepts.

The SDK's expected `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning identified the two pre-approved read tools, which skip `canUseTool`.

The CLI test driver explicitly approves or declines its own bounded note requests. The application UI retains human one-time approval. Automated unit/API/browser tests do not use model credentials or make billable requests.
