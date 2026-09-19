/*
 * HOLI Treasury Tracker — configuration
 *
 * Every address below was resolved from on-chain data, not from marketing material.
 * See README.md for how each one was verified.
 */
window.HOLI_CONFIG = {
  // --- Chain -------------------------------------------------------------
  chain: {
    id: 4663,
    name: "Robinhood Chain",
    explorer: "https://robinhoodchain.blockscout.com",
    api: "https://robinhoodchain.blockscout.com/api/v2",
    rpc: "https://robinhood.drpc.org",
  },

  // --- Treasury ----------------------------------------------------------
  // Gnosis Safe (SafeL2 v1.4.1). Verified on-chain: proxy master_copy points at
  // 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762 (SafeL2).
  treasury: {
    address: "0xED1caC8cC4e3591491aA38BfDB78A8439D0BeCdB",
    label: "HOLI Treasury Safe",
  },

  // --- Reserve asset -----------------------------------------------------
  // SHYT / "Street Held Your Testicles", contract name PonsV2LauncherToken.
  reserve: {
    address: "0x0105Bf7d7e7d883145806a1e5664470Ee2d1518e",
    symbol: "SHYT",
    decimals: 18,
  },

  // --- Phase I milestone -------------------------------------------------
  // Genesis is stated to open once Treasury buybacks reach this USD value.
  target: 200000,

  // --- Price feed --------------------------------------------------------
  // GeckoTerminal indexes Robinhood Chain as network id "robinhood".
  // Free tier: 30 calls/min. We use one call per refresh.
  price: {
    endpoint: "https://api.geckoterminal.com/api/v2/simple/networks/robinhood/token_price/",
    poolsEndpoint: "https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/",
  },

  // --- Behaviour ---------------------------------------------------------
  refreshSeconds: 300,
};
