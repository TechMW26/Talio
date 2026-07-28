import {
  optimizeMeetingPeerConnections,
  getMeetingVideoProfile,
  sampleMeetingConnectionQuality,
} from '@/lib/meetingMediaQuality'

function createStatsReport(stats) {
  return { forEach: callback => stats.forEach(callback) }
}

describe('meetingMediaQuality', () => {
  test('reduces mesh bitrate as participant count grows', () => {
    expect(getMeetingVideoProfile({ peerCount: 1 }).quality).toBe('good')
    expect(getMeetingVideoProfile({ peerCount: 3 }).quality).toBe('fair')
    expect(getMeetingVideoProfile({ peerCount: 6 }).quality).toBe('poor')
  })

  test('preserves screen detail while capping frame rate', () => {
    const profile = getMeetingVideoProfile({ isScreenSharing: true })

    expect(profile.maxFramerate).toBe(15)
    expect(profile.degradationPreference).toBe('maintain-resolution')
  })

  test('marks high RTT and constrained bandwidth as poor', async () => {
    const peerConnection = {
      connectionState: 'connected',
      getStats: jest.fn().mockResolvedValue(createStatsReport([
        {
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          currentRoundTripTime: 0.9,
          availableOutgoingBitrate: 200_000,
        },
      ])),
    }

    await expect(sampleMeetingConnectionQuality(peerConnection)).resolves.toMatchObject({
      quality: 'poor',
    })
  })

  test('holds a reduced profile while the connection is proving recovery', async () => {
    const setParameters = jest.fn().mockResolvedValue(undefined)
    const sender = {
      track: { kind: 'video' },
      getParameters: () => ({ encodings: [{}] }),
      setParameters,
    }
    const peerConnection = {
      connectionState: 'connected',
      getStats: jest.fn().mockResolvedValue(createStatsReport([])),
      getSenders: () => [sender],
    }

    await optimizeMeetingPeerConnections({
      peerConnections: { peer: peerConnection },
      previousSamples: new WeakMap(),
      qualityFloor: 'poor',
    })

    expect(setParameters.mock.calls[0][0].encodings[0].maxBitrate).toBe(180_000)
  })
})
