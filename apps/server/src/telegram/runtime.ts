import { matchesAcceptedAnswer } from '@rallyo/core'
import { createRallyoBot } from '@rallyo/telegram'
import { and, asc, eq, gt, gte, isNull, lte, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Context } from 'grammy'
import { InlineKeyboard } from 'grammy'

import type { RallyoDatabase } from '../db/client'
import * as schema from '../db/schema'
import {
  claimTelegramUpdate,
  markTelegramUpdateProcessed,
  releaseTelegramUpdate,
} from '../db/telegram-updates'
import { RoundService } from '../core/round-service'
import { ActivityService } from '../core/activity-service'
import {
  CommunityGameConfigService,
  type ProjectQuizConfig,
} from '../core/community-game-config-service'
import {
  GameRegistry,
  projectQuizCompatibilityModule,
  scrambleGameModule,
  wordSeekGameModule,
} from '../core/game-registry'
import { ScheduleService } from '../core/schedule-service'
import { ScheduleWorker } from '../core/schedule-worker'
import { ScheduledQuizService } from '../core/scheduled-quiz-service'
import { WalletLinkService } from '../core/wallet-link-service'
import { ManualScoreService } from '../core/manual-score-service'
import { SocialTaskService } from '../core/social-task-service'
import { ScrambleService, type ScrambleRound } from '../games/scramble/service'
import { WordSeekService } from '../games/word-seek/service'
import {
  renderWordSeekDuplicateGuess,
  renderWordSeekEnded,
  renderWordSeekFeedback,
  renderWordSeekInvalidGuess,
  renderWordSeekStart,
  renderWordSeekWinner,
} from '../games/word-seek/messages'
import {
  clearAdminWizardSession,
  getActiveAdminWizardSession,
  getAdminWizardSession,
  saveAdminWizardSession,
} from './admin-wizard'
import {
  communityAdminSnapshot,
  findCommunityByTelegramChatId,
  listAdminCommunities,
  recordVerifiedAdmin,
  upsertCommunity,
  upsertTelegramIdentity,
} from './persistence'
import {
  clueNumberAt,
  renderClueRevealMessage,
  renderClueRoundAnswered,
  renderFirstCorrectAnswered,
  renderProjectQuizAnswered,
  renderRoundMessage,
} from './round-messages'
import {
  renderScrambleHint,
  renderScrambleHintUnavailable,
  renderScrambleNoActive,
  renderScrambleStart,
  renderScrambleStopped,
  renderScrambleTimeout,
  renderScrambleWinner,
} from '../games/scramble/messages'

export type TelegramRuntimeOptions = {
  readonly database: RallyoDatabase
  readonly token: string
  readonly appBaseUrl?: string
  readonly now?: () => Date
}

type PresentRound = (input: {
  readonly communityId: string
  readonly telegramChatId: bigint
  readonly roundId: string
  readonly at?: Date
}) => Promise<unknown>

type PresentWordSeek = (input: {
  readonly communityId: string
  readonly telegramChatId: bigint
  readonly sessionId: string
}) => Promise<unknown>

type PresentScramble = (input: {
  readonly communityId: string
  readonly telegramChatId: bigint
  readonly roundId: string
  readonly at?: Date
}) => Promise<unknown>

export function createTelegramRuntime(options: TelegramRuntimeOptions) {
  const now = options.now ?? (() => new Date())
  const gameConfigurations = new CommunityGameConfigService(options.database)
  const gameRegistry = new GameRegistry(gameConfigurations)
    .register(projectQuizCompatibilityModule())
    .register(scrambleGameModule())
    .register(wordSeekGameModule())
  const roundService = new RoundService(options.database, gameConfigurations)
  const scheduleService = new ScheduleService(options.database)
  const scheduledQuizService = new ScheduledQuizService(options.database)
  const walletLinkService = new WalletLinkService(options.database)
  const activityService = new ActivityService(options.database)
  const manualScoreService = new ManualScoreService(options.database)
  const socialTaskService = new SocialTaskService(options.database)
  const scrambleService = new ScrambleService(options.database, gameConfigurations)
  const wordSeekService = new WordSeekService(options.database, gameConfigurations)
  let presentRoundForAdmin: PresentRound | null = null
  let presentScrambleForAdmin: PresentScramble | null = null
  let presentWordSeekForAdmin: PresentWordSeek | null = null

  const bot = createRallyoBot(options.token, {
    onUpdate: async (updateId, next) => {
      const telegramUpdateId = BigInt(updateId)

      if (!(await claimTelegramUpdate(options.database, telegramUpdateId))) {
        return
      }

      try {
        await next()
        await markTelegramUpdateProcessed(options.database, telegramUpdateId)
      } catch (error) {
        await releaseTelegramUpdate(options.database, telegramUpdateId)
        throw error
      }
    },
    onStart: async (context) => {
      await ensureTelegramPlayer(options.database, context)

      if (isGroupContext(context)) {
        await ensureCommunityFromContext(options.database, context)
        await context.reply(
          'Rallyo is ready in this community. Play the enabled games here, then check /me in a private chat to see your score.',
          messageOptions(),
        )
        return
      }

      await context.reply(startMessage(), messageOptions(playerKeyboard(options.appBaseUrl)))
    },
    onHelp: async (context) => {
      const isAdmin =
        isGroupContext(context) && context.from
          ? await verifyTelegramAdmin(context, context.chat.id, context.from.id)
          : false
      await context.reply(helpMessage(isAdmin), messageOptions())
    },
    onSettings: async (context) => {
      await handleSettings(options.database, context, now())
    },
    onMe: async (context) => {
      await handleMe(options.database, roundService, context, now(), options.appBaseUrl)
    },
    onLink: async (context) => {
      await handleLink(options.database, walletLinkService, context, options.appBaseUrl, now())
    },
    onWordSeek: async (context) => {
      await handleWordSeekCommand(
        options.database,
        gameRegistry,
        wordSeekService,
        context,
        now(),
        () => presentWordSeekForAdmin,
      )
    },
    onWordSeekAdd: async (context) => {
      await handleWordSeekAdd(options.database, wordSeekService, context)
    },
    onWordSeekWords: async (context) => {
      await handleWordSeekWords(options.database, context)
    },
    onTasks: async (context) => {
      await handleTasks(options.database, socialTaskService, gameConfigurations, context, now())
    },
    onTaskSubmit: async (context) => {
      await handleTaskSubmit(
        options.database,
        socialTaskService,
        gameConfigurations,
        context,
        now(),
      )
    },
    onTaskCreate: async (context) => {
      await handleTaskCreate(
        options.database,
        socialTaskService,
        gameConfigurations,
        context,
        now(),
      )
    },
    onTaskReview: async (context) => {
      await handleTaskReview(
        options.database,
        socialTaskService,
        gameConfigurations,
        context,
        now(),
      )
    },
    onTaskExpire: async (context) => {
      await handleTaskExpire(
        options.database,
        socialTaskService,
        gameConfigurations,
        context,
        now(),
      )
    },
    onManualAward: async (context) => {
      await handleManualAward(options.database, manualScoreService, context, now())
    },
    onScrambleStart: async (context) => {
      await handleScrambleStart(
        options.database,
        gameRegistry,
        scrambleService,
        context,
        now(),
        () => presentScrambleForAdmin,
      )
    },
    onScrambleStop: async (context) => {
      await handleScrambleStop(options.database, scrambleService, context, now())
    },
    onScrambleHint: async (context) => {
      await handleScrambleHint(options.database, scrambleService, context, now())
    },
    onMyChatMember: async (context) => {
      if (isGroupContext(context) && isActiveBotMembership(context)) {
        await ensureCommunityFromContext(options.database, context)
      }
    },
    onGroupText: async (context) => {
      await handleGroupText(
        options.database,
        roundService,
        scrambleService,
        activityService,
        gameConfigurations,
        context,
        now(),
      )
      if (!isGroupContext(context)) {
        await handleAdminText(options.database, context, now())
      } else {
        await handleWordSeekText(options.database, wordSeekService, context, now())
      }
    },
    onAdminCallback: async (context) => {
      await handleAdminCallback(
        options.database,
        roundService,
        scheduledQuizService,
        gameConfigurations,
        scrambleService,
        wordSeekService,
        socialTaskService,
        context,
        now(),
        () => presentRoundForAdmin,
        () => presentScrambleForAdmin,
        () => presentWordSeekForAdmin,
      )
    },
    onPlayerCallback: async (context) => {
      await handlePlayerCallback(
        options.database,
        roundService,
        walletLinkService,
        socialTaskService,
        gameConfigurations,
        context,
        now(),
        options.appBaseUrl,
      )
    },
  })

  const presentRound = async (input: {
    readonly communityId: string
    readonly telegramChatId: bigint
    readonly roundId: string
    readonly at?: Date
  }) => {
    const round = await roundService.liveRoundForCommunity(input.communityId, input.at ?? now())

    if (!round || round.id !== input.roundId) {
      throw new Error('Live round could not be loaded for presentation.')
    }

    if (round.telegramMessageId) {
      throw new Error('Round already has a Telegram presentation.')
    }

    const rendered = renderRoundMessage(round, input.at ?? now())
    const sent = await bot.api.sendMessage(
      toTelegramApiChatId(input.telegramChatId),
      rendered.text,
      {
        parse_mode: 'HTML',
        ...(rendered.replyMarkup ? { reply_markup: rendered.replyMarkup } : {}),
      },
    )
    const attached = await roundService.attachTelegramMessageId(round.id, BigInt(sent.message_id))

    if (!attached) {
      await bot.api.deleteMessage(toTelegramApiChatId(input.telegramChatId), sent.message_id)
      throw new Error('Round presentation was claimed by another sender.')
    }

    return sent
  }

  presentRoundForAdmin = presentRound

  const presentScramble: PresentScramble = async (input) => {
    const round = await scrambleService.activeRoundForCommunity(
      input.communityId,
      input.at ?? now(),
    )

    if (!round || round.id !== input.roundId) {
      throw new Error('Live Scramble round could not be loaded for presentation.')
    }

    if (round.telegramMessageId) {
      throw new Error('Scramble round already has a Telegram presentation.')
    }

    const sent = await bot.api.sendMessage(
      toTelegramApiChatId(input.telegramChatId),
      renderScrambleStart(round, input.at ?? now()),
      messageOptions(),
    )
    const attached = await scrambleService.attachTelegramMessageId(
      round.id,
      BigInt(sent.message_id),
    )

    if (!attached) {
      await bot.api.deleteMessage(toTelegramApiChatId(input.telegramChatId), sent.message_id)
      throw new Error('Scramble presentation was claimed by another sender.')
    }

    return sent
  }

  presentScrambleForAdmin = presentScramble

  const presentWordSeek: PresentWordSeek = async (input) => {
    const session = await wordSeekService.activeSession(input.communityId)
    const community = await findCommunityById(options.database, input.communityId)

    if (!session || session.id !== input.sessionId || !community) {
      throw new Error('Live Word Seek round could not be loaded for presentation.')
    }

    if (session.telegramMessageId !== null) {
      throw new Error('Word Seek round already has a Telegram presentation.')
    }

    const sent = await bot.api.sendMessage(
      toTelegramApiChatId(input.telegramChatId),
      renderWordSeekStart({
        communityTitle: community.title,
        wordLength: session.wordLength,
        points: session.points,
        timeoutSeconds: Math.max(
          1,
          Math.ceil((session.endsAt.getTime() - session.startsAt.getTime()) / 1_000),
        ),
        maxGuesses: session.maxGuesses,
        clue: session.clue,
      }),
      messageOptions(),
    )
    const attached = await wordSeekService.attachTelegramMessageId(
      session.id,
      BigInt(sent.message_id),
    )

    if (!attached) {
      await bot.api.deleteMessage(toTelegramApiChatId(input.telegramChatId), sent.message_id)
      throw new Error('Word Seek presentation was claimed by another sender.')
    }

    return sent
  }

  presentWordSeekForAdmin = presentWordSeek

  const scheduleWorker = new ScheduleWorker(scheduleService, async ({ schedule, now: runAt }) => {
    if (schedule.kind !== 'SCHEDULED_QUIZ') {
      throw new Error(`Unsupported schedule kind: ${schedule.kind}`)
    }

    const quizId = payloadString(schedule.payload, 'quizId')
    const sequence = payloadPositiveInteger(schedule.payload, 'sequence')
    if (!quizId || !sequence) throw new Error('Scheduled quiz payload is invalid.')

    const community = await findCommunityById(options.database, schedule.communityId)
    if (!community) throw new Error('Scheduled quiz community no longer exists.')
    const projectQuizConfiguration = await gameConfigurations.getProjectQuizConfig(community.id)
    if (
      !community.automaticRoundsEnabled ||
      !projectQuizConfiguration.config.automaticRounds ||
      !(await gameConfigurations.isEnabled(community.id, 'project_quiz'))
    ) {
      return {
        nextRunAt: new Date(runAt.getTime() + 60_000),
        payload: { quizId, sequence },
      }
    }

    const next = await scheduledQuizService.nextQuestion(quizId, sequence)
    if (!next || !next.quiz.seasonId) {
      await scheduledQuizService.markComplete(quizId)
      return { enabled: false }
    }

    const locksAt = new Date(runAt.getTime() + next.quiz.perQuestionSeconds * 1_000)
    const round = await roundService.startLiveRound({
      communityId: schedule.communityId,
      seasonId: next.quiz.seasonId,
      quizId: next.quiz.id,
      questionId: next.questionId,
      startsAt: runAt,
      locksAt,
      now: runAt,
    })
    await scheduledQuizService.markLive(next.quiz.id)
    await presentRound({
      communityId: community.id,
      telegramChatId: community.telegramChatId,
      roundId: round.id,
      at: runAt,
    })

    return {
      nextRunAt: locksAt,
      payload: { quizId, sequence: sequence + 1 },
    }
  })

  return {
    bot,
    roundService,
    scrambleService,
    wordSeekService,
    startScheduleWorker: () => scheduleWorker.start(),
    startClueRevealScheduler: () => startClueRevealScheduler(bot, roundService),
    startScrambleScheduler: () => startScrambleScheduler(bot, scrambleService),
    startWordSeekTimeoutScheduler: () =>
      startWordSeekTimeoutScheduler(bot, wordSeekService, options.database),
    presentRound,
    presentScramble,
    presentWordSeek,
  }
}

