# Lesson 5 classroom walkthrough

**Tools and Permissions · Claude Agent SDK TypeScript 0.3.310**

Allow 25–35 minutes. Begin in local mode, which applies the application's policy router and calls actual MCP tools without a model. Live mode exercises the real SDK permission pipeline using your own key.

## 1. Inventory tools by their effects

Open the tool/policy guide. Compare built-in file tools, search tools, Bash, and the TaskCreate/TaskUpdate/TaskGet/TaskList family. Explain why reading, mutation, execution, and task tracking need different choices.

Find the four custom tools in `src/server/tools.ts`. Identify the name, description, raw Zod input shape, handler, annotations, and MCP result envelope. SDK 0.3.310 uses positional `tool(...)` arguments.

**Check:** These are application-defined tools, not aliases that execute the SDK's built-in Read or Bash tools.

## 2. Allow read-only work

Run **Inspect without changes**. Inspect the real MCP results, read/search handler counts, zero mutations, and empty board.

With a key configured, repeat in live mode. Observe the two pre-approved read tools and zero `canUseTool` callbacks.

**Answer:** `allowedTools` can approve a call before the callback. To observe every call, use a separate observation hook; to enforce a per-call invariant, place it at a surface that actually runs for every relevant invocation.

## 3. Ask for a concrete mutation

Choose **Request one change** in `default` mode. Enter a short review note and run. Read the exact title/body in the approval desk before choosing **Approve once**.

**Evidence:** One save handler and one in-memory change. A live run also records a host permission callback. Local mode records its own router rather than a fake SDK callback. No project file is edited.

Repeat and deny. Compare the handler count and empty board. Try leaving a request for 45 seconds and inspect expiry.

**Read the code:** The returned SDK server config carries `always_ask`; the handler separately consumes a one-use, argument-matched grant. A raw MCP call does not exercise the SDK permission engine.

## 4. Deny without prompting

Choose `dontAsk` and repeat the note scenario. It must not open a prompt, call the save handler, or mutate the board.

Try **Observe a blocked tool**. Its policy is `always_deny`. Compare the zero command-handler calls with the final answer explaining the denial. The stub contains no actual shell execution implementation.

**Question:** Can a final SDK result be successful when a tool was denied? **Yes.** The agent can successfully explain the denial; that is separate from executing the tool.

## 5. Cancellation and evidence

Stop a run while approval is pending. The broker cancels outstanding requests and invalidates unused grants. A later decision cannot approve an expired or closed request.

If the client stops receiving the stream before a final report, execution counts become unknown. Explain why losing a response is not proof that no work occurred. Already completed approved changes are not rolled back by later cancellation.

Export a successful trace. Change the draft note and export again; the trace must retain the submitted note and completed run evidence rather than the new draft.

## 6. Student extension

Add a read-only `count_review_findings` tool that returns a count from the bundled notes. Give it a bounded schema, a truthful description, and a read-only annotation. Add a real MCP test proving it does not mutate the board. Decide separately whether to pre-approve it in the live query.

## Exit questions and answers

1. Built-in versus custom tool? **Runtime-supplied capability versus an application-defined handler.**
2. What defines a custom tool contract? **Name, description, schema, and async handler returning an MCP result.**
3. Where does a host decision belong? **In policy and host approval logic, including canUseTool for requests that reach it, with independent enforcement where needed.**
4. Why separate read-only and mutating operations? **Their effects differ, so their approval and execution boundaries should be explicit.**

Complete the four-question in-app quiz.
