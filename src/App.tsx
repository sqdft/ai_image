import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Brush, Check, CheckCircle2, Download, Eraser, Globe,
  Image as ImageIcon, Loader2, Pencil, Plus, RefreshCw, Settings,
  Sparkles, Trash2, Upload, Wand2, X,
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

type Protocol = 'openai-compat' | 'gemini' | 'dashscope-native' | 'raw-url';

interface ProviderCard {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  apiKey: string;
  genModel: string;
  editModel: string;
  /** 检测出的模型 id 列表，用户自行选用 */
  detectedModels: string[];
  lastProbeAt?: number;
  lastProbeOk?: boolean;
  lastProbeMsg?: string;
}

interface AppPrefs {
  activeProviderId: string;
  editPrompt: string;
}

type ImageAspect =
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '9:21'
  | '21:9'
  | '32:9'
  | '32:9w';
type MainTab = 'watermark' | 'generate';
type SettingsPane = 'providers' | 'prompt';

const STORAGE = {
  providers: 'ai-image.providers.v2',
  prefs: 'ai-image.prefs.v2',
  genPrompt: 'ai-image.genPrompt',
  genAspect: 'ai-image.genAspect',
  activeTab: 'ai-image.activeTab',
  legacySettings: 'ai-image.settings',
} as const;

/** 像素对齐常见中转/日日新允许的 size 枚举，避免 size invalid */
const aspectOptions: Array<{
  value: ImageAspect;
  label: string;
  size: string;
  hint: string;
}> = [
  { value: '1:1', label: '1:1', size: '2048x2048', hint: '正方形' },
  { value: '2:3', label: '2:3', size: '1664x2496', hint: '竖图' },
  { value: '3:2', label: '3:2', size: '2496x1664', hint: '横图' },
  { value: '3:4', label: '3:4', size: '1760x2368', hint: '竖图' },
  { value: '4:3', label: '4:3', size: '2368x1760', hint: '横图' },
  { value: '4:5', label: '4:5', size: '1824x2272', hint: '竖图' },
  { value: '5:4', label: '5:4', size: '2272x1824', hint: '横图' },
  { value: '9:16', label: '9:16', size: '1536x2752', hint: '手机竖屏' },
  { value: '16:9', label: '16:9', size: '2752x1536', hint: '宽屏' },
  { value: '9:21', label: '9:21', size: '1344x3136', hint: '超长竖屏' },
  { value: '21:9', label: '21:9', size: '3072x1376', hint: '超宽' },
  { value: '32:9', label: '≈3.5:1', size: '2560x720', hint: '超超宽' },
  { value: '32:9w', label: '≈3.5:1+', size: '3072x864', hint: '超超宽' },
];

const PROTOCOL_META: Record<Protocol, { label: string; hint: string; color: string }> = {
  'openai-compat': {
    label: 'OpenAI 兼容',
    hint: '自动拼 /images/generations 与 /images/edits',
    color: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  gemini: {
    label: 'Google Gemini',
    hint: '走 @google/genai SDK',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  'dashscope-native': {
    label: '百炼原生',
    hint: '经 /gen、/edit 反代',
    color: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  'raw-url': {
    label: '完整 URL',
    hint: 'Base URL 即完整接口，不拼接路径',
    color: 'bg-amber-50 text-amber-800 border-amber-200',
  },
};

const PRESETS: Array<{
  name: string;
  protocol: Protocol;
  baseUrl: string;
  genModel: string;
  editModel: string;
}> = [
  {
    name: 'OpenAI',
    protocol: 'openai-compat',
    baseUrl: 'https://api.openai.com/v1',
    genModel: '',
    editModel: '',
  },
  {
    name: '硅基流动',
    protocol: 'openai-compat',
    baseUrl: 'https://api.siliconflow.cn/v1',
    genModel: '',
    editModel: '',
  },
  {
    name: 'ChatAnywhere',
    protocol: 'openai-compat',
    baseUrl: 'https://api.chatanywhere.tech/v1',
    genModel: '',
    editModel: '',
  },
  {
    name: '自定义中转',
    protocol: 'openai-compat',
    baseUrl: 'https://',
    genModel: '',
    editModel: '',
  },
];

const DEFAULT_EDIT_PROMPT =
  '移除此图片中的水印标志。自然地填充背景，使其看起来就像水印从未存在过一样。';

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const emptyCard = (): ProviderCard => ({
  id: uid(),
  name: '新供应商',
  protocol: 'openai-compat',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  genModel: '',
  editModel: '',
  detectedModels: [],
});

const normalizeBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/$/, '');

/** 开发态：绝对 URL 走本机 /api-proxy，允许跨域（由 Vite 转发上游） */
const isDevProxyAvailable = () =>
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    // 局域网访问 dev 时同样走代理
    /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(
      window.location.hostname,
    ));

/**
 * https://token.sensenova.cn/v1/models
 * → /api-proxy/https/token.sensenova.cn/v1/models
 */
const toProxyUrl = (absoluteUrl: string): string => {
  try {
    const u = new URL(absoluteUrl);
    if (!isDevProxyAvailable()) return absoluteUrl;
    if (u.origin === window.location.origin) return absoluteUrl;
    // 已是代理路径
    if (u.pathname.startsWith('/api-proxy/')) return absoluteUrl;
    const scheme = u.protocol.replace(':', ''); // https
    return `/api-proxy/${scheme}/${u.host}${u.pathname}${u.search}`;
  } catch {
    return absoluteUrl;
  }
};

const proxyFetch = (absoluteUrl: string, init: RequestInit = {}) => {
  const url = toProxyUrl(absoluteUrl);
  const headers = new Headers(init.headers || {});
  // 不额外加会触发预检的自定义头（路径里已带目标 host）
  return fetch(url, { ...init, headers, mode: 'cors' });
};

const isModelScopeBaseUrl = (baseUrl: string) =>
  /api-inference\.modelscope\.cn/i.test(baseUrl);
const isDashScopeBaseUrl = (baseUrl: string) =>
  /dashscope\.aliyuncs\.com/i.test(baseUrl);
const isFullApiUrl = (url: string) =>
  /\/genai\/|\/v1\/(?:genai|images|generate)/i.test(url);

const parseApiError = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => '');
  if (!text) return `请求失败 HTTP ${response.status}`;
  try {
    const data = JSON.parse(text);
    return (
      data.error?.message ||
      data.message ||
      data.msg ||
      data.detail ||
      data.code?.message ||
      `请求失败 HTTP ${response.status}`
    );
  } catch {
    return text.slice(0, 240);
  }
};

