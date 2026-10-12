/**
 * Supported wallets: Phantom, Solflare and Trust Wallet.
 *
 * Desktop: browser extensions are detected via Wallet Standard / injected providers.
 * Mobile: if no wallet is injected, the user can open SolGoblin inside the wallet's
 * in-app browser using each wallet's documented "browse" deep link:
 *  - Phantom:  https://docs.phantom.com/phantom-deeplinks/other-methods/browse
 *  - Solflare: https://docs.solflare.com/solflare/technical/deeplinks/other-methods/browse
 *  - Trust:    https://developer.trustwallet.com/developer/develop-for-trust/deeplinking
 *              (coin_id is the SLIP-44 index; Solana = 501)
 */

export interface FeaturedWallet {
  /** Must equal the wallet-adapter name so it merges with Wallet Standard registrations. */
  adapterName: "Phantom" | "Solflare" | "Trust";
  label: string;
  downloadUrl: string;
  browseDeepLink: (pageUrl: string, origin: string) => string;
  note?: string;
}

const enc = encodeURIComponent;

export const FEATURED_WALLETS: FeaturedWallet[] = [
  {
    adapterName: "Phantom",
    label: "Phantom",
    downloadUrl: "https://phantom.com/download",
    browseDeepLink: (url, origin) => `https://phantom.com/ul/browse/${enc(url)}?ref=${enc(origin)}`,
  },
  {
    adapterName: "Solflare",
    label: "Solflare",
    downloadUrl: "https://solflare.com/download",
    browseDeepLink: (url, origin) => `https://solflare.com/ul/v1/browse/${enc(url)}?ref=${enc(origin)}`,
    note: "Works without the extension via Solflare's web wallet.",
  },
  {
    adapterName: "Trust",
    label: "Trust Wallet",
    downloadUrl: "https://trustwallet.com/download",
    browseDeepLink: (url) => `https://link.trustwallet.com/open_url?coin_id=501&url=${enc(url)}`,
    note: "Native staking supported. Kamino deposits need versioned transactions, which some Trust Wallet versions can't sign.",
  },
];

export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}
