"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { ArrowUp, CornerUpLeft, Flag, ListPlus, Pencil, Pin, Search, Sparkles, Trash2, X } from "lucide-react"
import { MarkdownText } from "@/components/hermes/markdown"
import { ProposalCard } from "@/components/teams/ProposalCard"
import { Avatar, HermesAvatar } from "@/components/teams/ui"
import type { StoreUpdate } from "@/components/teams/use-team-stream"
import { HERMES_COMMANDS, insertMention, isNearBottom, mentionQuery, parsePoll, slashQuery } from "@/lib/team-chat"
import { timeAgo } from "@/lib/team-format"
import { markMessageDeleted, memberName, setReaction, upsertDecision, upsertMessage, type TeamStore } from "@/lib/team-store"
import { errorMessage, type TeamMessage } from "@/lib/teams-api"
import { useTeamClient } from "@/components/teams/team-client-context"

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"]

interface TeamChatProps { store: TeamStore; update: StoreUpdate; onMakeTask: (title: string) => void }

export function TeamChat({ store, update, onMakeTask }: TeamChatProps) {
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

  const needle = query.trim().toLowerCase()
  const visible = needle ? messages.filter((message) => !message.deleted && message.content.toLowerCase().includes(needle)) : messages
  const pinned = new Set(Object.values(store.decisions).map((decision) => decision.source_message_id))
  const typers = store.presence
    .filter((entry) => entry.typing && entry.user_id !== me)
    .map((entry) => memberName(store, entry.user_id).split(" ")[0])
  const mention = mentionQuery(draft)
  const slash = slashQuery(draft)
  const mentionOptions = mention === null ? [] : [
    ...store.team.members.filter((member) => member.user_id !== me).map((member) => ({ id: member.user_id, name: member.display_name, hermes: false })),
    { id: "hermes", name: "Hermes", hermes: true },
  ].filter((option) => option.name.toLowerCase().startsWith(mention.toLowerCase()))
  const commandOptions = slash === null ? [] : [
    { cmd: "/poll", hint: "Question | Option A | Option B", hermes: false },
    ...HERMES_COMMANDS.map((command) => ({ cmd: command.cmd as string, hint: command.hint as string, hermes: true })),
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
  }, [messages.length, lastMessage?.content, needle, store.hermes?.stage])

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
        if (text.startsWith("/poll") && !poll) throw new Error("Write a poll as /poll Question | Option A | Option B")
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
    <aside className="tm-panel tm-dock" aria-label="Team chat">
      <header className="tm-chat-head">
        <div>
          <strong>Team chat</strong>
          <small className="block text-[11px] text-[var(--fq-muted)]">Private to your team · @Hermes or / for commands</small>
        </div>
        <div className="flex items-center gap-1">
        <button type="button" className="tm-btn tm-btn-sm" title="Summarise what changed since your last catch-up" onClick={() => { setDraft("/catchup"); inputRef.current?.focus() }}>
          <Sparkles className="size-3.5" aria-hidden="true" /> Catch me up
        </button>
        <button
          type="button"
          className="tm-icon-btn"
          aria-label="Search messages"
          aria-pressed={searching}
          onClick={() => { setSearching((value) => !value); setQuery("") }}
        >
          <Search className="size-4" />
        </button>
        </div>
      </header>
      {searching ? (
        <div className="px-3 pt-2">
          <input className="tm-input" autoFocus placeholder="Search this chat" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      ) : null}
      <div ref={listRef} className="tm-chat-list" onScroll={onListScroll}>
        {visible.length === 0 ? <p className="tm-muted m-auto">{needle ? "No messages match." : "Say hello to your team."}</p> : null}
        {visible.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
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
      </div>
      {store.hermes ? (
        <div className="tm-hermes-bar" role="status"><HermesAvatar size={18} /> {store.hermes.stage}…</div>
      ) : null}
      <div className="tm-typing" aria-live="polite">
        {typers.length ? `${typers.join(", ")} ${typers.length === 1 ? "is" : "are"} typing…` : ""}
      </div>
      <div className="tm-composer">
        {mentionOptions.length > 0 ? (
          <div className="tm-suggest" role="listbox" aria-label="Mention">
            {mentionOptions.map((option) => (
              <button key={option.id} type="button" onClick={() => { setDraft((current) => insertMention(current, option.name)); inputRef.current?.focus() }}>
                {option.hermes ? <HermesAvatar size={20} /> : <Avatar userId={option.id} name={option.name} size={20} />}
                {option.name}
                {option.hermes ? <small>AI teammate</small> : null}
              </button>
            ))}
          </div>
        ) : null}
        {commandOptions.length > 0 ? (
          <div className="tm-suggest" role="listbox" aria-label="Commands">
            {commandOptions.map((option) => (
              <button key={option.cmd} type="button" onClick={() => { setDraft(`${option.cmd} `); inputRef.current?.focus() }}>
                <strong>{option.cmd}</strong>
                <span className="text-[var(--fq-muted)]">{option.hint}</span>
                <small>{option.hermes ? "Hermes" : "Poll"}</small>
              </button>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="tm-composer-bar" role="alert">
            <span>{error}</span>
            <button type="button" className="tm-icon-btn" aria-label="Dismiss" onClick={() => setError(null)}><X className="size-3.5" /></button>
          </div>
        ) : null}
        {replyTo || editing ? (
          <div className="tm-composer-bar">
            <span>{editing ? "Editing your message" : `Replying to ${memberName(store, replyTo?.author_user_id ?? null)}`}</span>
            <button type="button" className="tm-icon-btn" aria-label="Cancel" onClick={clearContext}><X className="size-3.5" /></button>
          </div>
        ) : null}
        <div className="tm-composer-row">
          <textarea
            ref={inputRef}
            dir="auto"
            rows={1}
            value={draft}
            aria-label="Message your team"
            placeholder="Message your team: @ to mention, / for commands"
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
            aria-label="Send"
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

function MessageItem({ message, store, me, pinned, onReply, onEdit, onDelete, onPin, onReact, onVote, onMakeTask, update }: MessageItemProps) {
  if (message.kind === "system") return <div className="tm-system" dir="auto">{message.content}</div>
  if (message.kind === "notice") {
    return (
      <div className="tm-notice" dir="auto">
        <Flag className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{message.content}</span>
        {message.visible_to_user_id ? <small>only you</small> : null}
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
  return (
    <article className="tm-msg" data-hermes={hermes ? "" : undefined} data-private={message.visible_to_user_id ? "" : undefined}>
      {hermes ? <HermesAvatar size={28} /> : <Avatar userId={message.author_user_id ?? ""} name={author} size={28} />}
      <div className="tm-msg-body">
        <header>
          <strong>{author}</strong>
          <time dateTime={message.created_at}>{timeAgo(message.created_at)}</time>
          {message.edited_at ? <span>· edited</span> : null}
          {message.visible_to_user_id ? <span>· only you</span> : null}
          {pinned ? <span>· <Pin className="inline size-3" aria-label="Pinned as a decision" /></span> : null}
        </header>
        {parent ? (
          <blockquote className="tm-reply" dir="auto">
            {memberName(store, parent.author_user_id)}: {parent.deleted ? "deleted message" : parent.content.slice(0, 140)}
          </blockquote>
        ) : null}
        {message.deleted ? (
          <p className="tm-deleted">Message deleted</p>
        ) : hermes ? (
          <div dir="auto"><MarkdownText text={message.content} /></div>
        ) : (
          <p className="tm-text" dir="auto">{message.content}</p>
        )}
        {message.kind === "poll" && !message.deleted ? <PollView message={message} me={me} onVote={(option) => onVote(message, option)} /> : null}
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
                {emoji} <span>{users.length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!message.deleted ? (
        <div className="tm-msg-actions">
          {QUICK_REACTIONS.map((emoji) => (
            <button key={emoji} type="button" aria-label={`React with ${emoji}`} onClick={() => onReact(message, emoji)}>{emoji}</button>
          ))}
          <button type="button" aria-label="Reply" title="Reply" onClick={() => onReply(message)}><CornerUpLeft className="size-3.5" /></button>
          {!pinned && !message.visible_to_user_id ? (
            <button type="button" aria-label="Pin as decision" title="Pin as decision" onClick={() => onPin(message)}><Pin className="size-3.5" /></button>
          ) : null}
          <button type="button" aria-label="Make a task" title="Make a task" onClick={() => onMakeTask(message)}><ListPlus className="size-3.5" /></button>
          {mine ? (
            <>
              <button type="button" aria-label="Edit" title="Edit" onClick={() => onEdit(message)}><Pencil className="size-3.5" /></button>
              <button type="button" aria-label="Delete" title="Delete" onClick={() => onDelete(message)}><Trash2 className="size-3.5" /></button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function PollView({ message, me, onVote }: { message: TeamMessage; me: string; onVote: (option: number) => void }) {
  const metadata = (message.metadata ?? {}) as { options?: string[]; votes?: Record<string, number> }
  const options = metadata.options ?? []
  const votes = Object.values(metadata.votes ?? {})
  const mine = metadata.votes?.[me]
  return (
    <div className="tm-poll">
      {options.map((option, index) => {
        const count = votes.filter((vote) => vote === index).length
        const pct = votes.length ? Math.round((100 * count) / votes.length) : 0
        return (
          <button key={option} type="button" className="tm-poll-option" aria-pressed={mine === index} onClick={() => onVote(index)}>
            <i style={{ width: `${pct}%` }} />
            <span dir="auto">{option}</span>
            <span>{count}</span>
          </button>
        )
      })}
      <small className="tm-muted">{votes.length} {votes.length === 1 ? "vote" : "votes"}</small>
    </div>
  )
}
