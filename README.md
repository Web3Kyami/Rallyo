# Rallyo

**Rallyo** (pronounced **RAL-ee-oh**) is a Telegram-native community game engine.

Communities can run recurring or scheduled interactive quizzes directly inside Telegram, using project-specific knowledge, curated question pools, or manually authored questions. Players earn weekly points and lifetime XP, compete on community leaderboards, and can use the Rallyo Player HQ inside Nimiq Pay for wallet-backed identity and NIM rewards.

## Status

Rallyo is under active development for the Nimiq Mini Apps Competition.

## Core idea

- Play where the community already lives: Telegram.
- Turn project knowledge into interactive rounds.
- Keep scoring deterministic and persistent.
- Use Nimiq for wallet-backed identity and real reward claims.
- Keep AI out of the critical live scoring path.

## Development

Rallyo is an npm workspaces project. It currently requires Node.js 22 or newer and npm 10 or newer.

```bash
npm install
npm run typecheck
npm test
```

Useful local commands:

```bash
npm run lint
npm run format:check
npm run dev:server
npm run dev:web
```

Copy `.env.example` to `.env` for local configuration, then export it before starting the server (the current server does not load dotenv files automatically):

```bash
set -a
source .env
set +a
npm run dev:server
```

For a local Telegram run, set `TELEGRAM_TRANSPORT=polling`; this does not require a public HTTPS endpoint. Keep all real credentials and wallet keys out of Git.

The private Operator Console is available at `/operator` only when `OPERATOR_ACCESS_KEY` is configured. It uses its own HttpOnly session cookie and does not accept Player or Community Admin sessions.

## License

MIT
