const DEFAULT_STUN_URLS = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
]

function parseIceServerUrlList(rawValue) {
    return String(rawValue || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
}

export function buildMeetingIceServers(env = process.env) {
    const stunUrls = parseIceServerUrlList(env.NEXT_PUBLIC_MEETING_STUN_URLS)
    const turnUrls = parseIceServerUrlList(env.NEXT_PUBLIC_MEETING_TURN_URLS)
    const turnUsername = String(env.NEXT_PUBLIC_MEETING_TURN_USERNAME || '').trim()
    const turnCredential = String(env.NEXT_PUBLIC_MEETING_TURN_CREDENTIAL || '').trim()

    const iceServers = [
        {
            urls: stunUrls.length > 0 ? stunUrls : DEFAULT_STUN_URLS,
        },
    ]

    if (turnUrls.length > 0 && turnUsername && turnCredential) {
        iceServers.push({
            urls: turnUrls,
            username: turnUsername,
            credential: turnCredential,
        })
    }

    return iceServers
}

export function createMeetingRtcConfiguration(env = process.env) {
    return {
        iceServers: buildMeetingIceServers(env),
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 4,
    }
}

export function queueIceCandidate(pendingIceCandidatesRef, peerId, candidate) {
    if (!pendingIceCandidatesRef?.current || !peerId || !candidate) {
        return 0
    }

    const queuedCandidates = pendingIceCandidatesRef.current[peerId] || []
    queuedCandidates.push(candidate)
    pendingIceCandidatesRef.current[peerId] = queuedCandidates
    return queuedCandidates.length
}

export function clearQueuedIceCandidates(pendingIceCandidatesRef, peerId) {
    if (!pendingIceCandidatesRef?.current || !peerId) {
        return
    }

    delete pendingIceCandidatesRef.current[peerId]
}

export async function addIceCandidateOrQueue(peerConnectionsRef, pendingIceCandidatesRef, peerId, candidate) {
    const peerConnection = peerConnectionsRef?.current?.[peerId]

    if (!peerConnection || !candidate) {
        return 'skipped'
    }

    if (!peerConnection.remoteDescription) {
        queueIceCandidate(pendingIceCandidatesRef, peerId, candidate)
        return 'queued'
    }

    await peerConnection.addIceCandidate(candidate)
    return 'added'
}

export async function flushQueuedIceCandidates(peerConnectionsRef, pendingIceCandidatesRef, peerId) {
    const peerConnection = peerConnectionsRef?.current?.[peerId]
    const queuedCandidates = pendingIceCandidatesRef?.current?.[peerId] || []

    if (!peerConnection || !peerConnection.remoteDescription || queuedCandidates.length === 0) {
        return 0
    }

    clearQueuedIceCandidates(pendingIceCandidatesRef, peerId)

    let addedCount = 0
    for (const candidate of queuedCandidates) {
        await peerConnection.addIceCandidate(candidate)
        addedCount += 1
    }

    return addedCount
}
