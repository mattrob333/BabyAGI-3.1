# ============================================================
# Stage 1: Build the Next.js frontend
# ============================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ============================================================
# Stage 2: Python backend + serve frontend
# ============================================================
FROM python:3.12-slim

# Install Node.js for Next.js standalone server
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install uv for Python dependency management
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Copy Python project and install dependencies
COPY babyagi3/pyproject.toml babyagi3/uv.lock* ./babyagi3/
WORKDIR /app/babyagi3
RUN uv sync --no-dev --group telegram

# Copy backend source
COPY babyagi3/ ./

# Copy frontend build
WORKDIR /app
COPY --from=frontend-builder /app/web/.next/standalone ./web-standalone/
COPY --from=frontend-builder /app/web/.next/static ./web-standalone/.next/static
COPY --from=frontend-builder /app/web/public ./web-standalone/public

# Copy entrypoint script and fix Windows CRLF line endings
COPY start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

# Create data directory
RUN mkdir -p /data/.babyagi

ENV BABYAGI_DATA_DIR=/data/.babyagi
ENV BABYAGI_HOST=0.0.0.0
ENV BABYAGI_PORT=5000
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 5000 3000

CMD ["bash", "/app/start.sh"]