export async function processClueRevealTick(
  bot: ReturnType<typeof createRallyoBot>,
  roundService: RoundService,
  currentTime: Date,
): Promise<void> {
  const rounds = await roundService.clueRoundsForReveal(currentTime)

  for (const round of rounds) {
    const clueNumber = clueNumberAt(round, currentTime)
    if (clueNumber <= round.clueNumberPresented || round.telegramMessageId === null) continue

    try {
      await bot.api.sendMessage(
        toTelegramApiChatId(round.telegramChatId),
        renderClueRevealMessage(round, clueNumber as 2 | 3).text,
        messageOptions(),
      )
      await roundService.markClueNumberPresented(round.id, clueNumber)
    } catch {
      // Leave the persisted clue number unchanged so the next tick retries the edit.
    }
  }
}

function startClueRevealScheduler(
  bot: ReturnType<typeof createRallyoBot>,
  roundService: RoundService,
) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return

    try {
      await processClueRevealTick(bot, roundService, new Date())
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), 1_000)
    }
  }

  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

export async function processWordSeekTimeoutTick(
  bot: ReturnType<typeof createRallyoBot>,
  wordSeekService: WordSeekService,
  database: RallyoDatabase,
  currentTime: Date,
): Promise<void> {
  const expired = await wordSeekService.expireDueSessions(currentTime)

  for (const session of expired) {
    const community = await findCommunityById(database, session.communityId)
    if (!community) continue

    try {
      await bot.api.sendMessage(
        toTelegramApiChatId(community.telegramChatId),
        renderWordSeekEnded({
          communityTitle: community.title,
          word: session.targetWord,
          reason: 'TIMEOUT',
        }),
        messageOptions(),
      )
    } catch {
      // The session is already durably closed. A Telegram failure must not
      // reopen it or create another scoring path.
    }
  }
}

function startWordSeekTimeoutScheduler(
  bot: ReturnType<typeof createRallyoBot>,
  wordSeekService: WordSeekService,
  database: RallyoDatabase,
) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    try {
      await processWordSeekTimeoutTick(bot, wordSeekService, database, new Date())
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), 1_000)
    }
  }

  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

export async function processScrambleTick(
  bot: ReturnType<typeof createRallyoBot>,
  scrambleService: ScrambleService,
  currentTime: Date,
): Promise<void> {
  await scrambleService.expireDueRounds(currentTime)

  for (const pending of await scrambleService.pendingPresentationRounds()) {
    try {
      const sent = await bot.api.sendMessage(
        toTelegramApiChatId(pending.telegramChatId),
        renderScrambleStart(pending.round, currentTime),
        messageOptions(),
      )
      const attached = await scrambleService.attachTelegramMessageId(
        pending.round.id,
        BigInt(sent.message_id),
      )
      if (!attached) {
        await bot.api.deleteMessage(toTelegramApiChatId(pending.telegramChatId), sent.message_id)
      }
    } catch {
      // A persisted live round remains recoverable on the next tick.
    }
  }

  for (const pending of await scrambleService.pendingOutcomeRounds()) {
    const text =
      pending.round.status === 'WON'
        ? renderScrambleWinner({
            round: pending.round,
            winner: pending.winnerDisplayName ?? 'A player',
            ...(pending.winnerTelegramUserId && pending.winnerDisplayName
              ? {
                  winnerMention: telegramMention(
                    pending.winnerTelegramUserId,
                    pending.winnerDisplayName,
                  ),
                }
              : {}),
          })
        : pending.round.status === 'STOPPED'
          ? renderScrambleStopped(pending.round)
          : renderScrambleTimeout(pending.round)

    try {
      if (pending.round.telegramMessageId !== null) {
        try {
          await bot.api.editMessageText(
            toTelegramApiChatId(pending.telegramChatId),
            toTelegramMessageId(pending.round.telegramMessageId),
            text,
            messageOptions(),
          )
        } catch {
          await bot.api.sendMessage(
            toTelegramApiChatId(pending.telegramChatId),
            text,
            messageOptions(),
          )
        }
      } else {
        await bot.api.sendMessage(
          toTelegramApiChatId(pending.telegramChatId),
          text,
          messageOptions(),
        )
      }
      await scrambleService.markOutcomeNotified(pending.round.id, currentTime)
    } catch {
      // Leave the notification pending so a later tick can retry it.
    }
  }
}

function startScrambleScheduler(
  bot: ReturnType<typeof createRallyoBot>,
  scrambleService: ScrambleService,
) {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    try {
      await processScrambleTick(bot, scrambleService, new Date())
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), 1_000)
    }
  }

  void tick()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

async function handleGroupText(
  database: RallyoDatabase,
  roundService: RoundService,
  scrambleService: ScrambleService,
  activityService: ActivityService,
  gameConfigurations: CommunityGameConfigService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context) || !context.from || !context.message?.text) {
    return
  }

  const community = await findCommunityByTelegramChatId(database, BigInt(context.chat.id))

  if (!community) {
    return
  }

  if (await gameConfigurations.isEnabled(community.id, 'message_activity')) {
    const { playerId } = await ensureTelegramPlayer(database, context)
    await activityService.recordMessage({
      communityId: community.id,
      playerId,
      bucketStart: activityBucketStart(currentTime),
      isReply: Boolean(context.message.reply_to_message),
    })
  }

  if (!context.message.text.trimStart().startsWith('/')) {
    const scrambleRound = await scrambleService.activeRoundForCommunity(community.id, currentTime)
    if (scrambleRound) {
      const { playerId } = await ensureTelegramPlayer(database, context)
      const result = await scrambleService.submitGuess({
        telegramUpdateId: BigInt(context.update.update_id),
        telegramInputId: `chat:${context.chat.id}:message:${context.message.message_id}`,
        roundId: scrambleRound.id,
        playerId,
        rawAnswer: context.message.text,
        now: currentTime,
        updateAlreadyClaimed: true,
      })

      if (result.status === 'WON') {
        const winner = telegramUserLabel(context.from)
        const resultMessage = renderScrambleWinner({
          round: result.round,
          winner,
          winnerMention: telegramMention(context.from.id, winner),
        })
        if (scrambleRound.telegramMessageId !== null) {
          try {
            await context.api.editMessageText(
              context.chat.id,
              toTelegramMessageId(scrambleRound.telegramMessageId),
              resultMessage,
              messageOptions(),
            )
            await scrambleService.markOutcomeNotified(result.round.id, currentTime)
            return
          } catch {
            // Fall back to a compact reply if Telegram cannot edit the challenge.
          }
        }
        await context.reply(resultMessage, messageOptions())
        await scrambleService.markOutcomeNotified(result.round.id, currentTime)
      } else if (result.status === 'TIMEOUT') {
        await context.reply(renderScrambleTimeout(result.round), messageOptions())
        await scrambleService.markOutcomeNotified(result.round.id, currentTime)
      }
      return
    }
  }

  const round = await roundService.liveRoundForCommunity(community.id, currentTime)

  if (!round) {
    const lockedRound = await roundService.lockedRoundForCommunity(community.id, currentTime)

    if (
      lockedRound &&
      roundPresentation(lockedRound) === 'typed' &&
      matchesAcceptedAnswer(context.message.text, lockedRound.acceptedAnswers)
    ) {
      await context.reply('That round is already closed.')
    }
    return
  }

  if (roundPresentation(round) !== 'typed') {
    return
  }

  const { playerId } = await ensureTelegramPlayer(database, context)
  const telegramInputId = `chat:${context.chat.id}:message:${context.message.message_id}`

  const clueNumber = clueNumberAt(round, currentTime)
  const result = await roundService.claimProjectQuizAnswer({
    telegramUpdateId: BigInt(context.update.update_id),
    telegramInputId,
    roundId: round.id,
    playerId,
    rawAnswer: context.message.text,
    clueNumber,
    now: currentTime,
    updateAlreadyClaimed: true,
  })

  if (result.status === 'WON') {
    const winner = telegramUserLabel(context.from)
    const winnerMention = telegramMention(context.from.id, winner)
    const rank = await roundService.rankForPlayerInSeason(community.id, round.seasonId, playerId)
    const resultMessage = round.presentation
      ? renderProjectQuizAnswered({
          prompt: round.prompt,
          answer: context.message.text,
          winner,
          winnerMention,
          points: result.points,
          rank,
        })
      : round.mode === 'CLUE'
        ? renderClueRoundAnswered({
            prompt: round.prompt,
            answer: context.message.text,
            clueNumber,
            winner,
            winnerMention,
            points: result.points,
          })
        : renderFirstCorrectAnswered({
            prompt: round.prompt,
            answer: context.message.text,
            winner,
            winnerMention,
            points: result.points,
          })

    if (round.telegramMessageId !== null) {
      try {
        await context.api.editMessageText(
          context.chat.id,
          toTelegramMessageId(round.telegramMessageId),
          resultMessage,
          messageOptions(),
        )
        return
      } catch {
        // Fall back to a compact reply if the original message can no longer be edited.
      }
    }

    await context.reply(resultMessage, messageOptions())
  } else if (
    result.status === 'ROUND_CLOSED' &&
    matchesAcceptedAnswer(context.message.text, round.acceptedAnswers) &&
    (await roundService.lockedRoundForCommunity(community.id, currentTime))
  ) {
    await context.reply('That round is already closed.')
  }
}

function activityBucketStart(currentTime: Date): Date {
  const bucketMilliseconds = 60 * 60 * 1_000
  return new Date(Math.floor(currentTime.getTime() / bucketMilliseconds) * bucketMilliseconds)
}

async function handleWordSeekText(
  database: RallyoDatabase,
  wordSeekService: WordSeekService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context) || !context.from || !context.message?.text) return
  if (context.message.text.trimStart().startsWith('/')) return

  const community = await findCommunityByTelegramChatId(database, BigInt(context.chat.id))
  if (!community) return

  const session = await wordSeekService.activeSession(community.id)
  if (!session) return

  const { playerId } = await ensureTelegramPlayer(database, context)
  const result = await wordSeekService.submitGuess({
    communityId: community.id,
    playerId,
    telegramUpdateId: BigInt(context.update.update_id),
    telegramInputId: `chat:${context.chat.id}:message:${context.message.message_id}`,
    rawGuess: context.message.text,
    now: currentTime,
    updateAlreadyClaimed: true,
  })

  if (result.status === 'FEEDBACK') {
    await context.reply(
      renderWordSeekFeedback({
        feedback: result.feedback,
        guessesUsed: result.guessesUsed,
        maxGuesses: result.maxGuesses,
      }),
      messageOptions(),
    )
  } else if (result.status === 'WON') {
    const winner = telegramUserLabel(context.from)
    await context.reply(
      renderWordSeekWinner({
        communityTitle: community.title,
        word: result.word,
        winner,
        winnerMention: telegramMention(context.from.id, winner),
        points: result.points,
        guessesUsed: result.guessesUsed,
      }),
      messageOptions(),
    )
  } else if (result.status === 'TIMED_OUT' || result.status === 'MAX_GUESSES') {
    await context.reply(
      renderWordSeekEnded({
        communityTitle: community.title,
        word: result.word,
        reason: result.status === 'MAX_GUESSES' ? 'MAX_GUESSES' : 'TIMEOUT',
      }),
      messageOptions(),
    )
  } else if (result.status === 'DUPLICATE_GUESS') {
    await context.reply(renderWordSeekDuplicateGuess(), messageOptions())
  } else if (result.status === 'INVALID_LENGTH' || result.status === 'INVALID_WORD') {
    await context.reply(
      renderWordSeekInvalidGuess({
        wordLength: result.wordLength,
        hasCorrectLength: result.status === 'INVALID_LENGTH',
      }),
      messageOptions(),
    )
  }
}

function friendlyGameError(error: unknown, gameName: string): string {
  const detail = error instanceof Error ? error.message : ''
  const normalized = detail.toLowerCase()

  if (normalized.includes('disabled')) {
    return `${gameName} is turned off for this community. An admin can enable it from /settings > Games.`
  }
  if (normalized.includes('active season') || normalized.includes('season')) {
    return `${gameName} needs an active season before it can start. Check Season & points in /settings.`
  }
  if (
    normalized.includes('approved') ||
    normalized.includes('usable') ||
    normalized.includes('available')
  ) {
    return `${gameName} does not have enough approved content to start yet. Check Project content in /settings.`
  }
  if (normalized.includes('already has') || normalized.includes('already live')) {
    return `${gameName} is already live in this community. Open /settings to view the active round.`
  }
  if (detail) return detail
  return `${gameName} could not start. Check the community settings and try again.`
}

async function handleWordSeekCommand(
  database: RallyoDatabase,
  gameRegistry: GameRegistry,
  wordSeekService: WordSeekService,
  context: Context,
  currentTime: Date,
  presentWordSeek: () => PresentWordSeek | null,
): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply('Start Word Seek from a community group administrator account.')
    return
  }

  if (!(await verifyTelegramAdmin(context, context.chat.id, context.from.id))) {
    await context.reply('Only a verified community administrator can start Word Seek.')
    return
  }

  const community = await ensureCommunityFromContext(database, context)
  try {
    await gameRegistry.canStart({
      gameKey: 'word_seek',
      communityId: community.id,
      now: currentTime,
      config: {},
    })
  } catch (error) {
    await context.reply(friendlyGameError(error, 'Word Seek'), messageOptions())
    return
  }

  try {
    const season = await activeSeasonForCommunity(database, community.id, currentTime)
    const presenter = presentWordSeek()
    if (!season || !presenter) {
      await context.reply('Word Seek needs an active season before it can start.')
      return
    }

    const session = await wordSeekService.start({
      communityId: community.id,
      seasonId: season.id,
      startsAt: currentTime,
      now: currentTime,
    })
    await presenter({
      communityId: community.id,
      telegramChatId: community.telegramChatId,
      sessionId: session.id,
    })
    await context.reply('Word Seek is live in this community.')
  } catch (error) {
    await context.reply(friendlyGameError(error, 'Word Seek'), messageOptions())
  }
}

