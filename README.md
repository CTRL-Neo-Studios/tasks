# @type32/tasks

One file format for todos, calendar events and timelines, with a parser, validator, sync merge, recurrence expansion, iCalendar import/export and Markdown task files.

A todo, an event and a timeline bar are the same object, a **task**. Which one it is depends only on its time fields, so a todo app, a calendar and a timeline can all read the same data. Apps can define their own statuses, priorities, tags and fields, and each custom value maps to a fixed meaning (`done`, `high`, …) that other apps understand.

- **Format specification:** [SPEC.md](./SPEC.md), with every field and rule
- **Summary for AI coding assistants:** [llms.txt](./llms.txt)

```sh
npm install @type32/tasks
```

ESM only. Node ≥ 20.19, Bun, Deno, browsers.

## The format in one minute

```yaml
version: "1.0"
lists:
  - { id: work, title: Work, color: "#3b82f6", updatedAt: 2026-11-09T10:00:00Z }
tasks:
  - id: invoice # a todo: no start
    title: Ship invoice
    listId: work
    due: 2026-11-12
    values: { status: doing, priority: high, tags: [billing] }
    updatedAt: 2026-11-09T10:00:00Z
  - id: standup # an event: start + duration, repeating
    title: Standup
    start: 2026-11-10T09:30
    duration: PT15M
    timeZone: Europe/Berlin
    recurrence: { freq: weekly, byDay: [{ day: mo }, { day: we }] }
    updatedAt: 2026-11-09T10:00:00Z
  - id: launch # a timeline bar: start + end, after the invoice
    title: Launch
    start: 2026-11-16
    end: 2026-11-20
    dependsOn: [invoice]
    updatedAt: 2026-11-09T10:00:00Z
```

| A task with                | is a     | shown as                     |
| -------------------------- | -------- | ---------------------------- |
| `start` + `end`/`duration` | `span`   | calendar event, timeline bar |
| `start` only               | `moment` | milestone                    |
| no `start`                 | `todo`   | reminder, maybe with `due`   |

- **Times:** dates (`2026-11-12`) mean all-day. Date-times (`2026-11-10T09:30`) are wall-clock times in the task's `timeZone`; with no zone they float, the same time everywhere. Bookkeeping times (`updatedAt`, `completedAt`) are UTC with `Z`.
- **`values`:** everything that describes a task lives here, keyed by field id. That covers the built-in `status`, `priority`, `tags`, `progress` and `location`, plus any custom field the document defines.

## Read, validate, write

```ts
import { parse, stringify, TasksFormatError } from "@type32/tasks";

try {
  const doc = parse(text, "yaml"); // "json" | "yaml" | "toml"
  const out = stringify(doc, "json"); // validates again, then writes; unknown keys are kept
} catch (error) {
  if (!(error instanceof TasksFormatError)) throw error;
  console.error(error.message); // one "path: message" line per problem, e.g.
  // tasks.0.values.status: unknown option "shiped" for field "status"
  for (const issue of error.issues) highlight(issue.path); // ["tasks", 0, "values", "status"]
}
```

`validate(value)` checks an object you already have, for example from a database or after editing in code. Structural problems are reported first; rules that span fields (references, cycles, values) are checked once the structure is valid.

## Create and edit tasks in code

Every change needs a new `updatedAt`, which sync relies on. Use UUIDs for ids.

```ts
import { validate, type Task, type TaskDocument } from "@type32/tasks";

const now = new Date().toISOString(); // "2026-11-09T10:00:00.000Z"
const task: Task = {
  id: crypto.randomUUID(),
  title: "Call the bank",
  due: "2026-11-12",
  updatedAt: now,
};
const doc: TaskDocument = validate({ version: "1.0", tasks: [task] });

// Deleting: keep the record and mark it, so references and sync still work.
Object.assign(doc.tasks[0]!, { deletedAt: now, updatedAt: now });
```

## Statuses, priorities and custom fields

`resolveFields(doc)` returns every field, built-in and custom, with its options and their meanings. Use it to render pickers. Resolve it once and pass it to the query helpers below, which read meanings for you, custom statuses included:

