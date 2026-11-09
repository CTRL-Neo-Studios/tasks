import { expect, test } from "vitest";
import { greet } from "./index";

test("greet", () => {
  expect(greet("world")).toBe("Hello, world!");
});
