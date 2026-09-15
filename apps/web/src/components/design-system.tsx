import type {
  ButtonHTMLAttributes,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SVGProps,
} from 'react'

export type IconName =
  | 'arrow-right'
  | 'arrow-up-right'
  | 'check'
  | 'chevron-down'
  | 'external'
  | 'game'
  | 'home'
  | 'link'
  | 'list'
  | 'lock'
  | 'plus'
  | 'refresh'
  | 'search'
  | 'shield'
  | 'spark'
  | 'telegram'
  | 'trophy'
  | 'user'
  | 'users'
  | 'wallet'
  | 'warning'
  | 'x'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  readonly name: IconName
  readonly size?: number
  readonly label?: string
}

const iconPaths: Record<IconName, readonly string[]> = {
  'arrow-right': ['M4 12h15', 'm13 6 6 6-6 6'],
  'arrow-up-right': ['M5 19 19 5', 'M9 5h10v10'],
  check: ['m5 12 4 4L19 6'],
  'chevron-down': ['m6 9 6 6 6-6'],
  external: [
    'M14 5h5v5',
    'M19 5 11 13',
    'M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5',
  ],
  game: [
    'M6.5 9.5h11a4.5 4.5 0 0 1 4.3 5.9l-1.2 3.8a2.5 2.5 0 0 1-4.4.7L14.8 18H9.2l-1.4 1.9a2.5 2.5 0 0 1-4.4-.7l-1.2-3.8A4.5 4.5 0 0 1 6.5 9.5Z',
    'M7 13v4',
    'M5 15h4',
    'M17 14h.01',
    'M20 16h.01',
  ],
  home: ['m3 10 9-7 9 7', 'M5 9.5V20h14V9.5', 'M9.5 20v-6h5v6'],
  link: [
    'M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1',
    'M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1',
  ],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  lock: ['M6 10h12v10H6z', 'M8 10V7a4 4 0 0 1 8 0v3'],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: [
    'M20 11a8 8 0 0 0-14.7-3L3 11',
    'M3 5v6h6',
    'M4 13a8 8 0 0 0 14.7 3L21 13',
    'M21 19v-6h-6',
  ],
  search: ['m20 20-4.4-4.4', 'M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z'],
  shield: ['M12 21s8-3.8 8-10V5l-8-3-8 3v6c0 6.2 8 10 8 10Z', 'm9 12 2 2 4-4'],
  spark: [
    'm12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z',
    'm19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z',
  ],
  telegram: [
    'M21 4 3.6 10.7c-.9.3-.9 1.6-.1 1.9l4.5 1.7 1.7 5.2c.3.9 1.4 1.1 2 .4l2.5-3 4.7 3.5c.8.6 2 .1 2.2-.9L23 5.6c.2-1-.9-1.9-2-1.6Z',
    'm8 14 9-7-6.6 8.2',
  ],
  trophy: [
    'M8 4h8v5a4 4 0 0 1-8 0V4Z',
    'M8 6H5v2a3 3 0 0 0 3 3',
    'M16 6h3v2a3 3 0 0 1-3 3',
    'M12 13v4',
    'M8 20h8',
    'M9 17h6',
  ],
  user: ['M19 21a7 7 0 0 0-14 0', 'M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    'M22 21v-2a4 4 0 0 0-3-3.9',
    'M16 3.1a4 4 0 0 1 0 7.8',
  ],
  wallet: [
    'M4 6.5A2.5 2.5 0 0 1 6.5 4H19a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 17.5v-11Z',
    'M4 8h15',
    'M16 14h.01',
  ],
  warning: ['M12 3 2.5 20h19L12 3Z', 'M12 9v4', 'M12 17h.01'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
}

export function Icon({ name, size = 20, label, ...props }: IconProps) {
  return (
    <svg
      aria-hidden={label ? undefined : true}
      aria-label={label}
      fill="none"
      focusable="false"
      height={size}
      role={label ? 'img' : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {iconPaths[name].map((path) => (
        <path d={path} key={path} />
      ))}
    </svg>
  )
}

export function RallyoMark({ size = 'md' }: { readonly size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`rallyo-mark rallyo-mark-${size}`} aria-hidden="true">
      R
    </span>
  )
}

export function RallyoBrand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span className={`rallyo-brand${compact ? ' rallyo-brand-compact' : ''}`}>
      <RallyoMark size={compact ? 'sm' : 'md'} />
      <span className="rallyo-wordmark">RALLYO</span>
    </span>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  children,
  className = '',
  disabled = false,
  icon,
  loading = false,
  size = 'md',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly icon?: IconName
  readonly loading?: boolean
  readonly size?: ButtonSize
  readonly variant?: ButtonVariant
}) {
  return (
    <button
      className={`ds-button ds-button-${variant} ds-button-${size}${className ? ` ${className}` : ''}`}
      aria-busy={loading || undefined}
      disabled={loading || disabled}
      {...props}
    >
      {loading ? <span className="button-spinner" aria-hidden="true" /> : null}
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </button>
  )
}

