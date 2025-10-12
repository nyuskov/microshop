from core.gunicorn import Application, get_app_options
from main import app as main_app


def main():
    app = Application(
        application=main_app,
        options=get_app_options(
            host="0.0.0.0",
            port=8000,
            workers=1,
        ),
    )
    app.run()


if __name__ == "__main__":
    main()
