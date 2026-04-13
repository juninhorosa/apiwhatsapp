const mongoose = require('mongoose');

const messageLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    number: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: ['sent', 'error'], default: 'sent' },
    errorDetails: { type: String },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MessageLog', messageLogSchema);
