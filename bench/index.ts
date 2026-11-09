// Benchmarks the built package (dist/), the code users get. Run with `bun run bench`.
// `bun run bench -- --json > bench/baseline.json` saves results to compare a future implementation against.
import { parse as parseToml } from "smol-toml";
import { Bench } from "tinybench";
import { load as loadYaml } from "js-yaml";
import {
  fromICS,
  isTaskFile,
  merge,
  occurrences,
  parse,
  parseMarkdown,
  stringify,
  type Task,
  type TaskDocument,
  toICS,
  validate,
} from "../dist/index.mjs";

const N = 1000;
const at = "2026-11-09T10:00:00Z";

/** A realistic mix: a third timed events in zones (half recurring), a third todos with values, a third all-day spans. */
function makeDoc(n: number, edit = ""): TaskDocument {
  const tasks: Task[] = [];
  for (let i = 0; i < n; i++) {
    const day = String((i % 28) + 1).padStart(2, "0");
    const base = {
      id: `task-${i}`,
      title: `Task ${i}${edit}`,
      listId: `list-${i % 10}`,
      updatedAt: at,
    };
    if (i % 3 === 0) {
      tasks.push({
        ...base,
        start: `2026-11-${day}T09:30`,
        duration: "PT45M",
        timeZone: i % 2 ? "Europe/Berlin" : "America/New_York",
        ...(i % 6 === 0 && {
          recurrence: { freq: "weekly", byDay: [{ day: "mo" }, { day: "th" }] },
        }),
        values: { location: `Room ${i % 7}` },
      });
    } else if (i % 3 === 1) {
      tasks.push({
        ...base,
        due: `2026-12-${day}`,
        notes: "Remember to attach the PDF.\nAnd ping finance.",
        ...(i > 3 && { dependsOn: [`task-${i - 3}`] }),
        values: {
          status: ["todo", "doing", "done"][i % 3]!,
          priority: "high",
          tags: ["work", `t${i % 5}`],
          estimate: i % 8,
        },
      });
    } else {
      tasks.push({
        ...base,
        start: `2026-11-${day}`,
        end: `2026-11-${day}`,
        values: { progress: i % 101 },
      });
    }
  }
  return {
    version: "1.0",
    lists: Array.from({ length: 10 }, (_, i) => ({
      id: `list-${i}`,
      title: `List ${i}`,
      color: "#3b82f6",
      updatedAt: at,
    })),
    fields: [{ id: "estimate", title: "Estimate", type: "number", min: 0, updatedAt: at }],
    tasks,
  };
}

const doc = validate(makeDoc(N));
const edited = validate({
  ...makeDoc(N, " (edited)"),
  tasks: makeDoc(N, " (edited)").tasks.map((t) => ({ ...t, updatedAt: "2026-11-09T11:00:00Z" })),
});
const text = {
  json: stringify(doc, "json"),
  yaml: stringify(doc, "yaml"),
  toml: stringify(doc, "toml"),
};
const ics = toICS(doc);
const markdown = `---\naliases: [x]\ntask:\n  id: a\n  title: A\n  due: 2026-11-12\n  values: { status: todo, tags: [a, b] }\n  updatedAt: ${at}\n---\n\n# A\n\n${"Some notes.\n".repeat(50)}`;
const note = `---\ntitle: Groceries\ntags: [food]\n---\n${"- item\n".repeat(50)}`;

const bench = new Bench({ time: 500 });
for (const format of ["json", "yaml", "toml"] as const) {
  bench.add(`parse ${format} (${N} tasks)`, () => parse(text[format], format));
}
// Raw decoders alone: what parse() costs before validation, i.e. the part a native parser would replace.
bench.add(`  decode only: JSON.parse`, () => JSON.parse(text.json));
bench.add(`  decode only: js-yaml`, () => loadYaml(text.yaml));
bench.add(`  decode only: smol-toml`, () => parseToml(text.toml));
bench.add(`validate (${N} tasks)`, () => validate(doc));
for (const format of ["json", "yaml", "toml"] as const) {
  bench.add(`stringify ${format} (${N} tasks)`, () => stringify(doc, format));
}
bench.add(`merge (${N} vs ${N}, all edited)`, () => merge(doc, edited));
bench.add(`occurrences, 1 month (${N} tasks)`, () => {
  for (const t of doc.tasks) occurrences(t, { from: "2026-11-01", to: "2026-12-01" });
});
bench.add(`occurrences, 10 years of one weekly rule`, () =>
  occurrences(doc.tasks[0]!, { from: "2026-11-01", to: "2036-11-01" }),
);
bench.add(`toICS (${N} tasks)`, () => toICS(doc));
bench.add(`fromICS (${N} tasks)`, () => fromICS(ics));
bench.add(`parseMarkdown (1 file)`, () => parseMarkdown(markdown));
bench.add(`isTaskFile (task file)`, () => isTaskFile(markdown));
bench.add(`isTaskFile (plain note)`, () => isTaskFile(note));

await bench.run();

if (process.argv.includes("--json")) {
  const results = bench.tasks.map((t) => {
    const r = t.result as
      | { latency: { mean: number; p99: number }; throughput: { mean: number } }
      | undefined;
    return {
      name: t.name.trim(),
      meanMs: r?.latency.mean,
      p99Ms: r?.latency.p99,
      opsPerSec: r?.throughput.mean,
    };
  });
  console.log(JSON.stringify({ runtime: `node ${process.version}`, tasks: N, results }, null, 2));
} else {
  console.table(bench.table());
}
