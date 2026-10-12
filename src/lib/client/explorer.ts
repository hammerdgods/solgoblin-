import { publicConfig } from "../config/public";

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}${clusterQuery()}`;
}
export function explorerAddressUrl(address: string): string {
  return `https://explorer.solana.com/address/${address}${clusterQuery()}`;
}
function clusterQuery(): string {
  switch (publicConfig.network) {
    case "devnet":
      return "?cluster=devnet";
    case "localnet":
      return `?cluster=custom&customUrl=${encodeURIComponent(publicConfig.rpcUrl)}`;
    default:
      return "";
  }
}
