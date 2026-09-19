# Rallyo

Rallyo turns online communities into ongoing competitive social experiences. Communities run seasons, games, and contribution campaigns; members compete through participation and knowledge, build a persistent Rallyo identity, climb community rankings, and can connect Nimiq for wallet-backed rewards.

Rallyo is prepared for the Nimiq Mini Apps Competition Cycle II.

## What Rallyo is

Rallyo gives a community a shared competitive record across the places where its members already spend time.

- Communities run active seasons with one shared leaderboard.
- Games turn project knowledge and community vocabulary into live participation.
- Social tasks let members contribute through campaign or recurring work.
- Positive score events from games, approved tasks, and authorized awards feed the same community record.
- A player keeps one Rallyo identity across communities.
- Wallet access is optional for play and ranking.
- Nimiq Pay can provide wallet-backed entry, signed wallet identity, and reward context.

The live interaction surface is Telegram. The Rallyo web app makes the record visible through player, community admin, and platform operator views.

## Product surfaces

| Surface              | Purpose                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Telegram communities | Live games, seasons, tasks, proof submission, review, and quick admin controls                         |
| Rallyo app           | Player identity, communities, global XP league, rankings, tasks, wallet state, and reward entitlements |
| Community admin      | Enable games, manage task campaigns, review submissions, and approve project questions or words        |
| Operator console     | Platform-level community, player, identity, reward, and audit operations behind a separate access key  |

## How it works

```mermaid
flowchart LR
    TG[Telegram community] --> G[Games and social tasks]
    G --> S[Positive ScoreEvents]
    S --> L[Community season leaderboard]
    L --> I[Persistent Rallyo Player identity]
    I --> W[Rallyo app]
    W --> N[Nimiq wallet and reward context]
```

Players can participate without a wallet. A Nimiq wallet becomes relevant when a player wants wallet-backed identity or a community has created a reward entitlement.

## Community competition model

Each community has its own active season and leaderboard. Multiple score sources contribute to that same season record:

- Project Quiz / Race rounds
- Word Seek wins
- Scramble wins
- Approved social task submissions
- Authorized positive manual awards

The implementation keeps the player, community, season, and score event relationships explicit. Game-specific records remain available for their own behavior and recovery, while the leaderboard aggregates through the shared score ledger.

## Games

The current Telegram runtime includes three game families:

| Game                | What players do                        | Current capabilities                                                                                                                |
| ------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Project Quiz / Race | Answer a project or community question | Typed answers, multiple choice, first-correct scoring, timed rounds, progressive clues, difficulty, and prepared media presentation |
| Word Seek           | Solve the hidden word                  | Duplicate-safe feedback, guesses, clues, curated or approved project vocabulary, difficulty, timeout, and first-solver scoring      |
| Scramble            | Reconstruct a mixed-up term            | Curated or approved project vocabulary, difficulty, progressive hints, timeout, and first-correct scoring                           |

Approved community content is selected before a live round starts. A live target remains stable while the round is in progress. Live scoring does not call an LLM.

## Social contribution tasks

Social tasks are a first-class part of Rallyo. An admin can publish a recurring task or a campaign task with instructions, points, an optional target, a proof type, and submission limits.

Supported proof types are:

- URL
- Telegram screenshot or document
- URL plus screenshot

Players submit proof through the Telegram flow. A community admin reviews each submission manually. Approval creates exactly one positive `SOCIAL_TASK` score event. Rejection creates no points. Campaign limits, recurring daily limits, and cooldowns are enforced transactionally.

## Nimiq integration

Rallyo uses the Nimiq Mini App SDK for wallet-backed app entry and signed wallet identity.

The implemented wallet flow is:

```mermaid
sequenceDiagram
    participant P as Player
    participant NP as Nimiq Pay
    participant API as Rallyo API
    participant DB as PostgreSQL

    P->>NP: Open Rallyo in Nimiq Pay
    NP-->>P: Approve account access
    P->>API: Request wallet challenge
    API->>DB: Store expiring challenge hash
    API-->>P: Return address-bound message
    P->>NP: Approve message signing
    NP-->>P: Return public key and signature
    P->>API: Submit signed challenge
    API->>API: Verify address, message, signature, expiry, and replay state
    API->>DB: Create or load Player and session
    API-->>P: Open Rallyo Player app
```

Wallet access is optional. Telegram players can enter through a short-lived session or pairing code, play, rank, and connect a wallet later. The app does not access private keys. Sensitive wallet actions stay inside the Nimiq Pay approval flow.

The repository also contains a reward state machine for season entitlements. It covers eligibility, wallet requirements, per-claim and daily caps, idempotent entitlement creation, claim-in-progress state, failures, sent state, and confirmation. The current app API exposes reward entitlements and status, while reward sending is intentionally not exposed through the player app API. Treat live payout wiring and sender configuration as deployment work that must be verified separately.

## Player flows

### Player competition flow

```mermaid
flowchart LR
    A[Join a Telegram community] --> B[Play a game or complete a task]
    B --> C[Earn positive community points]
    C --> D[Climb the active season leaderboard]
    D --> E[Open Rallyo]
    E --> F[Review identity, communities, and global XP]
    F --> G[Optionally link Nimiq]
    G --> H[View eligible reward context]
```

