"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useConnectWallet } from "./connect-wallet";
import { useEffect, useRef, useState } from "react";
import { shortAddress } from "@/lib/format";
import { Button, cx } from "./ui";

export function WalletButton({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const { publicKey, connected, connecting, disconnect, wallet } = useWallet();
  const { open: openConnect } = useConnectWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  if (!connected || !publicKey) {
    return (
      <Button variant="primary" size={size} className={className} disabled={connecting} onClick={openConnect}>
        {connecting ? "Connecting…" : "Connect Wallet"}
      </Button>
    );
  }
  const address = publicKey.toBase58();
  return (
    <div ref={ref} className={cx("relative", className)}>
      <Button size={size} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data URIs supplied by the wallet */}
        {wallet?.adapter.icon && <img src={wallet.adapter.icon} alt="" className="h-4 w-4 rounded-sm" />}
        <span className="font-mono text-xs">{shortAddress(address)}</span>
      </Button>
      {open && (
        <div role="menu" className="animate-fade-in absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface-2 py-1 text-sm shadow-2xl">
          <button
            role="menuitem"
            className="block w-full px-3 py-2 text-left hover:bg-surface"
            onClick={() => {
              navigator.clipboard?.writeText(address).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <button role="menuitem" className="block w-full px-3 py-2 text-left hover:bg-surface" onClick={() => { setOpen(false); disconnect().catch(() => {}).finally(openConnect); }}>
            Change wallet
          </button>
          <button role="menuitem" className="block w-full px-3 py-2 text-left text-danger hover:bg-surface" onClick={() => { setOpen(false); disconnect().catch(() => {}); }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
