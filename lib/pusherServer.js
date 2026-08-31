import Pusher from 'pusher'
import { isPusherRealtimeConfigured } from '@/lib/platform/realtimeChannels'

let pusherServer = null

export function getPusherServer() {
    if (!isPusherRealtimeConfigured()) {
        const error = new Error('Pusher realtime is not configured')
        error.code = 'PUSHER_NOT_CONFIGURED'
        throw error
    }

    if (!pusherServer) {
        pusherServer = new Pusher({
            appId: process.env.PUSHER_APP_ID,
            key: process.env.PUSHER_KEY,
            secret: process.env.PUSHER_SECRET,
            cluster: process.env.PUSHER_CLUSTER,
            useTLS: true,
        })
    }

    return pusherServer
}

export default getPusherServer
