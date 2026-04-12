const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'minha-chave-secreta-123'; // Chave padrão caso não configurada
const logger = P({ level: 'info' });

app.use(express.json());

// Middleware de autenticação
const authMiddleware = (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.key;
    if (key && key === API_KEY) {
        return next();
    }
    return res.status(401).json({ error: 'Não autorizado. Chave de API inválida.' });
};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Interface web (index.html) não encontrada. Verifique se a pasta "public" foi enviada corretamente para o repositório.');
    }
});

let sock;
let qrCodeData;
let connectionStatus = 'disconnected';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrCodeData = await qrcode.toDataURL(qr);
            io.emit('qr', qrCodeData);
            connectionStatus = 'qr_ready';
            io.emit('status', connectionStatus);
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            connectionStatus = 'disconnected';
            io.emit('status', connectionStatus);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('opened connection');
            connectionStatus = 'connected';
            io.emit('status', connectionStatus);
            qrCodeData = null;
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        // Handle incoming messages here if needed
        // console.log(JSON.stringify(m, undefined, 2));
    });
}

io.on('connection', (socket) => {
    socket.emit('status', connectionStatus);
    socket.emit('api_key', API_KEY); // Envia a chave para a interface web
    if (qrCodeData) {
        socket.emit('qr', qrCodeData);
    }
});

// API Routes
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', connection: connectionStatus });
});

app.get('/status', authMiddleware, (req, res) => {
    res.json({ status: connectionStatus });
});

app.post('/send-message', authMiddleware, async (req, res) => {
    const { number, message } = req.body;
    if (!sock || connectionStatus !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    try {
        const jid = number.includes('@s.whatsapp.net') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    connectToWhatsApp();
});
