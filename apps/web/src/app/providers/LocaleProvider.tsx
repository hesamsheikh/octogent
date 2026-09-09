import { type Locale, t } from "@octogent/core";
import { createContext, useCallback, useContext } from "react";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  setLocale: () => {},
  t: (key: string) => key,
});

export const LocaleProvider = ({
  locale,
  setLocale,
  children,
}: {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  children: React.ReactNode;
}) => {
  const translate = useCallback(
    (key: string, params?: Record<string, string | number>) => t(locale, key, params),
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: translate }}>
      {children}
    </LocaleContext.Provider>
  );
};

export const useT = () => useContext(LocaleContext).t;
export const useLocale = () => useContext(LocaleContext).locale;
export const useSetLocale = () => useContext(LocaleContext).setLocale;
