import os
import time
import logging

from dotenv import load_dotenv
from flask import Flask

# Import the new app factory and utilities
from app_factory import create_app
from utils.logging import log_info, log_error, log_debug
from utils.model_utils import check_btc_availability

# Configure logging for production
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Set production mode based on environment
PRODUCTION_MODE = os.environ.get('FLASK_ENV', 'production') == 'production' or os.environ.get('PORT') is not None

# Load environment variables from .env file
try:
    load_dotenv()
    log_debug("Loaded environment variables from .env file")
except ImportError:
    log_debug("python-dotenv not available, using system environment variables only")

# Create Flask app using the application factory
app = create_app()

# Get the limiter from extensions for use in route decorators
from extensions import limiter

# Defer all heavy checks to runtime for faster startup
log_debug("Deferred model availability checks to runtime for faster startup")

# Check if BTC models are available at startup
try:
    BTC_AVAILABILITY = check_btc_availability()
    USE_BTC_SL = BTC_AVAILABILITY['sl_available']
    USE_BTC_PL = BTC_AVAILABILITY['pl_available']
    log_info(f"BTC-SL available: {USE_BTC_SL}, BTC-PL available: {USE_BTC_PL}")
except Exception as e:
    log_error(f"BTC availability check failed: {e}")
    BTC_AVAILABILITY = {'sl_available': False, 'pl_available': False}
    USE_BTC_SL = False
    USE_BTC_PL = False

# All routes are registered via blueprints in app_factory.py
# - beats blueprint: /api/detect-beats, /api/model-info, etc.
# - chords blueprint: /api/recognize-chords, /api/chord-model-info, etc.
# - stem blueprint: /api/stem/separate, /api/stem/status, etc.
# - lyrics blueprint: /api/lyrics/*
# - health blueprint: /, /api/health
# - docs blueprint: /api/docs

if __name__ == '__main__':
    # Default to port 5001 for localhost; production overrides with PORT env var
    port = int(os.environ.get('PORT', 5001))
    log_info(f"Starting Flask app on port {port}")
    log_info("App is ready to serve requests")
    app.run(host='0.0.0.0', port=port, debug=False)