"""Пакет фоновых задач (Celery + RabbitMQ).

Задачи регистрируются в ``core.celery_app`` (см. его ``include``) и
исполняются воркером ``celery -A core.celery_app worker``.
"""
