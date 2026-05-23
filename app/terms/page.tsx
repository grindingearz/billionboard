import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — BillionBoard',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-black text-white mb-2">Terms of Service</h1>
      <p className="text-white/40 text-sm mb-10">Last updated: May 2025</p>

      <div className="space-y-8 text-white/60 leading-relaxed text-sm">
        <section>
          <h2 className="text-base font-bold text-white mb-3">1. Acceptance</h2>
          <p>
            By accessing or using BillionBoard (&ldquo;the Platform&rdquo;), you agree to be bound
            by these Terms of Service. If you do not agree, do not use the Platform. These terms
            apply to all visitors, advertisers, and token holders.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">2. The Service</h2>
          <p className="mb-3">
            BillionBoard is a blockchain-native advertising platform that allows advertisers to rent
            pixel tiles on a one-billion-pixel digital billboard. Tile rentals are denominated in
            USDC on the Solana blockchain. Revenue generated from tile rentals is distributed to
            holders of the $BOARD token.
          </p>
          <p>
            We reserve the right to modify, suspend, or discontinue the Platform at any time
            without notice.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">3. Advertiser Accounts</h2>
          <p className="mb-3">
            To place an advertisement, you must connect a Solana wallet. Your wallet address serves
            as your account identifier. You are solely responsible for the security of your wallet
            and private keys.
          </p>
          <p>
            Advertisers must top up their USDC balance before renting tiles. Balances are consumed
            daily at the prevailing tile rate. It is your responsibility to maintain a sufficient
            balance to keep your advertisement active.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">4. Payments and Refunds</h2>
          <p className="mb-3">
            All payments are made in USDC on the Solana blockchain. Transactions are irreversible
            once confirmed on-chain. Top-up amounts are credited to your advertiser balance and
            deducted as tiles are rented.
          </p>
          <p className="mb-3">
            We do not offer refunds on amounts already deducted for active tile rentals. Unused
            advertiser balance credit may be withdrawn at our discretion in accordance with platform
            policy.
          </p>
          <p>
            We are not responsible for any blockchain transaction fees, network congestion, or
            wallet errors.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">5. Content Standards</h2>
          <p className="mb-3">
            All creatives submitted for display are subject to review and approval. By submitting
            content, you represent that you own or have the right to use the content and that it
            complies with our{' '}
            <a href="/advertising-policy" className="text-green-400 hover:underline">
              Advertising Policy
            </a>
            .
          </p>
          <p>
            We reserve the right to reject, remove, or modify any advertisement at our sole
            discretion without notice or refund.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">6. Intellectual Property</h2>
          <p>
            You retain ownership of your creative content. By submitting content to the Platform,
            you grant BillionBoard a non-exclusive, worldwide, royalty-free license to display,
            reproduce, and distribute your content as part of the Platform&rsquo;s operation.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">7. Token and Rewards</h2>
          <p className="mb-3">
            $BOARD token holders may be eligible to receive USDC distributions from the Platform&rsquo;s
            claim pool. Distributions are not guaranteed and may vary based on platform revenue,
            eligible supply snapshots, and other factors. See our{' '}
            <a href="/disclaimer" className="text-green-400 hover:underline">
              Disclaimer
            </a>{' '}
            for important risk disclosures.
          </p>
          <p>
            Eligibility requirements for claim pool participation are determined by the Platform and
            may change over time.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">8. Prohibited Uses</h2>
          <p className="mb-3">You agree not to:</p>
          <ul className="list-disc list-inside space-y-1 text-white/50">
            <li>Use the Platform for any unlawful purpose</li>
            <li>Attempt to manipulate, reverse-engineer, or exploit the Platform</li>
            <li>Submit content that violates our Advertising Policy</li>
            <li>Use automated scripts or bots to interact with the Platform</li>
            <li>Interfere with or disrupt the Platform&rsquo;s infrastructure</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">9. Disclaimer of Warranties</h2>
          <p>
            The Platform is provided &ldquo;as is&rdquo; without warranties of any kind. We do not
            warrant that the Platform will be uninterrupted, error-free, or secure. Your use of the
            Platform is at your sole risk.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">10. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, BillionBoard shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages arising from your use
            of the Platform, including but not limited to loss of funds, lost profits, or data
            breaches.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">11. Changes to Terms</h2>
          <p>
            We may update these Terms at any time. Continued use of the Platform after changes
            constitutes acceptance of the updated Terms. We encourage you to review this page
            periodically.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">12. Governing Law</h2>
          <p>
            These Terms are governed by applicable law. Any disputes shall be resolved through
            binding arbitration or in a court of competent jurisdiction.
          </p>
        </section>
      </div>
    </div>
  )
}
