export class UnsupportedNetworkError extends Error {
  constructor(readonly raw: string) {
    super(`Unsupported network "${raw}". Set NEXT_PUBLIC_SOLANA_NETWORK to "mainnet-beta", "devnet", or "localnet".`);
    this.name = "UnsupportedNetworkError";
  }
}
