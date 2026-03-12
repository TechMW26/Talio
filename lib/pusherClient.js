import PusherJS from 'pusher-js'

const pusherClient = new PusherJS(process.env.NEXT_PUBLIC_PUSHER_KEY, {
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
    forceTLS: true,
})

export default pusherClient
