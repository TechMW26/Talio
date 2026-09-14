import { render, screen } from '@testing-library/react'
import { ParticipantTile, RemoteAudio } from '@/components/meetings/MeetingMedia'

jest.mock('livekit-client', () => ({ Track: { Source: {
  Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen', ScreenShareAudio: 'screen-audio',
} } }))

const makeTrack = () => ({ attach: jest.fn(), detach: jest.fn(), stop: jest.fn() })
const makeItem = (publications) => ({
  name: 'Remote Person', identity: 'remote', isMuted: false, isScreenSharing: false,
  participant: { getTrackPublication: (source) => publications[source] },
})

test.each([false, true])('keeps the attached video mounted across mute/unmute (initial muted=%s)', (initialMuted) => {
  const track = makeTrack()
  const publications = { camera: { track, isMuted: initialMuted } }
  const item = makeItem(publications)
  const view = render(<ParticipantTile item={item} />)
  const video = screen.getByLabelText('Remote Person camera')
  expect(track.attach).toHaveBeenCalledWith(video)
  expect(video.muted).toBe(true)
  publications.camera.isMuted = true
  view.rerender(<ParticipantTile item={{ ...item, isVideoOff: true }} />)
  expect(screen.getByLabelText('Remote Person camera')).toBe(video)
  expect(video).toHaveClass('invisible')
  publications.camera.isMuted = false
  view.rerender(<ParticipantTile item={{ ...item, isVideoOff: false }} />)
  expect(screen.getByLabelText('Remote Person camera')).toBe(video)
  expect(video).not.toHaveClass('invisible')
  expect(track.attach).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(track.detach).toHaveBeenCalledWith(video)
  expect(track.stop).not.toHaveBeenCalled()
})

test('attaches late subscriptions and replaces tracks after reconnect', () => {
  const publications = {}
  const item = makeItem(publications)
  const view = render(<ParticipantTile item={item} />)
  const video = screen.getByLabelText('Remote Person camera')
  const first = makeTrack()
  const replacement = makeTrack()
  publications.camera = { track: first, isMuted: false }
  view.rerender(<ParticipantTile item={{ ...item }} />)
  expect(first.attach).toHaveBeenCalledWith(video)
  publications.camera.track = replacement
  view.rerender(<ParticipantTile item={{ ...item }} />)
  expect(first.detach).toHaveBeenCalledWith(video)
  expect(replacement.attach).toHaveBeenCalledWith(video)
})

test('switches between camera and uncropped screen share on the same element', () => {
  const camera = makeTrack()
  const screenTrack = makeTrack()
  const publications = { camera: { track: camera }, screen: { track: screenTrack } }
  const item = makeItem(publications)
  const view = render(<ParticipantTile item={{ ...item, isScreenSharing: true }} local featured />)
  const video = screen.getByLabelText('Remote Person screen share')
  expect(video).toHaveClass('object-contain')
  expect(video).not.toHaveClass('-scale-x-100')
  expect(screenTrack.attach).toHaveBeenCalledWith(video)
  delete publications.screen
  view.rerender(<ParticipantTile item={item} local />)
  expect(camera.attach).toHaveBeenCalledWith(video)
  expect(screenTrack.detach).toHaveBeenCalledWith(video)
  expect(video).toHaveClass('object-cover', '-scale-x-100')
})

test('attaches microphone and presentation audio separately and detaches without stopping remote tracks', () => {
  const microphone = makeTrack()
  const presentation = makeTrack()
  const publications = { microphone: { track: microphone }, 'screen-audio': { track: presentation } }
  const { participant } = makeItem(publications)
  const view = render(<><RemoteAudio participant={participant} /><RemoteAudio participant={participant} source="screen-audio" /></>)
  const audios = view.container.querySelectorAll('audio')
  expect(microphone.attach).toHaveBeenCalledWith(audios[0])
  expect(presentation.attach).toHaveBeenCalledWith(audios[1])
  expect(audios[0].muted).toBe(false)
  view.unmount()
  expect(microphone.detach).toHaveBeenCalledWith(audios[0])
  expect(presentation.detach).toHaveBeenCalledWith(audios[1])
  expect(microphone.stop).not.toHaveBeenCalled()
})
