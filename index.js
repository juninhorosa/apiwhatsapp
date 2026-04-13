const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const WhatsAppManager = require('./services/WhatsAppManager');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { authMiddleware, adminMiddleware } = require('./middleware/auth');

dotenv.config();

const app = express();
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
app.use(cors());
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

// User Dashboard
app.get('/dashboard', authMiddleware, async (req, res) => {
    const user = req.user;
    const session = await whatsAppManager.getSession(user._id.toString());
    res.render('dashboard', { user, sessionStatus: session.status });
});

// Admin Panel
app.get('/admin', authMiddleware, adminMiddleware, async (req, res) => {
    const User = require('./models/User');
    const MessageLog = require('./models/MessageLog');
    
    const users = await User.find();
    const totalMessages = await MessageLog.countDocuments({ status: 'sent' });
    const totalUsers = await User.countDocuments();
    const premiumUsers = await User.countDocuments({ plan: 'premium' });
    
    res.render('admin', { 
        users, 
        stats: {
            totalMessages,
            totalUsers,
            premiumUsers
        }
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
app.get('/', (req, res) => res.redirect('/dashboard')); // Redireciona para o dashboard protegido

// Socket.io for QR updates
io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined their channel`);
    });
});

server.listen(PORT, () => {
    console.log(`SaaS Server running on port ${PORT}`);
});
