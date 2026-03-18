'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { FaTimes, FaPaperPlane, FaTrash, FaExternalLinkAlt, FaHistory, FaPlus, FaChevronLeft, FaRegTrashAlt, FaCopy, FaCheck, FaSlash, FaBolt, FaTasks, FaCalendarAlt, FaProjectDiagram, FaBriefcase, FaUserClock, FaLightbulb } from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { useMiraChat } from '@/contexts/MiraChatContext'
import { useTheme } from '@/contexts/ThemeContext'
import MiraSphere from '@/components/ui/MiraSphere'
import ReactMarkdown from 'react-markdown'

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
          onClick={() => item.link && router.push(item.link)}
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

const THINKING_PHRASES = [
  'Analyzing your request...',
  'Searching for information...',
  'Crunching the data...',
  'Putting it together...',
  'Almost there...',
  'Thinking deeply...',
  'Processing your query...',
]

function ThinkingIndicator() {
  const [phraseIdx, setPhraseIdx] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIdx(prev => (prev + 1) % THINKING_PHRASES.length)
    }, 2200)
    return () => clearInterval(interval)
  }, [])
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="flex-shrink-0 mt-0.5">
        <MiraSphere size={28} isThinking={true} />
      </div>
      <div className="flex-1">
        <p className="text-xs font-medium text-primary-500 mb-2 transition-all duration-300">{THINKING_PHRASES[phraseIdx]}</p>
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

