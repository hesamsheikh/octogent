import { useEffect, useRef } from "react";

const INITIAL_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 15_000;

type ReconnectingSocketOptions = {
  buildUrl: () => string;
  onMessage: (data: string) => void;
  /** Called when a dropped connection comes back, to resync missed state. */
  onReconnect?: () => void;
};

/**
 * Keeps a WebSocket subscription alive across server restarts. A plain
 * `new WebSocket` dies silently when the API restarts, freezing every live
 * view until the operator reloads the page; this reconnects with backoff and
 * lets the caller resync whatever events were missed while disconnected.
 */
export const useReconnectingSocket = ({
  buildUrl,
  onMessage,
  onReconnect,
}: ReconnectingSocketOptions) => {
  // Latest callbacks live in refs so the socket survives re-renders instead of
  // reconnecting whenever a handler identity changes.
  const buildUrlRef = useRef(buildUrl);
  const onMessageRef = useRef(onMessage);
  const onReconnectRef = useRef(onReconnect);
  buildUrlRef.current = buildUrl;
  onMessageRef.current = onMessage;
  onReconnectRef.current = onReconnect;

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let retryDelayMs = INITIAL_RETRY_DELAY_MS;
    let hasDroppedConnection = false;

    const connect = () => {
      if (disposed) {
        return;
      }
      socket = new WebSocket(buildUrlRef.current());
      socket.addEventListener("open", () => {
        retryDelayMs = INITIAL_RETRY_DELAY_MS;
        if (hasDroppedConnection) {
          onReconnectRef.current?.();
        }
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          onMessageRef.current(event.data);
        }
      });
      socket.addEventListener("close", () => {
        if (disposed) {
          return;
        }
        hasDroppedConnection = true;
        retryTimer = window.setTimeout(connect, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
      });
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      socket?.close();
    };
  }, []);
};
