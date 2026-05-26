/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { motion } from 'motion/react';
import { Play, Square, Loader2, Sparkles, Activity, ShieldAlert, Cpu } from 'lucide-react';
import { LLMProvider, SystemSettings } from '../types';

interface EngineStatusProps {
  isRunning: boolean;
  statusText: string;
  adaptiveModeLabel: string;
  adaptiveModeKey: string;
  progressPercent: number;
  elapsedSeconds: number;
  onStop: () => void;
  onStart: () => void;
  isDisabled: boolean;
}

export const EngineStatus: React.FC<EngineStatusProps> = ({
  isRunning,
  statusText,
  adaptiveModeLabel,
  adaptiveModeKey,
  progressPercent,
  elapsedSeconds,
  onStop,
  onStart,
  isDisabled,
}) => {
  const formattedTime = elapsedSeconds < 60 
    ? `${elapsedSeconds}s` 
    : `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`;

  // Determine standard agent node positions in a nice circular layout
  const nodes = [
    { id: 'A', name: '语言学家', label: '忠实', cx: 90, cy: 35, color: 'stroke-emerald-500 fill-emerald-50/40 dark:fill-emerald-950/20' },
    { id: 'B', name: '本土编辑', label: '地道', cx: 165, cy: 65, color: 'stroke-brand-550 fill-brand-50/40 dark:fill-brand-950/20' },
    { id: 'C', name: '领域专家', label: '精密', cx: 165, cy: 135, color: 'stroke-blue-500 fill-blue-50/40 dark:fill-blue-950/20' },
    { id: 'D', name: '专属译者', label: '定制', cx: 90, cy: 165, color: 'stroke-rose-500 fill-rose-50/40 dark:fill-rose-950/20' },
    { id: 'F', name: '风格摹写', label: '镜象', cx: 15, cy: 135, color: 'stroke-amber-500 fill-amber-50/40 dark:fill-amber-950/20' },
    { id: 'E', name: '隐义探微', label: '译境', cx: 15, cy: 65, color: 'stroke-purple-500 fill-purple-50/40 dark:fill-purple-950/20' },
  ];

  return (
    <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 md:p-5 flex flex-col gap-4">
      {/* Top Details bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full breathe-dot ${isRunning ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100 font-sans flex items-center gap-1.5">
              协联引擎总控台
              {isRunning && <Loader2 className="w-3.5 h-3.5 text-brand-500 animate-spin" />}
            </h4>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
            {isRunning ? '智能节点群正高速并行协作，评估文本意图...' : '等待贴入翻译内容以激发六路智能管线...'}
          </p>
        </div>

        {/* Adaptive Mode indicator badge */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-[10px] text-slate-400 font-mono tracking-wider">自适应模式:</span>
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold uppercase ${
            adaptiveModeKey === 'chunk'
              ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30'
              : adaptiveModeKey === 'refined'
              ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30'
              : 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30'
          }`}>
            {adaptiveModeLabel}
          </span>
        </div>
      </div>

      {/* SVG Agent Consensus map + Status Details Split */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
        {/* Left Side: Dynamic SVG Agent connection web */}
        <div className="md:col-span-5 flex justify-center bg-slate-50/50 dark:bg-slate-950/40 p-3 rounded-2xl border border-slate-100/60 dark:border-slate-800/60">
          <svg viewBox="0 0 180 200" className="w-full max-w-[210px] h-auto drop-shadow-sm select-none">
            {/* Draw active lines between nodes to represent consensus pipeline */}
            {isRunning && (
              <>
                {/* Outer concentric support rings */}
                <circle cx="90" cy="100" r="75" stroke="var(--color-brand-100)" strokeWidth="0.75" fill="none" className="opacity-40 animate-[spin_60s_linear_infinite]" strokeDasharray="3 3" />
                <circle cx="90" cy="100" r="50" stroke="var(--color-brand-200)" strokeWidth="0.5" fill="none" className="opacity-30 animate-[spin_35s_linear_infinite_reverse]" strokeDasharray="2 3" />

                {/* Pulsing Central Target Line connections */}
                <line x1="90" y1="35" x2="90" y2="165" stroke="var(--color-brand-500)" strokeWidth="0.75" className="opacity-30 stroke-dashed" />
                <line x1="165" y1="65" x2="15" y2="135" stroke="var(--color-brand-400)" strokeWidth="0.75" className="opacity-30 stroke-dashed" />
                <line x1="165" y1="135" x2="15" y2="65" stroke="var(--color-brand-400)" strokeWidth="0.75" className="opacity-30 stroke-dashed" />

                {/* Outer Loop connection lines */}
                <polygon points="90,35 165,65 165,135 90,165 15,135 15,65" stroke="var(--color-brand-500)" strokeWidth="1" fill="none" className="opacity-45" />
              </>
            )}

            {!isRunning && (
              <polygon points="90,35 165,65 165,135 90,165 15,135 15,65" stroke="#cbd5e1" strokeWidth="0.75" fill="none" className="opacity-40" />
            )}

            {/* Central Arbiter Core */}
            <circle cx="90" cy="100" r="16" className="stroke-slate-200 dark:stroke-slate-800 fill-white dark:fill-slate-900" strokeWidth="1.5" />
            <Sparkles className={`w-5 h-5 absolute left-[80px] top-[90px] text-brand-500 ${isRunning ? 'animate-spin' : 'opacity-30'}`} style={{ transformOrigin: 'center' }} />

            {/* Render Standard Nodes */}
            {nodes.map((n) => {
              const isPulsing = isRunning && progressPercent > 5;
              return (
                <g key={n.id} className="cursor-default">
                  <circle cx={n.cx} cy={n.cy} r="14" className={`${n.color} stroke-2 transition-transform duration-300 ${isPulsing ? 'scale-[1.03]' : ''}`} />
                  <text x={n.cx} y={n.cy - 1} textAnchor="middle" className="fill-slate-800 dark:fill-slate-200 text-[10px] font-sans font-bold select-none">{n.id}</text>
                  <text x={n.cx} y={n.cy + 7} textAnchor="middle" className="fill-slate-500 dark:fill-slate-400 text-[6px] font-mono tracking-wider uppercase select-none">{n.label}</text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Right Side: Status messages and control interface */}
        <div className="md:col-span-7 flex flex-col justify-between h-full gap-4">
          <div className="space-y-3">
            {/* Real-time status text box */}
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 flex items-start gap-2.5 min-h-[72px]">
              <div className="p-1 rounded bg-brand-50 dark:bg-brand-950 text-brand-500 flex-shrink-0">
                <Activity className="w-4 h-4 animate-pulse" />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-mono font-semibold tracking-wider text-slate-400 capitalize">
                  当前流水线状态
                </span>
                <p className="text-sm font-semibold font-sans text-slate-800 dark:text-slate-100">
                  {statusText}
                </p>
              </div>
            </div>

            {/* Multi-step progress representation */}
            <div className="space-y-1.5 p-1">
              <div className="flex justify-between items-center text-xs text-slate-400">
                <span className="font-sans flex items-center gap-1">
                  <Cpu className="w-3 h-3 text-slate-400" />
                  管线处理精度
                </span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                  {progressPercent}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.3 }}
                  className="h-full bg-gradient-to-r from-brand-500 to-rose-400 rounded-full"
                />
              </div>
            </div>
          </div>

          {/* Timers & Control triggering triggers */}
          <div className="flex items-center justify-between gap-3 pt-2">
            {/* Timer Output */}
            <div className="flex items-center gap-2 font-mono">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-sans">
                引擎计时:
              </span>
              <span className={`text-sm font-semibold ${isRunning ? 'text-brand-500' : 'text-slate-400 dark:text-slate-600'}`}>
                {isRunning ? formattedTime : '00.00s'}
              </span>
            </div>

            {/* Run button controls */}
            {isRunning ? (
              <button
                onClick={onStop}
                className="px-5 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-rose-500/10 hover:shadow-lg transition-all cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 stroke-[2.5]" />
                中止翻译 (Stop)
              </button>
            ) : (
              <button
                disabled={isDisabled}
                onClick={onStart}
                className="px-6 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-md hover:shadow-lg disabled:opacity-40 disabled:hover:shadow-md disabled:cursor-not-allowed transition-all cursor-pointer font-sans"
              >
                <Play className="w-3.5 h-3.5 fill-white stroke-[2.5]" />
                启动协联合议 (Vete)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