function MessageBubble({ message, onSuggestionClick }) {
  const [showCopy, setShowCopy] = useState(false)

  if (message.role === 'user') {
    return (
      <div className="flex justify-end px-4 py-1.5">
        <div className="max-w-[85%] bg-primary-500 text-white rounded-2xl rounded-br-md px-4 py-2.5 shadow-sm">
          <p className="text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    )
  }

  const data = message.data || { message: message.content, cards: [], suggestedQuestions: [] }

  return (
    <div
      className="flex items-start gap-2.5 px-4 py-1.5 group/msg"
      onMouseEnter={() => setShowCopy(true)}
      onMouseLeave={() => setShowCopy(false)}
    >
      <div className="flex-shrink-0 mt-1">
        <MiraSphere size={28} />
      </div>
      <div className="flex-1 min-w-0">
        {/* Message text */}
        <div className="relative bg-default-50 dark:bg-default-100 rounded-2xl rounded-tl-md px-4 py-2.5 shadow-sm">
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
          {/* Copy message button */}
          {showCopy && (
            <div className="absolute -bottom-2 right-2">
              <CopyButton text={data.message} className="shadow-sm" />
            </div>
          )}
        </div>

        {/* Cards */}
        {data.cards?.length > 0 && (
          <div className="mt-2 space-y-2">
            {data.cards.map((card, i) => (
              <div key={i} className="bg-content1 rounded-xl p-3 shadow-sm border border-divider">
                <AICard card={card} />
              </div>
            ))}
          </div>
        )}

        {/* Suggested questions */}
        {data.suggestedQuestions?.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {data.suggestedQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => onSuggestionClick(q)}
                className="text-xs px-3 py-1.5 rounded-full border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────

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
  const {
    isOpen, closeChat, messages, sendMessage, isThinking, clearHistory, tokens,
    sessions, activeSessionId, showHistory, toggleHistory, loadSession, startNewChat, deleteSession, sessionsLoading
  } = useMiraChat()
  const { theme, isDarkMode } = useTheme()
  const [input, setInput] = useState('')
  const [slashResults, setSlashResults] = useState([])
  const [slashIdx, setSlashIdx] = useState(0)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  // Escape key to close
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && isOpen) closeChat()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, closeChat])

  const handleSend = useCallback(() => {
    if (!input.trim() || isThinking) return
    // Check if it's a slash command
    const matched = SLASH_COMMANDS.find(c => input.trim().toLowerCase() === c.cmd)
    if (matched) {
      sendMessage(matched.prompt)
    } else {
      sendMessage(input.trim())
    }
    setInput('')
    setSlashResults([])
  }, [input, isThinking, sendMessage])

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

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 z-[99998]"
          onClick={closeChat}
        />
      )}

      {/* Floating Sidebar panel - glassmorphism */}
      <div
        className={`fixed top-3 left-3 bottom-3 w-[calc(100%-1.5rem)] max-w-[420px] flex flex-col z-[99999] transition-all duration-300 ease-out rounded-2xl overflow-hidden shadow-2xl ${isOpen ? 'translate-x-0 opacity-100 scale-100' : '-translate-x-[110%] opacity-0 scale-95'}`}
        style={{
          background: isDarkMode
            ? `linear-gradient(135deg, rgba(15,20,35,0.82), rgba(10,14,28,0.88))`
            : `linear-gradient(135deg, rgba(255,255,255,0.78), rgba(250,252,255,0.85))`,
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: `1px solid ${isDarkMode ? `${theme.primary[500]}30` : `${theme.primary[400]}35`}`,
          boxShadow: isDarkMode
            ? `0 8px 60px -12px ${theme.primary[900]}80, 0 0 0 1px ${theme.primary[700]}15, inset 0 1px 0 ${theme.primary[400]}08`
            : `0 8px 60px -12px ${theme.primary[300]}60, 0 0 0 1px ${theme.primary[200]}40, inset 0 1px 0 rgba(255,255,255,0.6)`,
        }}
      >
        {/* Header - gradient with theme tint */}
        <div
          className="flex items-center justify-between px-4 h-[58px] flex-shrink-0"
          style={{
            background: `linear-gradient(135deg, ${theme.primary[600]}, ${theme.primary[500]}, ${theme.primary[700]})`,
            borderRadius: '16px 16px 0 0',
          }}
        >
          <div className="flex items-center gap-2.5">
            {showHistory ? (
              <button onClick={toggleHistory} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                <FaChevronLeft className="w-3.5 h-3.5" />
              </button>
            ) : (
              <div className="flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm" style={{ width: 34, height: 34 }}>
                <MiraSphere size={28} isHovered={true} />
              </div>
            )}
            <div>
              <h2 className="text-sm font-bold text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
                {showHistory ? 'Chat History' : 'MIRA'}
              </h2>
              <p className="text-[10px] text-white/60 font-medium">
                {showHistory ? `${sessions.length} conversation${sessions.length !== 1 ? 's' : ''}` : 'Your AI Assistant'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {/* Token balance */}
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-sm mr-1">
              <svg className="w-3 h-3 text-yellow-300" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm.75 4.75a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" /></svg>
              <span className="text-[11px] font-bold text-white">{tokens.tokensRemaining}</span>
              <span className="text-[10px] text-white/50">tokens</span>
            </div>
            {!showHistory && (
              <>
                <button
                  onClick={toggleHistory}
                  className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  title="Chat history"
                >
                  <FaHistory className="w-3 h-3" />
                </button>
                <button
                  onClick={() => { startNewChat() }}
                  className="p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  title="New chat"
                >
                  <FaPlus className="w-3 h-3" />
                </button>
              </>
            )}
            <button
              onClick={closeChat}
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
        <div className="flex-1 overflow-y-auto py-4">
          {messages.length === 0 && !isThinking ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="mb-4">
                <MiraSphere size={64} enableRandomPulse={true} />
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
                <MessageBubble key={msg.id} message={msg} onSuggestionClick={handleSuggestionClick} />
              ))}
              {isThinking && <ThinkingIndicator />}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
        )}

        {/* Input area - frosted bottom bar */}
        {!showHistory && (
        <div
          className="flex-shrink-0"
          style={{
            borderTop: `1px solid ${isDarkMode ? `${theme.primary[500]}15` : `${theme.primary[300]}20`}`,
            background: isDarkMode ? 'rgba(10,14,28,0.5)' : 'rgba(255,255,255,0.4)',
          }}
        >
          {/* Quick Actions - show when no messages */}
          {messages.length === 0 && !isThinking ? null : (
            <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0 overflow-x-auto scrollbar-hide">
              <FaBolt className="w-2.5 h-2.5 text-default-400 flex-shrink-0" />
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action.prompt)}
                  disabled={isThinking}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-40"
                  style={{
                    borderColor: isDarkMode ? `${theme.primary[500]}25` : `${theme.primary[300]}35`,
                    color: isDarkMode ? theme.primary[300] : theme.primary[600],
                    background: isDarkMode ? `${theme.primary[500]}08` : `${theme.primary[50]}60`,
                  }}
                >
                  <action.icon className="w-2.5 h-2.5" />
                  {action.label}
                </button>
              ))}
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

          <div className="flex items-end gap-2 p-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isThinking ? 'MIRA is thinking...' : 'Ask anything... or type / for commands'}
                disabled={isThinking}
                rows={1}
                className="w-full resize-none rounded-xl text-default-800 text-sm px-4 py-3 pr-10 focus:outline-none placeholder:text-default-400 disabled:opacity-50 transition-all"
                style={{
                  maxHeight: '120px',
                  minHeight: '44px',
                  background: isDarkMode ? 'rgba(255,255,255,0.06)' : `${theme.primary[50]}50`,
                  border: `1px solid ${isDarkMode ? `${theme.primary[500]}20` : `${theme.primary[200]}50`}`,
                }}
                onInput={(e) => {
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isThinking}
              className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:brightness-110"
              style={{ background: `linear-gradient(135deg, ${theme.primary[500]}, ${theme.primary[600]})` }}
            >
              <FaPaperPlane className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-default-400 text-center pb-2 px-3">
            <span className="font-medium">{tokens.tokensRemaining}/{tokens.tokenLimit}</span> tokens remaining · Type <kbd className="px-1 py-0.5 rounded bg-default-200 text-default-500 font-mono text-[9px]">/</kbd> for commands
          </p>
        </div>
        )}
      </div>
    </>
  )
}
