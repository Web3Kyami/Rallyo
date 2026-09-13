export type QuestionUsage = {
  readonly questionId: string
  readonly communityId: string
  readonly usedAt: Date
}

export function isQuestionCoolingDown(
  questionId: string,
  communityId: string,
  usages: readonly QuestionUsage[],
  cooldownDays: number,
  now: Date,
): boolean {
  const cutoff = new Date(now.getTime() - cooldownDays * 24 * 60 * 60 * 1000)

  return usages.some(
    (usage) =>
      usage.questionId === questionId &&
      usage.communityId === communityId &&
      usage.usedAt >= cutoff,
  )
}
