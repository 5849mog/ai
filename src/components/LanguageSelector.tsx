/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Check, Globe } from 'lucide-react';
import { Language } from '../types';

export const LANGUAGES: Language[] = [
  { code: 'zh', name: '中文', label: 'ZH', flag: '🇨🇳' },
  { code: 'en', name: '英语', label: 'EN', flag: '🇺🇸' },
  { code: 'ja', name: '日语', label: 'JA', flag: '🇯🇵' },
  { code: 'ko', name: '韩语', label: 'KO', flag: '🇰🇷' },
  { code: 'fr', name: '法语', label: 'FR', flag: '🇫🇷' },
  { code: 'de', name: '德语', label: 'DE', flag: '🇩🇪' },
  { code: 'es', name: '西班牙语', label: 'ES', flag: '🇪🇸' },
  { code: 'ru', name: '俄语', label: 'RU', flag: '🇷🇺' },
  { code: 'ar', name: '阿拉伯语', label: 'AR', flag: '🇸🇦' },
  { code: 'pt', name: '葡萄牙语', label: 'PT', flag: '🇧🇷' },
  { code: 'it', name: '意大利语', label: 'IT', flag: '🇮🇹' },
  { code: 'th', name: '泰语', label: 'TH', flag: '🇹🇭' },
  { code: 'vi', name: '越南语', label: 'VI', flag: '🇻🇳' },
  { code: 'nl', name: '荷兰语', label: 'NL', flag: '🇳🇱' },
  { code: 'tr', name: '土耳其语', label: 'TR', flag: '🇹🇷' },
  { code: 'pl', name: '波兰语', label: 'PL', flag: '🇵🇱' },
  { code: 'uk', name: '乌克兰语', label: 'UK', flag: '🇺🇦' },
  { code: 'sv', name: '瑞典语', label: 'SV', flag: '🇸🇪' },
  { code: 'id', name: '印度尼西亚语', label: 'ID', flag: '🇮🇩' },
  { code: 'hi', name: '印地语', label: 'HI', flag: '🇮🇳' },
  { code: 'fa', name: '波斯语', label: 'FA', flag: '🇮🇷' },
  { code: 'ms', name: '马来语', label: 'MS', flag: '🇲🇾' },
];

interface LanguageSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLanguage: Language;
  onSelect: (lang: Language) => void;
  title: string;
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  isOpen,
  onClose,
  selectedLanguage,
  onSelect,
  title,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLanguages = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter(
      (lang) =>
        lang.name.toLowerCase().includes(q) ||
        lang.label.toLowerCase().includes(q) ||
        lang.code.toLowerCase().includes(q)
    );
  }, [searchTerm]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-md"
          />

          {/* Dialog Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col max-h-[85vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-brand-500 animate-pulse" />
                <h3 className="font-serif text-lg font-semibold text-slate-800 dark:text-slate-100">
                  {title}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input bar */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="搜索语言名称、缩写 (例如: ZH, 英语)..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all font-sans"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded"
                  >
                    清除
                  </button>
                )}
              </div>
            </div>

            {/* Language grid or list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[50vh] scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
              {filteredLanguages.length > 0 ? (
                filteredLanguages.map((lang) => {
                  const isSelected = lang.code === selectedLanguage.code;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => {
                        onSelect(lang);
                        onClose();
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-xl transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-brand-50 dark:bg-brand-950/30 text-brand-600 dark:text-brand-400 font-semibold'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3.5">
                        <span className="text-2xl select-none" role="img" aria-label={lang.name}>
                          {lang.flag}
                        </span>
                        <div className="text-left">
                          <div className="text-sm font-sans">{lang.name}</div>
                          <div className="text-[10px] uppercase font-mono tracking-wider opacity-60">
                            {lang.label} · {lang.code}
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="w-4 h-4 text-brand-500 stroke-[3]" />
                      )}
                    </button>
                  );
                })
              ) : (
                <div className="p-8 text-center text-slate-400 text-sm">
                  未找到相关语言
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-[11px] text-slate-400 font-mono tracking-wider">
              <span>PRISMTRANS v6 PORTFOLIO</span>
              <span>共支持 {LANGUAGES.length} 种语言</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
