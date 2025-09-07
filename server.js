const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Debug middleware to log requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Serve static frontend files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Weather API configuration
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_URL = 'https://api.weatherapi.com/v1/current.json';

// Debug API key status
console.log('=== API Config Debug ===');
console.log('API Key Present:', !!WEATHER_API_KEY);
console.log('API Key Length:', WEATHER_API_KEY ? WEATHER_API_KEY.length : 0);
console.log('API URL:', WEATHER_API_URL);

// Simple rate limiter
const rateLimitStore = new Map();
const RATE_LIMIT = 100; // Max requests per hour per IP
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;

function rateLimit(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    if (!rateLimitStore.has(clientIP)) {
        rateLimitStore.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }

    const clientData = rateLimitStore.get(clientIP);

    if (now > clientData.resetTime) {
        rateLimitStore.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }

    if (clientData.count >= RATE_LIMIT) {
        return res.status(429).json({
            error: 'Rate limit exceeded',
            message: 'Too many requests. Please try again later.',
            resetTime: new Date(clientData.resetTime)
        });
    }

    clientData.count++;
    next();
}

// Input validation
function validateLocationInput(location) {
    if (!location || typeof location !== 'string') {
        return { valid: false, reason: 'Location is required and must be a string' };
    }

    const sanitized = location.trim();

    if (sanitized.length < 1) {
        return { valid: false, reason: 'Location cannot be empty' };
    }

    if (sanitized.length > 100) {
        return { valid: false, reason: 'Location name too long (max 100 characters)' };
    }

    const validPattern = /^[a-zA-Z0-9\s\-'.,()]+$/;
    if (!validPattern.test(sanitized)) {
        return { valid: false, reason: 'Location contains invalid characters' };
    }

    return { valid: true, sanitized };
}

// Weather API endpoint
app.get('/api/weather', rateLimit, async (req, res) => {
    console.log('\n=== /api/weather called ===');
    console.log('Query:', req.query);

    const { location } = req.query;

    const validation = validateLocationInput(location);
    if (!validation.valid) {
        return res.status(400).json({ error: 'Invalid location', message: validation.reason });
    }

    const sanitizedLocation = validation.sanitized;

    if (!WEATHER_API_KEY) {
        return res.status(500).json({
            error: 'Service unavailable',
            message: 'Weather service not configured (missing API key)'
        });
    }

    const apiUrl = `${WEATHER_API_URL}?key=${WEATHER_API_KEY}&q=${encodeURIComponent(sanitizedLocation)}&aqi=no`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(apiUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Weather-Terminal/1.0' }
        });

        clearTimeout(timeoutId);

        const responseText = await response.text();

        if (!response.ok) {
            return res.status(response.status).json({
                error: 'Weather API error',
                message: `API returned status ${response.status}`
            });
        }

        let weatherData;
        try {
            weatherData = JSON.parse(responseText);
        } catch (err) {
            return res.status(502).json({ error: 'Bad response', message: 'Invalid JSON from WeatherAPI' });
        }

        if (weatherData.error) {
            return res.status(404).json({ error: 'Location not found', message: weatherData.error.message });
        }

        res.json({
            location: weatherData.location,
            current: weatherData.current
        });

    } catch (error) {
        if (error.name === 'AbortError') {
            return res.status(504).json({ error: 'Timeout', message: 'Weather API request timed out' });
        }

        res.status(500).json({
            error: 'Service error',
            message: 'Failed to fetch weather data'
        });
    }
});

// Test API key endpoint
app.get('/api/test', async (req, res) => {
    if (!WEATHER_API_KEY) {
        return res.json({ status: 'error', message: 'API key not configured', hasApiKey: false });
    }

    try {
        const testUrl = `${WEATHER_API_URL}?key=${WEATHER_API_KEY}&q=London&aqi=no`;
        const response = await fetch(testUrl);
        const data = await response.text();

        res.json({
            status: response.ok ? 'success' : 'error',
            httpStatus: response.status,
            hasApiKey: true,
            apiKeyLength: WEATHER_API_KEY.length,
            responsePreview: data.substring(0, 200)
        });
    } catch (error) {
        res.json({ status: 'error', message: error.message, hasApiKey: true });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        apiKeyConfigured: !!WEATHER_API_KEY
    });
});

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.get('/api/env', (req, res) => {
    res.json({
        apiKeyPresent: !!process.env.WEATHER_API_KEY,
        apiKeyPreview: process.env.WEATHER_API_KEY ? process.env.WEATHER_API_KEY.substring(0, 4) + '...' : null
    });
});

// Generic error handler
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err.message);
    res.status(500).json({
        error: 'Internal server error',
        message: 'Something went wrong on our end'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔗 Frontend: http://localhost:${PORT}`);
    console.log(`🧪 API Test: http://localhost:${PORT}/api/test`);
});
