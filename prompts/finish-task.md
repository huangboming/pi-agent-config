---
description: Close the current task, reconcile repository state, and preserve durable knowledge without planning the next task.
---

Close the current task without selecting or starting another task.

Success means:

- Confirm the task's completion state from available evidence; do not claim completion while a material blocker remains.
- If the current task's PR is confirmed merged, detect the repository's default branch, update it with a fast-forward-only pull, and safely remove the merged local task branch. Otherwise, do not switch or delete branches. Never guess merge state or push changes.
- Review the conversation and repository for durable knowledge. Record each fact in only its appropriate source of truth:
  - stable guidance that should travel with the repository → make the smallest useful update to `AGENTS.md`;
  - durable cross-session context that does not belong in the repository → write or update Magic Context memory;
  - behavior already expressed by code or documentation, temporary implementation details, and easy-to-rediscover facts → do not record.
- Deduplicate new knowledge and update or retire stale knowledge rather than appending contradictions. Never record credentials, account data, or other sensitive information.
- Preserve the repository's existing `AGENTS.md` tracking policy. Do not change ignore/tracking state, stage, commit, create a PR, or push knowledge updates.
- Complete only resolved todos and dismiss only notes made obsolete by this task; preserve future work.
- Report the completion status, repository actions, knowledge changes, remaining workspace changes, and blockers concisely.

Do not recommend, prioritize, select, or begin the next task.
