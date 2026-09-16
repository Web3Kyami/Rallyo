import { z } from 'zod'

const optionalValue = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

const optionalSecret = optionalValue(z.string().min(1))
const optionalUrl = optionalValue(z.string().url())

export const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  DATABASE_URL: optionalUrl,
  TELEGRAM_BOT_TOKEN: optionalSecret,
  TELEGRAM_WEBHOOK_SECRET: optionalValue(z.string().min(16)),
  TELEGRAM_TRANSPORT: optionalValue(z.enum(['polling', 'webhook'])),
  APP_BASE_URL: optionalUrl,
  SESSION_SECRET: optionalValue(z.string().min(32)),
  OPERATOR_ACCESS_KEY: optionalValue(z.string().min(16)),
  LLM_API_KEY: optionalSecret,
  LLM_MODEL: optionalValue(z.string().min(1)),
  NIMIQ_NETWORK: optionalValue(z.enum(['mainnet', 'testnet'])),
  NIMIQ_REWARD_WALLET_ADDRESS: optionalSecret,
  NIMIQ_REWARD_WALLET_PRIVATE_KEY: optionalSecret,
})

export type Environment = z.infer<typeof environmentSchema>

export function parseEnvironment(input: Record<string, string | undefined>): Environment {
  return environmentSchema.parse(input)
}
