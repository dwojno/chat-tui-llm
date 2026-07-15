const INDENT = "  ";

function isScalar(value: unknown): boolean {
  return value === null || typeof value !== "object";
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/** Minimal YAML block serializer for the reducer's context format (no dependency). */
export function toYaml(value: unknown, indent = 0): string {
  const pad = INDENT.repeat(indent);

  if (isScalar(value)) return scalar(value);

  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((item) =>
        isScalar(item) ? `${pad}- ${scalar(item)}` : `${pad}-\n${toYaml(item, indent + 1)}`,
      )
      .join("\n");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "{}";
  return entries
    .map(([key, val]) => {
      if (isScalar(val)) return `${pad}${key}: ${scalar(val)}`;
      if (Array.isArray(val) && !val.length) return `${pad}${key}: []`;
      if (!Array.isArray(val) && !Object.keys(val as object).length) return `${pad}${key}: {}`;
      return `${pad}${key}:\n${toYaml(val, indent + 1)}`;
    })
    .join("\n");
}
