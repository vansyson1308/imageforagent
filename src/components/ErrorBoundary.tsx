"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-card border border-rose-900/60 bg-card p-6 text-center">
          <p className="font-semibold text-rose-400">Đã có lỗi giao diện</p>
          <p className="mt-1 text-sm text-muted">{this.state.error.message}</p>
          <button
            className="btn-gradient mt-4 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            onClick={() => this.setState({ error: null })}
          >
            Thử lại
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
