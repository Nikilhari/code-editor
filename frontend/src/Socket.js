import { io } from 'socket.io-client';

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempts: 'Infinity',
        timeout: 10000,
        transports: ['websocket'],
    };
    return io("https://code-editor-fe83.onrender.com", options);
    // return io("http://localhost:5000", options);
}