'use client'

import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { FaTimes, FaPaperPlane, FaTrash, FaExternalLinkAlt, FaHistory, FaPlus, FaChevronLeft, FaRegTrashAlt, FaCopy, FaCheck, FaDownload, FaSlash, FaBolt, FaTasks, FaCalendarAlt, FaProjectDiagram, FaBriefcase, FaUserClock, FaLightbulb } from 'react-icons/fa'
import { useRouter, usePathname } from 'next/navigation'
import { useMiraChat } from '@/contexts/MiraChatContext'
import { useTheme } from '@/contexts/ThemeContext'
import MiraSphere from '@/components/ui/MiraPet'
import MiraGeneratedImage from '@/components/ui/MiraGeneratedImage'
import MiraAttachments from '@/components/ui/MiraAttachments'
import AIActivityBeam from '@/components/ui/AIActivityBeam'
import NativePipSurface from '@/components/ui/NativePipSurface'
import MiraActivityPointer from '@/components/ui/MiraActivityPointer'
import MiraWakeSetup from '@/components/MiraWakeSetup'
import ReactMarkdown from 'react-markdown'
import { VoiceBeam } from 'voice-glow'
import useMiraVoice from '@/hooks/useMiraVoice'
import useMiraSidebarDrag from '@/hooks/useMiraSidebarDrag'
import useMiraPanelVisible from '@/hooks/useMiraPanelVisible'
import { prepareMiraLocation } from '@/lib/miraClientContext'
import { miraNavigationPath } from '@/lib/miraNavigation'
import { sanitizeMiraCards } from '@/lib/miraStructuredCards'
import { prewarmMiraVoice } from '@/lib/miraVoiceReady'
import MiraEditPrompt from './MiraEditPrompt'
import { miraMessageDisplay, miraPlainCaption } from '@/lib/miraMessageDisplay'
import { Maximize2, Minimize2, Mic, Square, Pencil, RotateCcw, Reply } from 'lucide-react'

// ─── Copy Button ────────────────────────────────────────────────────

function CopyButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
        copied
          ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
          : 'bg-default-200/80 text-default-500 hover:bg-default-300 dark:bg-white/10 dark:hover:bg-white/15 dark:text-default-400'
      } ${className}`}
    >
      {copied ? <><FaCheck className="w-2.5 h-2.5" /> Copied</> : <><FaCopy className="w-2.5 h-2.5" /> Copy</>}
    </button>
  )
}

function ExportButton({ message, className = '' }) {
  const handleExport = useCallback(() => {
    const report = [
      '# MIRA report',
      '',
      message.message || '',
      ...(message.cards?.length
        ? ['', '## Report data', '', '```json', JSON.stringify(message.cards, null, 2), '```']
        : []),
      '',
      `Exported from Talio on ${new Date().toLocaleString()}`,
    ].join('\n')
    const blobUrl = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `mira-report-${new Date().toISOString().slice(0, 10)}.md`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(blobUrl)
  }, [message])

  return (
    <button
      onClick={handleExport}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-default-200/80 text-default-500 hover:bg-default-300 dark:bg-white/10 dark:hover:bg-white/15 dark:text-default-400 transition-all ${className}`}
      title="Export this MIRA report"
    >
      <FaDownload className="w-2.5 h-2.5" /> Export
    </button>
  )
}

// ─── Slash Commands ─────────────────────────────────────────────────

const SLASH_COMMANDS = [
  { cmd: '/tasks', label: 'My Tasks', desc: 'Show my pending tasks', icon: FaTasks, prompt: 'Show my pending tasks' },
  { cmd: '/attendance', label: 'Attendance', desc: 'Check my attendance', icon: FaCalendarAlt, prompt: "What's my attendance this week?" },
  { cmd: '/projects', label: 'Projects', desc: 'Show my projects', icon: FaProjectDiagram, prompt: 'Show my projects and their status' },
  { cmd: '/briefing', label: 'Daily Briefing', desc: 'Get your morning briefing', icon: FaBriefcase, prompt: 'Give me my daily briefing - tasks, attendance, upcoming deadlines, and anything I should know today' },
  { cmd: '/leaves', label: 'Leave Balance', desc: 'Check leave balance', icon: FaUserClock, prompt: 'Show my leave balance' },
  { cmd: '/idea', label: 'Brainstorm', desc: 'Brainstorm ideas', icon: FaLightbulb, prompt: 'Help me brainstorm ideas for ' },
]

// ─── Quick Action Chips ─────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Daily Briefing', icon: FaBriefcase, prompt: 'Give me my daily briefing - tasks, attendance, upcoming deadlines, and anything I should know today' },
  { label: 'My Tasks', icon: FaTasks, prompt: 'Show my pending tasks' },
  { label: 'Attendance', icon: FaCalendarAlt, prompt: "What's my attendance this week?" },
]

// ─── Card Renderers ─────────────────────────────────────────────────

