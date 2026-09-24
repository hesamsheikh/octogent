import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "../app/providers/LocaleProvider";

import { FileText, X } from "lucide-react";
import { buildTerminalSocketUrl } from "../runtime/runtimeEndpoints";
import { type AgentRuntimeState, AgentStateBadge, isAgentRuntimeState } from "./AgentStateBadge";
import { TerminalPromptPicker } from "./TerminalPromptPicker";
import { replayTerminalHistory } from "./terminalReplay";
import { wheelDeltaToScrollLines } from "./terminalWheel";

import "xterm/css/xterm.css";

type TerminalProps = {
  terminalId: string;
  terminalLabel?: string;
  layoutVersion?: string | number;
  isSelected?: boolean;
  initialPrompt?: string;
  hidePromptPicker?: boolean;
  onSelectTerminal?: (terminalId: string) => void;
  onAgentRuntimeStateChange?: (state: AgentRuntimeState) => void;
  onTerminalRenamed?: ((terminalId: string, tentacleName: string) => void) | undefined;
  onTerminalActivity?: ((terminalId: string) => void) | undefined;
};

type TerminalStateMessage = {
  type: "state";
  state: AgentRuntimeState;
};

type TerminalOutputMessage = {
  type: "output";
  data: string;
};

type TerminalHistoryMessage = {
  type: "history";
  data: string;
};

type TerminalRenameMessage = {
  type: "rename";
  tentacleName: string;
};

type TerminalActivityMessage = {
  type: "activity";
};

type TerminalServerMessage =
  | TerminalStateMessage
  | TerminalOutputMessage
  | TerminalHistoryMessage
  | TerminalRenameMessage
  | TerminalActivityMessage;

const PromptInjectIcon = () => (
  <svg
    aria-hidden="true"
    className="terminal-inject-icon"
    viewBox="0 0 16 16"
    width="14"
    height="14"
  >
    <path d="M2 3h12v1H2V3Zm0 3h8v1H2V6Zm0 3h6v1H2V9Zm9 0l3 2.5L11 14v-5Z" fill="currentColor" />
  </svg>
);

