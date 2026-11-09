# ts-lib-template

TypeScript library template on the VoidZero toolchain: [tsdown](https://tsdown.dev) (build), [Vitest](https://vitest.dev) (test), [Oxlint](https://oxc.rs/docs/guide/usage/linter) + [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) (lint/format). Bun for installs and scripts, [Changesets](https://github.com/changesets/changesets) for releases. Ships ESM only.

Minimum supported TypeScript for consumers is **6.0.3** (optional `peerDependencies.typescript`, so plain-JS users aren't affected). CI typechecks against that version; bump both together.

## Use this template

1. Rename `name` in `package.json`, the title above, and the copyright holder in `LICENSE`.
2. Replace `src/index.ts`.
3. Add an `NPM_TOKEN` repo secret (or configure npm trusted publishing).

## Scripts

| Script              | Does                                       |
| ------------------- | ------------------------------------------ |
| `bun run build`     | Bundle `src/index.ts` → `dist/` + `.d.mts` |
| `bun run dev`       | Build in watch mode                        |
| `bun run test`      | Run Vitest once (`test:watch` to watch)    |
| `bun run typecheck` | `tsc --noEmit`                             |
| `bun run lint`      | Oxlint                                     |
| `bun run format`    | Oxfmt (`format:check` to verify only)      |
| `bun run check`     | lint + format:check + typecheck + test     |
| `bun run changeset` | Record a change for the next release       |

## Releasing

Run `bun run changeset` in your PR. On merge to `main`, the Release workflow opens a "Version Packages" PR; merging that publishes to npm.

`tsconfig.json` enables `isolatedDeclarations`, so exported functions need explicit return types; in exchange tsdown generates `.d.mts` via Oxc instead of the TypeScript compiler.
