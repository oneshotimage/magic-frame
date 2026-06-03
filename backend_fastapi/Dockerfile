FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

WORKDIR /app

COPY backend_fastapi/pyproject.toml ./backend_fastapi/pyproject.toml
COPY backend_fastapi ./backend_fastapi
COPY frontend/admin ./frontend/admin

RUN pip install --no-cache-dir \
    "fastapi>=0.116.0,<1.0.0" \
    "uvicorn>=0.35.0,<1.0.0" \
    "python-multipart>=0.0.20,<1.0.0" \
    "pymysql>=1.1.1,<2.0.0" \
    "cos-python-sdk-v5>=1.9.37,<2.0.0"

EXPOSE 8000

CMD ["sh", "-c", "uvicorn backend_fastapi.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
