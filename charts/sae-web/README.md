# SAE Web Helm Chart

## 官方骨架初始化与清理

仓库采用 `charts/sae-web` 目录。Helm 4 要求父目录预先存在：

```bash
mkdir -p charts
helm create charts/sae-web
```

`helm create` 会生成通用示例。当前阶段不需要 HPA、Ingress、Gateway API、
ServiceAccount 和测试 Pod，因此初始化后删除：

```bash
rm charts/sae-web/templates/deployment.yaml
rm charts/sae-web/templates/service.yaml
rm charts/sae-web/templates/hpa.yaml
rm charts/sae-web/templates/ingress.yaml
rm charts/sae-web/templates/httproute.yaml
rm charts/sae-web/templates/serviceaccount.yaml
rm -rf charts/sae-web/templates/tests
```

随后用本项目模板替换 `values.yaml`、`_helpers.tpl` 和 `NOTES.txt`。

## 当前目录骨架

```text
charts/sae-web/
├── .helmignore
├── Chart.yaml
├── DEPLOYMENT.md
├── README.md
├── values-ingress.yaml
├── values.yaml
└── templates/
    ├── _helpers.tpl
    ├── NOTES.txt
    ├── clash-configmap.yaml
    ├── backend-deployment.yaml
    ├── frontend-deployment.yaml
    ├── frontend-ingress.yaml
    ├── frontend-service.yaml
    └── backend-service.yaml
```

当前渲染五个 Kubernetes 资源：

1. Clash ConfigMap；
2. 后端 Deployment（Clash + Python 双容器、1 GPU）；
3. 后端 Service（8000）；
4. 前端 Deployment；
5. 前端 Service（80）。

Ingress 默认关闭。旧手工 Ingress 已在 Sakura 公网链路验证成功后退役；当前阶段 A
由独立 frpc Deployment 直接访问 frontend Service，不需要启用 Ingress。未来正式
域名方案需要 Ingress 时追加：

```bash
--values charts/sae-web/values-ingress.yaml
```

启用后会额外渲染 Helm 管理的 `sae-web-ingress`。完整架构见根目录
`SAE_WEB_DEPLOYMENT_WHITEPAPER.md`，TLS、FRP 与正式域名专项见
`ingress_frp_plan.md`。

完整构建、Secret、Clash 配置注入、Helm 安装、GPU/代理/GPFS 验证和 Ingress
时机见 `DEPLOYMENT.md`。

## 模型缓存存储

默认使用管理员已经创建的 `pvc-gpfshome-gufy`，Chart 只引用现有 PVC，不创建、
修改或删除它。后端启动前会用 InitContainer 实际创建并删除一个极小探针文件，
尽早发现只读挂载、Unix 权限或配额问题。

尚不能使用 PVC 时，把 `backend.modelStorage.type` 改成 `emptyDir`。它能跨同一
Pod 的容器 OOM 重启保留缓存，但 Pod 删除或升级后缓存会清空。PVC 缺失时不会
自动降级为 emptyDir，避免把大模型意外写入节点临时磁盘。

## 本地验证

```bash
helm lint charts/sae-web --strict
helm template sae-web charts/sae-web --namespace gufy --debug
```

验证不同 Service 暴露方式：

```bash
helm template sae-web charts/sae-web --namespace gufy \
  --set frontend.service.type=NodePort \
  --set frontend.service.nodePort=30080
```

## 安装前预览

镜像、Harbor Secret、HF Token 和真实 Clash 配置准备完毕后，先执行：

```bash
helm upgrade --install sae-web charts/sae-web \
  --namespace gufy \
  --values charts/sae-web/values.yaml \
  --set-file clash.config.content=./clashconfig/config.yaml \
  --dry-run=client --debug
```

确认输出后去掉 `--dry-run=client --debug` 才会真正修改集群。

## 命名约束

前端镜像内的 Nginx 当前固定访问：

```text
http://sae-backend-svc:8000
```

所以 `backend.service.nameOverride` 默认必须是 `sae-backend-svc`。在同一个
namespace 安装多个 Release 会发生 Service 名称冲突；若未来需要多环境并存，
应先把 Nginx upstream 改成启动时可注入变量，再取消固定名称。
