@echo off
title Linux Weather Terminal Setup

echo 🌤️  Linux Weather Terminal Setup
echo ================================

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js first:
    echo    https://nodejs.org/
    pause
    exit /b 1
)

REM Check if package.json exists
if not exist package.json (
    echo ❌ package.json not found. Please ensure all files are in the correct location.
    pause
    exit /b 1
)

REM Install dependencies if node_modules doesn't exist
if not exist node_modules (
    echo 📦 Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ❌ Failed to install dependencies
        pause
        exit /b 1
    )
    echo ✅ Dependencies installed successfully
)

REM Check if .env file exists
if not exist .env (
    echo ⚠️  .env file not found
    echo 📝 Creating .env file from template...
    copy .env.example .env
    echo.
    echo 🔑 IMPORTANT: You need to add your WeatherAPI key to the .env file
    echo    1. Go to https://www.weatherapi.com/ and sign up for free
    echo    2. Get your API key
    echo    3. Edit .env file and replace 'your_weatherapi_key_here' with your key
    echo.
    pause
)

REM Check if API key is configured
findstr "your_weatherapi_key_here" .env >nul
if not errorlevel 1 (
    echo ⚠️  Please update your .env file with a real API key before starting
    echo    Current .env file still contains placeholder text
    pause
    exit /b 1
)

REM Create public directory if it doesn't exist
if not exist public mkdir public

REM Check if frontend file exists
if not exist public\index.html (
    echo ❌ public\index.html not found. Please ensure the frontend file is in the public\ directory.
    pause
    exit /b 1
)

echo.
echo 🚀 Starting the weather terminal server...
echo    Server will be available at: http://localhost:3000
echo    Press Ctrl+C to stop the server
echo.

REM Start the server
npm start

pause