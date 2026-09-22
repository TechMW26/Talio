import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TextEncoder, TextDecoder } from 'util'

Object.assign(global, { TextEncoder, TextDecoder })

const mockRooms = []
const mockConnect = jest.fn()
const mockPublish = jest.fn()
const mockPublications = () => new Map()
const mockParticipant = (identity) => {
  const publications = mockPublications()
  return {
    identity, name: identity, publications, isMicrophoneEnabled: false, isCameraEnabled: false,
    getTrackPublication: (source) => publications.get(source),
    setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
    setCameraEnabled: jest.fn().mockResolvedValue(undefined),
    publishTrack: mockPublish,
  }
}

jest.mock('livekit-client', () => {
  const events = ['ParticipantConnected', 'ParticipantDisconnected', 'TrackSubscribed', 'TrackUnsubscribed',
    'TrackPublished', 'TrackUnpublished', 'TrackSubscriptionFailed', 'TrackMuted', 'TrackUnmuted',
    'LocalTrackPublished', 'LocalTrackUnpublished', 'DataReceived', 'Reconnecting', 'Reconnected',
    'AudioPlaybackStatusChanged', 'VideoPlaybackStatusChanged', 'Disconnected']
  return {
    RoomEvent: Object.fromEntries(events.map((event) => [event, event])),
    Track: { Source: { Microphone: 'microphone', Camera: 'camera', ScreenShare: 'screen', ScreenShareAudio: 'screen-audio' }, Kind: { Audio: 'audio', Video: 'video' } },
    VideoPresets: { h720: { resolution: {} }, h180: {}, h360: {} },
    createLocalTracks: jest.fn(), createLocalAudioTrack: jest.fn(), createLocalVideoTrack: jest.fn(),
    Room: class {
      constructor() {
        this.listeners = new Map()
        this.localParticipant = mockParticipant('local')
        this.remoteParticipants = new Map()
        this.canPlaybackAudio = true
        this.canPlaybackVideo = true
        this.connect = mockConnect
        this.disconnect = jest.fn()
        this.startAudio = jest.fn().mockResolvedValue(undefined)
        this.startVideo = jest.fn().mockResolvedValue(undefined)
        mockRooms.push(this)
      }
      on(event, callback) { this.listeners.set(event, callback); return this }
      emit(event, ...args) { this.listeners.get(event)?.(...args) }
    },
  }
})
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/hooks/useAuthedSWR', () => ({ __esModule: true, default: () => ({}) }))
jest.mock('@/components/meetings/MeetingReactionPicker', () => ({ __esModule: true, default: () => null }))
jest.mock('@/app/dashboard/meetings/components/AddMeetingParticipantsModal', () => ({ __esModule: true, default: () => null }))
jest.mock('@/app/dashboard/meetings/components/MeetingNotetakerPanel', () => ({ __esModule: true, default: () => null }))
jest.mock('@/utils/toast', () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn(), success: jest.fn() } }))
jest.mock('@/lib/meetingTranscriber', () => ({ isMeetingAudioUploadSupported: () => false, getSupportedAudioMimeType: () => '' }))
jest.mock('@/lib/notificationSounds', () => ({
  playNotificationSound: jest.fn(),
  getNotificationSounds: () => ({ init: jest.fn(), resume: jest.fn() }),
}))

const ManagedMeetingRoomSession = require('@/components/meetings/ManagedMeetingRoomSession').default
const { createLocalTracks } = require('livekit-client')
const { playNotificationSound } = require('@/lib/notificationSounds')

test('remote hand raises chime and reactions render PNGs without enabling devices', async () => {
  const { room } = await join()
  const remote = mockParticipant('Colleague')
  act(() => {
    room.remoteParticipants.set(remote.identity, remote)
    room.emit('ParticipantConnected', remote)
    room.emit('DataReceived', new TextEncoder().encode(JSON.stringify({ id: 'hand-1', raised: true })), remote, null, 'talio-hand')
  })
  expect(playNotificationSound).toHaveBeenCalledWith('chime')
  expect(screen.getByLabelText('Colleague raised their hand')).toBeInTheDocument()
  act(() => {
    room.emit('DataReceived', new TextEncoder().encode(JSON.stringify({ id: 'reaction-1', reaction: '👍' })), remote, null, 'talio-reaction')
  })
  expect(screen.getByRole('img', { name: 'Thumbs up' })).toHaveAttribute('src', '/emojis/twemoji/1f44d.png')
  expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled()
  expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
})

beforeEach(() => {
  mockRooms.length = 0
  jest.clearAllMocks()
  mockConnect.mockReset().mockResolvedValue(undefined)
  mockPublish.mockReset().mockResolvedValue(undefined)
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { serverUrl: 'wss://meeting.test', token: 'synthetic' } }) })
})

