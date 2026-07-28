export const MEETING_CAMERA_CONSTRAINTS = {
  width: { ideal: 960, max: 1280 },
  height: { ideal: 540, max: 720 },
  frameRate: { ideal: 24, max: 24 },
  facingMode: 'user',
}

export const MEETING_AUDIO_CONSTRAINTS = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

export const MEETING_SCREEN_CONSTRAINTS = {
  width: { ideal: 1920, max: 1920 },
  height: { ideal: 1080, max: 1080 },
  frameRate: { ideal: 15, max: 15 },
}

const QUALITY_RANK = { good: 0, fair: 1, poor: 2 }

export function prepareMeetingMediaStream(stream, kind = 'camera') {
  if (!stream) return stream

  for (const track of stream.getVideoTracks()) {
    if ('contentHint' in track) {
      track.contentHint = kind === 'screen' ? 'detail' : 'motion'
    }
  }

  for (const track of stream.getAudioTracks()) {
    if ('contentHint' in track) {
      track.contentHint = 'speech'
    }
  }

  return stream
}

export function getMeetingVideoProfile({
  quality = 'good',
  isScreenSharing = false,
  peerCount = 1,
} = {}) {
  let effectiveQuality = quality
  if (peerCount >= 6) effectiveQuality = 'poor'
  else if (peerCount >= 3 && effectiveQuality === 'good') effectiveQuality = 'fair'

  const profiles = isScreenSharing
    ? {
        good: { maxBitrate: 1_200_000, maxFramerate: 15, scaleResolutionDownBy: 1 },
        fair: { maxBitrate: 650_000, maxFramerate: 10, scaleResolutionDownBy: 1.5 },
        poor: { maxBitrate: 320_000, maxFramerate: 5, scaleResolutionDownBy: 2 },
      }
    : {
        good: { maxBitrate: 700_000, maxFramerate: 24, scaleResolutionDownBy: 1 },
        fair: { maxBitrate: 380_000, maxFramerate: 15, scaleResolutionDownBy: 1.5 },
        poor: { maxBitrate: 180_000, maxFramerate: 8, scaleResolutionDownBy: 2 },
      }

  return {
    ...profiles[effectiveQuality],
    degradationPreference: isScreenSharing ? 'maintain-resolution' : 'maintain-framerate',
    quality: effectiveQuality,
  }
}

export async function applyMeetingSenderQuality(peerConnection, options = {}) {
  if (!peerConnection) return

  const profile = getMeetingVideoProfile(options)
  const updates = peerConnection.getSenders()
    .filter(sender => sender.track)
    .map(async sender => {
      const parameters = sender.getParameters()
      parameters.encodings ??= [{}]

      if (sender.track.kind === 'audio') {
        parameters.encodings[0].maxBitrate = 48_000
        parameters.encodings[0].priority = 'high'
      } else {
        parameters.encodings[0].maxBitrate = profile.maxBitrate
        parameters.encodings[0].maxFramerate = profile.maxFramerate
        parameters.encodings[0].scaleResolutionDownBy = profile.scaleResolutionDownBy
        parameters.encodings[0].priority = 'low'
        parameters.degradationPreference = profile.degradationPreference
      }

      try {
        await sender.setParameters(parameters)
      } catch (error) {
        // Safari and older WebViews implement only a subset of encoding controls.
        const fallback = sender.getParameters()
        fallback.encodings ??= [{}]
        fallback.encodings[0].maxBitrate = sender.track.kind === 'audio'
          ? 48_000
          : profile.maxBitrate
        try {
          await sender.setParameters(fallback)
        } catch {
          console.debug('[Meeting] Browser declined adaptive sender parameters', error?.name)
        }
      }
    })

  await Promise.all(updates)
}

export async function sampleMeetingConnectionQuality(peerConnection, previousSample = null) {
  if (!peerConnection || peerConnection.connectionState !== 'connected') {
    return { quality: 'good', sample: previousSample }
  }

  const report = await peerConnection.getStats()
  let availableOutgoingBitrate = null
  let roundTripTime = 0
  let qualityLimitedByBandwidth = false
  let packetsReceived = 0
  let packetsLost = 0

  report.forEach(stat => {
    if (
      stat.type === 'candidate-pair'
      && stat.state === 'succeeded'
      && (stat.nominated || stat.selected)
    ) {
      if (Number.isFinite(stat.availableOutgoingBitrate)) {
        availableOutgoingBitrate = stat.availableOutgoingBitrate
      }
      if (Number.isFinite(stat.currentRoundTripTime)) {
        roundTripTime = Math.max(roundTripTime, stat.currentRoundTripTime)
      }
    }

    if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
      qualityLimitedByBandwidth ||= stat.qualityLimitationReason === 'bandwidth'
    }

    if (stat.type === 'inbound-rtp') {
      packetsReceived += Number(stat.packetsReceived) || 0
      packetsLost += Math.max(0, Number(stat.packetsLost) || 0)
    }

    if (stat.type === 'remote-inbound-rtp' && Number.isFinite(stat.roundTripTime)) {
      roundTripTime = Math.max(roundTripTime, stat.roundTripTime)
    }
  })

  const sample = { packetsReceived, packetsLost }
  const receivedDelta = Math.max(0, packetsReceived - (previousSample?.packetsReceived || 0))
  const lostDelta = Math.max(0, packetsLost - (previousSample?.packetsLost || 0))
  const packetLoss = lostDelta / Math.max(1, receivedDelta + lostDelta)

  if (
    roundTripTime >= 0.8
    || packetLoss >= 0.12
    || (availableOutgoingBitrate !== null && availableOutgoingBitrate < 250_000)
  ) {
    return { quality: 'poor', sample }
  }

  if (
    qualityLimitedByBandwidth
    || roundTripTime >= 0.35
    || packetLoss >= 0.04
    || (availableOutgoingBitrate !== null && availableOutgoingBitrate < 700_000)
  ) {
    return { quality: 'fair', sample }
  }

  return { quality: 'good', sample }
}

export async function optimizeMeetingPeerConnections({
  peerConnections,
  previousSamples,
  isScreenSharing = false,
  qualityFloor = 'good',
}) {
  const connections = Object.values(peerConnections || {})
  let quality = 'good'

  await Promise.all(connections.map(async peerConnection => {
    try {
      const result = await sampleMeetingConnectionQuality(
        peerConnection,
        previousSamples?.get(peerConnection)
      )
      if (result.sample) previousSamples?.set(peerConnection, result.sample)
      if (QUALITY_RANK[result.quality] > QUALITY_RANK[quality]) quality = result.quality
    } catch {
      // A transient stats error must never disturb the call.
    }
  }))

  const appliedQuality = QUALITY_RANK[qualityFloor] > QUALITY_RANK[quality]
    ? qualityFloor
    : quality

  await Promise.all(connections.map(peerConnection => applyMeetingSenderQuality(peerConnection, {
    quality: appliedQuality,
    isScreenSharing,
    peerCount: connections.length,
  })))

  return quality
}
