interface Props {
  feePercent?: number
  tradingFeeDistEnabled?: boolean
  tradingFeeModeCopy?: string
}

export default function FeeFlowExplainer({ feePercent = 10, tradingFeeDistEnabled = false, tradingFeeModeCopy }: Props) {
  const distPercent = 100 - feePercent

  const revenuePoolDesc = tradingFeeDistEnabled
    ? 'Advertising fees and verified on-chain trading fees accumulate in the daily revenue pool.'
    : 'Advertising fees accumulate in the daily revenue pool. Trading fees are currently routed separately to Treasury (launch mode).'

  const steps = [
    {
      label: 'Advertiser',
      desc: 'Tops up USDC balance and rents pixel tiles at $1/tile/day.',
      color: 'border-white/20 text-white',
      accent: 'text-white',
    },
    {
      label: 'Daily Billing',
      desc: 'Each UTC day, active tile rentals are charged against advertiser balances.',
      color: 'border-white/20 text-white',
      accent: 'text-white',
    },
    {
      label: 'Revenue Pool',
      desc: revenuePoolDesc,
      color: 'border-green-400/30 text-green-400',
      accent: 'text-green-400',
    },
    {
      label: `Treasury (${feePercent}%)`,
      desc: `${feePercent}% of gross daily advertising revenue is routed to the treasury wallet to fund platform operations and development.`,
      color: 'border-amber-400/30 text-amber-400',
      accent: 'text-amber-400',
    },
    {
      label: `Claim Pool (${distPercent}%)`,
      desc: `${distPercent}% of gross daily advertising revenue flows into the claim pool, distributed proportionally to $BOARD holders via daily snapshots.`,
      color: 'border-green-400/30 text-green-400',
      accent: 'text-green-400',
    },
    {
      label: '$BOARD Holders',
      desc: 'Eligible holders claim USDC rewards each epoch, proportional to their share of the eligible supply.',
      color: 'border-green-400/40 text-green-400',
      accent: 'text-green-400',
    },
  ]

  return (
    <div className="border border-white/10 rounded-xl p-5 bg-white/2">
      <h2 className="text-lg font-bold text-white mb-1">How Revenue Flows</h2>
      <p className="text-xs text-white/40 mb-6 leading-relaxed">
        Every USDC dollar paid by advertisers is publicly accounted for on-chain. The full flow
        from advertiser payment to holder claim is transparent and verifiable.
      </p>

      <div className="flex flex-col gap-0">
        {steps.map((step, i) => (
          <div key={step.label} className="flex gap-3 items-start">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold flex-shrink-0 ${step.color}`}
              >
                {i + 1}
              </div>
              {i < steps.length - 1 && <div className="w-px h-6 bg-white/10 my-1" />}
            </div>
            <div className="pb-2">
              <div className={`text-sm font-bold ${step.accent}`}>{step.label}</div>
              <div className="text-xs text-white/50 leading-relaxed mt-0.5">{step.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {!tradingFeeDistEnabled && tradingFeeModeCopy && (
        <div className="mt-4 text-xs text-amber-400/70 bg-amber-400/5 border border-amber-400/10 rounded-lg px-3 py-2">
          {tradingFeeModeCopy}
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="bg-white/3 rounded-lg p-3">
          <div className="text-white/40 uppercase tracking-widest mb-1">Settlement</div>
          <div className="text-white/70 leading-relaxed">
            USDC moves on-chain from the revenue wallet to treasury and distribution wallets each
            epoch via automated settlement.
          </div>
        </div>
        <div className="bg-white/3 rounded-lg p-3">
          <div className="text-white/40 uppercase tracking-widest mb-1">Snapshots</div>
          <div className="text-white/70 leading-relaxed">
            Holder balances are snapshotted at epoch close. Snapshots are taken before distribution
            to prevent gaming.
          </div>
        </div>
        <div className="bg-white/3 rounded-lg p-3">
          <div className="text-white/40 uppercase tracking-widest mb-1">Verification</div>
          <div className="text-white/70 leading-relaxed">
            All settlement transactions are recorded with their Solana tx signatures and visible in
            the Stats page.
          </div>
        </div>
      </div>
    </div>
  )
}
