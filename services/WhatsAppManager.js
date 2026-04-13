const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const P = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');

// Cache da versão do Baileys para acelerar o boot
let cachedVersion = null;

class WhatsAppManager {
    constructor(io) {
        this.io = io;
        this.sessions = new Map();
        this.logger = P({ level: 'error' }); // Apenas logs de erro para não pesar
        this.timeouts = new Map();
        this.sessionsBaseDir = process.env.SESSIONS_DIR || (fs.existsSync('/sessions') ? '/sessions' : path.join(__dirname, '..', 'sessions'));
    }

    async getBaileysVersion() {
        if (cachedVersion) return cachedVersion;
        try {
            const { version } = await fetchLatestBaileysVersion();
            cachedVersion = version;
            return version;
        } catch (e) {
            return [2, 3000, 1015901307]; // Fallback para uma versão estável
        }
    }

    async getSession(userId) {
        // Se a sessão já estiver na memória, renovamos o timeout de inatividade e retornamos
        if (this.sessions.has(userId)) {
            const session = this.sessions.get(userId);
            // Se estava desconectada (mas temos a pasta de auth), pode estar no processo de conectar
            if (session.status === 'disconnected') {
                // Tenta reconectar ou aguarda
                return await this.waitForConnection(userId, session);
            }
            this.resetIdleTimeout(userId);
            return session;
        }
        
        const session = await this.initializeSession(userId);
        return await this.waitForConnection(userId, session);
    }

    async waitForConnection(userId, session, timeoutMs = 15000) {
        if (session.status === 'connected') return session;
        
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(session); // Retorna a sessão mesmo que não conecte no tempo limite
            }, timeoutMs);

            const checkStatus = setInterval(() => {
                if (session.status === 'connected' || session.status === 'qr_ready') {
                    clearInterval(checkStatus);
                    clearTimeout(timeout);
                    resolve(session);
                }
            }, 500);
        });
    }

    async initializeSession(userId) {
        const authPath = path.join(this.sessionsBaseDir, userId);
        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const version = await this.getBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: this.logger,
            printQRInTerminal: false,
            // Otimizações de performance e velocidade
            browser: Browsers.ubuntu('Chrome'), // Identificação mais rápida
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: true,
            retryRequestDelayMs: 250,
            maxMsgRetryCount: 5,
            syncFullHistory: false, // Poupa RAM e tempo de boot
            markOnlineOnConnect: true,
        });

        const session = {
            sock,
            status: 'disconnected',
            qrCode: null,
            lastActivity: Date.now()
        };

        this.sessions.set(userId, session);
        this.resetIdleTimeout(userId);

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                session.qrCode = await qrcode.toDataURL(qr);
                session.status = 'qr_ready';
                this.io.to(userId).emit('qr', session.qrCode);
                this.io.to(userId).emit('status', session.status);
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                session.status = 'disconnected';
                this.io.to(userId).emit('status', session.status);

                if (shouldReconnect) {
                    setTimeout(() => this.initializeSession(userId), 5000);
                } else {
                    this.sessions.delete(userId);
                    if (fs.existsSync(authPath)) {
                        fs.rmSync(authPath, { recursive: true, force: true });
                    }
                }
            } else if (connection === 'open') {
                session.status = 'connected';
                session.qrCode = null;
                this.io.to(userId).emit('status', session.status);
            }
        });

        return session;
    }

    resetIdleTimeout(userId) {
        // Limpa timeout anterior se existir
        if (this.timeouts.has(userId)) {
            clearTimeout(this.timeouts.get(userId));
        }

        // Define um novo timeout de 30 minutos (1.800.000 ms) de inatividade para fechar a conexão e poupar RAM
        const timeout = setTimeout(async () => {
            console.log(`Encerrando sessão do usuário ${userId} por inatividade para economizar RAM.`);
            await this.unloadSession(userId);
        }, 30 * 60 * 1000);

        this.timeouts.set(userId, timeout);
    }

    async unloadSession(userId) {
        if (this.sessions.has(userId)) {
            const session = this.sessions.get(userId);
            try {
                // Apenas fecha a conexão do socket, não desloga.
                // Quando o usuário usar a API de novo, o getSession reabrirá a conexão.
                session.sock.end();
            } catch (e) {}
            this.sessions.delete(userId);
            this.timeouts.delete(userId);
        }
    }

    async deleteSession(userId) {
        if (this.sessions.has(userId)) {
            const session = this.sessions.get(userId);
            try {
                await session.sock.logout();
                session.sock.end();
            } catch (e) {}
            this.sessions.delete(userId);
            this.timeouts.delete(userId);
        }
        const authPath = path.join(this.sessionsBaseDir, userId);
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
        }
    }
}

module.exports = WhatsAppManager;
