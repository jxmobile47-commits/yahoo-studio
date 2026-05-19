#!/bin/bash

# Yahoo Studio Local Development Backend Startup Script
# This script starts the Python backend for yt-dlp functionality in development

echo "🚀 Starting Yahoo Studio Local Development Backend"
echo "=================================================="

# Check if we're in the correct directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the Yahoo Studio root directory"
    exit 1
fi

# Check if Python backend directory exists
if [ ! -d "python_backend" ]; then
    echo "❌ Error: python_backend directory not found"
    echo "💡 This script requires the Python backend for yt-dlp functionality"
    echo "💡 For development, you can use QuickTube instead by setting:"
    echo "   NEXT_PUBLIC_AUDIO_STRATEGY=quicktube"
    exit 1
fi

# Navigate to Python backend
cd python_backend

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "🔧 Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Check if requirements are installed
if [ ! -f "venv/pyvenv.cfg" ] || [ ! -f "venv/lib/python*/site-packages/flask" ]; then
    echo "🔧 Installing Python dependencies..."
    pip install --upgrade pip
    pip install flask flask-cors yt-dlp
fi

# Set environment variables
export FLASK_ENV=development
export FLASK_DEBUG=true

# Start the Flask server
echo "🚀 Starting Flask server on port 5000..."
echo "📝 yt-dlp endpoints will be available at:"
echo "   - POST http://localhost:3000/api/ytdlp/extract"
echo "   - POST http://localhost:3000/api/ytdlp/download"
echo ""
echo "🔄 To stop the server, press Ctrl+C"
echo ""

# Create a minimal Flask app if app.py doesn't exist
if [ ! -f "app.py" ]; then
    echo "🔧 Creating minimal Flask app for yt-dlp..."
    cat > app.py << 'EOF'
from flask import Flask, request, jsonify
from flask_cors import CORS
import yt_dlp
import os

app = Flask(__name__)
CORS(app)

@app.route('/api/ytdlp/extract', methods=['POST'])
def extract_video_info():
    try:
        data = request.get_json()
        url = data.get('url')
        
        if not url:
            return jsonify({'success': False, 'error': 'URL is required'}), 400
        
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
        return jsonify({
            'success': True,
            'title': info.get('title', ''),
            'duration': info.get('duration', 0),
            'formats': [
                {
                    'format_id': f.get('format_id', ''),
                    'ext': f.get('ext', ''),
                    'quality': f.get('quality', 0),
                    'filesize': f.get('filesize', 0)
                }
                for f in info.get('formats', [])
                if f.get('acodec') != 'none'
            ][:5]  # Limit to first 5 audio formats
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/ytdlp/download', methods=['POST'])
def download_audio():
    try:
        data = request.get_json()
        url = data.get('url')
        
        if not url:
            return jsonify({'success': False, 'error': 'URL is required'}), 400
        
        # This is a simplified implementation
        # In practice, you'd want to implement actual download logic
        return jsonify({
            'success': False,
            'error': 'Download functionality not implemented in minimal backend'
        }), 501
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'service': 'yt-dlp-minimal'})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
EOF
fi

# Start the Flask app
python app.py
