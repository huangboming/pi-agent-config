---
name: to-kanban-card
description: Turn a completed project discussion into a copy-ready Obsidian Kanban card title and task note with DoR and DoD. Use when the user asks to write or convert an agreed task into a Kanban card.
---

Transform the completed discussion into a Kanban card using its established decisions and evidence.

Use an outcome-focused title in the form `项目（范围）：任务结果`. State the agreed value and boundaries precisely. Express the DoD as observable completion conditions and concrete verification steps.

Return only this structure:

```text
卡片标题：
<项目（范围）：任务结果>
```

```markdown
## DoR

### 价值：为什么做

问题：<要解决的问题>

依据：<支持该判断的事实>

价值：<预期结果>

### 范围：做什么

本次做：
- <已确定的范围>

本次不做：
- <明确排除的范围>

## DoD

### 完成条件

- [ ] <可观察的完成结果>

### 验证方式

- [ ] <具体的验证方法>
```
