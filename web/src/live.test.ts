import { describe, expect, it, vi } from "vitest";
import { subscribeToDashboardEvents } from "./live.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (() => void)[]>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(event: string, listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  close() {
    this.closed = true;
  }
}

describe("dashboard live SSE subscription", () => {
  it("subscribes to backend SSE events, toggles live state, refreshes dynamic data, and closes cleanly", () => {
    const onLive = vi.fn();
    const onRefresh = vi.fn();
    const original = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    try {
      const close = subscribeToDashboardEvents({
        onLiveChange: onLive,
        onRefresh,
      });
      const stream = FakeEventSource.instances[0];

      expect(stream.url).toBe("/api/events/stream");
      stream.emit("connected");
      stream.emit("xp");
      stream.emit("quest.created");
      stream.emit("quest.completed");
      stream.emit("quest.updated");
      stream.emit("stats.updated");
      stream.onerror?.();
      close();

      expect(onLive).toHaveBeenNthCalledWith(1, true);
      expect(onRefresh).toHaveBeenCalledTimes(5);
      expect(onLive).toHaveBeenLastCalledWith(false);
      expect(stream.closed).toBe(true);
    } finally {
      globalThis.EventSource = original;
      FakeEventSource.instances = [];
    }
  });
});