### Social task flow

```mermaid
flowchart TD
    A[Admin creates task] --> B[Community sees task in Telegram]
    B --> C[Player submits URL, screenshot, or both]
    C --> D[Submission enters manual review]
    D -->|Approve| E[Create idempotent SOCIAL_TASK ScoreEvent]
    D -->|Reject| F[Store rejection with no points]
    E --> G[Update season leaderboard]
```

## Architecture

```mermaid
flowchart TD
    TG[Telegram and grammY runtime] --> API[Fastify API]
    WEB[Rallyo web and Nimiq Pay Mini App] --> API
    ADM[Community admin and operator views] --> API
    API --> PG[(PostgreSQL with Drizzle)]
    API --> ID[Identity and session services]
    API --> GAME[Game and scoring services]
    API --> TASK[Social task services]
    API --> NIM[Nimiq wallet and reward services]
    GAME --> PG
    TASK --> PG
    NIM --> PG
```

## Reliability and engineering

The current implementation includes several safeguards around live community state:

- A positive, source-aware `ScoreEvent` ledger with idempotency keys.
- Transactional first-winner arbitration for live game rounds.
- Persistent quiz, Word Seek, and Scramble sessions with replay guards.
- Scheduler recovery for persisted rounds, timeouts, clue reveals, and recurring schedules.
- Transactional social task caps and manual approval.
- Reward entitlement idempotency and explicit claim state transitions.
- Server-side community and admin authorization for app and Telegram actions.
- LLM use kept outside the live scoring path.

## Technology

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| Runtime  | Node.js 22 or newer, TypeScript 5.9 |
| Monorepo | npm workspaces                      |
| Telegram | grammY                              |
| API      | Fastify 5                           |
| Database | PostgreSQL with Drizzle ORM         |
| Web      | React 19 and Vite 8                 |
| Wallet   | `@nimiq/mini-app-sdk`, Nimiq Core   |
| Tests    | Vitest 5                            |

## Repository layout

```text
apps/
  server/          Fastify API, Telegram runtime, scoring, tasks, rewards, migrations
  web/             React/Vite player, admin, operator, and public surfaces
packages/
  core/            Shared scoring, season, normalization, and environment contracts
  nimiq/           Nimiq integration boundary
  telegram/        Telegram bot package boundary
drizzle/           PostgreSQL migrations and schema snapshots
docs/screenshots/  Safe product screenshots used in this README
```

## Screenshots

These captures show the current public web surfaces and the app entry flow. The Telegram GUI is not available in this repository environment, so no Telegram screenshot is presented as if it were captured here.

| Public entry                                                                        | Player entry                                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ![Rallyo public landing page on desktop](docs/screenshots/landing-home-desktop.png) | ![Rallyo player entry page on desktop](docs/screenshots/player-entry-desktop.png) |
| ![Rallyo public landing page on mobile](docs/screenshots/landing-home-mobile.png)   | ![Rallyo player entry page on mobile](docs/screenshots/player-entry-mobile.png)   |

| Nimiq Pay player surface                                                | Community admin                                                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| ![Rallyo Nimiq Pay player home](docs/screenshots/player-nimiq-home.png) | ![Rallyo community admin overview](docs/screenshots/community-admin-desktop.png)                    |
|                                                                         | ![Rallyo community admin social tasks on mobile](docs/screenshots/community-admin-tasks-mobile.png) |

## Local development

Rallyo is an npm workspaces project. Use Node.js 22 or newer and npm 10 or newer.

```bash
npm install
cp .env.example .env
```

Set local values in `.env`. At minimum, a server connected to PostgreSQL needs `DATABASE_URL`; Telegram testing needs `TELEGRAM_BOT_TOKEN`; and the web session flow needs `SESSION_SECRET`. `OPERATOR_ACCESS_KEY` is optional and protects the operator console. Keep all real tokens, database URLs, signing keys, and wallet credentials out of Git.

For a split web and API deployment, set `VITE_API_BASE_URL` in the web build environment to the public API origin. The repository intentionally does not commit an infrastructure-specific API hostname.

Run the schema and checks against a disposable or test database:

```bash
npm run db:migrate
npm run typecheck
npm run lint
npm run format:check
npm test -- --no-file-parallelism --maxWorkers=1
npm run build
```

Start the server and web app separately during local development:

```bash
npm run dev:server
npm run dev:web
```

For local Telegram polling, set `TELEGRAM_TRANSPORT=polling`. Webhook mode requires a public HTTPS endpoint and `TELEGRAM_WEBHOOK_SECRET`.

The current release candidate was verified against a disposable PostgreSQL database with migrations `0000` through `0015` applied. The serialized suite passed 26 test files and 145 tests. A test run without `DATABASE_URL` skips database integration files, so it is not equivalent to the complete verification command above.

## Open-source attribution

Rallyo adapts selected MIT-licensed behavior from upstream Telegram game implementations. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the exact projects, commits, adapted areas, and preserved license text.

## License

[MIT](LICENSE)
