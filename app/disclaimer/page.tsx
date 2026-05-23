import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Disclaimer — BillionBoard',
}

export default function DisclaimerPage() {
  return (
    <div className="min-h-screen max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-black text-white mb-2">Disclaimer</h1>
      <p className="text-white/40 text-sm mb-10">Last updated: May 2025</p>

      <div className="space-y-8 text-white/60 leading-relaxed text-sm">
        <section>
          <div className="border border-amber-400/20 bg-amber-400/5 rounded-xl p-4 mb-6">
            <p className="text-amber-400/90 text-sm font-medium">
              Nothing on this platform constitutes financial, investment, legal, or tax advice. All
              use of the Platform is at your own risk.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Not Financial Advice</h2>
          <p>
            BillionBoard does not provide investment, financial, legal, or tax advice. Information
            published on this Platform — including revenue figures, distribution amounts, and token
            mechanics — is for informational purposes only. Nothing on this Platform should be
            construed as a recommendation to buy, sell, or hold any asset.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">$BOARD Token Risk</h2>
          <p className="mb-3">
            The $BOARD token is a speculative digital asset. Investing in or holding $BOARD carries
            significant risk, including the risk of total loss of value. Past performance of any
            token or platform metric does not guarantee future results.
          </p>
          <p className="mb-3">
            Claim pool distributions to $BOARD holders depend entirely on platform revenue, which
            can be zero or decline at any time. There is no guarantee that any distribution will
            ever be paid.
          </p>
          <p>
            Tokens may be subject to extreme volatility, low liquidity, regulatory changes, or
            complete loss of value. Only participate with funds you can afford to lose entirely.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Blockchain and Smart Contract Risk</h2>
          <p className="mb-3">
            BillionBoard operates on the Solana blockchain. Blockchain transactions are irreversible.
            Smart contracts may contain bugs or vulnerabilities. Network outages, congestion, or
            forks may affect the Platform&rsquo;s operation.
          </p>
          <p>
            We are not responsible for losses resulting from blockchain failures, wallet errors,
            incorrect addresses, or third-party RPC provider outages.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">No Warranty on Revenue</h2>
          <p>
            Revenue figures and projections shown on the Stats page are based on current conditions
            and are not guarantees of future earnings. Advertising demand, tile prices, and fee
            percentages may change. The Platform may generate little or no revenue at any time.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Third-Party Links and Content</h2>
          <p>
            Advertisements displayed on BillionBoard are submitted by third parties. We review
            content for policy compliance but do not endorse any advertiser, product, or service
            displayed. We are not responsible for the content, accuracy, or actions of any
            advertiser or linked third-party site.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Regulatory Risk</h2>
          <p>
            Cryptocurrency regulation is evolving rapidly across all jurisdictions. Changes in law
            or regulation may affect your ability to use the Platform, hold $BOARD, or receive
            distributions. It is your responsibility to ensure that your participation in the
            Platform complies with the laws of your jurisdiction.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, BillionBoard, its operators, and
            contributors shall not be liable for any direct, indirect, incidental, special,
            consequential, or punitive damages arising from your use of the Platform or $BOARD token.
            This includes losses from market volatility, technical failures, or regulatory action.
          </p>
        </section>
      </div>
    </div>
  )
}
