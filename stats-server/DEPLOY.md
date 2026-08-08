# 访问统计系统部署指南

## 架构概览

```
用户浏览器 (index.html)
    │ POST /api/track (beacon API)
    ▼
Nginx (:443) ──→ Node.js 统计服务 (:3210)
                    │
                    ▼
                 SQLite (analytics.db)

管理浏览器 (dashboard.html)
    │ GET /api/stats (Authorization: Bearer xxx)
    ▼
Nginx (:443) ──→ Node.js 统计服务 (:3210)
```

## 文件清单

```
stats-server/
├── server.js          # 后端服务（零框架，纯 Node.js + better-sqlite3）
├── dashboard.html     # 统计仪表盘页面
├── analytics.service  # systemd 服务文件
├── nginx.conf         # Nginx 配置片段
└── package.json       # 依赖声明
```

## 部署步骤

### 1. 上传文件到服务器

```bash
# 在本地执行
scp -r stats-server/ root@43.134.106.173:/var/www/aitools/
```

### 2. 安装 Node.js 依赖

```bash
ssh root@43.134.106.173
cd /var/www/aitools/stats-server

# 安装 better-sqlite3
npm install better-sqlite3
```

### 3. 配置访问 Token

> ⚠️ `analytics.service` 已被 `.gitignore` 排除，不会上传到 GitHub。
> 仓库中只有 `analytics.service.example` 模板文件。

```bash
# 在服务器上，从模板创建实际配置文件
cp analytics.service.example analytics.service

# 生成一个随机 Token
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

# 编辑 analytics.service，将 CHANGE_ME_TO_RANDOM_TOKEN 替换为生成的值
nano analytics.service
```

### 4. 注册 systemd 服务

```bash
cp /var/www/aitools/stats-server/analytics.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable analytics
systemctl start analytics
systemctl status analytics  # 确认运行状态
```

### 5. 配置 Nginx 反代

```bash
# 编辑你的 Nginx 配置文件
nano /etc/nginx/sites-available/aitools

# 在 server { ... } 块内添加 stats-server/nginx.conf 中的 location 配置

# 测试配置
nginx -t

# 重载
nginx -s reload
```

### 6. 验证

```bash
# 健康检查
curl https://aitools.zhangqiang.hk.cn/api/health
# 应返回: {"status":"ok","events":0}

# 验证统计接口（使用 Bearer Token）
curl -H "Authorization: Bearer 你的Token" https://aitools.zhangqiang.hk.cn/api/stats

# 打开仪表盘
# 浏览器访问 https://aitools.zhangqiang.hk.cn/stats
# 输入密码登录
```

## 核心指标说明

| 指标 | 说明 |
|------|------|
| PV (Page View) | 页面浏览量，每次页面加载计 1 |
| UV (Unique Visitor) | 独立访客数，基于 2 年有效期的 cookie (vid) 去重 |
| 会话 (Session) | 30 分钟内同一 visitor 算一个 session (sid) |
| 停留时间 | 从页面加载到离开/隐藏的时长 |
| 来源 | 直接访问 / 搜索引擎 / 社交媒体 / 外链 |
| 设备 | 手机 / 平板 / 桌面 |
| 浏览器 | Chrome / Firefox / Safari / Edge 等 |
| 操作系统 | Windows / macOS / Android / iOS / Linux |

## 数据采集事件

| 事件 | 触发时机 | 采集数据 |
|------|----------|----------|
| `pageview` | 页面加载时 | URL、标题、来源、设备信息 |
| `dwell` | 页面关闭/隐藏时 | 停留时长 |
| `heartbeat` | 每 30 秒 | 当前停留时长（用于计算真实停留） |

## 安全设计

1. **Token 通过 Authorization Header 传输**: 不出现在 URL 中，不会被 Nginx 日志/浏览器历史记录泄露
2. **强随机 Token**: 48 字符 hex（192 位），不可猜测
3. **埋点接口限流**: 同一 IP 每分钟最多 30 条，防止恶意刷数据
4. **数据清洗**: 所有入库字段有长度限制，防止注入
5. **Token 存于 localStorage**: 个人轻量工具可接受；如需更高安全可加 Nginx IP 白名单
6. **限制仪表盘访问**: 可在 Nginx 中配置 IP 白名单：
   ```nginx
   location /stats {
       allow 你的IP;
       deny all;
       # ... 其余配置
   }
   ```
7. **定期备份数据**: `cp analytics.db analytics.db.bak`
8. **数据库不会无限增长**: 可定期清理旧数据：
   ```sql
   sqlite3 /var/www/aitools/stats-server/analytics.db \
     "DELETE FROM events WHERE ts < strftime('%s','now','-180 days')*1000"
   ```

## 技术栈

- 后端: 纯 Node.js (零框架) + better-sqlite3
- 数据库: SQLite (单文件，无需额外服务)
- 前端埋点: 原生 JS + sendBeacon API
- 仪表盘: 纯 HTML/CSS/JS (无框架依赖)
