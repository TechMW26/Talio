// Prefer off-thread capture; older/restricted desktop runtimes may omit AudioWorklet.
export async function prepareMiraAudioCapture(context) {
  if (context.audioWorklet?.addModule && typeof AudioWorkletNode !== 'undefined') {
    try {
      await context.audioWorklet.addModule('/audio/mira-capture-worklet.js')
      return true
    } catch (error) {
      if (typeof context.createScriptProcessor !== 'function') throw error
    }
  }
  if (typeof context.createScriptProcessor !== 'function') {
    throw new Error('Audio capture is unavailable. Please update Talio or use a supported browser over HTTPS.')
  }
  return false
}

export function createMiraAudioCapture(context, useWorklet, onSamples) {
  const node = useWorklet ? new AudioWorkletNode(context, 'mira-capture') : context.createScriptProcessor(2048, 1, 1)
  if (useWorklet) node.port.onmessage = event => onSamples(event.data)
  else node.onaudioprocess = event => {
    // Never route microphone audio to the speakers.
    event.outputBuffer.getChannelData(0).fill(0)
    onSamples(new Float32Array(event.inputBuffer.getChannelData(0)))
  }
  return {
    node,
    close() {
      if (useWorklet) { node.port.onmessage = null; node.port.close() }
      else node.onaudioprocess = null
      node.disconnect()
    },
  }
}
