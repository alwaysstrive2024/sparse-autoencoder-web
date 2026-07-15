# Blackwell CUDA 正式修复：续跑与部署手册

## 2026-07-15：SAELens 6 / Qwen 3.5 修复接管流程

### 当前正式状态

2026-07-15 已完成正式镜像构建、Harbor 推送与 Helm 部署：

```text
PyTorch 2.7.1 + CUDA 12.8
TransformerLens 3.5.1
SAELens 6.46.0
Transformers 5.13.1
runtime = sae-ml-runtime:torch2.7.1-cuda12.8-sae6-v2
backend = sae-backend:v1.1.0-sae6
Helm Release = sae-web Revision 7
Service = http -> 8000
```

新 Pod 已在 RTX PRO 6000 Blackwell 上通过 CUDA `sm_120`、Clash 外网、
GPFS 缓存和 GPT-2、Gemma 3、Llama 3.2、DeepSeek R1、Qwen 3.5 完整前后端
链路测试。旧的 8001/8002 临时进程已随旧 Pod 消失，现在可以正常重建
Pod，不再依赖任何 `/tmp` 热修复。

### Bug 根因与代码修复

1. SAELens 3.22 不识别新 SAE 仓库中的 `architecture: topk` 及嵌套
   metadata，Llama/DeepSeek 在构造 SAE 时失败。
2. Transformers 4.57.6 不识别 Qwen 3.5 的 `qwen3_5` 模型类。
3. DeepSeek SAE 训练于 `blocks.16.hook_resid_pre`，旧注册表却抓取
   `resid_post`。
4. GPT-2 未使用 SAE metadata 要求的 `center_writing_weights=True`，导致
   平均 L0 从正常的约 59 膨胀到 5531，虽然 HTTP 200，分析结果却失真。

本地源码已修复这四点，并锁定了上述现代依赖组合。

### 构建和推送新镜像

在仓库根目录执行：

```bash
export REGISTRY=harbor.aixiongan.org.cn:9443
export PROJECT=saeweb
export RUNTIME_IMAGE="$REGISTRY/$PROJECT/sae-ml-runtime:torch2.7.1-cuda12.8-sae6-v2"
export BACKEND_IMAGE="$REGISTRY/$PROJECT/sae-backend:v1.1.0-sae6"

docker buildx use sae-amd64-builder
docker buildx inspect --bootstrap

docker buildx build \
  --builder sae-amd64-builder \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  --progress=plain \
  -f backend/Dockerfile.runtime \
  -t "$RUNTIME_IMAGE" \
  --push \
  backend

docker buildx build \
  --builder sae-amd64-builder \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  --progress=plain \
  -f backend/Dockerfile \
  --build-arg ML_RUNTIME_IMAGE="$RUNTIME_IMAGE" \
  -t "$BACKEND_IMAGE" \
  --push \
  backend

docker buildx imagetools inspect "$RUNTIME_IMAGE"
docker buildx imagetools inspect "$BACKEND_IMAGE"
```

两个 inspect 结果都必须包含 `linux/amd64`。构建期会执行 `pip check`，并在
所有 Python 安装步骤后移除本项目不使用的 `torchvision`/`torchaudio`。

### 新镜像接管线上流量

当前 `charts/sae-web/values.yaml` 已锁定 `v1.1.0-sae6`。在新集群重新部署时，
确认 Harbor 中存在上述两个 Tag，然后执行：

```bash
helm lint charts/sae-web --strict

helm upgrade --install sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --force-conflicts \
  --wait \
  --timeout 60m
```

`--force-conflicts` 只用于这次接管：它让 Helm 收回被 `kubectl patch` 修改的
Service `targetPort` 字段，并恢复为命名端口 `http` → 容器 8000。不要手工
删 Pod/Service/Deployment；Helm 会自动替换 backend Pod。

部署后验证：

```bash
kubectl get pods -n gufy \
  -l app.kubernetes.io/instance=sae-web -o wide

kubectl get deploy sae-web-backend -n gufy \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="backend")].image}{"\n"}'

kubectl get svc sae-backend-svc -n gufy \
  -o jsonpath='{.spec.ports[0].targetPort}{"\n"}'

kubectl logs -n gufy deployment/sae-web-backend -c backend --tail=200
```

预期镜像 Tag 为 `v1.1.0-sae6`、Service `targetPort=http`、Pod `READY=2/2`。

如果新镜像在 Helm 之前就出现需要回退的临时问题，可将 Service 恢复到旧的
8000 进程：

```bash
kubectl patch svc sae-backend-svc -n gufy --type=json \
  -p='[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```

