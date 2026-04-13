const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');

router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'Email já cadastrado' });

        // Make the first user an admin
        const userCount = await User.countDocuments();
        const role = userCount === 0 ? 'admin' : 'user';

        const user = new User({ name, email, password, role });
        await user.save();

        res.status(201).json({ success: true, message: 'Usuário cadastrado com sucesso' });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao cadastrar usuário' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
        res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.json({ success: true, role: user.role });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao fazer login' });
    }
});

router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

module.exports = router;
