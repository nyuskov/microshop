def get_app_options(
    host: str,
    port: int,
    workers: int,
) -> dict:
    return {
        "bind": f"{host}:{port}",
        "workers": workers,
        "worker_class": "uvicorn.workers.UvicornWorker",
    }
