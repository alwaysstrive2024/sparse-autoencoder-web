# Sakura Frp 公网访问与 Ingress 迁移操作手册

> 更新时间：2026-07-15
> 当前状态：阶段 A 已于 2026-07-15 部署并验证完成；本文后半部分继续保留运维、
> 回滚和阶段 B 正式域名方案。

## 当前已上线状态

```text
公网地址: https://www-api-map.h5f99e4e0.nyat.app:44370
Sakura 隧道 ID: 28213524
隧道类型: TCP + 自动 HTTPS + 访问认证
本地目标: sae-frontend-svc.gufy.svc.k8s.aiplat:80
frpc Deployment: sae-sakura-frpc / gufy
frpc 版本: 0.51.0-sakura-13 / linux/amd64
Harbor 镜像: sae-sakura-frpc:0.51.0-sakura-13-amd64-v1
镜像 digest: sha256:9ce27d61c853fdfbbe16b2969fefd7e52aa9bdb041e7f5bff8c4c5c150c5d8e4
```

已验证：

- frpc Pod `1/1 Running`、零重启、单副本、`Recreate`；
- Sakura 节点连接、隧道注册与正式 `nyat.app` 证书加载成功；
- 公网首页通过可信 TLS/HTTP2 返回 React 应用；
- 公网 `/api/` 返回 `pipeline_mode: real`；
- 公网 `/api/analyze` 使用 `gpt2-small-l11` 返回 HTTP 200；
- backend 日志确认实际使用 CUDA、TransformerLens 和 SAELens，没有 mock fallback；
- 旧手工 Ingress `sae-frontend-ingress` 已备份后删除，删除后公网链路复测通过；
- Helm Release、Service、前后端 Pod、GPU、PVC 和模型缓存未因入口迁移而改变。

## 0. 先看结论

当前最稳妥的第一版不是“FRP 一定先经过 Ingress”，而是：

```text
公网测试用户
  │ HTTPS（Sakura 自动 HTTPS，首版地址通常带远程端口）
  ▼
Sakura Frp 托管公网节点（Sakura 负责 frps）
  │ TCP 隧道
  ▼
独立的 sae-sakura-frpc Pod（namespace: gufy，仅 1 副本）
  │ Kubernetes 内部 DNS，HTTP:80
  ▼
sae-frontend-svc.gufy.svc.k8s.aiplat
  │
  ├── /、静态资源、React SPA → frontend Nginx
  └── /api/* → frontend Nginx → sae-backend-svc:8000 → GPU backend
```

该方案具有以下优点：

1. 不需要自己购买公网服务器或部署 `frps`；Sakura Frp 已提供公网节点。
2. 不依赖目前未知的 Ingress Controller Service/VIP/DNS。
3. 不使用不稳定的 `10.1.0.x` 节点地址。
4. 后端 `8000` 不直接暴露；所有请求仍从前端 Nginx 的同源 `/api` 进入。
5. `frpc` 与 GPU backend 解耦，FRP 故障不会重建 GPU Pod。
6. `frpc` 使用单独的轻量 Deployment，后续可独立停止、升级和回滚。

在这个首版中，FRP 公网流量会直接进入前端 Service，因此 **Ingress 不是 FRP 的
必经链路**。旧 Ingress 可以先作为临时回滚入口保留，确认 Sakura 公网链路正常后
再删除。新的 Helm Ingress 文件继续保留，但默认关闭；只有需要公司内网统一入口，
或进入“不带端口的正式域名 HTTPS”阶段时才启用。

## 1. 当前部署状态与不能破坏的边界

应用当前链路：

```text
sae-frontend-svc:80
  → frontend Nginx
  → /api/*
  → sae-backend-svc:8000
  → FastAPI + Torch 2.7.1/cu128 + GPU
```

现有历史 Ingress：

```text
名称: sae-frontend-ingress
namespace: gufy
Host: gufy.aixiongan.org.cn
Backend: sae-frontend-svc:80
TLS: 无
管理方式: 手工 kubectl，不属于 Helm
```

它已经确定废弃，但无需在第一步删除。保留它不会妨碍 Sakura TCP 隧道直接访问
`sae-frontend-svc`。待公网验证通过后再删除，可减少操作期间的回滚压力。

整个流程禁止做以下事情：

- 不把 `sae-backend-svc:8000` 暴露给 Sakura Frp。
- 不把 Sakura 访问密钥、访问密码、TOTP 种子或证书私钥写入 Git、values 文件、
  Shell 脚本、截图或聊天记录。
