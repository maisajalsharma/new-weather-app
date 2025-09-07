#!/bin/bash

# Linux Weather Terminal - Quick Start Script

echo "🌤️  Linux Weather Terminal Setup"
echo "================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first:"
    echo "   https://nodejs.org/"
    exit 1
fi

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found. Please ensure all files are in the correct location."
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
    echo "✅ Dependencies installed successfully"
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found"
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo ""
    echo "🔑 IMPORTANT: You need to add your WeatherAPI key to the .env file"
    echo "   1. Go to https://www.weatherapi.com/ and sign up for free"
    echo "   2. Get your API key"
    echo "   3. Edit .env file and replace 'your_weatherapi_key_here' with your key"
    echo ""
    read -p "Press Enter after you've updated the .env file with your API key..."
fi

# Check if API key is configured
if grep -q "your_weatherapi_key_here" .env; then
    echo "⚠️  Please update your .env file with a real API key before starting"
    echo "   Current .env file still contains placeholder text"
    exit 1
fi

# Create public directory if it doesn't exist
if [ ! -d "public" ]; then
    echo "📁 Creating public directory..."
    mkdir public
fi

# Check if frontend file exists
if [ ! -f "public/index.html" ]; then
    echo "❌ public/index.html not found. Please ensure the frontend file is in the public/ directory."
    exit 1
fi

echo ""
echo "🚀 Starting the weather terminal server..."
echo "   Server will be available at: http://localhost:3000"
echo "   Press Ctrl+C to stop the server"
echo ""

# Start the server
npm start