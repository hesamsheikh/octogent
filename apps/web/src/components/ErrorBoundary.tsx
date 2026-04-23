import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Optional label shown in the error panel for easier identification. */
  label?: string;
  /** Called when an error is caught — useful for logging / telemetry. */
  onError?: (error: Error, info: ErrorInfo) => void;
};

type State = {
  error: Error | null;
};

/**
 * Catches render errors inside any primary view so a single broken panel
 * cannot white-screen the entire shell.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
    console.error(`[ErrorBoundary:${this.props.label ?? "unknown"}] Caught render error:`, error, info);
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
      <div className="error-boundary-panel">
        <div className="error-boundary-content">
          <span className="error-boundary-icon">⚠</span>
          <p className="error-boundary-title">
            {this.props.label ? `${this.props.label} crashed` : "Something went wrong"}
          </p>
          <p className="error-boundary-message">{error.message}</p>
          <button type="button" className="error-boundary-reset" onClick={this.handleReset}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
