// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOpportunity } from "@/test/fixtures";

type MockWallet = { adapter: { name: string; icon: string; supportedTransactionVersions: Set<"legacy" | 0> | null }; readyState: string };
const wallet = vi.hoisted(() => ({
  state: { publicKey: null as null | { toBase58: () => string }, connected: false, connecting: false },
  wallets: [] as MockWallet[],
  current: null as MockWallet | null,
  select: vi.fn(),
}));
const settings = vi.hoisted(() => ({ demoMode: false }));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ ...wallet.state, disconnect: vi.fn(async () => {}), wallet: wallet.current, wallets: wallet.wallets, select: wallet.select, signTransaction: undefined }),
  useConnection: () => ({ connection: {} }),
}));
vi.mock("./providers", () => ({ useSettings: () => ({ demoMode: settings.demoMode, preferences: {}, profile: "balanced" }) }));

const { WalletButton } = await import("./wallet");
const { TxReviewDialog } = await import("./tx-review");
const { ConnectWalletProvider } = await import("./connect-wallet");

const mk = (name: string, readyState: string, versions: Set<"legacy" | 0> | null = new Set(["legacy", 0])): MockWallet => ({ adapter: { name, icon: "", supportedTransactionVersions: versions }, readyState });
const withConnect = (ui: React.ReactNode) => <ConnectWalletProvider error={null} setError={() => {}}>{ui}</ConnectWalletProvider>;

beforeEach(() => {
  wallet.state = { publicKey: null, connected: false, connecting: false };
  wallet.wallets = [mk("Phantom", "Installed"), mk("Solflare", "Loadable"), mk("Trust", "NotDetected", null)];
  wallet.current = null;
  wallet.select.mockReset();
  settings.demoMode = false;
  Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (X11; Linux x86_64)", configurable: true });
});
afterEach(cleanup);

describe("disconnected wallet behavior", () => {
  it("shows Connect Wallet and opens the wallet picker with Phantom, Solflare and Trust Wallet", () => {
    render(withConnect(<WalletButton />));
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    expect(screen.getByRole("dialog", { name: "Connect a wallet" })).toBeInTheDocument();
    expect(screen.getByText("Phantom")).toBeInTheDocument();
    expect(screen.getByText("Solflare")).toBeInTheDocument();
    expect(screen.getByText("Trust Wallet")).toBeInTheDocument();
  });
  it("transaction review refuses to proceed without a wallet", () => {
    render(<TxReviewDialog opportunity={makeOpportunity({ id: "k" })} onClose={() => {}} />);
    expect(screen.getByText("Connect a wallet first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prepare transaction preview/ })).toBeNull();
  });
  it("shows the shortened address when connected", () => {
    wallet.state = { publicKey: { toBase58: () => "EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY" }, connected: true, connecting: false };
    render(withConnect(<WalletButton />));
    expect(screen.getByText("EZC9…CfqY")).toBeInTheDocument();
  });
});

describe("transaction review gating", () => {
  beforeEach(() => {
    wallet.state = { publicKey: { toBase58: () => "EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY" }, connected: true, connecting: false };
  });
  it("never builds transactions in demo mode", () => {
    settings.demoMode = true;
    render(<TxReviewDialog opportunity={makeOpportunity({ id: "k" })} onClose={() => {}} />);
    expect(screen.getByText("Demo mode never builds transactions.")).toBeInTheDocument();
  });
  it("blocks non-executable opportunities with the reason", () => {
    render(<TxReviewDialog opportunity={makeOpportunity({ id: "k", executable: false, executableReason: "Kamino Lend is only available on mainnet-beta." })} onClose={() => {}} />);
    expect(screen.getByText("Kamino Lend is only available on mainnet-beta.")).toBeInTheDocument();
  });
  it("validates insufficient balance before preparing", () => {
    render(<TxReviewDialog opportunity={makeOpportunity({ id: "k" })} available={{ SOL: 1, USDC: 10 }} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("0.0"), { target: { value: "25" } });
    expect(screen.getByText("You have 10 USDC available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Prepare transaction preview/ })).toBeDisabled();
  });
});

describe("wallet picker (Phantom, Solflare, Trust Wallet)", () => {
  const openPicker = () => {
    render(withConnect(<WalletButton />));
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
  };
  it("connects detected and web wallets through the adapter", () => {
    openPicker();
    const connects = screen.getAllByRole("button", { name: "Connect" });
    expect(connects).toHaveLength(2); // Phantom (extension) + Solflare (web wallet)
    fireEvent.click(connects[0]);
    expect(wallet.select).toHaveBeenCalledWith("Phantom");
    expect(screen.getByText("Detected")).toBeInTheDocument();
    expect(screen.getByText("Web wallet")).toBeInTheDocument();
  });
  it("offers an install link on desktop when a wallet is missing", () => {
    openPicker();
    expect(screen.getByRole("link", { name: "Install" })).toHaveAttribute("href", "https://trustwallet.com/download");
  });
  it("offers documented in-app-browser deep links on mobile", async () => {
    Object.defineProperty(window.navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile", configurable: true });
    wallet.wallets = [mk("Phantom", "NotDetected"), mk("Solflare", "NotDetected"), mk("Trust", "NotDetected", null)];
    openPicker();
    const links = await screen.findAllByRole("link", { name: "Open in app" });
    const here = encodeURIComponent(window.location.href);
    const origin = encodeURIComponent(window.location.origin);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `https://phantom.com/ul/browse/${here}?ref=${origin}`,
      `https://solflare.com/ul/v1/browse/${here}?ref=${origin}`,
      `https://link.trustwallet.com/open_url?coin_id=501&url=${here}`,
    ]);
  });
  it("blocks Kamino deposits for legacy-only wallets but explains why", () => {
    wallet.state = { publicKey: { toBase58: () => "EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY" }, connected: true, connecting: false };
    wallet.current = mk("Trust", "Installed", null);
    render(withConnect(<TxReviewDialog opportunity={makeOpportunity({ id: "k", kind: "lending" })} onClose={() => {}} />));
    expect(screen.getByText(/Trust can't sign versioned transactions/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prepare transaction preview/ })).toBeNull();
  });
  it("lets legacy-only wallets prepare native staking", () => {
    wallet.state = { publicKey: { toBase58: () => "EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY" }, connected: true, connecting: false };
    wallet.current = mk("Trust", "Installed", null);
    render(withConnect(<TxReviewDialog opportunity={makeOpportunity({ id: "s", kind: "native-staking", asset: "SOL" })} onClose={() => {}} />));
    expect(screen.getByRole("button", { name: /Prepare transaction preview/ })).toBeInTheDocument();
  });
});