```ts
import {
  blockers,
  isComplete,
  isOpen,
  isOverdue,
  priorityOf,
  resolveFields,
  statusOf,
} from "@type32/tasks";

const fields = resolveFields(doc); // once per document, not per task

statusOf(task, fields); // "todo" | "doing" | "done" | "cancelled"; a custom "shipped" mapped to done is "done"
priorityOf(task, fields); // "low" | "medium" | "high" | undefined
isComplete(task, fields); // status means done (cancelled isn't complete)
isOpen(task, fields); // not deleted, status todo or doing
isOverdue(task, fields, { timeZone: "America/New_York" }); // open and past due; all-day dues expire after their day
blockers(task, doc.tasks, fields); // unfinished tasks in dependsOn, for timelines

const inbox = doc.tasks.filter((t) => isOpen(t, fields));
```

For `isOverdue`, `now` defaults to the current time and `timeZone` to the runtime's zone. The viewer's zone decides when an all-day or floating due date has passed. A timed due on a task with a `timeZone` is read in that zone.

A document adds its own statuses, or any field, under `fields`. Each custom option maps to a built-in category, so other apps still know what it means:

```yaml
fields:
  - id: status
    options: [{ id: shipped, title: "Shipped 🚀", category: done, updatedAt: 2026-11-09T10:00:00Z }]
  - { id: estimate, title: Estimate (h), type: number, min: 0, updatedAt: 2026-11-09T10:00:00Z }
```

## Calendar views: occurrences in a range

```ts
import { occurrences } from "@type32/tasks";

// Every occurrence overlapping November, recurrence expanded, DST handled. `to` is exclusive.
for (const task of doc.tasks) {
  for (const o of occurrences(task, {
    from: "2026-11-01",
    to: "2026-12-01",
    timeZone: "America/New_York",
  })) {
    draw(task, o.start, o.end, o.due); // strings in the task's own form; `end` is inclusive for all-day tasks
  }
}
```

`timeZone` is the viewer's zone. It decides which day a zoned event falls on; floating and all-day tasks ignore it. It works for any task: one without `recurrence` has at most one occurrence. A task with no `start` and no `due` has none.

## Completing tasks

```ts
import { completeTask } from "@type32/tasks";

doc.tasks[i] = completeTask(doc.tasks[i]!, new Date().toISOString());
```

- **One-off task, or the last occurrence of a series:** `status` becomes `done` and `completedAt` is set.
- **Repeating task:** `start`, `end` and `due` move to the next occurrence, skipping excluded dates. `count` drops by the occurrences used up, and `status` and `progress` reset for the new occurrence. The series keeps its time of day through DST changes.

It returns a new task and leaves the input unchanged. `updatedAt` becomes the completion time.

## Sync between devices

```ts
import { merge } from "@type32/tasks";

const { document, repairs } = merge(local, remote); // same result on every device, whichever side runs it
save(document);
for (const r of repairs) notify(r.message); // e.g. a value dropped because its field changed type
```

- **Matching:** records (lists, tasks, custom fields, each option) match by `id`, and the later `updatedAt` wins.
- **Repairs:** two edits that are each valid can still conflict, like two devices moving tasks under each other. `merge` repairs the result so it stays valid, and lists every change in `repairs`, including what was removed.
- **Order:** record order is not synced.

## Markdown task files (Obsidian-style vaults)

A Markdown file can hold one task under `task:` in its frontmatter. The body becomes `notes`, and other frontmatter keys are kept.

```markdown
---
aliases: [invoice]
task:
  id: invoice
  title: Ship invoice
  due: 2026-11-12
  updatedAt: 2026-11-09T10:00:00Z
---

# Ship invoice

- [ ] attach PDF
```

```ts
import { isTaskFile, parseMarkdown, stringifyMarkdown, validate } from "@type32/tasks";

if (isTaskFile(text)) {
  // cheap and never throws: fine for indexing thousands of files
  const file = parseMarkdown(text); // { task, frontmatter, syntax: "yaml" | "toml" }
  file.task.title = "Ship invoice v2";
  file.task.updatedAt = new Date().toISOString();
  write(path, stringifyMarkdown(file)); // body unchanged byte for byte
}

// One file can't check references to other files; validate the vault as a whole document.
const tasks = texts.filter(isTaskFile).map((t) => parseMarkdown(t).task);
const vault = validate({ version: "1.0", lists, fields, tasks });
```

## iCalendar (.ics)

```ts
import { fromICS, toICS } from "@type32/tasks";

const { document, dropped } = fromICS(icsText); // from Google, Apple, Outlook…
for (const d of dropped) console.warn(d.path.join("."), d.message); // what couldn't be imported, and why

const ics = toICS(doc); // tasks with start and no due → VEVENT, the rest → VTODO
```