function StatCard({ data }) {
  if (!data?.stats) return null
  return (
    <div className="grid grid-cols-2 gap-3">
      {data.stats.map((s, i) => (
        <div key={i} className="bg-default-50 dark:bg-default-100 rounded-xl p-3">
          <p className="text-xs text-default-500 mb-0.5">{s.label}</p>
          <p className="text-xl font-bold text-default-900">{s.value}</p>
          {s.change && (
            <p className={`text-xs font-medium mt-0.5 ${s.trend === 'up' ? 'text-success-500' : s.trend === 'down' ? 'text-danger-500' : 'text-default-500'}`}>
              {s.change}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function ListCard({ data }) {
  const router = useRouter()
  const { closeChat } = useMiraChat()
  if (!data?.items?.length) return null
  const statusColors = {
    active: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
    completed: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
    pending: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400',
    overdue: 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400',
  }
  return (
    <div className="space-y-1.5">
      {data.items.map((item, i) => (
        <div
          key={i}
          className={`flex items-center justify-between p-2.5 rounded-lg bg-default-50 dark:bg-default-100 ${item.link ? 'cursor-pointer hover:bg-default-100 dark:hover:bg-default-200 transition-colors' : ''}`}
          role={item.link ? 'link' : undefined}
          tabIndex={item.link ? 0 : undefined}
          onKeyDown={e => { if (item.link && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); closeChat(); router.push(item.link) } }}
          onClick={() => { if (item.link) { closeChat(); router.push(item.link) } }}
        >
          <div className="flex-1 min-w-0 mr-2">
            <p className="text-sm font-medium text-default-800 truncate">{item.title}</p>
            {item.subtitle && <p className="text-xs text-default-500 truncate">{item.subtitle}</p>}
          </div>
          {item.status && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusColors[item.status] || 'bg-default-100 text-default-600'}`}>
              {item.status}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function TableCard({ data }) {
  if (!data?.headers || !data?.rows) return null
  return (
    <div className="overflow-x-auto rounded-lg border border-divider">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-default-50 dark:bg-default-100">
            {data.headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 font-semibold text-default-600">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className="border-t border-divider">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-default-800">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActionCard({ data }) {
  const router = useRouter()
  if (!data) return null
  return (
    <div>
      {data.text && <p className="text-sm text-default-700 mb-3">{data.text}</p>}
      <div className="flex flex-wrap gap-2">
        {data.actions?.map((action, i) => (
          <button
            key={i}
            onClick={() => action.link && router.push(action.link)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              action.variant === 'primary'
                ? 'bg-primary-500 text-white hover:bg-primary-600'
                : 'bg-default-100 text-default-700 hover:bg-default-200 dark:bg-default-200 dark:hover:bg-default-300'
            }`}
          >
            {action.label}
            {action.link && <FaExternalLinkAlt className="w-2.5 h-2.5" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function AlertCard({ data }) {
  if (!data) return null
  const colors = {
    info: 'bg-primary-50 border-primary-200 text-primary-800 dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-300',
    success: 'bg-success-50 border-success-200 text-success-800 dark:bg-success-900/20 dark:border-success-800 dark:text-success-300',
    warning: 'bg-warning-50 border-warning-200 text-warning-800 dark:bg-warning-900/20 dark:border-warning-800 dark:text-warning-300',
    error: 'bg-danger-50 border-danger-200 text-danger-800 dark:bg-danger-900/20 dark:border-danger-800 dark:text-danger-300',
  }
  return (
    <div className={`p-3 rounded-lg border text-sm ${colors[data.severity] || colors.info}`}>
      {data.text}
    </div>
  )
}

function ProgressCard({ data }) {
  if (!data?.items?.length) return null
  const statusColors = {
    'on-track': 'bg-success-500',
    'at-risk': 'bg-warning-500',
    'overdue': 'bg-danger-500',
  }
  return (
    <div className="space-y-3">
      {data.items.map((item, i) => (
        <div key={i}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-medium text-default-700">{item.label}</span>
            <span className="text-xs text-default-500">{item.value}/{item.max || 100}</span>
          </div>
          <div className="w-full h-2 bg-default-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${statusColors[item.status] || 'bg-primary-500'}`}
              style={{ width: `${Math.min((item.value / (item.max || 100)) * 100, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function InfoCard({ data }) {
  if (!data) return null
  return (
    <div className="text-sm text-default-700 bg-default-50 dark:bg-default-100 rounded-lg p-3">
      {data.text}
    </div>
  )
}

function AICard({ card }) {
  const renderers = {
    stat: StatCard,
    list: ListCard,
    table: TableCard,
    action: ActionCard,
    alert: AlertCard,
    progress: ProgressCard,
    info: InfoCard,
  }
  const Renderer = renderers[card.type] || InfoCard
  return (
    <div className="mt-2">
      {card.title && <p className="text-xs font-semibold text-default-500 uppercase tracking-wide mb-2">{card.title}</p>}
      <Renderer data={card.data} />
    </div>
  )
}

// ─── Thinking Indicator ─────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex-shrink-0 mt-0.5">
        <MiraSphere size={28} isThinking={true} />
      </div>
      <div className="flex-1">
        <p className="text-xs font-medium text-primary-500 mb-2">Thinking…</p>
        <div className="flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

// ─── Code Block with Copy ───────────────────────────────────────────

function CodeBlock({ className, children }) {
  const match = /language-(\w+)/.exec(className || '')
  const codeString = String(children).replace(/\n$/, '')
  return (
    <div className="relative my-2.5 rounded-lg overflow-hidden group/code border border-divider">
      <div className="flex items-center justify-between px-3 py-1.5 bg-default-200 dark:bg-default-300">
        <span className="text-[10px] font-semibold text-default-500 uppercase tracking-wider">{match?.[1] || 'code'}</span>
        <CopyButton text={codeString} />
      </div>
      <pre className="bg-default-100 dark:bg-default-200 p-3 overflow-x-auto text-xs leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

// ─── Message Bubble ─────────────────────────────────────────────────

function MiraActionPreview({ action, result, messageId, busy }) {
  const { sendMessage } = useMiraChat()
  if (!action || ['navigate', 'dismiss', 'ui_action'].includes(action.type)) return null
  const resource = result?.resource
  const href = resource && miraNavigationPath(resource.page, resource.id)
  if (result?.success && href) return <button className="my-2 rounded-xl border border-default-200 px-3 py-2 text-sm" onClick={() => window.dispatchEvent(new CustomEvent('mira:navigate', { detail: resource }))}>Open created {resource.page === 'projects' ? 'project' : 'meeting'} ↗</button>
  if (!result?.resolution?.candidates?.length || result.resolved) return null
  return <section className="my-3 space-y-2 text-sm" aria-label={result.resolution.kind === 'project' ? 'Choose a matching project' : 'Choose a matching person'}>
    {result.resolution.candidates.map(person => <button key={person.value} disabled={busy} onClick={() => sendMessage(`Choose ${person.name}${person.code ? ` (${person.code})` : ''}.`, { resolvePerson: { messageId, value: person.value } })}
      className="w-full rounded-xl border border-default-200 p-3 text-left hover:bg-white/10 disabled:opacity-40">
      <strong className="block">{person.name}</strong><span className="text-xs text-default-500">{[person.code, person.department].filter(Boolean).join(' · ')}</span>
    </button>)}
    {result.resolution.more && <p>More matches exist. Add more details to narrow the search.</p>}
  </section>
}

const MessageBubble = memo(function MessageBubble({ message, onSuggestionClick, onEdit, onRetry, onReply, busy }) {

  if (message.role === 'user') {
    return (
      <div className="group/msg flex flex-col items-end px-4 py-1.5">
        <div className="max-w-[85%] bg-white/10 text-neutral-100 rounded-2xl rounded-br-md px-4 py-2.5 shadow-sm">
          <p className="text-sm leading-relaxed">{miraMessageDisplay(message)}</p>
          {message.data?.attachments?.map((file, index) => <p key={index} className="mt-1 truncate text-xs text-neutral-400">Attachment: {file.name}</p>)}
        </div>
        <div className="mt-1 flex gap-1 text-neutral-400 md:opacity-0 md:group-hover/msg:opacity-100 md:group-focus-within/msg:opacity-100">
          <button aria-label="Edit and resend" title="Edit and resend" disabled={busy} onClick={() => onEdit(message)} className="rounded-md p-1.5 hover:bg-white/10 disabled:opacity-40"><Pencil size={13} /></button>
          <button aria-label="Retry message" title="Retry" disabled={busy} onClick={() => onRetry(message)} className="rounded-md p-1.5 hover:bg-white/10 disabled:opacity-40"><RotateCcw size={13} /></button>
        </div>
      </div>
    )
  }

  const data = message.data || { message: message.content, cards: [], suggestedQuestions: [] }
  // Keep concrete task results (including saved replies), not generic extra panels.
  const taskCards = Array.isArray(data.cards) ? data.cards.filter(card =>
    (card?.type === 'progress' && card.title === 'Your Pending Tasks' && card.data?.items?.length) ||
    (card?.type === 'list' && card.title === 'Task Breakdown' && card.data?.items?.length)
  ) : []
  const visibleCards = data.structured ? sanitizeMiraCards(data.cards) : taskCards

  return (
    <div
      className="flex items-start px-4 py-1.5 group/msg"
    >
      <div aria-hidden={!message.streaming} className="mira-reply-avatar flex-shrink-0 mt-1" data-active={Boolean(message.streaming)}>
        <MiraSphere size={28} isThinking={Boolean(message.streaming)} />
      </div>
      <div className="flex-1 min-w-0">
        {/* Message text */}
        <div className="relative px-1 py-2.5">
          <div className="text-sm text-default-800 leading-relaxed mira-markdown">
            <ReactMarkdown
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  if (!inline && (match || String(children).includes('\n'))) {
                    return <CodeBlock className={className}>{children}</CodeBlock>
                  }
                  return <code className="bg-default-200 dark:bg-default-300 px-1.5 py-0.5 rounded text-xs font-mono text-primary-600 dark:text-primary-400" {...props}>{children}</code>
                },
                pre({ children }) { return <>{children}</> },
                p({ children }) { return <p className="mb-2 last:mb-0">{children}</p> },
                ul({ children }) { return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul> },
                ol({ children }) { return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol> },
                li({ children }) { return <li className="text-sm">{children}</li> },
                h1({ children }) { return <h1 className="text-base font-bold mb-2 mt-3">{children}</h1> },
                h2({ children }) { return <h2 className="text-sm font-bold mb-1.5 mt-2">{children}</h2> },
                h3({ children }) { return <h3 className="text-sm font-semibold mb-1 mt-2">{children}</h3> },
                strong({ children }) { return <strong className="font-semibold">{children}</strong> },
                em({ children }) { return <em className="italic">{children}</em> },
                a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-500 underline hover:text-primary-600">{children}</a> },
                blockquote({ children }) { return <blockquote className="border-l-2 border-primary-300 pl-3 my-2 text-default-600 italic">{children}</blockquote> },
                hr() { return <hr className="my-3 border-divider" /> },
                table({ children }) { return <div className="overflow-x-auto my-2 rounded-lg border border-divider"><table className="w-full text-xs">{children}</table></div> },
                thead({ children }) { return <thead className="bg-default-100 dark:bg-default-200">{children}</thead> },
                th({ children }) { return <th className="text-left px-3 py-2 font-semibold text-default-600">{children}</th> },
                td({ children }) { return <td className="px-3 py-2 text-default-800 border-t border-divider">{children}</td> },
              }}
            >
              {data.message}
            </ReactMarkdown>
          </div>
          {/* Report actions */}
        </div>

        {visibleCards.length > 0 && (
          <div className="my-3 space-y-3">
            {visibleCards.map((card, index) => <AICard key={`${card.type}-${index}`} card={card} />)}
          </div>
        )}
        {data.image && <MiraGeneratedImage image={data.image} />}
        {Array.isArray(data.taskBank?.tasks) && data.taskBank.tasks.length > 1 && <ol aria-label="MIRA task queue" className="my-3 space-y-1 rounded-xl border border-default-200 p-3 text-xs text-default-600">
          {data.taskBank.tasks.map((task, index) => <li key={task.id}>{index + 1}. {task.request} · {task.status.replaceAll('_', ' ')}</li>)}
        </ol>}
        <MiraActionPreview action={data.action} result={data.actionResult} messageId={message.id} busy={busy} />
        <div hidden={message.streaming} className={message.streaming ? 'hidden' : 'mt-1 flex flex-wrap items-center gap-2 text-xs text-default-600 md:opacity-0 md:group-hover/msg:opacity-100 md:group-focus-within/msg:opacity-100'}>
          <button disabled={busy} onClick={() => onReply(message)} className="hover:underline disabled:opacity-50">Reply</button>
          <CopyButton text={data.message} />
          <ExportButton message={data} />
        </div>
        {/* Follow-ups live beside the composer, not beneath every reply. */}
      </div>
    </div>
  )
})

function formatTimeAgo(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// ─── Main Sidebar ───────────────────────────────────────────────────

export default function MiraChatSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const previousPath = useRef(pathname)
  const {
    isOpen, openChat, closeChat, messages, sendMessage, isThinking, clearHistory, tokens,
    viewMode, setViewMode,
    sessions, activeSessionId, showHistory, toggleHistory, loadSession, startNewChat, deleteSession, sessionsLoading
  } = useMiraChat()
  const { theme, isDarkMode } = useTheme()
  const [input, setInput] = useState('')
  const [editing, setEditing] = useState(null)
  const [replying, setReplying] = useState(null)
  const minimized = viewMode === 'pip'
  const expanded = viewMode === 'expanded'
  const sidebarDragEnabled = isOpen && viewMode === 'chat'
  const sidebarDrag = useMiraSidebarDrag(sidebarDragEnabled)
  useEffect(() => { if (isOpen) { void prepareMiraLocation(); void prewarmMiraVoice() } }, [isOpen])
  const latestReply = messages.at(-1)
  const followUps = latestReply?.role === 'assistant' && Array.isArray(latestReply.data?.suggestedQuestions)
    ? [...new Set(latestReply.data.suggestedQuestions.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim()))].slice(0, 3) : []
  useEffect(() => { setEditing(null); setReplying(null) }, [activeSessionId])
  const voice = useMiraVoice({ open: isOpen, busy: isThinking, sendMessage, onDismiss: closeChat })
  const [wakeRequested, setWakeRequested] = useState(false)
  useEffect(() => {
    if (isOpen && wakeRequested) { setWakeRequested(false); void voice.start() }
  }, [isOpen, wakeRequested, voice.start])
  useEffect(() => {
    if (previousPath.current !== pathname && isOpen && voice.active) setViewMode('pip')
    previousPath.current = pathname
  }, [pathname, isOpen, voice.active, setViewMode])
  useEffect(() => {
    const navigate = event => {
      const path = miraNavigationPath(event.detail?.page, event.detail?.id)
      if (!path) return
      setViewMode('pip')
      router.push(path)
    }
    window.addEventListener('mira:navigate', navigate)
    return () => window.removeEventListener('mira:navigate', navigate)
  }, [router, setViewMode])
  const [backgroundCompact, setBackgroundCompact] = useState(false)
  const panelVisible = useMiraPanelVisible(isOpen)
  const pip = isOpen && (minimized || backgroundCompact)
  const nativePipRef = useRef(null)
  useEffect(() => { if (!pip) nativePipRef.current?.restore() }, [pip])
  const popOutMira = () => {
    setViewMode('pip')
  }
  const restoreMira = () => {
    nativePipRef.current?.restore({ focus: true })
    setViewMode('chat')
  }
  const toggleMicrophone = () => voice.active ? voice.stop() : voice.start()
  const [slashResults, setSlashResults] = useState([])
  const [slashIdx, setSlashIdx] = useState(0)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const [attachments, setAttachments] = useState([])
  const [attachmentsBusy, setAttachmentsBusy] = useState(false)

  // Scroll to bottom on new messages
  useEffect(() => {
    if (!isOpen || pip || showHistory) return
    const frame = requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' }))
    return () => cancelAnimationFrame(frame)
  }, [messages, isThinking, isOpen, pip, showHistory])

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !pip) {
      const timeout = setTimeout(() => {
        if (document.visibilityState === 'visible' && document.hasFocus()) inputRef.current?.focus()
      }, 300)
      return () => clearTimeout(timeout)
    }
  }, [isOpen, pip])

  // Escape key to close
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && isOpen) closeChat()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, closeChat])

  const handleSend = useCallback(() => {
    if ((!input.trim() && !attachments.length) || isThinking || attachmentsBusy) return
    if (attachments.length) {
      sendMessage(input.trim() || 'Please summarize the attached files.', { attachments })
      setAttachments([])
      setInput('')
      setReplying(null)
      setEditing(null)
      return
    }
    // Check if it's a slash command
    const matched = SLASH_COMMANDS.find(c => input.trim().toLowerCase() === c.cmd)
    if (editing || replying) {
      const text = replying ? `Replying to this MIRA response:\n<quoted-response>\n${(replying.data?.message || replying.content).slice(0, 6000)}\n</quoted-response>\n\n${input.trim()}` : input.trim()
      sendMessage(text, editing ? { replaceFromId: editing.id } : {})
    } else if (matched) {
      sendMessage(matched.prompt)
    } else {
      sendMessage(input.trim())
    }
    setInput('')
    setSlashResults([])
    setEditing(null)
    setReplying(null)
  }, [input, isThinking, sendMessage, editing, replying, attachments, attachmentsBusy])

  const handleEdit = useCallback((message) => {
    setEditing(message)
    setReplying(null)
  }, [])
  const handleReply = useCallback((message) => {
    setReplying(message)
    setEditing(null)
    inputRef.current?.focus()
  }, [])
  const handleRetry = useCallback((message) => {
    if (message.role === 'user' && !isThinking) sendMessage(message.content, { replaceFromId: message.id, attachments: message.data?.attachments })
  }, [isThinking, sendMessage])

  const handleInputChange = useCallback((val) => {
    setInput(val)
    // Slash command autocomplete
    if (val.startsWith('/') && val.length > 1) {
      const q = val.toLowerCase()
      const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(q) || c.label.toLowerCase().includes(q.slice(1)))
      setSlashResults(matches)
      setSlashIdx(0)
    } else {
      setSlashResults([])
    }
  }, [])

  const handleSlashSelect = useCallback((cmd) => {
    if (cmd.prompt.endsWith(' ')) {
      // Prompt needs user continuation (e.g. brainstorm)
      setInput(cmd.prompt)
      setSlashResults([])
      inputRef.current?.focus()
    } else {
      sendMessage(cmd.prompt)
      setInput('')
      setSlashResults([])
    }
  }, [sendMessage])

  const handleQuickAction = useCallback((prompt) => {
    if (!isThinking) sendMessage(prompt)
  }, [isThinking, sendMessage])

  const handleKeyDown = useCallback((e) => {
    if (slashResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIdx(prev => (prev + 1) % slashResults.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIdx(prev => (prev - 1 + slashResults.length) % slashResults.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        handleSlashSelect(slashResults[slashIdx])
        return
      }
      if (e.key === 'Escape') {
        setSlashResults([])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, slashResults, slashIdx, handleSlashSelect])

  const handleSuggestionClick = useCallback((q) => {
    sendMessage(q)
  }, [sendMessage])

  const welcomeSuggestions = [
    "Show my pending tasks",
    "Write a Python script to sort a list",
    "Give me a dashboard overview",
    "Explain how async/await works",
  ]

  const latestCaptionMessage = messages.at(-1)
  const showMiraCaption = voice.state === 'speaking' || latestCaptionMessage?.streaming
  const pipCaption = voice.error || (showMiraCaption
    ? latestCaptionMessage?.content
    : voice.transcript || miraMessageDisplay(latestCaptionMessage)) || ''
  const pipSpeaker = voice.error ? 'Voice issue' : showMiraCaption ? 'MIRA' : voice.transcript ? 'You' : latestCaptionMessage?.role === 'user' ? 'You' : 'MIRA'

  return (
    <>
      <MiraActivityPointer />
      {/* Backdrop */}
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-black/30 transition-opacity duration-300 motion-reduce:transition-none z-[99998]"
          style={{ opacity: panelVisible && !pip ? 1 : 0, pointerEvents: isOpen && !pip ? 'auto' : 'none' }}
          onClick={closeChat}
        />

      {/* Floating Sidebar panel - glassmorphism */}
      <NativePipSurface ref={nativePipRef} enabled={isOpen} automatic onBackgroundChange={setBackgroundCompact}>
      <VoiceBeam stream={voice.stream} processing={isThinking} active={isOpen && (voice.active || isThinking)} paused={!isOpen || (!voice.active && !isThinking)} theme="dark" colorVariant="mono" strength={0.95}
        sensitivity={5.4} threshold={0.015} attack={0.12} release={0.42} reach={1.9} idle={0.14}
        borderRadius={16}
        role="dialog"
        aria-label="MIRA assistant"
        aria-hidden={!isOpen}
        inert={!isOpen ? true : undefined}
        className="mira-workspace fixed flex flex-col z-[99999] rounded-2xl overflow-hidden shadow-2xl"
        style={{
          opacity: panelVisible ? 1 : 0,
          transform: panelVisible ? 'translate3d(0, 0, 0)' : 'translate3d(-24px, 0, 0)',
          pointerEvents: isOpen ? 'auto' : 'none',
          transitionDuration: '300ms',
          transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          left: pip ? '24px' : expanded ? 12 : sidebarDrag.position?.x ?? 12,
          right: undefined,
          borderRadius: 16,
          top: pip ? 'auto' : `max(var(--mira-panel-top, 73px), ${expanded ? 12 : sidebarDrag.position?.y ?? 12}px)`,
          bottom: pip ? '24px' : 'auto',
          height: pip ? 'auto' : 'calc(100dvh - var(--mira-panel-top, 73px) - 12px)',
          transitionProperty: sidebarDrag.dragging ? 'none' : pip ? 'opacity, transform' : 'opacity, transform, left, top, width',
          width: pip ? 'min(340px, calc(100vw - 48px))' : expanded ? 'calc(100vw - 24px)' : 'min(460px, calc(100vw - 24px))',
          background: isDarkMode
            ? 'rgba(18, 18, 18, 0.72)'
            : `linear-gradient(135deg, rgba(255,255,255,0.78), rgba(250,252,255,0.85))`,
          position: 'fixed', display: 'flex', flexDirection: 'column',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: `1px solid ${isDarkMode ? `${theme.primary[500]}30` : `${theme.primary[400]}35`}`,
          boxShadow: isDarkMode
            ? `0 8px 60px -12px ${theme.primary[900]}80, 0 0 0 1px ${theme.primary[700]}15, inset 0 1px 0 ${theme.primary[400]}08`
            : `0 8px 60px -12px ${theme.primary[300]}60, 0 0 0 1px ${theme.primary[200]}40, inset 0 1px 0 rgba(255,255,255,0.6)`,
        }}
      >
        {isOpen && (isThinking || latestReply?.streaming || voice.state === 'speaking') && <AIActivityBeam active theme="dark" borderRadius={16} />}
        {pip && <div className="p-3 text-foreground relative cursor-pointer" onClick={restoreMira}>
          <button aria-label="Dismiss MIRA" onClick={event => { event.stopPropagation(); closeChat() }} className="absolute right-2 top-2 z-10 p-2 rounded-full hover:bg-default-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><FaTimes className="w-4 h-4" /></button>
          <button aria-label="Restore MIRA chat" className="w-full flex items-center gap-3 pr-10 text-left rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <MiraSphere size={28} isThinking={isThinking} />
            <span className="flex-1 text-xs font-medium">MIRA · {isThinking ? 'Thinking' : voice.state === 'speaking' ? 'Speaking' : voice.active ? 'Listening' : 'Ready'}</span>
          </button>
          <div role="status" aria-live="polite" aria-label="MIRA live captions" className="mt-3 max-h-36 overflow-y-auto text-sm leading-relaxed break-words whitespace-pre-wrap">
            {pipCaption ? <><span className="block text-[11px] text-default-500 mb-1">{pipSpeaker}</span>{miraPlainCaption(pipCaption)}</> : <span className="text-default-500">{voice.active ? 'Speak naturally. Your words appear here.' : 'Your conversation captions appear here.'}</span>}
          </div>
        </div>}
        <div className={pip ? 'hidden' : 'contents'}>
        {/* Compact controls; identity stays in the conversation, not the toolbar. */}
        <div
          className="flex items-center justify-between px-4 h-[48px] flex-shrink-0"
          role="toolbar"
          aria-label="Chat controls"
          {...sidebarDrag.handlers}
          tabIndex={sidebarDragEnabled ? 0 : undefined}
          title={sidebarDragEnabled ? 'Drag to move MIRA. Use arrow keys when focused.' : undefined}
          style={{
            background: 'transparent',
            borderRadius: '16px 16px 0 0',
            cursor: sidebarDragEnabled ? sidebarDrag.dragging ? 'grabbing' : 'grab' : undefined,
            touchAction: sidebarDragEnabled ? 'none' : undefined,
            userSelect: sidebarDragEnabled ? 'none' : undefined,
          }}
        >
          <div className="flex items-center gap-2.5">
            {!showHistory && <button onClick={toggleHistory} title="Chat history" aria-label="Chat history" className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10"><FaHistory className="w-3 h-3" /></button>}
            <button onClick={startNewChat} title="New chat" aria-label="New chat" disabled={isThinking} className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-40"><FaPlus className="w-3 h-3" /></button>
            {showHistory && <>
              <button onClick={toggleHistory} aria-label="Back to chat" className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                <FaChevronLeft className="w-3.5 h-3.5" />
              </button>
            <div>
              <h2 className="text-sm font-bold text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
                Chat History
              </h2>
              <p className="text-[10px] text-white/60 font-medium">
                {`${sessions.length} conversation${sessions.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            </>}
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={popOutMira} className="p-2 rounded-lg text-white/70 hover:bg-white/10" aria-label="Minimize MIRA to floating voice">−</button>
            <button onClick={() => setViewMode(expanded ? 'chat' : 'expanded')} className="p-2 rounded-lg text-white/70 hover:bg-white/10" aria-label={expanded ? 'Collapse MIRA sidebar' : 'Expand MIRA workspace'} aria-pressed={expanded}>
              {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              onClick={closeChat}
              aria-label="Close MIRA"
              className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <FaTimes className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Chat History Panel */}
        {showHistory ? (
          <div className="flex-1 overflow-y-auto">
            {/* New chat button */}
            <div className="p-3">
              <button
                onClick={startNewChat}
                className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                style={{
                  background: `linear-gradient(135deg, ${theme.primary[500]}18, ${theme.primary[600]}10)`,
                  border: `1px solid ${isDarkMode ? `${theme.primary[500]}30` : `${theme.primary[400]}25`}`,
                  color: isDarkMode ? theme.primary[300] : theme.primary[600],
                }}
              >
                <FaPlus className="w-3 h-3" />
                New Conversation
              </button>
            </div>

            {sessionsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <FaHistory className="w-8 h-8 text-default-300 mb-3" />
                <p className="text-sm text-default-500">No chat history yet</p>
                <p className="text-xs text-default-400 mt-1">Start a conversation and it&apos;ll appear here</p>
              </div>
            ) : (
              <div className="px-3 pb-3 space-y-1">
                {sessions.map(session => {
                  const isActive = session._id === activeSessionId
                  const timeAgo = formatTimeAgo(session.lastMessageAt || session.createdAt)
                  return (
                    <div
                      key={session._id}
                      className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${isActive ? '' : 'hover:bg-default-100/50 dark:hover:bg-white/5'}`}
                      style={isActive ? {
                        background: isDarkMode ? `${theme.primary[500]}15` : `${theme.primary[50]}`,
                        border: `1px solid ${isDarkMode ? `${theme.primary[500]}25` : `${theme.primary[200]}50`}`,
                      } : {}}
                      onClick={() => loadSession(session._id)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${isActive ? 'font-semibold' : 'font-medium'} text-default-800`}>
                          {session.title || 'New Chat'}
                        </p>
                        <p className="text-[10px] text-default-400 mt-0.5">{timeAgo}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSession(session._id) }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-default-400 hover:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-all"
                        title="Delete conversation"
                      >
                        <FaRegTrashAlt className="w-3 h-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
        /* Messages area */
        <div className="flex-1 min-h-0 overflow-y-auto py-4">
          <div className="mx-auto w-full max-w-[1100px]">
          {messages.length === 0 && !isThinking ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="mb-4">
                <MiraSphere size={64} />
              </div>
              <h3 className="text-lg font-bold text-default-800 mb-1">Hi! I&apos;m MIRA</h3>
              <p className="text-sm text-default-500 mb-6">Your all-rounder AI assistant. Ask me anything - code, research, math, writing, or your Talio data.</p>
              <div className="w-full space-y-2">
                {welcomeSuggestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(q)}
                    className="w-full text-left text-sm px-4 py-2.5 rounded-xl text-default-700 hover:bg-default-100/60 dark:hover:bg-white/5 transition-colors"
                    style={{
                      border: `1px solid ${isDarkMode ? `${theme.primary[500]}20` : `${theme.primary[300]}30`}`,
                      background: isDarkMode ? 'rgba(255,255,255,0.03)' : `${theme.primary[50]}40`,
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onSuggestionClick={handleSuggestionClick} onEdit={handleEdit} onRetry={handleRetry} onReply={handleReply} busy={isThinking} />
              ))}
              {isThinking && messages.at(-1)?.role !== 'assistant' && <ThinkingIndicator />}
              <div ref={messagesEndRef} />
            </>
          )}
          </div>
        </div>
        )}

        {/* One floating composer, aligned with the conversation above. */}
        {!showHistory && (
        <div
          className="flex-shrink-0 mx-auto w-full max-w-[1100px] px-4 pb-5 pt-2"
        >
          {followUps.length > 0 && !isThinking && (
            <div aria-label="Suggested follow-ups" className="mb-2 grid gap-1.5 max-h-40 overflow-y-auto">
              {followUps.map(q => <button key={q} onClick={() => handleSuggestionClick(q)} className="w-full rounded-xl border border-default-200 px-3 py-2 text-left text-xs text-default-600 hover:bg-white/5">{q}</button>)}
            </div>
          )}

          {/* Slash command dropdown */}
          {slashResults.length > 0 && (
            <div className="mx-3 mt-2 rounded-xl border border-divider bg-content1 shadow-lg overflow-hidden">
              {slashResults.map((cmd, i) => {
                const Icon = cmd.icon
                return (
                  <button
                    key={cmd.cmd}
                    onClick={() => handleSlashSelect(cmd)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      i === slashIdx ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-default-100'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${i === slashIdx ? 'text-primary-500' : 'text-default-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-default-800">{cmd.cmd} <span className="text-default-400 font-normal">- {cmd.label}</span></p>
                      <p className="text-[10px] text-default-400 truncate">{cmd.desc}</p>
                    </div>
                  </button>
                )
              })}
              <div className="px-4 py-1.5 border-t border-divider bg-default-50">
                <p className="text-[9px] text-default-400">
                  <kbd className="px-1 py-0.5 rounded bg-default-200 text-default-600 font-mono">↵</kbd> select &nbsp;
                  <kbd className="px-1 py-0.5 rounded bg-default-200 text-default-600 font-mono">↑↓</kbd> navigate &nbsp;
                  <kbd className="px-1 py-0.5 rounded bg-default-200 text-default-600 font-mono">esc</kbd> dismiss
                </p>
              </div>
            </div>
          )}

          {replying && <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-default-200 px-3 py-2 text-xs text-default-600">
            <span className="truncate">{`Replying to: ${replying.data?.message || replying.content}`}</span>
            <button aria-label="Cancel edit or reply" onClick={() => { setEditing(null); setReplying(null) }}><FaTimes /></button>
          </div>}
          <MiraAttachments files={attachments} onChange={setAttachments} busy={isThinking} onBusyChange={setAttachmentsBusy} />
          <div className="flex items-end gap-2 p-2 rounded-2xl border border-default-200 bg-white/5">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={voice.active ? (voice.transcript || (voice.state === 'loading' ? 'Preparing voice…' : voice.state === 'speaking' ? 'MIRA is speaking…' : voice.state === 'thinking' ? 'Thinking…' : 'Listening…')) : 'Ask MIRA…'}
                disabled={isThinking}
                rows={1}
                className="block w-full resize-none rounded-xl text-default-800 text-sm px-3 py-2.5 focus:outline-none placeholder:text-default-400 disabled:opacity-50"
                style={{
                  maxHeight: '120px',
                  minHeight: '44px',
                  background: 'transparent',
                  border: 'none',
                }}
                onInput={(e) => {
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
              />
            </div>
            <button onClick={toggleMicrophone} disabled={!voice.active && isThinking} className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-default-100 text-default-800" title={voice.active ? 'Stop voice conversation' : 'Talk in your language. Conversation audio and spoken replies use ElevenLabs.'} aria-label={voice.active ? 'Stop voice conversation' : 'Start voice conversation'} aria-pressed={voice.active}>
              {voice.active ? <Square size={16} /> : <Mic size={16} />}
            </button>
            <button
              onClick={handleSend}
              aria-label="Send message"
              disabled={(!input.trim() && !attachments.length) || isThinking || attachmentsBusy}
              className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-110"
              style={{ background: '#f5f5f5', color: '#171717' }}
            >
              <FaPaperPlane className="w-3.5 h-3.5" />
            </button>
          </div>
          {voice.error && <p className="px-3 text-xs text-danger" role="alert">{voice.error}</p>}
          <span className="sr-only" role="status">{voice.active ? voice.state : ''}</span>
        </div>
        )}
        </div>
        <div className={pip ? 'hidden' : 'flex-shrink-0 px-2 pb-2 empty:hidden'}>
          <MiraWakeSetup onWake={({ background } = {}) => {
            setWakeRequested(true)
            if (!isOpen) openChat({ mode: background ? 'pip' : 'chat' })
            else if (background) setViewMode('pip')
          }} onStream={() => {}} suspended={voice.active} />
        </div>
      </VoiceBeam>
      </NativePipSurface>
      {editing && <MiraEditPrompt message={editing} busy={isThinking} onClose={() => setEditing(null)} onSave={(message, text) => { setEditing(null); sendMessage(text, { replaceFromId: message.id, attachments: message.data?.attachments }) }} />}
    </>
  )
}
