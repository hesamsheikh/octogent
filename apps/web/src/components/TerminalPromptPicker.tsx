import { useCallback, useEffect, useRef, useState } from "react";

import type { PromptDetail, PromptLibraryEntry } from "../app/types";
import { apiClient } from "../runtime/apiClient";
import { buildPromptItemUrl, buildPromptsUrl } from "../runtime/runtimeEndpoints";

type TerminalPromptPickerProps = {
  isOpen: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelectPrompt: (content: string) => void;
};

export const TerminalPromptPicker = ({
  isOpen,
  anchorRef,
  onClose,
  onSelectPrompt,
}: TerminalPromptPickerProps) => {
  const [prompts, setPrompts] = useState<PromptLibraryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (!isOpen || !anchorRef.current) return;

    const rect = anchorRef.current.getBoundingClientRect();
    setStyle({
      position: "fixed",
      top: rect.bottom + 2,
      right: window.innerWidth - rect.right,
    });
  }, [isOpen, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    apiClient
      .get<{ prompts: PromptLibraryEntry[] }>(buildPromptsUrl())
      .then((data) => {
        setPrompts(data.prompts);
      })
      .catch(() => {
        // Silently fail
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose, anchorRef]);

  const handleSelectPrompt = useCallback(
    async (name: string) => {
      try {
        const data = await apiClient.get<PromptDetail>(buildPromptItemUrl(name));
        onSelectPrompt(data.content);
        onClose();
      } catch {
        // Silently fail
      }
    },
    [onSelectPrompt, onClose],
  );

  if (!isOpen) return null;

  const userPrompts = prompts.filter((p) => p.source === "user");
  const builtinPrompts = prompts.filter((p) => p.source === "builtin");

  return (
    <div className="prompt-picker-popover" ref={popoverRef} style={style}>
      <div className="prompt-picker-header">Insert Prompt</div>
      {isLoading ? (
        <div className="prompt-picker-loading">Loading...</div>
      ) : prompts.length === 0 ? (
        <div className="prompt-picker-empty">No prompts available</div>
      ) : (
        <div className="prompt-picker-list">
          {userPrompts.length > 0 && (
            <div className="prompt-picker-group">
              <div className="prompt-picker-group-label">My Prompts</div>
              {userPrompts.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="prompt-picker-item"
                  onClick={() => {
                    void handleSelectPrompt(p.name);
                  }}
                >
                  {p.name}.md
                </button>
              ))}
            </div>
          )}
          {builtinPrompts.length > 0 && (
            <div className="prompt-picker-group">
              <div className="prompt-picker-group-label">Built-in</div>
              {builtinPrompts.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="prompt-picker-item"
                  onClick={() => {
                    void handleSelectPrompt(p.name);
                  }}
                >
                  {p.name}.md
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
