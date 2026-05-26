/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sliders, Key, Hash, HelpCircle, Save, Eye, EyeOff, FileText, Check } from 'lucide-react';
import { LLMModel, LLMProvider, SystemSettings } from '../types';

export const PROVIDER_MODELS: LLMModel[] = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', description: '翻译冠军 · 速度极快且高度流畅' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', description: '谷歌旗舰大模 · 推理与多模意图强悍' },
  { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek', description: '高效推理 · 极具性价比' },
  { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', description: '综合翻译质量极高 · 带有原生思维链' },
  { value: 'gpt-4.1', label: 'GPT-4.1 Standard', provider: 'openai', description: '通用型专家大模 · 语境适配极度均衡' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', description: '轻量快速 · 兼顾翻译对应' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'claude', description: '长文编辑首选 · 语流还原无可比拟' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'claude', description: '极致敏捷 · 精简表达' },
];

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SystemSettings;
  onSave: (settings: SystemSettings) => void;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  onClose,
  settings,
  onSave,
}) => {
  const [localSettings, setLocalSettings] = React.useState<SystemSettings>({ ...settings });
  const [showKey, setShowKey] = React.useState(false);

  // Synchronize from props when settings drawer is opened
  useEffect(() => {
    if (isOpen) {
      setLocalSettings({ ...settings });
    }
  }, [isOpen, settings]);

  const filteredModels = useMemo(() => {
    return PROVIDER_MODELS.filter((m) => m.provider === localSettings.provider);
  }, [localSettings.provider]);

  // Handle provider changes by auto-switching the selected default model
  const handleProviderChange = (prov: LLMProvider) => {
    const firstModel = PROVIDER_MODELS.find((m) => m.provider === prov);
    setLocalSettings((prev) => ({
      ...prev,
      provider: prov,
      model: firstModel ? firstModel.value : '',
    }));
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
          />

          {/* Settings Panel Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className="relative w-full max-w-lg bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-100 dark:border-slate-800"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-brand-500" />
                <h3 className="font-serif text-lg font-semibold text-slate-800 dark:text-slate-100">
                  偏好设置 · Engine Preferences
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Config Sections - Scrollable body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Provider Config Group */}
              <div className="space-y-3">
                <label className="block text-xs font-mono font-semibold text-slate-400 uppercase tracking-widest">
                  API 服务商 selection
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['gemini', 'deepseek', 'openai', 'claude'] as LLMProvider[]).map((prov) => {
                    const isSelected = localSettings.provider === prov;
                    const labels: Record<LLMProvider, string> = {
                      gemini: 'Google Gemini',
                      deepseek: 'DeepSeek AI',
                      openai: 'OpenAI GPT',
                      claude: 'Anthropic Claude',
                    };
                    return (
                      <button
                        key={prov}
                        onClick={() => handleProviderChange(prov)}
                        className={`p-3 rounded-xl border text-left text-xs font-medium transition-all flex flex-col gap-1 cursor-pointer ${
                          isSelected
                            ? 'border-brand-500 bg-brand-50/40 dark:bg-brand-950/20 text-brand-600 dark:text-brand-400'
                            : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="capitalize text-sm font-sans">{labels[prov]}</span>
                        <span className="opacity-60 text-[9px] font-mono tracking-wider">
                          {prov === 'gemini' ? '免费额度 · 推荐' : '需绑定自定义密钥'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* API Key Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-mono font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5" />
                    API 验证密钥
                  </label>
                  <span className="text-[10px] text-slate-400 font-sans opacity-80 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                    本机安全私有保存
                  </span>
                </div>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    placeholder={
                      localSettings.provider === 'gemini'
                        ? '已内置服务器端专用 API 密钥 (留空即自动启用免费额度)'
                        : `请输入您的 ${localSettings.provider.toUpperCase()} 专属密钥`
                    }
                    value={localSettings.apiKey}
                    onChange={(e) =>
                      setLocalSettings({ ...localSettings, apiKey: e.target.value })
                    }
                    className="w-full pl-3 pr-10 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all placeholder:text-[11px] placeholder:text-slate-400"
                  />
                  <button
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal">
                  存储在浏览器 localState 中，绝不上报，保障数据隐私。Gemini 服务支持直接免密钥调用服务器端。
                </p>
              </div>

              {/* Model Select */}
              <div className="space-y-2">
                <label className="block text-xs font-mono font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  当前核心译文模型
                </label>
                <div className="space-y-2">
                  <select
                    value={localSettings.model}
                    onChange={(e) => setLocalSettings({ ...localSettings, model: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-sans cursor-pointer"
                  >
                    {filteredModels.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {/* Model Description Box */}
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800/80 text-xs text-slate-500 dark:text-slate-400 italic">
                    {PROVIDER_MODELS.find((m) => m.value === localSettings.model)?.description || ''}
                  </div>
                </div>
              </div>

              {/* Numeric Iterative Rounds Slider */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5" />
                    多智能体协商迭代轮次 (Round Count)
                  </label>
                  <span className="font-mono text-sm font-semibold text-brand-500 bg-brand-50 dark:bg-brand-950/40 px-2.5 py-0.5 rounded-full">
                    {localSettings.rounds} 轮
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    disabled={localSettings.rounds <= 1}
                    onClick={() =>
                      setLocalSettings((prev) => ({ ...prev, rounds: Math.max(1, prev.rounds - 1) }))
                    }
                    className="px-3.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-100 disabled:dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 font-bold transition-all text-sm cursor-pointer"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    step="1"
                    value={localSettings.rounds}
                    onChange={(e) =>
                      setLocalSettings((prev) => ({ ...prev, rounds: parseInt(e.target.value) }))
                    }
                    className="flex-1 accent-brand-500 cursor-pointer"
                  />
                  <button
                    disabled={localSettings.rounds >= 5}
                    onClick={() =>
                      setLocalSettings((prev) => ({ ...prev, rounds: Math.min(5, prev.rounds + 1) }))
                    }
                    className="px-3.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-100 disabled:dark:hover:bg-slate-800 rounded-lg text-slate-700 dark:text-slate-300 font-bold transition-all text-sm cursor-pointer"
                  >
                    +
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-normal mt-1">
                  每多一次迭代，各智能体将深入审验上一次的最优译文并提供进一步的修正批判，直至最高共识裁决。推荐 2 轮最佳。
                </p>
              </div>

              {/* Custom style directive prompts */}
              <div className="space-y-2">
                <label className="block text-xs font-mono font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  定制化翻译语气与指令
                </label>
                <textarea
                  placeholder="例如: 请使用专业学术性词流，避免所有被动句，语气保持严谨且偏幽雅..."
                  value={localSettings.customPrompt}
                  onChange={(e) => setLocalSettings({ ...localSettings, customPrompt: e.target.value })}
                  rows={3}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-sans leading-relaxed resize-y"
                />
              </div>

              {/* Glossary force locking dictionary mapping */}
              <div className="space-y-2">
                <label className="block text-xs font-mono font-semibold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  强制专业术语对照映射表 (Glossary)
                </label>
                <textarea
                  placeholder="每行一条，格式为：源词 = 译目标词 (对中英双向翻译均将强制执行锁死)&#10;ML = 机器学习&#10;Prism = 棱镜译系统&#10;Prompt = 提示词"
                  value={localSettings.glossary}
                  onChange={(e) => setLocalSettings({ ...localSettings, glossary: e.target.value })}
                  rows={4}
                  className="w-full p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all leading-relaxed resize-y"
                />
              </div>
            </div>

            {/* Save Buttons Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex gap-3 bg-slate-50/50 dark:bg-slate-950/40">
              <button
                onClick={onClose}
                className="flex-1 py-3 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-xl font-medium transition-all"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-3 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-xl font-medium shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                保存偏好
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
