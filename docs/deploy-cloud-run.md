# Deploy Backend to Google Cloud Run

This guide deploys `backend` (FastAPI) to Google Cloud Run using the Dockerfile at the repo root. It bundles the synthetic `data/` so the API works offline.

## Prerequisites
- Google Cloud project and billing enabled.
- gcloud CLI authenticated: `gcloud auth login && gcloud auth application-default login`.
- Set defaults: `gcloud config set project <PROJECT_ID>` and choose a region (e.g., `europe-west1`).

## Enable APIs
```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

## Build and Deploy (one command)
```bash
# From repo root
gcloud run deploy hydropulse-api \
  --source . \
  --region <REGION> \
  --set-env-vars FEEDBACK_PATH=/tmp/feedback.csv \
  --allow-unauthenticated
```
This uses Cloud Build to build the Dockerfile and deploys the service. Cloud Run expects the app on `PORT=8080` (already configured).

## Alternative: Prebuild then Deploy
```bash
# Build and push image
gcloud builds submit --tag gcr.io/<PROJECT_ID>/hydropulse-api:latest .

# Deploy the pushed image
gcloud run deploy hydropulse-api \
  --image gcr.io/<PROJECT_ID>/hydropulse-api:latest \
  --region <REGION> \
  --set-env-vars FEEDBACK_PATH=/tmp/feedback.csv \
  --allow-unauthenticated
```

## Verify
- Open the service URL from the deploy output.
- Health check: `GET <SERVICE_URL>/api/health` → `{ "status": "OK" }`.
- Docs: `<SERVICE_URL>/api/docs`.

## Notes
- Data & state: `data/` is packaged into the image for demos. Writes to `data/feedback.csv` are ephemeral per instance. For persistence, use Cloud Storage or a database.
- CORS: backend currently allows `*`. Restrict for production in `backend/main.py`.
- Scale & limits: adjust with flags (e.g., `--cpu=1 --memory=1Gi --max-instances=3 --min-instances=0`).

## Troubleshooting
- 404 on `.../locations/us/services/...`: use a valid region, e.g. `us-central1`, `us-east1`, `europe-west1`. List regions: `gcloud run regions list`.
- Permission errors writing `feedback.csv`: ensure `--set-env-vars FEEDBACK_PATH=/tmp/feedback.csv` is set (only `/tmp` is writable on Cloud Run).
