export type WordSeekStartMessageInput = {
  readonly communityTitle: string
  readonly wordLength: number
  readonly points: number
  readonly timeoutSeconds: number
  readonly maxGuesses: number
  readonly clue: string | null
}

export function renderWordSeekStart(input: WordSeekStartMessageInput): string {
  const clue = input.clue ? `\n\n💡 <b>Clue</b>\n${escapeHtml(input.clue)}` : ''
  return `<b>🔎 WORD SEEK</b>\n\n<b>${escapeHtml(input.communityTitle)}</b>\nFind the hidden ${input.wordLength}-letter word. The first valid solver wins.${clue}\n\n🟩 exact position\n🟨 right letter, wrong position\n🟥 not in the word\n\n<i>${input.maxGuesses} guesses · ${input.timeoutSeconds} sec · +${input.points} pts</i>`
}

export function renderWordSeekFeedback(input: {
  readonly feedback: string
  readonly guessesUsed: number
  readonly maxGuesses: number
}): string {
  return `<b>🔎 WORD SEEK · ${input.guessesUsed}/${input.maxGuesses}</b>\n\n${escapeHtml(input.feedback)}`
}

export function renderWordSeekWinner(input: {
  readonly communityTitle: string
  readonly word: string
  readonly winner: string
  readonly points: number
  readonly guessesUsed: number
}): string {
  return `<b>🏆 WORD SEEK · SOLVED</b>\n\n<b>${escapeHtml(input.communityTitle)}</b>\n✅ <b>${escapeHtml(input.word)}</b>\n\n<b>${escapeHtml(input.winner)} found it first</b>\n✨ <b>+${input.points} pts</b> · ${input.guessesUsed} guess${input.guessesUsed === 1 ? '' : 'es'}`
}

export function renderWordSeekEnded(input: {
  readonly communityTitle: string
  readonly word: string
  readonly reason: 'TIMEOUT' | 'MAX_GUESSES' | 'ADMIN'
}): string {
  const reason =
    input.reason === 'TIMEOUT'
      ? 'Time is up.'
      : input.reason === 'MAX_GUESSES'
        ? 'The guess limit was reached.'
        : 'The round was ended by an administrator.'
  return `<b>🔎 WORD SEEK · ENDED</b>\n\n<b>${escapeHtml(input.communityTitle)}</b>\n${escapeHtml(reason)}\nThe word was <b>${escapeHtml(input.word)}</b>.\n\nStart another round from community controls.`
}

export function renderWordSeekDuplicateGuess(): string {
  return '🔁 That word was already guessed. Try another one.'
}

export function renderWordSeekInvalidGuess(input: {
  readonly wordLength: number
  readonly hasCorrectLength: boolean
}): string {
  return input.hasCorrectLength
    ? `Use a ${input.wordLength}-letter word.`
    : 'That word is not in the approved word list.'
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
