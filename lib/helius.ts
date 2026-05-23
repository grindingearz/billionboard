interface TokenAccount {
  address: string
  owner: string
  amount: string
}

interface HeliusTokenAccountsResponse {
  result?: {
    token_accounts?: TokenAccount[]
    total?: number
  }
  error?: { message: string }
}

/**
 * Fetch all non-zero token holders for a given mint using Helius DAS API.
 * Aggregates multiple token accounts owned by the same wallet.
 * Returns wallet address and raw token balance as a decimal string.
 */
export async function fetchTokenHolders(
  mint: string,
  apiKey: string
): Promise<{ walletAddress: string; balance: string }[]> {
  const url = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`
  const holders = new Map<string, bigint>()
  let page = 1

  while (true) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `page-${page}`,
        method: 'getTokenAccounts',
        params: {
          mint,
          limit: 1000,
          page,
          options: { showZeroBalance: false },
        },
      }),
    })

    if (!res.ok) throw new Error(`Helius API error: ${res.status} ${res.statusText}`)

    const data = (await res.json()) as HeliusTokenAccountsResponse
    if (data.error) throw new Error(`Helius RPC error: ${data.error.message}`)

    const accounts = data.result?.token_accounts ?? []
    if (accounts.length === 0) break

    for (const acct of accounts) {
      const prev = holders.get(acct.owner) ?? 0n
      try {
        holders.set(acct.owner, prev + BigInt(acct.amount))
      } catch {
        // skip accounts with non-integer amounts
      }
    }

    if (accounts.length < 1000) break
    page++
  }

  return Array.from(holders.entries())
    .filter(([, balance]) => balance > 0n)
    .map(([walletAddress, balance]) => ({ walletAddress, balance: balance.toString() }))
}
