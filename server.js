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

// Debug middleware to log all requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Weather API configuration
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const WEATHER_API_URL = 'https://api.weatherapi.com/v1/current.json';

// Debug: Log API key status on startup
console.log('=== API Configuration Debug ===');
console.log('API Key present:', !!WEATHER_API_KEY);
console.log('API Key length:', WEATHER_API_KEY ? WEATHER_API_KEY.length : 0);
console.log('API Key first 4 chars:', WEATHER_API_KEY ? WEATHER_API_KEY.substring(0, 4) + '...' : 'None');
console.log('API URL:', WEATHER_API_URL);

// Rate limiting (simple in-memory store)
const rateLimitStore = new Map();
const RATE_LIMIT = 100; // requests per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

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
    
    // Allow letters, numbers, spaces, hyphens, apostrophes, commas, and basic punctuation
    const validPattern = /^[a-zA-Z0-9\s\-'.,()]+$/;
    if (!validPattern.test(sanitized)) {
        return { valid: false, reason: 'Location contains invalid characters' };
    }
    
    return { valid: true, sanitized };
}

// Weather API endpoint with extensive debugging
app.get('/api/weather', rateLimit, async (req, res) => {
    console.log('\n=== Weather API Request Debug ===');
    console.log('Query parameters:', req.query);
    
    try {
        const { location } = req.query;
        
        // Validate input
        const validation = validateLocationInput(location);
        if (!validation.valid) {
            console.log('Validation failed:', validation.reason);
            return res.status(400).json({
                error: 'Invalid location',
                message: validation.reason
            });
        }
        
        const sanitizedLocation = validation.sanitized;
        console.log('Sanitized location:', sanitizedLocation);
        
        // Check if API key is configured
        if (!WEATHER_API_KEY) {
            console.error('❌ Weather API key not configured');
            return res.status(500).json({
                error: 'Service unavailable',
                message: 'Weather service is not properly configured - API key missing'
            });
        }
        
        // Build API URL
        const apiUrl = `${WEATHER_API_URL}?key=${WEATHER_API_KEY}&q=${encodeURIComponent(sanitizedLocation)}&aqi=no`;
        console.log('Making request to WeatherAPI.com...');
        console.log('URL (without API key):', `${WEATHER_API_URL}?q=${encodeURIComponent(sanitizedLocation)}&aqi=no`);
        
        // Make request to weather API with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(apiUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Weather-Terminal/1.0'
            }
        });
        
        clearTimeout(timeoutId);
        
        console.log('WeatherAPI Response Status:', response.status);
        console.log('WeatherAPI Response Headers:', Object.fromEntries(response.headers.entries()));
        
        // Get response text first to debug
        const responseText = await response.text();
        console.log('Raw response length:', responseText.length);
        console.log('Response starts with:', responseText.substring(0, 100));
        
        if (!response.ok) {
            console.error('❌ WeatherAPI HTTP error:', response.status, response.statusText);
            
            if (response.status === 400) {
                return res.status(404).json({
                    error: 'Location not found',
                    message: 'Could not find weather data for the specified location. Please check the spelling and try again.'
                });
            }
            
            if (response.status === 401) {
                console.error('❌ Invalid API key - check your .env file');
                return res.status(500).json({
                    error: 'Service error',
                    message: 'Invalid API key configuration'
                });
            }
            
            if (response.status === 403) {
                console.error('❌ API key quota exceeded or access forbidden');
                return res.status(500).json({
                    error: 'Service error',
                    message: 'API quota exceeded or access forbidden'
                });
            }
            
            throw new Error(`WeatherAPI returned ${response.status}: ${response.statusText}`);
        }
        
        // Try to parse JSON
        let weatherData;
        try {
            weatherData = JSON.parse(responseText);
        } catch (parseError) {
            console.error('❌ Failed to parse JSON response:', parseError.message);
            console.error('Response text:', responseText);
            throw new Error('Invalid JSON response from weather service');
        }
        
        console.log('✅ Successfully parsed weather data');
        
        // Check for API error in response
        if (weatherData.error) {
            console.error('❌ WeatherAPI error response:', weatherData.error);
            return res.status(404).json({
                error: 'Location not found',
                message: weatherData.error.message || 'Location not found in weather database'
            });
        }
        
        // Validate required data structure
        if (!weatherData.location || !weatherData.current) {
            console.error('❌ Invalid weather data structure:', Object.keys(weatherData));
            throw new Error('Invalid weather data structure received from API');
        }
        
        console.log('✅ Weather data for:', weatherData.location.name, weatherData.location.country);
        
        // Return successful response
        const responseData = {
            location: {
                name: weatherData.location.name,
                region: weatherData.location.region,
                country: weatherData.location.country,
                lat: weatherData.location.lat,
                lon: weatherData.location.lon,
                tz_id: weatherData.location.tz_id,
                localtime: weatherData.location.localtime
            },
            current: {
                temp_c: weatherData.current.temp_c,
                temp_f: weatherData.current.temp_f,
                feelslike_c: weatherData.current.feelslike_c,
                feelslike_f: weatherData.current.feelslike_f,
                condition: {
                    text: weatherData.current.condition.text
                },
                humidity: weatherData.current.humidity,
                pressure_mb: weatherData.current.pressure_mb,
                pressure_in: weatherData.current.pressure_in,
                vis_km: weatherData.current.vis_km,
                vis_miles: weatherData.current.vis_miles,
                wind_kph: weatherData.current.wind_kph,
                wind_mph: weatherData.current.wind_mph,
                wind_degree: weatherData.current.wind_degree,
                wind_dir: weatherData.current.wind_dir,
                uv: weatherData.current.uv,
                cloud: weatherData.current.cloud,
                precip_mm: weatherData.current.precip_mm,
                precip_in: weatherData.current.precip_in,
                last_updated: weatherData.current.last_updated
            }
        };
        
        res.json(responseData);
        
    } catch (error) {
        console.error('\n❌ Weather API Error:', error.message);
        console.error('Error stack:', error.stack);
        
        if (error.name === 'AbortError') {
            return res.status(504).json({
                error: 'Request timeout',
                message: 'Weather service request timed out. Please try again.'
            });
        }
        
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            return res.status(503).json({
                error: 'Service unavailable',
                message: 'Unable to connect to weather service. Please try again later.'
            });
        }
        
        res.status(500).json({
            error: 'Service error',
            message: 'Unable to fetch weather data at this time',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Test endpoint to verify API key
app.get('/api/test', async (req, res) => {
    console.log('\n=== API Test Endpoint ===');
    
    if (!WEATHER_API_KEY) {
        return res.json({
            status: 'error',
            message: 'API key not configured',
            hasApiKey: false
        });
    }
    
    try {
        const testUrl = `${WEATHER_API_URL}?key=${WEATHER_API_KEY}&q=London&aqi=no`;
        console.log('Testing API key with London...');
        
        const response = await fetch(testUrl);
        const data = await response.text();
        
        res.json({
            status: response.ok ? 'success' : 'error',
            httpStatus: response.status,
            hasApiKey: true,
            apiKeyLength: WEATHER_API_KEY.length,
            responseLength: data.length,
            responsePreview: data.substring(0, 200)
        });
        
    } catch (error) {
        res.json({
            status: 'error',
            message: error.message,
            hasApiKey: true
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        api_key_configured: !!WEATHER_API_KEY,
        node_env: process.env.NODE_ENV || 'development'
    });
});

// Serve frontend
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    console.log('Serving index.html from:', indexPath);
    res.sendFile(indexPath);
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('\n❌ Server Error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: 'Something went wrong on our end',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    console.log('404 - Resource not found:', req.url);
    res.status(404).json({
        error: 'Not found',
        message: 'The requested resource was not found',
        url: req.url
    });
});

app.listen(PORT, () => {
    console.log('\n🌤️ ==========================================');
    console.log('   Weather API Server Starting...');
    console.log('🌤️ ==========================================');
    console.log(`🚀 Server running on: http://localhost:${PORT}`);
    console.log(`🔗 Frontend URL: http://localhost:${PORT}`);
    console.log(`🛡️  API endpoint: http://localhost:${PORT}/api/weather`);
    console.log(`🧪 Test endpoint: http://localhost:${PORT}/api/test`);
    console.log(`🔑 API key status: ${WEATHER_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    
    if (WEATHER_API_KEY) {
        console.log(`🔑 API key length: ${WEATHER_API_KEY.length} characters`);
        console.log(`🔑 API key preview: ${WEATHER_API_KEY.substring(0, 8)}...`);
    }
    
    console.log('🌤️ ==========================================\n');
});

if (!WEATHER_API_KEY) {
    console.error('\n⚠️  ==========================================');
    console.error('   WARNING: API KEY NOT CONFIGURED');
    console.error('⚠️  ==========================================');
    console.error('❌ WEATHER_API_KEY environment variable not set');
    console.error('📝 Create a .env file with:');
    console.error('   WEATHER_API_KEY=your_api_key_here');
    console.error('🔗 Get a free API key from: https://www.weatherapi.com/');
    console.error('⚠️  ==========================================\n');
}

module.exports = app;