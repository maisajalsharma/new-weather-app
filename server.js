// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Get API key from environment variables
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_URL = 'https://api.weatherapi.com/v1/current.json';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust proxy for rate limiting (important for deployed apps)
app.set('trust proxy', true);

// Debug middleware to log requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Serve static frontend files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Simple rate limiter
const rateLimitStore = new Map();
const RATE_LIMIT = process.env.RATE_LIMIT || 100;
const RATE_LIMIT_WINDOW = process.env.RATE_LIMIT_WINDOW || 60 * 60 * 1000; // 1 hour

function rateLimit(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
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

// Cleanup rate limit store periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitStore.entries()) {
        if (now > data.resetTime) {
            rateLimitStore.delete(ip);
        }
    }
}, RATE_LIMIT_WINDOW);

// Input validation function
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

    // Allow letters, numbers, spaces, hyphens, apostrophes, periods, commas, parentheses
    const validPattern = /^[a-zA-Z0-9\s\-'.,()]+$/;
    if (!validPattern.test(sanitized)) {
        return { valid: false, reason: 'Location contains invalid characters' };
    }

    return { valid: true, sanitized };
}

// Weather API endpoint
app.get('/api/weather', rateLimit, async (req, res) => {
    try {
        console.log('\n=== /api/weather called ===');
        console.log('Query:', req.query);
        console.log('API Key exists:', !!WEATHER_API_KEY);

        const { location } = req.query;

        // Validate location input
        const validation = validateLocationInput(location);
        if (!validation.valid) {
            return res.status(400).json({ 
                error: 'Invalid location', 
                message: validation.reason 
            });
        }

        const sanitizedLocation = validation.sanitized;

        // Check if API key is configured
        if (!WEATHER_API_KEY) {
            console.error('❌ Weather API key not configured');
            return res.status(500).json({
                error: 'Service unavailable',
                message: 'Weather API key not configured. Please set WEATHER_API_KEY in .env file.'
            });
        }

        // Build API URL
        const apiUrl = `${WEATHER_API_URL}?key=${WEATHER_API_KEY}&q=${encodeURIComponent(sanitizedLocation)}&aqi=no`;
        console.log('Calling weather API for:', sanitizedLocation);

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        // Make API request
        const response = await fetch(apiUrl, {
            signal: controller.signal,
            headers: { 
                'User-Agent': 'Weather-Terminal/1.0',
                'Accept': 'application/json'
            }
        });

        clearTimeout(timeoutId);

        console.log('Weather API response status:', response.status);

        // Get response text
        const responseText = await response.text();

        // Check if response is ok
        if (!response.ok) {
            console.error('Weather API error:', response.status, responseText);
            
            // Try to parse error response
            let errorMessage = `API returned status ${response.status}`;
            try {
                const errorData = JSON.parse(responseText);
                if (errorData.error && errorData.error.message) {
                    errorMessage = errorData.error.message;
                }
            } catch (e) {
                // If we can't parse the error, use the generic message
            }

            return res.status(response.status === 400 ? 404 : response.status).json({
                error: 'Weather API error',
                message: errorMessage
            });
        }

        // Parse JSON response
        let weatherData;
        try {
            weatherData = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse weather API response:', parseError);
            return res.status(502).json({ 
                error: 'Invalid response from weather service',
                message: 'Failed to parse weather data'
            });
        }

        // Check for API error in the response
        if (weatherData.error) {
            console.error('Weather API returned error:', weatherData.error);
            return res.status(404).json({ 
                error: 'Location not found', 
                message: weatherData.error.message || 'Location not found'
            });
        }

        // Validate response structure
        if (!weatherData.location || !weatherData.current) {
            console.error('Invalid weather data structure:', weatherData);
            return res.status(502).json({
                error: 'Invalid response from weather service',
                message: 'Unexpected response format'
            });
        }

        console.log('✅ Successfully retrieved weather for:', weatherData.location.name);

        // Return successful response
        res.json({
            location: weatherData.location,
            current: weatherData.current,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error in /api/weather:', error);

        if (error.name === 'AbortError') {
            return res.status(504).json({ 
                error: 'Request timeout', 
                message: 'Weather API request timed out. Please try again.' 
            });
        }

        return res.status(500).json({ 
            error: 'Internal server error',
            message: 'Failed to fetch weather data. Please try again later.'
        });
    }
});

// Test endpoint to verify API configuration
app.get('/api/test', async (req, res) => {
    try {
        console.log('\n=== /api/test called ===');
        console.log('API Key exists:', !!WEATHER_API_KEY);

        if (!WEATHER_API_KEY) {
            return res.json({ 
                status: 'error', 
                message: 'Weather API key not configured in .env file',
                hasApiKey: false 
            });
        }

        // Test with London
        const testUrl = `${WEATHER_API_URL}?key=${WEATHER_API_KEY}&q=London&aqi=no`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(testUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Weather-Terminal/1.0' }
        });

        clearTimeout(timeoutId);

        const data = await response.text();

        console.log('Test API response status:', response.status);

        res.json({
            status: response.ok ? 'success' : 'error',
            httpStatus: response.status,
            hasApiKey: true,
            apiKeyLength: WEATHER_API_KEY.length,
            responsePreview: data.substring(0, 200) + (data.length > 200 ? '...' : ''),
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Error in /api/test:', error);
        
        if (error.name === 'AbortError') {
            return res.json({ 
                status: 'error', 
                message: 'Request timeout',
                hasApiKey: !!WEATHER_API_KEY 
            });
        }

        res.json({ 
            status: 'error', 
            message: error.message,
            hasApiKey: !!WEATHER_API_KEY 
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        apiKeyConfigured: !!WEATHER_API_KEY,
        nodeVersion: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV || 'development'
    });
});

// Environment check endpoint (for debugging)
app.get('/api/env', (req, res) => {
    res.json({
        apiKeyPresent: !!WEATHER_API_KEY,
        apiKeyPreview: WEATHER_API_KEY ? WEATHER_API_KEY.substring(0, 4) + '...' : null,
        nodeEnv: process.env.NODE_ENV || 'development',
        port: PORT,
        rateLimit: RATE_LIMIT,
        rateLimitWindow: RATE_LIMIT_WINDOW
    });
});

// Serve index.html for root path
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error('Error serving index.html:', err);
            res.status(404).json({ 
                error: 'Frontend not found',
                message: 'Please ensure index.html exists in the public directory'
            });
        }
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ 
        error: 'API endpoint not found', 
        message: `${req.method} ${req.originalUrl} not found` 
    });
});

// 404 handler for all other routes
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Resource not found', 
        message: `${req.method} ${req.originalUrl} not found` 
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled server error:', err);
    
    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    res.status(500).json({
        error: 'Internal server error',
        message: isDevelopment ? err.message : 'Something went wrong',
        ...(isDevelopment && { stack: err.stack })
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Weather API Server started`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
    console.log(`🧪 API Test: http://localhost:${PORT}/api/test`);
    console.log(`💚 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`🔑 API Key Configured: ${!!WEATHER_API_KEY}`);
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`\n📋 Available endpoints:`);
    console.log(`   GET /api/weather?location=<city> - Get weather data`);
    console.log(`   GET /api/test - Test API configuration`);
    console.log(`   GET /api/health - Health check`);
    console.log(`   GET /api/env - Environment info`);
    console.log(`\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

module.exports = app;