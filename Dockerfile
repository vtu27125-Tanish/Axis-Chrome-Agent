FROM python:3.12-slim

WORKDIR /app

# System deps needed by cryptography / PyMySQL at build time
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    default-libmysqlclient-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run injects $PORT (defaults to 8080) — bind to it, not a fixed port.
ENV PORT=8080
EXPOSE 8080

CMD exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}