async function handleWordSeekAdd(
  database: RallyoDatabase,
  wordSeekService: WordSeekService,
  context: Context,
): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply('Add project Word Seek words from the community group.')
    return
  }

  if (!(await verifyTelegramAdmin(context, context.chat.id, context.from.id))) {
    await context.reply('Only a verified community admin can add project Word Seek words.')
    return
  }

  const rawArguments = (context.message?.text ?? '')
    .replace(/^\/wordseek_add(?:@\w+)?\s*/iu, '')
    .trim()
  const separator = rawArguments.indexOf('|')
  const word = (separator === -1 ? rawArguments : rawArguments.slice(0, separator)).trim()
  const clue = separator === -1 ? undefined : rawArguments.slice(separator + 1).trim()

  if (!word) {
    await context.reply('Format: /wordseek_add WORD | optional clue')
    return
  }
  if (clue && clue.length > 500) {
    await context.reply('The optional clue must be 500 characters or fewer.')
    return
  }

  const community = await ensureCommunityFromContext(database, context)
  try {
    const created = await wordSeekService.createProjectWord({
      communityId: community.id,
      word,
      ...(clue ? { clue } : {}),
    })
    await context.reply(
      `✅ Draft saved: <b>${escapeHtml(created.word)}</b>\n\nReview it with /wordseek_words before using it in a round.`,
      messageOptions(),
    )
  } catch (error) {
    await context.reply(
      error instanceof Error
        ? error.message
        : 'The project word could not be saved. Check the word and try again.',
    )
  }
}

async function handleWordSeekWords(database: RallyoDatabase, context: Context): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply('View project Word Seek words from the community group.')
    return
  }

  if (!(await verifyTelegramAdmin(context, context.chat.id, context.from.id))) {
    await context.reply('Only a verified community admin can view project Word Seek words.')
    return
  }

  const community = await ensureCommunityFromContext(database, context)
  const vocabulary = await renderWordSeekVocabulary(database, community.id)
  await context.reply(vocabulary.text, messageOptions(vocabulary.keyboard))
}

async function handleWordSeekApprovalCallback(
  database: RallyoDatabase,
  wordSeekService: WordSeekService,
  context: Context,
  wordId: string,
): Promise<void> {
  const [word] = await database
    .select({
      id: schema.wordSeekWords.id,
      communityId: schema.wordSeekWords.communityId,
      word: schema.wordSeekWords.word,
    })
    .from(schema.wordSeekWords)
    .where(eq(schema.wordSeekWords.id, wordId))
    .limit(1)

  if (!word) {
    await context.answerCallbackQuery({ text: 'That project word is no longer available.' })
    return
  }

  const community = await findCommunityById(database, word.communityId)
  if (!community || !context.from) {
    await context.answerCallbackQuery({ text: 'This community is no longer available.' })
    return
  }

  if (
    !(await verifyTelegramAdmin(
      context,
      toTelegramApiChatId(community.telegramChatId),
      context.from.id,
    ))
  ) {
    await context.answerCallbackQuery({ text: 'We could not verify your admin access.' })
    return
  }

  try {
    const approved = await wordSeekService.approveProjectWord(word.id, community.id)
    await context.reply(
      `✅ Project word approved: <b>${escapeHtml(approved.word)}</b>.`,
      messageOptions(),
    )
    const vocabulary = await renderWordSeekVocabulary(database, community.id)
    await context.reply(vocabulary.text, messageOptions(vocabulary.keyboard))
    await context.answerCallbackQuery({ text: 'Project word approved.' })
  } catch (error) {
    await context.answerCallbackQuery({ text: 'Project word was not approved.' })
    await context.reply(
      error instanceof Error
        ? error.message
        : 'The project word could not be approved. Refresh and try again.',
    )
  }
}

async function handleTasks(
  database: RallyoDatabase,
  socialTaskService: SocialTaskService,
  gameConfigurations: CommunityGameConfigService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context)) {
    await context.reply('View community tasks from the group where they are offered.')
    return
  }

  const community = await ensureCommunityFromContext(database, context)
  if (!(await gameConfigurations.isEnabled(community.id, 'social_tasks'))) {
    await context.reply(
      '🎯 Social tasks are turned off here. An admin can enable them from /settings > Social tasks.',
    )
    return
  }
  const tasks = await socialTaskService.listActive(community.id, currentTime)
  if (tasks.length === 0) {
    await context.reply(
      '<b>🎯 COMMUNITY TASKS</b>\n\nThere are no active tasks right now. Check back when a new task is published.',
      messageOptions(),
    )
    return
  }

  await context.reply(
    renderSocialTaskList(tasks, currentTime),
    messageOptions(socialTaskListKeyboard(tasks)),
  )
}

async function handleTaskSubmit(
  database: RallyoDatabase,
  socialTaskService: SocialTaskService,
  gameConfigurations: CommunityGameConfigService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply(
      'Submit a task reference from the community group where the task was offered.',
    )
    return
  }

  const community = await findCommunityByTelegramChatId(database, BigInt(context.chat.id))
  if (!community) {
    await context.reply(
      'This group is not connected to Rallyo yet. Ask an admin to run /start here.',
    )
    return
  }
  if (!(await gameConfigurations.isEnabled(community.id, 'social_tasks'))) {
    await context.reply(
      '🎯 Social tasks are turned off here. An admin can enable them from /settings > Social tasks.',
    )
    return
  }

  const reference = (context.message?.text ?? '').replace(/^\/task_submit(?:@\w+)?\s*/iu, '').trim()
  if (!reference) {
    await context.reply(
      'Send the task link or reference after the command, for example: /task_submit https://example.com/post',
    )
    return
  }

  const session = await socialTaskService.activeSubmissionSession({
    telegramUserId: BigInt(context.from.id),
    communityId: community.id,
    now: currentTime,
  })
  if (!session) {
    await context.reply('Choose a task with /tasks first, then send its URL or reference.')
    return
  }

  const { playerId } = await ensureTelegramPlayer(database, context)
  try {
    await socialTaskService.submit({
      taskId: session.session.taskId,
      playerId,
      reference,
      now: currentTime,
    })
    await socialTaskService.clearSubmissionSession(BigInt(context.from.id), community.id)
    await context.reply(
      `✅ <b>${escapeHtml(session.task.title)}</b>\n\nYour submission is waiting for community review.`,
      messageOptions(),
    )
  } catch (error) {
    await context.reply(
      error instanceof Error
        ? error.message
        : 'Your submission could not be saved. Try again with a valid link or reference.',
    )
  }
}

async function handleTaskCreate(
  database: RallyoDatabase,
  socialTaskService: SocialTaskService,
  gameConfigurations: CommunityGameConfigService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply('Create tasks from the community group where they will be offered.')
    return
  }
  if (!(await verifyTelegramAdmin(context, context.chat.id, context.from.id))) {
    await context.reply('🔒 Only a verified community admin can create tasks here.')
    return
  }

  const community = await ensureCommunityFromContext(database, context)
  await rememberVerifiedAdmin(database, context, community.id, currentTime)
  if (!(await gameConfigurations.isEnabled(community.id, 'social_tasks'))) {
    await context.reply(
      '🎯 Social tasks are turned off. Open /settings > Social tasks and enable them first.',
    )
    return
  }
  const raw = (context.message?.text ?? '').replace(/^\/task_create(?:@\w+)?\s*/iu, '').trim()
  const fields = raw.split('|').map((field) => field.trim())
  const title = fields[0]
  const instructions = fields[1]
  const points = Number(fields[2])
  const hours = Number(fields[3])
  const maxSubmissions = fields[4] ? Number(fields[4]) : undefined
  const cooldownDays = fields[5] ? Number(fields[5]) : undefined

  if (!title || !instructions || !Number.isSafeInteger(points) || !Number.isSafeInteger(hours)) {
    await context.reply(
      'Format: /task_create Title | instructions | points | hours | optional cap | optional cooldown days',
    )
    return
  }
  if (hours < 1 || hours > 24 * 30) {
    await context.reply('Choose a task duration from 1 hour to 30 days.')
    return
  }

  try {
    const task = await socialTaskService.createTask({
      communityId: community.id,
      title,
      instructions,
      points,
      startsAt: currentTime,
      endsAt: new Date(currentTime.getTime() + hours * 60 * 60_000),
      ...(maxSubmissions === undefined ? {} : { maxSubmissionsPerPlayer: maxSubmissions }),
      ...(cooldownDays === undefined ? {} : { cooldownDays }),
      createdByTelegramUserId: BigInt(context.from.id),
    })
    await context.reply(
      `✅ Task published: <b>${escapeHtml(task.title)}</b>\n\nPlayers can find it with /tasks and submit a URL or reference.`,
      messageOptions(),
    )
  } catch (error) {
    await context.reply(
      error instanceof Error
        ? error.message
        : 'The task could not be published. Check the format and try again.',
    )
  }
}

async function handleTaskReview(
  database: RallyoDatabase,
  socialTaskService: SocialTaskService,
  gameConfigurations: CommunityGameConfigService,
  context: Context,
  currentTime: Date,
  targetCommunityId?: string,
): Promise<void> {
  if (!context.from) {
    await context.reply('Open task review as a verified community administrator.')
    return
  }

  const community = isGroupContext(context)
    ? await ensureCommunityFromContext(database, context)
    : targetCommunityId
      ? await findCommunityById(database, targetCommunityId)
      : null
  if (!community) {
    await context.reply('Open task review from the community group or its private settings.')
    return
  }
  if (
    !(await verifyTelegramAdmin(
      context,
      toTelegramApiChatId(community.telegramChatId),
      context.from.id,
    ))
  ) {
    await context.reply('🔒 Only a verified community admin can review tasks here.')
    return
  }

  await rememberVerifiedAdmin(database, context, community.id, currentTime)
  if (!(await gameConfigurations.isEnabled(community.id, 'social_tasks'))) {
    await context.reply(
      '🎯 Social tasks are turned off here. Enable them from /settings > Social tasks.',
    )
    return
  }
  const pending = await socialTaskService.listPendingSubmissions(community.id, currentTime)
  if (pending.length === 0) {
    await context.reply(
      '<b>🎯 TASK REVIEW</b>\n\nYou are all caught up. There are no pending submissions.',
      messageOptions(),
    )
    return
  }

  await context.reply(
    renderPendingSocialTasks(pending),
    messageOptions(pendingSocialTaskKeyboard(pending)),
  )
}

async function handleTaskExpire(
  database: RallyoDatabase,
  socialTaskService: SocialTaskService,
  gameConfigurations: CommunityGameConfigService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply('Archive expired tasks from the community group.')
    return
  }
  if (!(await verifyTelegramAdmin(context, context.chat.id, context.from.id))) {
    await context.reply('🔒 Only a verified community admin can archive tasks here.')
    return
  }

  const community = await ensureCommunityFromContext(database, context)
  await rememberVerifiedAdmin(database, context, community.id, currentTime)
  if (!(await gameConfigurations.isEnabled(community.id, 'social_tasks'))) {
    await context.reply(
      '🎯 Social tasks are turned off here. Enable them from /settings > Social tasks.',
    )
    return
  }
  const archived = await socialTaskService.archiveExpired(currentTime, community.id)
  await context.reply(`✅ Archived ${archived} expired task${archived === 1 ? '' : 's'}.`)
}

async function handleManualAward(
  database: RallyoDatabase,
  manualScoreService: ManualScoreService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply('Award points from the community group where the player is active.')
    return
  }
  if (!(await verifyTelegramAdmin(context, context.chat.id, context.from.id))) {
    await context.reply('🔒 Only a verified community admin can award points here.')
    return
  }

  const community = await ensureCommunityFromContext(database, context)
  await rememberVerifiedAdmin(database, context, community.id, currentTime)
  const fields = (context.message?.text ?? '')
    .replace(/^\/award(?:@\w+)?\s*/iu, '')
    .trim()
    .split(/\s+/u)
  const targetTelegramUserId = parseTelegramChatId(fields[0] ?? '')
  const points = Number(fields[1])
  const reason = fields.slice(2).join(' ').trim()

  if (targetTelegramUserId === null || !Number.isSafeInteger(points) || !reason) {
    await context.reply('Format: /award TELEGRAM_USER_ID positive_points reason')
    return
  }

  const [identity] = await database
    .select({
      playerId: schema.telegramIdentities.playerId,
      telegramUserId: schema.telegramIdentities.telegramUserId,
      displayName: schema.telegramIdentities.displayName,
    })
    .from(schema.telegramIdentities)
    .where(eq(schema.telegramIdentities.telegramUserId, targetTelegramUserId))
    .limit(1)
  if (!identity) {
    await context.reply('That player has not joined Rallyo yet. Ask them to send /start first.')
    return
  }

  try {
    const result = await manualScoreService.award({
      communityId: community.id,
      playerId: identity.playerId,
      points,
      reason,
      awardedByTelegramUserId: BigInt(context.from.id),
      idempotencyKey: `manual:${community.id}:telegram-update:${context.update.update_id}`,
      now: currentTime,
    })
    await context.reply(
      `${result.created ? '✅ Awarded' : 'ℹ️ Already awarded'} <b>+${points} pts</b> to ${telegramMention(identity.telegramUserId, identity.displayName)}.`,
      messageOptions(),
    )
  } catch (error) {
    await context.reply(
      error instanceof Error
        ? error.message
        : 'The award could not be recorded. Check the points and active season, then try again.',
    )
  }
}

async function handleSocialTaskReviewCallback(
  database: RallyoDatabase,
  socialTaskService: SocialTaskService,
  context: Context,
  communityId: string,
  submissionId: string,
  action: 'approve' | 'reject',
  currentTime: Date,
): Promise<void> {
  const community = await findCommunityById(database, communityId)
  if (!community || !context.from) {
    await context.answerCallbackQuery({ text: 'This community is no longer available.' })
    return
  }
  const callbackChatId = context.callbackQuery?.message?.chat.id
  const callbackChatType = context.callbackQuery?.message?.chat.type
  if (callbackChatId !== undefined) {
    const validGroupChat =
      (callbackChatType === 'group' || callbackChatType === 'supergroup') &&
      BigInt(callbackChatId) === community.telegramChatId
    const validPrivateChat = callbackChatType === 'private' && callbackChatId === context.from.id
    if (!validGroupChat && !validPrivateChat) {
      await context.answerCallbackQuery({ text: 'This review belongs to another community.' })
      return
    }
  }

  try {
    if (action === 'approve') {
      const result = await socialTaskService.approve({
        submissionId,
        reviewerTelegramUserId: BigInt(context.from.id),
        now: currentTime,
      })
      await context.answerCallbackQuery({ text: 'Submission approved.' })
      await context.reply(
        `✅ Submission approved. <b>+${result.scoreEvent.delta} pts</b> added to the community leaderboard.`,
        messageOptions(),
      )
    } else {
      await socialTaskService.reject({
        submissionId,
        reviewerTelegramUserId: BigInt(context.from.id),
        now: currentTime,
      })
      await context.answerCallbackQuery({ text: 'Submission rejected.' })
      await context.reply('Submission rejected. No points were awarded.', messageOptions())
    }
  } catch (error) {
    await context.answerCallbackQuery({ text: 'This review could not be completed.' })
    await context.reply(
      error instanceof Error
        ? error.message
        : 'This review could not be completed. Refresh the list and try again.',
    )
  }
}