- 不把 `frpc` 加到 backend Deployment，也不让它占用 GPU。
- 不把 `frpc` 做成 frontend/backend Sidecar。
- 不同时运行两个使用相同 Sakura 隧道 ID 的 `frpc` 实例。
- 不使用未固定的 `latest` 镜像长期运行生产服务。
- 不删除 Helm Release、应用 Service、GPU Deployment、PVC 或模型缓存来排查 FRP。

## 2. 为什么 Sakura Frp 不需要自建 frps

Sakura Frp 的公网“节点”就是服务商管理的 `frps`。你只需要：

1. 在 Sakura 管理面板创建隧道；
2. 在能访问 `sae-frontend-svc` 的位置运行官方 Sakura 版 `frpc`；
3. `frpc` 使用“访问密钥 + 隧道 ID”从 Sakura API 拉取配置；
4. 公网用户访问 Sakura 节点分配的域名/端口。

因此，旧文档中的“购买公网 Linux、开放 7000、编写 frps.toml、维护 frps Token”
全部不适用于本方案，应当废弃。

Sakura 分发的 `frpc` 与上游开源 frpc 有差异。不要随便改用 Docker Hub 上的通用
`fatedier/frpc`，也不要自己手写一份上游 TOML 配置冒充 Sakura 配置。

## 3. 两个阶段的选择

### 3.1 阶段 A：先跑通，推荐现在执行

使用：

- Sakura `TCP` 隧道；
- 本地目标 `sae-frontend-svc.gufy.svc.k8s.aiplat:80`；
- Sakura“自动 HTTPS”；
- Sakura 免费 `nyat.app` 子域与证书；
- Sakura“访问认证”（强密码，条件允许再加 TOTP）；
- 独立的 Kubernetes `frpc` Deployment。

公网地址通常形如：

```text
https://<分配的子域>.nyat.app:<Sakura远程端口>
```

优点是无需等待公司域名 DNS、Ingress TLS、cert-manager 或管理员提供 Controller
稳定地址。缺点是 URL 通常带远程端口，并且默认不会把访问者真实 IP 传到 Nginx。

### 3.2 阶段 B：正式域名、不带端口，后续再做

目标地址：

```text
https://gufy.aixiongan.org.cn
```

这一阶段才让 FRP 进入新的 Helm Ingress。执行前必须具备：

1. `gufy.aixiongan.org.cn` 的 DNS 修改权限；
2. Sakura 支持建站的节点与相应套餐/流量；
3. 若使用中国内地节点，域名必须满足 ICP 备案要求；海外节点无需备案，但仍需
   Sakura 实名认证；
4. 管理员提供 Ingress Controller 的稳定 Service/VIP/DNS，不能使用任意单个
   `10.1.0.x` 节点 IP；
5. 可用的 cert-manager ClusterIssuer，或正式 TLS 证书 Secret；
6. 新 Ingress 的 Host、Sakura 绑定域名和证书域名完全一致。

阶段 B 的规划见本文第 13 节。阶段 A 成功不依赖阶段 B。

## 4. 执行前检查

所有命令从仓库根目录执行：

```bash
cd /Users/fuyugu/Desktop/1Aalwaysstrive2024/work/githubproj/Sparse_autoencoder_web
kubectl config current-context
kubectl get namespace gufy
```

确认应用健康：

```bash
kubectl get pods -n gufy
kubectl get svc sae-frontend-svc sae-backend-svc -n gufy
kubectl get endpointslice -n gufy \
  -l kubernetes.io/service-name=sae-frontend-svc
```

前端 Pod 必须能通过 Service 访问自己，并能通过 `/api` 到达后端：

> 本平台实测的 Kubernetes 集群域名是 `k8s.aiplat`，不是 Kubernetes 常见默认值
> `cluster.local`。可通过 Pod 内的 `/etc/resolv.conf` 确认。namespace 内也可以
> 直接使用稳定短名称 `sae-frontend-svc`。

```bash
FRONTEND_POD="$(kubectl get pod -n gufy \
  -l app.kubernetes.io/instance=sae-web,app.kubernetes.io/component=frontend \
  -o jsonpath='{.items[0].metadata.name}')"

test -n "$FRONTEND_POD"

kubectl exec -n gufy "$FRONTEND_POD" -- \
  wget -S -O- http://sae-frontend-svc.gufy.svc.k8s.aiplat/

kubectl exec -n gufy "$FRONTEND_POD" -- \
  wget -S -O- http://sae-frontend-svc.gufy.svc.k8s.aiplat/api/
```

若这一步失败，先修复 Kubernetes Service 或应用，不要用 FRP 掩盖内部故障。

记录现有入口，但暂时不删除：

