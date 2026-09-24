import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type TreemapNode,
  type TreemapRect,
  heatColor,
  layoutTreemap,
} from "../app/codeIntelAggregation";
import { useT } from "../app/providers/LocaleProvider";

type CodeIntelTreemapProps = {
  root: TreemapNode;
};

const GAP = 2;
const MIN_LABEL_WIDTH = 48;
const MIN_LABEL_HEIGHT = 18;

export const CodeIntelTreemap = ({ root }: CodeIntelTreemapProps) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [hoveredRect, setHoveredRect] = useState<TreemapRect | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const measure = useCallback(() => {
    if (containerRef.current) {
      setSize({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    }
  }, []);

  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const rects = useMemo(
    () => layoutTreemap(root, size.width, size.height),
    [root, size.width, size.height],
  );

  const maxValue = useMemo(() => {
    let max = 0;
    for (const r of rects) {
      if (r.value > max) max = r.value;
    }
    return max;
  }, [rects]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  return (
    <div className="code-intel-treemap" ref={containerRef} onMouseMove={handleMouseMove}>
      <svg
        className="code-intel-treemap-svg"
        viewBox={`0 0 ${size.width} ${size.height}`}
        width={size.width}
        height={size.height}
        role="img"
        aria-label={t("web.a11y.fileEditFrequencyTreemap")}
      >
        {rects.map((r) => {
          const gapX = GAP;
          const gapY = GAP;
          const rx = r.x + gapX / 2;
          const ry = r.y + gapY / 2;
          const rw = Math.max(r.width - gapX, 0);
          const rh = Math.max(r.height - gapY, 0);
          if (rw <= 0 || rh <= 0) return null;

          const isHovered = hoveredRect?.path === r.path;
          const showLabel = rw >= MIN_LABEL_WIDTH && rh >= MIN_LABEL_HEIGHT;

          return (
            <g
              key={r.path}
              onMouseEnter={() => setHoveredRect(r)}
              onMouseLeave={() => setHoveredRect(null)}
            >
              <rect
                x={rx}
                y={ry}
                width={rw}
                height={rh}
                rx={2}
                fill={heatColor(r.value, maxValue)}
                className="code-intel-treemap-cell"
                style={{
                  filter: isHovered ? "brightness(1.35)" : undefined,
                  stroke: isHovered ? "#d4a017" : "#0b0d10",
                  strokeWidth: isHovered ? 1.5 : 0.5,
                }}
              />
              {showLabel && (
                <text
                  x={rx + 4}
                  y={ry + 13}
                  className="code-intel-treemap-label"
                  clipPath={"inset(0 0 0 0)"}
                >
                  <tspan className="code-intel-treemap-count">{r.value}:</tspan>
                  <tspan>{truncateLabel(r.name, rw - 8 - `${r.value}:`.length * 6.5)}</tspan>
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hoveredRect && (
        <div
          className="code-intel-tooltip"
          style={{
            left: mousePos.x > size.width / 2 ? mousePos.x - 200 : mousePos.x + 12,
            top: mousePos.y > size.height / 2 ? mousePos.y - 52 : mousePos.y + 12,
          }}
        >
          <div className="code-intel-tooltip-path">{hoveredRect.path}</div>
          <div className="code-intel-tooltip-value">{hoveredRect.value} edits</div>
        </div>
      )}
    </div>
  );
};

const truncateLabel = (label: string, maxWidth: number): string => {
  const charWidth = 6.5;
  const maxChars = Math.floor(maxWidth / charWidth);
  if (label.length <= maxChars) return label;
  if (maxChars <= 3) return "";
  return `${label.slice(0, maxChars - 1)}\u2026`;
};
