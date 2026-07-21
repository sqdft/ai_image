# AI 图片工具商业化封装方案

## 目标
将前端项目封装为可分发的产品，内置 API 密钥，限制免费试用次数，防止密钥泄露。

---

## 方案对比

### 方案一：Electron 桌面应用 (.exe)

| 项目 | 说明 |
|---|---|
| 原理 | 用 Electron 将 Web 应用打包为桌面 .exe |
| 密钥安全 | 密钥编译进代码，**仍可被逆向提取**（中等风险） |
| 试用限制 | 本地存储计数，**可被用户重置**（需加密+设备指纹） |
| 用户体验 | 双击运行，无需浏览器 |
| 成本 | 打包体积 ~150MB+，构建需 CI |
| 推荐度 | ⭐⭐⭐ |

**实现要点：**
- 用 `electron-builder` 打包
- 密钥用 `asar` 加密（非绝对安全，但提高门槛）
- 试用次数存本地 + AES 加密 + 设备指纹绑定
- 付费后通过激活码解锁

---

### 方案二：纯后端代理（推荐）

| 项目 | 说明 |
|---|---|
| 原理 | 密钥只存在服务端，前端永远不接触密钥 |
| 密钥安全 | **最高**，用户完全无法获取密钥 |
| 试用限制 | 服务端计数，**无法绕过** |
| 用户体验 | 浏览器访问，无需安装 |
| 成本 | 需服务器（CF Workers 免费额度足够起步） |
| 推荐度 | ⭐⭐⭐⭐⭐ |

**实现要点：**
- CF Pages Function 代理中内置密钥，前端不传 API Key
- Function 内加计数逻辑（按 IP / 设备指纹 / 注册账号）
- 免费次数用完返回 403
- 付费用户通过 Token 鉴权

**架构：**
```
用户浏览器 → CF Pages Function（内置密钥 + 计数） → DashScope API
                ↑
          检查试用次数
          免费用户：5次/天
          付费用户：无限次
```

---

### 方案三：Tauri 桌面应用

| 项目 | 说明 |
|---|---|
| 原理 | 类似 Electron，但用 Rust 后端，体积更小 |
| 密钥安全 | Rust 编译后逆向难度更高（较高安全） |
| 试用限制 | Rust 层计数 + 加密存储 |
| 用户体验 | 双击运行，体积 ~10MB |
| 成本 | 需学 Rust 基础，构建稍复杂 |
| 推荐度 | ⭐⭐⭐⭐ |

---

### 方案四：Docker 镜像

| 项目 | 说明 |
|---|---|
| 原理 | 打包为 Docker 镜像，用户自行部署 |
| 密钥安全 | 用户自带密钥，**无需内置** |
| 试用限制 | 不适用（用户自行部署） |
| 用户体验 | 需懂 Docker |
| 推荐度 | ⭐⭐（适合技术用户） |

---

## 推荐方案：纯后端代理（方案二）

### 为什么推荐
1. **密钥绝对安全** — 前端代码里没有任何密钥
2. **限制无法绕过** — 计数在服务端，用户无法篡改
3. **零成本起步** — CF Workers 免费额度 10万次/天
4. **无需安装** — 浏览器直接用
5. **你现有架构已具备基础** — 只需在 Function 里加密钥和计数

### 实现步骤

1. **Function 内置密钥**：移除前端 API Key 输入，Function 中硬编码密钥
2. **添加计数中间件**：按 IP 地址计数，免费用户每天 N 次
3. **添加付费鉴权**：付费用户获得 Token，Function 验证 Token 后放行
4. **前端移除 API Key 设置**：阿里百炼供应商不需要用户填 Key

### 示例代码结构
```javascript
// functions/gen.js
const API_KEY = 'sk-xxx'; // 内置密钥
const FREE_LIMIT_PER_IP = 5; // 每天5次免费

export async function onRequest(context) {
  const ip = context.request.headers.get('CF-Connecting-IP');
  const count = await getCount(ip); // 从 KV 存储读取
  
  if (count >= FREE_LIMIT_PER_IP) {
    // 检查付费 Token
    const token = context.request.headers.get('X-Auth-Token');
    if (!token || !verifyToken(token)) {
      return new Response('免费次数已用完', { status: 403 });
    }
  }
  
  await incrementCount(ip); // KV 存储计数+1
  
  // 用内置密钥调用 DashScope
  const headers = new Headers(context.request.headers);
  headers.set('Authorization', `Bearer ${API_KEY}`);
  // ... 转发请求
}
```

### 需要的 Cloudflare 服务
- **Workers** — 代理逻辑（已有）
- **KV** — 存储计数（免费额度 10万次读/天）
- **可选：D1** — 存储付费用户信息

---

## 总结

| | 密钥安全 | 限制可靠 | 实现难度 | 成本 |
|---|---|---|---|---|
| Electron | 中 | 低 | 中 | 0 |
| **后端代理** | **高** | **高** | **低** | **0** |
| Tauri | 较高 | 中 | 高 | 0 |
| Docker | N/A | N/A | 低 | 0 |

**结论：方案二（纯后端代理）最优**，安全、可靠、零成本、实现简单，且你现有架构只需小幅改动即可完成。
