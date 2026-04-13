const trialMiddleware = async (req, res, next) => {
    const user = req.user;

    // Reset daily limit if it's a new day
    await user.checkAndResetLimit();

    if (user.plan === 'free') {
        if (user.messagesSentToday >= user.dailyLimit) {
            return res.status(403).json({ 
                error: 'Limite diário de teste atingido. Faça o upgrade para o plano Premium para envios ilimitados.' 
            });
        }
    }

    next();
};

module.exports = trialMiddleware;
