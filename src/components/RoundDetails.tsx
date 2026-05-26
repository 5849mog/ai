/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Sparkles, MessageSquare, ListTodo, Layers, Coins } from 'lucide-react';
import { RoundData } from '../types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface RoundDetailsProps {
  roundData: RoundData;
  dynamicAgentName?: string;
  isCompleted: boolean;
  defaultExpanded?: boolean;
}

export const RoundDetails: React.FC<RoundDetailsProps> = ({
  roundData,
  dynamicAgentName = '专属译者',
  isCompleted,
  defaultExpanded = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeDraftTab, setActiveDraftTab] = useState<'A' | 'B' | 'C' | 'D' | 'F' | 'E'>('A');

  const draftTabs = [
    { id: 'A', name: '语言学家', role: '忠实还原', bg: 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/40' },
    { id: 'B', name: '本土编辑', role: '地道重构', bg: 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/40' },
    { id: 'C', name: '领域专家', role: '精密术语', bg: 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-100 dark:border-blue-900/40' },
    { id: 'D', name: dynamicAgentName, role: '量身定制', bg: 'bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/40' },
    { id: 'F', name: '风格摹写', role: '等效迁移', bg: 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/40' },
    { id: 'E', name: '隐义探微', role: '后向诠释', bg: 'bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-100 dark:border-purple-900/40' },
  ] as const;

  // Active critique list
  const critiques = [
    { sourceId: 'A', targetName: '评估 乙/丙 草稿', content: roundData.critiques.A },
    { sourceId: 'B', targetName: '评估 丙/丁 草稿', content: roundData.critiques.B },
    { sourceId: 'C', targetName: '评估 丁/己 草稿', content: roundData.critiques.C },
    { sourceId: 'D', targetName: '评估 甲/乙 草稿', content: roundData.critiques.D },
    { sourceId: 'F', targetName: '评估 甲/丙 草稿', content: roundData.critiques.F },
  ].filter(c => c.content);

  const formattedTokens = roundData.usageTokens.total > 0
    ? `${roundData.usageTokens.total.toLocaleString()} (${roundData.usageTokens.prompt.toLocaleString()} + ${roundData.usageTokens.completion.toLocaleString()})`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
    >
      {/* Header Bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between p-4 cursor-pointer select-none bg-slate-50/60 hover:bg-slate-50 dark:bg-slate-950/30 dark:hover:bg-slate-950/50 transition-all border-b border-slate-100 dark:border-slate-800"
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-brand-500 text-white font-mono text-xs font-bold flex items-center justify-center shadow-sm">
            R{roundData.round}
          </div>
          <div className="space-y-0.5">
            <h4 className="text-sm font-bold font-sans text-slate-800 dark:text-slate-100">
              第 {roundData.round} 轮 智能合议进度 (Consensus Process)
            </h4>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-sans ${isCompleted ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 'bg-brand-100 dark:bg-brand-950/40 text-brand-600 dark:text-brand-400 ring-1 ring-brand-500/20'}`}>
                {isCompleted ? '裁决已就绪' : '合议演算中...'}
              </span>
              {formattedTokens && (
                <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                  <Coins className="w-3 h-3 text-slate-300" />
                  本轮算力: {formattedTokens} Tkn
                </span>
              )}
            </div>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 md:p-5 space-y-6">
              {/* STAGE 1: 5-Way Parallel Drafting (Accordion/Tabs) */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider">
                  <Layers className="w-3.5 h-3.5 text-brand-500" />
                  阶段一：六路智能并行草稿 (Drafting Pipeline)
                </div>

                {/* Tab layout selectors */}
                <div className="flex flex-wrap gap-1 bg-slate-50 dark:bg-slate-950 p-1 rounded-xl">
                  {draftTabs.map((tab) => {
                    const isSelected = activeDraftTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveDraftTab(tab.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-sans transition-all flex-1 text-center min-w-[70px] cursor-pointer ${
                          isSelected
                            ? 'bg-white dark:bg-slate-900 shadow-sm text-brand-500 font-bold'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                        }`}
                      >
                        {tab.name}
                      </button>
                    );
                  })}
                </div>

                {/* Tab Details box */}
                <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/20 dark:bg-slate-950/10 min-h-[140px]">
                  {/* Selected Tab Meta Display */}
                  {draftTabs.map((tab) => {
                    if (tab.id !== activeDraftTab) return null;
                    const draftContent = roundData.paths[tab.id as keyof typeof roundData.paths];

                    return (
                      <motion.div
                        key={tab.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${tab.bg}`}>
                            {tab.id}路 · {tab.role}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {draftContent ? `${draftContent.length} 字符` : '就绪中...'}
                          </span>
                        </div>
                        {draftContent ? (
                          <MarkdownRenderer
                            content={draftContent}
                            isStreaming={!isCompleted && (roundData.round === 1 || isExpanded)}
                          />
                        ) : (
                          <div className="flex items-center justify-center p-8 text-xs text-slate-400 dark:text-slate-600 gap-1.5">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            智能体正在研磨中，请稍候...
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* STAGE 2: Critique Cross Review */}
              {critiques.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider">
                    <MessageSquare className="w-3.5 h-3.5 text-brand-500" />
                    阶段二：多智体交叉质询网络 (Cross-Critique Network)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
                    {critiques.map((crit, index) => {
                      const tabMeta = draftTabs.find((t) => t.id === crit.sourceId);
                      return (
                        <div
                          key={index}
                          className="p-3 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-950/20 flex flex-col gap-2 group hover:border-brand-500/20 hover:bg-slate-50/60 dark:hover:bg-slate-950/30 transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${tabMeta?.bg}`}>
                              {crit.sourceId} 节点
                            </span>
                            <span className="text-[8px] uppercase tracking-wider font-mono text-slate-400">
                              {crit.targetName}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed max-h-[140px] overflow-y-auto select-none dark-scrollbar">
                            <MarkdownRenderer content={crit.content} isMemo />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STAGE 3: Arbitration Synthesis */}
              {roundData.synthesis && (
                <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-850">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider">
                    <Sparkles className="w-3.5 h-3.5 text-brand-500" />
                    阶段三：综合裁断结果 (Synthesis Verdict)
                  </div>
                  <div className="p-4 rounded-xl border border-brand-100/40 dark:border-brand-900/10 bg-brand-50/5 dark:bg-slate-950/5 relative overflow-hidden">
                    <MarkdownRenderer
                      content={roundData.synthesis}
                      isStreaming={!isCompleted && activeDraftTab === 'A'}
                    />
                  </div>
                </div>
              )}

              {/* Iterative Translation Memo */}
              {roundData.memo && (
                <div className="space-y-2 p-3.5 rounded-xl bg-amber-50/15 dark:bg-amber-950/5 border border-amber-500/10 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-wider text-[10px]">
                    <ListTodo className="w-3.5 h-3.5 text-amber-500" />
                    裁断意见备忘录 (Synthesis Digest)
                  </div>
                  <div className="text-slate-600 dark:text-slate-400 leading-normal pl-4 border-l border-amber-500/20">
                    <MarkdownRenderer content={roundData.memo} isMemo />
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// Simple loader helper mock
const Loader2 = ({ className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`lucide lucide-loader-2 animate-spin ${className}`}
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);
