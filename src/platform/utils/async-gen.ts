export async function drain<T>(gen: AsyncGenerator<unknown, T>): Promise<T> {
  let step = await gen.next();
  while (!step.done) step = await gen.next();
  return step.value;
}
