import React from "react";
import { Text } from "ink";
import { ROLE_META, type Role } from "../types";

export function MessageHeader({ role }: { role: Role }): React.JSX.Element {
  const { label, icon, color } = ROLE_META[role];
  return (
    <Text color={color} bold>
      ● {icon} {label}
    </Text>
  );
}