async function join(props = {}) {
  const view = render(<ManagedMeetingRoomSession roomId="test-room" meetingData={{ title: 'Test meeting' }} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Join with camera & mic off' }))
  await screen.findByRole('button', { name: 'Turn camera on' })
  return { view, room: mockRooms[0] }
}

test('joining and reconnecting never acquires devices and refreshes remote membership', async () => {
  const { room } = await join()
  expect(createLocalTracks).not.toHaveBeenCalled()
  const remote = mockParticipant('Remote colleague')
  act(() => {
    room.remoteParticipants.set(remote.identity, remote)
    room.emit('ParticipantConnected', remote)
  })
  expect(screen.getByLabelText('Remote colleague camera')).toBeInTheDocument()
  const track = { attach: jest.fn(), detach: jest.fn() }
  act(() => {
    remote.publications.set('camera', { track, isMuted: false })
    room.emit('TrackSubscribed')
  })
  expect(track.attach).toHaveBeenCalledWith(screen.getByLabelText('Remote colleague camera'))
  act(() => {
    room.remoteParticipants.clear()
    room.emit('Reconnecting')
    room.emit('Reconnected')
  })
  expect(screen.queryByLabelText('Remote colleague camera')).not.toBeInTheDocument()
  expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled()
  expect(room.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
})

test('blocked playback is recoverable without requesting camera or microphone', async () => {
  const { room } = await join()
  act(() => { room.canPlaybackAudio = false; room.emit('AudioPlaybackStatusChanged') })
  fireEvent.click(screen.getByRole('button', { name: 'Enable meeting audio & video' }))
  expect(room.startVideo).toHaveBeenCalledTimes(1)
  expect(room.startAudio).toHaveBeenCalledTimes(2)
  act(() => { room.canPlaybackAudio = true; room.emit('AudioPlaybackStatusChanged') })
  await waitFor(() => expect(screen.queryByText('Your browser paused meeting playback.')).not.toBeInTheDocument())
  expect(createLocalTracks).not.toHaveBeenCalled()
  expect(room.localParticipant.setCameraEnabled).not.toHaveBeenCalled()
})

test('denied camera access displays an error and keeps the camera off', async () => {
  const { room } = await join()
  room.localParticipant.setCameraEnabled.mockRejectedValue(Object.assign(new Error('Denied'), { name: 'NotAllowedError' }))
  fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }))
  await screen.findByText(/Camera and microphone access is blocked/)
  expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeInTheDocument()
})

test('concurrent camera clicks are serialized', async () => {
  const { room } = await join()
  let finish
  room.localParticipant.setCameraEnabled.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }))
  fireEvent.click(screen.getByRole('button', { name: 'Turn camera on' }))
  expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1)
  await act(async () => finish())
})

test('terminal disconnect returns to a recoverable media-off join screen', async () => {
  const onJoinedChange = jest.fn()
  const { room } = await join({ onJoinedChange })
  act(() => room.emit('Disconnected'))
  expect(screen.getByRole('alert')).toHaveTextContent('You were disconnected')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  expect(onJoinedChange).toHaveBeenLastCalledWith(false)
  expect(createLocalTracks).not.toHaveBeenCalled()
})

test('a token response arriving after unmount cannot connect or capture media', async () => {
  let finish
  global.fetch.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const onJoinedChange = jest.fn()
  const view = render(<ManagedMeetingRoomSession roomId="test-room" meetingData={{ title: 'Test' }} onJoinedChange={onJoinedChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Join with camera & mic off' }))
  view.unmount()
  await act(async () => finish({ ok: true, json: async () => ({ data: { serverUrl: 'wss://test', token: 'test' } }) }))
  expect(mockRooms).toHaveLength(0)
  expect(onJoinedChange).not.toHaveBeenCalled()
  expect(createLocalTracks).not.toHaveBeenCalled()
})

test('an in-flight connection is cancelled when the meeting unmounts', async () => {
  let finish
  mockConnect.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const onJoinedChange = jest.fn()
  const view = render(<ManagedMeetingRoomSession roomId="test-room" meetingData={{ title: 'Test' }} onJoinedChange={onJoinedChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Join with camera & mic off' }))
  await waitFor(() => expect(mockConnect).toHaveBeenCalled())
  view.unmount()
  await act(async () => finish())
  expect(mockRooms[0].disconnect).toHaveBeenCalled()
  expect(mockPublish).not.toHaveBeenCalled()
  expect(onJoinedChange).not.toHaveBeenCalled()
})

test('failed publication stops the preview device and does not pretend the camera is on', async () => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: jest.fn() } })
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  const video = { kind: 'video', mediaStreamTrack: { readyState: 'live' }, attach: jest.fn(), detach: jest.fn(), stop: jest.fn() }
  createLocalTracks.mockResolvedValue([video])
  mockPublish.mockRejectedValue(new Error('Publication failed'))
  render(<ManagedMeetingRoomSession roomId="test-room" meetingData={{ title: 'Test' }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Preview camera & microphone' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Join meeting' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Join meeting' }))
  await screen.findByText(/Your camera or microphone could not be shared/)
  expect(video.stop).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Turn camera on' })).toBeInTheDocument()
  jest.restoreAllMocks()
})
