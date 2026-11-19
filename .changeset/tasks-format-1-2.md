---
"@type32/tasks": minor
---

Tasks format 1.2: a task's `color`, the built-in `assignees` field (the people are its options; iCalendar `ATTENDEE` both ways, ids kept with `X-TASKS-ID`), and a view's `zoom` (a timeline's pixels a day). A 1.1 reader keeps `color` and `zoom` as unknown keys; a document that already has a custom field named `assignees` must rename it.
