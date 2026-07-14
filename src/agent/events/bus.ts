import type { TurnEvent } from "./events";

type Subscriber = (event: TurnEvent) => void;

export class EventBus {
  private readonly subscribers = new Set<Subscriber>();

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  emit(event: TurnEvent): void {
    for (const fn of this.subscribers) fn(event);
  }

  scoped(fork: string): EventBus {
    const child = new EventBus();
    child.subscribe((event) =>
      this.emit(event.type === "tool" || event.type === "status" ? { ...event, fork } : event),
    );
    return child;
  }
}
