---
name: design-consult
description: Consult an interactive Gemini design advisor on a digital interface using user-approved context, visual evidence, and optional disposable prototypes, then return a finalized design brief to Pi. Use only when the user explicitly asks to consult Gemini or agy for design, or invokes this skill; do not use for ordinary design discussion, product implementation, or engineering review.
compatibility: Requires tmux, agy, and the design-consultant custom agent linked under ~/.gemini/config/agents/.
---

# Design Consult

Use Gemini as an interactive product-interface design consultant while keeping product source, implementation, and engineering decisions outside the consultation.

## Success criteria

- The user approves the consultation context before agy starts.
- Gemini receives product intent and user-provided visual evidence, but no product repository or source access.
- All generated files remain in one isolated temporary design workspace.
- The user directly explores and settles the design with Gemini.
- Gemini writes the formal design brief only after the user explicitly finalizes the direction.
- Pi imports the complete brief without turning the handoff into implementation planning or design acceptance.
- The agy process exits gracefully and disposable workspace state is cleaned up after a successful handoff.

## Setup

Treat `references/design-consultant.md` as the single versioned custom-agent definition. Before first use, verify that `~/.gemini/config/agents/design-consultant/agent.md` is a symlink to that file. If the destination is missing, create its parent directory and the symlink. If it exists with different content or ownership, stop rather than overwriting it.

Confirm discovery with `agy agents`; it must list `design-consultant`. Confirm that `agy models` lists the exact default model `gemini-3.8-flash-high`. Do not silently substitute another model.

## Boundaries

Activate this workflow only after an explicit request to consult Gemini or agy on interface design. Do not invoke it for ordinary design advice that Pi can answer directly.

This workflow covers visual hierarchy, interface composition, interaction intent, responsive intent, semantic color, typography treatment, density, state expression, and related product-interface design. It does not cover production implementation, engineering architecture, code review, validation, or post-implementation acceptance.

Keep the consultation separate from `delegate-to-agy` and `delegate-to-pi`:

- Do not read or expose product source, repository paths, `AGENTS.md`, credentials, sessions, or tool configuration to Gemini.
- Do not let Gemini modify the product workspace.
- Do not convert the result into an implementation contract, invoke another skill, commit, or select follow-up work.
- A disposable HTML/CSS/JavaScript prototype is a design artifact, not product implementation.

The consultation is offline by default. External design research requires an explicit user request inside agy and normal permission review. Never bypass permissions or allow dependency or asset downloads merely because the user asks for inspiration.

## Prepare the consultation

Use Pi's own tools and judgment to understand the design subject and the real platform capabilities before drafting the consultation context. Do not send raw source files or repository paths to Gemini. Distill only product and platform facts needed for design.

Ask at most one materially blocking question at a time. Do not force the user through a generic questionnaire or fill unknowns with invented preferences.

Draft the consultation brief with this shape:

```markdown
# <Design subject> Design Consultation

## Design subject
<The interface, flow, or visual system being designed.>

## User and context
<Audience, usage setting, and supplied environment facts.>

## Priority order
1. <Primary design objective>
2. <Secondary objective or hard constraint>

## Current design surface
<What can be visually shaped, expressed without source code.>

## Desired design outcomes
- <Questions and improvements for Gemini to explore.>

## Design constraints
- <Platform, accessibility, density, brand, motion, or compatibility constraints.>

## Consultation process
- Diagnose evidence before proposing changes.
- Ask only one materially blocking question at a time.
- Present at most three genuinely distinct directions with trade-offs.
- Treat all exploration as provisional until explicit finalization.

## Prototype boundary
<Whether prototypes are useful and the limits on disposable artifacts.>

## Finalization
Write `design-brief.md` only after the user explicitly asks to finalize. Do not include implementation, validation, acceptance criteria, or next-task planning.

Begin by <the first design-oriented action, usually requesting visual evidence>.
```

The template is guidance, not a demand for empty sections. Keep the brief decision-relevant and specific to the consultation. Tell the user what visual evidence they should paste or attach after entering agy.