export const Terminal = ({
  terminalId,
  terminalLabel,
  layoutVersion,
  isSelected,
  initialPrompt,
  hidePromptPicker,
  onSelectTerminal,
  onAgentRuntimeStateChange,
  onTerminalRenamed,
  onTerminalActivity,
}: TerminalProps) => {
  const t = useT();
  const socketRef = useRef<WebSocket | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [connectionState, setConnectionState] = useState("connecting");
  const [agentState, setAgentRuntimeState] = useState<AgentRuntimeState>("idle");
  const [isPromptBannerDismissed, setIsPromptBannerDismissed] = useState(false);
  const [isPromptPickerOpen, setIsPromptPickerOpen] = useState(false);
  const promptPickerBtnRef = useRef<HTMLButtonElement | null>(null);
  const terminalRef = useRef<{
    write: (value: string, callback?: () => void) => void;
    scrollLines: (lineCount: number) => void;
    clear: () => void;
    reset: () => void;
    clearSelection?: () => void;
    refresh?: (start: number, end: number) => void;
    cols: number;
    rows: number;
  } | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const requestResizeSyncRef = useRef<() => void>(() => {});
  const onTerminalActivityRef = useRef(onTerminalActivity);
  const onTerminalRenamedRef = useRef(onTerminalRenamed);
  const rawTitle = terminalLabel && terminalLabel.length > 0 ? terminalLabel : terminalId;
  const terminalTitle = rawTitle.length > 24 ? `${rawTitle.slice(0, 24)}...` : rawTitle;

  onTerminalActivityRef.current = onTerminalActivity;
  onTerminalRenamedRef.current = onTerminalRenamed;

  useEffect(() => {
    onAgentRuntimeStateChange?.(agentState);
  }, [agentState, onAgentRuntimeStateChange]);

  const handlePromptPickerSelect = useCallback((content: string) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "input", data: content }));
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;
    let requestResizeSync = () => {};
    requestResizeSyncRef.current = () => {};
    let cleanupTerminal = () => {};
    let activeTerminal: {
      write: (value: string, callback?: () => void) => void;
      scrollLines: (lineCount: number) => void;
      clear: () => void;
      reset: () => void;
      clearSelection?: () => void;
      refresh?: (start: number, end: number) => void;
      rows: number;
    } | null = null;
    let pendingHistoryData: string | null = null;
    const pendingOutputChunks: string[] = [];

    const connect = () => {
      const nextSocket = new WebSocket(buildTerminalSocketUrl(terminalId));
      socket = nextSocket;
      setConnectionState("connecting");

      nextSocket.addEventListener("open", () => {
        if (isCancelled || socket !== nextSocket) {
          return;
        }
        socketRef.current = nextSocket;
        setConnectionState("connected");
        requestResizeSync();
      });

      nextSocket.addEventListener("close", () => {
        if (isCancelled || socket !== nextSocket) {
          return;
        }
        socketRef.current = null;
        setConnectionState("closed");
        reconnectTimer = window.setTimeout(() => {
          connect();
        }, 900);
      });

      nextSocket.addEventListener("error", () => {
        if (isCancelled || socket !== nextSocket) {
          return;
        }
        setConnectionState("error");
      });

      nextSocket.addEventListener("message", (event) => {
        if (isCancelled || socket !== nextSocket) {
          return;
        }

        if (typeof event.data !== "string") {
          return;
        }

        try {
          const payload = JSON.parse(event.data) as TerminalServerMessage;
          if (payload.type === "history" && typeof payload.data === "string") {
            if (activeTerminal) {
              const viewport =
                containerRef.current?.querySelector<HTMLElement>(".xterm-viewport") ?? null;
              replayTerminalHistory(activeTerminal, payload.data, viewport);
              return;
            }

            pendingHistoryData = payload.data;
            pendingOutputChunks.length = 0;
            return;
          }

          if (payload.type === "output" && typeof payload.data === "string") {
            if (activeTerminal) {
              activeTerminal.write(payload.data);
              return;
            }

            pendingOutputChunks.push(payload.data);
            return;
          }

          if (payload.type === "state" && isAgentRuntimeState(payload.state)) {
            setAgentRuntimeState(payload.state);
            return;
          }

          if (payload.type === "rename" && typeof payload.tentacleName === "string") {
            onTerminalRenamedRef.current?.(terminalId, payload.tentacleName);
            return;
          }

          if (payload.type === "activity") {
            onTerminalActivityRef.current?.(terminalId);
            return;
          }
        } catch {
          if (activeTerminal) {
            activeTerminal.write(event.data);
            return;
          }

          pendingOutputChunks.push(event.data);
        }
      });
    };

    connect();

    if (import.meta.env.MODE === "test") {
      return () => {
        isCancelled = true;
        if (reconnectTimer !== null) {
          window.clearTimeout(reconnectTimer);
        }
        socket?.close();
      };
    }

    void (async () => {
      if (!containerRef.current) {
        return;
      }

      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import("xterm"),
          import("@xterm/addon-fit"),
        ]);

        if (isCancelled || !containerRef.current) {
          return;
        }

        const rootFontSize = Number.parseFloat(
          window.getComputedStyle(document.documentElement).fontSize,
        );
        const terminalFontSize = Number.isFinite(rootFontSize)
          ? Math.max(13, Math.round(rootFontSize * 0.82))
          : 13;
        const terminalBackground =
          window
            .getComputedStyle(document.documentElement)
            .getPropertyValue("--terminal-bg")
            .trim() || "#101722";

        const terminal = new Terminal({
          cursorBlink: true,
          cursorInactiveStyle: "bar",
          cursorStyle: "bar",
          cursorWidth: 2,
          fontFamily: '"JetBrains Mono", "IBM Plex Mono", monospace',
          fontSize: terminalFontSize,
          theme: {
            background: terminalBackground,
            foreground: "#f0f0f0",
            cursor: "#faa32c",
            cursorAccent: terminalBackground,
          },
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(containerRef.current);
        fitAddon.fit();
        terminal.focus();

        try {
          const { Unicode11Addon } = await import("xterm-addon-unicode11");
          const unicode11Addon = new Unicode11Addon();
          terminal.loadAddon(unicode11Addon);
          terminal.unicode.activeVersion = "11";
        } catch {
          // Non-critical: terminal works without unicode11, just with less accurate character widths
        }
        activeTerminal = terminal;

        if (pendingHistoryData !== null) {
          replayTerminalHistory(terminal, pendingHistoryData, null);
          pendingHistoryData = null;
        }
        if (pendingOutputChunks.length > 0) {
          for (const chunk of pendingOutputChunks) {
            terminal.write(chunk);
          }
          pendingOutputChunks.length = 0;
        }

        const wheelListenerTarget = containerRef.current;
        const viewportWheelTarget =
          wheelListenerTarget.querySelector<HTMLElement>(".xterm-viewport") ?? wheelListenerTarget;
        const onPointerDown = () => {
          terminal.focus();
        };
        const onWheel = (event: WheelEvent) => {
          const lines = wheelDeltaToScrollLines(event.deltaY, event.deltaMode);
          if (lines === 0) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          terminal.scrollLines(lines);
        };
        wheelListenerTarget.addEventListener("pointerdown", onPointerDown, {
          capture: true,
        });
        viewportWheelTarget.addEventListener("wheel", onWheel, {
          passive: false,
        });

        let resizeDebounceTimer: number | null = null;
        let lastSentCols = -1;
        let lastSentRows = -1;

        const sendResize = () => {
          if (!socket || socket.readyState !== 1) {
            return;
          }

          if (terminal.cols === lastSentCols && terminal.rows === lastSentRows) {
            return;
          }

          socket.send(
            JSON.stringify({
              type: "resize",
              cols: terminal.cols,
              rows: terminal.rows,
            }),
          );
          lastSentCols = terminal.cols;
          lastSentRows = terminal.rows;
        };

        const scheduleResizeSync = () => {
          if (resizeDebounceTimer !== null) {
            window.clearTimeout(resizeDebounceTimer);
          }
          resizeDebounceTimer = window.setTimeout(() => {
            resizeDebounceTimer = null;
            sendResize();
          }, 60);
        };
        requestResizeSync = scheduleResizeSync;
        requestResizeSyncRef.current = scheduleResizeSync;

        const onDataDisposable = terminal.onData((data) => {
          if (!socket || socket.readyState !== 1) {
            return;
          }

          socket.send(
            JSON.stringify({
              type: "input",
              data,
            }),
          );
        });

        let observer: ResizeObserver | null = null;
        if ("ResizeObserver" in window) {
          observer = new ResizeObserver(() => {
            fitAddon.fit();
            scheduleResizeSync();
          });
          observer.observe(containerRef.current);
        }

        scheduleResizeSync();
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        cleanupTerminal = () => {
          wheelListenerTarget.removeEventListener("pointerdown", onPointerDown, true);
          viewportWheelTarget.removeEventListener("wheel", onWheel);
          if (resizeDebounceTimer !== null) {
            window.clearTimeout(resizeDebounceTimer);
          }
          observer?.disconnect();
          onDataDisposable.dispose();
          terminal.dispose();
          terminalRef.current = null;
          fitAddonRef.current = null;
          requestResizeSyncRef.current = () => {};
        };
      } catch {
        setConnectionState("fallback");
      }
    })();

    return () => {
      isCancelled = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      requestResizeSync = () => {};
      requestResizeSyncRef.current = () => {};
      cleanupTerminal();
      socket?.close();
    };
  }, [terminalId]);

  useEffect(() => {
    if (layoutVersion === undefined) {
      return;
    }

    const activeTerminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!activeTerminal || !fitAddon) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      fitAddon.fit();
      requestResizeSyncRef.current();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [layoutVersion]);

  return (
    <div
      className={`terminal-pane${isSelected ? " terminal-pane--selected" : ""}`}
      data-selected={isSelected ? "true" : "false"}
      onFocusCapture={() => {
        onSelectTerminal?.(terminalId);
      }}
      onPointerDownCapture={() => {
        onSelectTerminal?.(terminalId);
      }}
    >
      <div className="terminal-header" data-connection-state={connectionState}>
        <span className="terminal-title">{terminalTitle}</span>
        {initialPrompt && !isPromptBannerDismissed && (
          <div className="terminal-prompt-banner">
            <button
              type="button"
              className="terminal-prompt-banner-inject"
              onClick={() => {
                const ws = socketRef.current;
                if (ws && ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: "input", data: initialPrompt }));
                }
                setIsPromptBannerDismissed(true);
              }}
              title={initialPrompt}
            >
              <PromptInjectIcon />
              <span className="terminal-prompt-banner-text">
                {initialPrompt.length > 60 ? `${initialPrompt.slice(0, 60)}...` : initialPrompt}
              </span>
            </button>
            <button
              type="button"
              className="terminal-prompt-banner-close"
              aria-label={t("web.terminal.dismissPrompt")}
              onClick={() => {
                setIsPromptBannerDismissed(true);
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="terminal-header-actions">
          {!hidePromptPicker && (
            <div className="terminal-prompt-picker-anchor">
              <button
                ref={promptPickerBtnRef}
                type="button"
                className="terminal-prompt-picker-btn"
                title={t("web.terminal.insertPrompt")}
                aria-label={t("web.terminal.insertPrompt")}
                onClick={() => {
                  setIsPromptPickerOpen((prev) => !prev);
                }}
              >
                <FileText size={13} />
                <span className="terminal-prompt-picker-label">{t("web.terminal.prompts")}</span>
              </button>
              <TerminalPromptPicker
                isOpen={isPromptPickerOpen}
                anchorRef={promptPickerBtnRef}
                onClose={() => {
                  setIsPromptPickerOpen(false);
                }}
                onSelectPrompt={handlePromptPickerSelect}
              />
            </div>
          )}
          <AgentStateBadge state={agentState} />
        </div>
      </div>
      <div
        ref={containerRef}
        className="terminal-mount"
        data-testid={`terminal-${terminalId}`}
        aria-label={`Terminal ${terminalId}`}
      />
    </div>
  );
};
