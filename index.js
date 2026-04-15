const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const os = require('os');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const WhatsAppManager = require('./services/WhatsAppManager');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { authMiddleware, adminMiddleware } = require('./middleware/auth');

dotenv.config();

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp-saas';

// Security Middlewares
app.use(helmet({
    contentSecurityPolicy: false, // Disabilitado para facilitar o uso de recursos externos no painel
}));
const corsOptions = {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100 // Limite por IP
});
app.use('/auth/', limiter);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// WhatsApp Manager
const whatsAppManager = new WhatsAppManager(io);

// Pass WhatsApp Manager to request
app.use((req, res, next) => {
    req.whatsAppManager = whatsAppManager;
    next();
});

// Database connection
const mongoOptions = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
};

mongoose.connect(MONGO_URI, mongoOptions)
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        console.log('DICA: Se estiver usando MongoDB Atlas, verifique se seu IP está na Whitelist e se a URI está correta.');
    });

// Routes
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/', apiRoutes);

// User Dashboard
app.get('/dashboard', authMiddleware, async (req, res) => {
    const user = req.user;
    const session = await whatsAppManager.getSession(user._id.toString());
    const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
    const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
    const effectiveProto = forwardedProto || req.protocol;
    const effectiveHost = forwardedHost || req.get('host');
    const detectedBaseUrl = `${effectiveProto}://${effectiveHost}`;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const publicBaseUrl = (process.env.PUBLIC_BASE_URL || detectedBaseUrl).replace(/\/$/, '');
    const publicSendMessageUrl = `${publicBaseUrl}/api/send-message`;
    res.render('dashboard', { user, sessionStatus: session.status, baseUrl, publicBaseUrl, publicSendMessageUrl, isTest: false });
});

// Admin Panel
app.get('/admin', authMiddleware, adminMiddleware, async (req, res) => {
    const User = require('./models/User');
    const MessageLog = require('./models/MessageLog');
    
    const users = await User.find();
    const totalMessages = await MessageLog.countDocuments({ status: 'sent' });
    const totalUsers = await User.countDocuments();
    const premiumUsers = await User.countDocuments({ plan: 'premium' });

    const bytesToMB = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;
    const formatDuration = (totalSeconds) => {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const parts = [];
        if (days) parts.push(`${days}d`);
        if (hours || days) parts.push(`${hours}h`);
        if (minutes || hours || days) parts.push(`${minutes}m`);
        parts.push(`${secs}s`);
        return parts.join(' ');
    };

    const mongoStateMap = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };
    const mongoReadyState = mongoose.connection.readyState;
    const mongoState = mongoStateMap[mongoReadyState] || 'unknown';
    const processMem = process.memoryUsage();
    const queueMetrics = typeof whatsAppManager.getQueueMetrics === 'function'
        ? whatsAppManager.getQueueMetrics()
        : { usersWithQueue: 0, totalPending: 0, delayMs: 0, maxQueuePerUser: 0 };

    const system = {
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.arch()}`,
        node: process.version,
        serverUptime: formatDuration(os.uptime()),
        processUptime: formatDuration(process.uptime()),
        loadAvg: os.loadavg().map(v => Math.round(v * 100) / 100).join(' / '),
        memTotalMB: bytesToMB(os.totalmem()),
        memFreeMB: bytesToMB(os.freemem()),
        rssMB: bytesToMB(processMem.rss),
        heapUsedMB: bytesToMB(processMem.heapUsed),
        mongoState,
        waSessionsInMemory: whatsAppManager.sessions ? whatsAppManager.sessions.size : 0,
        queueUsers: queueMetrics.usersWithQueue,
        queuePending: queueMetrics.totalPending,
        queueDelayMs: queueMetrics.delayMs,
        queueMaxPerUser: queueMetrics.maxQueuePerUser,
        publicBaseUrl: process.env.PUBLIC_BASE_URL || ''
    };

    const security = {
        trustProxy: Boolean(app.get('trust proxy')),
        helmet: true,
        rateLimit: { windowMinutes: 15, max: 100 },
        cors: { methods: corsOptions.methods, allowedHeaders: corsOptions.allowedHeaders }
    };
    
    res.render('admin', { 
        users, 
        stats: {
            totalMessages,
            totalUsers,
            premiumUsers
        },
        system,
        security,
        isTest: false
    });
});

app.get('/teste', authMiddleware, adminMiddleware, (req, res) => {
    res.redirect('/teste/dashboard');
});

app.get('/teste/dashboard', authMiddleware, adminMiddleware, async (req, res) => {
    const user = req.user;
    const session = await whatsAppManager.getSession(user._id.toString());
    const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
    const forwardedHost = (req.get('x-forwarded-host') || '').split(',')[0].trim();
    const effectiveProto = forwardedProto || req.protocol;
    const effectiveHost = forwardedHost || req.get('host');
    const detectedBaseUrl = `${effectiveProto}://${effectiveHost}`;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const publicBaseUrl = (process.env.PUBLIC_BASE_URL || detectedBaseUrl).replace(/\/$/, '');
    const publicSendMessageUrl = `${publicBaseUrl}/api/send-message`;
    res.render('dashboard', { user, sessionStatus: session.status, baseUrl, publicBaseUrl, publicSendMessageUrl, isTest: true });
});

