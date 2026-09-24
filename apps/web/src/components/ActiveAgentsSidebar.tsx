import { useRef } from "react";
import type { ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { useT } from "../app/providers/LocaleProvider";
import { clampSidebarWidth } from "../app/uiStateNormalizers";

type ActiveAgentsSidebarProps = {
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  actionPanel?: ReactNode;
  bodyContent?: ReactNode;
};

export const ActiveAgentsSidebar = ({
  sidebarWidth,
  onSidebarWidthChange,
  actionPanel = null,
  bodyContent,
}: ActiveAgentsSidebarProps) => {
  const t = useT();
  const sidebarRef = useRef<HTMLElement | null>(null);

  const handleResizeMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;

    const handleMouseMove = (event: MouseEvent) => {
      onSidebarWidthChange(clampSidebarWidth(event.clientX - sidebarLeft));
    };

    const stopResize = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
  };

  return (
    <div className="dashboard-deck-shell">
      <aside
        aria-label={t("web.a11y.activeAgentsSidebar")}
        className="active-agents-sidebar"
        ref={sidebarRef}
        style={{ width: `${sidebarWidth}px` }}
      >
        {actionPanel ? (
          <div className="active-agents-action-panel">{actionPanel}</div>
        ) : (
          <div className="active-agents-body">{bodyContent}</div>
        )}
        <div
          className="active-agents-border-resizer"
          data-testid="active-agents-border-resizer"
          onMouseDown={handleResizeMouseDown}
        />
      </aside>
    </div>
  );
};
