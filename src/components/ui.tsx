import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Small, consistent UI primitives. */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className, title, action, subtitle }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <section className={cx("animate-fade-in min-w-0 rounded-xl border border-border bg-surface", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold tracking-tight text-text">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "accent" | "warn" | "danger" | "info" | "demo";
const toneClass: Record<Tone, string> = {
  neutral: "border-border-strong bg-surface-2 text-muted",
  accent: "border-accent/30 bg-accent-dim text-accent-strong",
  warn: "border-warn/30 bg-warn-dim text-warn",
  danger: "border-danger/30 bg-danger-dim text-danger",
  info: "border-info/30 bg-info-dim text-info",
  demo: "border-demo/40 bg-demo-dim text-demo",
};

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", toneClass[tone], className)}>
      {children}
    </span>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variantClass: Record<Variant, string> = {
  primary: "bg-accent text-[#04140b] hover:bg-accent-strong disabled:bg-accent/40",
  secondary: "border border-border-strong bg-surface-2 text-text hover:border-faint disabled:text-faint",
  ghost: "text-muted hover:bg-surface-2 hover:text-text disabled:text-faint",
  danger: "border border-danger/40 bg-danger-dim text-danger hover:border-danger",
};

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-7 px-2.5 text-xs", md: "h-9 px-3.5 text-sm", lg: "h-11 px-5 text-sm" };
  return <button {...props} className={cx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed", sizes[size], variantClass[variant], className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-shimmer rounded-md bg-[linear-gradient(90deg,#12171b_0%,#1a2126_50%,#12171b_100%)] bg-[length:800px_100%]", className)} />;
}

export function Stat({ label, value, hint, loading }: { label: string; value: ReactNode; hint?: ReactNode; loading?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      {loading ? <Skeleton className="mt-1.5 h-6 w-24" /> : <div className="mt-1 break-words text-lg font-semibold leading-snug tabular-nums tracking-tight">{value}</div>}
      {hint && <div className="mt-0.5 text-[11px] leading-4 text-faint">{hint}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "danger" | "demo" | "accent"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const border = { info: "border-info/30 bg-info-dim/40", warn: "border-warn/30 bg-warn-dim/50", danger: "border-danger/30 bg-danger-dim/50", demo: "border-demo/40 bg-demo-dim/50", accent: "border-accent/30 bg-accent-dim/40" }[tone];
  const color = { info: "text-info", warn: "text-warn", danger: "text-danger", demo: "text-demo", accent: "text-accent-strong" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3.5 py-3 text-sm", border)}>
      <div className="min-w-0 flex-1">
        {title && <div className={cx("font-medium", color)}>{title}</div>}
        {children && <div className="mt-0.5 text-[13px] leading-5 text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="mt-1 max-w-md text-[13px] leading-5 text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function KeyValue({ items }: { items: { k: ReactNode; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-border/60 pb-1.5">
          <dt className="text-muted">{it.k}</dt>
          <dd className="text-right tabular-nums">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}
