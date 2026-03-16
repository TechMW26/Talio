const { createServer } = require('http');
const { Server } = require('socket.io');
const { io: ClientIO } = require('socket.io-client');

/**
 * Creates an in-process Socket.IO server on a random port.
 * Sets global.io so the emitToUser helper inside the API route can find it.
 */
async function createTestSocketServer() {
    const httpServer = createServer();
    const io = new Server(httpServer, {
        cors: { origin: '*' },
        // Match production config
        path: '/api/socketio',
    });

    io.on('connection', (socket) => {
        // Mirror the production server.js `authenticate` flow:
        // clients emit 'join' (or 'authenticate') with { userId }
        socket.on('join', ({ userId }) => {
            socket.join(`user:${userId}`);
        });
    });

    return new Promise((resolve) => {
        httpServer.listen(0, () => {
            const port = httpServer.address().port;
            global.io = io; // expose for emitToUser()
            resolve({ io, httpServer, port });
        });
    });
}

/**
 * Creates a Socket.IO client that connects and joins a user room.
 * Returns a promise that resolves once the client has connected and joined.
 */
function createTestClient(port, userId) {
    return new Promise((resolve, reject) => {
        const client = ClientIO(`http://localhost:${port}`, {
            path: '/api/socketio',
            transports: ['websocket'],
            forceNew: true,
        });

        const timeout = setTimeout(() => {
            client.disconnect();
            reject(new Error(`Client for user ${userId} failed to connect within 5s`));
        }, 5000);

        client.on('connect', () => {
            clearTimeout(timeout);
            client.emit('join', { userId });
            // Give the server a tick to process the join before resolving
            setTimeout(() => resolve(client), 50);
        });

        client.on('connect_error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

module.exports = { createTestSocketServer, createTestClient };
