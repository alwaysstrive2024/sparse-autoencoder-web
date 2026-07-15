# syntax=docker/dockerfile:1.7

# 产品镜像只叠加轻量 Web 依赖和源码。共享 runtime 必须先以 linux/amd64 构建
# 并推送到 Harbor；也可通过 --build-arg ML_RUNTIME_IMAGE=... 指定测试版本。
ARG ML_RUNTIME_IMAGE=harbor.aixiongan.org.cn:9443/saeweb/sae-ml-runtime:torch2.7.1-cuda12.8-sae6-v2
FROM ${ML_RUNTIME_IMAGE}

LABEL org.opencontainers.image.title="SAE web backend"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_PATH=/root/.cache/huggingface \
    HF_HOME=/root/.cache/huggingface

WORKDIR /app

# FastAPI 等小依赖与 ML 大环境分层；修改 API 依赖时不会重新上传 PyTorch/CUDA。
COPY requirements-app.txt ./
RUN python -m pip install --no-cache-dir -r requirements-app.txt

# 即使共享 runtime 已清理过，也必须在本 Dockerfile 的最后一次 pip install 后
# 再次执行仓库不变量，防止应用依赖间接带回不匹配的包。
RUN python -m pip uninstall -y torchvision torchaudio \
    && python -m pip check

RUN python -c "import fastapi, uvicorn, pydantic, dotenv, requests; import torch, transformers, transformer_lens, sae_lens; print('backend dependency import check: OK')"

# .dockerignore 会阻止模型权重、重复 concept 数据和本地缓存进入镜像。
COPY . .

EXPOSE 8000

# 必须监听所有容器网卡；生产环境禁用 reload。
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
