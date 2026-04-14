import React, { useState, useRef, useEffect } from 'react';
import { Settings, Upload, Image as ImageIcon, Wand2, X, AlertCircle, Loader2, Download, SlidersHorizontal, Brush, Trash2, Eraser, Sparkles, Globe } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

type Vendor = 'gemini' | 'openai' | 'custom' | 'custom-raw';

interface AppSettings {
  vendor: Vendor;
  geminiApiKey: string;
  openaiApiKey: string;
  customBaseUrl: string;
  customApiKey: string;
  customEditModel: string;
  customGenModel: string;
  prompt: string;
}

type ImageAspect = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

const defaultSettings: AppSettings = {
  vendor: 'gemini',
  geminiApiKey: '',
  openaiApiKey: '',
  customBaseUrl: 'https://api.openai.com/v1',
  customApiKey: '',
  customEditModel: 'dall-e-2',
  customGenModel: 'dall-e-3',
  prompt: '移除此图片中的水印标志。自然地填充背景，使其看起来就像水印从未存在过一样。',
};

const aspectOptions: Array<{ value: ImageAspect; label: string; size: string }> = [
  { value: '1:1', label: '1:1', size: '1024x1024' },
  { value: '3:4', label: '3:4', size: '1024x1365' },
  { value: '4:3', label: '4:3', size: '1365x1024' },
  { value: '9:16', label: '9:16', size: '1024x1792' },
  { value: '16:9', label: '16:9', size: '1792x1024' },
];

const STORAGE_KEYS = {
  settings: 'ai-image.settings',
  genPrompt: 'ai-image.genPrompt',
  genAspect: 'ai-image.genAspect',
  activeTab: 'ai-image.activeTab',
} as const;

const normalizeBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/$/, '');

const isModelScopeBaseUrl = (baseUrl: string) => /api-inference\.modelscope\.cn/i.test(baseUrl);

// 检测是否为完整API URL（如NVIDIA的flux），不需要拼接路径
const isFullApiUrl = (url: string) => /\/genai\/|\/v1\/(?:genai|images|generate)/i.test(url);

const parseApiError = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text) return `API 请求错误: ${response.status}`;

  try {
    const data = JSON.parse(text);
    return (
      data.error?.message ||
      data.message ||
      data.msg ||
      data.detail ||
      data.code?.message ||
      `API 请求错误: ${response.status}`
    );
  } catch {
    return text;
  }
};

const getMimeTypeFromBase64 = (base64: string): string => {
  // JPEG: /9j/4AA
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  // PNG: iVBORw0KGgo
  if (base64.startsWith('iVBOR')) return 'image/png';
  // WEBP: UklGR
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
};

