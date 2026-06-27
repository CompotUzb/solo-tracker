import React from "react";
import type { AsyncState } from "./api.js";

// Small presentational primitives shared by every dashboard section. They give the
// dashboard its consistent "System window" framing and uniform loading/empty/error
// handling so each section only has to describe its happy path.

export function Card({
  title,
  icon,
  span,
  area,
  accent,
  action,
  children,
}: {
  title: string;
  icon?: string;
  span?: 1 | 2 | 3;
  area?: string;
  accent?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const className = [
    "card",
    area ? `area-${area}` : "",
    span ? `span-${span}` : "",
    accent ? "card-accent" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={className}>
      <header className="card-head">
        <h2>
          {icon ? (
            <span className="card-icon" aria-hidden>
              {icon}
            </span>
          ) : null}
          {title}
        </h2>
        {action ? <div className="card-action">{action}</div> : null}
      </header>
      <div className="card-body">{children}</div>
    </section>
  );
}

export function Loading({ label = "Syncing…" }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="pulse" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state state-error" role="alert">
      <span className="state-glyph" aria-hidden>
        ⚠
      </span>
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="state state-empty">
      <span className="state-glyph" aria-hidden>
        ∅
      </span>
      <span>{message}</span>
    </div>
  );
}

/**
 * Render `children` against an AsyncState, falling back to shared loading / error /
 * empty views. `isEmpty` lets a section define what "no data" means for its payload.
 */
export function Async<T>({
  state,
  isEmpty,
  emptyMessage,
  loadingLabel,
  children,
}: {
  state: AsyncState<T>;
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  loadingLabel?: string;
  children: (data: T) => React.ReactNode;
}) {
  if (state.loading) return <Loading label={loadingLabel} />;
  if (state.error) return <ErrorState message={state.error} />;
  if (state.data == null)
    return <EmptyState message={emptyMessage ?? "No data yet."} />;
  if (isEmpty?.(state.data))
    return <EmptyState message={emptyMessage ?? "Nothing here yet."} />;
  return <>{children(state.data)}</>;
}

export function ProgressBar({
  percent,
  label,
}: {
  percent: number;
  label?: string;
}) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="meter"
      role="progressbar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${width}%` }} />
      {label ? <em className="meter-label">{label}</em> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </div>
  );
}
