import { writeFile } from "node:fs/promises";
import { defineConfig } from "tsdown";
import * as z from "zod";
import { documentSchema } from "./src/schema.ts";

export default defineConfig({
  entry: "src/index.ts",
  dts: true,
  exports: { customExports: { "./schema.json": "./dist/schema.json" } },
  hooks: {
    // Structural JSON Schema for editors (e.g. YAML language server); cross-field rules live in validate().
    "build:done": async () => {
      const schema = z.toJSONSchema(documentSchema, { io: "input", unrepresentable: "any" });
      await writeFile("dist/schema.json", `${JSON.stringify(schema, null, 2)}\n`);
    },
  },
});
