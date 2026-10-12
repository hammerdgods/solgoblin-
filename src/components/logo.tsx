export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0f1a14" />
      <path d="M8 21c2-6 5-9 8-9s6 3 8 9" fill="none" stroke="#4fd18b" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12.5" cy="15" r="1.6" fill="#6ee7a4" />
      <circle cx="19.5" cy="15" r="1.6" fill="#6ee7a4" />
      <path d="M10 10l2.5 2.5M22 10l-2.5 2.5" stroke="#4fd18b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <Logo />
      <span>
        Yield<span className="text-accent">Goblin</span>
      </span>
    </span>
  );
}
