# 从零开始部署 SAE Web Helm Release

> 本文是应用 Helm Release 的精简操作手册。完整原理、源码说明、所有事故复盘、
> 当前 Sakura 公网入口与日常运维见仓库根目录
> `SAE_WEB_DEPLOYMENT_WHITEPAPER.md`。当前阶段 A 公网入口不使用 Ingress，而由
> 独立 `sae-sakura-frpc` Deployment 直接访问 `sae-frontend-svc`。

这份流程假设：

- Kubernetes namespace 已由管理员创建，例如 `gufy`；
- GPU 节点装有 NVIDIA 驱动、NVIDIA Container Toolkit 和设备插件；
- 管理员已经创建个人 GPFS PVC；Chart 只引用它，不创建或修改 PVC；
- Harbor 项目为 `harbor.aixiongan.org.cn:9443/saeweb`；
- 所有构建产物必须是 `linux/amd64`。

不要同时使用根目录的 `sae-demo-deploy.yaml` 和 Helm 管理同一套资源。采用 Helm
后，只使用 `helm upgrade --install`，避免两个管理者相互覆盖 Deployment。

## 第 1 步：设置镜像变量并登录 Harbor

```bash
cd /path/to/Sparse_autoencoder_web

export REGISTRY=harbor.aixiongan.org.cn:9443
export PROJECT=saeweb
export RUNTIME_TAG=torch2.7.1-cuda12.8-sae6-v2
export BACKEND_TAG=v1.1.0-sae6
export FRONTEND_TAG=v1.0.0

export RUNTIME_IMAGE="$REGISTRY/$PROJECT/sae-ml-runtime:$RUNTIME_TAG"
export BACKEND_IMAGE="$REGISTRY/$PROJECT/sae-backend:$BACKEND_TAG"
export FRONTEND_IMAGE="$REGISTRY/$PROJECT/sae-frontend:$FRONTEND_TAG"
export CLASH_IMAGE="$REGISTRY/$PROJECT/clash:verified-amd64-v1"

export HARBOR_USERNAME='<你的用户名>'
read -s HARBOR_PASSWORD
printf '%s' "$HARBOR_PASSWORD" | docker login "$REGISTRY" \
  --username "$HARBOR_USERNAME" --password-stdin
unset HARBOR_PASSWORD
```

## 第 2 步：准备 AMD64 Buildx

首次执行：

```bash
docker buildx create --name sae-amd64-builder --driver docker-container --use
docker buildx inspect --bootstrap
```

如果 builder 已存在：

```bash
docker buildx use sae-amd64-builder
docker buildx inspect --bootstrap
```

## 第 3 步：构建并推送自有 Clash 二进制镜像

`clashconfig/clash` 是已验证的静态 Linux AMD64 二进制；Dockerfile 使用 Ubuntu
22.04，预装 curl、dig、ping、ip、nc、ps、jq、bash、CA 和 tini，并把
Country.mmdb 一起封装。真实 config.yaml 被 `.dockerignore` 排除，不会进入
Docker builder 或镜像：

真实 Clash 配置使用了 GEOIP 规则，而 6MiB 左右的 `Country.mmdb` 超过 ConfigMap
大小上限。因此专用 Sidecar 镜像只烘焙 Country.mmdb，不烘焙敏感 config.yaml：

```bash
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -f clashconfig/Dockerfile \
  -t "$CLASH_IMAGE" \
  --push clashconfig
```

## 第 4 步：依次构建并推送三个应用镜像

共享 CUDA/ML runtime 必须最先成功，因为后端 `FROM` 它：

```bash
docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -f backend/Dockerfile.runtime \
  -t "$RUNTIME_IMAGE" \
  --push backend

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -f backend/Dockerfile \
  --build-arg ML_RUNTIME_IMAGE="$RUNTIME_IMAGE" \
  -t "$BACKEND_IMAGE" \
  --push backend

docker buildx build \
  --platform linux/amd64 \
  --provenance=false \
  --sbom=false \
  -f frontend/Dockerfile \
  -t "$FRONTEND_IMAGE" \
  --push frontend
```

确认全部是 AMD64：

