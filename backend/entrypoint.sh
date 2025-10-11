#!/bin/sh

if [ "$DB_NAME" = "microshop" ]
then
    echo "Waiting for postgres..."

    while ! nc -z $DB_HOST $DB_PORT; do
      sleep 0.1
    done

    echo "PostgreSQL started"
fi

poetry run alembic -x DATABASE_UTL=$DB_URL upgrade head

exec "$@"