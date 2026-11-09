/**
 * Indices of the first cycle along `edges`, in link order (each member links to the next, the last to the first).
 * Edges to unknown ids are ignored.
 */
export function findCycle<T extends { id: string }>(
  items: readonly T[],
  edges: (item: T) => readonly string[],
): number[] | undefined {
  const index = new Map(items.map((item, i) => [item.id, i]));
  const state = new Uint8Array(items.length); // 0 unvisited, 1 on stack, 2 done
  const stack: number[] = [];
  const visit = (i: number): number[] | undefined => {
    if (state[i] === 1) return stack.slice(stack.indexOf(i));
    if (state[i] === 2) return undefined;
    state[i] = 1;
    stack.push(i);
    for (const target of edges(items[i]!)) {
      const j = index.get(target);
      const cycle = j === undefined ? undefined : visit(j);
      if (cycle) return cycle;
    }
    stack.pop();
    state[i] = 2;
    return undefined;
  };
  for (let i = 0; i < items.length; i++) {
    const cycle = visit(i);
    if (cycle) return cycle;
  }
  return undefined;
}