async function handleScrambleStart(
  database: RallyoDatabase,
  gameRegistry: GameRegistry,
  scrambleService: ScrambleService,
  context: Context,
  currentTime: Date,
  presentRound: () => PresentScramble | null,
): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply('Start Scramble from the community group.')
    return
  }

  const community = await ensureCommunityFromContext(database, context)
  if (!(await verifyTelegramAdmin(context, context.chat.id, context.from.id))) {
    await context.reply('Only a verified community admin can start Scramble.')
    return
  }

  try {
    await gameRegistry.canStart({
      gameKey: 'scramble',
      communityId: community.id,
      now: currentTime,
      config: {},
    })
    const season = await activeSeasonForCommunity(database, community.id, currentTime)
    const presenter = presentRound()
    if (!season || !presenter) {
      await context.reply('Scramble needs an active season before it can start.')
      return
    }
    const round = await scrambleService.startRound({
      communityId: community.id,
      seasonId: season.id,
      now: currentTime,
    })
    await presenter({
      communityId: community.id,
      telegramChatId: community.telegramChatId,
      roundId: round.id,
      at: currentTime,
    })
    await context.reply('Scramble is live. Reply with the unscrambled term.')
  } catch (error) {
    await context.reply(friendlyGameError(error, 'Scramble'), messageOptions())
  }
}

async function handleScrambleStop(
  database: RallyoDatabase,
  scrambleService: ScrambleService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context) || !context.from) {
    await context.reply('Stop Scramble from the community group.')
    return
  }

  const community = await findCommunityByTelegramChatId(database, BigInt(context.chat.id))
  if (!community || !(await verifyTelegramAdmin(context, context.chat.id, context.from.id))) {
    await context.reply('Only a verified community admin can stop Scramble.')
    return
  }

  const round = await scrambleService.stopRound(community.id, currentTime)
  if (!round) {
    await context.reply(renderScrambleNoActive())
    return
  }

  await announceScrambleOutcome(
    context,
    scrambleService,
    round,
    renderScrambleStopped(round),
    currentTime,
  )
}

async function handleScrambleHint(
  database: RallyoDatabase,
  scrambleService: ScrambleService,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!isGroupContext(context)) {
    await context.reply('Ask for a Scramble hint from the community group.')
    return
  }

  const community = await findCommunityByTelegramChatId(database, BigInt(context.chat.id))
  const round = community
    ? await scrambleService.activeRoundForCommunity(community.id, currentTime)
    : null
  if (!round) {
    await context.reply(renderScrambleNoActive())
    return
  }

  const result = await scrambleService.requestHint({ roundId: round.id, now: currentTime })
  if (result.status === 'HINT') {
    await context.reply(
      renderScrambleHint({
        hint: result.hint,
        hintNumber: result.round.hintCount,
        maxHints: result.round.maxHints,
        pointsRemaining: result.pointsRemaining,
      }),
      messageOptions(),
    )
  } else if (result.status === 'NOT_READY') {
    const seconds = Math.max(
      1,
      Math.ceil((result.availableAt.getTime() - currentTime.getTime()) / 1_000),
    )
    await context.reply(
      renderScrambleHintUnavailable(`The next hint is ready in ${seconds} sec.`),
      messageOptions(),
    )
  } else if (result.status === 'DISABLED') {
    await context.reply(
      renderScrambleHintUnavailable('Hints are turned off for this community.'),
      messageOptions(),
    )
  } else if (result.status === 'MAX_HINTS') {
    await context.reply(
      renderScrambleHintUnavailable('All configured hints have been revealed.'),
      messageOptions(),
    )
  } else if (result.status === 'TIMEOUT') {
    await context.reply(renderScrambleTimeout(result.round), messageOptions())
    await scrambleService.markOutcomeNotified(result.round.id, currentTime)
  }
}

async function announceScrambleOutcome(
  context: Context,
  scrambleService: ScrambleService,
  round: ScrambleRound,
  text: string,
  currentTime: Date,
): Promise<void> {
  if (round.telegramMessageId !== null && context.chat) {
    try {
      await context.api.editMessageText(
        context.chat.id,
        toTelegramMessageId(round.telegramMessageId),
        text,
        messageOptions(),
      )
      await scrambleService.markOutcomeNotified(round.id, currentTime)
      return
    } catch {
      // Fall back to a new message if the challenge was already edited or removed.
    }
  }
  await context.reply(text, messageOptions())
  await scrambleService.markOutcomeNotified(round.id, currentTime)
}

function roundPresentation(round: {
  readonly presentation: string | null
  readonly mode: (typeof schema.questionMode.enumValues)[number]
}): 'typed' | 'multiple_choice' {
  if (round.presentation === 'multiple_choice') return 'multiple_choice'
  if (round.presentation === 'typed') return 'typed'
  return round.mode === 'QUICK' ? 'multiple_choice' : 'typed'
}

async function handlePlayerCallback(
  database: RallyoDatabase,
  roundService: RoundService,
  walletLinkService: WalletLinkService,
  socialTaskService: SocialTaskService,
  gameConfigurations: CommunityGameConfigService,
  context: Context,
  currentTime: Date,
  appBaseUrl?: string,
): Promise<void> {
  const callback = context.callbackQuery
  if (!callback) {
    return
  }

  const data = callback.data ?? ''
  if (data === 'player:link') {
    await context.answerCallbackQuery()
    await handleLink(database, walletLinkService, context, appBaseUrl, currentTime)
    return
  }
  if (data === 'player:me') {
    await context.answerCallbackQuery()
    await handleMe(database, roundService, context, currentTime, appBaseUrl)
    return
  }
  const [scope, kind, identifier] = data.split(':')
  if (scope === 'player' && kind === 'task' && identifier && context.from) {
    const callbackChat = callback.message?.chat
    if (!callbackChat || (callbackChat.type !== 'group' && callbackChat.type !== 'supergroup')) {
      await context.answerCallbackQuery({ text: 'Open /tasks in a community group first.' })
      return
    }

    const community = await findCommunityByTelegramChatId(database, BigInt(callbackChat.id))
    if (!community) {
      await context.answerCallbackQuery({ text: 'This community is no longer available.' })
      return
    }
    if (!(await gameConfigurations.isEnabled(community.id, 'social_tasks'))) {
      await context.answerCallbackQuery({ text: 'Social tasks are turned off here.' })
      return
    }

    try {
      await socialTaskService.beginSubmissionSession({
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        taskId: identifier,
        now: currentTime,
      })
      await context.answerCallbackQuery({ text: 'Task selected.' })
      await context.reply(
        'Reply with <code>/task_submit URL-or-reference</code>. This submission step expires soon.',
        messageOptions(),
      )
    } catch (error) {
      await context.answerCallbackQuery({ text: 'This task is no longer available.' })
      await context.reply(
        error instanceof Error ? error.message : 'The task is no longer available.',
      )
    }
    return
  }
  const [, quickKind, roundId, optionIndexValue] = data.split(':')

  if (quickKind !== 'quick' || !roundId || optionIndexValue === undefined) {
    await context.answerCallbackQuery({ text: 'That player action is not available here.' })
    return
  }

  const optionIndex = Number(optionIndexValue)
  const callbackChat = callback.message?.chat

  if (
    !Number.isSafeInteger(optionIndex) ||
    optionIndex < 0 ||
    !callbackChat ||
    (callbackChat.type !== 'group' && callbackChat.type !== 'supergroup') ||
    !context.from
  ) {
    await context.answerCallbackQuery({ text: 'This answer is no longer available.' })
    return
  }

  const community = await findCommunityByTelegramChatId(database, BigInt(callbackChat.id))
  const round = community
    ? await roundService.liveRoundForCommunity(community.id, currentTime)
    : null
  const option = round?.id === roundId ? round.options?.[optionIndex] : undefined

  if (!round || roundPresentation(round) !== 'multiple_choice' || !option || !callback.id) {
    await context.answerCallbackQuery({ text: 'This round is closed.' })
    return
  }

  const { playerId } = await ensureTelegramPlayer(database, context)
  const result = await roundService.submitQuickQuizAnswer({
    telegramUpdateId: BigInt(context.update.update_id),
    telegramInputId: `callback:${callback.id}`,
    roundId,
    playerId,
    rawAnswer: option.value,
    now: currentTime,
    updateAlreadyClaimed: true,
  })

  const feedback =
    result.status === 'ACCEPTED'
      ? `+${result.points} pts`
      : result.status === 'WRONG'
        ? 'Answer recorded'
        : result.status === 'DUPLICATE_ANSWER'
          ? 'You already answered'
          : 'This round is closed'

  if (result.status === 'ACCEPTED' && round.presentation && context.from) {
    const winner = telegramUserLabel(context.from)
    const rank = await roundService.rankForPlayerInSeason(community!.id, round.seasonId, playerId)
    const resultMessage = renderProjectQuizAnswered({
      prompt: round.prompt,
      answer: option.value,
      winner,
      winnerMention: telegramMention(context.from.id, winner),
      points: result.points,
      rank,
    })

    if (callback.message) {
      try {
        await context.api.editMessageText(
          callback.message.chat.id,
          callback.message.message_id,
          resultMessage,
          messageOptions(),
        )
      } catch {
        await context.reply(resultMessage, messageOptions())
      }
    } else {
      await context.reply(resultMessage, messageOptions())
    }
  }

  await context.answerCallbackQuery({ text: feedback })
}

