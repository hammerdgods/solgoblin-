"use client";

import { WalletAdapterNetwork, type WalletError } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectWalletProvider } from "./connect-wallet";
import { publicConfig } from "@/lib/config/public";
import { RISK_PROFILES } from "@/lib/scanner/rank";
import type { RiskPreferences } from "@/lib/types";

/**
 * Wallet support: Phantom, Solflare and Trust Wallet adapters are registered explicitly
 * (so they appear even when not installed); any wallet that registers via Wallet Standard
 * is also detected, and a Standard registration supersedes the legacy adapter of the same
 * name. The app only ever asks the wallet to sign transactions the user has reviewed.
 */

type ProfileName = keyof typeof RISK_PROFILES | "custom";

interface AppSettings {
  demoMode: boolean;
  setDemoMode: (v: boolean) => void;
  preferences: RiskPreferences;
  profile: ProfileName;
  setProfile: (p: ProfileName, custom?: RiskPreferences) => void;
}

const SettingsContext = createContext<AppSettings | null>(null);

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — settings stay in memory */
  }
}

function SettingsProvider({ children }: { children: ReactNode }) {
  const [demoMode, setDemo] = useState(false);
  const [profile, setProfileState] = useState<ProfileName>("balanced");
  const [preferences, setPreferences] = useState<RiskPreferences>(RISK_PROFILES.balanced);

  // Hydrate from localStorage after mount (keeps server and client markup identical).
  useEffect(() => {
    const saved = readStorage<{ demoMode: boolean; profile: ProfileName; preferences: RiskPreferences } | null>("yg.settings", null);
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from storage
    setDemo(!!saved.demoMode);
    setProfileState(saved.profile);
    setPreferences(saved.preferences);
  }, []);

  const persist = useCallback((next: { demoMode: boolean; profile: ProfileName; preferences: RiskPreferences }) => writeStorage("yg.settings", next), []);

  const value = useMemo<AppSettings>(
    () => ({
      demoMode,
      setDemoMode: (v) => {
        setDemo(v);
        persist({ demoMode: v, profile, preferences });
      },
      preferences,
      profile,
      setProfile: (p, custom) => {
        const prefs = p === "custom" ? custom ?? preferences : RISK_PROFILES[p];
        setProfileState(p);
        setPreferences(prefs);
        persist({ demoMode, profile: p, preferences: prefs });
      },
    }),
    [demoMode, preferences, profile, persist],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): AppSettings {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <Providers>");
  return ctx;
}

function friendlyWalletError(e: WalletError): string {
  const msg = e.message || e.name;
  if (/reject|denied|cancel/i.test(msg)) return "You declined the connection request in your wallet.";
  if (/not ready|not detected|NotReady/i.test(msg + e.name)) return "That wallet isn't available in this browser. Install it, or open SolGoblin in the wallet's app.";
  if (/locked/i.test(msg)) return "Your wallet is locked. Unlock it and try again.";
  return msg || "The wallet reported an error.";
}

export function Providers({ children }: { children: ReactNode }) {
  const [walletError, setWalletError] = useState<string | null>(null);
  const wallets = useMemo(() => {
    const network = publicConfig.network === "mainnet-beta" ? WalletAdapterNetwork.Mainnet : WalletAdapterNetwork.Devnet;
    return [new PhantomWalletAdapter(), new SolflareWalletAdapter({ network }), new TrustWalletAdapter()];
  }, []);
  const onError = useCallback((e: WalletError) => setWalletError(friendlyWalletError(e)), []);
  return (
    <ConnectionProvider endpoint={publicConfig.rpcUrl} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect onError={onError}>
        <ConnectWalletProvider error={walletError} setError={setWalletError}>
          <SettingsProvider>{children}</SettingsProvider>
        </ConnectWalletProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
