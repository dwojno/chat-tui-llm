/** Generic async-generator utilities. */

/** Drive an async generator to completion and return its final (return) value. */
export async function drain<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  let step = await gen.next();
  while (!step.done) step = await gen.next();
  return step.value;
}

/** Collect every yielded value from an async generator into an array. */
export async function collect<T>(gen: AsyncGenerator<T, unknown>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}
