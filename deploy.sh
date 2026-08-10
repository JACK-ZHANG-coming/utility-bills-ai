#!/bin/bash
# 一键部署到腾讯云服务器
# 用法: ./deploy.sh

SERVER="root@43.134.106.173"
REMOTE_DIR="/var/www/aitools/dist"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

# 需要部署的文件
FILES=(
    "index.html"
    "favicon.ico"
    "favicon-16x16.png"
    "favicon-32x32.png"
    "favicon-64x64.png"
    "favicon-96x96.png"
    "apple-touch-icon.png"
    "icon-192x192.png"
    "icon-512x512.png"
    "robots.txt"
    "sitemap.xml"
)

echo "🚀 开始部署到 $SERVER:$REMOTE_DIR"
echo "--------------------------------"

# 检查文件是否存在
MISSING=0
for f in "${FILES[@]}"; do
    if [ ! -f "$LOCAL_DIR/$f" ]; then
        echo "⚠️  文件不存在: $f"
        MISSING=1
    fi
done

if [ "$MISSING" -eq 1 ]; then
    echo "❌ 部分文件缺失，已跳过"
fi

# 上传文件
scp "${FILES[@]/#/$LOCAL_DIR/}" "$SERVER:$REMOTE_DIR/"

if [ $? -eq 0 ]; then
    echo "--------------------------------"
    echo "✅ 部署成功！"
    echo "🔗 https://aitools.zhangqiang.hk.cn/"
else
    echo "--------------------------------"
    echo "❌ 部署失败，请检查网络或 SSH 配置"
    exit 1
fi
