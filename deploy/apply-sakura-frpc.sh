#!/bin/sh
set -eu

NAMESPACE="gufy"
SECRET_NAME="sae-sakura-frpc-credentials"
DEPLOYMENT_NAME="sae-sakura-frpc"
TUNNEL_ID="28213524"
TOKEN_FILE="${1:-sae-web-tls/NATFRP_TOKEN}"
MANIFEST="deploy/sakura-frpc-deployment.yaml"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "错误：未找到 $TOKEN_FILE" >&2
  echo "请把 Sakura 访问密钥保存到该文件；脚本会自动移除复制产生的换行。" >&2
  exit 1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "错误：未找到 $MANIFEST；请从仓库根目录执行本脚本。" >&2
  exit 1
fi

# Sakura 面板复制内容可能因换行显示被保存成多行。访问密钥本身不应包含 CR/LF，
# 因此在内存中移除它们；脚本不会把清理后的密钥打印到终端或写入 Git 文件。
NATFRP_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"

if [ -z "$NATFRP_TOKEN" ]; then
  echo "错误：Sakura 访问密钥为空。" >&2
  exit 1
fi

if printf '%s' "$NATFRP_TOKEN" | LC_ALL=C grep -q '[[:space:]]'; then
  echo "错误：访问密钥清理换行后仍包含空格或制表符，请重新复制。" >&2
  exit 1
fi

chmod 600 "$TOKEN_FILE"

kubectl create secret generic "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --from-literal=NATFRP_TOKEN="$NATFRP_TOKEN" \
  --from-literal=NATFRP_TARGET="$TUNNEL_ID" \
  --dry-run=client -o yaml | kubectl apply -f -

unset NATFRP_TOKEN

kubectl apply -f "$MANIFEST"

kubectl rollout status "deployment/$DEPLOYMENT_NAME" \
  --namespace "$NAMESPACE" \
  --timeout 10m

kubectl get pod \
  --namespace "$NAMESPACE" \
  -l app.kubernetes.io/name=sae-sakura-frpc \
  -o wide

kubectl logs \
  --namespace "$NAMESPACE" \
  "deployment/$DEPLOYMENT_NAME" \
  --tail=200
