type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function LoadingState({ label = 'Loading Rallyo' }: { readonly label?: string }) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <span className="state-mark state-mark-loading" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>Getting the latest state.</p>
      </div>
    </div>
  )
}

export function EmptyState({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div className="state-card">
      <span className="state-mark" aria-hidden="true">
        +
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  )
}

export function ErrorState({
  title = 'Something needs attention.',
  detail,
  onRetry,
}: {
  readonly title?: string
  readonly detail: string
  readonly onRetry?: () => void
}) {
  return (
    <div className="state-card state-card-error" role="alert">
      <span className="state-mark" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        {onRetry ? (
          <button className="text-button" type="button" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function ToneBadge({
  children,
  tone = 'neutral',
}: {
  readonly children: React.ReactNode
  readonly tone?: Tone
}) {
  return <span className={`tone-badge tone-badge-${tone}`}>{children}</span>
}

export function SectionLabel({ children }: { readonly children: React.ReactNode }) {
  return <p className="section-label">{children}</p>
}

export function PageFrame({
  eyebrow,
  title,
  detail,
  children,
  action,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly detail?: string
  readonly children: React.ReactNode
  readonly action?: React.ReactNode
}) {
  return (
    <div className="page-frame">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          {detail ? <p className="page-detail">{detail}</p> : null}
        </div>
        {action ? <div className="page-heading-action">{action}</div> : null}
      </header>
      {children}
    </div>
  )
}
