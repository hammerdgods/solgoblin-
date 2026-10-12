// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOpportunity } from "@/test/fixtures";

const wallet = vi.hoisted(() => ({ state: { publicKey: null as null | { toBase58: () => string }, connected: false, connecting: false } }));
const settings = vi.hoisted(() => ({ demoMode: false }));
const modal = vi.hoisted(() => ({ setVisible: vi.fn() }));

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ ...wallet.state, disconnect: vi.fn(), wallet: null, signTransaction: undefined }),
  useConnection: () => ({ connection: {} }),
}));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ useWalletModal: () => modal }));
vi.mock("./providers", () => ({ useSettings: () => ({ demoMode: settings.demoMode, preferences: {}, profile: "balanced" }) }));

const { WalletButton } = await import("./wallet");
const { TxReviewDialog } = await import("./tx-review");

beforeEach(() => {
  wallet.state = { publicKey: null, connected: false, connecting: false };
  settings.demoMode = false;
  modal.setVisible.mockReset();
});
afterEach(cleanup);

describe("disconnected wallet behavior", () => {
  it("shows Connect Wallet and opens the wallet picker", () => {
    render(<WalletButton />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Wallet" }));
    expect(modal.setVisible).toHaveBeenCalledWith(true);
  });
  it("transaction review refuses to proceed without a wallet", () => {
    render(<TxReviewDialog opportunity={makeOpportunity({ id: "k" })} onClose={() => {}} />);
    expect(screen.getByText("Connect a wallet first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Prepare transaction preview/ })).toBeNull();
  });
  it("shows the shortened address when connected", () => {
    wallet.state = { publicKey: { toBase58: () => "EZC9wzVCvihCsCHEMGADYdsRhcpdRYWzSCZAVegSCfqY" }, connected: true, connecting: false };
    render(<WalletButton />);
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
