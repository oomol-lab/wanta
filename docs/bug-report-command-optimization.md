# Bug Report Command: Current-State Analysis and Optimization Plan

> Survey date: 2026-07-16
>
> Scope: Wanta's built-in `/bug-report`, OpenCode 1.17.13, and the command/Skill mechanisms of
> Claude Code, OpenCode, Cursor, and VS Code / GitHub Copilot.
>
> Implementation status: PR `#177` delivered the structured Composer command, the command chip,
> the optional note text, and the post-submit reset; the main process still uses the serialized
> `/bug-report` text as the compatibility protocol. The text below distinguishes the current
> implementation, the pre-PR baseline, and goals not yet implemented.

## 1. Conclusion

Wanta's current "bug report" **is not a Skill and never invokes a Skill**. It is an
**application built-in command**: exposed by the Wanta UI, recognized by the main process, and
driven by a turn-scoped dedicated system prompt that makes the model produce a file.

This architectural direction is sound in itself: a bug report needs deterministic triggering,
trusted Wanta runtime metadata, a controlled artifact directory, and strict tool boundaries —
responsibilities that should not be left entirely to the model's judgment about whether to load
some Skill. PR `#177` has already added structured command selection and a command chip to the
Composer, but the execution protocol and host-side state still have room for further
structuring.

1. Picking "Bug report" from a `/` menu where it is interleaved with Skills and Connections
   naturally makes users assume it is also a Skill.
2. Before PR `#177`, selecting it only left the text `/bug-report` in the input box — no command
   chip, no argument hint — so it looked like ordinary text completion; the current UI now shows
   a command chip plus an optional note input.
3. Execution produces no `skill` tool call; Wanta's existing Skill activity UI only recognizes
   `Loaded skill: ...`, so users cannot confirm from the execution details whether a
   "bug report workflow" was loaded.

The recommended approach is not "force a Skill call just to show the Skill UI" but to keep
building a **structured Wanta Command**. The "Bug icon + Bug report" chip and the Composer
command state are already in place; what remains is carrying a trusted command id through IPC,
adding host-driven execution states, and consolidating the report spec into a single, versionable
workflow definition. If cross-agent reuse is ever needed, export an Agent Skills-standard version
from that definition — but inside Wanta, the command adapter layer stays responsible for
deterministic triggering and the safety boundary.

## 2. What the Current Implementation Actually Does

### 2.1 Selection Phase

`src/routes/Chat/composer-palette-items.ts` declares "Bug report" as:

- `kind: "slash"`
- `action: "bug-report"`
- `meta: "command"`

It appears in the root `/` menu alongside Creator Skill, Skills, Connections, file selection, and
Billing. The `meta: "command"` here is only the category label on the right side of the menu; it
does not make OpenCode register or invoke a Skill.

`src/routes/Chat/useComposerPalette.ts` dispatches `select-bug-report` when the user picks the
item; `src/routes/Chat/composer-state.ts` stores the structured command state, and
`ChatComposer.tsx` renders the command chip and repurposes the input box for an optional focus
note. On submit, `composerSubmissionText()` serializes that state back into the `/bug-report`
compatibility text. Consequently the selection action does not:

- add a `ChatContextMention`;
- disguise the command as a `ContextMentionChips` entry or a Skill;
- auto-submit;
- call the OpenCode command API;
- call the OpenCode `skill` tool.

Screenshot 1 shows the pre-PR-`#177` baseline where only plain text was inserted; the current UI
uses a dedicated command chip.

### 2.2 Submission Phase

`electron/chat/node.ts` calls `parseBugReportCommand(req.text)` at the start of `sendMessage()`.
The command is only recognized when the entire message matches one of these forms:

```text
/bug-report
/bug-report <optional focus note>
```

On a successful match, the main process:

1. forces the effective mode for this turn to Build, even if the user has Plan selected;
2. creates the turn's artifact/process directories;
3. generates the dedicated system prompt with `buildBugReportSystemPrompt()`;
4. merges that prompt with team Skills, the user-selected context, the project context, and the
   permission context;
5. still sends the raw `/bug-report ...` as ordinary user text to the current OpenCode session
   via `agent.promptStreaming()`;
6. requires the model to write a single file, `wanta-bug-report.md`, based only on session
   evidence that existed before the command;