const getMimeTypeFromBase64 = (base64: string): string => {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/png';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getImageResult = (data: any): string | null => {
  if (data?.data?.[0]?.b64_json)
    return `data:image/png;base64,${data.data[0].b64_json}`;
  if (data?.data?.[0]?.url) return data.data[0].url;
  if (data?.output?.choices?.[0]?.message?.content?.[0]?.image)
    return data.output.choices[0].message.content[0].image;
  if (data?.artifacts?.[0]?.base64) {
    const base64 = data.artifacts[0].base64;
    return `data:${getMimeTypeFromBase64(base64)};base64,${base64}`;
  }
  if (data?.output_images?.[0]?.url) return data.output_images[0].url;
  if (typeof data?.output_images?.[0] === 'string') return data.output_images[0];
  if (data?.outputs?.images?.[0]?.url) return data.outputs.images[0].url;
  if (typeof data?.outputs?.images?.[0] === 'string') return data.outputs.images[0];
  if (data?.images?.[0]?.url) return data.images[0].url;
  if (typeof data?.images?.[0] === 'string') return data.images[0];
  if (data?.output?.images?.[0]?.url) return data.output.images[0].url;
  if (typeof data?.output?.images?.[0] === 'string') return data.output.images[0];
  return null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pollModelScopeImageTask = async (
  taskUrl: string,
  headers: Record<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastData: any = null;
  for (let i = 0; i < 120; i++) {
    const response = await fetch(taskUrl, { method: 'GET', headers });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    lastData = data;
    if (getImageResult(data)) return data;
    const status = String(
      data?.task_status || data?.output?.task_status || '',
    ).toUpperCase();
    if (
      status &&
      status !== 'PENDING' &&
      status !== 'RUNNING' &&
      status !== 'PROCESSING' &&
      status !== 'SUCCEED'
    ) {
      throw new Error(`ModelScope 任务失败: ${JSON.stringify(data).slice(0, 200)}`);
    }
    await sleep(2000);
  }
  throw new Error(`ModelScope 任务超时: ${JSON.stringify(lastData).slice(0, 300)}`);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const extractModelIds = (data: any): string[] => {
  const list = data?.data || data?.models || data?.result || [];
  if (!Array.isArray(list)) return [];
  const ids = list
    .map((item) => {
      if (typeof item === 'string') return item;
      return item?.id || item?.model || item?.name || '';
    })
    .filter(Boolean)
    .map(String);
  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
};

const maskKey = (key: string) => {
  if (!key) return '未填 Key';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
};

/** 兼容旧数据：对象数组 {id} 或纯字符串 */
const normalizeDetected = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    let id = '';
    if (typeof item === 'string') id = item.trim();
    else if (item && typeof item === 'object') {
      id = String((item as { id?: string }).id || '').trim();
    }
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort((a, b) => a.localeCompare(b));
};

const mergeDetected = (prev: string[], ids: string[]): string[] => {
  const seen = new Set(prev);
  const next = [...prev];
  for (const id of ids) {
    const clean = id.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    next.push(clean);
  }
  return next.sort((a, b) => a.localeCompare(b));
};


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const migrateLegacySettings = (
  raw: any,
): { cards: ProviderCard[]; activeId: string; editPrompt: string } => {
  const cards: ProviderCard[] = [];
  const push = (partial: Omit<ProviderCard, 'id' | 'detectedModels'>) => {
    cards.push({ ...partial, id: uid(), detectedModels: [] });
  };

  if (raw.geminiApiKey || raw.vendor === 'gemini') {
    push({
      name: 'Google Gemini',
      protocol: 'gemini',
      baseUrl: '',
      apiKey: raw.geminiApiKey || '',
      genModel: 'gemini-2.5-flash-image',
      editModel: 'gemini-2.5-flash-image',
    });
  }
  if (raw.openaiApiKey || raw.vendor === 'openai') {
    push({
      name: 'OpenAI',
      protocol: 'openai-compat',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: raw.openaiApiKey || '',
      genModel: 'dall-e-3',
      editModel: 'dall-e-2',
    });
  }
  if (raw.dashscopeApiKey || raw.vendor === 'dashscope') {
    push({
      name: '阿里百炼',
      protocol: 'dashscope-native',
      baseUrl: 'https://dashscope.aliyuncs.com',
      apiKey: raw.dashscopeApiKey || '',
      genModel: raw.dashscopeGenModel || 'qwen-image-2.0',
      editModel: raw.dashscopeGenModel || 'qwen-image-2.0',
    });
  }
  if (raw.customApiKey || raw.customBaseUrl) {
    const isRaw = raw.vendor === 'custom-raw';
    push({
      name: isRaw ? '自定义完整 URL' : '第三方兼容',
      protocol: isRaw ? 'raw-url' : 'openai-compat',
      baseUrl: raw.customBaseUrl || '',
      apiKey: raw.customApiKey || '',
      genModel: raw.customGenModel || '',
      editModel: raw.customEditModel || '',
    });
  }

  if (cards.length === 0) {
    const c = emptyCard();
    c.name = 'OpenAI';
    cards.push(c);
  }

  let activeId = cards[0].id;
  if (raw.vendor === 'gemini') {
    const hit = cards.find((c) => c.protocol === 'gemini');
    if (hit) activeId = hit.id;
  } else if (raw.vendor === 'dashscope') {
    const hit = cards.find((c) => c.protocol === 'dashscope-native');
    if (hit) activeId = hit.id;
  } else if (raw.vendor === 'openai') {
    const hit = cards.find((c) => c.name === 'OpenAI');
    if (hit) activeId = hit.id;
  }

  return {
    cards,
    activeId,
    editPrompt: typeof raw.prompt === 'string' ? raw.prompt : DEFAULT_EDIT_PROMPT,
  };
};

const loadInitialProviders = (): { cards: ProviderCard[]; prefs: AppPrefs } => {
  if (typeof window === 'undefined') {
    const c = emptyCard();
    c.name = 'OpenAI';
    return {
      cards: [c],
      prefs: { activeProviderId: c.id, editPrompt: DEFAULT_EDIT_PROMPT },
    };
  }

  try {
    const stored = window.localStorage.getItem(STORAGE.providers);
    const prefsRaw = window.localStorage.getItem(STORAGE.prefs);
    if (stored) {
      const cards = (JSON.parse(stored) as ProviderCard[]).map((c) => ({
        ...c,
        detectedModels: normalizeDetected(c.detectedModels),
      }));
      if (Array.isArray(cards) && cards.length > 0) {
        let prefs: AppPrefs = {
          activeProviderId: cards[0].id,
          editPrompt: DEFAULT_EDIT_PROMPT,
        };
        if (prefsRaw) {
          const p = JSON.parse(prefsRaw);
          prefs = {
            activeProviderId: p.activeProviderId || cards[0].id,
            editPrompt: p.editPrompt || DEFAULT_EDIT_PROMPT,
          };
        }
        if (!cards.some((c) => c.id === prefs.activeProviderId)) {
          prefs.activeProviderId = cards[0].id;
        }
        return { cards, prefs };
      }
    }

    const legacy = window.localStorage.getItem(STORAGE.legacySettings);
    if (legacy) {
      const m = migrateLegacySettings(JSON.parse(legacy));
      return {
        cards: m.cards,
        prefs: { activeProviderId: m.activeId, editPrompt: m.editPrompt },
      };
    }
  } catch (e) {
    console.error('load providers failed', e);
  }

  const c = emptyCard();
  c.name = 'OpenAI';
  return {
    cards: [c],
    prefs: { activeProviderId: c.id, editPrompt: DEFAULT_EDIT_PROMPT },
  };
};

export default function App() {
  const initial = useMemo(() => loadInitialProviders(), []);

  const [activeTab, setActiveTab] = useState<MainTab>('watermark');
  const [providers, setProviders] = useState<ProviderCard[]>(initial.cards);
  const [prefs, setPrefs] = useState<AppPrefs>(initial.prefs);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsPane, setSettingsPane] = useState<SettingsPane>('providers');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderCard | null>(null);
  const [probeLoadingId, setProbeLoadingId] = useState<string | null>(null);

  const [image, setImage] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('');
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [genPrompt, setGenPrompt] = useState(
    '一只可爱的赛博朋克风格小猫，霓虹灯背景，高画质',
  );
  const [genAspect, setGenAspect] = useState<ImageAspect>('1:1');
  const [genResultImage, setGenResultImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [hasMask, setHasMask] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === prefs.activeProviderId) || providers[0],
    [providers, prefs.activeProviderId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const gp = window.localStorage.getItem(STORAGE.genPrompt);
      if (gp) setGenPrompt(gp);
      const ga = window.localStorage.getItem(STORAGE.genAspect) as ImageAspect | null;
      if (ga && aspectOptions.some((o) => o.value === ga)) setGenAspect(ga);
      const tab = window.localStorage.getItem(STORAGE.activeTab) as MainTab | null;
      if (tab === 'watermark' || tab === 'generate') setActiveTab(tab);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE.providers, JSON.stringify(providers));
  }, [providers]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE.prefs, JSON.stringify(prefs));
  }, [prefs]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE.genPrompt, genPrompt);
  }, [genPrompt]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE.genAspect, genAspect);
  }, [genAspect]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE.activeTab, activeTab);
  }, [activeTab]);

  const openNewCard = (preset?: (typeof PRESETS)[number]) => {
    const card = emptyCard();
    if (preset) {
      card.name = preset.name;
      card.protocol = preset.protocol;
      card.baseUrl = preset.baseUrl;
      card.genModel = preset.genModel;
      card.editModel = preset.editModel;
    }
    setDraft(card);
    setEditingId(null);
    setSettingsPane('providers');
    setIsSettingsOpen(true);
  };

  const openEditCard = (card: ProviderCard) => {
    setDraft({ ...card });
    setEditingId(card.id);
    setSettingsPane('providers');
    setIsSettingsOpen(true);
  };

  const saveDraft = () => {
    if (!draft) return;
    const cleaned: ProviderCard = {
      ...draft,
      name: draft.name.trim() || '未命名供应商',
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      genModel: draft.genModel.trim(),
      editModel: draft.editModel.trim(),
      protocol: 'openai-compat',
    };
    setProviders((prev) => {
      if (editingId && prev.some((p) => p.id === editingId)) {
        return prev.map((p) => (p.id === editingId ? cleaned : p));
      }
      return [...prev, cleaned];
    });
    setPrefs((p) => ({ ...p, activeProviderId: cleaned.id }));
    setDraft(null);
    setEditingId(null);
  };

  const deleteCard = (id: string) => {
    setProviders((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length === 0) {
        const c = emptyCard();
        c.name = 'OpenAI';
        setPrefs((p) => ({ ...p, activeProviderId: c.id }));
        return [c];
      }
      if (prefs.activeProviderId === id) {
        setPrefs((p) => ({ ...p, activeProviderId: next[0].id }));
      }
      return next;
    });
    if (draft?.id === id) {
      setDraft(null);
      setEditingId(null);
    }
  };

  const applyPresetToDraft = (preset: (typeof PRESETS)[number]) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            name: preset.name,
            protocol: preset.protocol,
            baseUrl: preset.baseUrl,
            genModel: preset.genModel,
            editModel: preset.editModel,
          }
        : d,
    );
  };

  const probeModels = async (card: ProviderCard) => {
    setProbeLoadingId(card.id);
    const patch = (partial: Partial<ProviderCard>) => {
      setProviders((prev) =>
        prev.map((p) => (p.id === card.id ? { ...p, ...partial } : p)),
      );
      setDraft((d) => (d && d.id === card.id ? { ...d, ...partial } : d));
    };

    try {
      if (!card.apiKey?.trim()) throw new Error('请先填写 API Key');
      if (!card.baseUrl?.trim() && card.protocol !== 'gemini') {
        throw new Error('请先填写 Base URL');
      }

      // OpenAI 兼容：GET {base}/models
      if (card.protocol === 'openai-compat' || card.protocol === 'raw-url') {
        const base = normalizeBaseUrl(card.baseUrl);
        let modelsUrl: string;
        if (isModelScopeBaseUrl(base)) {
          const pathPart = base.replace(
            /^https?:\/\/api-inference\.modelscope\.cn/i,
            '',
          );
          modelsUrl = `/modelscope-proxy${pathPart}/models`;
        } else if (isDashScopeBaseUrl(base)) {
          modelsUrl = '/dashscope-proxy/compatible-mode/v1/models';
        } else {
          // 标准 OpenAI：https://xxx/v1 + /models
          modelsUrl = `${base}/models`;
        }

        const res = await (modelsUrl.startsWith('http')
          ? proxyFetch(modelsUrl, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${card.apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
            })
          : fetch(modelsUrl, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${card.apiKey.trim()}`,
                'Content-Type': 'application/json',
              },
            }));
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        const ids = extractModelIds(data);
        if (!ids.length) {
          patch({
            detectedModels: [],
            lastProbeAt: Date.now(),
            lastProbeOk: false,
            lastProbeMsg: '接口成功，但未解析到模型列表',
          });
          return;
        }
        const current = card.genModel || card.editModel || '';
        const chosen =
          current && ids.includes(current) ? current : ids[0] || '';
        const preview = ids.slice(0, 3).join(', ');
        patch({
          detectedModels: ids,
          genModel: chosen,
          editModel: chosen,
          lastProbeAt: Date.now(),
          lastProbeOk: true,
          lastProbeMsg: `检测到 ${ids.length} 个 · ${preview}${ids.length > 3 ? '…' : ''}`,
        });
        return;
      }

      if (card.protocol === 'dashscope-native') {
        if (!card.apiKey) throw new Error('请先填写 API Key');
        const res = await fetch('/dashscope-proxy/compatible-mode/v1/models', {
          headers: { Authorization: `Bearer ${card.apiKey}` },
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        const data = await res.json();
        const ids = extractModelIds(data);
        if (!ids.length) throw new Error('未解析到模型列表');
        const current = card.genModel || card.editModel || '';
        const chosen =
          current && ids.includes(current) ? current : ids[0] || '';
        const preview = ids.slice(0, 3).join(', ');
        patch({
          detectedModels: ids,
          genModel: chosen,
          editModel: chosen,
          lastProbeAt: Date.now(),
          lastProbeOk: true,
          lastProbeMsg: `检测到 ${ids.length} 个 · ${preview}${ids.length > 3 ? '…' : ''}`,
        });
        return;
      }

      if (card.protocol === 'gemini') {
        // Gemini 无标准 /models 图像列表：给常见名供选用
        const suggested = [
          'gemini-2.5-flash-image',
          'gemini-2.0-flash-preview-image-generation',
        ];
        const current = card.genModel || card.editModel || '';
        const chosen =
          current && suggested.includes(current) ? current : suggested[0] || '';
        patch({
          detectedModels: suggested,
          genModel: chosen,
          editModel: chosen,
          lastProbeAt: Date.now(),
          lastProbeOk: true,
          lastProbeMsg: `已列出 ${suggested.length} 个常用模型`,
        });
        return;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      patch({
        lastProbeAt: Date.now(),
        lastProbeOk: false,
        lastProbeMsg: msg,
      });
    } finally {
      setProbeLoadingId(null);
    }
  };

  const resetAll = () => {
    const c = emptyCard();
    c.name = 'OpenAI';
    setProviders([c]);
    setPrefs({ activeProviderId: c.id, editPrompt: DEFAULT_EDIT_PROMPT });
    setGenPrompt('一只可爱的赛博朋克风格小猫，霓虹灯背景，高画质');
    setGenAspect('1:1');
    setActiveTab('watermark');
    setDraft(null);
    setEditingId(null);
    if (typeof window !== 'undefined') {
      Object.values(STORAGE).forEach((k) => window.localStorage.removeItem(k));
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadImage(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file?.type.startsWith('image/')) loadImage(file);
  };

  const handleImageLoad = () => {
    if (imgRef.current && canvasRef.current) {
      canvasRef.current.width = imgRef.current.naturalWidth;
      canvasRef.current.height = imgRef.current.naturalHeight;
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const getCanvasCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const getCssCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    setIsDrawing(true);
    setHasMask(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.beginPath();
      ctx.moveTo(coords.x, coords.y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasRef.current.width / rect.width;
      ctx.lineWidth = brushSize * scaleX;
      ctx.strokeStyle = 'rgba(220, 38, 38, 1)';
    }
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const css = getCssCoordinates(e);
    if (css) setCursorPos(css);
    if (!isDrawing) return;
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.lineTo(coords.x, coords.y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => setIsDrawing(false);
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
    const temp = document.createElement('canvas');
    temp.width = w;
    temp.height = h;
    const ctx = temp.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(canvasRef.current, 0, 0);
    return new Promise((resolve) => {
      temp.toBlob((b) => resolve(b), 'image/png');
    });
  };

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const requireActive = useCallback(() => {
    if (!activeProvider) throw new Error('请先添加并选择供应商');
    return activeProvider;
  }, [activeProvider]);

  const processImage = async () => {
    if (!image) return;
    setIsProcessing(true);
    setError(null);
    try {
      const provider = requireActive();
      const base64Data = image.split(',')[1];
      let maskBlob: Blob | null = null;
      if (hasMask) maskBlob = await generateMaskBlob();
      const prompt = prefs.editPrompt;

      if (provider.protocol === 'gemini') {
        const apiKey =
          provider.apiKey || (process.env.GEMINI_API_KEY as string) || '';
        if (!apiKey) throw new Error('需要 Gemini API Key');
        const ai = new GoogleGenAI({ apiKey });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parts: any[] = [{ inlineData: { data: base64Data, mimeType } }];
        let finalPrompt = prompt;
        if (maskBlob) {
          const maskBase64 = await blobToBase64(maskBlob);
          parts.push({
            inlineData: {
              data: maskBase64.split(',')[1],
              mimeType: 'image/png',
            },
          });
          finalPrompt +=
            '\n(注：已提供第二张图片作为蒙版，请仅修改蒙版中透明区域对应的原图部分，去除水印并自然填充。)';
        }
        parts.push({ text: finalPrompt });
        const model =
          provider.editModel || provider.genModel || 'gemini-2.5-flash-image';
        const response = await ai.models.generateContent({
          model,
          contents: { parts },
        });
        let found = false;
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            setResultImage(
              `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            );
            found = true;
            break;
          }
        }
        if (!found) throw new Error('Gemini 未返回图片');
      } else if (provider.protocol === 'dashscope-native') {
        if (!provider.apiKey) throw new Error('需要阿里百炼 API Key');
        const model = provider.editModel || provider.genModel || 'qwen-image-2.0';
        const response = await fetch('/edit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: {
              messages: [
                {
                  role: 'user',
                  content: [
                    { image: `data:${mimeType};base64,${base64Data}` },
                    { text: prompt },
                  ],
                },
              ],
            },
            parameters: { n: 1 },
          }),
        });
        if (!response.ok) throw new Error(await parseApiError(response));
        const data = await response.json();
        const imageResult = getImageResult(data);
        if (!imageResult)
          throw new Error(`未解析到图片: ${JSON.stringify(data).slice(0, 200)}`);
        setResultImage(imageResult);
      } else {
        const baseUrl = provider.baseUrl;
        const apiKey = provider.apiKey;
        const model = provider.editModel || provider.genModel;
        if (!apiKey) throw new Error('需要 API Key');
        if (!baseUrl) throw new Error('需要 Base URL');

        const normalized = normalizeBaseUrl(baseUrl);
        const isDash = isDashScopeBaseUrl(baseUrl);
        const dashPath = normalized.replace(
          /^https?:\/\/dashscope\.aliyuncs\.com/i,
          '',
        );
        const apiUrl =
          provider.protocol === 'raw-url'
            ? normalized
            : isDash
              ? `/dashscope-proxy${dashPath}/images/edits`
              : `${normalized}/images/edits`;

        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const imageBlob = new Blob([new Uint8Array(byteNumbers)], {
          type: mimeType,
        });
        const formData = new FormData();
        formData.append('image', imageBlob, 'image.png');
        if (maskBlob) formData.append('mask', maskBlob, 'mask.png');
        formData.append('prompt', prompt);
        if (model) formData.append('model', model);
        formData.append('response_format', 'b64_json');

        const response = await (apiUrl.startsWith('http')
          ? proxyFetch(apiUrl, {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}` },
              body: formData,
            })
          : fetch(apiUrl, {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}` },
              body: formData,
            }));
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(
            errData.error?.message || `请求失败 HTTP ${response.status}`,
          );
        }
        const data = await response.json();
        if (data.data?.[0]?.b64_json) {
          setResultImage(`data:image/png;base64,${data.data[0].b64_json}`);
        } else if (data.data?.[0]?.url) {
          setResultImage(data.data[0].url);
        } else {
          throw new Error('接口未返回标准图像格式');
        }
      }
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : '处理失败');
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
      const provider = requireActive();
      const selectedAspect =
        aspectOptions.find((o) => o.value === genAspect) || aspectOptions[0];

      if (provider.protocol === 'gemini') {
        const apiKey =
          provider.apiKey || (process.env.GEMINI_API_KEY as string) || '';
        if (!apiKey) throw new Error('需要 Gemini API Key');
        const ai = new GoogleGenAI({ apiKey });
        const model =
          provider.genModel || provider.editModel || 'gemini-2.5-flash-image';
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [{ text: genPrompt }] },
        });
        let found = false;
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData) {
            setGenResultImage(
              `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
            );
            found = true;
            break;
          }
        }
        if (!found) throw new Error('Gemini 未返回图片');
      } else if (provider.protocol === 'dashscope-native') {
        if (!provider.apiKey) throw new Error('需要阿里百炼 API Key');
        const model = provider.genModel || provider.editModel || 'qwen-image-2.0';
        const response = await fetch('/gen', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: {
              messages: [{ role: 'user', content: [{ text: genPrompt }] }],
            },
            parameters: {
              size: selectedAspect.size.replace('x', '*'),
              n: 1,
            },
          }),
        });
        if (!response.ok) throw new Error(await parseApiError(response));
        const data = await response.json();
        const imageResult = getImageResult(data);
        if (!imageResult)
          throw new Error(`未解析到图片: ${JSON.stringify(data).slice(0, 200)}`);
        setGenResultImage(imageResult);
      } else {
        const baseUrl = provider.baseUrl;
        const apiKey = provider.apiKey;
        const model = provider.genModel || provider.editModel;
        if (!apiKey) throw new Error('需要 API Key');
        if (!baseUrl) throw new Error('需要 Base URL');

        const isModelScope = isModelScopeBaseUrl(baseUrl);
        const isDash = isDashScopeBaseUrl(baseUrl);
        const isFull = provider.protocol === 'raw-url' || isFullApiUrl(baseUrl);
        const normalized = normalizeBaseUrl(baseUrl);
        const modelscopePath = normalized.replace(
          /^https?:\/\/api-inference\.modelscope\.cn/i,
          '',
        );
        const dashPath = normalized.replace(
          /^https?:\/\/dashscope\.aliyuncs\.com/i,
          '',
        );
        const apiUrl = isFull
          ? normalized
          : isModelScope
            ? `/modelscope-proxy${modelscopePath}/images/generations`
            : isDash
              ? `/dashscope-proxy${dashPath}/images/generations`
              : `${normalized}/images/generations`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        };
        const requestBody =
          provider.protocol === 'openai-compat'
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

        const response = await (apiUrl.startsWith('http')
          ? proxyFetch(apiUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
            })
          : fetch(apiUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(requestBody),
            }));
        if (!response.ok) throw new Error(await parseApiError(response));
        let data = await response.json();
        if (isModelScope && data?.task_id) {
          const taskUrl = `${apiUrl.replace(/\/images\/generations$/, '')}/tasks/${data.task_id}`;
          data = await pollModelScopeImageTask(taskUrl, headers);
        }
        const imageResult = getImageResult(data);
        if (!imageResult)
          throw new Error(`未解析到图片: ${JSON.stringify(data).slice(0, 200)}`);
        setGenResultImage(imageResult);
      }
    } catch (err: unknown) {
      console.error(err);
      setGenError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadImage = (src: string | null, name: string) => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatTime = (ts?: number) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return '';
    }
  };

  return (
    <div className="app-shell text-stone-800">
      <header className="glass-header sticky top-0 z-20">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl text-white">
              <Wand2 size={16} />
            </div>
            <div>
              <div className="text-[15px] font-semibold leading-tight tracking-tight text-stone-900">
                小羊图像工具
              </div>
              <div className="hidden text-[11px] text-stone-400 sm:block">
                去水印 · 文生图 · 多供应商卡片
              </div>
            </div>
          </div>

          <nav className="seg hidden items-center sm:flex">
            <button
              type="button"
              onClick={() => setActiveTab('watermark')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm ${
                activeTab === 'watermark'
                  ? 'seg-item seg-item-active'
                  : 'seg-item hover:text-stone-700'
              }`}
            >
              <Eraser size={14} />
              去水印
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('generate')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm ${
                activeTab === 'generate'
                  ? 'seg-item seg-item-active'
                  : 'seg-item hover:text-stone-700'
              }`}
            >
              <Sparkles size={14} />
              文生图
            </button>
          </nav>

          <div className="flex items-center gap-1.5">
            {activeProvider && (
              <button
                type="button"
                onClick={() => {
                  setSettingsPane('providers');
                  setIsSettingsOpen(true);
                }}
                className="provider-pill mr-1 hidden max-w-[200px] items-center truncate rounded-full px-2.5 py-1 text-xs text-stone-600 hover:border-indigo-200 md:inline-flex"
                title="当前供应商"
              >
                <span className="mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
                {activeProvider.name}
              </button>
            )}
            <a
              href="https://www.xiaoyang.zone.id"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl p-2 text-stone-500 hover:bg-white hover:text-stone-800 hover:shadow-sm"
              title="博客"
            >
              <Globe size={18} />
            </a>
            <button
              type="button"
              onClick={() => {
                setSettingsPane('providers');
                setIsSettingsOpen(true);
              }}
              className="rounded-xl p-2 text-stone-500 hover:bg-white hover:text-stone-800 hover:shadow-sm"
              title="供应商与设置"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
        <div className="flex border-t border-stone-100/80 sm:hidden">
          <button
            type="button"
            onClick={() => setActiveTab('watermark')}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm ${
              activeTab === 'watermark'
                ? 'border-b-2 border-indigo-600 font-semibold text-indigo-700'
                : 'text-stone-500'
            }`}
          >
            <Eraser size={14} />
            去水印
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('generate')}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm ${
              activeTab === 'generate'
                ? 'border-b-2 border-indigo-600 font-semibold text-indigo-700'
                : 'text-stone-500'
            }`}
          >
            <Sparkles size={14} />
            文生图
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-7 sm:py-8">
        {activeTab === 'watermark' ? (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="section-label">原图与选区</h2>
                {image && (
                  <button
                    type="button"
                    onClick={() => {
                      setImage(null);
                      setResultImage(null);
                      setHasMask(false);
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-stone-500 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <X size={12} />
                    更换
                  </button>
                )}
              </div>

              {!image ? (
                <div
                  className="drop-zone flex min-h-[420px] cursor-pointer flex-col items-center justify-center gap-3 rounded-[18px]"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-sm ring-1 ring-indigo-100">
                    <Upload size={22} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-stone-800">点击上传或拖入图片</p>
                    <p className="mt-1 text-xs text-stone-400">支持 PNG / JPG / WEBP · 可拖放</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="surface-card relative flex min-h-[420px] items-center justify-center overflow-hidden">
                    <div className="relative inline-block max-w-full">
                      <img
                        ref={imgRef}
                        src={image}
                        alt="原图"
                        onLoad={handleImageLoad}
                        className="block max-h-[65vh] max-w-full object-contain"
                      />
                      <canvas
                        ref={canvasRef}
                        onPointerDown={startDrawing}
                        onPointerMove={draw}
                        onPointerUp={stopDrawing}
                        onPointerOut={handlePointerOut}
                        className="absolute left-0 top-0 h-full w-full touch-none"
                        style={{ cursor: 'none', opacity: 0.55 }}
                      />
                      {cursorPos && (
                        <div
                          className="pointer-events-none absolute rounded-full border border-white shadow"
                          style={{
                            left: cursorPos.x,
                            top: cursorPos.y,
                            width: brushSize,
                            height: brushSize,
                            transform: 'translate(-50%, -50%)',
                            backgroundColor: 'rgba(220, 38, 38, 0.35)',
                          }}
                        />
                      )}
                    </div>
                  </div>

                  <div className="surface-card p-3.5">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 font-medium text-stone-700">
                        <Brush size={14} />
                        画笔
                      </span>
                      <span className="text-xs text-stone-400">涂抹需要处理的区域</span>
                    </div>
                    <div className="flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2.5 ring-1 ring-stone-100">
                      <span className="w-8 text-xs text-stone-500">大小</span>
                      <input
                        type="range"
                        min={5}
                        max={100}
                        value={brushSize}
                        onChange={(e) => setBrushSize(parseInt(e.target.value, 10))}
                        className="h-1.5 flex-1 cursor-pointer accent-indigo-600"
                      />
                      <span className="w-10 text-right font-mono text-xs text-stone-500">
                        {brushSize}
                      </span>
                      <button
                        type="button"
                        onClick={clearMask}
                        disabled={!hasMask}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                        清除
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />

              {image && (
                <div className="surface-card space-y-3 p-4">
                  <label className="block text-sm font-medium text-stone-700">修图说明</label>
                  <textarea
                    value={prefs.editPrompt}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, editPrompt: e.target.value }))
                    }
                    rows={3}
                    className="field w-full resize-none text-sm"
                  />
                  <button
                    type="button"
                    onClick={processImage}
                    disabled={isProcessing}
                    className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        处理中…
                      </>
                    ) : (
                      <>
                        <Wand2 size={16} />
                        {hasMask ? '处理选区' : '智能去水印'}
                      </>
                    )}
                  </button>
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="section-label">结果</h2>
              <div className="result-empty surface-card relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden">
                {isProcessing ? (
                  <div className="flex flex-col items-center gap-2 text-indigo-500">
                    <Loader2 size={28} className="animate-spin" />
                    <p className="text-sm">处理中</p>
                  </div>
                ) : resultImage ? (
                  <>
                    <img
                      src={resultImage}
                      alt="结果"
                      className="max-h-[65vh] w-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => downloadImage(resultImage, 'watermark-removed.png')}
                      className="floating-download absolute bottom-3 right-3 rounded-full p-2.5 hover:bg-indigo-50"
                    >
                      <Download size={18} />
                    </button>
                  </>
                ) : error ? (
                  <div className="flex max-w-sm flex-col items-center gap-2 px-4 text-center text-red-600">
                    <AlertCircle size={28} />
                    <p className="text-sm font-medium">失败</p>
                    <p className="text-xs text-red-500/90">{error}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-stone-400">
                    <ImageIcon size={40} strokeWidth={1.25} />
                    <p className="text-sm">结果会显示在这里</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
            <section className="space-y-3">
              <h2 className="section-label">创作</h2>
              <div className="surface-card space-y-4 p-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-stone-700">描述</label>
                  <textarea
                    value={genPrompt}
                    onChange={(e) => setGenPrompt(e.target.value)}
                    rows={5}
                    className="field w-full resize-none text-sm leading-relaxed"
                    placeholder="描述想生成的画面…"
                  />
                </div>
                <div>
                <div>
                  <div className="mb-1.5 flex items-end justify-between gap-2">
                    <label className="block text-sm font-medium text-stone-700">比例 / 像素</label>
                    <span className="font-mono text-[11px] text-indigo-700">
                      {(aspectOptions.find((o) => o.value === genAspect) || aspectOptions[0]).size}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {aspectOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        title={`${opt.hint} · 实际请求 size=${opt.size}`}
                        onClick={() => setGenAspect(opt.value)}
                        className={`flex flex-col items-center gap-0.5 px-1 py-2 ${
                          genAspect === opt.value
                            ? 'aspect-btn aspect-btn-active'
                            : 'aspect-btn text-stone-600 hover:border-indigo-200 hover:bg-white'
                        }`}
                      >
                        <span className="text-sm font-semibold leading-none">{opt.label}</span>
                        <span
                          className={`font-mono text-[10px] leading-none ${
                            genAspect === opt.value ? 'text-white/85' : 'text-stone-400'
                          }`}
                        >
                          {opt.size}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-stone-400">
                    请求会带上实际像素（如 2048x2048）。当前中转只接受固定枚举尺寸。
                  </p>
                </div>
                </div>
                <p className="rounded-xl bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900/70 ring-1 ring-indigo-100">
                  当前供应商：
                  <span className="font-semibold text-indigo-950">
                    {activeProvider?.name || '未选择'}
                  </span>
                  {activeProvider?.genModel ? ` · 模型 ${activeProvider.genModel}` : ''}
                </p>
                <button
                  type="button"
                  onClick={generateImage}
                  disabled={isGenerating || !genPrompt.trim()}
                  className="btn-primary flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      生成中…
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      开始生成
                    </>
                  )}
                </button>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="section-label">结果</h2>
              <div className="result-empty surface-card relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden">
                {isGenerating ? (
                  <div className="flex flex-col items-center gap-2 text-indigo-500">
                    <Loader2 size={28} className="animate-spin" />
                    <p className="text-sm">生成中</p>
                  </div>
                ) : genResultImage ? (
                  <>
                    <img
                      src={genResultImage}
                      alt="生成"
                      className="max-h-[65vh] w-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => downloadImage(genResultImage, 'ai-generated.png')}
                      className="floating-download absolute bottom-3 right-3 rounded-full p-2.5 hover:bg-indigo-50"
                    >
                      <Download size={18} />
                    </button>
                  </>
                ) : genError ? (
                  <div className="flex max-w-sm flex-col items-center gap-2 px-4 text-center text-red-600">
                    <AlertCircle size={28} />
                    <p className="text-sm font-medium">失败</p>
                    <p className="text-xs text-red-500/90">{genError}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-stone-400">
                    <ImageIcon size={40} strokeWidth={1.25} />
                    <p className="text-sm">生成结果显示在这里</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      {isSettingsOpen && (
        <div className="modal-scrim fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="modal-panel flex h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl sm:h-auto sm:max-h-[88vh] sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-stone-100 bg-gradient-to-r from-indigo-50/50 via-white to-fuchsia-50/40 px-4 py-3.5 sm:px-5">
              <div>
                <h3 className="text-base font-semibold text-stone-900">设置</h3>
                <p className="text-xs text-stone-400">OpenAI 兼容 · 检测模型列表后点选使用</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  setDraft(null);
                  setEditingId(null);
                }}
                className="rounded-xl p-1.5 text-stone-400 hover:bg-white hover:text-stone-700 hover:shadow-sm"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex gap-1 border-b border-stone-100 px-4 pt-2 sm:px-5">
              <button
                type="button"
                onClick={() => setSettingsPane('providers')}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  settingsPane === 'providers'
                    ? 'border-indigo-600 font-semibold text-indigo-700'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                供应商
              </button>
              <button
                type="button"
                onClick={() => setSettingsPane('prompt')}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  settingsPane === 'prompt'
                    ? 'border-indigo-600 font-semibold text-indigo-700'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                }`}
              >
                默认提示词
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {settingsPane === 'prompt' ? (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-stone-700">去水印默认说明</label>
                  <textarea
                    value={prefs.editPrompt}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, editPrompt: e.target.value }))
                    }
                    rows={5}
                    className="field w-full resize-none text-sm"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="section-label">快速添加（OpenAI 兼容）</span>
                      <button
                        type="button"
                        onClick={() => openNewCard()}
                        className="btn-ghost inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium"
                      >
                        <Plus size={12} />
                        空白卡片
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {PRESETS.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => openNewCard(p)}
                          className="rounded-full border border-indigo-100 bg-white px-2.5 py-1 text-xs text-indigo-700 shadow-sm hover:border-indigo-200 hover:bg-indigo-50"
                        >
                          + {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {providers.map((card) => {
                      const active = card.id === prefs.activeProviderId;
                      return (
                        <div
                          key={card.id}
                          className={`provider-card relative p-3.5 ${
                            active ? 'provider-card-active' : ''
                          }`}
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="truncate text-sm font-semibold text-stone-900">
                                  {card.name}
                                </h4>
                                {active && (
                                  <span className="shrink-0 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                                    使用中
                                  </span>
                                )}
                              </div>
                              <span className="mt-1 inline-block rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                                OpenAI 兼容
                              </span>
                            </div>
                            <div className="flex shrink-0 gap-0.5">
                              <button
                                type="button"
                                onClick={() => openEditCard(card)}
                                className="rounded-lg p-1.5 text-stone-400 hover:bg-indigo-50 hover:text-indigo-700"
                                title="编辑"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteCard(card.id)}
                                className="rounded-lg p-1.5 text-stone-400 hover:bg-rose-50 hover:text-rose-600"
                                title="删除"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1 text-[11px] text-stone-500">
                            {card.baseUrl ? (
                              <p className="truncate font-mono" title={card.baseUrl}>
                                {card.baseUrl}
                              </p>
                            ) : (
                              <p className="text-stone-400">无 Base URL</p>
                            )}
                            <p>{maskKey(card.apiKey)}</p>
                            <p className="font-medium text-stone-600">
                              选用 {card.genModel || card.editModel || '未选择'}
                            </p>
                            {card.detectedModels.length > 0 && (
                              <p
                                className="line-clamp-2 font-mono text-[10px] text-stone-400"
                                title={card.detectedModels.join('\n')}
                              >
                                列表({card.detectedModels.length}):{' '}
                                {card.detectedModels.slice(0, 4).join(', ')}
                                {card.detectedModels.length > 4 ? '…' : ''}
                              </p>
                            )}
                            {card.lastProbeMsg && (
                              <p
                                className={`flex items-center gap-1 ${
                                  card.lastProbeOk ? 'text-emerald-600' : 'text-amber-600'
                                }`}
                              >
                                {card.lastProbeOk ? (
                                  <CheckCircle2 size={11} />
                                ) : (
                                  <AlertCircle size={11} />
                                )}
                                <span className="truncate">
                                  {card.lastProbeMsg}
                                  {card.lastProbeAt ? ` · ${formatTime(card.lastProbeAt)}` : ''}
                                </span>
                              </p>
                            )}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {!active && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPrefs((p) => ({
                                    ...p,
                                    activeProviderId: card.id,
                                  }))
                                }
                                className="btn-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                              >
                                <Check size={12} />
                                设为当前
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => probeModels(card)}
                              disabled={probeLoadingId === card.id}
                              className="btn-ghost inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] disabled:opacity-50"
                            >
                              {probeLoadingId === card.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <RefreshCw size={12} />
                              )}
                              检测模型
                            </button>
                            {card.detectedModels.length > 0 && (
                              <span className="self-center text-[11px] text-stone-500">
                                列表 {card.detectedModels.length} 个
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {draft && (
                    <div className="rounded-2xl border border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-white p-4 shadow-sm">
                      <div className="mb-4 flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-stone-900">
                            {editingId ? '编辑供应商' : '新建供应商'}
                          </h4>
                          <p className="mt-0.5 text-[11px] text-stone-400">
                            OpenAI 兼容格式 · 先填地址与 Key，再检测模型
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft(null);
                            setEditingId(null);
                          }}
                          className="text-xs text-stone-500 hover:text-stone-800"
                        >
                          取消
                        </button>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-600">
                            名称
                          </label>
                          <input
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            className="field text-sm"
                            placeholder="例如：我的中转"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-600">
                            Base URL
                          </label>
                          <input
                            value={draft.baseUrl}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                baseUrl: e.target.value,
                                protocol: 'openai-compat',
                              })
                            }
                            className="field font-mono text-sm"
                            placeholder="https://api.openai.com/v1"
                          />
                          <p className="mt-1 text-[10px] text-stone-400">
                            需可访问 OpenAI 兼容接口：/models、/images/generations、/images/edits
                          </p>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-600">
                            API Key
                          </label>
                          <input
                            type="password"
                            value={draft.apiKey}
                            onChange={(e) =>
                              setDraft({ ...draft, apiKey: e.target.value })
                            }
                            className="field text-sm"
                            placeholder="sk-…"
                          />
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-medium text-stone-600">
                            模型
                          </label>
                          <select
                            value={draft.genModel || draft.editModel || ''}
                            onChange={(e) => {
                              const m = e.target.value;
                              setDraft({
                                ...draft,
                                genModel: m,
                                editModel: m,
                              });
                            }}
                            className="field text-sm"
                          >
                            <option value="">
                              {draft.detectedModels.length
                                ? '请选择模型'
                                : '请先点「检测模型列表」'}
                            </option>
                            {draft.genModel &&
                              !draft.detectedModels.includes(draft.genModel) && (
                                <option value={draft.genModel}>
                                  {draft.genModel}（当前）
                                </option>
                              )}
                            {draft.detectedModels.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[10px] text-stone-400">
                            先检测，再下拉选择；文生图 / 图生图共用该模型
                          </p>
                          {draft.lastProbeMsg && (
                            <p
                              className={`mt-1 text-[11px] ${
                                draft.lastProbeOk ? 'text-emerald-600' : 'text-amber-700'
                              }`}
                            >
                              {draft.lastProbeOk ? '✓' : '!'} {draft.lastProbeMsg}
                              {draft.lastProbeAt
                                ? ` · ${new Date(draft.lastProbeAt).toLocaleString()}`
                                : ''}
                            </p>
                          )}
                          {draft.detectedModels.length > 0 && (
                            <div className="mt-2 max-h-28 overflow-y-auto rounded-xl border border-stone-100 bg-stone-50/80 px-2.5 py-2">
                              <div className="mb-1 text-[10px] font-medium text-stone-500">
                                检测到的模型 id（共 {draft.detectedModels.length} 个）
                              </div>
                              <div className="space-y-0.5 font-mono text-[10px] leading-relaxed text-stone-600">
                                {draft.detectedModels.map((m) => (
                                  <div
                                    key={m}
                                    className={
                                      m === (draft.genModel || draft.editModel)
                                        ? 'font-semibold text-indigo-700'
                                        : ''
                                    }
                                  >
                                    {m}
                                    {m === (draft.genModel || draft.editModel) ? ' ← 当前' : ''}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              const cleaned: ProviderCard = {
                                ...draft,
                                name: draft.name.trim() || '未命名供应商',
                                baseUrl: draft.baseUrl.trim(),
                                apiKey: draft.apiKey.trim(),
                                genModel: draft.genModel.trim(),
                                editModel: draft.editModel.trim(),
                                protocol: 'openai-compat',
                              };
                              setProviders((prev) => {
                                if (editingId && prev.some((p) => p.id === editingId)) {
                                  return prev.map((p) =>
                                    p.id === editingId ? cleaned : p,
                                  );
                                }
                                return [...prev, cleaned];
                              });
                              setPrefs((p) => ({
                                ...p,
                                activeProviderId: cleaned.id,
                              }));
                              setDraft(cleaned);
                              setEditingId(cleaned.id);
                              void probeModels(cleaned);
                            }}
                            disabled={probeLoadingId === draft.id}
                            className="btn-primary inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
                          >
                            {probeLoadingId === draft.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                            检测模型列表
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (!draft) return;
                              const cleaned: ProviderCard = {
                                ...draft,
                                name: draft.name.trim() || '未命名供应商',
                                baseUrl: draft.baseUrl.trim(),
                                apiKey: draft.apiKey.trim(),
                                genModel: draft.genModel.trim(),
                                editModel: draft.editModel.trim(),
                                protocol: 'openai-compat',
                              };
                              setProviders((prev) => {
                                if (editingId && prev.some((p) => p.id === editingId)) {
                                  return prev.map((p) =>
                                    p.id === editingId ? cleaned : p,
                                  );
                                }
                                return [...prev, cleaned];
                              });
                              setPrefs((p) => ({
                                ...p,
                                activeProviderId: cleaned.id,
                              }));
                              setDraft(null);
                              setEditingId(null);
                            }}
                            className="btn-ghost rounded-xl px-4 py-2 text-sm font-medium"
                          >
                            保存
                          </button>
                          {draft.lastProbeMsg && (
                            <span
                              className={`text-[11px] ${
                                draft.lastProbeOk
                                  ? 'text-emerald-600'
                                  : 'text-amber-600'
                              }`}
                            >
                              {draft.lastProbeMsg}
                            </span>
                          )}
                        </div>

                        
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-stone-100 bg-gradient-to-r from-stone-50 to-indigo-50/30 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={resetAll}
                className="text-sm text-rose-600 hover:text-rose-700"
              >
                清空全部配置
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  setDraft(null);
                  setEditingId(null);
                }}
                className="btn-primary rounded-xl px-5 py-2 text-sm font-semibold"
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
