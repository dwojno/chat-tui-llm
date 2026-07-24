const TOOL_LABELS: Record<string, string> = {
  web_search: "Searching the web",
  delegate_task: "Delegating",
  delegate_tasks: "Delegating",
  search_knowledge_base: "Searching knowledge base",
  list_files: "Listing knowledge base files",
  grep_files: "Grepping knowledge base",
  read_source: "Reading knowledge base file",
  read_file: "Reading file",
  write_file: "Writing file",
  edit_file: "Editing file",
};

export function toolStepLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name}`;
}
