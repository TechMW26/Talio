'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createMiraVoiceTurns } from '@/lib/miraVoiceTurns'
import { createMiraVoiceEchoGuard } from '@/lib/miraVoiceEcho'
import { miraSpeechSummary } from '@/lib/miraSpokenReply'
import { isMiraDismissal } from '@/lib/miraDismissal'
import { buildMiraOutputLanguageDirective } from '@/lib/miraLanguage'

export const prewarmMiraAgentVoice = () => import('@elevenlabs/client')

export default function useMiraAgentVoice({ open, busy, sendMessage, recordVoiceMessage, onTokens, onDismiss, interruptResponse }) {
  const [state, setState] = useState('idle'), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [voiceName, setVoiceName] = useState('Mira')
  const [muted, setMuted] = useState(false)
  const current = useRef({ open, busy, sendMessage, recordVoiceMessage, onTokens, onDismiss, interruptResponse }), session = useRef(null)
  current.current = { open, busy, sendMessage, recordVoiceMessage, onTokens, onDismiss, interruptResponse }
  // VoiceBeam samples this getter per frame; reuse the call's own analysers.
  // No second microphone, AudioContext or React render loop.
  const level = useCallback(() => {
    const call = session.current?.conversation
    return Math.max(0, Math.min(1, Math.max(Number(call?.getInputVolume?.()) || 0, Number(call?.getOutputVolume?.()) || 0)))
  }, [])
  const stop = useCallback(() => {
    const run = session.current
    session.current = null
    if (run) current.current.recordVoiceMessage?.({ source: 'complete', messages: run.captions, target: run.voiceTarget })
    run?.abort.abort()
    run?.conversation?.endSession().catch(() => {})
    setState('idle'); setMuted(false)
  }, [])
  const toggleMute = useCallback(() => {
    const run = session.current
    if (!run?.conversation) return
    run.muted = !run.muted
    run.conversation.setMicMuted(run.muted)
    setMuted(run.muted)
  }, [])
  useEffect(() => { if (!open) stop() }, [open, stop])
  useEffect(() => stop, [stop])
  const start = useCallback(async () => {
    if (session.current || !current.current.open) return
    const run = { abort: new AbortController(), turns: createMiraVoiceTurns(), echo: createMiraVoiceEchoGuard(), mode: 'listening', pending: 0, generation: 0, toolTurn: false, replies: new Set(), accounting: Promise.resolve(), captions: [], startedAt: Date.now(), voiceTarget: current.current.recordVoiceMessage?.({ source: 'start' }) }
    session.current = run
    const live = () => session.current === run && current.current.open
    setError(''); setNotice(''); setState('loading')
    try {
      const [sdk, response] = await Promise.all([prewarmMiraAgentVoice(), fetch('/api/ai/mira-agent/session', {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transport: 'webrtc' }), signal: run.abort.signal,
      })])
      const config = await response.json()
      if (!response.ok || !config.success) throw new Error(config.message || 'Mira voice is unavailable')
      if (!live()) return
      setNotice(config.voiceNotice || '')
      setVoiceName(config.voiceName || 'Mira')
      const conversation = await sdk.Conversation.startSession({
        conversationToken: config.conversationToken, connectionType: 'webrtc', useWakeLock: false,
        // AudioWorklets obey script-src, not worker-src. Use same-origin static
        // modules rather than the SDK's CSP-blocked blob/data URLs or CDN fallback.
        workletPaths: {
          rawAudioProcessor: '/mira/worklets/elevenlabs-1.27.0/rawAudioProcessor.js',
          audioConcatProcessor: '/mira/worklets/elevenlabs-1.27.0/audioConcatProcessor.js',
        },
        libsampleratePath: '/mira/worklets/libsamplerate-2.1.2/libsamplerate.worklet.js',
        overrides: { tts: { voiceId: config.voiceId } },
        clientTools: {
          close_mira: params => {
            const turn = run.turns.latest()
            if (!live() || !turn?.text || run.echo.reject(params?.message, Date.now(), true)) return
            if (turn.text.trim() !== params?.message?.trim()) return
            stop(); current.current.onDismiss?.()
          },
          ask_mira: params => {
            if (!live() || run.echo.reject(params?.message, Date.now(), true)) return JSON.stringify({ speech: '' })
            // The hosted model may rewrite tool parameters. Execution authority
            // comes from the accepted final transcript, never model-authored text.
            const turn = run.turns.latest()
            if (!turn?.text) return JSON.stringify({ speech: 'Please repeat your request.' })
            return run.turns.execute({ message: turn.text, utterance_id: `native_${turn.sequence}` }, async text => {
              if (!live()) return JSON.stringify({ speech: '' })
              const generation = run.generation
              run.toolTurn = true
              run.pending++; setState('working')
              try {
                await run.accounting
                if (!live()) return JSON.stringify({ speech: '' })
                const userCaption = run.captions.at(-1)
                if (userCaption?.source === 'user') userCaption.persisted = true
                if (isMiraDismissal(text)) {
                  await current.current.sendMessage(text, { inputMode: 'voice' })
                  stop(); current.current.onDismiss?.()
                  return JSON.stringify({ speech: '' })
                }
                let finalSpeech = ''
                const voiceHistory = run.captions.filter(m => !m.persisted).slice(-20).map(m => ({ role: m.source === 'user' ? 'user' : 'assistant', content: m.message }))
                const reply = await current.current.sendMessage(text, { inputMode: 'voice', voiceTool: true, voiceHistory, onSpeech: speech => { finalSpeech = speech } })
                const speech = live() && generation === run.generation ? finalSpeech || miraSpeechSummary(reply || '') || 'Please check the reply in chat.' : ''
                if (speech) run.echo.remember(speech)
                return JSON.stringify({ speech })
              } finally { run.pending--; if (live()) setState(run.mode === 'speaking' ? 'speaking' : 'listening') }
            })
          },
        },
        onConnect: () => { if (live()) setState('listening') },
        onDisconnect: () => { if (live()) stop() },
        onError: () => { if (live()) { stop(); setError('Voice connection interrupted. Your conversation is still in chat; reconnect to continue.') } },
        onMessage: event => {
          if (!live()) return
          // ASR can emit punctuation-only placeholders during silence. They are
          // not utterances or replies and must not create captions/usage charges.
          if (typeof event.message !== 'string' || !/[\p{L}\p{N}]/u.test(event.message)) return
          if (event.source === 'ai') {
            run.echo.remember(event.message)
            const key = `${run.generation}:${event.event_id ?? event.message}`
            if (!run.toolTurn && !run.replies.has(key)) {
              run.replies.add(key)
              if (run.replies.size > 64) run.replies.delete(run.replies.values().next().value)
              run.captions.push({ ...event, timestamp: new Date() })
            }
            return
          }
          if (event.source !== 'user' || run.echo.reject(event.message, Date.now())) return
          if (!run.turns.transcript(event.message, event.event_id)) return
          run.generation++
          run.toolTurn = false
          if (isMiraDismissal(event.message)) {
            run.captions.push({ ...event, timestamp: new Date() })
            stop(); current.current.onDismiss?.()
            return
          }
          const language = buildMiraOutputLanguageDirective(event.message, run.captions.map(m => ({ role: m.source === 'user' ? 'user' : 'assistant', content: m.message })))
          if (language !== run.language) {
            run.language = language
            run.conversation?.sendContextualUpdate?.(`Reply-language constraint for the user's current request: ${language} Keep feminine self-reference and the selected voice's dialect. No audio tags or silence check-ins.`)
          }
          run.captions.push({ ...event, timestamp: new Date() })
          const turn = run.turns.latest().sequence
          // Accounting stays off the speech path. Loss of authorization, balance
          // or connectivity ends the call; tool execution waits for this check.
          run.accounting = run.accounting.then(async () => {
            if (!live()) return
            const response = await fetch('/api/ai/mira-agent/usage', {
              method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ bridgeCredential: config.bridgeCredential, turn }), signal: run.abort.signal,
            })
            const balance = await response.json()
            if (!response.ok || !balance.success) throw new Error(balance.message || 'Could not authorize this voice turn')
            if (live()) current.current.onTokens?.(balance)
          }).catch(err => { if (live()) { stop(); setError(err.message || 'Voice authorization interrupted. Reconnect to continue.') } })
        },
        onModeChange: ({ mode }) => { run.mode = mode; run.echo.mode(mode, Date.now()); if (live()) setState(run.pending ? 'working' : mode) },
        onInterruption: () => {
          run.generation++
          // Stop generation, never automatically retry an uncertain action.
          if (live()) current.current.interruptResponse?.()
        },
      })
      if (!live()) { await conversation.endSession(); return }
      run.conversation = conversation
    } catch (err) {
      if (live()) { stop(); if (err.name !== 'AbortError') setError(err.message || 'Could not start Mira voice') }
    }
  }, [stop])
  return { state, stream: null, level, transcript: '', error, notice, voiceName, startedAt: session.current?.startedAt, muted, toggleMute, start, stop, active: state !== 'idle' }
}
