import { PRIMARY_NAV_ITEMS, type PrimaryNavIndex } from "../app/constants";
import { useT } from "../app/providers/LocaleProvider";

type ConsolePrimaryNavProps = {
  activePrimaryNav: PrimaryNavIndex;
  onPrimaryNavChange: (index: PrimaryNavIndex) => void;
};

export const ConsolePrimaryNav = ({
  activePrimaryNav,
  onPrimaryNavChange,
}: ConsolePrimaryNavProps) => {
  const t = useT();

  return (
    <nav className="console-primary-nav" aria-label={t("web.a11y.primaryNavigation")}>
      <div className="console-primary-nav-tabs">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <button
            aria-current={item.index === activePrimaryNav ? "page" : undefined}
            className="console-primary-nav-tab"
            data-active={item.index === activePrimaryNav ? "true" : "false"}
            key={item.index}
            onClick={() => {
              onPrimaryNavChange(item.index);
            }}
            type="button"
          >
            [{item.index}] {t(item.labelKey)}
          </button>
        ))}
      </div>
      <p className="console-primary-nav-hint">
        {t("web.nav.hint", { max: PRIMARY_NAV_ITEMS.length })}
      </p>
    </nav>
  );
};
