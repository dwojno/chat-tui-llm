import type { TextProps } from "ink";

export type Role = "user" | "assistant";

export interface Step {
  label: string;
  detail?: string | undefined;
  fork?: string | undefined;
}

export interface Message {
  role: Role;
  content: string;
  steps?: Step[] | undefined;
}

export interface LiveTurn {
  steps: Step[];
  content: string;
  scratchpad?: { section: string; content: string }[] | undefined;
}

interface RoleMeta {
  label: string;
  icon: string;
  color: NonNullable<TextProps["color"]>;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  user: { label: "You", icon: "🧑", color: "cyan" },
  assistant: { label: "AI", icon: "🤖", color: "green" },
};