async function handleAdminCallback(
  database: RallyoDatabase,
  roundService: RoundService,
  scheduledQuizService: ScheduledQuizService,
  gameConfigurations: CommunityGameConfigService,
  scrambleService: ScrambleService,
  wordSeekService: WordSeekService,
  socialTaskService: SocialTaskService,
  context: Context,
  currentTime: Date,
  presentRound: () => PresentRound | null,
  presentScramble: () => PresentScramble | null,
  presentWordSeek: () => PresentWordSeek | null,
): Promise<void> {
  const callback = context.callbackQuery
  if (!callback || !context.from) return

  const [, action, communityId, argument] = (callback.data ?? '').split(':')
  if (!communityId || !action) {
    await context.answerCallbackQuery({ text: 'This admin action is unavailable.' })
    return
  }

  if (action === 'wordseek_approve') {
    await handleWordSeekApprovalCallback(database, wordSeekService, context, communityId)
    return
  }

  if (action === 'task_approve' || action === 'task_reject') {
    const submission = await socialTaskService.communityForSubmission(communityId)
    const community = submission ? await findCommunityById(database, submission.communityId) : null
    if (!community) {
      await context.answerCallbackQuery({ text: 'This community is no longer available.' })
      return
    }
    if (
      !(await verifyTelegramAdmin(
        context,
        toTelegramApiChatId(community.telegramChatId),
        context.from.id,
      ))
    ) {
      await context.answerCallbackQuery({ text: 'We could not verify your admin access.' })
      return
    }
    await rememberVerifiedAdmin(database, context, community.id, currentTime)
    await handleSocialTaskReviewCallback(
      database,
      socialTaskService,
      context,
      community.id,
      communityId,
      action === 'task_approve' ? 'approve' : 'reject',
      currentTime,
    )
    return
  }

  const community = await findCommunityById(database, communityId)
  if (!community) {
    await context.answerCallbackQuery({ text: 'This community is no longer available.' })
    return
  }

  if (
    !(await verifyTelegramAdmin(
      context,
      toTelegramApiChatId(community.telegramChatId),
      context.from.id,
    ))
  ) {
    await context.answerCallbackQuery({ text: 'We could not verify your admin access.' })
    return
  }

  const navigationPage =
    action === 'section' && argument
      ? navigationPageForSection(argument)
      : action === 'game' && argument
        ? navigationPageForGame(argument)
        : (action === 'back' || action === 'refresh_page') && argument
          ? navigationPageForTarget(argument)
          : null

  try {
    if (navigationPage) {
      const page = await renderAdminNavigationPage(
        database,
        gameConfigurations,
        roundService,
        wordSeekService,
        scrambleService,
        socialTaskService,
        community.id,
        navigationPage,
        currentTime,
      )
      await context.reply(page.text, messageOptions(page.keyboard))
    } else if (action === 'select' || action === 'refresh') {
      const page = await renderAdminNavigationPage(
        database,
        gameConfigurations,
        roundService,
        wordSeekService,
        scrambleService,
        socialTaskService,
        community.id,
        'home',
        currentTime,
      )
      await context.reply(page.text, messageOptions(page.keyboard))
    } else if (action === 'task_review') {
      await handleTaskReview(
        database,
        socialTaskService,
        gameConfigurations,
        context,
        currentTime,
        community.id,
      )
    } else if (action === 'toggle') {
      const capabilityByCallbackKey: Record<string, string> = {
        // Compact keys are used for new keyboards. The full names remain accepted
        // so an already-delivered older keyboard still resolves safely.
        ws: 'word_seek',
        sc: 'scramble',
        tasks: 'social_tasks',
        activity: 'message_activity',
        word_seek: 'word_seek',
        scramble: 'scramble',
        social_tasks: 'social_tasks',
        message_activity: 'message_activity',
      }
      const capabilityKey = argument ? capabilityByCallbackKey[argument] : undefined
      if (!capabilityKey) {
        await context.answerCallbackQuery({ text: 'That capability cannot be changed here.' })
        return
      }
      const current = await gameConfigurations.get(community.id, capabilityKey)
      await gameConfigurations.set({
        communityId: community.id,
        gameKey: capabilityKey,
        enabled: !(current?.enabled ?? false),
        config: current?.config ?? {},
      })
      const page = await renderAdminNavigationPage(
        database,
        gameConfigurations,
        roundService,
        wordSeekService,
        scrambleService,
        socialTaskService,
        community.id,
        navigationPageForCapability(capabilityKey),
        currentTime,
      )
      await context.reply(page.text, messageOptions(page.keyboard))
    } else if (action === 'run') {
      if (!(await gameConfigurations.isEnabled(community.id, 'project_quiz'))) {
        await context.reply(
          '🧠 Project Quiz is turned off for this community. Open Games in /settings to enable it.',
          messageOptions(),
        )
        await context.answerCallbackQuery({ text: 'Project Quiz is turned off.' })
        return
      }
      const season = await activeSeasonForCommunity(database, community.id, currentTime)
      const projectQuizConfiguration = await gameConfigurations.getProjectQuizConfig(community.id)
      const question = await firstApprovedQuestion(
        database,
        community.id,
        projectQuizConfiguration.config.contentSource,
      )
      const presenter = presentRound()
      if (!season) {
        await context.reply(
          'Project Quiz needs an active season before it can start. Open Season & points in /settings, then ask a platform operator to activate the season.',
          messageOptions(),
        )
      } else if (!question) {
        await context.reply(
          'Project Quiz has no approved questions ready for this community. Add or approve content from Project content in /settings.',
          messageOptions(),
        )
      } else if (!presenter) {
        await context.reply(
          'Project Quiz is still preparing the community game. Try again in a moment.',
        )
      } else {
        const round = await roundService.startLiveRound({
          communityId: community.id,
          seasonId: season.id,
          questionId: question.id,
          startsAt: currentTime,
          now: currentTime,
        })
        await presenter({
          communityId: community.id,
          telegramChatId: community.telegramChatId,
          roundId: round.id,
          at: currentTime,
        })
        await context.reply('🧠 Project Quiz is live. Players can reply in the community now.')
      }
    } else if (action === 'scramble_start') {
      if (!(await gameConfigurations.isEnabled(community.id, 'scramble'))) {
        await context.reply(
          '🔀 Scramble is turned off for this community. Open Games in /settings to enable it.',
          messageOptions(),
        )
        await context.answerCallbackQuery({ text: 'Scramble is turned off.' })
        return
      }
      const season = await activeSeasonForCommunity(database, community.id, currentTime)
      const presenter = presentScramble()
      if (!season) {
        await context.reply(
          'Scramble needs an active season before it can start. Open Season & points in /settings, then ask a platform operator to activate the season.',
          messageOptions(),
        )
      } else if (!presenter) {
        await context.reply(
          'Scramble is still preparing the community game. Try again in a moment.',
        )
      } else {
        const round = await scrambleService.startRound({
          communityId: community.id,
          seasonId: season.id,
          now: currentTime,
        })
        await presenter({
          communityId: community.id,
          telegramChatId: community.telegramChatId,
          roundId: round.id,
          at: currentTime,
        })
        await context.reply(
          '🔀 Scramble is live. Reply with the unscrambled term in the community.',
        )
      }
    } else if (action === 'scramble_stop') {
      const ended = await scrambleService.stopRound(community.id, currentTime)
      if (!ended) {
        await context.reply(renderScrambleNoActive())
      } else {
        await context.api.sendMessage(
          toTelegramApiChatId(community.telegramChatId),
          renderScrambleStopped(ended),
          messageOptions(),
        )
        await scrambleService.markOutcomeNotified(ended.id, currentTime)
        await context.reply('Scramble stopped in the community.')
      }
    } else if (action === 'wordseek') {
      if (!(await gameConfigurations.isEnabled(community.id, 'word_seek'))) {
        await context.reply(
          '🔎 Word Seek is turned off for this community. Open Games in /settings to enable it.',
          messageOptions(),
        )
        await context.answerCallbackQuery({ text: 'Word Seek is turned off.' })
        return
      }
      const season = await activeSeasonForCommunity(database, community.id, currentTime)
      const presenter = presentWordSeek()
      if (!season) {
        await context.reply(
          'Word Seek needs an active season before it can start. Open Season & points in /settings, then ask a platform operator to activate the season.',
          messageOptions(),
        )
      } else if (!presenter) {
        await context.reply(
          'Word Seek is still preparing the community game. Try again in a moment.',
        )
      } else {
        const session = await wordSeekService.start({
          communityId: community.id,
          seasonId: season.id,
          startsAt: currentTime,
          now: currentTime,
        })
        await presenter({
          communityId: community.id,
          telegramChatId: community.telegramChatId,
          sessionId: session.id,
        })
        await context.reply('🔎 Word Seek is live. Send a guess in the community.')
      }
    } else if (action === 'wordseekend') {
      const ended = await wordSeekService.endSession({
        communityId: community.id,
        now: currentTime,
      })
      if (!ended) {
        await context.reply('There is no active Word Seek round in this community.')
      } else {
        await context.api.sendMessage(
          toTelegramApiChatId(community.telegramChatId),
          renderWordSeekEnded({
            communityTitle: community.title,
            word: ended.targetWord,
            reason: 'ADMIN',
          }),
          messageOptions(),
        )
        await context.reply('Word Seek ended in the community.')
      }
    } else if (action === 'wordseek_words') {
      const vocabulary = await renderWordSeekVocabulary(database, community.id)
      await context.reply(vocabulary.text, messageOptions(vocabulary.keyboard))
    } else if (action === 'schedule') {
      await saveAdminWizardSession(database, {
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        state: 'SOURCE',
        now: currentTime,
      })
      await context.reply(
        'SCHEDULE QUIZ\n\nChoose the question source.',
        messageOptions(sourceKeyboard(community.id)),
      )
    } else if (action === 'source') {
      const active = await getAdminWizardSession(
        database,
        BigInt(context.from.id),
        community.id,
        currentTime,
      )
      if (!active || active.state !== 'SOURCE') {
        await context.answerCallbackQuery({
          text: 'This setup step is closed. Start Schedule again.',
        })
        return
      }
      await saveAdminWizardSession(database, {
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        state: 'QUESTION_COUNT',
        data: { sourcePolicy: argument === 'default' ? 'DEFAULT' : 'MANUAL' },
        now: currentTime,
      })
      await context.reply(
        'How many questions? Reply with any whole number from 1 to 10.',
        messageOptions(questionCountKeyboard(community.id)),
      )
    } else if (action === 'count') {
      await context.answerCallbackQuery({
        text: 'Reply with a whole number from 1 to 10.',
      })
      return
    } else if (action === 'pick' && argument) {
      const session = await getAdminWizardSession(
        database,
        BigInt(context.from.id),
        community.id,
        currentTime,
      )
      if (!session || session.state !== 'QUESTION_SELECT') {
        await context.answerCallbackQuery({ text: 'This question selection is closed.' })
        return
      }
      const page = numberValue(session.data.questionPage) ?? 0
      const selected = arrayOfStrings(session.data.selectedQuestionIds)
      const questions = await eligibleQuestionsForCommunity(database, community.id, currentTime)
      const questionChoices = arrayOfStrings(session.data.questionChoices)
      const questionIndex = Number(argument)
      const questionId = uuidLike(argument)
        ? argument
        : Number.isSafeInteger(questionIndex) && questionIndex >= 0
          ? (questionChoices[questionIndex] ?? questions[questionIndex]?.id)
          : undefined
      const question = questionId
        ? questions.find((candidate) => candidate.id === questionId)
        : undefined
      if (!question) {
        await context.answerCallbackQuery({ text: 'That question is no longer eligible.' })
        return
      }
      const nextSelected = selected.includes(question.id)
        ? selected.filter((id) => id !== question.id)
        : [...selected, question.id]
      await saveAdminWizardSession(database, {
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        state: 'QUESTION_SELECT',
        data: { ...session.data, selectedQuestionIds: nextSelected },
        now: currentTime,
      })
      await context.editMessageText(
        renderQuestionSelection(
          questions,
          page,
          numberValue(session.data.questionCount) ?? 1,
          nextSelected,
        ),
        messageOptions(
          questionSelectionKeyboard(
            community.id,
            questions,
            page,
            nextSelected,
            numberValue(session.data.questionCount) ?? 1,
          ),
        ),
      )
    } else if (action === 'pickpage' && argument) {
      const session = await getAdminWizardSession(
        database,
        BigInt(context.from.id),
        community.id,
        currentTime,
      )
      if (!session || session.state !== 'QUESTION_SELECT') {
        await context.answerCallbackQuery({ text: 'This question selection is closed.' })
        return
      }
      const questions = await eligibleQuestionsForCommunity(database, community.id, currentTime)
      const page = Math.max(0, Number(argument))
      const selected = arrayOfStrings(session.data.selectedQuestionIds)
      await context.editMessageText(
        renderQuestionSelection(
          questions,
          page,
          numberValue(session.data.questionCount) ?? 1,
          selected,
        ),
        messageOptions(
          questionSelectionKeyboard(
            community.id,
            questions,
            page,
            selected,
            numberValue(session.data.questionCount) ?? 1,
          ),
        ),
      )
    } else if (action === 'pickdone') {
      const session = await getAdminWizardSession(
        database,
        BigInt(context.from.id),
        community.id,
        currentTime,
      )
      if (!session || session.state !== 'QUESTION_SELECT') {
        await context.answerCallbackQuery({ text: 'This question selection is closed.' })
        return
      }
      const selected = arrayOfStrings(session.data.selectedQuestionIds)
      const expected = numberValue(session.data.questionCount)
      if (!expected || selected.length !== expected) {
        await context.answerCallbackQuery({
          text: `Select exactly ${expected ?? 'the requested number'} questions.`,
        })
        return
      }
      await saveAdminWizardSession(database, {
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        state: 'DURATION',
        data: { ...session.data, questionIds: selected },
        now: currentTime,
      })
      await context.reply('Time per question?', messageOptions(durationKeyboard(community.id)))
    } else if (action === 'duration' && argument) {
      const seconds = Number(argument)
      const session = await getAdminWizardSession(
        database,
        BigInt(context.from.id),
        community.id,
        currentTime,
      )
      if (!session || session.state !== 'DURATION') {
        await context.answerCallbackQuery({
          text: 'This setup step is closed. Start Schedule again.',
        })
        return
      }
      await saveAdminWizardSession(database, {
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        state: 'POINTS',
        data: { ...(session?.data ?? {}), perQuestionSeconds: seconds },
        now: currentTime,
      })
      await context.reply(
        'Choose the points profile.',
        messageOptions(pointsKeyboard(community.id)),
      )
    } else if (action === 'points') {
      const session = await getAdminWizardSession(
        database,
        BigInt(context.from.id),
        community.id,
        currentTime,
      )
      if (!session || session.state !== 'POINTS') {
        await context.answerCallbackQuery({
          text: 'This setup step is closed. Start Schedule again.',
        })
        return
      }
      await saveAdminWizardSession(database, {
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        state: 'CONFIRM',
        data: { ...(session?.data ?? {}), pointsProfile: 'DEFAULT' },
        now: currentTime,
      })
      await context.reply(
        renderScheduleSummary({ ...(session?.data ?? {}), pointsProfile: 'DEFAULT' }),
        messageOptions(confirmKeyboard(community.id)),
      )
    } else if (action === 'confirm') {
      const session = await getAdminWizardSession(
        database,
        BigInt(context.from.id),
        community.id,
        currentTime,
      )
      const data = session?.data ?? {}
      if (!session || session.state !== 'CONFIRM') {
        await context.answerCallbackQuery({
          text: 'This setup step is closed. Start Schedule again.',
        })
        return
      }
      const questionIds = arrayOfStrings(data.questionIds)
      const questionCount = numberValue(data.questionCount)
      const perQuestionSeconds = numberValue(data.perQuestionSeconds)
      const season = await activeSeasonForCommunity(
        database,
        community.id,
        new Date(currentTime.getTime() + 60_000),
      )
      if (!season || !session || questionIds.length !== questionCount || !perQuestionSeconds) {
        await context.reply('This setup expired or is incomplete. Start Schedule again.')
      } else {
        const created = await scheduledQuizService.create({
          communityId: community.id,
          seasonId: season.id,
          name: 'Telegram scheduled quiz',
          sourcePolicy: stringValue(data.sourcePolicy) ?? 'MANUAL',
          startsAt: new Date(currentTime.getTime() + 60_000),
          perQuestionSeconds,
          questionIds,
        })
        await clearAdminWizardSession(database, BigInt(context.from.id), community.id)
        await context.reply(
          `Scheduled ${questionIds.length} question${questionIds.length === 1 ? '' : 's'} for ${new Date(currentTime.getTime() + 60_000).toISOString()}.\n<code>${created.quiz.id}</code>`,
          messageOptions(),
        )
      }
    } else if (action === 'cancel') {
      await clearAdminWizardSession(database, BigInt(context.from.id), community.id)
      await context.reply('Schedule cancelled.')
    } else if (action === 'questions') {
      await saveAdminWizardSession(database, {
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        state: 'MANUAL_QUESTION',
        now: currentTime,
      })
      await context.reply(
        'CREATE QUESTION\n\nMCQ|Prompt|Correct option|Option A|Option B|...\nFREE|Prompt|Correct answer|alias1,alias2\n\nReply /cancel to stop.',
        messageOptions(cancelOnlyKeyboard(community.id)),
      )
    } else if (action === 'pause') {
      await database
        .update(schema.communities)
        .set({ automaticRoundsEnabled: !community.automaticRoundsEnabled })
        .where(eq(schema.communities.id, community.id))
      const page = await renderAdminNavigationPage(
        database,
        gameConfigurations,
        roundService,
        wordSeekService,
        scrambleService,
        socialTaskService,
        community.id,
        'season',
        currentTime,
      )
      await context.reply(page.text, messageOptions(page.keyboard))
    } else {
      await context.answerCallbackQuery({ text: 'This admin action is unavailable.' })
      return
    }
    await context.answerCallbackQuery({ text: 'Updated.' })
  } catch (error) {
    await context.answerCallbackQuery({ text: 'That action could not be completed.' })
    await context.reply(error instanceof Error ? error.message : 'The admin action failed.')
  }
}