Show the exact consultation brief to the user and wait for explicit approval before starting agy.

## Start the consultation

Resolve `scripts/launch-consultation.sh` relative to this skill directory. Choose a unique tmux session name that matches `[A-Za-z0-9][A-Za-z0-9_-]{0,79}`.

Put the approved brief in an operating-system temporary file, then run:

```bash
<skill-dir>/scripts/launch-consultation.sh start \
  --session <unique-tmux-session> \
  < <temporary-brief-file>
```

Delete the temporary input file immediately after the launcher returns. The launcher creates the isolated workspace and defaults to the `design-consultant` agent, `gemini-3.8-flash-high`, interactive accept-edits mode, and sandboxed command execution.

Record the exact session name, workspace path, `design-brief.md` path, and prototype directory from launcher output. Report the exact `tmux attach-session -t <session>` command and remind the user to wait for the empty agy prompt before attaching the promised screenshots, recordings, or references. Explain that `Ctrl+V` or the terminal's native paste attaches clipboard media; placing the cursor after the most recent attachment and pressing Backspace/Delete removes an accidental duplicate. Warn that `Ctrl+D` may exit agy when the prompt is empty.

Do not inspect the product repository on Gemini's behalf after launch. Wait while the user and Gemini conduct the consultation directly.

## Conduct the consultation

The user may freely critique, redirect, combine, or reject design directions inside agy. Pi is not an approval gate for these design iterations.

Gemini may create files only in the isolated workspace according to its stable agent boundary. Prototypes remain provisional and disposable. The user must explicitly ask Gemini to finalize before reporting the consultation complete to Pi.

If agy exits unexpectedly, preserve the workspace and report the interruption. Do not guess which conversation to resume, start a replacement automatically, or clean up potentially useful artifacts.

## Import the handoff

When the user reports that the consultation is finalized:

1. Confirm the named tmux session still exists and agy is idle at its prompt. Ask the user not to send more input during handoff.
2. Resolve the recorded workspace physically and confirm it is under the operating-system temporary directory, has the launcher's marker, and is not a symlink alias.
3. Confirm `design-brief.md` is a nonempty regular file, not a symlink.
4. Mechanically confirm that its first line is exactly `# Design Brief` and that every `##` heading from the custom agent's final brief structure is present. This checks handoff completeness, not design quality.
5. Read the complete brief into the Pi conversation.
6. Report that the brief was imported. Do not assess its quality, rewrite it, infer engineering feasibility, or turn it into an implementation or acceptance plan.

If the brief is missing, empty, unsafe, structurally incomplete, or Gemini is still working, keep agy and the workspace intact and report the exact condition.

Do not automatically write the brief to the product repository, `AGENTS.md`, or Magic Context memory. The Pi conversation is the default handoff destination.

## Preserve requested artifacts

By default, all prototype files are disposable. If the user asks to retain an artifact, obtain an explicit destination path before exiting agy or cleaning up.

Copy only the named artifact after confirming that:

- its physical source remains inside the marked consultation workspace;
- the destination is not sensitive and will not overwrite an existing path;
- the operation does not imply adding, staging, or committing it to a product repository.

Do not decide where durable design documents belong without the user.

## Finish and clean up

After a successful brief import and any explicitly requested artifact copy, send `/exit` to the idle agy tmux pane. Wait a bounded time for the process and tmux session to end. If graceful exit fails, keep the workspace and report the blocker; do not kill the process or clean up automatically.

When the session has ended, run the launcher's guarded cleanup:

```bash
<skill-dir>/scripts/launch-consultation.sh cleanup \
  --session <tmux-session> \
  --workspace <recorded-workspace>
```

Confirm that the workspace no longer exists. Report only the imported brief, preserved artifact paths, cleanup state, and any blocker. If the final brief referenced disposable artifacts that were not preserved, explicitly report that those workspace-relative artifacts were deleted during cleanup and no longer resolve. Do not recommend or begin implementation, validation, or another task.