```bash
kubectl get ingress -n gufy
kubectl get ingress sae-frontend-ingress -n gufy \
  -o yaml > /tmp/sae-frontend-ingress.legacy.yaml
test -s /tmp/sae-frontend-ingress.legacy.yaml
```

## 5. Sakura Frp 账户准备

### 5.1 注册、登录与实名认证

1. 打开 [Sakura Frp 官网](https://www.natfrp.com/) 并进入管理面板。
2. 注册或登录账户。
3. 完成账户邮箱和手机号安全设置。
4. 按管理面板要求完成实名认证。

根据 Sakura 官方说明，海外节点建站不要求 ICP 备案，但仍要求实名认证；中国
内地节点的 HTTP(S) 建站还要求使用已备案域名。阶段 A 推荐选择合适的海外节点，
避免在首次联调时被备案条件阻塞。

### 5.2 访问密钥的安全规则

管理面板中的“访问密钥”不是账户登录密码，而是 `frpc` 登录 Sakura API 的专用
凭据。后续只把它写进 Kubernetes Secret。

- 不要粘贴到本文档或 Git 文件。
- 不要把包含密钥的 `frpc -f <Token>:<ID>` 命令发到聊天中。
- 如果截图或终端录屏包含密钥，立即在 Sakura 用户信息页重置密钥。
- 重置密钥后，Kubernetes Secret 也必须同步更新并重启 `frpc`。

## 6. 在 Sakura 面板创建阶段 A 隧道

控制台具体排版可能变化，但需要填写的字段不变。

### 6.1 新建 TCP 隧道

进入“管理面板 → 隧道列表 → 创建隧道”，按下表填写：

| 字段 | 推荐填写 | 原因 |
|---|---|---|
| 隧道名称 | `sae-web-gufy` | 便于识别，不能包含密钥 |
| 节点 | 距测试用户较近、允许 Web 流量的海外节点 | 首版避免 ICP 备案条件；仍需看节点备注 |
| 隧道类型 | `TCP` | 所有 HTTP 字节原样通过，兼容自动 HTTPS 和访问认证 |
| 本地 IP | `sae-frontend-svc.gufy.svc.k8s.aiplat` | `frpc` Pod 可通过本平台 Cluster DNS 访问前端 Service |
| 本地端口 | `80` | frontend Nginx/Service 当前只提供 HTTP 80 |
| 远程端口 | 让平台分配，或按套餐允许值选择 | 最终以隧道列表/日志显示为准 |
| 自动 HTTPS | `自动` | 在 frpc 处终止公网 TLS，再转为内部 HTTP 访问 Service |
| 访问密码 | 密码管理器生成的独立强密码 | 防止测试接口直接暴露给全网 |
| 访问认证 TOTP | 可选但推荐 | 与访问密码组合成第二因素 |

不要把本地 IP 填成：

- `127.0.0.1`：独立 `frpc` Pod 的 localhost 上没有 frontend；
- backend Pod IP：Pod IP 会变化，而且会绕过 frontend Nginx；
- `sae-backend-svc`：会直接公开 GPU API；
- 任意 `10.1.0.x`：节点地址不是稳定的应用入口。

保存后在隧道列表记下 **隧道 ID**。隧道 ID 不是远程端口。

### 6.2 申请并绑定免费 nyat.app 子域

1. 进入“管理面板 → 子域绑定”。
2. 申请一个平台提供的 `nyat.app` 子域。
3. 确认刚创建的 TCP 隧道“自动 HTTPS”已经设为“自动”。
4. 新建绑定，将该子域绑定到 `sae-web-gufy` 隧道。
5. 保存后必须重启 `frpc`，新绑定才会生效。

Sakura 官方说明 `nyat.app` 子域启用了 HSTS Preloading，因此必须使用 HTTPS。
首次签发证书可能需要数分钟；日志若先出现自签名证书警告，随后出现“已从服务器
为 ... 加载证书”即可。若十分钟后仍在签发或浏览器仍提示证书错误，再进入第 12 节
排查。

### 6.3 访问认证说明

Sakura 的访问认证作用于 TCP 隧道。启用后，每个测试者的公网 IP 都要先完成授权。
测试者通常先在浏览器打开完整地址：

```text
https://<分配的子域>.nyat.app:<远程端口>
```

输入访问密码/TOTP 或通过 Sakura 账户授权，随后同一 IP 才能访问应用。`frpc` 重启
会清空授权缓存，因此维护后测试者可能需要重新认证。

这与应用自身的 `X-API-KEY`、HF Token 完全无关。FRP 访问密码不能替代应用长期
身份认证，但很适合当前测试阶段挡住公网扫描。

## 7. 固定 Linux/AMD64 的 frpc 镜像并推送 Harbor

Sakura 官方文档首选镜像源为 `natfrp.com/frpc`。为了避免 K8s 节点临时拉取外部
仓库失败，先在本地将 **linux/amd64** 镜像同步到现有 Harbor。

### 7.1 拉取、验证架构和版本

```bash
export SAKURA_SOURCE_IMAGE='natfrp.com/frpc'

docker pull --platform linux/amd64 "$SAKURA_SOURCE_IMAGE"

docker image inspect "$SAKURA_SOURCE_IMAGE" \
  --format 'architecture={{.Architecture}} os={{.Os}}'

docker run --rm --platform linux/amd64 "$SAKURA_SOURCE_IMAGE" \
  --version_full
```

必须看到：

```text
architecture=amd64 os=linux
```

若 `--version_full` 不受当前版本支持，再执行：

```bash
docker run --rm --platform linux/amd64 "$SAKURA_SOURCE_IMAGE" -v
```

把输出版本填到下面 `<FRPC_VERSION>`，不要使用字面量占位符：

```bash
export SAKURA_FRPC_IMAGE="harbor.aixiongan.org.cn:9443/saeweb/sae-sakura-frpc:<FRPC_VERSION>-amd64-v1"

case "$SAKURA_FRPC_IMAGE" in
  *'<'*|'>'*) echo '错误：请先替换 FRPC_VERSION 占位符'; exit 1 ;;
esac

docker tag "$SAKURA_SOURCE_IMAGE" "$SAKURA_FRPC_IMAGE"
docker push "$SAKURA_FRPC_IMAGE"

docker buildx imagetools inspect "$SAKURA_FRPC_IMAGE"
```

Harbor 页面应显示该 Tag 的平台是 `linux/amd64`。记录镜像 digest；正式运行最好把
Deployment 的 image 固定为：

```text
harbor.aixiongan.org.cn:9443/saeweb/sae-sakura-frpc:<TAG>@sha256:<DIGEST>
```

### 7.2 为什么不能直接长期用 latest

`latest` 可能在 Pod 重建时变成不同客户端版本，导致一次不可审计的线上升级。
复制到 Harbor 并使用不可变 Tag/digest 后，同一清单始终得到同一 Linux/AMD64
二进制，也符合当前前后端镜像的发布方式。

## 8. 创建 Sakura 凭据 Secret

### 8.1 安全读取参数

在本地 Shell 中执行。输入访问密钥时终端不回显：

```bash
read -s 'NATFRP_TOKEN?请输入 Sakura 访问密钥: '
echo
read 'NATFRP_TARGET?请输入 Sakura 隧道 ID: '

test -n "$NATFRP_TOKEN"
test -n "$NATFRP_TARGET"
```

`NATFRP_TARGET` 只填写隧道 ID；多个隧道才用半角逗号分隔，不加空格。本项目首版
只需要一条隧道。

### 8.2 创建或更新 Secret

```bash
kubectl create secret generic sae-sakura-frpc-credentials \
  --namespace gufy \
  --from-literal=NATFRP_TOKEN="$NATFRP_TOKEN" \
  --from-literal=NATFRP_TARGET="$NATFRP_TARGET" \
  --dry-run=client -o yaml | kubectl apply -f -

unset NATFRP_TOKEN NATFRP_TARGET
```

只检查键名，不打印值：

```bash
kubectl get secret sae-sakura-frpc-credentials -n gufy \
  -o go-template='{{range $k,$v := .data}}{{$k}}{{"\n"}}{{end}}'
```

预期只看到：

```text
NATFRP_TARGET
NATFRP_TOKEN
```

Kubernetes Secret 默认只是 base64 编码，不等于自动加密。namespace 中能读取 Secret
的人仍能获取密钥，因此继续依赖 RBAC，且绝不能把 Secret YAML 导出进仓库。

## 9. 独立 frpc Deployment 设计

仓库已经提供独立清单 `deploy/sakura-frpc-deployment.yaml`。当前清单固定使用已
验证的 `0.51.0-sakura-13-amd64-v1` Harbor Tag；首次应用前必须先按第 7 节把
对应镜像推送到 Harbor。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sae-sakura-frpc
  namespace: gufy
  labels:
    app.kubernetes.io/name: sae-sakura-frpc
    app.kubernetes.io/component: tunnel-client
spec:
  # 同一 Sakura 隧道绝不能由两个 frpc 同时启动。
  replicas: 1

  # Recreate 会先结束旧 Pod 再创建新 Pod，避免 RollingUpdate 短时间产生两个客户端。
  strategy:
    type: Recreate

  selector:
    matchLabels:
      app.kubernetes.io/name: sae-sakura-frpc
  template:
    metadata:
      labels:
        app.kubernetes.io/name: sae-sakura-frpc
        app.kubernetes.io/component: tunnel-client
    spec:
      # frpc 不需要访问 Kubernetes API，避免自动挂载 ServiceAccount Token。
      automountServiceAccountToken: false

      # 当前所有部署镜像统一要求 Linux/AMD64。
      nodeSelector:
        kubernetes.io/arch: amd64

      imagePullSecrets:
        - name: harbor-cred

      containers:
        - name: frpc
          image: harbor.aixiongan.org.cn:9443/saeweb/sae-sakura-frpc:0.51.0-sakura-13-amd64-v1@sha256:9ce27d61c853fdfbbe16b2969fefd7e52aa9bdb041e7f5bff8c4c5c150c5d8e4
          imagePullPolicy: IfNotPresent

          # Sakura 版 frpc 支持用 NATFRP_TOKEN/NATFRP_TARGET 代替 -f 参数。
          # 这样访问密钥不会出现在 Pod command、进程参数或 Deployment YAML 中。
          args:
            - --disable_log_color

          env:
            - name: NATFRP_TOKEN
              valueFrom:
                secretKeyRef:
                  name: sae-sakura-frpc-credentials
                  key: NATFRP_TOKEN
            - name: NATFRP_TARGET
              valueFrom:
                secretKeyRef:
                  name: sae-sakura-frpc-credentials
                  key: NATFRP_TARGET

          # frpc 本身很轻。这里比最小值多留余量，避免 TLS、日志和连接峰值造成 OOM。
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi

          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop:
                - ALL

          # 官方镜像工作目录为 /run/frpc。自动 HTTPS 可能在此生成/加载证书，
          # emptyDir 允许写入，但不会把任何凭据打包进镜像。
          volumeMounts:
            - name: frpc-workdir
              mountPath: /run/frpc

      volumes:
        - name: frpc-workdir
          emptyDir:
            sizeLimit: 1Gi

      terminationGracePeriodSeconds: 30
```

为什么这里没有 Service：`frpc` 主动向 Sakura 公网节点发起出站连接，不需要集群
外部主动连接它，也不需要 NodePort/LoadBalancer。

为什么暂时不加 HTTP 健康探针：frpc 不提供本项目可直接依赖的 HTTP health API；
仅检查进程存在由 Deployment 自动完成。真正的健康状态通过日志、Sakura 隧道状态
和外部 HTTPS 探测判断。

## 10. 应用 frpc 并验证公网链路

假设清单已经保存为 `deploy/sakura-frpc-deployment.yaml`：

```bash
kubectl apply -f deploy/sakura-frpc-deployment.yaml

kubectl rollout status deployment/sae-sakura-frpc \
  --namespace gufy \
  --timeout 10m

kubectl get pods -n gufy \
  -l app.kubernetes.io/name=sae-sakura-frpc \
  -o wide

kubectl logs -n gufy deployment/sae-sakura-frpc \
  --tail=200
```

日志应依次反映：

1. 成功从 Sakura 获取配置；
2. 成功连接所选节点；
3. `sae-web-gufy` 隧道启动成功；
4. 输出公网连接地址；
5. 使用 `nyat.app` 时，最终出现成功加载对应证书的信息。

如果刚完成子域绑定，需要重启一次：

```bash
kubectl rollout restart deployment/sae-sakura-frpc -n gufy
kubectl rollout status deployment/sae-sakura-frpc -n gufy --timeout 10m
kubectl logs -n gufy deployment/sae-sakura-frpc --tail=200
```

由于策略为 `Recreate` 且副本数为 1，不会在滚动更新时启动重复隧道。

### 10.1 公网功能验证顺序

把日志/面板显示的完整地址保存到变量，地址必须包含 `https://` 和远程端口：

```bash
export SAE_PUBLIC_URL='https://<分配的子域>.nyat.app:<远程端口>'
```

先在浏览器完成 Sakura 访问认证，然后依次测试：

1. 首页能打开；
2. 浏览器直接刷新 React 子路由不返回 404；
3. 前端模型列表能加载；
4. `/api/` 能访问；
5. 发起一次真实 GPU 推理，而不是 mock；
6. 发起一个耗时请求，确认不被中途断开；
7. 查看 backend 日志，确认没有 CUDA、HF gated 或 OOM 错误。

辅助日志命令：

```bash
kubectl logs -n gufy deployment/sae-sakura-frpc \
  --since=10m

kubectl logs -n gufy deployment/sae-web-frontend \
  --since=10m

kubectl logs -n gufy deployment/sae-web-backend \
  -c backend \
  --since=10m
```

注意：前端 Nginx 当前后端读写超时为 600 秒。首次下载特别大的模型若超过 10 分钟，
即使 FRP 正常也可能由 frontend Nginx 返回 504。这是应用超时策略，不是 Sakura
隧道故障；需要根据真实模型加载时长另行调整。

## 11. 公网验证完成后废弃旧 Ingress

只有第 10 节全部通过后才执行：

```bash
kubectl get ingress sae-frontend-ingress -n gufy \
  -o yaml > /tmp/sae-frontend-ingress.before-delete.yaml

test -s /tmp/sae-frontend-ingress.before-delete.yaml

kubectl delete ingress sae-frontend-ingress -n gufy

kubectl get ingress -n gufy
```

删除旧 Ingress 不会删除 frontend/backend Service、Deployment、Pod、PVC 或模型缓存，
也不会影响直接访问 `sae-frontend-svc` 的 `frpc`。

基础 `charts/sae-web/values.yaml` 中已经是：

```yaml
ingress:
  enabled: false
```

因此阶段 A **不要**给 Helm 命令追加 `charts/sae-web/values-ingress.yaml`。该覆盖文件
会创建新的 `sae-web-ingress`，但阶段 A 的 FRP 并不需要它。

如果删除旧 Ingress 后需要恢复内网入口，可临时执行：

```bash
kubectl apply -f /tmp/sae-frontend-ingress.before-delete.yaml
```

恢复旧入口只是回滚手段；长期应使用新的 Helm Ingress，而不是继续手工维护旧资源。

## 12. 常见故障与恢复路径

### 12.1 `ImagePullBackOff` / `ErrImagePull`

```bash
kubectl describe pod -n gufy \
  -l app.kubernetes.io/name=sae-sakura-frpc

kubectl get secret harbor-cred -n gufy
```

检查 Harbor 仓库、Tag/digest、`harbor-cred` 和镜像平台。修正清单后：

```bash
kubectl apply -f deploy/sakura-frpc-deployment.yaml
kubectl rollout status deployment/sae-sakura-frpc -n gufy --timeout 10m
```

### 12.2 获取配置失败、Token 无效

```bash
kubectl logs -n gufy deployment/sae-sakura-frpc --tail=200
```

不要打印 Secret 值。确认：

- Sakura 访问密钥是否被重置；
- `NATFRP_TARGET` 是否真的是隧道 ID，而不是远程端口；
- 隧道是否属于同一个 Sakura 账户；
- Secret 键名是否为精确的 `NATFRP_TOKEN`、`NATFRP_TARGET`。

更新 Secret 后必须重启：

```bash
kubectl rollout restart deployment/sae-sakura-frpc -n gufy
kubectl rollout status deployment/sae-sakura-frpc -n gufy --timeout 10m
```

### 12.3 `无法连接到本地服务`

面板中的目标必须是：

```text
sae-frontend-svc.gufy.svc.k8s.aiplat:80
```

检查：

```bash
kubectl get svc sae-frontend-svc -n gufy -o wide
kubectl get endpointslice -n gufy \
  -l kubernetes.io/service-name=sae-frontend-svc
kubectl get pods -n gufy \
  -l app.kubernetes.io/component=frontend
```

修改 Sakura 面板字段后重启 `frpc`，无需重建前后端镜像。

### 12.4 frpc 无法访问 Sakura 节点

backend Pod 中 Clash Sidecar 的 `127.0.0.1:7890` 只属于 backend Pod 网络命名空间，
独立 `frpc` Pod **不能**访问那个 localhost。处理顺序：

1. 先从 frpc 日志确认是 DNS、TCP 超时还是 API 失败；
2. 优先向管理员申请放行 Sakura API 与所选节点的出站连接；
3. 或换一个当前网络可达的 Sakura 节点；
4. 若确实只能通过 Clash，再给 `frpc` Deployment 增加自己的 Clash Sidecar；
5. 该 Sidecar 必须和 `frpc` 在同一个 Pod，并设置
   `no_proxy=.svc,.k8s.aiplat,.cluster.local,sae-frontend-svc`，否则内部 Service 流量可能被错误
   送进代理。

不要为了复用 backend 的 Clash 而把 `frpc` 塞进 GPU Pod。新增 Clash Sidecar 属于
单独变更，应在确认直接出站失败后再设计。

### 12.5 HTTPS 证书错误

依次确认：

1. 隧道类型是 TCP，本地服务协议是 HTTP；
2. 自动 HTTPS 为“自动”；
3. `nyat.app` 子域已绑定到正确隧道；
4. 绑定后已重启 `frpc`；
5. 日志最终出现从服务器加载该域名证书；
6. 首次签发已等待数分钟，十分钟以上仍失败再检查面板子域状态。

如果本地目标以后改成真正的 HTTPS 服务，必须关闭自动 HTTPS；官方明确警告不要
对已经是 HTTPS 的服务再次套自动 HTTPS，否则会形成 TLS 套 TLS 或协议错误。

### 12.6 隧道反复掉线或提示重复

```bash
kubectl get deployment sae-sakura-frpc -n gufy \
  -o jsonpath='{.spec.replicas}{"\n"}{.spec.strategy.type}{"\n"}'

kubectl get pods -n gufy \
  -l app.kubernetes.io/name=sae-sakura-frpc
```

必须为 `1` 副本和 `Recreate`。同时确认 Mac、旧服务器、旧 Pod 或 Sakura 启动器
没有运行同一个隧道 ID。

### 12.7 页面能开，但 API 失败

FRP 只负责到达 frontend。继续检查原应用链路：

```bash
kubectl logs -n gufy deployment/sae-web-frontend --since=10m
kubectl logs -n gufy deployment/sae-web-backend -c backend --since=10m
kubectl get svc sae-backend-svc -n gufy
```

HF gated、HF Token、模型下载、CUDA 或 GPU OOM 都属于 backend 问题，不要通过重建
FRP 隧道处理。

### 12.8 访问者真实 IP

阶段 A 中 backend/Nginx 很可能看到的是 `frpc` Pod 或中转链路地址。Sakura 支持
Proxy Protocol 等真实 IP 方案，但 frontend Nginx 也必须配套信任并解析该协议。
错误开启会直接导致 HTTP 无法解析，因此首版不启用，等功能稳定后单独实施。

## 13. 阶段 B：正式域名 + 新 Helm Ingress + Sakura HTTPS

这一节仅是后续规划，不在阶段 A 中执行。

### 13.1 推荐最终拓扑

```text
https://gufy.aixiongan.org.cn:443
  → Sakura 支持建站的 HTTPS 节点
  → frpc
  → Ingress Controller 稳定 Service/VIP/DNS:443
  → sae-web-ingress
  → sae-frontend-svc:80
  → /api → sae-backend-svc:8000
```

此时 TLS 在 Ingress 终止，本地目标已经是 HTTPS，所以 Sakura `frpc` 的自动 HTTPS
必须关闭。Sakura 隧道类型、本地协议和证书方案应按官方 Web 应用指南匹配。

### 13.2 管理员必须提供的参数

```text
INGRESS_CLASS
INGRESS_CONTROLLER_STABLE_DNS_OR_VIP
INGRESS_CONTROLLER_HTTPS_PORT
CERT_MANAGER_CLUSTER_ISSUER 或 TLS 证书
DNS 修改权限
```

不能用下面的内容替代稳定入口：

- 任意一个当前 Node IP；
- Ingress 资源名称 `sae-web-ingress`（Ingress 对象本身不是 DNS 服务）；
- frontend/backend Pod IP。

### 13.3 新 Helm Ingress 已准备的文件

```text
charts/sae-web/templates/frontend-ingress.yaml
charts/sae-web/values-ingress.yaml
```

新资源名是 `sae-web-ingress`，由 Helm 管理，只把 `/` 转给
`sae-frontend-svc:80`；`/api` 继续由 frontend Nginx 转发，避免两套 rewrite 规则。

管理员参数齐全后，先配置 `values-ingress.yaml`：

```yaml
ingress:
  enabled: true
  host: gufy.aixiongan.org.cn
  tls:
    enabled: true
    secretName: sae-web-tls
  certManager:
    enabled: true
    clusterIssuer: <管理员提供的 ClusterIssuer>
```

若使用已有证书 Secret，则关闭 `certManager.enabled`，由证书负责人创建
`kubernetes.io/tls` 类型的 `sae-web-tls`。私钥绝不能进入 Git。

### 13.4 新 Ingress 上线顺序

```bash
helm lint charts/sae-web --strict \
  --values charts/sae-web/values-ingress.yaml

helm template sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --values charts/sae-web/values-ingress.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  > /tmp/sae-web-with-ingress.yaml

kubectl apply --dry-run=server \
  -f /tmp/sae-web-with-ingress.yaml
```

确认没有同 Host/Path 的旧 Ingress 后再升级：

```bash
helm upgrade --install sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --values charts/sae-web/values-ingress.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --wait \
  --timeout 60m
```

先在内网验证 Ingress HTTPS、证书、SPA、`/api` 和 GPU 请求，再把 Sakura 隧道本地
目标切换到管理员提供的 Ingress Controller 稳定 HTTPS 地址。最后修改正式 DNS。

### 13.5 Sakura 正式域名注意事项

- HTTP(S) 隧道绑定域名必须和 DNS 记录、Ingress Host 完全一致；
  `www.example.com` 与 `example.com` 是两个不同域名。
- 使用内地节点建站必须满足 ICP 备案要求；海外节点不要求备案，但需要实名认证。
- 同时创建 HTTP 和 HTTPS 隧道时应选择同一节点。
- 也可以只建 HTTPS 隧道并使用平台提供的 HTTP → HTTPS 301/302 重定向能力。
- 如果使用 Cloudflare，源站隧道类型必须与 Cloudflare SSL 模式匹配；不要先开
  “灵活/完全”再猜测问题，按 Sakura 官方 Web 指南逐项核对。

## 14. 停用与回滚

### 14.1 只停公网，不影响应用

```bash
kubectl scale deployment/sae-sakura-frpc \
  --namespace gufy \
  --replicas=0
```

恢复：

```bash
kubectl scale deployment/sae-sakura-frpc \
  --namespace gufy \
  --replicas=1

kubectl rollout status deployment/sae-sakura-frpc \
  --namespace gufy \
  --timeout 10m
```

注意恢复副本数后仍要保持 `Recreate`，且不要在其他机器同时启动相同隧道。

### 14.2 完全撤销 Sakura 客户端

```bash
kubectl delete deployment sae-sakura-frpc -n gufy
kubectl delete secret sae-sakura-frpc-credentials -n gufy
```

然后在 Sakura 面板停用/删除隧道和子域绑定。此操作不会删除前后端和 PVC。

### 14.3 应用入口回滚边界

- FRP 故障：只处理 `sae-sakura-frpc` 和 Sakura 面板。
- Ingress 故障：只处理 Ingress/证书/DNS。
- 前端或后端故障：按 Helm 与镜像流程处理。
- 模型缓存/PVC：与 FRP 无关，不删除。

## 15. 推荐执行清单

按顺序打勾：

- [ ] 内部 `sae-frontend-svc` 与 `/api/` 验证通过
- [ ] 备份旧 `sae-frontend-ingress`
- [ ] Sakura 账户安全设置和实名认证完成
- [ ] 创建 TCP 隧道，目标为 `sae-frontend-svc.gufy.svc.k8s.aiplat:80`
- [ ] 开启自动 HTTPS 和访问认证
- [ ] 申请并绑定 `nyat.app` 子域
- [ ] 官方 frpc 镜像验证为 `linux/amd64`
- [ ] frpc 镜像用不可变 Tag/digest 推送 Harbor
- [ ] 创建 `sae-sakura-frpc-credentials` Secret
- [ ] 创建 1 副本、`Recreate` 的独立 frpc Deployment
- [ ] frpc 日志显示节点、隧道和证书成功
- [ ] 公网完成访问认证
- [ ] 首页、SPA 刷新、`/api`、真实 GPU 推理全部通过
- [ ] 测试组验证通过
- [ ] 删除旧 `sae-frontend-ingress`
- [ ] 记录公网 URL、隧道 ID、镜像 Tag/digest 和负责人，但不记录密钥
- [ ] 需要不带端口正式域名时，再进入阶段 B

## 16. 官方资料

本文按 2026-07-15 可访问的 Sakura Frp 官方文档规划：

- [Web 应用穿透指南](https://doc.natfrp.com/app/http.html)
- [frpc 基本使用指南](https://doc.natfrp.com/frpc/usage.html)
- [frpc 用户手册（环境变量与启动参数）](https://doc.natfrp.com/frpc/manual.html)
- [自动 HTTPS](https://doc.natfrp.com/frpc/auto-https.html)
- [SSL 证书](https://doc.natfrp.com/frpc/ssl.html)
- [子域绑定](https://doc.natfrp.com/bestpractice/domain-bind.html)
- [访问认证](https://doc.natfrp.com/bestpractice/frpc-auth.html)
- [安全指南](https://doc.natfrp.com/bestpractice/security.html)
- [实名认证 FAQ](https://doc.natfrp.com/faq/realname.html)

Sakura 控制台字段、节点列表、套餐、远程端口和建站限制可能变化；实际执行时以
管理面板当前显示及节点备注为准。
