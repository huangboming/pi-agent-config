---
name: commit
description: Create one or more git commits for the current task. Use when the user asks to commit changes, split changes into commits, or commit all changes.
---

Commit all and only the requested changes as a coherent, reviewable history.

## Success criteria

- Each commit represents one behavioral or operational change and includes its necessary tests and documentation.
- Current-task changes are committed; unrelated workspace changes remain untouched.
- Required validation passes, or any continued failure is proven unrelated and reported.
- The final report identifies the commits, validation, and remaining changes.

## Decision rules

1. Follow the repository instructions. Inspect the status, relevant diffs, untracked files, and recent commit conventions before acting.
2. A bare `commit` means only changes from the current task. `Commit all changes` expands scope to all safe workspace changes. If task ownership cannot be determined reliably, ask one focused question.
3. Split multiple concerns into coherent commits autonomously and execute them without approval. Stage explicit paths and review the staged diff before each commit; do not use broad staging such as `git add .`, `git add -A`, or `git commit -a`.
4. Preserve unrelated staged changes. If they prevent safe isolation, stop rather than disturbing the user's index. When one file cannot be separated safely, prefer a combined coherent commit over risky working-tree manipulation.
5. Include in-scope source, tests, documentation, and untracked files. Never commit credentials, account or session data, logs, databases, caches, virtual environments, or build artifacts. Stop if sensitive material is present.
6. Treat lockfiles as task evidence, not universal noise: include them for an in-scope dependency change when project policy expects it; otherwise leave them untouched.
7. Run the smallest relevant checks required by repository instructions and the affected behavior. Do not repeat a check that passed after the last related modification. Do not run the full suite by default or fix unrelated failures.
8. If the current changes cause validation to fail, stop without committing. Continue past a failure only when evidence shows it is pre-existing or unrelated, and report that evidence.
9. Prefer repository commit conventions and recent history. Otherwise use concise English Conventional Commits; add a scope only when it clarifies the boundary, and add a body only when the reason, constraint, or migration impact needs explanation.

Do not amend or rewrite commits, rebase, merge, reset, clean, push, or bypass hooks unless the user explicitly requests that specific operation. Do not expand into another Git operation merely because it would be convenient.

If no in-scope changes remain, report that and stop. After committing, verify repository status and report commit hashes and subjects, checks run or reused, and any remaining workspace changes or caveats.
