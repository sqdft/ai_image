
from pathlib import Path

path = Path(r"D:/project/ai_image/src/App.tsx")
text = path.read_text(encoding="utf-8")

old_type = "type ImageAspect = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';"
new_type = """type ImageAspect =
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
  | '32:9w';"""

old_aspect = """const aspectOptions: Array<{ value: ImageAspect; label: string; size: string }> = [
  { value: '1:1', label: '1:1', size: '1024x1024' },
  { value: '3:4', label: '3:4', size: '1024x1365' },
  { value: '4:3', label: '4:3', size: '1365x1024' },
  { value: '9:16', label: '9:16', size: '1024x1792' },
  { value: '16:9', label: '16:9', size: '1792x1024' },
];"""

new_aspect = """/** 像素对齐常见中转/日日新允许的 size 枚举，避免 size invalid */
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
];"""

assert old_type in text, "type not found"
assert old_aspect in text, "aspect not found"
text = text.replace(old_type, new_type, 1)
text = text.replace(old_aspect, new_aspect, 1)

needle = '                  <label className="mb-1.5 block text-sm font-medium text-stone-700">比例</label>'
start = text.find(needle)
assert start >= 0, "ratio label not found"
end_marker = '                </div>\n                <p className="rounded-xl bg-indigo-50/70'
end = text.find(end_marker, start)
assert end >= 0, "ratio section end not found"

new_ui = """                <div>
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
"""
text = text[:start] + new_ui + text[end:]

old_probe_span = """                            {card.detectedModels.length > 0 && (
                              <span className="self-center text-[11px] text-stone-400">
                                已检测 {card.detectedModels.length} 个模型
                              </span>
                            )}"""
new_probe_span = """                            {card.detectedModels.length > 0 && (
                              <span className="self-center text-[11px] text-stone-500">
                                列表 {card.detectedModels.length} 个
                              </span>
                            )}"""
assert old_probe_span in text, "probe span not found"
text = text.replace(old_probe_span, new_probe_span, 1)

old_select_help = """                          <p className="mt-1 text-[10px] text-stone-400">
                            先检测，再下拉选择；文生图 / 图生图共用该模型
                          </p>
                        </div>"""
new_select_help = """                          <p className="mt-1 text-[10px] text-stone-400">
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
                        </div>"""
assert old_select_help in text, "select help not found"
text = text.replace(old_select_help, new_select_help, 1)

old_model_line = """                            <p>
                              模型 {card.genModel || card.editModel || '未选择'}
                            </p>"""
new_model_line = """                            <p className="font-medium text-stone-600">
                              选用 {card.genModel || card.editModel || '未选择'}
                            </p>
                            {card.detectedModels.length > 0 && (
                              <p
                                className="line-clamp-2 font-mono text-[10px] text-stone-400"
                                title={card.detectedModels.join('\\n')}
                              >
                                列表({card.detectedModels.length}):{' '}
                                {card.detectedModels.slice(0, 4).join(', ')}
                                {card.detectedModels.length > 4 ? '…' : ''}
                              </p>
                            )}"""
assert old_model_line in text, "model line not found"
text = text.replace(old_model_line, new_model_line, 1)

old_msg = """        patch({
          detectedModels: ids,
          genModel: chosen,
          editModel: chosen,
          lastProbeAt: Date.now(),
          lastProbeOk: true,
          lastProbeMsg: `检测到 ${ids.length} 个模型`,
        });
        return;
      }

      if (card.protocol === 'dashscope-native') {"""
new_msg = """        const preview = ids.slice(0, 3).join(', ');
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

      if (card.protocol === 'dashscope-native') {"""
assert old_msg in text, "probe msg not found"
text = text.replace(old_msg, new_msg, 1)

old_msg2 = """        patch({
          detectedModels: ids,
          genModel: chosen,
          editModel: chosen,
          lastProbeAt: Date.now(),
          lastProbeOk: true,
          lastProbeMsg: `检测到 ${ids.length} 个模型`,
        });
        return;
      }

      if (card.protocol === 'gemini') {"""
new_msg2 = """        const preview = ids.slice(0, 3).join(', ');
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

      if (card.protocol === 'gemini') {"""
assert old_msg2 in text, "probe msg2 not found"
text = text.replace(old_msg2, new_msg2, 1)

path.write_text(text, encoding="utf-8")
print("ok", path.stat().st_size)
