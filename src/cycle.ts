/**
 * Indices of the first cycle along `edges`, in link order (each member links to the next, the last to the first).
 * Edges to unknown ids are ignored. Iterative, so chains of any length don't overflow the call stack.
 */
export function findCycle<T extends { id: string }>(
  items: readonly T[],
  edges: (item: T) => readonly string[],
): number[] | undefined {
  const index = new Map(items.map((item, i) => [item.id, i]));
  const state = new Uint8Array(items.length); // 0 unvisited, 1 on the current path, 2 done
  const path: number[] = [];
  const targets: (readonly string[])[] = [];
  const next: number[] = []; // per path entry: position in its targets
  const enter = (i: number): void => {
    state[i] = 1;
    path.push(i);
    targets.push(edges(items[i]!));
    next.push(0);
  };
  for (let root = 0; root < items.length; root++) {
    if (state[root] !== 0) continue;
    enter(root);
    while (path.length > 0) {
      const top = path.length - 1;
      const position = next[top]!;
      if (position === targets[top]!.length) {
        state[path.pop()!] = 2;
        targets.pop();
        next.pop();
        continue;
      }
      next[top] = position + 1;
      const j = index.get(targets[top]![position]!);
      if (j === undefined || state[j] === 2) continue;
      if (state[j] === 1) return path.slice(path.indexOf(j));
      enter(j);
    }
  }
  return undefined;
}
