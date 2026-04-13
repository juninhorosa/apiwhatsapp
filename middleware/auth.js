const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
        if (!token) return res.redirect('/login');

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        if (!user || user.status !== 'active') return res.redirect('/login');

        req.user = user;
        next();
    } catch (err) {
        res.redirect('/login');
    }
};

const adminMiddleware = async (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Acesso negado' });
    }
};

const apiAuthMiddleware = async (req, res, next) => {
    const key = req.headers['x-api-key'] || req.query.key;
    if (!key) return res.status(401).json({ error: 'Chave de API ausente' });

    const user = await User.findOne({ apiKey: key });
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Chave de API inválida ou conta bloqueada' });

    req.user = user;
    next();
};

module.exports = { authMiddleware, adminMiddleware, apiAuthMiddleware };
