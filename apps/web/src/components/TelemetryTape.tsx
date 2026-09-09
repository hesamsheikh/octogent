import { useMemo } from "react";

import { useT } from "../app/providers/LocaleProvider";
import type { MonitorFeedSnapshot } from "../app/types";

type TelemetryTapeProps = {
  monitorFeed: MonitorFeedSnapshot | null;
};

type TelemetryItem = {
  key: string;
  sourceIcon: string;
  authorLabel: string;
  snippet: string;
  fullText: string;
  likesLabel: string;
  permalink: string | null;
};

const MAX_SNIPPET_LENGTH = 54;

const normalizePostSnippet = (value: string): string => value.replace(/\s+/g, " ").trim();

const truncateSnippet = (value: string): string => {
  if (value.length <= MAX_SNIPPET_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
};

const buildTelemetryItems = (
  monitorFeed: MonitorFeedSnapshot | null,
  t: (key: string, params?: Record<string, string | number>) => string,
): TelemetryItem[] => {
  const posts = monitorFeed?.posts ?? [];
  if (posts.length === 0) {
    const waiting = t("web.telemetry.waiting");
    return [
      {
        key: "monitor-waiting",
        sourceIcon: "𝕏",
        authorLabel: "@monitor",
        snippet: waiting,
        fullText: waiting,
        likesLabel: "♥ --",
        permalink: null,
      },
    ];
  }

  return posts.map((post) => {
    const normalizedSnippet = normalizePostSnippet(post.text);
    return {
      key: `${post.source}:${post.id}`,
      sourceIcon: "𝕏",
      authorLabel: `@${post.author}`,
      snippet: truncateSnippet(normalizedSnippet),
      fullText: normalizedSnippet,
      likesLabel: `♥ ${Math.round(post.likeCount).toLocaleString("en-US")}`,
      permalink: post.permalink,
    };
  });
};

export const TelemetryTape = ({ monitorFeed }: TelemetryTapeProps) => {
  const t = useT();
  const telemetryItems = useMemo(() => buildTelemetryItems(monitorFeed, t), [monitorFeed, t]);
  const scrollDurationSeconds = Math.max(72, telemetryItems.length * 9);

  return (
    <section className="console-telemetry-tape" aria-label={t("web.a11y.telemetryTickerTape")}>
      <div
        className="console-telemetry-track"
        style={{ animationDuration: `${scrollDurationSeconds}s` }}
      >
        {[...telemetryItems, ...telemetryItems].map((item, index) =>
          item.permalink ? (
            <a
              className="console-telemetry-item"
              href={item.permalink}
              key={`${item.key}-${index}`}
              rel="noreferrer"
              target="_blank"
              title={item.fullText}
            >
              <span aria-hidden="true" className="console-telemetry-source">
                {item.sourceIcon}
              </span>
              <strong>{item.authorLabel}</strong>
              <span className="console-telemetry-snippet">{item.snippet}</span>
              <span className="console-telemetry-likes">{item.likesLabel}</span>
            </a>
          ) : (
            <span
              className="console-telemetry-item"
              key={`${item.key}-${index}`}
              title={item.fullText}
            >
              <span aria-hidden="true" className="console-telemetry-source">
                {item.sourceIcon}
              </span>
              <strong>{item.authorLabel}</strong>
              <span className="console-telemetry-snippet">{item.snippet}</span>
              <span className="console-telemetry-likes">{item.likesLabel}</span>
            </span>
          ),
        )}
      </div>
    </section>
  );
};
