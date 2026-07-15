# SAE Feature Dashboard

Multi-model Sparse Autoencoder (SAE) feature visualization dashboard.

This project compares SAE feature activations across several language models and
layers. A user enters a prompt in the React dashboard, selects up to three model
SAE configurations, and the FastAPI backend extracts residual-stream
activations, encodes them with SAELens, and returns global and per-token feature
reports.

For the complete source-to-production guide, current Kubernetes architecture,
Clash/GPFS/Sakura setup, and incident review, read
`SAE_WEB_DEPLOYMENT_WHITEPAPER.md`. Production deployment is Helm-managed;
`sae-demo-deploy.yaml` is deprecated and must not be applied.

All real model execution is expected to run inside the GPU pod. Local execution
is useful for reading code, editing the UI/API, and building images, but the
full TransformerLens / HuggingFace / SAELens path should be treated as pod-only.

---

## Current Project Scope

The repository now contains the main interactive dashboard only:

```text
Sparse_autoencoder_web/
├── backend/
│   ├── main.py              # FastAPI app, dependency detection, HTTP routes
│   ├── pipeline.py          # SAE analysis engine and mock fallback
│   ├── registry.py          # Model and SAE registry
│   ├── neuronpedia.py       # Optional Neuronpedia label lookup
│   ├── config.py            # Shared helpers and VRAM cleanup
│   ├── requirements.txt     # Backend Python dependencies
│   └── concept2token/       # Local feature_id -> label JSON files
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # Dashboard state and API calls
│   │   ├── constants.js     # API base, fallback model list, colors
│   │   ├── components/      # Controls, model columns, feature views
│   │   └── utils/
│   ├── Dockerfile           # Vite build + nginx static serving
│   ├── nginx.conf           # /api reverse proxy in K8s-style deployments
│   └── package.json
├── charts/sae-web/          # Production Helm Chart
├── deploy/                  # Independent Sakura frpc deployment
├── sae-demo-deploy.yaml     # Deprecated historical manifest; do not apply
├── SAE_WEB_DEPLOYMENT_WHITEPAPER.md
└── README.md
```

Files for other pod-side batch jobs have been removed from this main project.

---

## Runtime Model

The code supports two runtime modes:

- `real`: PyTorch + SAELens + TransformerLens or HuggingFace are available.
  The backend loads real models/SAEs and performs activation extraction.
- `mock`: a development-only compatibility mode for environments without the
  full ML stack.

The backend decides the mode at startup in `backend/main.py` and injects those
dependency flags into `backend/pipeline.py`.

Production sets `REQUIRE_CUDA=true` and `ALLOW_MOCK_FALLBACK=false`. A CUDA or
model failure must surface as an error and must never be disguised as plausible
mock output.

---

## Request Flow

```text
React UI
  |
  | GET /models
  | GET /
  v
FastAPI backend
  |
  | POST /analyze { prompt, selected_models, top_k }
  v
For each selected model, sequentially:
  |
  v
Resolve model config from registry.py + SAE cfg cache
  |
  +-- Path A: TransformerLens HookedTransformer.run_with_hooks()
  |
  +-- Path B: HuggingFace AutoModelForCausalLM + register_forward_hook()
      Used when TransformerLens cannot load the model
  |
  v
SAE.encode(residual_stream)
  |
  v
Build reports:
  - report_1_global: global fired feature summary
  - report_2_per_token: per-token top-50 feature firings
  |
  v
Clear model/SAE objects and CUDA cache before the next model
```

The backend processes selected models sequentially. This hot-swap strategy is
intentional because model and SAE weights are large and GPU memory is the main
constraint.

---

## Backend

Start the backend inside the pod:

```bash
cd /app/backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

For local smoke tests without GPU-scale models:

```bash
cd backend
pip install -r requirements.txt
python main.py
```

API endpoints:

- `GET /`: health check, dependency flags, and pipeline mode.
- `GET /models`: model registry exposed to the frontend.
- `POST /analyze`: run SAE feature extraction for 1-3 selected models.

Environment variables used by the backend:

- `HF_TOKEN`: HuggingFace token for gated models.
- `X-API-KEY`: optional Neuronpedia API key.
- `MODEL_PATH`: Hugging Face cache root (default `/root/.cache/huggingface`).
- `HTTP_PROXY` / `HTTPS_PROXY`: optional outbound proxy; the Kubernetes
  deployment points both to the Clash sidecar at `127.0.0.1:7890`.

Proxy values are supplied by the runtime environment and are not hardcoded in
the Python source.

---

## Frontend

Local development:

```bash
cd frontend
npm install
npm run dev
```

By default the frontend calls:

```text
http://localhost:8000
```

Override this with `VITE_API_BASE_URL`:

```bash
VITE_API_BASE_URL=http://<backend-host>:8000 npm run dev
```

Production-style build:

```bash
cd frontend
npm run build
```

The frontend Dockerfile builds the Vite app and serves it through nginx. In that
mode `VITE_API_BASE_URL` defaults to `/api`, and `frontend/nginx.conf` forwards
`/api/*` to `http://sae-backend-svc:8000/`. If you use that nginx config in K8s,
provide a matching backend Service named `sae-backend-svc`.

---

## GPU Deployment

Production is managed by the Helm Chart under `charts/sae-web`:

```bash
helm upgrade --install sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --wait --timeout 60m
```

The backend Pod contains the Python service and a Clash sidecar, requests one
exclusive GPU, 180Gi/200Gi RAM request/limit, and mounts the personal GPFS PVC
at `/root`. The production runtime is PyTorch 2.7.1 + CUDA 12.8 + cuDNN 9 with
Blackwell `sm_120` startup validation. The frontend is a separate lightweight
Nginx Pod. Public access is provided by the independent Sakura frpc Deployment.

See `DEPLOYMENT.md` and `SAE_WEB_DEPLOYMENT_WHITEPAPER.md`; do not apply the
deprecated `sae-demo-deploy.yaml`.

---

## Model Registry

Add or edit models in `backend/registry.py`.

Each registry entry should include:

```python
"model-key": {
    "display_name":  "Human Name",
    "sae_release":   "sae-release-or-hf-repo",
    "sae_id":        "path/or/id/inside/release",
    "hf_model_name": "org/base-model",
    "hook_point":    "blocks.N.hook_resid_post",
    "hook_layer":    N,
}
```

The backend also reads SAE cfg metadata at runtime and caches resolved configs.
Registry values such as `hf_model_name`, `hook_point`, and `hook_layer` take
priority over values discovered from `sae.cfg`.

Current registry families include:

- GPT-2 Small layers 4, 8, 11
- Gemma 3 layers 4, 8, 12
- Gemma-4 E2B layers 6, 17, 28
- Llama 3.2 1B layers 4, 8, 12
- Qwen 3.5 0.8B layers 5, 11, 17
- DeepSeek R1 Distill Qwen 1.5B layer 16

When adding a model, verify that the captured activation dimension matches the
SAE `d_in`. `pipeline.py` checks this before encoding and falls back to mock
data on failure.

---

## Concept Labels

The backend tries to label active SAE features in this order:

1. Local JSON under `backend/concept2token/`.
2. Neuronpedia API, when `np_model_id` and `np_sae_id` are configured.
3. Fallback label: `Concept {feature_id}`.

Local concept files are named like:

```text
backend/concept2token/<model-key>_concept_to_token.json
```

Each feature entry should provide at least:

```json
{
  "3045": {
    "top_bound_token": " token",
    "enrichment_score": 15.42,
    "avg_activation": 2.85,
    "firing_count": 42
  }
}
```

---

## Development Notes

- Keep real model execution on the pod.
- The frontend can be developed locally against a pod backend by setting
  `VITE_API_BASE_URL`.
- Development can explicitly enable mock fallback. Production sets
  `ALLOW_MOCK_FALLBACK=false`, so real execution failures return errors.
- `backend/registry.py` is the main extension point for supported models.
- `frontend/src/constants.js` contains fallback UI models used only when the
  backend model list cannot be fetched.
