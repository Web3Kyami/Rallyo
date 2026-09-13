# Third-party notices

## TG-WordGame

Rallyo's Word Seek implementation selectively adapts the duplicate-safe Wordle
feedback and group guess flow from
[`bisug/TG-WordGame`](https://github.com/bisug/TG-WordGame), commit
`0e2146bf5d25f27bdbab4e11f02a1623bdbdcc18`.

Adapted behavior:

- two-pass exact-match and misplaced-letter feedback from `src/util/feedback.ts`;
- duplicate guess handling, word validation, and first-solver behavior from
  `src/handlers/on-message.tsx`;
- durable end-of-game and Telegram message behavior as interaction references.

Rallyo did not copy the upstream Redis/cache layer, identity model, persistence
schema, daily selection flow, or leaderboard. The port lives in
`apps/server/src/games/word-seek/` and uses Rallyo PostgreSQL persistence,
Telegram identity, community configuration, active seasons, and `WORD_SEEK`
ScoreEvents.

The upstream project is MIT licensed:

```text
MIT License

Copyright (c) 2025 Binamra Lamsal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Word-Scramble-Game-Telegram-Bot

Rallyo's Scramble implementation selectively adapts the deterministic game behavior from
[`ryuchi311/Word-Scramble-Game-Telegram-Bot`](https://github.com/ryuchi311/Word-Scramble-Game-Telegram-Bot),
commit `1600f08459d254847093602aca661edb53730a2e`.

Adapted behavior:

- recently-unused word selection;
- shuffle-until-different behavior, made finite and safe for duplicate characters;
- progressive positional hints;
- first-correct round lifecycle and timeout-oriented user flow.

Rallyo did not copy the Python runtime, JSON persistence, Gemini calls, attacks, deductions,
identity model, or leaderboard. The port lives in `apps/server/src/games/scramble/` and uses
Rallyo PostgreSQL persistence, Telegram identity, community configuration, and `SCRAMBLE`
ScoreEvents instead.

The upstream project is MIT licensed:

```text
MIT License

Copyright (c) 2025 Chi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
