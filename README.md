# @type32/tasks

One format for todos, calendar events and timelines. Each one is a **task**; its kind depends only on which time fields it has. The format lets apps define their own statuses, priorities, tags and fields while keeping a fixed meaning other apps can rely on. See [SPEC.md](./SPEC.md).

```ts
import { kindOf, parse, resolveFields, stringify } from "@type32/tasks";

const doc = parse(text, "json"); // throws TasksFormatError with each problem's path
const fields = resolveFields(doc); // built-in fields merged with the document's own
for (const task of doc.tasks) {
  const status = fields.status!.options.find((o) => o.id === task.values?.status);
  console.log(kindOf(task), task.title, status?.category ?? "todo");
}
const out = stringify(doc, "json"); // validates first; unknown keys survive
```

| Export                                           | Does                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `parse(text, format)`                            | `"json"`, `"yaml"` or `"toml"` text → validated `TaskDocument`                                                   |
| `stringify(doc, format)`                         | Validated `TaskDocument` → text. YAML is quoted so YAML 1.1 readers agree                                        |
| `validate(value)`                                | Checks an already-parsed object                                                                                  |
| `resolveFields(doc)`                             | Built-in and custom fields with their options                                                                    |
| `kindOf(task)`                                   | `"span"`, `"moment"` or `"todo"`                                                                                 |
| `merge(a, b)`                                    | Combines two copies for sync: `{ document, repairs }`. See SPEC "Merging"                                        |
| `occurrences(task, range)`                       | A task's occurrences overlapping `[from, to)`, with recurrence expanded and DST handled                          |
| `toICS(doc)`, `fromICS(text)`                    | iCalendar export and import. Import returns `{ document, dropped }`. See SPEC "iCalendar mapping"                |
| `parseMarkdown(text)`, `stringifyMarkdown(file)` | A Markdown file holding one task in its frontmatter `task:`; the body is `notes`. See SPEC "Markdown task files" |
| `isTaskFile(text)`                               | Whether a Markdown file holds a task. Reads only the frontmatter and never throws; for indexing                  |
| `documentSchema`                                 | The Zod schema (cross-field rules included)                                                                      |
| `@type32/tasks/schema.json`                      | JSON Schema for editor completion (structure only)                                                               |

For YAML editor completion, add `# yaml-language-server: $schema=https://unpkg.com/@type32/tasks/dist/schema.json` to the top of the file.

A folder of Markdown task files becomes one document by combining the tasks with your lists and fields, then validating:

```ts
const tasks = texts.filter(isTaskFile).map((text) => parseMarkdown(text).task);
const doc = validate({ version: "1.0", lists, fields, tasks }); // checks references and values across files
```

Requires Node ≥ 20.19 or any modern runtime. ESM only.

## Development

| Script              | Does                                               |
| ------------------- | -------------------------------------------------- |
| `bun run build`     | Bundle to `dist/`, with `.d.mts` and `schema.json` |
| `bun run test`      | Vitest once (`test:watch` to watch)                |
| `bun run check`     | lint + format:check + typecheck + test             |
| `bun run changeset` | Record a change for the next release               |

Run `bun run changeset` in your PR. On merge to `main`, the Release workflow opens a "Version Packages" PR; merging it publishes to npm. The lowest TypeScript version supported for consumers is 6.0.3, and CI typechecks against it.