app.get('/teste/admin', authMiddleware, adminMiddleware, async (req, res) => {
    const User = require('./models/User');
    const MessageLog = require('./models/MessageLog');
    
    const users = await User.find();
    const totalMessages = await MessageLog.countDocuments({ status: 'sent' });
    const totalUsers = await User.countDocuments();
    const premiumUsers = await User.countDocuments({ plan: 'premium' });

    const bytesToMB = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;
    const formatDuration = (totalSeconds) => {
        const seconds = Math.max(0, Math.floor(totalSeconds));
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const parts = [];
        if (days) parts.push(`${days}d`);
        if (hours || days) parts.push(`${hours}h`);
        if (minutes || hours || days) parts.push(`${minutes}m`);
        parts.push(`${secs}s`);
        return parts.join(' ');
    };

    const mongoStateMap = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };
    const mongoReadyState = mongoose.connection.readyState;
    const mongoState = mongoStateMap[mongoReadyState] || 'unknown';
    const processMem = process.memoryUsage();
    const queueMetrics = typeof whatsAppManager.getQueueMetrics === 'function'
        ? whatsAppManager.getQueueMetrics()
        : { usersWithQueue: 0, totalPending: 0, delayMs: 0, maxQueuePerUser: 0 };

    const system = {
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.arch()}`,
        node: process.version,
        serverUptime: formatDuration(os.uptime()),
        processUptime: formatDuration(process.uptime()),
        loadAvg: os.loadavg().map(v => Math.round(v * 100) / 100).join(' / '),
        memTotalMB: bytesToMB(os.totalmem()),
        memFreeMB: bytesToMB(os.freemem()),
        rssMB: bytesToMB(processMem.rss),
        heapUsedMB: bytesToMB(processMem.heapUsed),
        mongoState,
        waSessionsInMemory: whatsAppManager.sessions ? whatsAppManager.sessions.size : 0,
        queueUsers: queueMetrics.usersWithQueue,
        queuePending: queueMetrics.totalPending,
        queueDelayMs: queueMetrics.delayMs,
        queueMaxPerUser: queueMetrics.maxQueuePerUser,
        publicBaseUrl: process.env.PUBLIC_BASE_URL || ''
    };

    const security = {
        trustProxy: Boolean(app.get('trust proxy')),
        helmet: true,
        rateLimit: { windowMinutes: 15, max: 100 },
        cors: { methods: corsOptions.methods, allowedHeaders: corsOptions.allowedHeaders }
    };

    res.render('admin', { 
        users, 
        stats: {
            totalMessages,
            totalUsers,
            premiumUsers
        },
        system,
        security,
        isTest: true
    });
});

app.patch('/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const User = require('./models/User');
    try {
        await User.findByIdAndUpdate(req.params.id, req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
});

app.post('/api/regenerate-key', authMiddleware, async (req, res) => {
    const User = require('./models/User');
    const crypto = require('crypto');
    try {
        const newKey = crypto.randomBytes(24).toString('hex');
        await User.findByIdAndUpdate(req.user._id, { apiKey: newKey });
        res.json({ success: true, apiKey: newKey });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao gerar nova chave' });
    }
});

// Public pages
app.get('/login', (req, res) => res.render('login'));
app.get('/register', (req, res) => res.render('register'));
app.get('/', (req, res) => {
    const token = req.cookies?.token;
    if (token) {
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            return res.redirect('/dashboard');
        } catch (e) {}
    }
    res.render('landing');
});
app.get('/precos', (req, res) => res.render('landing'));

// Socket.io for QR updates
io.on('connection', (socket) => {
    socket.on('join', async (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined their channel`);
        
        // Envia o status atual e QR assim que o usuário conectar ao socket
        const session = await whatsAppManager.getSession(userId);
        if (session) {
            socket.emit('status', session.status);
            if (session.qrCode) {
                socket.emit('qr', session.qrCode);
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`SaaS Server running on port ${PORT}`);
});
