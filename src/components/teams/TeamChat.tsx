"use client"

import { useI18n } from "@/lib/i18n/context"

import { matchesSearch } from "@/lib/i18n/core"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUp, BarChart3, CornerUpLeft, Flag, ListPlus, Pencil, Pin, Search, Sparkles, Trash2, X } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { ProposalCard } from "@/components/teams/ProposalCard"
import { Avatar, HermesAvatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { HERMES_COMMANDS, continuesGroup, insertMention, isNearBottom, mentionQuery, parsePoll, richSegments, slashQuery } from "@/lib/team-chat"
import { timeAgo } from "@/lib/team-format"
import { markMessageDeleted, memberName, setReaction, upsertDecision, upsertMessage, type TeamStore } from "@/lib/team-store"
import { errorMessage, type TeamMessage } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"]

interface TeamChatProps {
  store: TeamStore
  update: StoreUpdate
  onMakeTask: (title: string) => void
  /** Scroll to and flash this message; a new nonce repeats the jump for the same message. */
  jumpTo?: { id: string; nonce: number } | null
  onOpenDecisions: () => void
}

export function TeamChat({ store, update, onMakeTask, jumpTo, onOpenDecisions }: TeamChatProps) {
  const { t, fmt } = useI18n()
  const teams = useTeamClient()
  const me = teams.userId
  const teamId = store.team.id
  const messages = store.messages ?? []
  const [draft, setDraft] = useState("")
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null)
  const [editing, setEditing] = useState<TeamMessage | null>(null)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastTyping = useRef(0)

  const [flash, setFlash] = useState<string | null>(null)
  const needle = query.trim().toLowerCase()
  const visible = needle ? messages.filter((message) => !message.deleted && matchesSearch(message.content, needle)) : messages
  const pinned = new Set(Object.values(store.decisions).map((decision) => decision.source_message_id))
  const typingIds = store.presence.filter((entry) => entry.typing && entry.user_id !== me).map((entry) => entry.user_id)
  const typers = typingIds.map((userId) => memberName(store, userId).split(" ")[0])
  const mention = mentionQuery(draft)
  const slash = slashQuery(draft)
  const mentionOptions = mention === null ? [] : [
    ...store.team.members.filter((member) => member.user_id !== me).map((member) => ({ id: member.user_id, name: member.display_name, hermes: false })),
    ...(teams.teamAI ? [{ id: "hermes", name: "Hermes", hermes: true }] : []),
  ].filter((option) => option.name.toLowerCase().startsWith(mention.toLowerCase()))
  const commandOptions = slash === null ? [] : [
    { cmd: "/poll", hint: t("teams.chat.pollHint"), hermes: false },
    ...(teams.teamAI ? HERMES_COMMANDS.map((command) => ({ cmd: command.cmd as string, hint: t(`teams.chat.commandHints.${command.hint}`), hermes: true })) : []),
  ].filter((option) => option.cmd.slice(1).startsWith(slash.toLowerCase()))

  // Follow new messages only while the reader is at the bottom (true on first load),
  // so reading older messages is never interrupted.
  const stickToBottom = useRef(true)
  const onListScroll = () => {
    const list = listRef.current
    if (list) stickToBottom.current = isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight)
  }
  const lastMessage = messages[messages.length - 1]
  useLayoutEffect(() => {
    const list = listRef.current
    if (list && !needle && stickToBottom.current) list.scrollTop = list.scrollHeight
  }, [messages.length, lastMessage?.content, needle, store.hermes?.stage, typingIds.length])

  // Jump from a pinned decision to its message: stop following the bottom, centre it, flash it.
  useEffect(() => {
    if (!jumpTo) return
    let frame = window.requestAnimationFrame(() => {
      // Clear any search first so the message is in the list, then find it on the next frame.
      setQuery("")
      setSearching(false)
      frame = window.requestAnimationFrame(() => {
        const target = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(jumpTo.id)}"]`)
        if (!target) return
        stickToBottom.current = false
        target.scrollIntoView({ block: "center", behavior: "smooth" })
        setFlash(jumpTo.id)
      })
    })
    const timer = window.setTimeout(() => setFlash(null), 2400)
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [jumpTo])

  const handles = ["Hermes", ...store.team.members.map((member) => member.display_name.split(" ")[0])]
  const run = async (work: () => Promise<void>) => {
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const onDraftChange = (value: string) => {
    setDraft(value)
    const now = Date.now()
    if (value && now - lastTyping.current > 3000) {
      lastTyping.current = now
      teams.typing(teamId).catch(() => undefined)
    }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    stickToBottom.current = true  // your own message always brings you to the bottom
    setSending(true)
    await run(async () => {
      if (editing) {
        const message = await teams.editMessage(editing.id, text)
        update((current) => upsertMessage(current, message))
        setEditing(null)
      } else {
        const poll = parsePoll(text)
        if (text.startsWith("/poll") && !poll) throw new Error(t("teams.errors.pollFormat"))
        const message = await teams.postMessage(teamId, poll
          ? { content: poll.question, poll_options: poll.options }
          : { content: text, reply_to_id: replyTo?.id ?? null })
        update((current) => upsertMessage(current, message))
        setReplyTo(null)
      }
      setDraft("")
    })
    setSending(false)
  }

  const react = (message: TeamMessage, emoji: string) => run(async () => {
    const result = await teams.react(message.id, emoji)
    update((current) => setReaction(current, message.id, me, emoji, result.on))
  })
  const vote = (message: TeamMessage, option: number) => run(async () => {
    const updated = await teams.votePoll(message.id, option)
    update((current) => upsertMessage(current, updated))
  })
  const pin = (message: TeamMessage) => run(async () => {
    const decision = await teams.pin(teamId, message.id)
    update((current) => upsertDecision(current, decision))
  })
  const remove = (message: TeamMessage) => run(async () => {
    await teams.deleteMessage(message.id)
    update((current) => markMessageDeleted(current, message.id))
  })
  const startEdit = (message: TeamMessage) => {
    setEditing(message)
    setReplyTo(null)
    setDraft(message.content)
    inputRef.current?.focus()
  }
  const startReply = (message: TeamMessage) => {
    setReplyTo(message)
    setEditing(null)
    inputRef.current?.focus()
  }
  const clearContext = () => {
    if (editing) setDraft("")
    setEditing(null)
    setReplyTo(null)
  }

  return (
    <aside className="tm-panel tm-dock" aria-label={t("teams.chat.title")}>
      <header className="tm-chat-head">
        <div>
          <strong>{t("teams.chat.title")}</strong>
          <small className="block text-[11px] text-[var(--fq-muted)]">{t("teams.chat.subtitle")}</small>
        </div>
        <div className="flex items-center gap-1">
        <button type="button" className="tm-btn tm-btn-sm" title={t("teams.chat.catchUpHint")} onClick={() => { setDraft("/catchup"); inputRef.current?.focus() }}>
          <Sparkles className="size-3.5" aria-hidden="true" /> {t("teams.chat.catchUp")}
        </button>
        <button
          type="button"
          className="tm-icon-btn"
          aria-label={t("teams.chat.search")}
          aria-pressed={searching}
          onClick={() => { setSearching((value) => !value); setQuery("") }}
        >
          <Search className="size-4" />
        </button>
        </div>
      </header>
      {searching ? (
        <div className="px-3 pt-2">
          <input className="tm-input" dir="auto" autoFocus placeholder={t("teams.chat.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      ) : null}
      <div ref={listRef} className="tm-chat-list" onScroll={onListScroll}>
        {visible.length === 0 ? <p className="tm-muted m-auto">{needle ? t("teams.chat.noMatch") : t("teams.chat.empty")}</p> : null}
        {visible.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            continued={!needle && continuesGroup(visible[index - 1], message)}
            followed={!needle && continuesGroup(message, visible[index + 1])}
            flash={flash === message.id}
            handles={handles}
            onOpenDecisions={onOpenDecisions}
            store={store}
            me={me}
            pinned={pinned.has(message.id)}
            onReply={startReply}
            onEdit={startEdit}
            onDelete={(item) => void remove(item)}
            onPin={(item) => void pin(item)}
            onReact={(item, emoji) => void react(item, emoji)}
            onVote={(item, option) => void vote(item, option)}
            onMakeTask={(item) => onMakeTask(item.content.slice(0, 200))}
            update={update}
          />
        ))}
        {!needle && typingIds.length ? (
          <div className="tm-typing-row" aria-hidden="true">
            <span className="tm-typing-avatars">
              {typingIds.slice(0, 3).map((userId) => <Avatar key={userId} userId={userId} name={memberName(store, userId)} size={22} />)}
            </span>
            <TypingDots />
          </div>
        ) : null}
        {!needle && store.hermes ? (
          <div className="tm-typing-row" data-hermes="" aria-hidden="true">
            <HermesAvatar size={22} />
            <TypingDots />
            <small dir="auto">{store.hermes.stage}</small>
          </div>
        ) : null}
      </div>
      <div className="tm-typing" aria-live="polite">
        {[
          store.hermes ? t("teams.chat.hermesTyping", { stage: store.hermes.stage }) : "",
          typers.length ? t("teams.chat.typing", { count: typers.length, names: fmt.list(typers) }) : "",
        ].filter(Boolean).join(" · ")}
      </div>
      <div className="tm-composer">
        {mentionOptions.length > 0 ? (
          <div className="tm-suggest" role="listbox" aria-label={t("teams.chat.mention")}>
            {mentionOptions.map((option) => (
              <button key={option.id} type="button" onClick={() => { setDraft((current) => insertMention(current, option.name)); inputRef.current?.focus() }}>
                {option.hermes ? <HermesAvatar size={20} /> : <Avatar userId={option.id} name={option.name} size={20} />}
                {option.name}
                {option.hermes ? <small>{t("teams.chat.aiTeammate")}</small> : null}
              </button>
            ))}
          </div>
        ) : null}
        {commandOptions.length > 0 ? (
          <div className="tm-suggest" role="listbox" aria-label={t("teams.chat.commands")}>
            {commandOptions.map((option) => (
              <button key={option.cmd} type="button" onClick={() => { setDraft(`${option.cmd} `); inputRef.current?.focus() }}>
                <strong dir="ltr">{option.cmd}</strong>
                <span className="text-[var(--fq-muted)]">{option.hint}</span>
                <small>{option.hermes ? "Hermes" : t("teams.chat.poll")}</small>
              </button>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="tm-composer-bar" role="alert">
            <span>{error}</span>
            <button type="button" className="tm-icon-btn" aria-label={t("teams.common.dismiss")} onClick={() => setError(null)}><X className="size-3.5" /></button>
          </div>
        ) : null}
        {replyTo || editing ? (
          <div className="tm-composer-bar">
            <span>{editing ? t("teams.chat.editing") : t("teams.chat.replyingTo", { name: memberName(store, replyTo?.author_user_id ?? null) })}</span>
            <button type="button" className="tm-icon-btn" aria-label={t("teams.common.cancel")} onClick={clearContext}><X className="size-3.5" /></button>
          </div>
        ) : null}
        <div className="tm-composer-row">
          <textarea
            ref={inputRef}
            dir="auto"
            rows={1}
            value={draft}
            aria-label={t("teams.chat.inputLabel")}
            placeholder={t("teams.chat.placeholder")}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void send()
              }
              if (event.key === "Escape") clearContext()
            }}
          />
          <button
            type="button"
            className="tm-btn tm-btn-primary"
            style={{ width: 40, padding: 0 }}
            aria-label={t("teams.chat.send")}
            disabled={!draft.trim() || sending}
            onClick={() => void send()}
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}

interface MessageItemProps {
  message: TeamMessage
  continued: boolean
  followed: boolean
  flash: boolean
  handles: string[]
  onOpenDecisions: () => void
  store: TeamStore
  me: string
  pinned: boolean
  onReply: (message: TeamMessage) => void
  onEdit: (message: TeamMessage) => void
  onDelete: (message: TeamMessage) => void
  onPin: (message: TeamMessage) => void
  onReact: (message: TeamMessage, emoji: string) => void
  onVote: (message: TeamMessage, option: number) => void
  onMakeTask: (message: TeamMessage) => void
  update: StoreUpdate
}

function MessageItem({ message, continued, followed, flash, handles, onOpenDecisions, store, me, pinned, onReply, onEdit, onDelete, onPin, onReact, onVote, onMakeTask, update }: MessageItemProps) {
  const { t, fmt } = useI18n()
  if (message.kind === "system") return <div className="tm-system" dir="auto">{message.content}</div>
  if (message.kind === "notice") {
    return (
      <div className="tm-notice" dir="auto">
        <Flag className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{message.content}</span>
        {message.visible_to_user_id ? <small>{t("teams.chat.onlyYou")}</small> : null}
      </div>
    )
  }
  if (message.kind === "proposal") {
    const proposal = store.proposals[String(message.metadata?.proposal_id ?? "")]
    return proposal ? <ProposalCard proposal={proposal} store={store} update={update} /> : <div className="tm-system">{message.content}</div>
  }
  const hermes = message.author_user_id === null
  const mine = message.author_user_id === me
  const author = memberName(store, message.author_user_id)
  const parent = message.reply_to_id ? store.messages?.find((item) => item.id === message.reply_to_id) : undefined
  const reactions = Object.entries(message.reactions)
  const flag = (on: boolean) => (on ? "" : undefined)
  const pinMark = pinned ? (
    <button type="button" className="tm-pin-mark" title={t("teams.chat.pinnedOpen")} aria-label={t("teams.chat.pinnedOpen")} onClick={onOpenDecisions}>
      <Pin className="size-3" aria-hidden="true" />
    </button>
  ) : null
  // Your own messages need no name or picture; follow-ups in a group show neither.
  const showHeader = mine ? Boolean(message.edited_at || message.visible_to_user_id || pinned) : !continued
  return (
    <article
      className="tm-msg"
      data-message-id={message.id}
      data-mine={flag(mine)}
      data-hermes={flag(hermes)}
      data-private={flag(Boolean(message.visible_to_user_id))}
      data-continued={flag(continued)}
      data-followed={flag(followed)}
      data-flash={flag(flash)}
      title={mine ? fmt.dateTime(message.created_at) : undefined}
    >
      {mine ? null : continued ? <span className="tm-avatar-spacer" aria-hidden="true" /> : hermes ? <HermesAvatar size={28} /> : <Avatar userId={message.author_user_id ?? ""} name={author} size={28} />}
      <div className="tm-msg-body">
        {showHeader ? (
          <header>
            {mine ? null : <strong><bdi>{author}</bdi></strong>}
            {mine ? null : <time dateTime={message.created_at}>{timeAgo(message.created_at, t)}</time>}
            {message.edited_at ? <span>{t("teams.chat.edited")}</span> : null}
            {message.visible_to_user_id ? <span>{t("teams.chat.onlyYou")}</span> : null}
            {pinMark}
          </header>
        ) : null}
        {parent ? (
          <blockquote className="tm-reply" dir="auto">
            {memberName(store, parent.author_user_id)}: {parent.deleted ? t("teams.chat.deletedQuote") : parent.content.slice(0, 140)}
          </blockquote>
        ) : null}
        {message.deleted ? (
          <p className="tm-deleted">{t("teams.chat.deleted")}</p>
        ) : message.kind === "poll" ? (
          <PollView message={message} me={me} store={store} onVote={(option) => onVote(message, option)} />
        ) : hermes ? (
          <div dir="auto"><MarkdownText text={message.content} /></div>
        ) : (
          <p className="tm-text" dir="auto">
            {richSegments(message.content, handles).map((segment, index) =>
              segment.kind === "text" ? segment.text : <span key={index} className={segment.kind === "mention" ? "tm-mention" : "tm-command"}>{segment.text}</span>,
            )}
          </p>
        )}
        {reactions.length > 0 ? (
          <div className="tm-reactions">
            {reactions.map(([emoji, users]) => (
              <button
                key={emoji}
                type="button"
                className="tm-reaction"
                aria-pressed={users.includes(me)}
                title={users.map((userId) => memberName(store, userId)).join(", ")}
                onClick={() => onReact(message, emoji)}
              >
                {emoji} <span>{fmt.number(users.length)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!message.deleted ? (
        <div className="tm-msg-actions">
          {QUICK_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" aria-label={t("teams.chat.react", { emoji })} onClick={() => onReact(message, emoji)}>{emoji}</button>
          ))}
          <button type="button" aria-label={t("teams.chat.reply")} title={t("teams.chat.reply")} onClick={() => onReply(message)}><CornerUpLeft className="size-3.5 rtl:-scale-x-100" /></button>
          {!pinned && !message.visible_to_user_id ? (
            <button type="button" aria-label={t("teams.chat.pin")} title={t("teams.chat.pin")} onClick={() => onPin(message)}><Pin className="size-3.5" /></button>
          ) : null}
          <button type="button" aria-label={t("teams.chat.makeTask")} title={t("teams.chat.makeTask")} onClick={() => onMakeTask(message)}><ListPlus className="size-3.5" /></button>
          {mine ? (
            <>
              <button type="button" aria-label={t("teams.common.edit")} title={t("teams.common.edit")} onClick={() => onEdit(message)}><Pencil className="size-3.5" /></button>
              <button type="button" aria-label={t("teams.common.delete")} title={t("teams.common.delete")} onClick={() => onDelete(message)}><Trash2 className="size-3.5" /></button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function TypingDots() {
  return <span className="tm-typing-dots"><i /><i /><i /></span>
}

function PollView({ message, me, store, onVote }: { message: TeamMessage; me: string; store: TeamStore; onVote: (option: number) => void }) {
  const { t, fmt } = useI18n()
  const metadata = (message.metadata ?? {}) as { options?: string[]; votes?: Record<string, number> }
  const options = metadata.options ?? []
  const votes = Object.values(metadata.votes ?? {})
  const mine = metadata.votes?.[me]
  const voters = (index: number) =>
    Object.entries(metadata.votes ?? {}).filter(([, vote]) => vote === index).map(([userId]) => memberName(store, userId)).join(", ")
  return (
    <div className="tm-poll" role="group" aria-label={t("teams.chat.pollLabel", { question: message.content })}>
      <strong className="tm-poll-question" dir="auto"><BarChart3 className="size-3.5" aria-hidden="true" /> {message.content}</strong>
      {options.map((option, index) => {
        const count = votes.filter((vote) => vote === index).length
        const pct = votes.length ? Math.round((100 * count) / votes.length) : 0
        return (
          <button key={option} type="button" className="tm-poll-option" aria-pressed={mine === index} title={voters(index) || t("teams.chat.noVotes")} onClick={() => onVote(index)}>
            <i style={{ width: `${pct}%` }} />
            <span dir="auto">{option}</span>
            <span>{fmt.number(count)}</span>
          </button>
        )
      })}
      <small className="tm-muted">{t("teams.chat.votes", { count: votes.length })}{t("teams.common.separator")}{t(mine === undefined ? "teams.chat.tapToVote" : "teams.chat.tapToChange")}</small>
    </div>
  )
}
