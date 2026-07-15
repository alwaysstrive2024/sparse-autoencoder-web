# syntax=docker/dockerfile:1.7

# ── 第一阶段：只负责把 React/Vite 编译成静态文件 ───────────────────────────
# 当前项目使用 Vite 8，其 Node 要求是 ^20.19.0 或 >=22.12.0；Node 18 会直接
# 不兼容。因此选择 node:22-alpine：Alpine 基础层较小，同时满足 Vite 8。
# 这一阶段包含 Node、npm、编译器和全部 devDependencies，但不会进入最终镜像。
FROM node:22-alpine AS builder

WORKDIR /app

# 先只复制依赖清单，使源码变化时仍能复用依赖安装层，减少重复下载流量。
COPY package.json package-lock.json ./

# npm ci 严格按 lock 文件安装，结果可复现；--no-audit/--no-fund 减少无关联网。
# BuildKit cache mount 只保留在构建机缓存中，不会写入镜像层，更不会进入运行镜像。
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# .dockerignore 会排除 node_modules、dist、开发环境文件等大体积/无关内容，
# 因而 COPY 上传给 Docker daemon 的构建上下文更小。
COPY . .

# Vite 在 production 模式自动读取 .env.production，把 API 地址编译成 /api。
RUN npm run build

# ── 第二阶段：最终运行镜像只保留 Nginx 和 dist 静态文件 ─────────────────────
# 不从 builder 继承，因此 Node、npm、源码、node_modules、编译缓存全部被丢弃；
# 相比单阶段 Node 镜像，最终镜像通常能缩小数百 MB，攻击面也明显更小。
FROM nginx:alpine AS runtime

# 只复制运行时真正需要的 Nginx 配置和编译产物。
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/ /usr/share/nginx/html/

EXPOSE 80

# 使用 exec 形式，Nginx 能正确接收 Docker/Kubernetes 的停止信号。
CMD ["nginx", "-g", "daemon off;"]
