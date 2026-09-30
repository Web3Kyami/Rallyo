# Rallyo deploy notes — production and staging share one code directory

## The hazard

`rallyo.service` (production) and `rallyo-staging.service` (staging) both use
`WorkingDirectory=/root/projects/Rallyo-live`.

They differ ONLY by environment:

| | production | staging |
|---|---|---|
| unit | `rallyo.service` | `rallyo-staging.service` |
| EnvironmentFile | `/root/projects/Rallyo-production-20260916/.env` | `/root/.secrets/staging.env` |
| Telegram bot | `@Rallyo_gamebot` (8925050018) | `@Rallyo_bot` (8470986957) |
| database | Neon production | throwaway `rallyo_audit` on localhost |
| port | 3000 | 3100 |

Because the CODE is shared, a `git pull` into `Rallyo-live` changes the files
under BOTH services. A unit that is not restarted keeps running the old code
from memory, so it silently drifts from the other one.

This already happened once: the update-replay fix landed at 15:40 and
production was restarted, but staging kept running the pre-fix code from 15:08
until it was noticed and restarted.

## Deploy rule

After every `git pull` / `git merge` into `/root/projects/Rallyo-live`:

    systemctl restart rallyo.service
    systemctl restart rallyo-staging.service

Never restart one and assume the other followed. Verify both:

    systemctl show rallyo.service -p ActiveEnterTimestamp --value
    systemctl show rallyo-staging.service -p ActiveEnterTimestamp --value

Both timestamps must be newer than the commit time of `git log -1 --format=%cd`.

## Long-term fix, not done

Give staging its own checkout (a second `git worktree`) so the two units stop
sharing files. Until then, every deploy is a two-service operation and the
shared directory is the single point of failure.
