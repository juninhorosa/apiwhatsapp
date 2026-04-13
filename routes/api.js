const express = require('express');
const router = express.Router();
const { apiAuthMiddleware } = require('../middleware/auth');
const trialMiddleware = require('../middleware/trial');
const MessageLog = require('../models/MessageLog');

router.post('/send-message', apiAuthMiddleware, trialMiddleware, async (req, res) => {
    const { number, message } = req.body;
    const user = req.user;
    const whatsAppManager = req.whatsAppManager;

    if (!number || !message) {
        return res.status(400).json({ error: 'Número e mensagem são obrigatórios' });
    }

    try {
        const session = await whatsAppManager.getSession(user._id.toString());
        if (session.status !== 'connected') {
            return res.status(400).json({ error: 'WhatsApp não conectado' });
        }

        let cleanNumber = number.replace(/\D/g, '');
        if (!cleanNumber.startsWith('55') && (cleanNumber.length === 10 || cleanNumber.length === 11)) {
            cleanNumber = `55${cleanNumber}`;
        }
        const jid = cleanNumber.includes('@s.whatsapp.net') ? cleanNumber : `${cleanNumber}@s.whatsapp.net`;

        // Verifica se o número existe no WhatsApp
        const [result] = await session.sock.onWhatsApp(jid);
        if (!result || !result.exists) {
            return res.status(400).json({ error: 'Número não registrado no WhatsApp' });
        }

        // Envia usando o JID real retornado pelo WhatsApp
        const realJid = result.jid;
        await session.sock.sendMessage(realJid, { text: message });

        // Increment trial counter
        user.messagesSentToday += 1;
        await user.save();

        // Log message to history
        await new MessageLog({
            userId: user._id,
            number: cleanNumber,
            message: message,
            status: 'sent'
        }).save();

        res.json({ success: true, info: 'Mensagem enviada com sucesso', remaining: user.plan === 'free' ? user.dailyLimit - user.messagesSentToday : 'unlimited' });
    } catch (err) {
        // Log error to history
        await new MessageLog({
            userId: user._id,
            number: number,
            message: message,
            status: 'error',
            errorDetails: err.message
        }).save();
        
        res.status(500).json({ error: 'Erro ao enviar mensagem', details: err.message });
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