```bash
docker buildx imagetools inspect "$RUNTIME_IMAGE"
docker buildx imagetools inspect "$BACKEND_IMAGE"
docker buildx imagetools inspect "$FRONTEND_IMAGE"
docker buildx imagetools inspect "$CLASH_IMAGE"
```

每个结果都必须包含 `linux/amd64`。

## 第 5 步：准备根目录 Clash 配置

真实配置位于 `clashconfig/config.yaml`，该文件已被 `.gitignore` 排除。如果尚未
创建，可执行：

```bash
mkdir -p clashconfig
cp clash-config.example.yaml clashconfig/config.yaml
```

编辑 `clashconfig/config.yaml`，把订阅 URL 或代理节点占位符替换为真实值。

Helm 使用：

```bash
--set-file clash.config.content=./clashconfig/config.yaml
```

把文件内容注入 values，随后 `clash-configmap.yaml` 将多行字符串写入 ConfigMap
的 `data.config.yaml`。Kubernetes 挂载 ConfigMap 后，它会在 Sidecar 内表现为：

```text
/etc/clash/config.yaml
```

ConfigMap 不加密，拥有 namespace ConfigMap 读取权限的人能看到内容。若配置含
敏感节点密码，应在下一版模板中切换为 Secret。单个 ConfigMap 总大小也不能
超过约 1MiB，因此更推荐保存订阅 provider URL，而不是粘贴巨大节点列表。

订阅 URL 必须能在没有现成代理节点的情况下首次访问；否则 Clash 无法下载用来
建立代理的节点配置，应改用已展开的静态 `proxies` 配置。

## 第 6 步：确认模型存储和 Kubernetes Secrets

Chart 默认引用当前集群已经存在的个人 GPFS：

```bash
kubectl get pvc pvc-gpfshome-gufy -n gufy
```

必须显示 `Bound`。默认 values 为：

```yaml
backend:
  modelStorage:
    type: existingClaim
    existingClaim: pvc-gpfshome-gufy
```

这里只是让 Pod 引用现有 PVC，Helm 不会创建、修改或删除它。PVC 不存在时，
Pod 会停在 `Pending`/`FailedMount`，`helm --wait` 最终超时，但不会丢失数据。

如果管理员暂时不允许挂载 PVC，可在安装前把 `type` 改成 `emptyDir`：

```yaml
backend:
  modelStorage:
    type: emptyDir
```

`emptyDir` 在同一 Pod 的容器 OOM 重启后仍存在，但 Pod 删除、升级或重新调度后
会清空。Kubernetes 不支持 PVC 缺失时自动退回 emptyDir。

确认 namespace：

```bash
kubectl get namespace gufy
```

当前 namespace 已有 `harbor-cred`，先确认，不要重复创建：

```bash
kubectl get secret harbor-cred -n gufy
```

本地 `backend/.env` 不会被复制到镜像或 Pod。用它创建统一后端 Secret，保存
`HF_TOKEN` 和 `X-API-KEY`；命令不会把值打印到终端：

```dotenv
HF_TOKEN=你的值
X-API-KEY=你的值
```

键名与 `=` 之间不能有空格；`HF_TOKEN =...` 会被 kubectl 当成末尾带空格的
非法键名。

```bash
kubectl create secret generic sae-backend-secrets \
  --namespace gufy \
  --from-env-file=backend/.env \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl get secret sae-backend-secrets -n gufy \
  -o go-template='{{range $k,$v := .data}}{{$k}}{{"\n"}}{{end}}'
```

第二条命令只应显示键名 `HF_TOKEN` 和 `X-API-KEY`，不要执行 `kubectl get ...
-o yaml`，以免把 Base64 编码后的 Secret 输出到终端记录。

Clash 不需要额外 Secret，也不执行 `kubectl cp`：二进制和 `Country.mmdb` 已在
Clash 镜像中，`config.yaml` 由第 5 步的 `--set-file` 创建为 ConfigMap 并挂载。

当前固定使用 `HF_ENDPOINT=https://huggingface.co` 官方站点，所有外网流量通过
同 Pod Clash Sidecar 出口；不要改成第三方镜像，以免 Token 被发送给非官方域名。

