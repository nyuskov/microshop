"""Событийный WebSocket-канал мессенджера (push вместо поллинга).

Подключение: ``/api/v1/ws/events?token=<jwt>``.
Сервер пушит события ``message.new`` / ``message.changed`` / ``chat.new`` /
``chat.read`` / ``presence``; клиент по событию делает выборочный refetch.
"""
