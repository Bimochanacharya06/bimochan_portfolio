"""
Django settings for portfolio_ai project.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'change-this-in-production-please')

DEBUG = os.getenv('DEBUG', 'True') == 'True'

ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'chat',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'portfolio_ai.urls'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# CORS — allow your portfolio domain
CORS_ALLOWED_ORIGINS = os.getenv(
    'ALLOWED_ORIGINS',
    'http://localhost:3000,http://127.0.0.1:5500'
).split(',')

CORS_ALLOW_METHODS = ['POST', 'GET', 'OPTIONS']
CORS_ALLOW_HEADERS = ['content-type', 'x-requested-with']

# Rate limiting (simple in-memory, upgrade to redis for production)
CHAT_RATE_LIMIT_PER_IP = 30        # max requests
CHAT_RATE_LIMIT_WINDOW = 60 * 60   # per hour (seconds)
CHAT_MAX_MESSAGE_LENGTH = 500       # chars per user message
CHAT_MAX_HISTORY = 10               # messages kept in session

# Anthropic
ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY', '')
ANTHROPIC_MODEL = 'claude-sonnet-4-20250514'
ANTHROPIC_MAX_TOKENS = 600

STATIC_URL = '/static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
