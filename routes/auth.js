const express = require('express');
const router = express.Router();
const User = require('../models/User');
const jwt = require('jsonwebtoken');

router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        console.log('Tentativa de registro para:', email);
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log('Erro: Email já existe');
            return res.status(400).json({ error: 'Email já cadastrado' });
        }

        // Make the first user an admin
        const userCount = await User.countDocuments();
        const role = userCount === 0 ? 'admin' : 'user';

        const user = new User({ name, email, password, role });
        await user.save();

        console.log('Usuário cadastrado com sucesso:', email, 'Role:', role);
        res.status(201).json({ success: true, message: 'Usuário cadastrado com sucesso' });
    } catch (err) {
        console.error('Erro detalhado no registro:', err);
        res.status(500).json({ error: 'Erro ao cadastrar usuário: ' + err.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }

        // Gera apiKey se for um usuário antigo sem a chave
        if (!user.apiKey) {
            const crypto = require('crypto');
            user.apiKey = crypto.randomBytes(24).toString('hex');
            await user.save();
        }

        const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' });
        
        // Configuração do cookie compatível com HTTP (IP Direto) e HTTPS
        res.cookie('token', token, { 
            httpOnly: true, 
            secure: false, // Forçado para false para funcionar via IP direto (HTTP)
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 1 dia
        });

        console.log('Login realizado com sucesso para:', email);
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
