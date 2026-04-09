import {
    addIceCandidateOrQueue,
    buildMeetingIceServers,
    clearQueuedIceCandidates,
    flushQueuedIceCandidates,
} from '@/lib/meetingRtc'

describe('meetingRtc', () => {
    test('buildMeetingIceServers returns default STUN servers when no env is provided', () => {
        const iceServers = buildMeetingIceServers({})

        expect(iceServers).toEqual([
            {
                urls: [
                    'stun:stun.l.google.com:19302',
                    'stun:stun1.l.google.com:19302',
                    'stun:stun2.l.google.com:19302',
                    'stun:stun3.l.google.com:19302',
                ],
            },
        ])
    })

    test('buildMeetingIceServers appends TURN relay config when credentials are present', () => {
        const iceServers = buildMeetingIceServers({
            NEXT_PUBLIC_MEETING_STUN_URLS: 'stun:custom-one.example.com,stun:custom-two.example.com',
            NEXT_PUBLIC_MEETING_TURN_URLS: 'turn:relay.example.com:3478?transport=udp,turn:relay.example.com:3478?transport=tcp',
            NEXT_PUBLIC_MEETING_TURN_USERNAME: 'talio',
            NEXT_PUBLIC_MEETING_TURN_CREDENTIAL: 'secret',
        })

        expect(iceServers).toEqual([
            {
                urls: ['stun:custom-one.example.com', 'stun:custom-two.example.com'],
            },
            {
                urls: [
                    'turn:relay.example.com:3478?transport=udp',
                    'turn:relay.example.com:3478?transport=tcp',
                ],
                username: 'talio',
                credential: 'secret',
            },
        ])
    })

    test('addIceCandidateOrQueue queues candidates until remote description exists', async () => {
        const peerConnectionsRef = {
            current: {
                peerA: {
                    remoteDescription: null,
                    addIceCandidate: jest.fn(),
                },
            },
        }
        const pendingIceCandidatesRef = { current: {} }
        const candidate = { candidate: 'candidate:1 1 udp 1 127.0.0.1 10000 typ host' }

        const result = await addIceCandidateOrQueue(peerConnectionsRef, pendingIceCandidatesRef, 'peerA', candidate)

        expect(result).toBe('queued')
        expect(peerConnectionsRef.current.peerA.addIceCandidate).not.toHaveBeenCalled()
        expect(pendingIceCandidatesRef.current.peerA).toEqual([candidate])
    })

    test('flushQueuedIceCandidates drains queued candidates after remote description is set', async () => {
        const addIceCandidate = jest.fn().mockResolvedValue(undefined)
        const peerConnectionsRef = {
            current: {
                peerA: {
                    remoteDescription: { type: 'answer' },
                    addIceCandidate,
                },
            },
        }
        const candidate = { candidate: 'candidate:1 1 udp 1 127.0.0.1 10000 typ host' }
        const pendingIceCandidatesRef = {
            current: {
                peerA: [candidate],
            },
        }

        const flushedCount = await flushQueuedIceCandidates(peerConnectionsRef, pendingIceCandidatesRef, 'peerA')

        expect(flushedCount).toBe(1)
        expect(addIceCandidate).toHaveBeenCalledWith(candidate)
        expect(pendingIceCandidatesRef.current.peerA).toBeUndefined()
    })

    test('clearQueuedIceCandidates removes queued state for a peer', () => {
        const pendingIceCandidatesRef = {
            current: {
                peerA: [{ candidate: 'candidate:1' }],
            },
        }

        clearQueuedIceCandidates(pendingIceCandidatesRef, 'peerA')

        expect(pendingIceCandidatesRef.current.peerA).toBeUndefined()
    })
})