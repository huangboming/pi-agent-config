---
name: delegate-to-pi
description: Delegate an approved implementation plan to an interactive Pi executor using gpt-5.6-luna at maximum reasoning.
compatibility: Requires git, tmux, Pi, and the openai-codex/gpt-5.6-luna model.
---

# Delegate to Pi

Orchestrate implementation through a bounded Pi executor while retaining responsibility for design, review, and commits.

## Success criteria

- The user approves the overall plan, each commit-stage contract, each planned review checkpoint, and each commit transition.
- Pi implements only closed contracts; the orchestrator retains investigation, design, scope, and acceptance decisions.
- Each commit stage starts from a clean committed baseline, uses a fresh Pi conversation, and ends as one coherent commit.
- A stage may contain uncommitted review checkpoints, but no later checkpoint starts while an earlier one is unresolved and no checkpoint is committed independently.
- Correction loops reuse the current stage session; the next commit stage never does.
- Pi, the orchestrator, and the user review in sequence.
- The executor never commits, pushes, changes branches, or rewrites Git history.

## Setup

Treat `references/staged-executor.md` as the single versioned executor system prompt. The launcher injects it with `--append-system-prompt`; do not install it as a skill, extension, or prompt template.

Before first use, confirm `pi --list-models gpt-5.6-luna` exposes `openai-codex/gpt-5.6-luna` with thinking support. The launcher fixes that model and `max` reasoning, disables extensions, skills, prompt templates, and project-local approval resources, and exposes only the built-in `read`, `bash`, `edit`, and `write` tools.

Pi is not sandboxed. Delegate only inside a trusted repository after explicit user approval, and never broaden the executor beyond the approved repository and operating-system temporary files.

## Boundaries

Use this workflow only after an explicit delegation request. Do not delegate investigation, root-cause analysis, architecture, product decisions, open-ended review, research, or trivial edits.

The worktree moves through explicit ownership states:

- **Executing:** Pi and the user own implementation. The orchestrator does not inspect or modify the worktree.
- **Frozen for review:** Pi has reported `ready_for_review` or `blocked` and is idle at the prompt. The user does not send new Pi input. The orchestrator may inspect the worktree and run validation, but does not modify implementation files.
- **Fixing:** After an approved correction prompt or direct user code-quality feedback, ownership returns to Pi and every earlier review result for that checkpoint is invalid.
- **Checkpoint approved:** Orchestrator and user review pass; because no commit occurs, the same idle Pi session may receive the next approved checkpoint.
- **Stage approved:** Every checkpoint and the complete stage pass orchestrator and user review; only then may the orchestrator exit Pi and commit. The next commit stage starts a fresh session from that commit.

A user report triggers review; it is not evidence that the stage passed. The user may give Pi implementation-error and code-quality feedback directly outside a frozen orchestrator review. Any change to scope, architecture, public behavior, or acceptance criteria returns to the orchestrator for discussion and a revised contract.

## Plan the work

Agree on the overall solution, invariants, final acceptance bar, and an initial commit-stage map before implementation. Use rolling-wave planning:

- Make the current commit stage precise and executable.
- Keep later commit stages provisional until the preceding stage is committed.
- Adjust later implementation details when new evidence appears.
- Reconfirm any change to approved scope, architecture, invariants, or user-visible behavior.

A **commit stage** is one coherent, reviewable commit boundary. Prefer a vertical change that leaves the repository healthy and includes its necessary implementation, tests, and directly related documentation. If the task naturally requires multiple coherent commits, split it into multiple stages before execution; each stage gets a fresh Pi conversation after the preceding commit.

A dependency or provenance boundary may be its own stage only when the approved contract explicitly identifies the temporary integration gap—for example, a reviewed source-of-truth commit before binding projection, or a clean source commit before generated archives. Such a stage must pass its declared narrow gates, must not disguise an ordinary failure as deferred work, and does not make the overall task healthy or complete. The plan must name the later stage or orchestrator-owned mechanical step that closes the gap.

A commit stage may use **review checkpoints** when an uncommitted implementation wave materially reduces rework inside that same commit. Checkpoints are not commit boundaries:

- agree on the complete stage outcome and checkpoint order before launch;
- give the executor only the current checkpoint's closed scope and stop condition;
- allow intentionally incomplete integration only while the stage worktree remains uncommitted;
- require the checkpoint's narrow validation, then review and approve it before continuing;
- preserve one Pi conversation and the original Git baseline across checkpoints and correction loops;
- require the final checkpoint to close the stage and pass its complete gates.

If the user wants to commit an approved boundary, treat the work as a completed commit stage: close its session, commit it, and launch a fresh session for the next stage. Do not keep a conversation alive across a commit boundary. Do not add checkpoints or stages for trivial sequencing or status reporting.

## Write the stage contract

Inspect the repository instructions, relevant implementation, dependencies, call sites, and test configuration before writing the contract. Specify observable outcomes and boundaries without pre-writing the patch.

Tune the contract for Luna's implementation style:

- Require a pre-edit propagation inventory covering public entry points, internal callers, runtime declarations, tests, examples, and documentation affected by the behavior.
- For lifecycle, concurrency, retry, or error-composition work, include an explicit state-transition or ownership table naming the triggering event, target result, collateral work, retained state, and later-call behavior.
- Identify compatibility-sensitive behavior outside the approved break and require it to remain unchanged.
- Require a full-tree legacy scan after implementation so old callers, aliases, sentinels, message matching, and stale documentation are not left behind.
- Distinguish production behavior evidence from test scaffolding; test-only seams do not satisfy a required production state transition.

Use this shape:

```markdown
# Context

## Repository baseline
- Repository: <absolute path>
- Branch: <branch>
- HEAD: <full commit SHA>
- Worktree: clean

## Relevant sources
- <applicable AGENTS.md and design or implementation paths>

## Approved decisions and invariants
- <facts the executor must preserve>

## Scope
- <hard component, package, or directory boundaries>

## Expected touch points
- <likely files; guidance, not an exhaustive allowlist>

## Out of scope
- <explicit exclusions and later-stage work>

# Task

## Outcome
<observable result for this stage>

## Acceptance criteria
1. <verifiable behavior or failure mode>

## Required validation
Run after the final code change:
1. `<exact command>`

# Final instruction

Based on the repository state and approved contract above, implement only this stage. If the contract cannot be satisfied within its boundaries, report `blocked` rather than changing the plan.
```

Define scope by component or domain boundary, not a strict file allowlist. Pi may touch directly necessary files inside that boundary and must report them. Crossing the boundary requires a blocker.

Give exact required validation commands. Pi may add checks but cannot replace or weaken them. Show the exact contract to the user and wait for explicit approval before launching Pi.

For a checkpointed stage, the initial contract must also state the complete stage outcome, checkpoint order, temporary integration limitations, and final gates. Each later checkpoint gets its own exact approved follow-up contract before execution.

## Start a new stage

Before launch, independently verify:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
```

A new stage requires a non-detached branch, no tracked or untracked changes, and `HEAD` equal to the approved baseline. Never stash, delete, or absorb existing changes to make the check pass.

Resolve `scripts/launch-stage.sh` relative to this skill directory. Put the approved prompt in a temporary file outside the repository, then run:

```bash
<skill-dir>/scripts/launch-stage.sh new \
  --repo <repository> \
  --session <unique-tmux-session> \
  --baseline <full-commit-sha> \
  < <temporary-prompt-file>
