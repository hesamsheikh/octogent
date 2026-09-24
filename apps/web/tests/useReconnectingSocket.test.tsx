import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReconnectingSocket } from "../src/app/hooks/useReconnectingSocket";

type Listener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  closedByClient = false;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push(listener);
    this.listeners.set(type, bucket);
  }

  emit(type: string, event: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  close() {
    this.closedByClient = true;
  }
}

const Harness = ({
  onMessage,
  onReconnect,
}: {
  onMessage: (data: string) => void;
  onReconnect?: () => void;
}) => {
  useReconnectingSocket({
    buildUrl: () => "ws://test/events",
    onMessage,
    ...(onReconnect ? { onReconnect } : {}),
  });
  return null;
};

const instanceAt = (index: number): FakeWebSocket => {
  const instance = FakeWebSocket.instances[index];
  if (!instance) {
    throw new Error(`no FakeWebSocket at index ${index}`);
  }
  return instance;
};

describe("useReconnectingSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("forwards string messages to the handler", () => {
    const onMessage = vi.fn();
    render(<Harness onMessage={onMessage} />);

    const socket = instanceAt(0);
    socket.emit("open");
    socket.emit("message", { data: '{"type":"deck-changed"}' });
    socket.emit("message", { data: new ArrayBuffer(4) });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith('{"type":"deck-changed"}');
  });

  it("reconnects after a dropped connection and resyncs", () => {
    const onReconnect = vi.fn();
    render(<Harness onMessage={vi.fn()} onReconnect={onReconnect} />);

    const first = instanceAt(0);
    first.emit("open");
    first.emit("close");
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(onReconnect).not.toHaveBeenCalled();

    instanceAt(1).emit("open");
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps retrying with backoff while the server stays down", () => {
    render(<Harness onMessage={vi.fn()} />);

    instanceAt(0).emit("close");
    vi.advanceTimersByTime(1_000);
    instanceAt(1).emit("close");
    vi.advanceTimersByTime(1_999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("does not reconnect after unmount", () => {
    const view = render(<Harness onMessage={vi.fn()} />);

    const socket = instanceAt(0);
    view.unmount();
    expect(socket.closedByClient).toBe(true);
    socket.emit("close");
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