async function handleAdminText(
  database: RallyoDatabase,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!context.from || !context.message?.text) return
  const session = await getActiveAdminWizardSession(database, BigInt(context.from.id), currentTime)
  if (!session) return
  const community = await findCommunityById(database, session.communityId)
  if (!community) return

  if (
    !(await verifyTelegramAdmin(
      context,
      toTelegramApiChatId(community.telegramChatId),
      context.from.id,
    ))
  ) {
    await clearAdminWizardSession(database, BigInt(context.from.id), community.id)
    await context.reply('We could not verify your admin access. Open /settings in the group again.')
    return
  }

  const text = context.message.text.trim()
  if (text.toLowerCase() === '/cancel' || text.toLowerCase() === 'cancel') {
    await clearAdminWizardSession(database, BigInt(context.from.id), community.id)
    await context.reply('Setup cancelled. Nothing was scheduled or created.')
    return
  }

  if (session.state === 'QUESTION_COUNT') {
    const count = Number(text)
    if (!Number.isSafeInteger(count) || count < 1 || count > 10) {
      await context.reply('Reply with a whole number from 1 to 10. You can also tap Cancel.')
      return
    }
    const eligible = await eligibleQuestionsForCommunity(database, community.id, currentTime)
    if (eligible.length < count) {
      await context.reply(
        `Only ${eligible.length} eligible approved question${eligible.length === 1 ? '' : 's'} are available after cooldown. Reply with a smaller number or /cancel.`,
      )
      return
    }
    if (session.data.sourcePolicy === 'DEFAULT') {
      const questionIds = eligible.slice(0, count).map((question) => question.id)
      await saveAdminWizardSession(database, {
        telegramUserId: BigInt(context.from.id),
        communityId: community.id,
        state: 'DURATION',
        data: { ...session.data, questionIds, questionCount: count },
        now: currentTime,
      })
      await context.reply('Time per question?', messageOptions(durationKeyboard(community.id)))
      return
    }
    await saveAdminWizardSession(database, {
      telegramUserId: BigInt(context.from.id),
      communityId: community.id,
      state: 'QUESTION_SELECT',
      data: {
        ...session.data,
        questionCount: count,
        questionPage: 0,
        questionChoices: eligible.map((question) => question.id),
        selectedQuestionIds: [],
      },
      now: currentTime,
    })
    await context.reply(
      renderQuestionSelection(eligible, 0, count, []),
      messageOptions(questionSelectionKeyboard(community.id, eligible, 0, [], count)),
    )
  } else if (session.state === 'QUESTION_IDS') {
    const ids = context.message.text
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const expected = numberValue(session.data.questionCount)
    if (!expected || ids.length !== expected || ids.some((id) => !uuidLike(id))) {
      await context.reply(
        `Send exactly ${expected ?? 'the requested number of'} valid question UUIDs separated by commas.`,
      )
      return
    }
    await saveAdminWizardSession(database, {
      telegramUserId: BigInt(context.from.id),
      communityId: community.id,
      state: 'DURATION',
      data: { ...session.data, questionIds: ids },
      now: currentTime,
    })
    await context.reply('Time per question?', messageOptions(durationKeyboard(community.id)))
  } else if (session.state === 'MANUAL_QUESTION') {
    const question = parseManualQuestion(context.message.text, community.id)
    if (!question) {
      await context.reply(
        'Invalid format. Use MCQ|Prompt|Correct option|Option A|Option B|... or FREE|Prompt|Correct answer|alias1,alias2',
      )
      return
    }
    const [created] = await database
      .insert(schema.questions)
      .values(question)
      .returning({ id: schema.questions.id })
    await clearAdminWizardSession(database, BigInt(context.from.id), community.id)
    await context.reply(
      `Approved question created. UUID: <code>${created?.id ?? 'unknown'}</code>`,
      messageOptions(),
    )
  }
}

async function handleSettings(
  database: RallyoDatabase,
  context: Context,
  currentTime: Date,
): Promise<void> {
  if (!context.from) {
    return
  }

  if (isGroupContext(context)) {
    const community = await ensureCommunityFromContext(database, context)
    const isAdmin = await verifyTelegramAdmin(context, context.chat.id, context.from.id)

    if (!isAdmin) {
      await context.reply(
        '🔒 Community settings are for group admins. Ask a Telegram administrator to open them.',
      )
      return
    }

    await recordVerifiedAdmin(database, {
      communityId: community.id,
      telegramUserId: BigInt(context.from.id),
      verifiedAt: currentTime,
    })

    try {
      await context.api.sendMessage(
        context.from.id,
        await renderAdminMenu(database, community.id, currentTime),
        messageOptions(adminKeyboard(community.id)),
      )
      await context.reply('⚙️ Your community settings are ready in a private chat with Rallyo.')
    } catch {
      await context.reply(
        'I could not open your private settings yet. Send /start to Rallyo in a private chat, then run /settings in this group again.',
      )
    }
    return
  }

  const chatIdArgument = commandArguments(context)[0]

  if (!chatIdArgument) {
    const communities = await listAdminCommunities(database, BigInt(context.from.id))

    if (communities.length === 0) {
      await context.reply(
        'You do not have a saved community yet. Run /settings in a group where you are a Telegram admin, then return here.',
      )
      return
    }

    if (communities.length === 1 && communities[0]) {
      const community = await findCommunityById(database, communities[0].id)
      if (community) {
        await context.reply(
          await renderAdminMenu(database, community.id, currentTime),
          messageOptions(adminKeyboard(community.id)),
        )
        return
      }
    }

    await context.reply(
      '<b>⚙️ YOUR COMMUNITIES</b>\n\nChoose a community to manage.',
      messageOptions(communitySelectionKeyboard(communities)),
    )
    return
  }

  const targetChatId = parseTelegramChatId(chatIdArgument)

  if (targetChatId === null) {
    await context.reply(
      'To open a specific community, use its numeric Telegram chat ID, for example <code>/settings -1001234567890</code>.',
      messageOptions(),
    )
    return
  }

  const community = await findCommunityByTelegramChatId(database, targetChatId)

  if (!community) {
    await context.reply(
      'I could not find that community. Make sure Rallyo is in the group, then run /settings there once.',
    )
    return
  }

  const isAdmin = await verifyTelegramAdmin(
    context,
    toTelegramApiChatId(targetChatId),
    context.from.id,
  )

  if (!isAdmin) {
    await context.reply(
      'I could not verify you as an admin for that community. Run /settings from the group or ask a group admin to help.',
    )
    return
  }

  await recordVerifiedAdmin(database, {
    communityId: community.id,
    telegramUserId: BigInt(context.from.id),
    verifiedAt: currentTime,
  })
  await context.reply(
    await renderAdminMenu(database, community.id, currentTime),
    messageOptions(adminKeyboard(community.id)),
  )
}

async function handleMe(
  database: RallyoDatabase,
  roundService: RoundService,
  context: Context,
  currentTime: Date,
  appBaseUrl?: string,
): Promise<void> {
  if (!context.from) return

  const { playerId } = await ensureTelegramPlayer(database, context)
  const lifetimeXp = await roundService.lifetimeXpForPlayer(playerId)
  const activeSeasons = await database
    .select({ id: schema.seasons.id, communityId: schema.seasons.communityId })
    .from(schema.seasons)
    .where(
      and(
        eq(schema.seasons.status, 'ACTIVE'),
        lte(schema.seasons.startsAt, currentTime),
        gt(schema.seasons.endsAt, currentTime),
      ),
    )
    .limit(1)
  const activeSeason = activeSeasons[0]
  const communityRows = await database
    .select({ communityId: schema.scoreEvents.communityId })
    .from(schema.scoreEvents)
    .where(eq(schema.scoreEvents.playerId, playerId))
  const scoredCommunityCount = new Set(communityRows.map((row) => row.communityId)).size

  let weeklyMessage = 'No active season is running yet.'

  if (activeSeason) {
    const leaderboard = await roundService.leaderboardForSeason(
      activeSeason.communityId,
      activeSeason.id,
    )
    const playerRow = leaderboard.find((row) => row.playerId === playerId)
    weeklyMessage = playerRow
      ? `#${playerRow.rank} · ${playerRow.points} pts`
      : 'No completed rounds yet.'
  }

  const [wallet] = await database
    .select({ id: schema.walletIdentities.id })
    .from(schema.walletIdentities)
    .where(
      and(
        eq(schema.walletIdentities.playerId, playerId),
        isNull(schema.walletIdentities.revokedAt),
      ),
    )
    .limit(1)

  const walletMessage = wallet
    ? '<b>🔗 Nimiq wallet linked</b>'
    : '<b>🔗 Nimiq wallet not linked</b>\n\nYou can keep playing without a wallet. Link one when you want wallet-backed identity or Rallyo-native rewards.'

  await context.reply(
    `<b>📊 YOUR RALLYO</b>\n\nCurrent season\n${weeklyMessage}\n\nLifetime score · ${lifetimeXp}\nCommunities with score · ${scoredCommunityCount}\n\n${walletMessage}`,
    messageOptions(playerKeyboard(appBaseUrl)),
  )
}

async function ensureTelegramPlayer(database: RallyoDatabase, context: Context) {
  if (!context.from) {
    throw new Error('Telegram update has no user identity.')
  }

  return upsertTelegramIdentity(database, {
    telegramUserId: BigInt(context.from.id),
    username: context.from.username ?? null,
    displayName:
      [context.from.first_name, context.from.last_name].filter(Boolean).join(' ') ||
      context.from.username ||
      'Telegram player',
  })
}

async function handleLink(
  database: RallyoDatabase,
  walletLinkService: WalletLinkService,
  context: Context,
  appBaseUrl: string | undefined,
  currentTime: Date,
): Promise<void> {
  if (!context.from || context.chat?.type !== 'private') {
    await context.reply('Open a private chat with Rallyo and send /link to connect a wallet.')
    return
  }
  const { telegramIdentityId } = await ensureTelegramPlayer(database, context)
  const issued = await walletLinkService.issueCode({ telegramIdentityId, now: currentTime })
  const link = appBaseUrl
    ? `${appBaseUrl.replace(/\/$/, '')}/?link=${encodeURIComponent(issued.code)}`
    : null
  await context.reply(
    link
      ? `<b>WALLET LINK CODE</b>\n\nOpen Player HQ:\n${escapeHtml(link)}\n\nThis code expires in 10 minutes and can be used once.`
      : `<b>WALLET LINK CODE</b>\n\n<code>${issued.code}</code>\n\nThis code expires in 10 minutes and can be used once.`,
    messageOptions(),
  )
}

async function ensureCommunityFromContext(database: RallyoDatabase, context: Context) {
  if (!isGroupContext(context)) {
    throw new Error('Community installation requires a group context.')
  }

  return upsertCommunity(database, {
    telegramChatId: BigInt(context.chat.id),
    title: context.chat.title,
  })
}

async function findCommunityById(database: RallyoDatabase, communityId: string) {
  const [community] = await database
    .select({
      id: schema.communities.id,
      telegramChatId: schema.communities.telegramChatId,
      title: schema.communities.title,
      status: schema.communities.status,
      automaticRoundsEnabled: schema.communities.automaticRoundsEnabled,
    })
    .from(schema.communities)
    .where(eq(schema.communities.id, communityId))
  return community ?? null
}

async function verifyTelegramAdmin(
  context: Context,
  chatId: number,
  userId: number,
): Promise<boolean> {
  try {
    const member = await context.api.getChatMember(chatId, userId)
    return member.status === 'administrator' || member.status === 'creator'
  } catch {
    return false
  }
}

async function rememberVerifiedAdmin(
  database: RallyoDatabase,
  context: Context,
  communityId: string,
  verifiedAt: Date,
): Promise<void> {
  if (!context.from) return
  await recordVerifiedAdmin(database, {
    communityId,
    telegramUserId: BigInt(context.from.id),
    verifiedAt,
  })
}

async function renderAdminMenu(
  database: RallyoDatabase,
  communityId: string,
  currentTime: Date,
): Promise<string> {
  const snapshot = await communityAdminSnapshot(database, communityId, currentTime)

  if (!snapshot) {
    throw new Error('Community disappeared while rendering admin menu.')
  }

  const nextRound = snapshot.nextRoundAt
    ? snapshot.nextRoundAt.toISOString().slice(11, 16)
    : 'Not scheduled'
  const season = snapshot.currentSeason ? escapeHtml(snapshot.currentSeason) : 'No active season'
  const capabilityConfigs = await database
    .select({
      gameKey: schema.communityGameConfigs.gameKey,
      enabled: schema.communityGameConfigs.enabled,
    })
    .from(schema.communityGameConfigs)
    .where(
      and(
        eq(schema.communityGameConfigs.communityId, communityId),
        or(
          eq(schema.communityGameConfigs.gameKey, 'social_tasks'),
          eq(schema.communityGameConfigs.gameKey, 'message_activity'),
        ),
      ),
    )
  const capabilityStatus = (key: string) =>
    capabilityConfigs.find((config) => config.gameKey === key)?.enabled
      ? '✅ Enabled'
      : '⛔ Disabled'

  return `<b>⚙️ COMMUNITY SETTINGS</b>\n\n<b>${escapeHtml(snapshot.community.title)}</b>\n\n🏁 Season · ${season}\n🔁 Automatic rounds · ${snapshot.community.automaticRoundsEnabled ? '✅ Running' : '⏸ Paused'}\n🎮 Games · open Games to manage each one\n🎯 Social tasks · ${capabilityStatus('social_tasks')}\n📊 Activity · ${capabilityStatus('message_activity')}\n📝 Approved questions · ${snapshot.readyQuestionCount}\n⏱ Next quiz · ${nextRound}\n\nChoose a section below. Changes apply to this community only.`
}

