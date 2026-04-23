const isEnabled = (value: string | undefined): boolean => value === "1";

export const isVerboseLoggingEnabled = (): boolean => isEnabled(process.env.OCTOGENT_VERBOSE_LOGS);

export const logVerbose = (...args: Parameters<typeof console.log>): void => {
  if (isVerboseLoggingEnabled()) {
    console.log(...args);
  }
};

export const logInfo = (...args: Parameters<typeof console.log>): void => {
  console.log(...args);
};

export const logWarn = (...args: Parameters<typeof console.warn>): void => {
  console.warn(...args);
};

export const logError = (...args: Parameters<typeof console.error>): void => {
  console.error(...args);
};
