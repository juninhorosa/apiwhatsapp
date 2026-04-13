const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    apiKey: { type: String, unique: true },
    plan: { type: String, enum: ['free', 'premium'], default: 'free' },
    dailyLimit: { type: Number, default: 10 }, // Limite para teste diário
    messagesSentToday: { type: Number, default: 0 },
    lastReset: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'blocked'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
userSchema.pre('save', async function() {
    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 10);
    if (!this.apiKey) {
        this.apiKey = crypto.randomBytes(24).toString('hex');
    }
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Reset daily limit if needed
userSchema.methods.checkAndResetLimit = async function() {
    const now = new Date();
    const last = new Date(this.lastReset);
    if (now.toDateString() !== last.toDateString()) {
        this.messagesSentToday = 0;
        this.lastReset = now;
        await this.save();
    }
};

module.exports = mongoose.model('User', userSchema);