async function renderAdminNavigationPage(
  database: RallyoDatabase,
  gameConfigurations: CommunityGameConfigService,
  roundService: RoundService,
  wordSeekService: WordSeekService,
  scrambleService: ScrambleService,
  socialTaskService: SocialTaskService,
  communityId: string,
  page: AdminNavigationPage,
  currentTime: Date,
): Promise<{ readonly text: string; readonly keyboard: InlineKeyboard }> {
  if (page === 'home') {
    return {
      text: await renderAdminMenu(database, communityId, currentTime),
      keyboard: adminKeyboard(communityId),
    }
  }

  if (page === 'games') {
    const projectQuiz = await gameConfigurations.getProjectQuizConfig(communityId)
    const projectQuizLive = await roundService.liveRoundForCommunity(communityId, currentTime)
    const wordSeekConfig = await gameConfigurations.get(communityId, 'word_seek')
    const wordSeekSession = await wordSeekService.activeSession(communityId)
    const scrambleConfig = await gameConfigurations.get(communityId, 'scramble')
    const scrambleRound = await scrambleService.activeRoundForCommunity(communityId, currentTime)
    return {
      text: `<b>🎮 GAMES</b>\n\n<b>🧠 Project Quiz / Race</b>\n${(projectQuiz.row?.enabled ?? true) ? '✅ Enabled' : '⛔ Disabled'} · ${projectQuizLive ? '🟢 Live now' : 'Ready'}\n\n<b>🔎 Word Seek</b>\n${wordSeekConfig?.enabled ? '✅ Enabled' : '⛔ Disabled'} · ${wordSeekSession ? '🟢 Live now' : 'Ready'}\n\n<b>🔀 Scramble</b>\n${scrambleConfig?.enabled ? '✅ Enabled' : '⛔ Disabled'} · ${scrambleRound ? '🟢 Live now' : 'Ready'}\n\nChoose a game to view its controls and content options.`,
      keyboard: gamesKeyboard(communityId),
    }
  }

  if (page === 'season') {
    const snapshot = await communityAdminSnapshot(database, communityId, currentTime)
    if (!snapshot) throw new Error('This community is no longer available.')
    const season = snapshot.currentSeason ? escapeHtml(snapshot.currentSeason) : 'No active season'
    const nextRound = snapshot.nextRoundAt
      ? `${snapshot.nextRoundAt.toISOString().slice(11, 16)} UTC`
      : 'No quiz scheduled'
    return {
      text: `<b>🏁 SEASON &amp; POINTS</b>\n\n<b>${escapeHtml(snapshot.community.title)}</b>\nSeason · ${season}\nAutomatic rounds · ${snapshot.community.automaticRoundsEnabled ? '✅ Running' : '⏸ Paused'}\nNext quiz · ${nextRound}\n\nGames, approved tasks, and positive admin awards enter one community leaderboard. Activity counts do not award points.\n\n${snapshot.currentSeason ? 'You can schedule approved questions or pause automatic rounds here.' : 'An active season is required before a game or points award can start. A platform operator must activate one first.'}`,
      keyboard: seasonKeyboard(communityId),
    }
  }

  if (page === 'tasks') {
    const enabled = await gameConfigurations.isEnabled(communityId, 'social_tasks')
    const pending = await socialTaskService.listPendingSubmissions(communityId, currentTime)
    const active = await socialTaskService.listActive(communityId, currentTime)
    return {
      text: `<b>🎯 SOCIAL TASKS</b>\n\nStatus · ${enabled ? '✅ Enabled' : '⛔ Disabled'}\nActive tasks · ${active.length}\nPending reviews · ${pending.length}\n\nPlayers choose an active task, then submit a URL or reference. Approval awards points once after manual review.\n\n${enabled ? 'Use Review submissions to process pending work. Use /task_create in the group to publish a new task.' : 'Enable Social tasks here before creating or accepting submissions.'}`,
      keyboard: taskSettingsKeyboard(communityId),
    }
  }

  if (page === 'content') {
    const snapshot = await communityAdminSnapshot(database, communityId, currentTime)
    if (!snapshot) throw new Error('This community is no longer available.')
    return {
      text: `<b>🧠 PROJECT CONTENT</b>\n\n<b>${escapeHtml(snapshot.community.title)}</b>\nApproved questions ready · ${snapshot.readyQuestionCount}\n\nQuestions power Project Quiz. Approved project words can power Word Seek. Content is reviewed before it reaches live games.\n\nChoose what you want to manage.`,
      keyboard: contentKeyboard(communityId),
    }
  }

  if (page === 'activity') {
    const enabled = await gameConfigurations.isEnabled(communityId, 'message_activity')
    return {
      text: `<b>📊 ACTIVITY</b>\n\nStatus · ${enabled ? '✅ Enabled' : '⛔ Disabled'}\n\nWhen enabled, Rallyo keeps privacy-safe hourly message and reply counts for this community. Message bodies are never stored, and activity does not award points.`,
      keyboard: activitySettingsKeyboard(communityId),
    }
  }

  if (page === 'quiz') {
    const snapshot = await communityAdminSnapshot(database, communityId, currentTime)
    if (!snapshot) throw new Error('This community is no longer available.')
    const config = await gameConfigurations.getProjectQuizConfig(communityId)
    const live = await roundService.liveRoundForCommunity(communityId, currentTime)
    return {
      text: `<b>🧠 PROJECT QUIZ / RACE</b>\n\nStatus · ${(config.row?.enabled ?? true) ? '✅ Enabled' : '⛔ Disabled'}\nRound · ${live ? '🟢 Live now' : 'Ready'}\nAnswer style · ${config.config.presentation === 'multiple_choice' ? 'Choose an answer' : 'Type the answer'}\nHints · ${config.config.hintsEnabled ? 'Enabled' : 'Off'}\nPoints · ${config.config.startingPoints} starting\nApproved questions ready · ${snapshot.readyQuestionCount}\n\nUse Run quiz now for a live round or Schedule quiz for approved questions later.`,
      keyboard: gameKeyboard(communityId, page, Boolean(live)),
    }
  }

  if (page === 'wordseek') {
    const stored = await gameConfigurations.get(communityId, 'word_seek')
    const config = wordSeekService.parseConfig(stored?.config ?? {})
    const live = await wordSeekService.activeSession(communityId)
    return {
      text: `<b>🔎 WORD SEEK</b>\n\nStatus · ${stored?.enabled ? '✅ Enabled' : '⛔ Disabled'}\nRound · ${live ? '🟢 Live now' : 'Ready'}\nWord length · ${config.wordLength} letters\nGuesses · ${config.maxGuesses}\nPoints · +${config.points}\nSource · ${config.source === 'PROJECT' ? 'Approved project words' : 'Curated words'}\n\n${stored?.enabled ? 'Players can start when an active season and approved words are available.' : 'Enable Word Seek before players can start it.'}`,
      keyboard: gameKeyboard(communityId, page, Boolean(live)),
    }
  }

  const scramble = await gameConfigurations.getScrambleConfig(communityId)
  const live = await scrambleService.activeRoundForCommunity(communityId, currentTime)
  return {
    text: `<b>🔀 SCRAMBLE</b>\n\nStatus · ${scramble.row?.enabled ? '✅ Enabled' : '⛔ Disabled'}\nRound · ${live ? '🟢 Live now' : 'Ready'}\nPoints · +${scramble.config.points}\nHints · ${scramble.config.hintsEnabled ? `${scramble.config.maxHints} available` : 'Off'}\nSource · ${scramble.config.source === 'PROJECT_BRAIN' ? 'Approved Project Brain terms' : 'Curated terms'}\n\n${scramble.row?.enabled ? 'Players can start when an active season and approved terms are available.' : 'Enable Scramble before players can start it.'}`,
    keyboard: gameKeyboard(communityId, page, Boolean(live)),
  }
}

function navigationPageForSection(value: string): AdminNavigationPage | null {
  return ['games', 'season', 'tasks', 'content', 'activity'].includes(value)
    ? (value as AdminSection)
    : null
}

function navigationPageForGame(value: string): AdminNavigationPage | null {
  return ['quiz', 'wordseek', 'scramble'].includes(value) ? (value as AdminGamePage) : null
}

function navigationPageForTarget(value: string): AdminNavigationPage | null {
  return value === 'home'
    ? 'home'
    : (navigationPageForSection(value) ?? navigationPageForGame(value))
}

function navigationPageForCapability(capabilityKey: string): AdminNavigationPage {
  if (capabilityKey === 'word_seek') return 'wordseek'
  if (capabilityKey === 'scramble') return 'scramble'
  if (capabilityKey === 'social_tasks') return 'tasks'
  if (capabilityKey === 'message_activity') return 'activity'
  return 'home'
}

type SocialTaskListRow = typeof schema.socialTasks.$inferSelect
type PendingSocialTaskRow = {
  readonly submission: typeof schema.socialTaskSubmissions.$inferSelect
  readonly task: typeof schema.socialTasks.$inferSelect
  readonly player: typeof schema.telegramIdentities.$inferSelect
}

function taskTimeLabel(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function renderSocialTaskList(tasks: readonly SocialTaskListRow[], currentTime: Date): string {
  return [
    '<b>🎯 COMMUNITY TASKS</b>',
    '',
    ...tasks.map((task, index) => {
      const remainingHours = Math.max(
        1,
        Math.ceil((task.endsAt.getTime() - currentTime.getTime()) / 3_600_000),
      )
      return `${index + 1}. <b>${escapeHtml(task.title)}</b> · +${task.points} pts\n${escapeHtml(truncateTelegramText(task.instructions, 240))}\nOpen until ${taskTimeLabel(task.endsAt)} · about ${remainingHours}h left`
    }),
    '',
    'Choose a task below, then send /task_submit with your URL or reference.',
  ].join('\n')
}

function socialTaskListKeyboard(tasks: readonly SocialTaskListRow[]): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  tasks.forEach((task, index) => {
    if (index > 0) keyboard.row()
    keyboard.text(
      `Submit · ${truncateTelegramText(task.title, 32)}`,
      telegramCallbackData(`player:task:${task.id}`),
    )
  })
  return keyboard
}

function renderPendingSocialTasks(rows: readonly PendingSocialTaskRow[]): string {
  return [
    '<b>🎯 TASK REVIEW</b>',
    '',
    ...rows.map((row, index) => {
      const player = telegramMention(row.player.telegramUserId, row.player.displayName)
      return `${index + 1}. <b>${escapeHtml(row.task.title)}</b> · +${row.task.points} pts\nPlayer · ${player}\nReference · ${escapeHtml(truncateTelegramText(row.submission.reference, 300))}`
    }),
    '',
    'Approve only submissions that meet the task instructions.',
  ].join('\n')
}

export function pendingSocialTaskKeyboard(rows: readonly PendingSocialTaskRow[]): InlineKeyboard {
  // The submission id is enough to identify the review. The service resolves its
  // community, keeping callback_data under Telegram's 64-byte limit in group and
  // private admin controls.
  const keyboard = new InlineKeyboard()
  rows.forEach((row, index) => {
    if (index > 0) keyboard.row()
    keyboard
      .text('Approve', adminCallback('task_approve', row.submission.id))
      .text('Reject', adminCallback('task_reject', row.submission.id))
  })
  return keyboard
}

type WordSeekVocabularyListRow = Pick<
  typeof schema.wordSeekWords.$inferSelect,
  'id' | 'word' | 'wordLength' | 'clue' | 'status'
>

async function renderWordSeekVocabulary(
  database: RallyoDatabase,
  communityId: string,
): Promise<{ readonly text: string; readonly keyboard: InlineKeyboard }> {
  const rows = await database
    .select({
      id: schema.wordSeekWords.id,
      word: schema.wordSeekWords.word,
      wordLength: schema.wordSeekWords.wordLength,
      clue: schema.wordSeekWords.clue,
      status: schema.wordSeekWords.status,
    })
    .from(schema.wordSeekWords)
    .where(eq(schema.wordSeekWords.communityId, communityId))
    .orderBy(asc(schema.wordSeekWords.wordLength), asc(schema.wordSeekWords.word))

  const text = rows.length
    ? [
        '<b>WORD SEEK PROJECT WORDS</b>',
        '',
        ...rows.map((row) => {
          const status = row.status === 'APPROVED' ? 'Approved' : 'Draft'
          const clue = row.clue ? ` · ${escapeHtml(row.clue)}` : ''
          return `${status} · <code>${escapeHtml(row.word)}</code> · ${row.wordLength} letters${clue}`
        }),
        '',
        'Add a draft with /wordseek_add WORD | optional clue.',
        'Approve drafts with the buttons below.',
      ].join('\n')
    : '<b>WORD SEEK PROJECT WORDS</b>\n\nNo project vocabulary yet.\n\nAdd one with /wordseek_add WORD | optional clue.'

  return {
    text,
    keyboard: wordSeekVocabularyKeyboard(communityId, rows),
  }
}

export function wordSeekVocabularyKeyboard(
  communityId: string,
  rows: readonly WordSeekVocabularyListRow[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  let draftCount = 0

  for (const row of rows) {
    if (row.status !== 'DRAFT') continue
    if (draftCount > 0) keyboard.row()
    keyboard.text(`Approve ${row.word}`, adminCallback('wordseek_approve', row.id))
    draftCount += 1
  }

  if (draftCount > 0) keyboard.row()
  keyboard.text('Refresh', adminCallback('wordseek_words', communityId))
  return keyboard
}

export function startMessage(): string {
  return '<b>👋 Welcome to Rallyo</b>\n\nPlay community games, complete approved tasks, and build your score. Your Rallyo identity and points follow you across communities.\n\nYou can play and rank without a wallet. Link Nimiq only when you want wallet-backed identity or Rallyo-native rewards.'
}

export function helpMessage(isAdmin = false): string {
  const adminSection = isAdmin
    ? '\n\n<b>🔒 Admin tools</b>\n/settings · community status and controls\n/task_create · publish a social task\n/task_review · review submissions\n/award · award positive points with a reason'
    : ''
  return `<b>ℹ️ Rallyo help</b>\n\n<b>Play</b>\n/me · your score, rank, and wallet status\n/tasks · active community tasks\n/task_submit · send a task URL or reference\n\n<b>Games</b>\nProject Quiz · answer the prompt, first correct wins\nWord Seek · solve the hidden word\nScramble · solve the mixed-up term\n\n<b>Account</b>\n/start · welcome and player actions\n/link · connect Nimiq for wallet-backed rewards\n/help · show this guide${adminSection}`
}

function playerKeyboard(appBaseUrl?: string): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text('📊 My score', 'player:me')
    .text('🔗 Link Nimiq', 'player:link')

  if (appBaseUrl) {
    keyboard.row().url('🌐 Player view', appBaseUrl)
  }

  return keyboard
}

export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64

