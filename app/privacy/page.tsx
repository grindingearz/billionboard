import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — BillionBoard',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-black text-white mb-2">Privacy Policy</h1>
      <p className="text-white/40 text-sm mb-10">Last updated: May 2026</p>

      <div className="space-y-8 text-white/60 leading-relaxed text-sm">
        <section>
          <h2 className="text-base font-bold text-white mb-3">Overview</h2>
          <p>
            BillionBoard is designed with minimal data collection. Because the Platform is
            wallet-based, we do not require an email address, name, or other personal identifiers to
            use the service. This policy describes what data we collect, how we use it, and your
            rights.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Information We Collect</h2>
          <div className="space-y-4">
            <div className="border border-white/10 rounded-lg p-4 bg-white/2">
              <div className="text-white font-medium mb-1">Wallet Addresses</div>
              <p>
                When you connect a wallet, your public Solana wallet address is recorded. This is
                used to identify your advertiser account, process billing, and calculate claim pool
                eligibility. Wallet addresses are public by nature on Solana.
              </p>
            </div>
            <div className="border border-white/10 rounded-lg p-4 bg-white/2">
              <div className="text-white font-medium mb-1">Transaction Data</div>
              <p>
                Top-up transactions, billing deductions, and on-chain settlement signatures are
                stored in our database. This data is used to provide the service and produce
                transparent accounting.
              </p>
            </div>
            <div className="border border-white/10 rounded-lg p-4 bg-white/2">
              <div className="text-white font-medium mb-1">Ad Creatives</div>
              <p>
                Images and URLs you submit for display are stored on our infrastructure for the
                duration of your rental.
              </p>
            </div>
            <div className="border border-white/10 rounded-lg p-4 bg-white/2">
              <div className="text-white font-medium mb-1">Usage Data</div>
              <p>
                We may collect standard server logs (IP addresses, browser type, pages visited) for
                security and performance monitoring. Logs are retained for a limited period.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">How We Use Your Data</h2>
          <ul className="list-disc list-inside space-y-1 text-white/50">
            <li>To operate the Platform and process your tile rentals</li>
            <li>To calculate and process claim pool distributions</li>
            <li>To review and display your ad creatives</li>
            <li>To detect fraud, abuse, or policy violations</li>
            <li>To communicate about your account (if you provide contact details)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">On-Chain Data</h2>
          <p>
            Blockchain transactions are public and permanent. Any USDC transfers, top-ups, or
            on-chain settlement actions involving your wallet address are visible on the Solana
            blockchain and cannot be deleted.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Data Sharing</h2>
          <p className="mb-3">We do not sell your data. We may share data with:</p>
          <ul className="list-disc list-inside space-y-1 text-white/50">
            <li>Infrastructure providers (hosting, database, RPC nodes) necessary to operate the Platform</li>
            <li>Law enforcement or regulators when required by law</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Data Retention</h2>
          <p>
            Billing records, transaction histories, and wallet data are retained for as long as
            required to operate the service and comply with legal obligations. Ad creatives may be
            deleted after a rental expires.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Security</h2>
          <p>
            We implement reasonable technical and organizational measures to protect your data.
            However, no system is 100% secure. You are responsible for the security of your own
            wallet and private keys.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Continued use of the Platform
            after changes constitutes acceptance. We encourage you to review this page periodically.
          </p>
        </section>
      </div>
    </div>
  )
}
