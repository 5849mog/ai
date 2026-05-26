/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, History, Trash2, ArrowUpRight, Award, Calendar, ChevronRight } from 'lucide-react';
import { TranslationSession } from '../types';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: TranslationSession[];
  onLoadSession: (session: TranslationSession) => void;
  onDeleteSession: (id: string) => void;
  onClearAll: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  sessions,
  onLoadSession,
  onDeleteSession,
  onClearAll,
}) => {
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
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-brand-500" />
                <h3 className="font-serif text-lg font-semibold text-slate-800 dark:text-slate-100">
                  本地翻译历史记录
                </h3>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-slate-200">
              {sessions.length > 0 ? (
                sessions.map((session) => {
                  const ratingAvg = session.scores
                    ? (session.scores.reduce((a, b) => a + b, 0) / 3).toFixed(1)
                    : null;
                  return (
                    <div
                      key={session.id}
                      className="p-4 rounded-xl border border-slate-100 dark:border-slate-800/85 bg-slate-50/50 dark:bg-slate-900/40 hover:border-slate-200 dark:hover:border-slate-700/80 transition-all flex flex-col gap-3 group relative overflow-hidden"
                    >
                      {/* Top Header Row within card */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-semibold text-brand-500 bg-brand-50 dark:bg-brand-950/30 px-2 py-0.5 rounded-md uppercase tracking-wide">
                            {session.srcCode.toUpperCase()} → {session.tgtCode.toUpperCase()}
                          </span>
                          <span className="text-[10px] text-slate-400 flex items-center gap-1 font-sans">
                            <Calendar className="w-3 h-3" />
                            {session.timestamp}
                          </span>
                        </div>
                        {ratingAvg && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
                            <Award className="w-3 h-3 text-amber-500" />
                            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                              均分 {ratingAvg}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Source & Result snippet */}
                      <div className="space-y-1.5 cursor-pointer" onClick={() => {
                        onLoadSession(session);
                        onClose();
                      }}>
                        <p className="text-xs text-slate-400 line-clamp-1 italic font-sans">
                          源: {session.source}
                        </p>
                        <p className="text-xs md:text-sm font-serif font-medium text-slate-700 dark:text-slate-300 line-clamp-2 leading-relaxed">
                          译: {session.result}
                        </p>
                      </div>

                      {/* Footer Actions within card */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-850/60">
                        <span className="text-[10px] text-slate-400 font-mono">
                          {session.model.replace('-flash', '')} · {session.elapsed}s
                        </span>
                        
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => onDeleteSession(session.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                            title="删除此条"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          
                          <button
                            onClick={() => {
                              onLoadSession(session);
                              onClose();
                            }}
                            className="text-[11px] text-brand-500 hover:text-brand-600 font-semibold flex items-center gap-0.5 hover:underline pl-2 py-1 cursor-pointer"
                          >
                            载入编辑
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-24 flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 gap-3">
                  <History className="w-10 h-10 stroke-[1.25] text-slate-300 dark:text-slate-700" />
                  <p className="text-sm font-sans">暂无翻译历史纪录</p>
                  <p className="text-xs max-w-xs text-center leading-normal text-slate-400/80">
                    翻译成功后，报告、译文及智能体协商的中间步骤将安全暂存在本地。
                  </p>
                </div>
              )}
            </div>

            {/* Clear All Footer */}
            {sessions.length > 0 && (
              <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex justify-end">
                <button
                  onClick={() => {
                    if (window.confirm('确认要清除所有本地翻译历史纪录吗？该操作不可逆。')) {
                      onClearAll();
                    }
                  }}
                  className="py-2.5 px-4 text-xs font-semibold text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 border border-slate-200 dark:border-slate-800 rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  清除全部
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
