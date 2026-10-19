'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'
import { prewarmMiraVoice } from '@/lib/miraVoiceReady'
import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'
import { createMiraStreamingSpeech } from '@/lib/miraStreamingSpeech'
import { createMiraVoiceEchoGuard } from '@/lib/miraVoiceEcho'
import { isMiraPlaybackEcho } from '@/lib/miraEchoGuard'
import { resolveMiraSpokenLanguage } from '@/lib/miraLanguage'
import { naturalMiraSpeech, miraSpeechSummary } from '@/lib/miraSpokenReply'
import { miraVoiceTranscript } from '@/lib/miraMessageDisplay'
import { compactMiraVoiceHistory, shortMiraVoiceReply } from '@/lib/miraDirectVoice'
import { generateMiraDirectVoice } from '@/lib/miraDirectVoiceClient'
import { miraOrbVoiceState, publishMiraOrbState } from '@/lib/miraOrbState'
import { publishMiraRobotFeedback } from '@/lib/miraRobotState'

export const speechText = naturalMiraSpeech
export { prewarmMiraVoice }
export default function useMiraVoice({ open, sendMessage, recordVoiceMessage, onDismiss, onTokens, interruptResponse, camera, history = [] }) {
  const [state, setState] = useState('idle'), [error, setError] = useState(''), [transcript, setTranscript] = useState(''), [captions, setCaptions] = useState([])
  const current = useRef({}), session = useRef(null)
  current.current = { open, sendMessage, recordVoiceMessage, onDismiss, onTokens, interruptResponse, camera, history }
  useEffect(() => { publishMiraOrbState('voice', miraOrbVoiceState(state)) }, [state])
  useEffect(() => { if (error) publishMiraRobotFeedback('error') }, [error])
  useEffect(() => () => publishMiraOrbState('voice', 'breathing'), [])
  const level = useCallback(() => Math.max(session.current?.engine?.getLevel?.() || 0, session.current?.playback?.getLevel?.() || 0), [])
  const stop = useCallback(() => {
    const run = session.current
    session.current = null
    clearTimeout(run?.startupTimer)
    run?.abort.abort(); run?.turnAbort?.abort(); run?.engine?.stop(); run?.playback?.close()
    if (run) current.current.camera?.stop()
    if (run) {
      current.current.interruptResponse?.()
      current.current.recordVoiceMessage?.({ source: 'complete', messages: run.captions, target: run.target })
    }
    setState('idle'); setTranscript('')
  }, [])
  useEffect(() => { if (!open) stop() }, [open, stop])
  useEffect(() => stop, [stop])
  const start = useCallback(async () => {
    if (session.current || !current.current.open) return
    const run = { abort: new AbortController(), generation: 0, turn: 0, captions: [], history: compactMiraVoiceHistory(current.current.history), echo: createMiraVoiceEchoGuard(), startedAt: Date.now(), target: current.current.recordVoiceMessage?.({ source: 'start' }) }
    session.current = run
    setState('loading'); setError(''); setCaptions([])
    const live = () => session.current === run && current.current.open
    const isEcho = text => run.echo.reject(text, Date.now()) || ((run.speaking || Date.now() < (run.echoUntil || 0)) && isMiraPlaybackEcho(text, run.reply || ''))
    const publish = () => { if (live()) setCaptions(run.captions.map((m, i) => ({ id: `voice-${i}`, role: m.source === 'user' ? 'user' : 'assistant', content: m.source === 'user' ? m.message : miraVoiceTranscript(m.message).replace(/\[[a-z]*$/i, ''), streaming: m.streaming, timestamp: m.timestamp }))) }
    const authorize = async () => {
      const r = await fetch('/api/ai/mira-voice/session', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, signal: AbortSignal.any([run.abort.signal, AbortSignal.timeout(10000)]) })
      const config = await r.json()
      if (!r.ok) { const failure = new Error(config.message || 'Voice unavailable.'); failure.status = r.status; throw failure }
      run.config = config; run.renewAt = Date.now() + Math.min(config.renewAfterMs || 540000, 540000)
      if (live()) current.current.onTokens?.({ tokensUsed: config.tokensUsed, tokenLimit: config.tokenLimit, tokensRemaining: config.tokensRemaining })
    }
    const interrupt = () => {
      if (run.pendingMessages) {
        run.history = compactMiraVoiceHistory([...run.pendingMessages, ...(run.pendingReply ? [{ role: 'assistant', content: run.pendingReply }] : [])])
        run.pendingMessages = null; run.pendingReply = ''
      }
      run.generation++; run.turnAbort?.abort(); run.playback?.cancel()
      current.current.interruptResponse?.()
      run.locked = false; run.speaking = false; run.echo.mode('listening', Date.now())
      if (live()) setState('listening')
    }
    try {
      run.playback = createMiraSpeechPlayback({ getPreferences: () => ({ voiceId: run.config?.voiceId, language: run.config?.language }) })
      const authorization = authorize()
      const engineReady = startMiraConversationRecognition({ signal: run.abort.signal,
        onError: err => { if (live()) { stop(); setError(err.message) } },
        onPartial: text => {
          if (!live() || !text?.trim() || isEcho(text)) return
          publishMiraRobotFeedback('awake')
          // Partial ASR can be our own speaker audio before echo matching has
          // enough words. Only a committed, echo-filtered utterance interrupts.
          setTranscript(text)
        },
        onResult: async result => {
          const text = result?.text?.trim()
          if (!live() || !text || !/[\p{L}\p{N}]/u.test(text) || text.length > 3000 || isEcho(text)) return
          if (run.locked && text === run.userText) return
          publishMiraRobotFeedback('awake')
          if (run.locked) interrupt()
          const generation = ++run.generation, turn = ++run.turn
          const valid = () => live() && generation === run.generation
          run.locked = true; run.userText = text
          run.reply = ''
          run.turnAbort = new AbortController()
          const signal = AbortSignal.any([run.abort.signal, run.turnAbort.signal])
          const user = { source: 'user', message: text, timestamp: new Date() }
          run.captions.push(user); publish(); setTranscript('')
          setState('thinking')
          const messages = [...compactMiraVoiceHistory(run.history), { role: 'user', content: text }]
          run.pendingMessages = messages; run.pendingReply = ''
          let assistant, reply = ''
          try {
            await authorization
            if (Date.now() >= run.renewAt) await authorize()
            signal.throwIfAborted()
            run.config.language = resolveMiraSpokenLanguage(text, run.config.language)
            const speech = createMiraStreamingSpeech({ live: valid, clean: naturalMiraSpeech,
              prepare: run.playback.prepare,
              speak: async (spoken, prepared) => {
                if (!valid()) return
                run.echo.remember(spoken)
                run.reply = `${run.reply} ${spoken}`.slice(-3000)
                return run.playback.speak(spoken, () => { if (valid()) { run.speaking = true; run.echo.mode('speaking', Date.now()); setState('speaking') } }, prepared)
              },
            })
            reply = await generateMiraDirectVoice({ config: run.config, messages, turn, signal,
              getCameraContext: () => current.current.camera?.getContext?.(),
              onClose: () => { if (valid()) { stop(); current.current.onDismiss?.() } },
              onTokens: balance => { if (valid()) current.current.onTokens?.(balance) },
              onLanguage: language => { run.config.language = language },
              onText: content => {
                if (!valid()) return
                run.pendingReply = content
                if (!assistant) { assistant = { source: 'ai', message: '', timestamp: new Date(), streaming: true }; run.captions.push(assistant) }
                assistant.message = content; publish(); speech.update(content)
              },
              execute: async name => {
                if (!valid()) throw new DOMException('Cancelled', 'AbortError')
                if (name === 'view_camera') { return current.current.camera?.inspect({ signal, question: text }) || { unavailable: 'Camera preview is unavailable.' } }
                if (name === 'close_camera') { current.current.camera?.stop(); return { success: true, message: 'Camera stopped.' } }
                setState(name === 'search_internet' ? 'searching' : 'working')
                if (name === 'search_internet') {
                  const response = await fetch('/api/ai/mira-agent/search', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ bridgeCredential: run.config.bridgeCredential, turn, message: text }), signal })
                  const result = await response.json()
                  return response.ok ? result : { unavailable: result.message || 'Lookup failed; do not claim verification.' }
                }
                user.persisted = true
                let outcome, finalSpeech
                const result = await current.current.sendMessage(text, { inputMode: 'voice', voiceTool: true,
                  voiceHistory: run.history, onSpeech: value => { finalSpeech = value }, onActionResult: value => { outcome = value && { success: value.success, uncertain: value.uncertain, message: value.message } } })
                return { speech: finalSpeech || miraSpeechSummary(result || 'The action did not return a confirmed result.'), actionOutcome: outcome }
              },
            })
            if (!valid()) return
            reply = shortMiraVoiceReply(reply)
            if (assistant) { assistant.message = reply; assistant.streaming = false; publish() }
            run.history = compactMiraVoiceHistory([...messages, ...(reply ? [{ role: 'assistant', content: reply }] : [])])
            run.pendingMessages = null; run.pendingReply = ''
            await speech.finish(reply)
          } catch (err) {
            if (valid() && err.name !== 'AbortError') {
              run.playback.cancel()
              setError(err.message || 'Voice interrupted. The transcript is still available.')
              if ([401, 403, 429].includes(err.status)) { stop(); return }
            }
          } finally {
            if (assistant) assistant.streaming = false
            if (valid()) { run.locked = false; if (run.speaking) run.echoUntil = Date.now() + 1800; run.speaking = false; run.echo.mode('listening', Date.now()); setState('listening'); publish() }
          }
        },
      }).then(engine => { if (!live()) { engine.stop(); return null } run.engine = engine; return engine })
      await Promise.race([Promise.all([engineReady, authorization]), new Promise((_, reject) => {
        run.startupTimer = setTimeout(() => reject(new Error('Voice is taking too long. You can type now or retry the microphone.')), 10000)
      })])
      clearTimeout(run.startupTimer)
      if (!live()) return
      if (!run.locked) setState('listening')
    } catch (err) { if (live()) { stop(); if (err.name !== 'AbortError') setError(err.message || 'Could not start voice.') } }
  }, [stop])
  return { state, stream: null, level, transcript, captions, error, start, stop, startedAt: session.current?.startedAt, active: state !== 'idle' }
}
