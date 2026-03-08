<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AI 图像工具箱

一个基于 AI 的图像处理工具，支持智能去水印和 AI 绘画功能。使用 React + TypeScript + Vite 构建，支持多种 AI 服务提供商。

在 AI Studio 查看应用：https://ai.studio/apps/cb76f9e3-ddb4-4fad-822c-e1d76067cbeb

## ✨ 功能特性

### 🎨 智能去水印
- 支持上传图片或拖拽上传
- 可视化画笔工具，精确标记水印区域
- 可调节画笔大小（5-100px）
- 智能 AI 修复，自然填充背景
- 支持全图智能去水印或选区精准去除

### 🖼️ AI 绘画
- 文本生成图像（Text-to-Image）
- 支持中文提示词
- 默认生成 1024x1024 高清图片
- 一键下载生成结果

### 🔧 多平台支持
- **Gemini API**：使用 Google Gemini 2.5 Flash Image 模型
- **OpenAI API**：支持 DALL-E 2/3 模型
- **自定义 API**：兼容 OpenAI 格式的第三方接口

## 🚀 快速开始

### 环境要求

- Node.js 16+ 
- npm 或 yarn

### 安装步骤

1. 克隆项目并安装依赖：
   ```bash
   git clone <repository-url>
   cd <project-folder>
   npm install
   ```

2. 配置 API Key：
   
   复制 `.env.example` 为 `.env.local`：
   ```bash
   cp .env.example .env.local
   ```
   
   编辑 `.env.local` 文件，设置你的 Gemini API Key：
   ```
   GEMINI_API_KEY=your_api_key_here
   ```

3. 启动开发服务器：
   ```bash
   npm run dev
   ```

4. 在浏览器中打开 `http://localhost:3000`

## 📦 可用命令

```bash
npm run dev      # 启动开发服务器（端口 3000）
npm run build    # 构建生产版本
npm run preview  # 预览生产构建
npm run clean    # 清理构建文件
npm run lint     # TypeScript 类型检查
```

## ⚙️ 配置说明

### API 配置

应用支持三种 API 配置方式，可在设置面板中切换：

1. **Gemini API**
   - 需要 Google AI Studio API Key
   - 获取地址：https://aistudio.google.com/apikey
   - 模型：gemini-2.5-flash-image

2. **OpenAI API**
   - 需要 OpenAI API Key
   - 获取地址：https://platform.openai.com/api-keys
   - 去水印模型：dall-e-2
   - 绘画模型：dall-e-3

3. **自定义 API**
   - 支持兼容 OpenAI 格式的第三方接口
   - 需配置：Base URL、API Key、模型名称

### 环境变量

可以通过环境变量或应用内设置配置 API Key：

- `GEMINI_API_KEY`：Gemini API 密钥（可选，也可在设置中配置）

## 🛠️ 技术栈

- **前端框架**：React 19
- **开发语言**：TypeScript
- **构建工具**：Vite 6
- **样式方案**：Tailwind CSS 4
- **AI SDK**：@google/genai
- **图标库**：lucide-react
- **动画库**：motion

## 📝 使用说明

### 去水印功能

1. 点击"去水印"标签页
2. 上传需要处理的图片
3. 使用画笔工具涂抹水印区域（可选）
4. 调整画笔大小以适应不同尺寸的水印
5. 修改提示词描述需要去除的内容（可选）
6. 点击"去除选区内的水印"或"智能去除水印"
7. 等待 AI 处理完成
8. 下载处理后的图片

### AI 绘画功能

1. 点击"AI 绘画"标签页
2. 在文本框中输入画面描述
3. 点击"开始生成"按钮
4. 等待 AI 创作完成
5. 下载生成的图片

## 🔒 隐私说明

- 所有图片处理均通过配置的 API 服务完成
- 应用本身不存储任何上传的图片或生成结果
- 请注意各 API 服务商的隐私政策和使用条款

## 📄 许可证

本项目仅供学习和研究使用。使用时请遵守相关 API 服务商的使用条款。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 联系方式

如有问题或建议，请通过 GitHub Issues 联系。
