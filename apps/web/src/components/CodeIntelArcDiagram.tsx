import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CouplingData } from "../app/codeIntelAggregation";
import { heatColor } from "../app/codeIntelAggregation";
import { useT } from "../app/providers/LocaleProvider";

type CodeIntelArcDiagramProps = {
  data: CouplingData;
};

const ROW_HEIGHT = 22;
const LABEL_WIDTH = 100;
const PADDING_Y = 8;
const MAX_ARCS = 40;

const ACCENT = "#d4a017";

export const CodeIntelArcDiagram = ({ data }: CodeIntelArcDiagramProps) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 300, height: 400 });
  const [hoveredPair, setHoveredPair] = useState<string | null>(null);
  const [hoveredFile, setHoveredFile] = useState<string | null>(null);
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

  const files = useMemo(() => data.files, [data.files]);
  const pairs = useMemo(() => data.pairs.slice(0, MAX_ARCS), [data.pairs]);

  const fileIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file) continue;
      map.set(file.file, i);
    }
    return map;
  }, [files]);

  const fileCouplingMap = useMemo(() => {
    const map = new Map<string, { partner: string; coSessions: number }[]>();
    for (const p of pairs) {
      if (!map.has(p.fileA)) map.set(p.fileA, []);
      if (!map.has(p.fileB)) map.set(p.fileB, []);
      map.get(p.fileA)?.push({ partner: p.fileB, coSessions: p.coSessions });
      map.get(p.fileB)?.push({ partner: p.fileA, coSessions: p.coSessions });
    }
    for (const entries of map.values()) {
      entries.sort((a, b) => b.coSessions - a.coSessions);
    }
    return map;
  }, [pairs]);

  const dotX = LABEL_WIDTH;
  const arcAreaWidth = size.width - LABEL_WIDTH - 8;
  const minSvgHeight = PADDING_Y + files.length * ROW_HEIGHT + PADDING_Y;
  const svgHeight = Math.max(minSvgHeight, size.height);
  const dynamicRowHeight =
    files.length > 0 ? (svgHeight - PADDING_Y * 2) / files.length : ROW_HEIGHT;

  const maxCoSessions = useMemo(() => {
    let max = 0;
    for (const p of pairs) {
      if (p.coSessions > max) max = p.coSessions;
    }
    return max;
  }, [pairs]);

  const fileY = (index: number) => PADDING_Y + index * dynamicRowHeight + dynamicRowHeight / 2;

  const hoveredPairData = useMemo(() => {
    if (!hoveredPair) return null;
    return pairs.find((p) => pairKey(p.fileA, p.fileB) === hoveredPair) ?? null;
  }, [hoveredPair, pairs]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  return (
    <div className="code-intel-arc-diagram" ref={containerRef} onMouseMove={handleMouseMove}>
      <svg
        className="code-intel-arc-svg"
        width={size.width}
        height={Math.max(svgHeight, size.height)}
        viewBox={`0 0 ${size.width} ${Math.max(svgHeight, size.height)}`}
        role="img"
        aria-label={t("web.a11y.fileCouplingArcDiagram")}
      >
        {/* Arcs — curve to the right */}
        {pairs.map((pair) => {
          const idxA = fileIndexMap.get(pair.fileA);
          const idxB = fileIndexMap.get(pair.fileB);
          if (idxA === undefined || idxB === undefined) return null;

          const y1 = fileY(idxA);
          const y2 = fileY(idxB);
          const span = Math.abs(idxB - idxA);
          const curveX = dotX + Math.min(span * 16, arcAreaWidth);
          const key = pairKey(pair.fileA, pair.fileB);
          const isHovered =
            hoveredPair === key || hoveredFile === pair.fileA || hoveredFile === pair.fileB;

          const d = `M ${dotX} ${y1} C ${curveX} ${y1}, ${curveX} ${y2}, ${dotX} ${y2}`;

          return (
            <g key={key}>
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                onMouseEnter={() => setHoveredPair(key)}
                onMouseLeave={() => setHoveredPair(null)}
                style={{ cursor: "crosshair" }}
              />
              <path
                d={d}
                fill="none"
                stroke={heatColor(pair.coSessions, maxCoSessions)}
                strokeWidth={isHovered ? 1.5 : 0.75}
                strokeOpacity={isHovered ? 1 : 0.4}
                className="code-intel-arc-path"
                pointerEvents="none"
              />
            </g>
          );
        })}

        {/* File dots and labels — vertical list on the left */}
        {files.map((f, i) => {
          const y = fileY(i);
          const isHighlighted =
            hoveredFile === f.file ||
            (hoveredPair !== null &&
              pairs.some(
                (p) =>
                  pairKey(p.fileA, p.fileB) === hoveredPair &&
                  (p.fileA === f.file || p.fileB === f.file),
              ));

          const shortName = f.file.split("/").pop() ?? f.file;

          return (
            <g
              key={f.file}
              onMouseEnter={() => setHoveredFile(f.file)}
              onMouseLeave={() => setHoveredFile(null)}
              className="code-intel-arc-file-group"
            >
              <circle
                cx={dotX}
                cy={y}
                r={3.5}
                fill={ACCENT}
                fillOpacity={isHighlighted ? 1 : 0.7}
                stroke={isHighlighted ? "#fff" : "none"}
                strokeWidth={isHighlighted ? 1.5 : 0}
              />
              <text
                x={dotX - 8}
                y={y + 3.5}
                textAnchor="end"
                className={`code-intel-arc-label${isHighlighted ? " code-intel-arc-label--active" : ""}`}
              >
                {truncateLabel(shortName, LABEL_WIDTH - 12)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Edge hover tooltip */}
      {hoveredPairData && !hoveredFile && (
        <div
          className="code-intel-tooltip"
          style={{
            left: Math.min(mousePos.x + 12, size.width - 200),
            top: Math.max(mousePos.y - 40, 4),
          }}
        >
          <div className="code-intel-tooltip-path">
            {shortFileName(hoveredPairData.fileA)} ↔ {shortFileName(hoveredPairData.fileB)}
          </div>
          <div className="code-intel-tooltip-value">
            {hoveredPairData.coSessions} co-edit{hoveredPairData.coSessions !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* Node hover tooltip — to the right of the dot */}
      {hoveredFile && (
        <div
          className="code-intel-tooltip code-intel-tooltip--node"
          style={{
            left: dotX + 12,
            top: Math.max(fileY(fileIndexMap.get(hoveredFile) ?? 0) - 20, 4),
          }}
        >
          <div className="code-intel-tooltip-path">{hoveredFile}</div>
          {fileCouplingMap.has(hoveredFile) ? (
            <div className="code-intel-tooltip-coupling-list">
              {fileCouplingMap.get(hoveredFile)?.map((c) => (
                <div key={c.partner} className="code-intel-tooltip-coupling-row">
                  <span className="code-intel-tooltip-coupling-partner">
                    {shortFileName(c.partner)}
                  </span>
                  <span className="code-intel-tooltip-coupling-count">{c.coSessions}×</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="code-intel-tooltip-value">{t("web.codeIntel.noCoupling")}</div>
          )}
        </div>
      )}
    </div>
  );
};

const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

const shortFileName = (path: string): string => path.split("/").pop() ?? path;

const truncateLabel = (label: string, maxWidth: number): string => {
  const charWidth = 6.5;
  const maxChars = Math.floor(maxWidth / charWidth);
  if (label.length <= maxChars) return label;
  if (maxChars <= 3) return "";
  return `${label.slice(0, maxChars - 1)}\u2026`;
};