7. reuses the ordinary `ArtifactBundle` pipeline to display the report file.

So "bug report" does trigger a dedicated set of behaviors — but those behaviors come from a
**Wanta-injected system prompt**, not from any `SKILL.md`.

### 2.3 Why There Is No Skill UI

Wanta Skills have two kinds of visible evidence:

- when the user explicitly selects a Skill in the composer, the Skill enters `contextMentions`,
  is rendered as a chip by `ContextMentionChips.tsx`, and stays attached to the user message;
- when the OpenCode model calls the `skill` tool, the tool activity title looks like
  `Loaded skill: pdf`, and `tool-activity.ts` and `ToolActivityStep.tsx` classify it as Skill
  activity.

`/bug-report` takes neither Skill path, so the current UI showing a command chip and no Skill
activity is consistent with the code — not an intermittent rendering glitch.

## 3. What the Current Approach Gets Right, and Its Problems

### 3.1 What It Gets Right

The current approach carries several responsibilities that must be controlled by the host app:

- **Deterministic triggering**: once the user explicitly picks the command, nothing depends on
  the model deciding "whether some Skill should be used".
- **Trusted metadata**: Wanta version, build commit, platform, model, agent mode, and permission
  mode come from the main process instead of being guessed by the model.
- **Controlled artifact path**: the target file path is assigned by Wanta and enters the existing
  artifact lifecycle.
- **Safety boundary**: the report turn forbids investigation, retries, fixes, connectors,
  network, shell, and extra file reads; writing the target file is the only allowed action.
- **Context continuity**: the report uses the messages, tool results, errors, permissions, and
  attachment evidence already in the current OpenCode session — no need to reassemble an
  external context that could lose information.
- **Compatibility with the existing streaming and artifact pipeline**: no separate report
  renderer or side-channel session is needed.

These are all sufficient reasons to keep the "Wanta command orchestration layer".

### 3.2 Main Problems

#### P0: The Execution Protocol Still Depends on a Text Compatibility Layer

The Composer already knows the user selected `bug-report`, yet on submit the state is still
serialized into `req.text`, which the main process then parses back out. The current structured
state fixes the interaction semantics of the selection phase, but the command id does not yet
flow through IPC and history-message metadata; any future change to the command value or its
localized display text still requires carefully maintaining the compatibility parser.

#### P0: No Execution Observability

There is no user-facing state for "bug report command recognized / collecting context / report
generated / report generation failed". If the model ends up not writing the file, the user can
only infer that indirectly from an ordinary assistant reply or a missing artifact.

#### P1: The Workflow Spec Is Hardcoded in TypeScript Strings

The template is testable, but it is inconvenient to reuse, version, review, or export to other
agents. It also cannot take advantage of Skill capabilities such as supporting files, examples,
templates, and validation scripts.

#### P1: The Body Submitted to the Model Is Still `/bug-report ...`

The real behavioral contract lives in the hidden system prompt, while the user message only keeps
the command literal. Looking back at history, users can see that they typed a command but not
whether Wanta recognized it as a structured command; later diagnostics also lack an explicit
command id/version.

#### P2: The Forced Build Is Under-Explained in the UI

The backend correctly forces Build so the artifact can be written, but if the user had Plan
selected at the time, the UI does not explain that "this turn uses a restricted Build solely to
generate the report". Users may mistakenly conclude that Plan permissions are being bypassed
unconditionally.

## 4. How Other Agents Do It

The industry has no uniform rule that "every slash command must be a Skill". Mainstream products
roughly split into three layers:

| Mechanism                    | Typical use                                                                             | Depends on the model            | Typical products                                                |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------- |
| Built-in control command     | Switching sessions, permissions, models, undo, share, configuration UI                  | No — host executes directly     | Claude Code `/help`, OpenCode `/undo`, `/share`                 |
| Prompt command / prompt file | Manually triggering a reusable prompt workflow once                                     | Model runs the workflow         | OpenCode custom commands, Cursor commands, VS Code prompt files |
| Agent Skill                  | Reusable knowledge, procedures, scripts, and resources — user-invokable or model-loaded | Usually model-loaded & executed | Claude Code Skills, OpenCode Skills, GitHub Copilot Skills      |

