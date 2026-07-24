export function keyMemories(memories: readonly string[]): { key: string; text: string }[] {
  return memories.map((text, index) => ({ key: `M${index + 1}`, text }));
}