export function Field({
  error,
  helper,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly error?: string
  readonly helper?: string
  readonly label: string
}) {
  const fieldId = props.id ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        {...props}
        id={fieldId}
        aria-describedby={error || helper ? `${fieldId}-message` : undefined}
        aria-invalid={error ? true : undefined}
      />
      {error || helper ? (
        <p
          className={`field-message${error ? ' field-message-error' : ''}`}
          id={`${fieldId}-message`}
        >
          {error ?? helper}
        </p>
      ) : null}
    </div>
  )
}

export function ToneBadge({
  children,
  tone = 'neutral',
  icon,
}: {
  readonly children: ReactNode
  readonly tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'
  readonly icon?: IconName
}) {
  return (
    <span className={`tone-badge tone-badge-${tone}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  )
}

export function SectionLabel({ children }: { readonly children: ReactNode }) {
  return <p className="section-label">{children}</p>
}

export function Tabs({
  className = '',
  items,
  onChange,
  value,
}: {
  readonly className?: string
  readonly items: readonly {
    readonly value: string
    readonly label: string
    readonly disabled?: boolean
  }[]
  readonly onChange?: (value: string) => void
  readonly value: string
}) {
  return (
    <div
      className={`ds-tabs${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label="View options"
    >
      {items.map((item) => (
        <button
          aria-selected={item.value === value}
          className={item.value === value ? 'is-active' : undefined}
          disabled={item.disabled}
          key={item.value}
          role="tab"
          type="button"
          onClick={() => onChange?.(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

const avatarLooks = [
  { background: '#FFE3D8', skin: '#9E5E42', hair: '#111111', shirt: '#FF6B3D', hairStyle: 'short' },
  { background: '#D8FF52', skin: '#D58D65', hair: '#5F321F', shirt: '#44D6B0', hairStyle: 'bob' },
  { background: '#E5E7FF', skin: '#7A4936', hair: '#111111', shirt: '#FFB84D', hairStyle: 'curl' },
  { background: '#FFE7A8', skin: '#B8734F', hair: '#D8B16A', shirt: '#FF6B97', hairStyle: 'wave' },
] as const

function avatarLook(avatarId: string) {
  let hash = 0
  for (const character of avatarId)
    hash = (hash * 31 + character.charCodeAt(0)) % avatarLooks.length
  return avatarLooks[Math.abs(hash)] ?? avatarLooks[0]
}

export function Avatar({
  admin = false,
  avatarId = 'neutral-01',
  name,
  rank,
  size = 'md',
}: {
  readonly admin?: boolean
  readonly avatarId?: string
  readonly name?: string
  readonly rank?: number | null
  readonly size?: 'xs' | 'sm' | 'md' | 'lg' | 'hero'
}) {
  const look = avatarLook(avatarId)
  const style = {
    '--avatar-background': look.background,
    '--avatar-hair': look.hair,
    '--avatar-shirt': look.shirt,
    '--avatar-skin': look.skin,
  } as CSSProperties
  return (
    <span
      className={`avatar avatar-${size}${rank && rank <= 3 ? ' avatar-top-three' : ''}`}
      style={style}
    >
      <svg
        aria-hidden={name ? undefined : true}
        aria-label={name}
        className="avatar-art"
        focusable="false"
        role={name ? 'img' : undefined}
        viewBox="0 0 64 64"
      >
        <circle cx="32" cy="32" r="31" fill="var(--avatar-background)" />
        <path
          d="M11 64c1-12 9-19 21-19s20 7 21 19"
          fill="var(--avatar-shirt)"
          stroke="var(--ink)"
          strokeWidth="2"
        />
        <path
          d="M22 34c0 8 4 13 10 13s10-5 10-13V22H22v12Z"
          fill="var(--avatar-skin)"
          stroke="var(--ink)"
          strokeWidth="2"
        />
        <path
          d={
            look.hairStyle === 'bob'
              ? 'M20 29c-1-13 5-20 12-20 9 0 14 8 12 21l-4-5c-2 4-8 5-15 2l-5 2Z'
              : look.hairStyle === 'curl'
                ? 'M20 29c-4-9 2-20 12-20 10 0 16 10 12 20l-4-4-3 4-5-4-5 4-3-4-4 4Z'
                : look.hairStyle === 'wave'
                  ? 'M20 28c-2-12 4-20 13-20 8 0 13 6 12 18l-5-6c-4 4-10 5-17 2l-3 6Z'
                  : 'M21 27c-1-12 4-19 11-19 8 0 12 6 11 18-5-4-14-5-22 1Z'
          }
          fill="var(--avatar-hair)"
          stroke="var(--ink)"
          strokeWidth="2"
        />
        <path
          d="M27 34h.01M37 34h.01"
          stroke="var(--ink)"
          strokeLinecap="round"
          strokeWidth="2.5"
        />
        <path
          d="M28 40c2 2 6 2 8 0"
          fill="none"
          stroke="var(--ink)"
          strokeLinecap="round"
          strokeWidth="1.5"
        />
      </svg>
      {admin ? (
        <span className="avatar-badge" title="Community admin">
          <Icon name="shield" size={12} />
        </span>
      ) : null}
    </span>
  )
}

export function RankBlock({
  context,
  movement,
  points,
  rank,
  season,
}: {
  readonly context: string
  readonly movement?: number | null
  readonly points: number
  readonly rank?: number | null
  readonly season?: string
}) {
  const movementLabel = movement && movement > 0 ? `+${movement}` : movement?.toString()
  return (
    <div className="rank-block">
      <div className="rank-block-topline">
        <span>{context}</span>
        {season ? <span>{season}</span> : null}
      </div>
      <strong className="rank-number">{rank ? `#${rank}` : 'Not ranked'}</strong>
      <div className="rank-points">
        <span>Community points</span>
        <strong>{points.toLocaleString()}</strong>
        {movementLabel ? (
          <ToneBadge tone={movement && movement > 0 ? 'success' : 'neutral'}>
            {movementLabel}
          </ToneBadge>
        ) : null}
      </div>
    </div>
  )
}

export function LeaderboardRow({
  admin = false,
  avatarId,
  current = false,
  name,
  rank,
  score,
  tier,
}: {
  readonly admin?: boolean
  readonly avatarId?: string
  readonly current?: boolean
  readonly name: string
  readonly rank: number
  readonly score: number
  readonly tier?: string
}) {
  return (
    <div className={`leaderboard-row${current ? ' leaderboard-row-current' : ''}`}>
      <strong className="leaderboard-rank">{rank}</strong>
      <Avatar admin={admin} avatarId={avatarId ?? 'neutral-01'} name={name} rank={rank} size="sm" />
      <div className="leaderboard-player">
        <strong>{name}</strong>
        {tier ? <span>{tier}</span> : null}
      </div>
      <strong className="leaderboard-score">
        {score.toLocaleString()} <span>pts</span>
      </strong>
    </div>
  )
}

type GameFamily = 'quiz' | 'scramble' | 'word-seek'

const gameDetails: Record<GameFamily, { label: string; icon: IconName }> = {
  quiz: { label: 'Quiz / Race', icon: 'list' },
  scramble: { label: 'Scramble', icon: 'game' },
  'word-seek': { label: 'Word Seek', icon: 'search' },
}

export function GameCard({
  action,
  detail,
  enabled = true,
  family,
}: {
  readonly action?: ReactNode
  readonly detail?: string
  readonly enabled?: boolean
  readonly family: GameFamily
}) {
  const game = gameDetails[family]
  return (
    <article className={`game-card game-card-${family}${enabled ? '' : ' game-card-disabled'}`}>
      <div className="game-card-icon">
        <Icon name={game.icon} size={22} />
      </div>
      <div className="game-card-copy">
        <div className="game-card-heading">
          <strong>{game.label}</strong>
          <ToneBadge tone={enabled ? 'success' : 'neutral'}>
            {enabled ? 'Enabled' : 'Offline'}
          </ToneBadge>
        </div>
        <p>
          {detail ??
            (enabled ? 'Play in your community Telegram.' : 'This game is not enabled here.')}
        </p>
        {action ? <div className="game-card-action">{action}</div> : null}
      </div>
    </article>
  )
}

export function TaskCard({
  action,
  community,
  expiry,
  platform,
  points,
  proof,
  state = 'Available',
  title,
  type = 'Recurring',
}: {
  readonly action?: ReactNode
  readonly community: string
  readonly expiry?: string
  readonly platform: string
  readonly points: number
  readonly proof: string
  readonly state?: string
  readonly title: string
  readonly type?: 'Recurring' | 'Campaign'
}) {
  return (
    <article className="task-card">
      <div className="task-card-topline">
        <span>{community}</span>
        <ToneBadge
          tone={state === 'Approved' ? 'success' : state === 'Pending' ? 'warning' : 'neutral'}
        >
          {state}
        </ToneBadge>
      </div>
      <div className="task-card-body">
        <div>
          <h3>{title}</h3>
          <p>
            {platform} · {type}
          </p>
        </div>
        <strong className="task-points">
          +{points} <span>pts</span>
        </strong>
      </div>
      <div className="task-card-meta">
        <span>Proof: {proof}</span>
        {expiry ? <span>{expiry}</span> : null}
      </div>
      {action ? <div className="task-card-action">{action}</div> : null}
    </article>
  )
}

export function CommunityCard({
  action,
  admin = false,
  name,
  points,
  rank,
  season,
  taskCue,
}: {
  readonly action?: ReactNode
  readonly admin?: boolean
  readonly name: string
  readonly points: number
  readonly rank?: number | null
  readonly season: string
  readonly taskCue?: string
}) {
  return (
    <article className="community-card">
      <div className="community-card-heading">
        <span className="community-mark">{name.slice(0, 1).toUpperCase()}</span>
        <div>
          <h3>{name}</h3>
          <p>{season}</p>
        </div>
        {admin ? (
          <ToneBadge tone="accent" icon="shield">
            Admin
          </ToneBadge>
        ) : null}
      </div>
      <div className="community-card-stats">
        <div>
          <span>Rank</span>
          <strong>{rank ? `#${rank}` : 'Unranked'}</strong>
        </div>
        <div>
          <span>Points</span>
          <strong>{points.toLocaleString()}</strong>
        </div>
      </div>
      {taskCue ? (
        <p className="community-card-cue">
          <Icon name="spark" size={16} />
          {taskCue}
        </p>
      ) : null}
      {action ? <div className="community-card-action">{action}</div> : null}
    </article>
  )
}

export function StatusBanner({
  action,
  detail,
  icon = 'spark',
  title,
  tone = 'accent',
}: {
  readonly action?: ReactNode
  readonly detail: string
  readonly icon?: IconName
  readonly title: string
  readonly tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info'
}) {
  return (
    <section className={`status-banner status-banner-${tone}`}>
      <span className="status-banner-icon">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      {action ? <div className="status-banner-action">{action}</div> : null}
    </section>
  )
}

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

export function EmptyState({
  action,
  detail,
  title,
}: {
  readonly action?: ReactNode
  readonly detail: string
  readonly title: string
}) {
  return (
    <div className="state-card">
      <span className="state-mark" aria-hidden="true">
        <Icon name="plus" size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        {action ? <div className="state-action">{action}</div> : null}
      </div>
    </div>
  )
}

export function ErrorState({
  detail,
  onRetry,
  title = 'Something needs attention.',
}: {
  readonly detail: string
  readonly onRetry?: () => void
  readonly title?: string
}) {
  return (
    <div className="state-card state-card-error" role="alert">
      <span className="state-mark">
        <Icon name="warning" size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        {onRetry ? (
          <Button variant="tertiary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function PageFrame({
  action,
  children,
  detail,
  eyebrow,
  title,
}: {
  readonly action?: ReactNode
  readonly children: ReactNode
  readonly detail?: string
  readonly eyebrow: string
  readonly title: string
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

export type NavigationItem = {
  readonly href: string
  readonly icon: IconName
  readonly label: string
}

export function BottomNav({ items }: { readonly items: readonly NavigationItem[] }) {
  return (
    <nav className="design-bottom-nav" aria-label="Player navigation">
      {items.map((item) => (
        <a href={item.href} key={item.href}>
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  )
}

export function DesktopSidebar({
  context,
  items,
  mode = 'player',
}: {
  readonly context: string
  readonly items: readonly NavigationItem[]
  readonly mode?: 'player' | 'admin' | 'operator'
}) {
  return (
    <aside className={`design-sidebar design-sidebar-${mode}`}>
      <a className="sidebar-brand" href="/app">
        <RallyoBrand />
      </a>
      <div className="sidebar-context">
        <SectionLabel>
          {mode === 'admin'
            ? 'COMMUNITY CONTROL'
            : mode === 'operator'
              ? 'OPERATOR CONSOLE'
              : 'PLAYER HQ'}
        </SectionLabel>
        <strong>{context}</strong>
      </div>
      <nav className="sidebar-nav" aria-label={`${mode} navigation`}>
        {items.map((item) => (
          <a href={item.href} key={item.href}>
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </aside>
  )
}