```

Delete the temporary prompt file immediately after the launcher returns. Record the printed Pi session ID; it is required only for abnormal-process recovery. The launcher fixes `openai-codex/gpt-5.6-luna` at `max` reasoning and applies the isolation described in Setup. Report the exact `tmux attach-session -t <session>` command, then wait for the user. Do not inspect or modify the worktree while Pi is executing.

## Review a checkpoint or stage

When the user reports that Pi has returned `ready_for_review` or `blocked` and is idle at the Pi prompt:

1. Run `scripts/inspect-stage.sh --repo <repository> --session <session> --baseline <original-full-commit-sha>`. Confirm its structural checks pass, inspect both the persisted Pi final response and pane transcript, and manually confirm the editor is idle; a terminal assistant `stopReason` alone cannot prove idleness.
2. Freeze the worktree: the user sends no Pi input while the orchestrator reviews.
3. Inspect all tracked, staged, and untracked changes against the contract.
4. Reject scope expansion, unnecessary abstractions, parallel legacy paths, and incomplete failure handling.
5. Trace every acceptance criterion through implementation and tests; inspect affected call sites and system-level impact.
6. Independently rerun every required validation command after the final modification, even when Pi reports it passed.
7. Add the smallest targeted checks needed for risks found during review.
8. Compare the completed propagation against the pre-edit inventory and inspect compatibility-sensitive behavior not intended to change.
9. Report either concrete findings or `accepted_for_user_review`.

Pi's report and successful tests are evidence, not acceptance. Any modification invalidates the current checkpoint or stage review and its validation.

When review finds an in-scope problem, show the exact correction contract to the user and wait for approval. For a checkpointed stage, use the same process for the next checkpoint contract after the current checkpoint is approved.

Long follow-up prompts must not be pasted into the Pi TUI. Blank lines in multiline `tmux load-buffer` / `paste-buffer` input can be interpreted as submissions, leaving only the first paragraph effective. Instead:

1. Write the complete approved follow-up contract to a uniquely named Markdown file in the operating-system temporary directory.
2. Confirm the existing pane is idle at the reviewed checkpoint.
3. Run `scripts/send-followup.sh --session <session> --prompt-file <absolute-path>`.
4. Keep the file until Pi has returned `ready_for_review` or `blocked`, then delete it.
5. Return the worktree to the executing state; do not inspect it until Pi stops again.

The helper sends only one literal line telling Pi to read the file completely. Do not use multiline `send-keys`, `load-buffer`, or `paste-buffer`. If input was partially submitted or garbled, stop; have the user rewind Pi to the last frozen checkpoint, confirm the pane and worktree state, then send the file instruction once. Do not layer a second correction over ambiguous TUI state.

After an intermediate checkpoint is approved, do not exit Pi or commit. Continue the same conversation and original baseline with the next approved checkpoint contract. Checkpoint approval freezes its reviewed contract and implementation for sequencing; it is not stage acceptance. Every later implementation wave invalidates stage-level review. If a later wave changes an approved checkpoint's implementation or assumptions, that checkpoint's review also becomes invalid. The final stage review covers the complete accumulated diff and reruns the complete stage gates.

If Pi exits unexpectedly before stage approval, `resume` is a recovery path only. It may preserve the stage worktree and continue the most recent conversation with:

```bash
<skill-dir>/scripts/launch-stage.sh resume \
  --repo <repository> \
  --session <unique-tmux-session> \
  --baseline <original-full-commit-sha> \
  --pi-session-id <id-printed-by-the-original-launch> \
  < <temporary-correction-prompt-file>
```

Before recovery, confirm the branch and `HEAD` still match the original baseline, the index is empty, all worktree changes belong to the stage, and no other Pi conversation has been started in that repository. Otherwise stop because the resume target or worktree ownership is ambiguous.

Repeat Pi execution and orchestrator review until the orchestrator accepts the current checkpoint or complete stage. Then ask the user to review while Pi remains idle. Direct user implementation or code-quality fixes return the worktree to execution and require a fresh orchestrator review. Do not advance a checkpoint, exit Pi, or commit until the user explicitly approves the applicable transition.

## Commit and continue

After explicit user approval in Pi, run:

```bash
<skill-dir>/scripts/finish-stage.sh --session <session>
```

The helper sends `/quit` and waits a bounded time for graceful termination. The persisted Pi session remains available for recovery or audit. If graceful termination fails, stop and report it; do not kill the process automatically. Reconfirm the branch, `HEAD`, and reviewed worktree before committing.

Use the `commit` skill to create exactly one coherent commit for the stage. If the diff is not coherent as one commit, do not commit; revisit the stage boundary. If the user committed externally, inspect the actual commit and cleanliness before treating it as the next baseline.

Verify the worktree is clean after the commit. Reassess the provisional plan against the committed result, obtain approval for the next detailed stage contract, and start a fresh Pi conversation with a unique session name and the new commit as baseline. Never use `send-followup` or `resume` across a commit boundary.

## Blockers

`ready_for_review` means only that Pi requests review. `blocked` means a required command did not run or pass, permissions or evidence are missing, or the contract cannot be satisfied in scope.

Do not discard partial work or broaden permissions automatically. Inspect the evidence and decide with the user whether to refine implementation instructions, revise the approved contract, authorize a specific operation, change models, or stop delegation.
