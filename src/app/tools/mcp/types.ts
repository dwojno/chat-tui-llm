export interface McpServerConfig {
  label: string;
  transport: "stdio" | "http";
  url?: string | null;
  command?: string | null;
  args?: string[];
  enabled: boolean;
}
