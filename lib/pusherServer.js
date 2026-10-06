import Pusher from 'pusher'
import { isPusherRealtimeConfigured } from '@/lib/platform/realtimeChannels'

let pusherServer = null

export function getPusherServer() {
    if (process.env.TALIO_LOCAL_ACCEPTANCE === '1') {
        const error = new Error('External realtime delivery is disabled during local migration acceptance')
        error.code = 'LOCAL_ACCEPTANCE_DELIVERY_DISABLED'
        throw error
    }
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
            timeout: 3000,
        })
    }

    return pusherServer
}

export default getPusherServer
