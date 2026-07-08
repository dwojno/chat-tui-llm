import merge from "it-merge";

function fanOut<T, R>(
  generator: AsyncGenerator<T, R>,
  onReturn: (value: R) => void,
): AsyncGenerator<T, void> {
  async function* bridge() {
    let step = await generator.next();
    while (!step.done) {
      yield step.value;
      step = await generator.next();
    }
    onReturn(step.value);
  }

  return bridge();
}

export function mergeGenerators<T, R>(
  generators: AsyncGenerator<T, R>[],
): { events: AsyncIterable<T>; results: Promise<R[]> } {
  const slots: R[] = Array.from({ length: generators.length });
  let pending = generators.length;
  let resolveAll!: () => void;
  const allDone = new Promise<void>((resolve) => {
    resolveAll = resolve;
  });

  const onReturn = (index: number, value: R) => {
    slots[index] = value;
    pending -= 1;
    if (pending === 0) {
      resolveAll();
    }
  };

  const bridges = generators.map((generator, index) =>
    fanOut(generator, (value) => onReturn(index, value)),
  );

  return {
    events: merge(...bridges),
    results: pending === 0 ? Promise.resolve([]) : allDone.then(() => slots),
  };
}
