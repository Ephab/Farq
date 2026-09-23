FROM python:3.12-slim
WORKDIR /app
COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/api/app ./app
COPY services/api/seed-roadmap.json ./seed-roadmap.json
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

