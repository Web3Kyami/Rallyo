import { createHash } from 'node:crypto'

import { parseEnvironment } from '@rallyo/core'
import { eq, sql } from 'drizzle-orm'

import { createDatabase } from '../db/client'
import * as schema from '../db/schema'

const environment = parseEnvironment(process.env)
if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required.')
const resources = createDatabase(environment.DATABASE_URL)

const defaults = [
  [
    'Wallet basics',
    'easy',
    'What does signing a message prove?',
    'Control of a wallet',
    ['Control of a wallet', 'A transfer', 'A token mint'],
  ],
  ['Wallet basics', 'easy', 'Which asset is native to Nimiq?', 'NIM', ['NIM', 'BTC', 'ETH']],
  [
    'Security',
    'medium',
    'Which action avoids moving funds during identity verification?',
    'Sign a message',
    ['Sign a message', 'Send NIM', 'Export a seed phrase'],
  ],
  [
    'Nimiq',
    'easy',
    'What is a public wallet address used for?',
    'Receiving funds',
    ['Receiving funds', 'Signing privately', 'Hiding a balance'],
  ],
  [
    'Nimiq',
    'medium',
    'What should never be shared with a bot?',
    'A private key',
    ['A private key', 'A public address', 'A transaction hash'],
  ],
  [
    'Communities',
    'easy',
    'What does a leaderboard rank?',
    'Player scores',
    ['Player scores', 'Wallet age', 'Message length'],
  ],
  [
    'Communities',
    'easy',
    'What does XP represent in Rallyo?',
    'Lifetime progress',
    ['Lifetime progress', 'A wallet balance', 'A Telegram role'],
  ],
  [
    'Security',
    'medium',
    'Why are one-time link codes useful?',
    'They limit replay',
    ['They limit replay', 'They increase points', 'They reveal private keys'],
  ],
  [
    'Nimiq',
    'easy',
    'What is a transaction hash?',
    'A transaction identifier',
    ['A transaction identifier', 'A seed phrase', 'A username'],
  ],
  [
    'Gameplay',
    'easy',
    'Which answer wins First Correct?',
    'The first accepted answer',
    ['The first accepted answer', 'The longest answer', 'The last answer'],
  ],
  [
    'Gameplay',
    'medium',
    'What happens when a round reaches its deadline?',
    'Answers stop scoring',
    ['Answers stop scoring', 'Points double', 'Clues reset'],
  ],
  [
    'Gameplay',
    'easy',
    'What does a Clue Round reveal over time?',
    'Additional clues',
    ['Additional clues', 'Wallet keys', 'Private chats'],
  ],
] as const

try {
  let inserted = 0
  for (const [category, difficulty, prompt, correctAnswer, optionValues] of defaults) {
    const fingerprint = createHash('sha256')
      .update(`QUICK|${prompt.toLowerCase()}|${correctAnswer.toLowerCase()}`)
      .digest('hex')
    const result = await resources.db
      .insert(schema.questions)
      .values({
        scope: 'GLOBAL',
        source: 'DEFAULT',
        mode: 'QUICK',
        category,
        difficulty,
        prompt,
        options: optionValues.map((value) => ({ label: value, value })),
        correctAnswer,
        acceptedAnswers: [correctAnswer],
        basePoints: 20,
        fingerprint,
        status: 'APPROVED',
      })
      .onConflictDoNothing({ target: schema.questions.fingerprint })
      .returning({ id: schema.questions.id })
    if (result.length > 0) inserted += 1
  }
  const [countRow] = await resources.db
    .select({ count: sql<number>`count(*)` })
    .from(schema.questions)
    .where(eq(schema.questions.source, 'DEFAULT'))
  console.log(
    JSON.stringify({ inserted, totalDefaultQuestions: Number(countRow?.count ?? 0) }, null, 2),
  )
} finally {
  await resources.close()
}
