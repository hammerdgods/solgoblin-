"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { WalletButton } from "./wallet";

/** Connect button on the landing page; once connected, offers the dashboard. */
export function LandingConnect() {
  const { connected } = useWallet();
  if (connected) {
    return (
      <Link href="/app" className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-medium text-[#04140b] hover:bg-accent-strong">
        Open dashboard
      </Link>
    );
  }
  return <WalletButton size="lg" />;
}
