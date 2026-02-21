from django.urls import path
from .views import ChatView, HealthView

urlpatterns = [
    path('chat/', ChatView.as_view(), name='chat'),
    path('chat/health/', HealthView.as_view(), name='chat-health'),
]
