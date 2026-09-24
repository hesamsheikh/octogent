import { useEffect, useMemo, useState } from "react";

import { formatTimestamp } from "../app/formatTimestamp";
import type {
  MonitorConfigPatchRequest,
  UseMonitorRuntimeResult,
} from "../app/hooks/useMonitorRuntime";
import { useT } from "../app/providers/LocaleProvider";
import { ActionButton } from "./ui/ActionButton";

type MonitorPrimaryViewProps = {
  monitorRuntime: Pick<
    UseMonitorRuntimeResult,
    | "monitorConfig"
    | "monitorFeed"
    | "monitorError"
    | "isRefreshingMonitorFeed"
    | "isSavingMonitorConfig"
    | "refreshMonitorFeed"
    | "patchMonitorConfig"
  >;
};

type MonitorSubtabId = "resources" | "configure";
type MonitorProviderId = "x";

const normalizeTerms = (terms: string[]): string[] => {
  const split = terms.map((term) => term.trim()).filter((term) => term.length > 0);
  return [...new Set(split)];
};

export const MonitorPrimaryView = ({ monitorRuntime }: MonitorPrimaryViewProps) => {
  const {
    monitorConfig,
    monitorFeed,
    monitorError,
    isRefreshingMonitorFeed,
    isSavingMonitorConfig,
    refreshMonitorFeed,
    patchMonitorConfig,
  } = monitorRuntime;

  const t = useT();

  const MONITOR_PROVIDER_TABS: Array<{
    id: MonitorProviderId;
    label: string;
    icon: string;
  }> = [{ id: "x", label: t("web.monitor.tab.x"), icon: "𝕏" }];

  const MONITOR_SUBTABS: Array<{ id: MonitorSubtabId; label: string }> = [
    { id: "resources", label: t("web.monitor.tab.resources") },
    { id: "configure", label: t("web.monitor.tab.configure") },
  ];
  const MONITOR_SEARCH_WINDOW_OPTIONS: Array<{ value: 7 | 3 | 1; label: string }> = [
    { value: 7, label: t("web.monitor.search.7d") },
    { value: 3, label: t("web.monitor.search.3d") },
    { value: 1, label: t("web.monitor.search.1d") },
  ];

  const onRefresh = () => {
    void refreshMonitorFeed(true);
  };
  const onSyncFeed = () => {
    void refreshMonitorFeed(false);
  };
  const onPatchConfig = patchMonitorConfig as (
    patch: MonitorConfigPatchRequest,
  ) => Promise<boolean>;
  const activeProviderId: MonitorProviderId = "x";
  const [activeSubtab, setActiveSubtab] = useState<MonitorSubtabId>("resources");
  const [queryTermsDraft, setQueryTermsDraft] = useState<string[]>([]);
  const [queryTermInput, setQueryTermInput] = useState("");
  const [maxPostsDraft, setMaxPostsDraft] = useState("30");
  const [searchWindowDaysDraft, setSearchWindowDaysDraft] = useState<7 | 3 | 1>(7);
  const [bearerToken, setBearerToken] = useState("");

  useEffect(() => {
    if (!monitorConfig) {
      return;
    }

    setQueryTermsDraft(normalizeTerms(monitorConfig.queryTerms));
    setMaxPostsDraft(String(monitorConfig.refreshPolicy.maxPosts));
    setSearchWindowDaysDraft(monitorConfig.refreshPolicy.searchWindowDays);
  }, [monitorConfig]);

  const usageCapLabel = useMemo(() => {
    if (!monitorFeed?.usage?.cap && monitorFeed?.usage?.cap !== 0) {
      return "--";
    }

    return Math.round(monitorFeed.usage.cap).toLocaleString("en-US");
  }, [monitorFeed]);

  const usageUsedLabel = useMemo(() => {
    if (!monitorFeed?.usage?.used && monitorFeed?.usage?.used !== 0) {
      return "--";
    }

    return Math.round(monitorFeed.usage.used).toLocaleString("en-US");
  }, [monitorFeed]);

  const usageRemainingLabel = useMemo(() => {
    if (!monitorFeed?.usage?.remaining && monitorFeed?.usage?.remaining !== 0) {
      return "--";
    }

    return Math.round(monitorFeed.usage.remaining).toLocaleString("en-US");
  }, [monitorFeed]);
  const resourceRollItems = useMemo(
    () => [
      `${t("web.monitor.stats.lastSync")} ${formatTimestamp(monitorFeed?.lastFetchedAt ?? null)}`,
      `${t("web.monitor.stats.staleAfter")} ${formatTimestamp(monitorFeed?.staleAfter ?? null)}`,
      `${t("web.monitor.stats.usageCap")} ${usageCapLabel}`,
      `Used ${usageUsedLabel}`,
      `Remaining ${usageRemainingLabel}`,
      `Window ${searchWindowDaysDraft}D`,
      `Resets ${formatTimestamp(monitorFeed?.usage?.resetAt ?? null)}`,
    ],
    [monitorFeed, searchWindowDaysDraft, usageCapLabel, usageRemainingLabel, usageUsedLabel, t],
  );

  const credentialsSummary = monitorConfig?.providers.x.credentials;
  const parsedMaxPosts = /^[1-9]\d*$/.test(maxPostsDraft.trim())
    ? Number.parseInt(maxPostsDraft.trim(), 10)
    : null;
  const currentConfiguredTerms = monitorConfig?.queryTerms ?? [];
  const nextTermsForSave = normalizeTerms(
    queryTermsDraft.length > 0 ? queryTermsDraft : currentConfiguredTerms,
  );
  const hasCredentialInput = bearerToken.trim().length > 0;
  const canSaveConfig =
    parsedMaxPosts !== null && (nextTermsForSave.length > 0 || hasCredentialInput);
  const configuredMaxPosts =
    monitorFeed?.refreshPolicy.maxPosts ?? monitorConfig?.refreshPolicy.maxPosts ?? 30;

  const appendQueryTerm = (raw: string) => {
    const nextTerms = normalizeTerms(raw.split(/[\n,]/));
    if (nextTerms.length === 0) {
      return;
    }

    setQueryTermsDraft((current) => normalizeTerms([...current, ...nextTerms]));
    setQueryTermInput("");
  };

  const removeQueryTerm = (termToRemove: string) => {
    setQueryTermsDraft((current) => current.filter((term) => term !== termToRemove));
  };

  const saveMonitorSettings = () => {
    if (parsedMaxPosts === null) {
      return;
    }

    const patchCredentials: {
      bearerToken?: string;
    } = {};
    if (hasCredentialInput) {
      patchCredentials.bearerToken = bearerToken.trim();
    }
    const hasCredentialPatch = Object.keys(patchCredentials).length > 0;
    const patchPayload = {
      providerId: "x" as const,
      validateCredentials: false,
      ...(nextTermsForSave.length > 0 ? { queryTerms: nextTermsForSave } : {}),
      refreshPolicy: {
        maxPosts: parsedMaxPosts,
        searchWindowDays: searchWindowDaysDraft,
      },
      ...(hasCredentialPatch ? { credentials: patchCredentials } : {}),
    };

    void onPatchConfig(patchPayload).then((saved) => {
      if (!saved) {
        return;
      }

      setBearerToken("");
      onSyncFeed();
    });
  };

  return (
    <section className="monitor-view" aria-label={t("web.a11y.monitorView")}>
      <header className="monitor-header">
        <div className="monitor-header-top">
          <div className="monitor-header-main">
            <nav className="monitor-provider-tabs" aria-label={t("web.a11y.monitorProviders")}>
              {MONITOR_PROVIDER_TABS.map((provider) => (
                <button
                  aria-current={activeProviderId === provider.id ? "page" : undefined}
                  className="monitor-provider-tab"
                  data-active={activeProviderId === provider.id ? "true" : "false"}
                  key={provider.id}
                  type="button"
                >
                  <span aria-hidden="true" className="monitor-provider-tab-icon">
                    {provider.icon}
                  </span>
                  <span>{provider.label}</span>
                </button>
              ))}
            </nav>

            <nav className="monitor-subtabs" aria-label={t("web.a11y.monitorSubtabs")}>
              {MONITOR_SUBTABS.map((subtab) => (
                <button
                  aria-current={activeSubtab === subtab.id ? "page" : undefined}
                  className="monitor-subtab"
                  data-active={activeSubtab === subtab.id ? "true" : "false"}
                  key={subtab.id}
                  onClick={() => {
                    setActiveSubtab(subtab.id);
                  }}
                  type="button"
                >
                  {subtab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="monitor-header-actions">
            <span
              className="console-status-pill"
              data-state={monitorFeed?.isStale ? "stale" : "fresh"}
            >
              {monitorFeed?.isStale ? t("web.monitor.status.stale") : t("web.monitor.status.fresh")}
            </span>
            <ActionButton
              aria-label={t("web.a11y.refreshMonitorFeed")}
              className="monitor-refresh"
              disabled={isRefreshingMonitorFeed}
              onClick={onRefresh}
              size="dense"
              variant="accent"
            >
              {isRefreshingMonitorFeed
                ? t("web.monitor.button.refreshing")
                : t("web.monitor.button.refresh")}
            </ActionButton>
          </div>
        </div>

        {activeSubtab === "resources" && (
          <div className="monitor-header-roll" aria-label={t("web.a11y.monitorRollingStats")}>
            <div className="monitor-header-roll-track">
              {resourceRollItems.map((item) => (
                <span key={`primary-${item}`}>{item}</span>
              ))}
              {resourceRollItems.map((item) => (
                <span key={`echo-${item}`}>{item}</span>
              ))}
            </div>
          </div>
        )}
      </header>

      {activeSubtab === "configure" ? (
        <section className="monitor-configure" aria-label={t("web.a11y.monitorConfiguration")}>
          <section
            className="monitor-panel monitor-panel--configure"
            aria-label={t("web.a11y.monitorConfigurationPanel")}
          >
            <h3>{t("web.monitor.setup.title")}</h3>
            <div className="monitor-config-summary" aria-label={t("web.a11y.monitorSetupSummary")}>
              <span className="monitor-config-chip">
                {t("web.monitor.summary.terms", { count: nextTermsForSave.length })}
              </span>
              <span className="monitor-config-chip">
                {t("web.monitor.summary.window", { days: searchWindowDaysDraft })}
              </span>
              <span className="monitor-config-chip">
                {t("web.monitor.summary.max", { count: parsedMaxPosts ?? 0 })}
              </span>
            </div>

            {monitorError ? <p className="monitor-error">{monitorError}</p> : null}
            {monitorFeed?.lastError ? (
              <p className="monitor-error">{monitorFeed.lastError}</p>
            ) : null}

            <div className="monitor-config-layout">
              <div className="monitor-config-column">
                <div className="monitor-config-section">
                  <label htmlFor="monitor-x-bearer-token">
                    {t("web.monitor.setup.bearerToken")}
                  </label>
                  <input
                    id="monitor-x-bearer-token"
                    autoComplete="off"
                    className="monitor-input"
                    onChange={(event) => {
                      setBearerToken(event.target.value);
                    }}
                    placeholder={
                      credentialsSummary?.isConfigured
                        ? t("web.monitor.setup.tokenSaved")
                        : t("web.monitor.setup.tokenPlaceholder")
                    }
                    type="password"
                    value={bearerToken}
                  />
                  {credentialsSummary && (
                    <output className="monitor-credentials-meta" aria-live="polite">
                      {credentialsSummary.isConfigured ? (
                        <span className="monitor-state-badge monitor-state-badge--saved">
                          {t("web.monitor.status.saved")}
                        </span>
                      ) : (
                        <span>{t("web.monitor.status.notConfigured")}</span>
                      )}
                    </output>
                  )}
                </div>

                <div className="monitor-config-section">
                  <p className="monitor-section-label">{t("web.monitor.setup.targetTerms")}</p>
                  <ul
                    className="monitor-query-terms-list"
                    aria-label={t("web.a11y.monitorQueryTerms")}
                  >
                    {queryTermsDraft.map((term) => (
                      <li className="monitor-query-term" key={term}>
                        <span>{term}</span>
                        <button
                          aria-label={`Remove query term ${term}`}
                          onClick={() => {
                            removeQueryTerm(term);
                          }}
                          type="button"
                        >
                          {t("web.monitor.term.remove")}
                        </button>
                      </li>
                    ))}
                    {queryTermsDraft.length === 0 ? (
                      <p className="monitor-query-empty">{t("web.monitor.empty.needQuery")}</p>
                    ) : null}
                  </ul>
                  <div className="monitor-query-term-form">
                    <input
                      aria-label={t("web.a11y.addMonitorQueryTerm")}
                      className="monitor-input"
                      onChange={(event) => {
                        setQueryTermInput(event.target.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          appendQueryTerm(queryTermInput);
                        }
                      }}
                      placeholder={t("web.monitor.setup.termPlaceholder")}
                      type="text"
                      value={queryTermInput}
                    />
                    <ActionButton
                      aria-label={t("web.a11y.addQueryTerm")}
                      className="monitor-query-add"
                      onClick={() => {
                        appendQueryTerm(queryTermInput);
                      }}
                      size="dense"
                      variant="info"
                    >
                      {t("web.monitor.button.add")}
                    </ActionButton>
                  </div>
                </div>
              </div>

              <div className="monitor-config-column">
                <div className="monitor-config-section">
                  <p className="monitor-section-label">{t("web.monitor.setup.searchPolicy")}</p>
                  <div className="monitor-policy-grid">
                    <div className="monitor-field">
                      <label htmlFor="monitor-max-posts">{t("web.monitor.setup.maxPosts")}</label>
                      <input
                        id="monitor-max-posts"
                        className="monitor-input"
                        inputMode="numeric"
                        min={1}
                        onChange={(event) => {
                          setMaxPostsDraft(event.target.value);
                        }}
                        pattern="[0-9]*"
                        type="text"
                        value={maxPostsDraft}
                      />
                    </div>
                    <div className="monitor-field">
                      <p
                        className="monitor-section-label monitor-field-label"
                        id="monitor-search-window-label"
                      >
                        {t("web.monitor.setup.timeframe")}
                      </p>
                      <div
                        aria-labelledby="monitor-search-window-label"
                        className="monitor-timeframe-picker"
                      >
                        {MONITOR_SEARCH_WINDOW_OPTIONS.map((option) => (
                          <button
                            aria-pressed={searchWindowDaysDraft === option.value}
                            className="monitor-timeframe-option"
                            data-active={searchWindowDaysDraft === option.value ? "true" : "false"}
                            key={option.value}
                            onClick={() => {
                              setSearchWindowDaysDraft(option.value);
                            }}
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="monitor-config-footer">
              <ActionButton
                aria-label={t("web.a11y.saveMonitorSettings")}
                className="monitor-config-save"
                disabled={isSavingMonitorConfig || !canSaveConfig}
                onClick={saveMonitorSettings}
                size="dense"
                variant="primary"
              >
                {isSavingMonitorConfig
                  ? t("web.monitor.button.saving")
                  : t("web.monitor.button.save")}
              </ActionButton>
            </div>
          </section>
        </section>
      ) : (
        <section className="monitor-resources" aria-label={t("web.a11y.monitorResources")}>
          <section className="monitor-feed" aria-label={t("web.a11y.monitorFeedResults")}>
            <header>
              <h3>{t("web.monitor.resources.topPosts")}</h3>
              <span>{`${monitorFeed?.posts.length ?? 0} / ${configuredMaxPosts}`}</span>
            </header>
            {monitorError ? <p className="monitor-error">{monitorError}</p> : null}
            {monitorFeed?.lastError ? (
              <p className="monitor-error">{monitorFeed.lastError}</p>
            ) : null}
            {monitorFeed && monitorFeed.posts.length === 0 ? (
              <p className="monitor-empty">{t("web.monitor.empty.noPosts")}</p>
            ) : (
              <div className="monitor-feed-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("web.monitor.table.likes")}</th>
                      <th scope="col">{t("web.monitor.table.term")}</th>
                      <th scope="col">{t("web.monitor.table.author")}</th>
                      <th scope="col">{t("web.monitor.table.post")}</th>
                      <th scope="col">{t("web.monitor.table.created")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(monitorFeed?.posts ?? []).map((post) => (
                      <tr key={`${post.source}:${post.id}`}>
                        <td>{Math.round(post.likeCount).toLocaleString("en-US")}</td>
                        <td>
                          <span className="monitor-term-badge">
                            {post.matchedQueryTerm ?? t("web.monitor.table.unknown")}
                          </span>
                        </td>
                        <td>@{post.author}</td>
                        <td>
                          <a href={post.permalink} rel="noreferrer" target="_blank">
                            {post.text}
                          </a>
                        </td>
                        <td>{formatTimestamp(post.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </section>
      )}
    </section>
  );
};