Helm 接管并创建新 Pod 后则使用 `helm history` + `helm rollback`，不要再依赖
旧 Pod 的 `/tmp` 热修复。

> 历史复盘文档：正式修复已经完成并上线。新部署请优先阅读
> `SAE_WEB_DEPLOYMENT_WHITEPAPER.md`；本文保留用于解释 Torch 2.2/cu121 到
> Torch 2.7.1/cu128 的迁移和紧急恢复过程。

本文记录 2026-07-14 已验证的正式修复流程。所有命令均在仓库根目录执行：

```bash
cd /Users/fuyugu/Desktop/1Aalwaysstrive2024/work/githubproj/Sparse_autoencoder_web
```

## 0. 2026-07-14 当时状态与结论（历史、已过期）

- 当前 Helm Release `sae-web` 仍为可用的 Revision 3。
- 当前 backend Pod 使用临时热修复：同容器内 Torch 2.7.1/cu128 监听 8001，
  Service 被手动改为转发到 8001。
- 临时环境已在 RTX PRO 6000 Blackwell Server Edition 上完成真实验证：
  `sm_120`、CUDA 矩阵乘法、GPT-2、TransformerLens、SAELens 均成功。
- 正式 runtime 已完成镜像构建和全部构建期检查，但在 Harbor `pushing layers`
  阶段按要求中止。重新执行相同命令会复用本机 BuildKit 缓存和 Harbor 已上传层。
- 没有任何模型权重进入镜像；模型仍在首次缓存缺失时下载到
  `/root/.cache/huggingface`。
- `HF_ENDPOINT` 已固定为官方地址 `https://huggingface.co`。

正式版本：

```text
runtime: harbor.aixiongan.org.cn:9443/saeweb/sae-ml-runtime:torch2.7.1-cuda12.8-v1
backend: harbor.aixiongan.org.cn:9443/saeweb/sae-backend:v1.0.1-blackwell
```

## 1. 应从原 DEPLOYMENT.md 哪一步继续

不需要从头执行。对应 `charts/sae-web/DEPLOYMENT.md`：

1. 第 1 步：只需重新导出变量；Docker 登录失效时才重新登录。
2. 第 2 步：只需选中已有 `sae-amd64-builder`。
3. 第 4 步：只重建/推送 runtime 和 backend，跳过 frontend。
4. 第 7、8 步：重新执行 Helm lint、render 和 dry-run。
5. 第 9 步：执行 Helm upgrade，让正式镜像替换临时 Pod。
6. 第 10、11 步：执行本文后面的正式验证。

以下步骤全部跳过：

- 第 3 步 Clash 镜像：已存在且已验证，无需重推。
- 第 4 步 frontend 镜像：没有变化，无需重推。
- 第 5 步 Clash 配置准备：`clashconfig/config.yaml` 已存在。
- 第 6 步 PVC/Secret 创建：PVC、`harbor-cred`、`sae-backend-secrets` 已存在。

## 2. 不需要删除或改名的内容

不要执行以下操作：

```text
helm uninstall sae-web
kubectl delete pod ...
kubectl delete deployment ...
kubectl delete pvc ...
kubectl apply -f sae-demo-deploy.yaml
```

也不要删除或覆盖旧镜像 Tag。旧 runtime/backend 保留用于审计和紧急回滚。
新的 Tag 是不可变的新版本，不会覆盖旧版本。

Harbor 中可能存在未完成推送留下的分层 blob，不需要手动删除。重新推送会按
digest 复用；真正无引用的 blob 以后由 Harbor 管理员执行垃圾回收即可。

## 3. 导出变量并确认 Builder

```bash
export REGISTRY=harbor.aixiongan.org.cn:9443
export PROJECT=saeweb
export RUNTIME_IMAGE="$REGISTRY/$PROJECT/sae-ml-runtime:torch2.7.1-cuda12.8-v1"
export BACKEND_IMAGE="$REGISTRY/$PROJECT/sae-backend:v1.0.1-blackwell"

echo "$RUNTIME_IMAGE"
echo "$BACKEND_IMAGE"

docker buildx use sae-amd64-builder
docker buildx inspect --bootstrap
```

若 Docker 登录已过期：

```bash
export HARBOR_USERNAME='<你的 Harbor 用户名>'
read -s HARBOR_PASSWORD
printf '%s' "$HARBOR_PASSWORD" | docker login "$REGISTRY" \
  --username "$HARBOR_USERNAME" --password-stdin
unset HARBOR_PASSWORD
```

## 4. 重新执行 runtime 构建与推送

直接重新运行完整命令。不要加 `--no-cache`，这样才能复用刚才已完成的构建层：

