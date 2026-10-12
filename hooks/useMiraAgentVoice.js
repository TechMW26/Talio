'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createMiraVoiceTurns, createMiraAcknowledgementCadence } from '@/lib/miraVoiceTurns'
import { createMiraListeningAudio } from '@/lib/miraListeningAudio'
import { miraSpeechSummary } from '@/lib/miraSpokenReply'
import { isMiraDismissal } from '@/lib/miraDismissal'

export const prewarmMiraAgentVoice = () => import('@elevenlabs/client')

export default function useMiraAgentVoice({ open, busy, sendMessage, onDismiss, interruptResponse }) {
  const [state, setState] = useState('idle'), [transcript, setTranscript] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const current = useRef({ open, busy, sendMessage, onDismiss, interruptResponse }), session = useRef(null)
  current.current = { open, busy, sendMessage, onDismiss, interruptResponse }
  const stop = useCallback(() => {
    const run = session.current
    session.current = null
    run?.abort.abort(); run?.ack.close()
    run?.conversation?.endSession().catch(() => {})
    setState('idle'); setTranscript('')
  }, [])
  useEffect(() => { if (!open) stop() }, [open, stop])
  useEffect(() => stop, [stop])
  const start = useCallback(async () => {
    if (session.current || !current.current.open) return
    const run = { abort: new AbortController(), ack: createMiraListeningAudio(), turns: createMiraVoiceTurns(), cadence: createMiraAcknowledgementCadence(), mode: 'listening', previousTranscript: '', pending: 0, generation: 0 }
    session.current = run
    const live = () => session.current === run && current.current.open
    const listening = () => live() && run.mode === 'listening' && !run.pending && !current.current.busy
    setError(''); setNotice(''); setState('loading')
    try {
      const [sdk, response] = await Promise.all([prewarmMiraAgentVoice(), fetch('/api/ai/mira-agent/session', {
        method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, signal: run.abort.signal,
      })])
      const config = await response.json()
      if (!response.ok || !config.success) throw new Error(config.message || 'Mira voice is unavailable')
      if (!live()) return
      setNotice(config.voiceNotice || '')
      const conversation = await sdk.Conversation.startSession({
        signedUrl: config.signedUrl, connectionType: 'websocket', useWakeLock: false,
        overrides: { tts: { voiceId: config.voiceId } },
        customLlmExtraBody: { mira_bridge_credential: config.bridgeCredential },
        clientTools: {
          ask_mira: params => {
            if (!live()) return JSON.stringify({ speech: '' })
            return run.turns.execute(params, async text => {
              if (!live()) return JSON.stringify({ speech: '' })
              const generation = run.generation
              run.pending++; run.ack.cancel(); setState('thinking')
              try {
                if (isMiraDismissal(text)) {
                  await current.current.sendMessage(text, { inputMode: 'voice' })
                  stop(); current.current.onDismiss?.()
                  return JSON.stringify({ speech: '' })
                }
                let finalSpeech = ''
                const reply = await current.current.sendMessage(text, { inputMode: 'voice', onSpeech: speech => { finalSpeech = speech } })
                return JSON.stringify({ speech: live() && generation === run.generation ? finalSpeech || miraSpeechSummary(reply || '') || 'Please check the reply in chat.' : '' })
              } finally { run.pending--; if (live()) setState(run.mode === 'speaking' ? 'speaking' : 'listening') }
            })
          },
        },
        onConnect: () => { if (live()) setState('listening') },
        onDisconnect: () => { if (live()) stop() },
        onError: () => { if (live()) { stop(); setError('Voice connection interrupted. Your conversation is still in chat; reconnect to continue.') } },
        onMessage: event => {
          if (!live() || event.source !== 'user') return
          if (!run.turns.transcript(event.message, event.event_id)) return
          run.generation++
          run.previousTranscript = event.message; run.cadence.newTurn(); run.ack.cancel(); setTranscript(event.message)
        },
        onModeChange: ({ mode }) => { run.mode = mode; if (mode === 'speaking') run.ack.cancel(); if (live()) setState(run.pending ? 'thinking' : mode) },
        onInterruption: () => {
          run.generation++
          run.ack.cancel()
          // Stop generation, never automatically retry an uncertain action.
          if (live()) current.current.interruptResponse?.()
        },
        onVadScore: ({ vadScore }) => {
          if (run.cadence.sample(vadScore, Date.now(), listening())) void run.ack.play(config.voiceId, run.previousTranscript, listening)
        },
      })
      if (!live()) { await conversation.endSession(); return }
      run.conversation = conversation
    } catch (err) {
      if (live()) { stop(); if (err.name !== 'AbortError') setError(err.message || 'Could not start Mira voice') }
    }
  }, [stop])
  return { state, stream: null, transcript, error, notice, start, stop, active: state !== 'idle' }
}