Import never guesses. Anything the format can't represent is dropped and listed, for example `BYSETPOS` rules, single changed occurrences, or Windows time zone names. Export loses lists, custom fields and unknown keys. The full mapping is in [SPEC.md](./SPEC.md#icalendar-mapping).

## Editor completion

`@type32/tasks/schema.json` is a JSON Schema for the document's structure; the cross-field rules are only checked by `validate`. In YAML files:

```yaml
# yaml-language-server: $schema=https://unpkg.com/@type32/tasks/dist/schema.json
```

## Common mistakes

- **Dates are strings.** The library never returns `Date` objects. Compare dates of the same form as strings, or use `occurrences`.
- **Forgetting `updatedAt`.** Without a newer `updatedAt`, `merge` may keep the other device's version.
- **Deleting records outright.** Set `deletedAt` instead, so references stay valid and other devices learn about the deletion.
- **A `values` key with no field definition.** That's an error, which catches typos. Define custom fields under `fields` first.
- **Off-by-one all-day ends.** A date `end` is inclusive: `start: 2026-11-10, end: 2026-11-12` is three days. iCalendar's exclusive end is handled for you.
- **`end` and `duration` together.** Use one or the other.
- **Validating one Markdown file at a time.** `parseMarkdown` only checks that file. References and values need `validate` on the combined document.
- **Writing `null` to TOML.** TOML has no `null`, so `stringify(doc, "toml")` throws if an unknown key holds one.
- **Expecting key order to survive.** Written files use a fixed key order (`id`, `updatedAt`, then the rest), so expect one-time reordering diffs.

## API

| Export                                                                    | Does                                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `parse(text, format): TaskDocument`                                       | Read and validate JSON, YAML or TOML. Throws `TasksFormatError`                                     |
| `stringify(doc, format): string`                                          | Validate, then write                                                                                |
| `validate(value): TaskDocument`                                           | Validate an object                                                                                  |
| `resolveFields(doc): Record<string, ResolvedField>`                       | Built-in and custom fields with their options and categories                                        |
| `kindOf(task): "span" \| "moment" \| "todo"`                              | How to draw a task                                                                                  |
| `statusOf`, `priorityOf`, `isComplete`, `isOpen`, `isOverdue`, `blockers` | What a task's values mean, given `resolveFields(doc)`. See "Statuses, priorities and custom fields" |
| `occurrences(task, { from, to, timeZone? }): Occurrence[]`                | Occurrences overlapping `[from, to)`                                                                |
| `completeTask(task, completedAt): Task`                                   | Mark done, or move a repeating task to its next occurrence                                          |
| `merge(a, b): { document, repairs }`                                      | Combine two copies for sync                                                                         |
| `toICS(doc): string`, `fromICS(text): { document, dropped }`              | iCalendar export and import                                                                         |
| `parseMarkdown(text): MarkdownTask`, `stringifyMarkdown(file): string`    | Markdown task files                                                                                 |
| `isTaskFile(text): boolean`                                               | Whether a Markdown file holds a task. Never throws                                                  |
| `TasksFormatError`                                                        | `.issues: { path, message }[]`; `.message` is ready to show                                         |
| `documentSchema`                                                          | The Zod schema behind `validate`                                                                    |
| `@type32/tasks/schema.json`                                               | JSON Schema of the structure                                                                        |

Every exported type and function is documented in its type declarations, so editors show the rules on hover.

## Development

| Script              | Does                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `bun run build`     | Bundle to `dist/`, with `.d.mts` and `schema.json`                      |
| `bun run test`      | Vitest once (`test:watch` to watch)                                     |
| `bun run check`     | lint + format:check + typecheck + test                                  |
| `bun run bench`     | Benchmarks the built package; add `--json` for machine-readable results |
| `bun run changeset` | Record a change for the next release                                    |

- **`conformance/`** holds cases written as data, not code, so any implementation of the format can run them. `errors.yaml` has broken inputs and the issue paths they must report; `valid.yaml` has unusual inputs and their exact result. `src/conformance.test.ts` runs them here.
- **`bench/baseline.json`** is a reference benchmark run (Node 26, Apple silicon) to compare other implementations against.

Run `bun run changeset` in your PR. On merge to `main`, the Release workflow opens a "Version Packages" PR; merging it publishes to npm. The lowest TypeScript version supported for consumers is 6.0.3, and CI typechecks against it.