```bash
docker buildx build \
  --builder sae-amd64-builder \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  --progress=plain \
  -f backend/Dockerfile.runtime \
  -t "$RUNTIME_IMAGE" \
  --push \
  backend
```

已知 Harbor 上行较慢，`pushing layers` 长时间没有新输出属于正常情况。不要因为
静默而按 Ctrl+C。若网络错误导致失败，原样重跑同一命令，不换 Tag、不清缓存。

成功后确认远端为 AMD64：

```bash
docker buildx imagetools inspect "$RUNTIME_IMAGE"
```

结果必须包含：

```text
Platform: linux/amd64
```

## 5. 构建并推送正式 backend

runtime 推送成功后才能执行：

```bash
docker buildx build \
  --builder sae-amd64-builder \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  --progress=plain \
  -f backend/Dockerfile \
  --build-arg ML_RUNTIME_IMAGE="$RUNTIME_IMAGE" \
  -t "$BACKEND_IMAGE" \
  --push \
  backend
```

该 Dockerfile 会在最后一次 Python 安装后执行：

```dockerfile
RUN python -m pip uninstall -y torchvision torchaudio \
    && python -m pip check
```

成功后确认：

```bash
docker buildx imagetools inspect "$BACKEND_IMAGE"
```

同样必须包含 `linux/amd64`。

## 6. 正式部署前检查

仓库已经写好以下正式配置，不需要再手工修改 Tag：

```text
backend image       = sae-backend:v1.0.1-blackwell
backend targetPort  = http（容器 8000）
HF_ENDPOINT         = https://huggingface.co
REQUIRE_CUDA        = true
ALLOW_MOCK_FALLBACK = false
cluster domain      = k8s.aiplat
```

执行：

```bash
helm lint charts/sae-web --strict

helm template sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  > /tmp/sae-web-blackwell.yaml

kubectl create --dry-run=client --validate=false \
  -f /tmp/sae-web-blackwell.yaml -o name

helm upgrade --install sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --dry-run=client --debug > /tmp/sae-web-helm-dry-run.txt
```

dry-run 输出包含 Clash ConfigMap 内容，因此重定向到 `/tmp`，不要把该文件提交
Git 或复制到聊天记录。

## 7. 正式 Helm Upgrade

确认两个远端镜像均可 inspect 后执行：

```bash
helm upgrade --install sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --wait \
  --timeout 60m
```

若曾用 `kubectl patch` 把 `sae-backend-svc.targetPort` 临时改成 8001，Helm 4
Server-Side Apply 可能报告字段归 `kubectl-patch` 所有。不要删除 Service；只在
第一次恢复正式端口时给同一命令增加 `--force-conflicts`。Revision 5 已完成字段
所有权接管，后续正常 upgrade 不再需要该参数。

另开终端观察：

```bash
kubectl get pods -n gufy -w
```

预期行为：

- 后端使用一张独占 GPU 和 `Recreate` 策略，因此旧热修复 Pod 会由 Deployment
  自动删除，再创建正式 Pod；这里会有一次短暂后端中断。
- 不要手工删除旧 Pod。
- 前端镜像和 PodTemplate 没变化，正常情况下前端 Pod 不重建。
- 新镜像首次拉取可能较久。Chart 已把 `progressDeadlineSeconds` 调整为 3600，
  与 Helm 的 60 分钟等待时间一致。
- 新 Pod 创建后，临时 `/tmp/torch-cu128-test`、8001 进程和 watchdog 会自动随
  旧 Pod 消失；Service 由 Helm 自动恢复到正式容器的 8000 端口。

## 8. 部署后必须逐项验证

### 8.1 Release、Pod、镜像和端口

```bash
helm status sae-web -n gufy
kubectl get pods -n gufy -l app.kubernetes.io/instance=sae-web -o wide
kubectl get deployment sae-web-backend -n gufy \
  -o jsonpath='{.spec.template.spec.containers[?(@.name=="backend")].image}{"\n"}'
kubectl get service sae-backend-svc -n gufy \
  -o jsonpath='{.spec.ports[0].targetPort}{"\n"}'
```

预期：

```text
sae-backend:v1.0.1-blackwell
targetPort=http
backend Pod READY=2/2
```

### 8.2 启动期 CUDA 强制检查

```bash
kubectl logs -n gufy deployment/sae-web-backend -c backend --tail=200
```

必须出现类似：

```text
[STARTUP] CUDA validation passed: torch=2.7.1+cu128 cuda=12.8 ... capability=(12, 0)
```

再执行独立核验：

