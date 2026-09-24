import { Component, type ErrorInfo, type ReactNode } from "react";

import { useT } from "../app/providers/LocaleProvider";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Optional label shown in the error panel for easier identification. */
  label?: string;
  /** Called when an error is caught — useful for logging / telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

// Rendered as a separate function component so the fallback copy can use the
// locale context; error boundaries themselves must be class components.
const ErrorBoundaryFallback = ({
  error,
  label,
  onReset,
}: {
  error: Error;
  label?: string | undefined;
  onReset: () => void;
}) => {
  const t = useT();

  return (
    <div className="error-boundary-panel">
      <div className="error-boundary-content">
        <span className="error-boundary-icon">⚠</span>
        <p className="error-boundary-title">
          {label ? t("web.errorBoundary.crashed", { label }) : t("web.errorBoundary.title")}
        </p>
        <p className="error-boundary-message">{error.message}</p>
        <button type="button" className="error-boundary-reset" onClick={onReset}>
          {t("web.errorBoundary.tryAgain")}
        </button>
      </div>
    </div>
  );
};

/**
 * Catches render errors inside any primary view so a single broken panel
 * cannot white-screen the entire shell.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
    console.error(
      `[ErrorBoundary:${this.props.label ?? "unknown"}] Caught render error:`,
      error,
      info,
    );
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  override render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <ErrorBoundaryFallback error={error} label={this.props.label} onReset={this.handleReset} />
    );
  }
}
