# Cloud Run Job image for the scheduling engine.
#   gcloud run jobs deploy toranut-solver --source solver --region me-west1 \
#     --set-secrets DATABASE_URL=toranut-db-url:latest --memory 4Gi --cpu 4 --task-timeout 1800
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
COPY toranut_solver ./toranut_solver
RUN pip install --no-cache-dir ".[worker]"

USER 65534
CMD ["python", "-m", "toranut_solver.worker"]
