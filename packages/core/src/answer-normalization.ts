export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[’']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function matchesAcceptedAnswer(input: string, acceptedAnswers: readonly string[]): boolean {
  const normalizedInput = normalizeAnswer(input)

  return acceptedAnswers.some(
    (acceptedAnswer) => normalizeAnswer(acceptedAnswer) === normalizedInput,
  )
}