### 4.1 OpenCode

OpenCode keeps commands and Skills separate:

- [Commands](https://opencode.ai/docs/commands/) are repeatable prompt templates that can
  configure template, agent, model, and subtask, and are run via `/name`.
- [Agent Skills](https://opencode.ai/docs/skills/) are defined in `SKILL.md`; the agent first
  sees the name and description and loads the full content on demand through the native `skill`
  tool.

The SDK Wanta pins to, 1.17.13, also exposes both a `/command` listing endpoint and a
`/session/{id}/command` execution endpoint; the current `/bug-report` uses neither, going through
`/session/{id}/prompt_async` plus a custom system prompt instead.

So by OpenCode's own taxonomy, the current feature is closer to "a prompt command implemented by
Wanta itself" — not a Skill.

### 4.2 Claude Code

Claude Code has merged custom commands into Skills: both `.claude/commands/deploy.md` and
`.claude/skills/deploy/SKILL.md` produce `/deploy`, but the official recommendation is the Skill,
because it can additionally carry supporting files, invocation control, dynamic context, and
subagent configuration. Users can invoke `/skill-name` directly, and the model can also
auto-load it based on the description; `disable-model-invocation: true` restricts it to
user-triggered only. See [Claude Code Skills](https://code.claude.com/docs/en/slash-commands).

This shows that "appears in the slash menu" alone proves nothing about host command vs Skill;
Claude Code chose to make the two converge in the UI while distinguishing them by type,
configuration, and execution record.

### 4.3 Cursor

Cursor's [Commands](https://docs.cursor.com/en/agent/chat/commands) are plain Markdown workflows
in `.cursor/commands/*.md`. They are discovered and run after typing `/`; they are essentially
reusable prompts that neither require a Skill to exist nor imply one was invoked.

### 4.4 VS Code / GitHub Copilot

VS Code's [Prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files)
are explicitly also called slash commands: the user manually invokes a `.prompt.md`, which can
specify agent, model, and tools. Skills can appear in the same `/` menu.

GitHub Copilot CLI, meanwhile, explicitly distinguishes custom instructions, Skills, custom
agents, and commands; its
[customization comparison](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features)
recommends Skills when you need scenario-based loading, consistent output formats, and repeatable
procedures, while allowing a Skill to be invoked manually via a slash command. Its CLI reference
also describes command files as a simplified alternative to Skills.

### 4.5 What This Means for Wanta

Mainstream practice supports the current "command triggers a prompt workflow" technical
direction; the flaw is not "it wasn't built as a Skill" but that Wanta still lacks clear product
semantics and execution observability.

At the same time, the trend across Claude Code, VS Code, and Copilot shows users will
increasingly read `/` as a unified capability entry, not a strict type entry. Wanta should
therefore let Commands, Skills, Context, and UI actions coexist — but after selection, each must
use distinct structured UI and execution states to make clear what it actually does.

## 5. Option Comparison

### Option A: Keep the Status Quo, Change Only the Copy

Approach: rename the menu item to "Generate bug report (command)" and make the description
stress "selecting inserts a command; sending generates a Markdown file".

Pros: minimal change.

Cons: still depends on text parsing, still no command chip or execution state, and it cannot
answer the core question "did it actually take effect".

Verdict: acceptable only as a temporary stopgap, not as the final design.

### Option B: Convert to a Pure Skill

Approach: add `wanta-bug-report/SKILL.md`; selecting it adds a Skill chip, then the model calls
the `skill` tool and generates the report.

Pros: the Skill identity matches the existing UI; the workflow is easy to reuse; it can carry
templates and examples.

Cons: if the model still decides whether to call it, determinism is lost; a Skill cannot
trustworthily assign Wanta artifact paths or provide main-process runtime metadata; tool
restrictions and the forced Build still need host orchestration; and faking a skill call just to
show UI would mislead users.

Verdict: not recommended as a standalone option.

### Option C: Adopt OpenCode Native Custom Commands

Approach: register a `bug-report` command in the OpenCode configuration and execute it via the
SDK's `session.command()`.

Pros: better fits OpenCode's command abstraction; may yield a `command.executed` event;
separates the template from business code.

Cons: Wanta currently depends on `promptAsync` for streaming, cancellation, permissions, team
context, and per-turn system merging; SDK 1.17.13's command endpoint returns a complete assistant
message, and whether the existing SSE and artifact lifecycle can be fully preserved needs a real
test. Dynamic artifact paths, trusted metadata, and hidden arguments also need a security design.

Verdict: worth a compatibility spike, but must not replace the current path without runtime
verification.

### Option D: Structured Wanta Command + Single Workflow Definition (Recommended)

Approach: the Wanta UI and IPC use a structured command id; the main process stays responsible
for deterministic execution, safety policy, runtime metadata, and artifact paths; the report spec
moves into a single, versionable, testable definition. If the OpenCode native command API passes
the spike, it becomes the underlying executor; otherwise keep the current system injection, but
stop relying on text recognition as the primary path.

Pros: solves the user-trust problem; keeps the existing safety and artifact capabilities; does
not masquerade as a Skill; leaves room to export a standard Skill later.

Cons: requires extending composer state, chat IPC, message metadata, and execution UI.

Verdict: recommended.

## 6. Recommended Target Interaction

### 6.1 After Selection

After the user picks "Bug report" from the `/` menu:

- no longer leave `/bug-report` followed by a space in the input box as plain text;
- show a compact `Bug icon + Bug report` chip above the input box, without an extra "command"
  prefix;
- change the input box placeholder to "Add anything you want the report to focus on (optional)";
- make the chip removable; removing it restores ordinary input;
- add no extra visible "command" label, to keep this lightweight entry from looking complicated.

This should be visually akin to the Skill chip, but express the specific action through the Bug
icon and the "Bug report" name — no Skill badge, and no claim that a Skill was loaded.

### 6.2 After Sending

The user message displays:

```text
[Bug icon · Bug report]
Focus on the mismatch between authorization state and the actual UI (optional note)
```

Do not display only `/bug-report`. History should persist structured command metadata so the
turn's type can still be confirmed when looking back.

### 6.3 During Execution

Show a deterministic command step in the assistant activity area:

- `Collecting problem evidence from the current task…`
- `Generating bug report…`
- success: `Bug report generated`
- failure: `Bug report generation failed`, with a short actionable reason

If no Skill is invoked underneath, never display "Loaded bug report Skill". Execution details may
show the command id, workflow version, Wanta version, and whether a restricted Build was used —
but not the report body or sensitive context.

### 6.4 After Completion

Keep using the existing single-file artifact card to display `wanta-bug-report.md`. The assistant
body should only give a short status, avoiding duplication with the report body. If the target
file is missing, a failure state must be shown — never declare success solely because the model
said "generated".

## 7. Data and Architecture Design

### 7.1 Composer State

Add a command-selection state independent of `contextMentions`, for example:

```ts
type ChatComposerCommand = {
  id: "bug-report"
  label: string
}
```

A command is not context and must not be mixed into `ChatContextMention`. In the first phase,
allow only one command per turn to avoid unclear multi-command composition semantics.

### 7.2 IPC Request

Add a trusted enum field to `SendMessageRequest`:

```ts
command?: {
  id: "bug-report"
}
```

`text` carries only the optional focus note. The main process treats `command.id` as
authoritative and no longer uses a text regex as the primary path.

For keyboard users and old history, keep accepting the literal `/bug-report ...`: the main
process normalizes it into the same structured command immediately after parsing; an unknown
`/...` must never silently impersonate a known command.

### 7.3 Message Metadata

Add command display metadata to the user message — e.g. command id, localized label snapshot,
workflow version. This field enters chat history and the optimistic message and renders as the
Command chip.

Never use the localized label as an execution basis; execution uses only the stable id.

### 7.4 Executor

Abstract `resolveChatCommand()` and `buildChatCommandExecution()`, returning:

- forced mode;
- artifact file contract;
- controlled system/workflow prompt;
- runtime metadata;
- tool policy;
- user-visible status key;
- workflow version.

Implement only `bug-report` at first, but avoid piling further command branches into
`sendMessage()`.

### 7.5 Workflow Definition

Migrate the report structure, fact/assumption rules, privacy rules, and output acceptance
criteria from the long TypeScript array into a single workflow resource. Candidate forms, in
priority order:

1. a Wanta built-in, versioned Markdown prompt template;
2. once the spike proves it viable, registration as an OpenCode custom command template;
3. if cross-agent distribution is ever needed, an Agent Skills-standard `SKILL.md` wrapper layer.

Dynamic trusted paths, runtime metadata, and the turn's permission policy remain injected by the
TypeScript envelope — they must never go into parameters the user or the model can override.

### 7.6 Observability

Add diagnostics that never contain the report body:

- `chat command selected` (recorded only when renderer-local debugging needs it);
- `chat command recognized`;
- `chat command submitted`;
- `chat command artifact verified`;
- `chat command failed`.

Fields are limited to command id, workflow version, session/message id, mode, duration, file
existence, and a standard error classification. Never log the focus note, the report body,
tokens, cookies, account data, or team-private data.

## 8. Development Plan

### Phase 0: OpenCode 1.17.13 Command Spike

Goal: decide whether the underlying execution stays on `promptAsync + system` or migrates to
`session.command()`.

1. Create a non-committed smoke script under `.wanta-dev/` that registers a minimal custom
   command.
2. Verify whether `session.command()`:
   - produces SSE message/tool/permission events identical to `promptAsync`;
   - supports cancellation and the generation watchdog;
   - supports specifying the Build agent, model, and arguments;
   - can merge with Wanta's per-turn team, project, permission, and artifact system context;
   - does not block the RPC until the full reply completes;
   - preserves the user-visible command message and produces a recognizable command event.
3. Record the results: if any key invariant fails, this round of optimization keeps the existing
   `promptAsync` without blocking the P0 UX work.

Acceptance: a one-page spike conclusion with reproducible commands; behavior of the pinned
version must never be inferred solely from the latest OpenCode docs.

### Phase 1: Structured Command State and Compatibility Parsing (P0)

Status: PR `#177` delivered the Composer command state, the selection action, and the
text-compatibility serialization; the structured IPC command id, history-message metadata, and
explicit unknown-command errors are not yet done.

1. Extend composer state with a single command selection.
2. Selecting "Bug report" sets the command instead of inserting plain text.
3. Extend `SendMessageRequest` and optimistic message metadata.
4. The main process recognizes by structured id; keep the `/bug-report` text compatibility entry
   and normalize it into the same path.
5. Split command parsing and execution planning out of `sendMessage()` into pure-function
   modules.
6. Unknown or malformed explicit commands produce a clear error instead of silently being
   treated as ordinary messages.

Acceptance: UI selection and hand-typed `/bug-report` end up in the same command execution;
editing the optional note does not break the command identity.

### Phase 2: Command UI and History Presentation (P0)

Status: PR `#177` delivered the command chip, the removal behavior, the post-submit reset, and
the note text itself (the draft is serialized into `/bug-report` as the optional note); the
optional-note placeholder was never implemented — after selecting the command the input box still
shows the generic placeholder, not the §6.1 hint — and user-message command metadata, host-driven
execution states, and the Plan-mode explanation are also not yet done.

1. Add the bug report chip, showing only the Bug icon and "Bug report".
2. Add the optional-note placeholder and the removal behavior.
3. Render command metadata in the user message bubble.
4. Add in-progress, success, and failure states; states are driven by host events, never guessed
   from model prose.
5. When triggered under Plan, explain that this turn uses "a restricted Build, solely to write
   the report file".
6. Localize the menu meta labels `command/context/skill/ui` in the Chinese UI to reduce type
   confusion.

Acceptance: the UI alone answers "what did I select, did it take effect, what is it doing now,
did it succeed".

### Phase 3: Single Workflow Definition (P1)

1. Migrate the static report spec into a Markdown template.
2. TypeScript injects only the trusted runtime envelope, the target path, and the safety policy.
3. Add a workflow version, written into the report's environment section and diagnostics.
4. Add template structure tests, privacy-rule tests, and snapshot/fixture tests.
5. Based on the Phase 0 result, decide whether the template is carried by the Wanta prompt
   executor or the OpenCode native command executor.

Acceptance: report sections and rules have exactly one authoritative source; template changes can
be reviewed and tested independently.

### Phase 4: Result Verification and Failure Recovery (P1)

1. On completion, the main process verifies the target file exists, is a regular file, sits
   under the turn's artifact root, and is UTF-8 readable and non-empty.
2. Optionally add minimal structural validation: title and key sections present; on failure,
   mark "report incomplete" rather than success.
3. The failure UI offers "retry report generation"; a retry still uses only the existing context
   and never investigates or fixes the original problem.
4. Ensure that when the model verbally claims success but the file is missing, the host's final
   state is still failure.

Acceptance: the artifact is the authority on success; model prose is not.

### Phase 5: Optional Cross-Agent Skill (P2)

Execute only if agents outside Wanta genuinely need to reuse the report workflow:

1. Generate or wrap `wanta-bug-report/SKILL.md` from the same workflow spec.
2. The Skill owns the report method, template, and privacy rules — never faking Wanta runtime
   metadata or the artifact path.
3. The Wanta command explicitly calls an internal adapter; show Skill activity only if a Skill
   is actually invoked underneath.
4. Run minimal compatibility tests against Claude Code, OpenCode, and Copilot.

Acceptance: the Skill and the Wanta command never duplicate the spec; every UI accurately
reflects the real invocation path.

## 9. Test Plan

### 9.1 Pure Functions and IPC

- the structured `bug-report` command parses correctly;
- the text `/bug-report` is accepted for compatibility and normalized;
- `/bug-report-other`, a mid-message `/bug-report`, and unknown commands never falsely trigger;
- the command and the optional note stay separated;
- forced Build, the artifact root, and the prompt runtime metadata stay consistent;
- command metadata round-trips through message history;
- a command is never mis-stored as a Skill context mention.

### 9.2 UI

- after menu selection the Command chip is shown, not plain `/bug-report` text;
- the Command chip and the Skill chip are distinguishable by icon, type, and accessible name;
- removal, re-selection, sending, stopping, failure, and retry states behave correctly;
- user message history correctly displays the command and the note;
- the Plan scenario shows the restricted-Build explanation;
- all Chinese and English meta labels are localized.

### 9.3 Safety and Artifacts

- the report workflow cannot call connectors, web, shell, or read extra files;
- only the target file may be written; escape paths are rejected;
- runtime metadata is host-provided;
- the focus note cannot override the system contract;
- secrets, cookies, tokens, authorization codes, and non-essential account information never
  enter the report;
- missing file, empty file, directory, symlink, escape path, non-UTF-8, and incomplete structure
  each produce a clear failure or warning.

### 9.4 Full Verification

Run per the repo discipline:

```bash
npm run ts-check
npm run lint
npm run format
npm test
npm run dev
```

Runtime verification must capture at least the following evidence:

1. a composer screenshot after selecting the command;
2. screenshots of the user message and the in-progress state after sending;
3. a screenshot of the successful artifact card;
4. a failure screenshot with a simulated missing file;
5. redacted diagnostics records from command recognized → artifact verified.

## 10. Definition of Done

The optimization is done only when all of the following hold:

- users no longer need to guess "is the bug report a Skill";
- the UI clearly calls it a Command and keeps the same identity through selection, execution,
  and history;
- users can confirm the command was recognized by Wanta, not merely that text was inserted;
- the structured command id is the primary execution entry; the text regex exists only for
  compatibility;
- the report is still based on session evidence that predates the command — no extra
  investigation, retries, or fixes;
- the report artifact shows success only after host verification;
- if no Skill is actually invoked, no UI or log ever claims one was;
- the report workflow has exactly one authoritative definition;
- `ts-check`, `lint`, `format`, and `test` are all green, and the UI is verified live via
  `npm run dev`.

## 11. Final Product Judgment

The current implementation can be summarized as: **the capability is real, the type is Command,
no Skill is invoked, and user feedback is insufficient.**

It does not need to be wholesale rebuilt as a Skill just to fit an abstraction. The more solid
product design is:

```text
Slash menu entry
  → structured Wanta Command (deterministic, trusted metadata, safety policy, status UI)
    → versionable report workflow (prompt template; exportable as a Skill when needed)
      → current OpenCode session
        → host-verified wanta-bug-report.md artifact
```

This layering matches what most agent products do with command/prompt workflows, preserves the
value of Skills for cross-agent reuse, supporting files, and on-demand loading — and never
misleads users with a Skill invocation that does not exist.
