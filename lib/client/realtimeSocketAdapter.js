'use client'

import Pusher from 'pusher-js'
import { io } from 'socket.io-client'
import {
  getBaseRealtimeChannels,
  roomToPusherChannel,
} from '@/lib/platform/realtimeChannels'

const CLIENT_EVENT_MAP = Object.freeze({
  'send-message': 'new-message',
  typing: 'user-typing',
  'stop-typing': 'user-stop-typing',
  'mark-read': 'message-read',
})

class PusherSocketAdapter {
  constructor({ token, userId, employeeId, tenantId }) {
    this.isManagedRealtime = true
    this.token = token
    this.userId = userId
    this.employeeId = employeeId
    this.tenantId = tenantId
    this.handlers = new Map()
    this.channels = new Map()
    this.activeRoom = null

    this.pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER,
      forceTLS: true,
      channelAuthorization: {
        endpoint: '/api/realtime/auth',
        transport: 'ajax',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    })

    this.pusher.connection.bind('connected', () => {
      for (const channel of getBaseRealtimeChannels({ userId, tenantId })) {
        this.subscribe(channel)
      }
      this.dispatch('connect')
    })
    this.pusher.connection.bind('disconnected', () => this.dispatch('disconnect'))
    this.pusher.connection.bind('error', (error) => this.dispatch('connect_error', error))
    this.pusher.connection.bind('unavailable', () => this.dispatch('reconnect_failed'))
  }

  get id() {
    return this.pusher.connection.socket_id || null
  }

  get connected() {
    return this.pusher.connection.state === 'connected'
  }

  bindHandler(channel, event, callback) {
    channel.bind(event, callback)
    channel.bind(`client-${event}`, callback)
  }

  unbindHandler(channel, event, callback) {
    channel.unbind(event, callback)
    channel.unbind(`client-${event}`, callback)
  }

  subscribe(channelName) {
    if (this.channels.has(channelName)) return this.channels.get(channelName)
    const channel = this.pusher.subscribe(channelName)
    this.channels.set(channelName, channel)

    for (const [event, callbacks] of this.handlers.entries()) {
      if (['connect', 'disconnect', 'connect_error', 'reconnect', 'reconnect_failed'].includes(event)) continue
      callbacks.forEach((callback) => this.bindHandler(channel, event, callback))
    }
    channel.bind('pusher:subscription_error', (error) => this.dispatch('connect_error', error))
    return channel
  }

  unsubscribe(channelName) {
    const channel = this.channels.get(channelName)
    if (!channel) return
    this.pusher.unsubscribe(channelName)
    this.channels.delete(channelName)
  }

  dispatch(event, ...args) {
    this.handlers.get(event)?.forEach((callback) => callback(...args))
  }

  on(event, callback) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event).add(callback)

    if (!['connect', 'disconnect', 'connect_error', 'reconnect', 'reconnect_failed'].includes(event)) {
      this.channels.forEach((channel) => this.bindHandler(channel, event, callback))
    } else if (event === 'connect' && this.connected) {
      queueMicrotask(() => callback())
    }
    return this
  }

  once(event, callback) {
    const wrapped = (...args) => {
      this.off(event, wrapped)
      callback(...args)
    }
    return this.on(event, wrapped)
  }

  off(event, callback) {
    if (!event) {
      this.handlers.clear()
      return this
    }

    const callbacks = this.handlers.get(event)
    if (!callbacks) return this
    const targets = callback ? [callback] : [...callbacks]
    targets.forEach((target) => {
      this.channels.forEach((channel) => this.unbindHandler(channel, event, target))
      callbacks.delete(target)
    })
    if (callbacks.size === 0) this.handlers.delete(event)
    return this
  }

  async emit(event, data = {}, acknowledge) {
    try {
      if (event === 'authenticate' || event === 'join-user-room') {
        acknowledge?.(null, { success: true })
        return this
      }

      if (event === 'join-chat' || event === 'join-project') {
        const scope = event === 'join-chat' ? 'chat' : 'project'
        this.activeRoom = roomToPusherChannel(`${scope}:${data}`)
        this.subscribe(this.activeRoom)
        acknowledge?.(null, { success: true })
        return this
      }

      if (event === 'leave-chat' || event === 'leave-project') {
        const scope = event === 'leave-chat' ? 'chat' : 'project'
        this.unsubscribe(roomToPusherChannel(`${scope}:${data}`))
        acknowledge?.(null, { success: true })
        return this
      }

      if (event === 'presence-request') {
        const response = await fetch('/api/presence/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          body: JSON.stringify({ employeeIds: data.employeeIds || [] }),
        })
        if (response.ok) this.dispatch('presence-status', await response.json())
        acknowledge?.(null, { success: response.ok })
        return this
      }

      const targetRoom = data?.chatId
        ? roomToPusherChannel(`chat:${data.chatId}`)
        : data?.projectId ? roomToPusherChannel(`project:${data.projectId}`) : this.activeRoom

      if (!targetRoom) {
        acknowledge?.(new Error('Join a realtime room before publishing'))
        return this
      }

      const channel = this.channels.get(targetRoom)
      if (!channel?.subscribed) throw new Error('Realtime room is not connected')
      const outgoingEvent = CLIENT_EVENT_MAP[event] || event
      channel.trigger(`client-${outgoingEvent}`, {
        ...data,
        senderSocketId: this.id,
      })
      acknowledge?.(null, { success: true })
    } catch (error) {
      acknowledge?.(error)
      if (!acknowledge) this.dispatch('connect_error', error)
    }
    return this
  }

  timeout() {
    return { emit: (event, data, callback) => this.emit(event, data, callback) }
  }

  connect() {
    this.pusher.connect()
    return this
  }

  disconnect() {
    this.pusher.disconnect()
    this.channels.clear()
    return this
  }
}

export function createRealtimeClient({ origin, token, userId, employeeId, tenantId, socketOptions }) {
  const usePusher = process.env.NEXT_PUBLIC_REALTIME_PROVIDER === 'pusher'
    || Boolean(process.env.NEXT_PUBLIC_PUSHER_KEY)

  if (usePusher) {
    return new PusherSocketAdapter({ token, userId, employeeId, tenantId })
  }

  return io(origin, socketOptions)
}
