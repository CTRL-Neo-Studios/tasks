import { writeFile } from "node:fs/promises";
import { defineConfig } from "tsdown";
import * as z from "zod";

export default defineConfig({
  entry: "src/index.ts",
  dts: true,
  exports: { customExports: { "./schema.json": "./dist/schema.json" } },
  hooks: {
    // Structural JSON Schema for editors (e.g. YAML language server); cross-field rules live in validate().
    "build:done": async () => {
      // Dynamic: dist/index.mjs only exists once this build finishes. Importing src statically fails because
      // native config loading can't resolve its extensionless imports. The query string skips the module cache in watch mode.
      const { documentSchema } = await import(`./dist/index.mjs?t=${Date.now()}`);
      const schema = z.toJSONSchema(documentSchema, { io: "input", unrepresentable: "any" });
      await writeFile("dist/schema.json", `${JSON.stringify(schema, null, 2)}\n`);
    },
  },
});
