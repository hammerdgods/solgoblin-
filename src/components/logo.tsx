import { GoblinHead } from "./goblin";

export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return <GoblinHead className={className} />;
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <Logo />
      <span>
        Sol<span className="text-accent">Goblin</span>
      </span>
    </span>
  );
}
