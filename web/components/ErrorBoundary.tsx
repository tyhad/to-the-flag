import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  failed: boolean;
}

/** Last line of defence: if drawing the page throws, say what happened and how to recover instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("The display stopped working.", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-xl flex-col gap-3 rounded-panel bg-s1 p-6">
          <h1 className="type-heading text-text">The display stopped working</h1>
          <p className="type-body text-text-2">
            Something in the season data or the page could not be drawn. Reload the page. If it happens again, run the
            F1GStats data check and make sure the app and the data are up to date.
          </p>
          <div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="type-label h-10 rounded-control bg-accent-fill px-4 text-text hover:bg-accent-fill-hover"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
