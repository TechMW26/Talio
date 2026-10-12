'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createMiraVoiceTurns } from '@/lib/miraVoiceTurns'
import { createMiraVoiceEchoGuard } from '@/lib/miraVoiceEcho'
import { miraSpeechSummary } from '@/lib/miraSpokenReply'
import { isMiraDismissal } from '@/lib/miraDismissal'

export const prewarmMiraAgentVoice = () => import('@elevenlabs/client')

export default function useMiraAgentVoice({ open, busy, sendMessage, onDismiss, interruptResponse }) {
  const [state, setState] = useState('idle'), [transcript, setTranscript] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [voiceName, setVoiceName] = useState('Mira')
  const current = useRef({ open, busy, sendMessage, onDismiss, interruptResponse }), session = useRef(null)
  current.current = { open, busy, sendMessage, onDismiss, interruptResponse }
  const stop = useCallback(() => {
    const run = session.current
    session.current = null
    run?.abort.abort()
    run?.conversation?.endSession().catch(() => {})
    setState('idle'); setTranscript('')
  }, [])
  useEffect(() => { if (!open) stop() }, [open, stop])
  useEffect(() => stop, [stop])
  const start = useCallback(async () => {
    if (session.current || !current.current.open) return
    const run = { abort: new AbortController(), turns: createMiraVoiceTurns(), echo: createMiraVoiceEchoGuard(), mode: 'listening', pending: 0, generation: 0 }
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
        customLlmExtraBody: { mira_bridge_credential: config.bridgeCredential },
        clientTools: {
          ask_mira: params => {
            if (!live() || run.echo.reject(params?.message, Date.now(), true)) return JSON.stringify({ speech: '' })
            return run.turns.execute(params, async text => {
              if (!live()) return JSON.stringify({ speech: '' })
              const generation = run.generation
              run.pending++; setState('thinking')
              try {
                if (isMiraDismissal(text)) {
                  await current.current.sendMessage(text, { inputMode: 'voice' })
                  stop(); current.current.onDismiss?.()
                  return JSON.stringify({ speech: '' })
                }
                let finalSpeech = ''
                const reply = await current.current.sendMessage(text, { inputMode: 'voice', onSpeech: speech => { finalSpeech = speech } })
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
          if (event.source === 'ai') { run.echo.remember(event.message); return }
          if (event.source !== 'user' || run.echo.reject(event.message, Date.now())) return
          if (!run.turns.transcript(event.message, event.event_id)) return
          run.generation++
          setTranscript(event.message)
        },
        onModeChange: ({ mode }) => { run.mode = mode; run.echo.mode(mode, Date.now()); if (live()) setState(run.pending ? 'thinking' : mode) },
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
  return { state, stream: null, transcript, error, notice, voiceName, start, stop, active: state !== 'idle' }
}
