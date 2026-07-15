export async function drain<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  let step = await gen.next();
  while (!step.done) step = await gen.next();
  return step.value;
}

export async function collect<T>(gen: AsyncGenerator<T, unknown>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}
