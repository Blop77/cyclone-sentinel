# CycloneSentinel — Cloud Run image (API + static web app)
FROM python:3.12-slim
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY . .
ENV PORT=8080
CMD exec uvicorn server.main:app --host 0.0.0.0 --port ${PORT}
