import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Advertising Policy — BillionBoard',
}

export default function AdvertisingPolicyPage() {
  return (
    <div className="min-h-dvh max-w-3xl mx-auto px-3 py-8 sm:px-4 sm:py-12">
      <h1 className="text-3xl font-black text-white mb-2">Advertising Policy</h1>
      <p className="text-white/40 text-sm mb-10">Last updated: May 2026</p>

      <div className="space-y-8 text-white/60 leading-relaxed text-sm">
        <section>
          <p>
            BillionBoard is a public internet billboard. All advertisements are reviewed before
            display. By submitting a creative, you confirm that it complies with this policy. We
            reserve the right to reject or remove any advertisement at our sole discretion.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Accepted Content</h2>
          <ul className="list-disc list-inside space-y-1 text-white/50">
            <li>Products, services, and projects that are legal in the jurisdiction of display</li>
            <li>Cryptocurrency and Web3 projects with clear, accurate descriptions</li>
            <li>Brand, event, and awareness campaigns</li>
            <li>Community and open-source projects</li>
            <li>Art, creative works, and digital collectibles</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Prohibited Content</h2>
          <div className="space-y-3">
            {[
              {
                title: 'Illegal content',
                desc: 'Content that violates any applicable law, including but not limited to content that promotes illegal goods, services, or activities.',
              },
              {
                title: 'Scams and fraud',
                desc: 'Phishing links, rug pulls, honeypot tokens, fake giveaways, impersonation of other projects or individuals, or any content designed to deceive or defraud.',
              },
              {
                title: 'Adult and explicit content',
                desc: 'Nudity, sexually explicit material, or adult-only content of any kind.',
              },
              {
                title: 'Hate speech and violence',
                desc: 'Content that promotes, glorifies, or incites hatred, discrimination, harassment, or violence against any person or group.',
              },
              {
                title: 'Malware and harmful links',
                desc: 'Links to sites that distribute malware, spyware, or other harmful software.',
              },
              {
                title: 'Misleading claims',
                desc: 'False or unsubstantiated claims, including fabricated statistics, fake endorsements, or misleading financial projections.',
              },
              {
                title: 'Gambling',
                desc: 'Unlicensed gambling services or platforms.',
              },
              {
                title: 'Weapons and controlled substances',
                desc: 'Firearms, ammunition, controlled drugs, or related paraphernalia.',
              },
            ].map(({ title, desc }) => (
              <div key={title} className="border border-white/10 rounded-lg p-4 bg-white/2">
                <div className="text-red-400 font-medium mb-1">{title}</div>
                <p className="text-white/50">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Review Process</h2>
          <p className="mb-3">
            Submitted creatives enter a pending review queue. We aim to review submissions within
            24–48 hours. Approved creatives are activated; rejected creatives are not displayed and
            your balance is not charged for the pending period.
          </p>
          <p>
            We may request modifications to a creative before approval. Repeated policy violations
            may result in suspension of your advertiser account without refund of remaining balance.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Creative Requirements</h2>
          <ul className="list-disc list-inside space-y-1 text-white/50">
            <li>Images must be in a supported format (PNG, JPG, GIF, WebP)</li>
            <li>Destination URLs must be functional and consistent with the creative content</li>
            <li>Animations must not be excessively flashing in a manner that could cause harm</li>
            <li>Text in creatives must be legible and not misleading</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Enforcement</h2>
          <p>
            Advertisements that are found to violate this policy after display will be removed
            immediately. We are not obligated to provide a refund for time already served by a
            violating advertisement. We may take additional action including account suspension.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-white mb-3">Reporting</h2>
          <p>
            If you believe an advertisement currently displayed violates this policy, please contact
            us. We take reports seriously and will investigate promptly.
          </p>
        </section>
      </div>
    </div>
  )
}
