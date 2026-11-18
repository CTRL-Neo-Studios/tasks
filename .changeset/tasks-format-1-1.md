---
"@type32/tasks": minor
---

Tasks format 1.1: `views` (saved lists, boards, calendars and timelines, synced and merged like lists) with `viewTasks()` to filter and sort a view's tasks, and a task's `starred`. A 1.0 reader keeps both as unknown keys. YAML is now written with `js-yaml` (same output, about 2.7x faster); `yaml` is no longer a dependency.
