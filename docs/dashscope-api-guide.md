# 阿里百炼 (DashScope) API 接口说明

## 两种接口模式

阿里百炼提供两套 API 接口，**API Key 通用**，但请求格式和路径不同。

---

### 1. OpenAI 兼容模式（本项目使用）

| 项目 | 值 |
|---|---|
| Base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 文生图 | `POST /compatible-mode/v1/images/generations` |
| 图片编辑 | `POST /compatible-mode/v1/images/edits` |
| 请求格式 | 与 OpenAI 一致（JSON / FormData） |
| 响应格式 | `{"data": [{"url": "..."}]}` 或 `{"data": [{"b64_json": "..."}]}` |

**特点：**
- 接口路径、请求体、响应格式与 OpenAI 完全兼容
- 可直接用 OpenAI SDK 调用
- 支持基础文生图和图片编辑
- 本项目"阿里百炼"供应商默认使用此模式

**请求示例（文生图）：**
```json
POST /compatible-mode/v1/images/generations
{
  "model": "qwen-image-2.0",
  "prompt": "一只可爱的小猫",
  "n": 1,
  "size": "1024x1024"
}
```

---

### 2. DashScope 原生模式

| 项目 | 值 |
|---|---|
| Base URL | `https://dashscope.aliyuncs.com/api/v1` |
| 文生图 | `POST /api/v1/services/aigc/text2image/image-synthesis` |
| 请求格式 | DashScope 自有格式（messages / input） |
| 响应格式 | `{"output": {"task_status": "..."}, "request_id": "..."}` |

**特点：**
- 阿里官方原生接口，功能更丰富
- 支持参考图、水印、负提示词、批量生成等高级功能
- 异步任务模式，需轮询获取结果
- 请求/响应格式与 OpenAI 不兼容

**请求示例（文生图）：**
```json
POST /api/v1/services/aigc/text2image/image-synthesis
{
  "model": "qwen-image-2.0",
  "input": {
    "prompt": "一只可爱的小猫"
  },
  "parameters": {
    "n": 1,
    "size": "1024x1024"
  }
}
```

---

### 对比总结

| | OpenAI 兼容模式 | 原生模式 |
|---|---|---|
| Base URL | `/compatible-mode/v1` | `/api/v1` |
| 路径风格 | OpenAI 风格 | DashScope 风格 |
| 文生图路径 | `/images/generations` | `/services/aigc/text2image/image-synthesis` |
| 请求格式 | OpenAI 标准 | DashScope 自有 |
| 响应格式 | OpenAI 标准 | DashScope 自有 |
| 同步/异步 | 同步 | 异步（需轮询） |
| 参考图 | ❌ | ✅ |
| 水印 | ❌ | ✅ |
| 负提示词 | ❌ | ✅ |
| API Key | 同一个 | 同一个 |
| 接入难度 | 低（兼容 OpenAI） | 高（需单独实现） |
| 本项目支持 | ✅ | ❌ |

---

### 本项目使用方式

选择"阿里百炼"供应商后，系统自动使用 OpenAI 兼容模式，通过 `/dashscope-proxy/compatible-mode/v1` 代理路径解决跨域问题，无需手动配置 Base URL。
