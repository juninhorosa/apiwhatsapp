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
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const logger = P({ level: 'info' });

// Função para obter ou gerar uma API Key persistente
function getApiKey() {
    const keyPath = path.join(__dirname, 'auth_info_baileys', 'api_key.txt');
    
    // Se a pasta auth não existir, cria ela
    if (!fs.existsSync(path.join(__dirname, 'auth_info_baileys'))) {
        fs.mkdirSync(path.join(__dirname, 'auth_info_baileys'));
    }

    if (fs.existsSync(keyPath)) {
        return fs.readFileSync(keyPath, 'utf8').trim();
    } else {
        const newKey = crypto.randomBytes(16).toString('hex');
        fs.writeFileSync(keyPath, newKey);
        return newKey;
    }
}

let API_KEY = getApiKey();

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
            
            // Ao conectar, geramos uma nova chave se desejar, ou apenas exibimos a atual.
            // Para "chave aleatória por conexão", vamos gerar uma nova:
            const keyPath = path.join(__dirname, 'auth_info_baileys', 'api_key.txt');
            API_KEY = crypto.randomBytes(16).toString('hex');
            fs.writeFileSync(keyPath, API_KEY);
            console.log('Nova API Key gerada para esta conexão:', API_KEY);
            
            io.emit('status', connectionStatus);
            io.emit('api_key', API_KEY); // Atualiza na interface
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

app.post('/logout', authMiddleware, async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
            sock.end();
        }
        
        // Remove a pasta de autenticação
        const authPath = path.join(__dirname, 'auth_info_baileys');
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
        
        connectionStatus = 'disconnected';
        qrCodeData = null;
        
        io.emit('status', connectionStatus);
        
        res.json({ success: true, message: 'Desconectado com sucesso' });
        
        // Reinicia o processo de conexão para gerar novo QR Code
        setTimeout(() => {
            connectToWhatsApp();
        }, 3000);
        
    } catch (err) {
        console.error('Erro ao desconectar:', err);
        res.status(500).json({ error: 'Erro ao desconectar', details: err.message });
    }
});

app.post('/send-message', authMiddleware, async (req, res) => {
    let { number, message } = req.body;
    
    if (!sock || connectionStatus !== 'connected') {
        return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    if (!number || !message) {
        return res.status(400).json({ error: 'Número e mensagem são obrigatórios' });
    }

    try {
        // Limpa o número: remove tudo que não for dígito
        let cleanNumber = number.replace(/\D/g, '');
        
        // Garante que o número termina com @s.whatsapp.net
        const jid = cleanNumber.includes('@s.whatsapp.net') ? cleanNumber : `${cleanNumber}@s.whatsapp.net`;
        
        console.log(`Tentando enviar mensagem para: ${jid}`);
        
        const result = await sock.sendMessage(jid, { text: message });
        
        console.log('Resultado do envio:', result ? 'Sucesso' : 'Falha');
        res.json({ success: true, info: 'Mensagem enviada com sucesso' });
    } catch (err) {
        console.error('Erro ao enviar mensagem:', err);
        res.status(500).json({ error: 'Erro interno ao enviar mensagem', details: err.message });
    }
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    connectToWhatsApp();
});
