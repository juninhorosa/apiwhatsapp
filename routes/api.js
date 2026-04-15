const express = require('express');
const router = express.Router();
const { apiAuthMiddleware } = require('../middleware/auth');
const trialMiddleware = require('../middleware/trial');
const MessageLog = require('../models/MessageLog');
const User = require('../models/User');

router.post('/send-message', apiAuthMiddleware, trialMiddleware, async (req, res) => {
    const { number, message } = req.body;
    const user = req.user;
    const whatsAppManager = req.whatsAppManager;

    if (!number || !message) {
        return res.status(400).json({ error: 'Número e mensagem são obrigatórios' });
    }

    try {
        const userId = user._id.toString();
        const result = await whatsAppManager.enqueueMessage(userId, async () => {
            const freshUser = await User.findById(userId);
            if (!freshUser || freshUser.status !== 'active') {
                const e = new Error('Conta bloqueada ou não encontrada');
                e.statusCode = 401;
                throw e;
            }

            // Revalidação dentro da fila evita corrida quando chegam várias requisições ao mesmo tempo.
            await freshUser.checkAndResetLimit();
            if (freshUser.plan === 'free' && freshUser.messagesSentToday >= freshUser.dailyLimit) {
                const e = new Error('Limite diário de teste atingido. Faça o upgrade para o plano Premium para envios ilimitados.');
                e.statusCode = 403;
                throw e;
            }

            const session = await whatsAppManager.getSession(userId);
            if (session.status !== 'connected') {
                const e = new Error('WhatsApp não conectado');
                e.statusCode = 400;
                throw e;
            }

            let cleanNumber = number.replace(/\D/g, '');
            if (!cleanNumber.startsWith('55') && (cleanNumber.length === 10 || cleanNumber.length === 11)) {
                cleanNumber = `55${cleanNumber}`;
            }
            const jid = cleanNumber.includes('@s.whatsapp.net') ? cleanNumber : `${cleanNumber}@s.whatsapp.net`;

            const [waLookup] = await session.sock.onWhatsApp(jid);
            if (!waLookup || !waLookup.exists) {
                const e = new Error('Número não registrado no WhatsApp');
                e.statusCode = 400;
                throw e;
            }

            await session.sock.sendMessage(waLookup.jid, { text: message });

            freshUser.messagesSentToday += 1;
            await freshUser.save();

            await new MessageLog({
                userId: freshUser._id,
                number: cleanNumber,
                message,
                status: 'sent'
            }).save();

            return {
                remaining: freshUser.plan === 'free' ? freshUser.dailyLimit - freshUser.messagesSentToday : 'unlimited'
            };
        });

        res.json({ success: true, info: 'Mensagem enviada com sucesso', remaining: result.remaining });
    } catch (err) {
        await new MessageLog({
            userId: user._id,
            number,
            message,
            status: 'error',
            errorDetails: err.message
        }).save();

        const statusCode = err.statusCode || 500;
        const defaultMsg = statusCode === 500 ? 'Erro ao enviar mensagem' : err.message;
        res.status(statusCode).json({ error: defaultMsg, details: err.message });
    }
});

router.get('/history', apiAuthMiddleware, async (req, res) => {
    try {
        const history = await MessageLog.find({ userId: req.user._id }).sort({ timestamp: -1 }).limit(50);
        res.json({ history });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar histórico' });
    }
});

router.get('/status', apiAuthMiddleware, async (req, res) => {
    const user = req.user;
    const whatsAppManager = req.whatsAppManager;
    const session = await whatsAppManager.getSession(user._id.toString());
    res.json({ status: session.status, plan: user.plan, dailyLimit: user.dailyLimit, messagesSentToday: user.messagesSentToday });
});

router.post('/logout', apiAuthMiddleware, async (req, res) => {
    const user = req.user;
    const whatsAppManager = req.whatsAppManager;
    await whatsAppManager.deleteSession(user._id.toString());
    res.json({ success: true, message: 'WhatsApp desconectado' });
});

module.exports = router;
