'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { startMiraConversationRecognition } from '@/lib/miraConversationRecognition'
import { createMiraSpeechPlayback } from '@/lib/miraSpeechPlayback'
import { isMiraPlaybackEcho } from '@/lib/miraEchoGuard'
import { isMiraDismissal } from '@/lib/miraDismissal'
import { createMiraStreamingSpeech } from '@/lib/miraStreamingSpeech'
import { naturalMiraSpeech, miraSpeechSummary } from '@/lib/miraSpokenReply'

export function speechText(text) {
  return naturalMiraSpeech(text)
}

export default function useMiraVoice({ open, busy, sendMessage, onDismiss }) {
  const [state, setState] = useState('idle')
  const [stream, setStream] = useState(null)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 5000)
    return () => clearTimeout(timer)
  }, [error])
  const current = useRef({ open, busy, sendMessage, onDismiss })
  current.current = { open, busy, sendMessage, onDismiss }
  const session = useRef(null)
  const stop = useCallback(() => {
    const run = session.current
    session.current = null
    clearTimeout(run?.startupTimer)
    run?.rejectStartup?.(new DOMException('Voice cancelled', 'AbortError'))
    run?.abort.abort()
    run?.engine?.stop()
    run?.playback?.close()
    setStream(null); setState('idle'); setTranscript('')
  }, [])
  useEffect(() => { if (!open) stop() }, [open, stop])
  useEffect(() => stop, [stop])
  const start = useCallback(async () => {
    if (session.current || !current.current.open) return
    setError(''); setState('loading')
    const run = { abort: new AbortController(), locked: false, turn: 0, speaking: false, reply: '', echoUntil: 0 }
    session.current = run
    const live = () => session.current === run && current.current.open
    const listen = () => { if (live()) {
      // Keep the post-playback guard short enough for a natural follow-up while
      // still covering audio-buffer tail/OS speaker latency.
      if (run.speaking) run.echoUntil = Date.now() + 1800
      run.locked = false; run.speaking = false; setState('listening')
    } }
    const isEcho = text => (run.speaking || Date.now() < run.echoUntil) && isMiraPlaybackEcho(text, run.reply.slice(-1800))
    const interrupt = text => {
      if (!run.speaking) return
      const normalized = text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, '').trim()
      if (!normalized || isEcho(text)) return
      if (normalized.split(/\s+/).length < 2 && !/^(stop|wait|pause|mira|रुको|रुकिए|बस|बंद|停|停止|待って|para|arrête)$/u.test(normalized)) return
      run.turn++
      run.playback.cancel()
      listen()
    }
    try {
      // Resume Web Audio in the same user gesture as microphone activation.
      run.playback = createMiraSpeechPlayback()
      const engineReady = startMiraConversationRecognition({
        signal: run.abort.signal,
        onError: err => { if (live()) { stop(); setError(err.message) } },
        onPartial: text => { if (live() && !isEcho(text)) { interrupt(text); if (!run.locked) setTranscript(text) } },
        onResult: async result => {
          const text = result?.text?.trim()
          if (!live() || !text || isEcho(text)) return
          // Final utterances only: a partial "bye" may become "bye is Spanish...".
          // Handle before busy/locked so dismissal works during thinking and playback.
          if (isMiraDismissal(text)) {
            stop()
            // The shared chat path records an explicit dismiss response, even
            // while another answer is in flight. Never speak after closing.
            try { await current.current.sendMessage(text) }
            finally { current.current.onDismiss?.() }
            return
          }
          interrupt(text)
          if (run.locked || current.current.busy) return
          const turn = ++run.turn
          run.locked = true
          setError('')
          setTranscript(text); setState('thinking')
          try {
            const speech = createMiraStreamingSpeech({
              live: () => live() && turn === run.turn,
              clean: speechText,
              prepare: run.playback.prepare,
              speak: (spoken, prepared) => {
                run.reply = `${run.reply} ${spoken}`.slice(-5000)
                run.speaking = true
                return run.playback.speak(spoken, () => { if (live() && turn === run.turn) setState('speaking') }, prepared)
              },
            })
            run.reply = ''
            let spokenReply
            const response = await current.current.sendMessage(text, {
              inputMode: 'voice',
              onPartialSpeech: content => speech.update(miraSpeechSummary(content)),
              onSpeech: content => { spokenReply = content; speech.update(content, true) },
            })
            if (!live() || turn !== run.turn) return
            // Actions may deliver their outcome through callbacks without returning
            // text. Never replay the task just because its voice reply is missing.
            await speech.finish(spokenReply || miraSpeechSummary(response || ''))
            if (live() && turn === run.turn) { setTranscript(''); listen() }
          } catch (err) { if (live() && turn === run.turn) { run.turn++; run.playback.cancel(); setTranscript(''); if (err.name !== 'AbortError') setError('Audio is unavailable. You can continue; the reply is in chat.'); listen() } }
        },
      }).then(engine => { if (!live()) engine.stop(); return engine })
      run.engine = await Promise.race([
        engineReady,
        new Promise((_, reject) => {
          run.rejectStartup = reject
          run.startupTimer = setTimeout(() => reject(new Error('Voice is taking too long to connect. You can type now or retry the microphone.')), 10000)
        }),
      ])
      clearTimeout(run.startupTimer)
      run.rejectStartup = null
      if (!live()) return
      setStream(run.engine.stream); setState('listening')
    } catch (err) { if (session.current === run) { stop(); if (err.name !== 'AbortError') setError(err.message) } }
  }, [stop])
  return { state, stream, transcript, error, start, stop, active: state !== 'idle' }
}
