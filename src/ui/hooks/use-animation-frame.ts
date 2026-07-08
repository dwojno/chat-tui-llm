import { useEffect, useState } from "react";

export function useAnimationFrame(length: number, intervalMs: number): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % length), intervalMs);
    return () => clearInterval(id);
  }, [length, intervalMs]);
  return frame;
}