## 第 7 步：Helm 本地检查

```bash
helm lint charts/sae-web --strict

helm template sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --debug
```

应看到五类资源：ConfigMap、前后端 Deployment、前后端 Service。

## 第 8 步：执行安装前 dry-run

```bash
helm upgrade --install sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --dry-run=client --debug
```

确认镜像、Tag、GPU 数量、200Gi RAM 上限和 ConfigMap 内容都正确。

## 第 9 步：正式安装 Release

```bash
helm upgrade --install sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --wait \
  --timeout 60m
```

查看状态：

```bash
helm status sae-web -n gufy
kubectl get pods,svc,endpoints -n gufy -o wide
kubectl rollout status deployment/sae-web-backend -n gufy --timeout=60m
kubectl rollout status deployment/sae-web-frontend -n gufy --timeout=5m
```

## 第 10 步：逐项验证后端

先确认模型存储写权限预检通过，再查看两个运行容器日志：

```bash
kubectl logs -n gufy deployment/sae-web-backend \
  -c verify-model-storage --tail=50
kubectl logs -n gufy deployment/sae-web-backend -c clash --tail=200
kubectl logs -n gufy deployment/sae-web-backend -c backend --tail=200
```

确认 `/root` 确实是个人 GPFS：

```bash
kubectl exec -n gufy deployment/sae-web-backend -c backend -- df -Th /root
kubectl exec -n gufy deployment/sae-web-backend -c backend -- mount
```

确认 CUDA、cuDNN 和一张 GPU：

```bash
kubectl exec -n gufy deployment/sae-web-backend -c backend -- python -c \
  "import torch; print(torch.__version__, torch.version.cuda, torch.backends.cudnn.version(), torch.cuda.device_count()); assert torch.cuda.is_available(); assert torch.cuda.device_count() == 1"
```

确认代理变量和外网：

```bash
kubectl exec -n gufy deployment/sae-web-backend -c backend -- env | grep -i proxy

kubectl exec -n gufy deployment/sae-web-backend -c backend -- python -c \
  "import requests; r=requests.get('https://huggingface.co', timeout=30); print(r.status_code); r.raise_for_status()"
```

确认 GPFS 权重目录与本地锁目录是不同挂载：

```bash
kubectl exec -n gufy deployment/sae-web-backend -c backend -- df -Th \
  /root/.cache/huggingface \
  /root/.cache/huggingface/hub/.locks
```

## 第 11 步：先用 port-forward 验证，不急着配置 Ingress

```bash
kubectl port-forward -n gufy service/sae-frontend-svc 8080:80
```

浏览器打开 `http://localhost:8080`。另一个终端测试：

```bash
curl -fsS http://localhost:8080/api/
curl -fsS http://localhost:8080/api/models
curl -I http://localhost:8080/arbitrary/react/route
```

首次触发模型分析且缓存中没有对应文件时，权重才会通过 localhost Clash 下载到
个人 GPFS；模型权重不会被打进镜像，也不会在 Pod 启动阶段预下载：

```bash
curl -X POST http://localhost:8080/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Apple announced a new product.","selected_models":["gpt2-small-l4"],"top_k":10}'
```

同时观察：

```bash
kubectl logs -f -n gufy deployment/sae-web-backend -c backend
kubectl exec -n gufy deployment/sae-web-backend -c backend -- \
  du -sh /root/.cache/huggingface
```

第二次执行同一模型应直接读取缓存。

## 第 12 步：最后配置 Ingress

推荐在以下检查全部通过后再创建 Ingress：

1. 前后端 Pod Ready；
2. `sae-backend-svc` 有 Endpoint；
3. GPU/CUDA 验证通过；
4. Clash 外网访问通过；
5. 首个模型已成功下载并完成分析；
6. port-forward 下前端、API 和 SPA 刷新全部正常。

然后再单独处理 IngressClass、域名、TLS Secret、上传大小、长推理超时和路径规则。
这样出现 404/502/504 时可以明确是 Ingress 层问题，而不是镜像、Service、代理、
GPU 或模型下载问题。