export function telegramCallbackData(data: string): string {
  const bytes = new TextEncoder().encode(data).byteLength
  if (bytes < 1 || bytes > TELEGRAM_CALLBACK_DATA_MAX_BYTES) {
    throw new Error(
      `Telegram callback_data must be 1-${TELEGRAM_CALLBACK_DATA_MAX_BYTES} bytes; received ${bytes}.`,
    )
  }
  return data
}

function adminCallback(action: string, communityIdOrIdentifier: string, argument?: string): string {
  return telegramCallbackData(
    ['admin', action, communityIdOrIdentifier, ...(argument ? [argument] : [])].join(':'),
  )
}

type AdminGamePage = 'quiz' | 'wordseek' | 'scramble'
type AdminSection = 'games' | 'season' | 'tasks' | 'content' | 'activity'
type AdminNavigationPage = 'home' | AdminSection | AdminGamePage

export function adminKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🎮 Games', adminCallback('section', communityId, 'games'))
    .text('🏁 Season & points', adminCallback('section', communityId, 'season'))
    .row()
    .text('🎯 Social tasks', adminCallback('section', communityId, 'tasks'))
    .text('🧠 Project content', adminCallback('section', communityId, 'content'))
    .row()
    .text('📊 Activity', adminCallback('section', communityId, 'activity'))
    .text('🔄 Refresh', adminCallback('refresh', communityId))
}

export function gamesKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('🧠 Project Quiz / Race', adminCallback('game', communityId, 'quiz'))
    .row()
    .text('🔎 Word Seek', adminCallback('game', communityId, 'wordseek'))
    .row()
    .text('🔀 Scramble', adminCallback('game', communityId, 'scramble'))
    .row()
    .text('↩ Back', adminCallback('back', communityId, 'home'))
}

export function gameKeyboard(
  communityId: string,
  game: AdminGamePage,
  live = false,
): InlineKeyboard {
  const keyboard = new InlineKeyboard()

  if (game === 'quiz') {
    keyboard
      .text('▶️ Run quiz now', adminCallback('run', communityId))
      .text('⏱ Schedule quiz', adminCallback('schedule', communityId))
      .row()
      .text('📝 Questions', adminCallback('section', communityId, 'content'))
  } else if (game === 'wordseek') {
    keyboard
      .text(
        live ? '⏹ Stop Word Seek' : '▶️ Start Word Seek',
        adminCallback(live ? 'wordseekend' : 'wordseek', communityId),
      )
      .row()
      .text('📝 Manage words', adminCallback('wordseek_words', communityId))
      .text('⚙️ Enable or disable', adminCallback('toggle', communityId, 'ws'))
  } else {
    keyboard
      .text(
        live ? '⏹ Stop Scramble' : '▶️ Start Scramble',
        adminCallback(live ? 'scramble_stop' : 'scramble_start', communityId),
      )
      .row()
      .text('⚙️ Enable or disable', adminCallback('toggle', communityId, 'sc'))
  }

  return keyboard
    .row()
    .text('🔄 Refresh', adminCallback('refresh_page', communityId, game))
    .text('↩ Games', adminCallback('back', communityId, 'games'))
}

export function seasonKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⏱ Schedule quiz', adminCallback('schedule', communityId))
    .text('⏯ Pause or resume', adminCallback('pause', communityId))
    .row()
    .text('🔄 Refresh', adminCallback('refresh_page', communityId, 'season'))
    .text('↩ Back', adminCallback('back', communityId, 'home'))
}

export function taskSettingsKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Review submissions', adminCallback('task_review', communityId))
    .text('Enable or disable', adminCallback('toggle', communityId, 'tasks'))
    .row()
    .text('🔄 Refresh', adminCallback('refresh_page', communityId, 'tasks'))
    .text('↩ Back', adminCallback('back', communityId, 'home'))
}

export function activitySettingsKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Enable or disable', adminCallback('toggle', communityId, 'activity'))
    .row()
    .text('🔄 Refresh', adminCallback('refresh_page', communityId, 'activity'))
    .text('↩ Back', adminCallback('back', communityId, 'home'))
}

export function contentKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Questions', adminCallback('questions', communityId))
    .text('🔎 Word Seek words', adminCallback('wordseek_words', communityId))
    .row()
    .text('↩ Back', adminCallback('back', communityId, 'home'))
}

export function communitySelectionKeyboard(
  communities: readonly { readonly id: string; readonly title: string }[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
  communities.forEach((community, index) => {
    if (index > 0) keyboard.row()
    keyboard.text(community.title, adminCallback('select', community.id))
  })
  return keyboard
}

export function sourceKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Approved manual/project', adminCallback('source', communityId, 'manual'))
    .row()
    .text('Curated defaults', adminCallback('source', communityId, 'default'))
    .row()
    .text('Cancel', adminCallback('cancel', communityId))
}

export function questionCountKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard().text('Cancel', adminCallback('cancel', communityId))
}

export function durationKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('20 sec', adminCallback('duration', communityId, '20'))
    .text('30 sec', adminCallback('duration', communityId, '30'))
    .text('60 sec', adminCallback('duration', communityId, '60'))
    .row()
    .text('Cancel', adminCallback('cancel', communityId))
}

export function pointsKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Default points', adminCallback('points', communityId, 'default'))
    .row()
    .text('Cancel', adminCallback('cancel', communityId))
}

export function confirmKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Confirm', adminCallback('confirm', communityId))
    .text('Cancel', adminCallback('cancel', communityId))
}

export function cancelOnlyKeyboard(communityId: string): InlineKeyboard {
  return new InlineKeyboard().text('Cancel', adminCallback('cancel', communityId))
}

type SelectableQuestion = {
  readonly id: string
  readonly prompt: string
  readonly category: string
}

function renderQuestionSelection(
  questions: readonly SelectableQuestion[],
  page: number,
  count: number,
  selectedIds: readonly string[],
): string {
  const totalPages = Math.max(1, Math.ceil(questions.length / 5))
  const currentPage = Math.min(Math.max(0, page), totalPages - 1)
  return `<b>SELECT QUESTIONS</b>\n\nChoose ${count} approved question${count === 1 ? '' : 's'} by topic/text.\nSelected · ${selectedIds.length}/${count}\nPage ${currentPage + 1}/${totalPages}`
}

export function questionSelectionKeyboard(
  communityId: string,
  questions: readonly SelectableQuestion[],
  page: number,
  selectedIds: readonly string[],
  count: number,
): InlineKeyboard {
  const pageSize = 5
  const totalPages = Math.max(1, Math.ceil(questions.length / pageSize))
  const currentPage = Math.min(Math.max(0, page), totalPages - 1)
  const keyboard = new InlineKeyboard()
  questions
    .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
    .forEach((question, offset) => {
      const questionIndex = currentPage * pageSize + offset
      const marker = selectedIds.includes(question.id) ? '✅ ' : ''
      const label = `${marker}${truncateTelegramText(question.prompt, 45)}`
      keyboard.text(label, adminCallback('pick', communityId, String(questionIndex))).row()
    })
  if (totalPages > 1) {
    if (currentPage > 0)
      keyboard.text('← Previous', adminCallback('pickpage', communityId, String(currentPage - 1)))
    if (currentPage < totalPages - 1)
      keyboard.text('Next →', adminCallback('pickpage', communityId, String(currentPage + 1)))
    keyboard.row()
  }
  keyboard
    .text(`Done (${selectedIds.length}/${count})`, adminCallback('pickdone', communityId))
    .row()
  keyboard.text('Cancel', adminCallback('cancel', communityId))
  return keyboard
}

function truncateTelegramText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

async function eligibleQuestionsForCommunity(
  database: RallyoDatabase,
  communityId: string,
  now: Date,
): Promise<SelectableQuestion[]> {
  const [community] = await database
    .select({ questionCooldownDays: schema.communities.questionCooldownDays })
    .from(schema.communities)
    .where(eq(schema.communities.id, communityId))
  const cutoff = new Date(now.getTime() - (community?.questionCooldownDays ?? 30) * 86_400_000)
  const questions = await database
    .select({
      id: schema.questions.id,
      prompt: schema.questions.prompt,
      category: schema.questions.category,
      createdAt: schema.questions.createdAt,
    })
    .from(schema.questions)
    .where(
      and(
        eq(schema.questions.status, 'APPROVED'),
        or(
          eq(schema.questions.scope, 'GLOBAL'),
          and(
            eq(schema.questions.scope, 'COMMUNITY'),
            eq(schema.questions.communityId, communityId),
          ),
        ),
      ),
    )
    .orderBy(schema.questions.createdAt)
  const used = await database
    .select({ questionId: schema.questionUsages.questionId })
    .from(schema.questionUsages)
    .where(
      and(
        eq(schema.questionUsages.communityId, communityId),
        gte(schema.questionUsages.usedAt, cutoff),
      ),
    )
  const usedIds = new Set(used.map((row) => row.questionId))
  return questions.filter((question) => !usedIds.has(question.id))
}

async function activeSeasonForCommunity(database: RallyoDatabase, communityId: string, at: Date) {
  const [season] = await database
    .select()
    .from(schema.seasons)
    .where(
      and(
        eq(schema.seasons.communityId, communityId),
        eq(schema.seasons.status, 'ACTIVE'),
        lte(schema.seasons.startsAt, at),
        gt(schema.seasons.endsAt, at),
      ),
    )
    .orderBy(schema.seasons.startsAt)
    .limit(1)
  return season ?? null
}

async function firstApprovedQuestion(
  database: RallyoDatabase,
  communityId: string,
  contentSource: ProjectQuizConfig['contentSource'] = 'ANY_APPROVED',
) {
  const [question] = await database
    .select({ id: schema.questions.id })
    .from(schema.questions)
    .where(
      and(
        eq(schema.questions.status, 'APPROVED'),
        projectQuizSourceCondition(contentSource),
        or(
          eq(schema.questions.scope, 'GLOBAL'),
          and(
            eq(schema.questions.scope, 'COMMUNITY'),
            eq(schema.questions.communityId, communityId),
          ),
        ),
      ),
    )
    .orderBy(schema.questions.createdAt)
    .limit(1)
  return question ?? null
}

function projectQuizSourceCondition(contentSource: ProjectQuizConfig['contentSource']) {
  switch (contentSource) {
    case 'PROJECT_BRAIN':
      return eq(schema.questions.source, 'PROJECT_AI')
    case 'CURATED_DEFAULT':
      return eq(schema.questions.source, 'DEFAULT')
    case 'MANUAL':
      return eq(schema.questions.source, 'MANUAL')
    case 'ANY_APPROVED':
      return or(
        eq(schema.questions.source, 'DEFAULT'),
        eq(schema.questions.source, 'PROJECT_AI'),
        eq(schema.questions.source, 'MANUAL'),
      )
  }
}

function renderScheduleSummary(data: Record<string, unknown>): string {
  const count = numberValue(data.questionCount) ?? 0
  const seconds = numberValue(data.perQuestionSeconds) ?? 0
  const source = stringValue(data.sourcePolicy) ?? 'MANUAL'
  return `<b>CONFIRM SCHEDULE</b>\n\nSource · ${escapeHtml(source)}\nQuestions · ${count}\nTime per question · ${seconds} sec\nPoints · Default\nStarts · in 60 sec`
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : []
}

function uuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
}

function parseManualQuestion(value: string, communityId: string) {
  const parts = value.split('|').map((part) => part.trim())
  const kind = parts[0]?.toUpperCase()
  const prompt = parts[1]
  const correct = parts[2]
  if (!prompt || !correct || !kind) return null

  if (kind === 'MCQ' && parts.length >= 5) {
    const options = parts.slice(3).map((label) => ({ label, value: label }))
    if (!options.some((option) => option.value.toLowerCase() === correct.toLowerCase())) return null
    return {
      scope: 'COMMUNITY' as const,
      communityId,
      source: 'MANUAL' as const,
      mode: 'QUICK' as const,
      category: 'Manual',
      difficulty: 'easy',
      prompt,
      options,
      correctAnswer: correct,
      acceptedAnswers: [correct],
      basePoints: 20,
      fingerprint: `manual:${randomUUID()}`,
      status: 'APPROVED' as const,
    }
  }

  if (kind === 'FREE' && parts.length >= 3) {
    const aliases = parts[3]
      ? parts[3]
          .split(',')
          .map((alias) => alias.trim())
          .filter(Boolean)
      : []
    return {
      scope: 'COMMUNITY' as const,
      communityId,
      source: 'MANUAL' as const,
      mode: 'FIRST_CORRECT' as const,
      category: 'Manual',
      difficulty: 'easy',
      prompt,
      options: null,
      correctAnswer: correct,
      acceptedAnswers: [correct, ...aliases],
      basePoints: 15,
      fingerprint: `manual:${randomUUID()}`,
      status: 'APPROVED' as const,
    }
  }

  return null
}

function messageOptions(replyMarkup?: InlineKeyboard) {
  return { parse_mode: 'HTML' as const, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }
}

function commandArguments(context: Context): string[] {
  return (context.message?.text ?? '').trim().split(/\s+/u).slice(1)
}

function parseTelegramChatId(value: string): bigint | null {
  try {
    const parsed = BigInt(value)
    return parsed === 0n ? null : parsed
  } catch {
    return null
  }
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function payloadPositiveInteger(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function toTelegramApiChatId(value: bigint): number {
  const numberValue = Number(value)

  if (!Number.isSafeInteger(numberValue)) {
    throw new Error('Telegram chat id is outside the supported API range.')
  }

  return numberValue
}

function toTelegramMessageId(value: bigint): number {
  const numberValue = Number(value)

  if (!Number.isSafeInteger(numberValue)) {
    throw new Error('Telegram message id is outside the supported API range.')
  }

  return numberValue
}

function isGroupContext(context: Context): context is Context & {
  readonly chat: {
    readonly type: 'group' | 'supergroup'
    readonly id: number
    readonly title: string
  }
} {
  return context.chat?.type === 'group' || context.chat?.type === 'supergroup'
}

function isActiveBotMembership(context: Context): boolean {
  const status = context.myChatMember?.new_chat_member.status
  return status !== 'left' && status !== 'kicked'
}

function telegramUserLabel(user: {
  readonly first_name: string
  readonly last_name?: string
  readonly username?: string
}): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'A player'
}

function telegramMention(telegramUserId: number | bigint, displayName: string): string {
  return `<a href="tg://user?id=${telegramUserId.toString()}">${escapeHtml(displayName)}</a>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