```bash
kubectl exec -n gufy deployment/sae-web-backend -c backend -- python -c \
  "import torch; cap=torch.cuda.get_device_capability(0); arches=torch.cuda.get_arch_list(); print(torch.__version__, torch.version.cuda, torch.cuda.get_device_name(0), cap, arches); assert cap == (12, 0); assert 'sm_120' in arches; x=torch.ones((64,64), device='cuda'); y=x@x; torch.cuda.synchronize(); print('CUDA_MATMUL_OK', y.shape)"
```

### 8.3 确认 Hugging Face 官网和 Clash

```bash
kubectl exec -n gufy deployment/sae-web-backend -c backend -- sh -c \
  'echo "$HF_ENDPOINT"; test "$HF_ENDPOINT" = "https://huggingface.co"'

kubectl exec -n gufy deployment/sae-web-backend -c backend -- python -c \
  "import requests; r=requests.get('https://huggingface.co', timeout=30); print(r.status_code, r.url); r.raise_for_status()"
```

### 8.4 真实前端到 GPU 全链路

如果本机 8080 尚未被 port-forward 占用，在新终端执行：

```bash
kubectl port-forward -n gufy service/sae-frontend-svc 8080:80
```

另一个终端执行：

```bash
curl -fsS --max-time 300 \
  -X POST http://127.0.0.1:8080/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Apple announced the iPhone 18 at WWDC.","selected_models":["gpt2-small-l11"],"top_k":10}' \
  -o /tmp/sae-blackwell-result.json

python3 -c 'import json; d=json.load(open("/tmp/sae-blackwell-result.json")); print(d["metadata"]["pipeline_mode"], d["metadata"]["selected_models"])'
```

预期：

```text
real ['gpt2-small-l11']
```

检查真实日志：

```bash
kubectl logs -n gufy deployment/sae-web-backend -c backend --tail=400 | \
  grep -E 'CUDA validation|\[REAL|PATH-A|FALLBACK|CUDA error|POST /analyze'
```

必须看到 `[REAL]`、`PATH-A`、HTTP 200；不得出现 `CUDA error` 或 mock fallback。
生产配置已设置 `ALLOW_MOCK_FALLBACK=false`，真实 pipeline 失败会返回错误，不会
再用看似成功的模拟数据掩盖故障。

## 9. 常见故障恢复

### runtime/backend push 网络失败

原样重跑失败的 `docker buildx build ... --push` 命令。不要清 BuildKit 缓存、不要
换 Tag、不要先删除 Harbor 仓库内容。

### `ErrImagePull` / `ImagePullBackOff`

```bash
kubectl describe pod -n gufy -l app.kubernetes.io/component=backend
docker buildx imagetools inspect "$BACKEND_IMAGE"
kubectl get secret harbor-cred -n gufy
```

修复 Tag 或完成镜像推送后重新执行同一条 `helm upgrade --install`，无需手动删 Pod。

### Helm 超时

先不要卸载 Release：

```bash
helm status sae-web -n gufy
kubectl get pods -n gufy -o wide
kubectl describe pod -n gufy -l app.kubernetes.io/component=backend
kubectl logs -n gufy deployment/sae-web-backend -c backend --tail=300
kubectl logs -n gufy deployment/sae-web-backend -c clash --tail=300
```

根据具体事件修复后，再重复正式 Helm Upgrade 命令。

### 新版本必须紧急回滚

先查看历史：

```bash
helm history sae-web -n gufy
```

当前旧版本为 Revision 3；若历史没有变化，可执行：

```bash
helm rollback sae-web 3 -n gufy --wait --timeout 60m
```

注意：Revision 3 的正式镜像不支持 Blackwell，只能作为紧急恢复 API/前端的手段，
不能作为真实 GPU 推理的最终状态。不要删除 PVC，模型缓存不会因 Helm 回滚丢失。

## 10. 本次工程修复涉及的文件

```text
backend/Dockerfile.runtime
backend/Dockerfile
backend/requirements-runtime.txt
backend/main.py
backend/pipeline.py
charts/sae-web/values.yaml
charts/sae-web/templates/backend-deployment.yaml
charts/sae-web/DEPLOYMENT.md
deploy_fix.md
```

关键安全行为：

- Torch 2.7.1 + CUDA 12.8 + cuDNN 9，适配 Blackwell `sm_120`。
- runtime/app 两层都在所有 Python 安装完成后移除 torchvision/torchaudio 并
  执行 `pip check`。
- Pod 启动时执行真实 CUDA 矩阵运算，不兼容时拒绝 Ready。
- 生产环境禁止 mock fallback。
- Hugging Face 固定官方域名。
- PVC、Secret、Clash ConfigMap 和模型权重均不进入镜像。
