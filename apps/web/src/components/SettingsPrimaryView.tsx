import type { Locale } from "@octogent/core";
import {
  TERMINAL_COMPLETION_SOUND_OPTIONS,
  type TerminalCompletionSoundId,
} from "../app/notificationSounds";
import { useT } from "../app/providers/LocaleProvider";
import { ActionButton } from "./ui/ActionButton";
import { SettingsToggle } from "./ui/SettingsToggle";

type SettingsPrimaryViewProps = {
  terminalCompletionSound: TerminalCompletionSoundId;
  isRuntimeStatusStripVisible: boolean;
  isMonitorVisible: boolean;
  locale: Locale;
  onTerminalCompletionSoundChange: (soundId: TerminalCompletionSoundId) => void;
  onPreviewTerminalCompletionSound: (soundId: TerminalCompletionSoundId) => void;
  onRuntimeStatusStripVisibilityChange: (visible: boolean) => void;
  onMonitorVisibilityChange: (visible: boolean) => void;
  onLocaleChange: (locale: Locale) => void;
};

export const SettingsPrimaryView = ({
  terminalCompletionSound,
  isRuntimeStatusStripVisible,
  isMonitorVisible,
  locale,
  onTerminalCompletionSoundChange,
  onPreviewTerminalCompletionSound,
  onRuntimeStatusStripVisibilityChange,
  onMonitorVisibilityChange,
  onLocaleChange,
}: SettingsPrimaryViewProps) => {
  const t = useT();

  return (
    <section className="settings-view" aria-label={t("web.a11y.settingsView")}>
      <section className="settings-panel" aria-label={t("web.a11y.completionNotificationSettings")}>
        <header className="settings-panel-header">
          <h2>{t("web.settings.soundTitle")}</h2>
          <p>{t("web.settings.soundDesc")}</p>
        </header>

        <div className="settings-sound-picker">
          {TERMINAL_COMPLETION_SOUND_OPTIONS.map((option) => (
            <button
              aria-pressed={terminalCompletionSound === option.id}
              className="settings-sound-option"
              data-active={terminalCompletionSound === option.id ? "true" : "false"}
              key={option.id}
              onClick={() => {
                onTerminalCompletionSoundChange(option.id);
                onPreviewTerminalCompletionSound(option.id);
              }}
              type="button"
            >
              <span className="settings-sound-option-label">{t(option.labelKey)}</span>
              <span className="settings-sound-option-description">{t(option.descriptionKey)}</span>
            </button>
          ))}
        </div>

        <div className="settings-panel-actions">
          <ActionButton
            aria-label={t("web.settings.preview")}
            className="settings-sound-preview"
            onClick={() => {
              onPreviewTerminalCompletionSound(terminalCompletionSound);
            }}
            size="dense"
            variant="accent"
          >
            {t("web.settings.preview")}
          </ActionButton>
          <span className="settings-saved-pill">{t("web.settings.saved")}</span>
        </div>
      </section>
      <section className="settings-panel" aria-label={t("web.a11y.workspaceSurfaceVisibility")}>
        <header className="settings-panel-header">
          <h2>{t("web.settings.visibilityTitle")}</h2>
          <p>{t("web.settings.visibilityDesc")}</p>
        </header>

        <div className="settings-toggle-grid">
          <SettingsToggle
            label={t("web.settings.xMonitorLabel")}
            description={t("web.settings.xMonitorDesc")}
            ariaLabel={t("web.settings.xMonitorAria")}
            checked={isMonitorVisible}
            onChange={onMonitorVisibilityChange}
          />
          <SettingsToggle
            label={t("web.settings.runtimeStripLabel")}
            description={t("web.settings.runtimeStripDesc")}
            ariaLabel={t("web.settings.runtimeStripAria")}
            checked={isRuntimeStatusStripVisible}
            onChange={onRuntimeStatusStripVisibilityChange}
          />
        </div>
      </section>
      <section className="settings-panel" aria-label={t("web.a11y.languageSettings")}>
        <header className="settings-panel-header">
          <h2>{t("web.settings.languageTitle")}</h2>
          <p>{t("web.settings.languageDesc")}</p>
        </header>

        <div className="settings-sound-picker">
          <button
            aria-pressed={locale === "en"}
            className="settings-sound-option"
            data-active={locale === "en" ? "true" : "false"}
            onClick={() => onLocaleChange("en")}
            type="button"
          >
            <span className="settings-sound-option-label">{t("web.settings.langEn")}</span>
          </button>
          <button
            aria-pressed={locale === "zh-CN"}
            className="settings-sound-option"
            data-active={locale === "zh-CN" ? "true" : "false"}
            onClick={() => onLocaleChange("zh-CN")}
            type="button"
          >
            <span className="settings-sound-option-label">{t("web.settings.langZhCN")}</span>
          </button>
        </div>
      </section>
    </section>
  );
};