const getImageResult = (data: any): string | null => {
  if (data?.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
  if (data?.data?.[0]?.url) return data.data[0].url;
  // NVIDIA 格式: {artifacts: [{base64: "..."}]}
  if (data?.artifacts?.[0]?.base64) {
    const base64 = data.artifacts[0].base64;
    const mimeType = getMimeTypeFromBase64(base64);
    return `data:${mimeType};base64,${base64}`;
  }
  if (data?.output_images?.[0]?.url) return data.output_images[0].url;
  if (typeof data?.output_images?.[0] === 'string') return data.output_images[0];
  if (data?.outputs?.images?.[0]?.url) return data.outputs.images[0].url;
  if (typeof data?.outputs?.images?.[0] === 'string') return data.outputs.images[0];
  if (data?.outputs?.output_images?.[0]?.url) return data.outputs.output_images[0].url;
  if (typeof data?.outputs?.output_images?.[0] === 'string') return data.outputs.output_images[0];
  if (data?.images?.[0]?.url) return data.images[0].url;
  if (typeof data?.images?.[0] === 'string') return data.images[0];
  if (data?.output?.images?.[0]?.url) return data.output.images[0].url;
  if (typeof data?.output?.images?.[0] === 'string') return data.output.images[0];
  return null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pollModelScopeImageTask = async (
  taskUrl: string,
  headers: Record<string, string>,
): Promise<any> => {
  const taskHeaders = { ...headers };

  let lastData: any = null;

  for (let i = 0; i < 120; i++) {
    const response = await fetch(taskUrl, {
      method: 'GET',
      headers: taskHeaders,
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }

    const data = await response.json();
    lastData = data;
    if (getImageResult(data)) {
      return data;
    }

    const status = String(data?.task_status || data?.output?.task_status || '').toUpperCase();
    if (status && status !== 'PENDING' && status !== 'RUNNING' && status !== 'PROCESSING' && status !== 'SUCCEED') {
      throw new Error(`ModelScope 任务失败: ${JSON.stringify(data).slice(0, 200)}`);
    }

    await sleep(2000);
  }

  throw new Error(`ModelScope ????: ${JSON.stringify(lastData).slice(0, 300)}`);
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'watermark' | 'generate'>('watermark');
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('');
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Generation State
  const [genPrompt, setGenPrompt] = useState('一只可爱的赛博朋克风格小猫，霓虹灯背景，高画质');
  const [genAspect, setGenAspect] = useState<ImageAspect>('1:1');
  const [genResultImage, setGenResultImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Canvas & Drawing State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [hasMask, setHasMask] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const storedSettings = window.localStorage.getItem(STORAGE_KEYS.settings);
      if (storedSettings) {
        setSettings((prev) => ({ ...prev, ...JSON.parse(storedSettings) }));
      }

      const storedGenPrompt = window.localStorage.getItem(STORAGE_KEYS.genPrompt);
      if (storedGenPrompt) {
        setGenPrompt(storedGenPrompt);
      }

      const storedGenAspect = window.localStorage.getItem(STORAGE_KEYS.genAspect) as ImageAspect | null;
      if (storedGenAspect && aspectOptions.some((option) => option.value === storedGenAspect)) {
        setGenAspect(storedGenAspect);
      }

      const storedActiveTab = window.localStorage.getItem(STORAGE_KEYS.activeTab) as 'watermark' | 'generate' | null;
      if (storedActiveTab === 'watermark' || storedActiveTab === 'generate') {
        setActiveTab(storedActiveTab);
      }
    } catch (error) {
      console.error('Failed to restore app settings from localStorage.', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.genPrompt, genPrompt);
  }, [genPrompt]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.genAspect, genAspect);
  }, [genAspect]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEYS.activeTab, activeTab);
  }, [activeTab]);

  const resetStoredSettings = () => {
    setSettings(defaultSettings);
    setGenPrompt('一只可爱的赛博朋克风格小猫，霓虹灯背景，高画质');
    setGenAspect('1:1');
    setActiveTab('watermark');

    if (typeof window !== 'undefined') {
      Object.values(STORAGE_KEYS).forEach((key) => window.localStorage.removeItem(key));
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadImage(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      loadImage(file);
    }
  };

  const loadImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setImage(e.target?.result as string);
      setMimeType(file.type);
      setResultImage(null);
      setError(null);
      setHasMask(false);
    };
    reader.readAsDataURL(file);
  };

  const handleImageLoad = () => {
    if (imgRef.current && canvasRef.current) {
      canvasRef.current.width = imgRef.current.naturalWidth;
      canvasRef.current.height = imgRef.current.naturalHeight;
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
  };

  // Drawing Logic
  const getCanvasCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const getCssCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    setIsDrawing(true);
    setHasMask(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      // Scale brush size based on canvas internal resolution vs display resolution
      const rect = canvasRef.current!.getBoundingClientRect();
      const scaleX = canvasRef.current!.width / rect.width;
      ctx.lineWidth = brushSize * scaleX; 
      
      ctx.strokeStyle = 'rgba(239, 68, 68, 1)'; // Solid red for the canvas
    }
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cssCoords = getCssCoordinates(e);
    if (cssCoords) {
      setCursorPos(cssCoords);
    }

    if (!isDrawing) return;
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handlePointerOut = () => {
    setCursorPos(null);
    stopDrawing();
  };

  const clearMask = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setHasMask(false);
    }
  };

  const generateMaskBlob = async (): Promise<Blob | null> => {
    if (!canvasRef.current) return null;
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return null;

    // Fill with solid black
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);

    // Erase where the user drew (destination-out makes drawn areas transparent)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(canvasRef.current, 0, 0);

    return new Promise((resolve) => {
      tempCanvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const processImage = async () => {
    if (!image) return;
    setIsProcessing(true);
    setError(null);

    try {
      const base64Data = image.split(',')[1];
      let maskBlob: Blob | null = null;
      
      if (hasMask) {
        maskBlob = await generateMaskBlob();
      }

      if (settings.vendor === 'gemini') {
        const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('需要 Gemini API Key。请在设置中配置，或确保已设置环境变量。');
        }

        const ai = new GoogleGenAI({ apiKey });
        const parts: any[] = [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          }
        ];

        let finalPrompt = settings.prompt;
        if (maskBlob) {
          const maskBase64 = await blobToBase64(maskBlob);
          parts.push({
            inlineData: {
              data: maskBase64.split(',')[1],
              mimeType: 'image/png',
            }
          });
          finalPrompt += '\n(注：已提供第二张图片作为蒙版，请仅修改蒙版中透明区域对应的原图部分，去除水印并自然填充。)';
        }

        parts.push({ text: finalPrompt });

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts },
        });

        let foundImage = false;
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            setResultImage(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
            foundImage = true;
            break;
          }
        }
        
        if (!foundImage) {
           throw new Error('Gemini API 未返回图片。模型可能拒绝了请求或返回了文本。');
        }

      } else if (settings.vendor === 'openai' || settings.vendor === 'custom') {
        const isCustom = settings.vendor === 'custom';
        const baseUrl = isCustom ? settings.customBaseUrl : 'https://api.openai.com/v1';
        const apiUrl = `${baseUrl.replace(/\/$/, '')}/images/edits`;
        const apiKey = isCustom ? settings.customApiKey : settings.openaiApiKey;
        const model = isCustom ? settings.customEditModel : 'dall-e-2';

        if (!baseUrl || !apiKey) {
          throw new Error(`需要配置 ${isCustom ? '自定义 API' : 'OpenAI'} 的接口地址和 Key。`);
        }

        // Convert base64 to blob for multipart/form-data
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const imageBlob = new Blob([byteArray], { type: mimeType });

        const formData = new FormData();
        formData.append('image', imageBlob, 'image.png');
        if (maskBlob) {
          formData.append('mask', maskBlob, 'mask.png');
        }
        formData.append('prompt', settings.prompt);
        if (model) {
          formData.append('model', model);
        }
        // Request base64 response for easier handling
        formData.append('response_format', 'b64_json');

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          body: formData,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error?.message || `API 请求错误: ${response.status}`);
        }

        const data = await response.json();
        if (data.data && data.data[0] && data.data[0].b64_json) {
            setResultImage(`data:image/png;base64,${data.data[0].b64_json}`);
        } else if (data.data && data.data[0] && data.data[0].url) {
            setResultImage(data.data[0].url);
        } else {
            throw new Error('API 未返回预期格式的图片。请确保接口返回标准的 OpenAI 图像生成格式。');
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '处理过程中发生错误。');
    } finally {
      setIsProcessing(false);
    }
  };

  const generateImage = async () => {
    if (!genPrompt.trim()) return;
    setIsGenerating(true);
    setGenError(null);
    setGenResultImage(null);

    try {
      if (settings.vendor === 'gemini') {
        const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('?? Gemini API Key????????????????????');
        }

        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: genPrompt }] },
        });

        let foundImage = false;
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            setGenResultImage(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
            foundImage = true;
            break;
          }
        }

        if (!foundImage) {
          throw new Error('Gemini API ??????????????????????');
        }
      } else if (settings.vendor === 'openai' || settings.vendor === 'custom' || settings.vendor === 'custom-raw') {
        const isCustom = settings.vendor === 'custom';
        const isCustomRaw = settings.vendor === 'custom-raw';
        const baseUrl = isCustom || isCustomRaw ? settings.customBaseUrl : 'https://api.openai.com/v1';
        const apiKey = isCustom || isCustomRaw ? settings.customApiKey : settings.openaiApiKey;
        const model = isCustom || isCustomRaw ? settings.customGenModel : 'dall-e-3';
        const isModelScope = (isCustom || isCustomRaw) && isModelScopeBaseUrl(baseUrl);
        const isFullUrl = isCustomRaw || isFullApiUrl(baseUrl);
        const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
        const modelscopePath = normalizedBaseUrl.replace(/^https?:\/\/api-inference\.modelscope\.cn/i, '');
        // 如果是完整URL（custom-raw模式或检测到/genai/路径），直接使用，不拼接
        const apiUrl = isFullUrl
          ? normalizedBaseUrl
          : isModelScope
            ? `/modelscope-proxy${modelscopePath}/images/generations`
            : `${normalizedBaseUrl}/images/generations`;

        if (!baseUrl || !apiKey) {
          throw new Error(`???? ${isCustom ? '??? API' : 'OpenAI'} ?????? Key?`);
        }

        const selectedAspect = aspectOptions.find((option) => option.value === genAspect) || aspectOptions[0];

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        };

        const requestBody = isCustom
          ? {
              prompt: genPrompt,
              model: model || undefined,
              size: selectedAspect.size,
            }
          : {
              prompt: genPrompt,
              model: model || undefined,
              n: 1,
              size: selectedAspect.size,
              response_format: 'b64_json',
            };

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        let data = await response.json();
        if (isModelScope && data?.task_id) {
          const taskUrl = `${apiUrl.replace(/\/images\/generations$/, '')}/tasks/${data.task_id}`;
          data = await pollModelScopeImageTask(taskUrl, headers);
        }

        const imageResult = getImageResult(data);
        if (imageResult) {
          setGenResultImage(imageResult);
        } else {
          throw new Error(`API ???????????: ${JSON.stringify(data).slice(0, 200)}`);
        }
      }
    } catch (err: any) {
      console.error(err);
      setGenError(err.message || '??????????');
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadImage = () => {
    if (!resultImage) return;
    const a = document.createElement('a');
    a.href = resultImage;
    a.download = 'watermark-removed.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              <Wand2 size={18} />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">AI 图像工具箱</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex bg-zinc-100 p-1 rounded-lg mr-4">
              <button
                onClick={() => setActiveTab('watermark')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'watermark' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
              >
                <Eraser size={16} />
                去水印
              </button>
              <button
                onClick={() => setActiveTab('generate')}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'generate' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}
              >
                <Sparkles size={16} />
                AI 绘画
              </button>
            </div>
            <a
              href="https://www.xiaoyang.zone.id"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-zinc-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
              title="个人博客"
            >
              <Globe size={20} />
            </a>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-full transition-colors"
              title="设置"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
        {/* Mobile Tabs */}
        <div className="sm:hidden flex border-t border-zinc-100">
          <button
            onClick={() => setActiveTab('watermark')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all ${activeTab === 'watermark' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-zinc-500'}`}
          >
            <Eraser size={16} />
            去水印
          </button>
          <button
            onClick={() => setActiveTab('generate')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-all ${activeTab === 'generate' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-zinc-500'}`}
          >
            <Sparkles size={16} />
            AI 绘画
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1400px] mx-auto px-4 py-8">
        {activeTab === 'watermark' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start animate-in fade-in duration-300">
          {/* Left Column: Upload & Original */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">原图与选区</h2>
              {image && (
                <button 
                  onClick={() => { setImage(null); setResultImage(null); setHasMask(false); }}
                  className="text-xs text-zinc-500 hover:text-red-600 transition-colors flex items-center gap-1"
                >
                  <X size={14} /> 更换图片
                </button>
              )}
            </div>
            
            {!image ? (
              <div 
                className="min-h-[400px] md:min-h-[500px] bg-white border-2 border-dashed border-zinc-300 rounded-2xl flex flex-col items-center justify-center gap-4 hover:border-indigo-500 hover:bg-indigo-50/50 transition-all cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center">
                  <Upload size={28} />
                </div>
                <div className="text-center px-4">
                  <p className="font-medium text-zinc-900">点击上传或拖拽图片到此处</p>
                  <p className="text-sm text-zinc-500 mt-1">支持 PNG, JPG, WEBP，最大 10MB</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative rounded-2xl overflow-hidden border border-zinc-200 bg-zinc-100 shadow-inner flex justify-center items-center min-h-[400px] md:min-h-[500px]">
                  <div className="relative inline-block max-w-full">
                    <img 
                      ref={imgRef}
                      src={image} 
                      alt="原图" 
                      onLoad={handleImageLoad}
                      className="block max-w-full h-auto max-h-[70vh] object-contain pointer-events-none shadow-sm" 
                    />
                    <canvas
                      ref={canvasRef}
                      onPointerDown={startDrawing}
                      onPointerMove={draw}
                      onPointerUp={stopDrawing}
                      onPointerOut={handlePointerOut}
                      className="absolute top-0 left-0 w-full h-full touch-none"
                      style={{ cursor: 'none', opacity: 0.6 }}
                    />
                    {cursorPos && (
                      <div
                        className="pointer-events-none absolute border border-white shadow-[0_0_4px_rgba(0,0,0,0.5)] rounded-full"
                        style={{
                          left: cursorPos.x,
                          top: cursorPos.y,
                          width: brushSize,
                          height: brushSize,
                          transform: 'translate(-50%, -50%)',
                          backgroundColor: 'rgba(239, 68, 68, 0.4)',
                        }}
                      />
                    )}
                  </div>
                </div>
                
                <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                      <Brush size={16} className="text-indigo-600" />
                      <span>画笔工具</span>
                    </div>
                    <span className="text-xs text-zinc-500">涂抹需要去除的水印或文字区域</span>
                  </div>
                  <div className="flex items-center gap-4 bg-zinc-50 p-3 rounded-lg border border-zinc-200/60">
                    <div className="flex items-center gap-3 flex-1">
                      <span className="text-xs font-medium text-zinc-500 w-8">大小</span>
                      <input 
                        type="range" 
                        min="5" 
                        max="100" 
                        value={brushSize} 
                        onChange={(e) => setBrushSize(parseInt(e.target.value))}
                        className="flex-1 accent-indigo-600 h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-xs font-mono text-zinc-500 w-8 text-right">{brushSize}px</span>
                    </div>
                    <div className="w-px h-6 bg-zinc-200"></div>
                    <button 
                      onClick={clearMask}
                      disabled={!hasMask}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Trash2 size={14} />
                      清除选区
                    </button>
                  </div>
                </div>
              </div>
            )}

            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />

            {image && (
              <div className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-2">提示词 / 移除说明</label>
                  <textarea
                    value={settings.prompt}
                    onChange={(e) => setSettings({ ...settings, prompt: e.target.value })}
                    className="w-full text-sm border border-zinc-200 bg-zinc-50 rounded-lg p-3 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none h-20 transition-all"
                    placeholder="描述需要去除的内容..."
                  />
                </div>
                <button
                  onClick={processImage}
                  disabled={isProcessing}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 px-4 rounded-xl shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      处理中...
                    </>
                  ) : (
                    <>
                      <Wand2 size={18} />
                      {hasMask ? '去除选区内的水印' : '智能去除水印'}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Result */}
          <div className="space-y-4">
            <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">处理结果</h2>
            
            <div className="min-h-[400px] md:min-h-[500px] h-full bg-zinc-100 border border-zinc-200 rounded-2xl flex flex-col items-center justify-center overflow-hidden relative shadow-inner">
              {isProcessing ? (
                <div className="flex flex-col items-center gap-4 text-zinc-500">
                  <Loader2 size={32} className="animate-spin text-indigo-600" />
                  <p className="font-medium animate-pulse">AI 正在施展魔法...</p>
                </div>
              ) : resultImage ? (
                <>
                  <img src={resultImage} alt="处理结果" className="w-full h-full object-contain max-h-[70vh]" />
                  <div className="absolute bottom-4 right-4">
                    <button 
                      onClick={downloadImage}
                      className="bg-white/90 backdrop-blur text-zinc-900 p-3 rounded-full shadow-lg hover:bg-white transition-colors flex items-center justify-center"
                      title="下载图片"
                    >
                      <Download size={20} />
                    </button>
                  </div>
                </>
              ) : error ? (
                <div className="flex flex-col items-center gap-2 text-red-500 px-6 text-center">
                  <AlertCircle size={32} />
                  <p className="font-medium">处理失败</p>
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-zinc-400">
                  <ImageIcon size={48} strokeWidth={1.5} />
                  <p>处理后的图片将显示在这里</p>
                </div>
              )}
            </div>
          </div>
        </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start animate-in fade-in duration-300">
            {/* Generate Left Column */}
            <div className="space-y-4">
              <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">创作设置</h2>
              <div className="bg-white p-5 rounded-2xl border border-zinc-200 shadow-sm space-y-5">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-2">画面描述 (Prompt)</label>
                  <textarea
                    value={genPrompt}
                    onChange={(e) => setGenPrompt(e.target.value)}
                    className="w-full text-sm border border-zinc-200 bg-zinc-50 rounded-xl p-4 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none h-32 transition-all leading-relaxed"
                    placeholder="描述您想要生成的画面，例如：一只可爱的赛博朋克风格小猫，霓虹灯背景，高画质..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-2">比例</label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {aspectOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setGenAspect(option.value)}
                        className={`px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                          genAspect === option.value
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                 
                <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 text-sm text-indigo-800">
                  <p className="flex items-center gap-2 font-medium mb-1"><Sparkles size={16} /> 画质与数量说明</p>
                  <p className="text-indigo-600/80 text-xs leading-relaxed">
                    当前版本默认生成 1 张 1024x1024 分辨率的高画质图片。不同厂商的 API 对参数支持不同，后续将开放更多高级参数设置。
                  </p>
                </div>

                <button
                  onClick={generateImage}
                  disabled={isGenerating || !genPrompt.trim()}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3.5 px-4 rounded-xl shadow-sm hover:shadow transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      正在绘制中...
                    </>
                  ) : (
                    <>
                      <Wand2 size={18} />
                      开始生成
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Generate Right Column */}
            <div className="space-y-4">
              <h2 className="text-sm font-medium text-zinc-500 uppercase tracking-wider">生成结果</h2>
              
              <div className="min-h-[400px] md:min-h-[500px] h-full bg-zinc-100 border border-zinc-200 rounded-2xl flex flex-col items-center justify-center overflow-hidden relative shadow-inner">
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-4 text-zinc-500">
                    <Loader2 size={32} className="animate-spin text-indigo-600" />
                    <p className="font-medium animate-pulse">AI 正在构思画面...</p>
                  </div>
                ) : genResultImage ? (
                  <>
                    <img src={genResultImage} alt="生成结果" className="w-full h-full object-contain max-h-[70vh]" />
                    <div className="absolute bottom-4 right-4">
                      <button 
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = genResultImage;
                          a.download = 'ai-generated.png';
                          a.click();
                        }}
                        className="bg-white/90 backdrop-blur text-zinc-900 p-3 rounded-full shadow-lg hover:bg-white transition-colors flex items-center justify-center"
                        title="下载图片"
                      >
                        <Download size={20} />
                      </button>
                    </div>
                  </>
                ) : genError ? (
                  <div className="flex flex-col items-center gap-2 text-red-500 px-6 text-center">
                    <AlertCircle size={32} />
                    <p className="font-medium">生成失败</p>
                    <p className="text-sm text-red-400">{genError}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-zinc-400">
                    <ImageIcon size={48} strokeWidth={1.5} />
                    <p>生成的图片将显示在这里</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
              <div className="flex items-center gap-2 text-zinc-900 font-semibold">
                <SlidersHorizontal size={18} />
                API 设置
              </div>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="text-zinc-400 hover:text-zinc-700 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Vendor Selection */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-zinc-900">AI 厂商</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => setSettings({ ...settings, vendor: 'gemini' })}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      settings.vendor === 'gemini' 
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600' 
                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    Google Gemini
                  </button>
                  <button
                    onClick={() => setSettings({ ...settings, vendor: 'openai' })}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      settings.vendor === 'openai' 
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600' 
                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    OpenAI
                  </button>
                  <button
                    onClick={() => setSettings({ ...settings, vendor: 'custom' })}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      settings.vendor === 'custom' 
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600' 
                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    第三方/国内兼容
                  </button>
                  <button
                    onClick={() => setSettings({ ...settings, vendor: 'custom-raw' })}
                    className={`px-3 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                      settings.vendor === 'custom-raw' 
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600' 
                        : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
                    }`}
                  >
                    自定义完整URL
                  </button>
                </div>
              </div>

              {/* Gemini Settings */}
              {settings.vendor === 'gemini' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-xs leading-relaxed">
                    使用 <strong>gemini-2.5-flash-image</strong> 模型。如果未填写 API Key，将尝试使用系统内置的环境变量。
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Gemini API Key</label>
                    <input
                      type="password"
                      value={settings.geminiApiKey}
                      onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
                      className="w-full text-sm border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      placeholder="AIzaSy..."
                    />
                  </div>
                </div>
              )}

              {/* OpenAI Settings */}
              {settings.vendor === 'openai' && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <div className="bg-emerald-50 text-emerald-800 p-3 rounded-lg text-xs leading-relaxed">
                    使用 OpenAI 官方的图像编辑接口 (DALL-E 2)。支持完美的蒙版选区去水印。
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">OpenAI API Key</label>
                    <input
                      type="password"
                      value={settings.openaiApiKey}
                      onChange={(e) => setSettings({ ...settings, openaiApiKey: e.target.value })}
                      className="w-full text-sm border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      placeholder="sk-..."
                    />
                  </div>
                </div>
              )}

              {/* Custom API Settings */}
              {(settings.vendor === 'custom' || settings.vendor === 'custom-raw') && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-xs leading-relaxed">
                    {settings.vendor === 'custom-raw'
                      ? <>直接使用完整API URL，不拼接任何路径。适用于NVIDIA等特定API。</>
                      : <>适用于国内大模型或中转 API。只需填写 <strong>Base URL</strong>，系统会自动拼接 <code>/images/edits</code> 或 <code>/images/generations</code>。</>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">{settings.vendor === 'custom-raw' ? '完整 API URL' : 'Base URL (基础地址)'}</label>
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={settings.customBaseUrl}
                        onChange={(e) => setSettings({ ...settings, customBaseUrl: e.target.value })}
                        className="w-full text-sm border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono"
                        placeholder={settings.vendor === 'custom-raw' ? 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b' : 'https://api.example.com/v1'}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setSettings({...settings, customBaseUrl: 'https://api.siliconflow.cn/v1'})} className="text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-600 px-2 py-1 rounded transition-colors">硅基流动 (SiliconFlow)</button>
                        <button onClick={() => setSettings({...settings, customBaseUrl: 'https://api.chatanywhere.tech/v1'})} className="text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-600 px-2 py-1 rounded transition-colors">ChatAnywhere</button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">API Key</label>
                    <input
                      type="password"
                      value={settings.customApiKey}
                      onChange={(e) => setSettings({ ...settings, customApiKey: e.target.value })}
                      className="w-full text-sm border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                      placeholder="sk-..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">修图模型 (去水印)</label>
                      <input
                        type="text"
                        value={settings.customEditModel}
                        onChange={(e) => setSettings({ ...settings, customEditModel: e.target.value })}
                        className="w-full text-sm border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        placeholder="dall-e-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">绘图模型 (生成)</label>
                      <input
                        type="text"
                        value={settings.customGenModel}
                        onChange={(e) => setSettings({ ...settings, customGenModel: e.target.value })}
                        className="w-full text-sm border border-zinc-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        placeholder="dall-e-3"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-zinc-100 bg-zinc-50/50 flex justify-between gap-3">
              <button
                onClick={resetStoredSettings}
                className="px-4 py-2 rounded-lg font-medium text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                重置配置
              </button>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="bg-zinc-900 text-white px-5 py-2 rounded-lg font-medium text-sm hover:bg-zinc-800 transition-colors"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
