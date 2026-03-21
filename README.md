# AI 图像工具箱

一个基于 React + TypeScript + Vite 的 AI 图像工具项目，支持两类核心能力：

- 图片去水印 / 局部修图
- AI 文生图

当前项目已经支持多种接口接入方式，包括 Gemini、OpenAI，以及兼容 OpenAI 风格的第三方 / 国内中转接口。

个人博客：
[https://www.xiaoyang.zone.id](https://www.xiaoyang.zone.id)

## 功能概览

### 1. 图片去水印

- 支持上传 PNG / JPG / WEBP 图片
- 支持画笔手动涂抹需要处理的区域
- 支持调整画笔大小
- 支持整图处理或局部蒙版处理
- 处理结果可直接预览和下载

### 2. AI 文生图

- 支持中文 Prompt
- 支持比例选择
- 当前内置比例包括：
  - `1:1`
  - `3:4`
  - `4:3`
  - `9:16`
  - `16:9`
- 生成结果可直接预览和下载

### 3. 多接口支持

- `Google Gemini`
- `OpenAI`
- `第三方 / 国内兼容接口`
- 已对 `ModelScope` 做了开发环境代理适配

### 4. 本地缓存

项目会自动缓存以下内容到浏览器本地：

- API 配置
- 生成 Prompt
- 生成比例
- 当前标签页

同时在设置面板中提供了“重置配置”按钮，可以一键清空本地缓存。

## 技术栈

- React 19
- TypeScript
- Vite 6
- Tailwind CSS 4
- `@google/genai`
- `lucide-react`

## 运行环境

- Node.js 18+
- npm 9+

## 安装与启动

### 1. 安装依赖

```bash
npm install
```

### 2. 启动开发环境

```bash
npm run dev
```

默认启动地址：

```text
http://localhost:3000
```

### 3. 构建生产版本

```bash
npm run build
```

### 4. 本地预览生产构建

```bash
npm run preview
```

## 脚本说明

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

注意：
`package.json` 中还保留了一个 `npm run clean`，但当前写法是 Unix 风格的 `rm -rf dist`，如果你在 Windows PowerShell 下直接执行，可能需要改成兼容 Windows 的写法。

## API 配置说明

项目设置面板中支持三种接入方式。

### Gemini

- 填写 `Gemini API Key`
- 使用模型：`gemini-2.5-flash-image`

如果你已经在环境变量中提供了：

```env
GEMINI_API_KEY=your_key
```

前端也会优先读取它。

### OpenAI

- 填写 `OpenAI API Key`
- 文生图默认模型：`dall-e-3`
- 图片编辑默认模型：`dall-e-2`

### 第三方 / 国内兼容

你需要填写：

- `Base URL`
- `API Key`
- `修图模型`
- `绘图模型`

项目会自动拼接接口路径：

- 生成图：`/images/generations`
- 修图：`/images/edits`

例如如果接口文档是：

```text
https://api.example.com/v1/images/generations
```

那你应当填写：

```text
https://api.example.com/v1
```

### ModelScope 说明

如果你使用的是：

```text
https://api-inference.modelscope.cn/v1
```

项目开发环境会通过 Vite 代理转发请求，以规避浏览器 CORS 限制。

推荐填写示例：

- Base URL: `https://api-inference.modelscope.cn/v1`
- 绘图模型：`Qwen/Qwen-Image-2512`
- 修图模型：`Qwen/Qwen-Image-Edit`

注意：
ModelScope 采用异步任务式返回，生成速度主要取决于服务端排队和模型本身，不是前端代码造成的。

## 使用方式

### 图片去水印

1. 打开“去水印”标签页
2. 上传图片
3. 用画笔涂抹需要处理的区域
4. 调整提示词
5. 点击处理按钮
6. 等待结果返回
7. 下载图片

### AI 文生图

1. 打开“AI 绘画”标签页
2. 输入 Prompt
3. 选择比例
4. 点击“开始生成”
5. 等待返回结果
6. 下载图片

## 项目特点

- 前端纯本地界面，交互直接
- 设置自动缓存，避免重复填写
- 对第三方接口做了基础兼容
- 对 ModelScope 做了开发环境代理支持

## 隐私说明

- 图片与文本请求会发送到你配置的 API 服务商
- 项目本身不会把你的配置上传到项目作者服务器
- API Key 仅保存在当前浏览器本地存储中

如果你在公共设备上使用，建议完成后点击“重置配置”清除本地缓存。

## 后续可继续扩展的方向

- 增加质量 / 分辨率选项
- 增加生成历史记录
- 增加任务状态可视化
- 优化不同中转接口的兼容策略

## 联系方式

- 个人博客：[https://www.xiaoyang.zone.id](https://www.xiaoyang.zone.id)
