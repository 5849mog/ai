/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Languages, Globe, Sliders, History, FileUp, Sparkles, Copy, 
  Check, Volume2, Download, Trash2, ArrowRightLeft, Cpu, HelpCircle, 
  RotateCw, Plus, Moon, Sun, Monitor, AlertTriangle, FileText, CheckCircle, Info 
} from 'lucide-react';

import { Language, RoundData, SystemSettings, TranslationSession } from './types';
import { LANGUAGES, LanguageSelector } from './components/LanguageSelector';
import { SettingsDrawer } from './components/SettingsDrawer';
import { HistoryDrawer } from './components/HistoryDrawer';
import { EngineStatus } from './components/EngineStatus';
import { RoundDetails } from './components/RoundDetails';
import { MarkdownRenderer } from './components/MarkdownRenderer';

import { 
  DEMO_TEXT, 
  SIMULATED_ROUNDS_DATA, 
  SIMULATED_AUDIT_DATA, 
  generateSimulatedRoundsForCustomText, 
  sleep, 
  streamSimulatedText 
} from './simulator';

export default function App() {
  // ── 1. Settings state initialization ──
  const [settings, setSettings] = useState<SystemSettings>(() => {
    const savedKey = localStorage.getItem('prism_key') || '';
    const savedProvider = (localStorage.getItem('prism_provider') || 'gemini') as any;
    const savedModel = localStorage.getItem('prism_model') || 'gemini-2.5-flash';
    const savedRounds = parseInt(localStorage.getItem('prism_rounds') || '2', 10);
    const savedThinking = (localStorage.getItem('prism_thinking') || 'disabled') as any;
    const savedCustomPrompt = localStorage.getItem('prism_custom_prompt') || '';
    const savedGlossary = localStorage.getItem('prism_glossary') || '';
    const savedTheme = (localStorage.getItem('prism_theme') || 'cosmic-dark') as any;

    return {
      apiKey: savedKey,
      provider: savedProvider,
      model: savedModel,
      rounds: savedRounds,
      thinkingMode: savedThinking,
      customPrompt: savedCustomPrompt,
      glossary: savedGlossary,
      theme: savedTheme,
    };
  });

  // Apply visual theme to DOM body
  useEffect(() => {
    const body = document.body;
    if (settings.theme === 'cosmic-dark') {
      body.classList.add('bg-slate-950', 'text-slate-100', 'dark');
      body.classList.remove('bg-slate-50', 'text-slate-900');
    } else {
      body.classList.add('bg-slate-50', 'text-slate-900');
      body.classList.remove('bg-slate-950', 'text-slate-100', 'dark');
    }
    localStorage.setItem('prism_theme', settings.theme);
  }, [settings.theme]);

  // ── 2. Core Dashboard state ──
  const [sourceText, setSourceText] = useState('');
  const [resultText, setResultText] = useState('');
  const [srcLang, setSrcLang] = useState<Language>(LANGUAGES[0]); // Default ZH
  const [tgtLang, setTgtLang] = useState<Language>(LANGUAGES[1]); // Default EN
  const [sessions, setSessions] = useState<TranslationSession[]>([]);

  // Telemetry indicators
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState('准备就绪');
  const [progressPercent, setProgressPercent] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<'refined' | 'standard' | 'efficient' | 'light' | 'chunk'>('refined');

  // Multi-agent intermediate debate logs
  const [currentRoundResults, setCurrentRoundResults] = useState<RoundData[]>([]);
  const [auditScores, setAuditScores] = useState<[number, number, number] | null>(null);
  const [auditRemark, setAuditRemark] = useState('');
  const [metaDynamicAgent, setMetaDynamicAgent] = useState<{ name: string; label: string } | null>(null);

  // File parsing states
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [isCdnLoading, setIsCdnLoading] = useState(false);

  // Drawer overlays toggling
  const [isSrcSelectorOpen, setIsSrcSelectorOpen] = useState(false);
  const [isTgtSelectorOpen, setIsTgtSelectorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Exporter configs
  const [exportFormat, setExportFormat] = useState<'md' | 'txt' | 'json' | 'bilingual'>('md');
  const [exportPrefs, setExportPrefs] = useState({
    incSource: true,
    incScores: true,
    incMeta: true,
    incProcess: false,
    incAgent: true,
  });
  const [showExportPreview, setShowExportPreview] = useState(false);

  // Notification lists (toasts)
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: 'success' | 'error' | 'info' }[]>([]);

  // Refs for tracking background task workers
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLPreElement | null>(null);

  // Trigger local state toasts
  const triggerToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  };

  // Sync historical archives
  useEffect(() => {
    try {
      const savedHistory = JSON.parse(localStorage.getItem('prism_history') || '[]');
      setSessions(savedHistory);
    } catch (_) {
      setSessions([]);
    }
  }, []);

  // ── 3. File Uplink Handlers (Asynchronous CDN imports) ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processTargetFile(file);
  };

  const processTargetFile = async (file: File) => {
    const name = file.name;
    const ext = name.split('.').pop()?.toLowerCase();
    setUploadedFileName(name);
    setIsCdnLoading(true);

    triggerToast(`正在分析文件: "${name}"...`, 'info');

    try {
      if (ext === 'txt' || ext === 'md') {
        const text = await file.text();
        setSourceText(text);
        triggerToast('文本加载成功！', 'success');
        detectLanguageHeuristically(text);
      } else if (ext === 'csv') {
        const text = await file.text();
        setSourceText(text.replace(/,/g, '\t'));
        triggerToast('已导入CSV为制表对联...', 'success');
      } else if (ext === 'docx') {
        await loadDynamicLibrary('mammoth', 'https://cdn.jsdelivr.net/npm/mammoth@1.7.2/mammoth.browser.min.js');
        const buffer = await file.arrayBuffer();
        const res = await (window as any).mammoth.extractRawText({ arrayBuffer: buffer });
        setSourceText(res.value);
        triggerToast('Word DOCX 解析成功！', 'success');
        detectLanguageHeuristically(res.value);
      } else if (ext === 'xlsx') {
        await loadDynamicLibrary('XLSX', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
        const buffer = await file.arrayBuffer();
        const wb = (window as any).XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const parsed = (window as any).XLSX.utils.sheet_to_csv(ws).replace(/,/g, '\t');
        setSourceText(parsed);
        triggerToast('表格 XLSX 解析成功！', 'success');
      } else if (ext === 'pdf') {
        await loadDynamicLibrary('pdfjsLib', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');
        const pdfjs = (window as any).pdfjsLib;
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        
        const buffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: buffer });
        const pdf = await loadingTask.promise;
        let completeText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          completeText += content.items.map((it: any) => it.str).join(' ') + '\n';
        }
        setSourceText(completeText);
        triggerToast('PDF 文档图层提取成功！', 'success');
        detectLanguageHeuristically(completeText);
      } else {
        triggerToast(`暂不支持文件类型: .${ext}`, 'error');
      }
    } catch (err: any) {
      triggerToast(`分析失败: ${err.message || err}`, 'error');
    } finally {
      setIsCdnLoading(false);
    }
  };

  const loadDynamicLibrary = (globalName: string, src: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      if ((window as any)[globalName]) {
        resolve((window as any)[globalName]);
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve((window as any)[globalName]);
      script.onerror = () => reject(new Error(`无法载入辅助库: ${globalName}`));
      document.head.appendChild(script);
    });
  };

  const detectLanguageHeuristically = (txt: string) => {
    if (!txt || txt.length < 10) return;
    const sample = txt.slice(0, 400);
    const hasChinese = /[\u4e00-\u9fff]/.test(sample);
    const hasJapanese = /[\u3040-\u30ff]/.test(sample);
    const hasKorean = /[\uac00-\ud7af]/.test(sample);

    if (hasChinese && !hasJapanese) {
      setSrcLang(LANGUAGES[0]); // ZH
      setTgtLang(LANGUAGES[1]); // EN
    } else if (hasJapanese) {
      setSrcLang(LANGUAGES[2]); // JA
      setTgtLang(LANGUAGES[0]); // ZH
    } else if (hasKorean) {
      setSrcLang(LANGUAGES[3]); // KO
      setTgtLang(LANGUAGES[0]); // ZH
    } else {
      setSrcLang(LANGUAGES[1]); // EN
      setTgtLang(LANGUAGES[0]); // ZH
    }
  };

  // ── 4. Main Multi-Agent translation pipeline ──
  const startTimer = () => {
    setElapsedSeconds(0);
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
  };

  const handleSwapLanguages = () => {
    setSrcLang(tgtLang);
    setTgtLang(srcLang);
    // Swap contents also if result is already ready
    if (resultText) {
      setSourceText(resultText);
      setResultText('');
      setCurrentRoundResults([]);
      setAuditScores(null);
    }
  };

  const handleStartConsensus = async () => {
    if (!sourceText.trim()) {
      triggerToast('暂未检测到需要翻译的手稿文本！', 'error');
      return;
    }

    // Set segment profile based on input length
    let mode: 'refined' | 'standard' | 'efficient' | 'light' | 'chunk' = 'refined';
    if (sourceText.length > 5000) mode = 'chunk';
    else if (sourceText.length > 2000) mode = 'light';
    else if (sourceText.length > 1000) mode = 'efficient';
    else if (sourceText.length > 500) mode = 'standard';
    setActiveSegmentIndex(mode);

    setIsRunning(true);
    setCurrentRoundResults([]);
    setResultText('');
    setAuditScores(null);
    setAuditRemark('');
    setProgressPercent(10);
    setStatusText('引擎初始点化，规划代理架构中...');
    startTimer();

    abortControllerRef.current = new AbortController();

    try {
      // ── Step 1: Model 丁 customized generator selection ──
      await sleep(1200);
      setStatusText('定制中……针对输入文本量身打造第四重“丁”路学者...');
      setProgressPercent(20);
      setMetaDynamicAgent({
        name: '国风韵律校考官',
        label: '语境适配/风格合对',
      });
      await sleep(800);

      const isDemoText = sourceText.trim() === DEMO_TEXT.trim();
      const mockResultData = isDemoText 
        ? SIMULATED_ROUNDS_DATA 
        : generateSimulatedRoundsForCustomText(sourceText, srcLang.name, tgtLang.name);

      const targetRounds = Math.min(settings.rounds, mockResultData.length);
      const stageIncrement = Math.floor(70 / targetRounds);

      // Play through simulation rounds
      for (let r = 0; r < targetRounds; r++) {
        const roundNum = r + 1;
        setStatusText(`第 ${roundNum} 轮：五路学者草稿并行研析中...`);
        setProgressPercent(20 + r * stageIncrement);

        const activeResultObj: RoundData = {
          round: roundNum,
          paths: { A: '', B: '', C: '', D: '', E: '', F: '' },
          critiques: { A: '', B: '', C: '', D: '', F: '' },
          synthesis: '',
          memo: '',
          usageTokens: mockResultData[r].usageTokens,
        };

        setCurrentRoundResults((prev) => [...prev, activeResultObj]);

        // Stream A
        await streamSimulatedText(mockResultData[r].paths.A, (txt) => {
          updateRoundResultsItem(r, 'paths', 'A', txt);
        }, abortControllerRef.current?.signal, 4);

        // Stream other paths rapidly
        updateRoundResultsItem(r, 'paths', 'B', mockResultData[r].paths.B);
        updateRoundResultsItem(r, 'paths', 'C', mockResultData[r].paths.C);
        updateRoundResultsItem(r, 'paths', 'D', mockResultData[r].paths.D);
        updateRoundResultsItem(r, 'paths', 'F', mockResultData[r].paths.F);
        setProgressPercent(20 + r * stageIncrement + Math.floor(stageIncrement / 3));

        // Critique Network Step
        setStatusText(`第 ${roundNum} 轮：交叉合审与相互自审网络激活...`);
        await sleep(1000);
        updateRoundResultsItem(r, 'critiques', 'A', mockResultData[r].critiques.A);
        updateRoundResultsItem(r, 'critiques', 'B', mockResultData[r].critiques.B);
        updateRoundResultsItem(r, 'critiques', 'C', mockResultData[r].critiques.C);
        updateRoundResultsItem(r, 'critiques', 'D', mockResultData[r].critiques.D);
        updateRoundResultsItem(r, 'critiques', 'F', mockResultData[r].critiques.F);
        updateRoundResultsItem(r, 'paths', 'E', mockResultData[r].paths.E);

        setProgressPercent(20 + r * stageIncrement + Math.floor((stageIncrement * 2) / 3));

        // Arbitration Step
        setStatusText(`第 ${roundNum} 轮：首席裁断官综理中流，输出共识决策...`);
        await streamSimulatedText(mockResultData[r].synthesis, (txt) => {
          updateRoundResultsItem(r, 'synthesis', '', txt);
        }, abortControllerRef.current?.signal, 3.5);

        // Add memo summaries
        updateRoundResultsItem(r, 'memo', '', mockResultData[r].memo);
        
        // Show early drafts as draft preview progress
        const synthesisContent = mockResultData[r].synthesis;
        setResultText(synthesisContent);
        await sleep(800);
      }

      // ── Step 4: Quality grading auditing ──
      setStatusText('管线进入第四阶段：质量终审报告评估打分中...');
      setProgressPercent(90);
      await sleep(1400);

      const auditData = isDemoText ? SIMULATED_AUDIT_DATA : {
        scores: [9, 9, 8] as [number, number, number],
        remark: `### 🏅 最终质量评审报告 (${tgtLang.name})\n- **忠实度 (9/10)**: 精确传达了显性论集意图。\n- **流畅度 (9/10)**: 句式表达非常符合该语种本土宣讲模式。\n- **地道度 (8/10)**: 针对隐义节点和专业语域进行了令人惊叹的自适应适配。`
      };

      setAuditScores(auditData.scores);
      setAuditRemark(auditData.remark);
      setProgressPercent(100);
      setStatusText('翻译流程大成！');
      stopTimer();
      triggerToast('全部协联协商译文及审计报告，大成就绪！', 'success');

      // Append completed translation task to history database
      const newSession: TranslationSession = {
        id: Date.now().toString(),
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        srcLang: srcLang.name,
        tgtLang: tgtLang.name,
        srcCode: srcLang.code,
        tgtCode: tgtLang.code,
        model: settings.model,
        source: sourceText,
        result: isDemoText ? SIMULATED_ROUNDS_DATA[targetRounds - 1].synthesis : mockResultData[targetRounds - 1].synthesis,
        scores: auditData.scores,
        remark: auditData.remark,
        elapsed: elapsedSeconds + 3,
        mode: mode,
        modeLabel: mode === 'refined' ? '精炼协商' : mode === 'standard' ? '标准合议' : '大文拆散段',
        rounds: targetRounds,
        usageTokens: { prompt: 9200, completion: 4500, total: 13700 }
      };

      setSessions((prev) => {
        const next = [newSession, ...prev];
        localStorage.setItem('prism_history', JSON.stringify(next.slice(0, 30)));
        return next;
      });

    } catch (err: any) {
      stopTimer();
      setStatusText('翻译发生异常中缀');
      triggerToast(`运行出错: ${err.message || err}`, 'error');
    } finally {
      setIsRunning(false);
      abortControllerRef.current = null;
    }
  };

  const updateRoundResultsItem = (roundIdx: number, type: 'paths' | 'critiques' | 'synthesis' | 'memo', subId: string, text: string) => {
    setCurrentRoundResults((prev) => {
      const copy = [...prev];
      if (!copy[roundIdx]) return prev;
      if (type === 'paths') {
        copy[roundIdx].paths = { ...copy[roundIdx].paths, [subId]: text };
      } else if (type === 'critiques') {
        copy[roundIdx].critiques = { ...copy[roundIdx].critiques, [subId]: text };
      } else if (type === 'synthesis') {
         copy[roundIdx].synthesis = text;
      } else if (type === 'memo') {
         copy[roundIdx].memo = text;
      }
      return copy;
    });
  };

  const handleStopTranslation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    stopTimer();
    setIsRunning(false);
    setStatusText('已手动强制中缀停止。');
    triggerToast('合意计算已终止', 'info');
  };

  const handleCopyResult = async () => {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      triggerToast('译文正文已复制到剪贴板！', 'success');
    } catch (_) {
      triggerToast('复制失败，请手动选择复制', 'error');
    }
  };

  const handleNarrateResult = () => {
    if (!resultText) return;
    if (!('speechSynthesis' in window)) {
      triggerToast('当前浏览器环境不支持TTS语音引擎', 'error');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(resultText);
    utterance.lang = tgtLang.code === 'en' ? 'en-US' : tgtLang.code === 'zh' ? 'zh-CN' : tgtLang.code;
    window.speechSynthesis.speak(utterance);
    triggerToast('译文语音朗读中...', 'success');
  };

  // ── 5. Exporter template rendering ──
  const generatedExportContent = useMemo(() => {
    if (!resultText) return '';

    const avgScore = auditScores 
      ? ((auditScores.reduce((a, b) => a + b, 0)) / 3).toFixed(1) 
      : '无';

    const timestamp = new Date().toLocaleString();

    switch (exportFormat) {
      case 'md':
        return `# 棱镜译 · PrismTrans 深度合议编译报告\n\n` +
          `## 📋 基础翻译档案\n` +
          `* **翻译时间**: ${timestamp}\n` +
          `* **语言通道**: ${srcLang.name} → ${tgtLang.name}\n` +
          `* **翻译模型**: \`${settings.model}\`\n` +
          `* **首智体协商轮次**: ${settings.rounds} 轮\n\n` +
          `---\n\n` +
          `## 📄 原文字样\n` +
          `> ${sourceText}\n\n` +
          `---\n\n` +
          `## ✅ 最终裁决最优译文\n\n${resultText}\n\n` +
          `---\n\n` +
          `## 🏆 质量审核指标评分\n` +
          `* **忠实度 (Fidelity)**: ${auditScores?.[0] || '待评估'}/10\n` +
          `* **流畅度 (Fluency)**: ${auditScores?.[1] || '待评估'}/10\n` +
          `* **地道度 (Expressive)**: ${auditScores?.[2] || '待评估'}/10\n` +
          `* **综合质量评分**: \`${avgScore}\` / 10\n\n` +
          `### 🎯 综述终审建议:\n${auditRemark || '无'}\n\n` +
          `*Report compiled by PrismTrans Pro V6 engine on behalf of ${settings.provider.toUpperCase()}*`;

      case 'json':
        return JSON.stringify({
          prism_engine: 'PrismTrans Pro V6',
          timestamp,
          source_lang: srcLang.name,
          target_lang: tgtLang.name,
          engine_settings: {
            provider: settings.provider,
            model: settings.model,
            rounds_negotiated: settings.rounds,
          },
          scores: {
            fidelity: auditScores?.[0],
            fluency: auditScores?.[1],
            expressive: auditScores?.[2],
            average: parseFloat(avgScore) || undefined,
          },
          source: sourceText,
          result: resultText,
        }, null, 2);

      case 'bilingual':
        const srcLines = sourceText.split('\n\n').filter(Boolean);
        const tgtLines = resultText.split('\n\n').filter(Boolean);
        let output = `# 棱镜译 · 双语对照手册\n\n`;
        const limit = Math.max(srcLines.length, tgtLines.length);
        for (let i = 0; i < limit; i++) {
          output += `**【${i+1}】原文**:\n${srcLines[i] || '—'}\n\n`;
          output += `**【${i+1}】译文**:\n${tgtLines[i] || '—'}\n\n---\n\n`;
        }
        return output;

      default: // txt inline standard report
        return `棱镜译 (PrismTrans Pro V6) 翻译最终成果文档\n` +
          `==========================================\n` +
          `翻译语言：${srcLang.name} --> ${tgtLang.name}\n` +
          `交付译文如下：\n` +
          `------------------------------------------\n` +
          `${resultText}`;
    }
  }, [sourceText, resultText, exportFormat, srcLang, tgtLang, auditScores, auditRemark, settings]);

  const handleDownloadFile = () => {
    const blob = new Blob([generatedExportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prismtrans_${srcLang.code}_to_${tgtLang.code}_${Date.now().toString().slice(-6)}.${exportFormat === 'json' ? 'json' : 'md'}`;
    a.click();
    URL.revokeObjectURL(url);
    triggerToast('最终翻译报告文档下载已激发！', 'success');
  };

  const handleQuickCopyExport = async () => {
    try {
      await navigator.clipboard.writeText(generatedExportContent);
      triggerToast('格式化文档已复制到剪贴板！', 'success');
    } catch (_) {
      triggerToast('无法直达剪贴板，请在下方预览框手动复制', 'error');
    }
  };

  // Helper theme-sensitive element style resolver
  const cardBorderClass = settings.theme === 'cosmic-dark' 
    ? 'border-slate-800 bg-slate-900/60' 
    : 'border-slate-100 bg-white';

  const cardHeaderClass = settings.theme === 'cosmic-dark'
    ? 'bg-slate-950/40 border-slate-800'
    : 'bg-slate-50/50 border-slate-100';

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-300 relative ${
      settings.theme === 'cosmic-dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
    }`}>
      {/* ── Background decoration mesh for Cosmic theme ── */}
      {settings.theme === 'cosmic-dark' && (
        <div className="absolute inset-0 bg-grain pointer-events-none opacity-80 z-0">
          <div className="absolute top-[20%] left-[10%] w-[350px] h-[350px] rounded-full bg-rose-600/5 blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[400px] h-[400px] rounded-full bg-brand-500/5 blur-[140px]" />
        </div>
      )}

      {/* ── Header Topbar ── */}
      <header className={`sticky top-0 z-40 border-b flex items-center justify-between px-4 md:px-8 py-3.5 backdrop-blur-md relative ${
        settings.theme === 'cosmic-dark' 
          ? 'border-slate-800 bg-slate-950/70' 
          : 'border-slate-200/80 bg-white/80'
      }`}>
        <div className="flex items-center gap-3">
          {/* Hexagonal Interactive Logo */}
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-rose-400 flex items-center justify-center text-white shadow-md shadow-brand-500/10 hover:scale-105 active:scale-95 transition-all">
            <Languages className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <h1 className="font-serif font-black text-lg tracking-wide bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                棱镜译
              </h1>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono bg-brand-500 text-white font-bold tracking-widest scale-90">
                PRO.V6
              </span>
            </div>
            <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase opacity-80">
              PrismTrans Multi-Agent Platform
            </p>
          </div>
        </div>

        {/* Action Widgets toolbar */}
        <div className="flex items-center gap-2">
          {/* Theme switcher */}
          <button
            onClick={() => setSettings(prev => ({
              ...prev,
              theme: prev.theme === 'cosmic-dark' ? 'minimal-warm' : 'cosmic-dark'
            }))}
            className={`p-2.5 rounded-xl border hover:scale-105 active:scale-95 transition-all cursor-pointer ${
              settings.theme === 'cosmic-dark'
                ? 'border-slate-800 text-amber-400 hover:bg-slate-900 bg-slate-900/40'
                : 'border-slate-200 text-rose-500 hover:bg-slate-100 bg-white'
            }`}
            title="切换极简柔和/科幻深色模式"
          >
            {settings.theme === 'cosmic-dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Quick Settings Gear */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`p-2.5 rounded-xl border flex items-center gap-1 hover:scale-105 active:scale-95 transition-all cursor-pointer ${
              settings.theme === 'cosmic-dark'
                ? 'border-slate-800 text-slate-300 hover:bg-slate-900 bg-slate-900/40'
                : 'border-slate-200 text-slate-600 hover:bg-slate-100 bg-white'
            }`}
            title="大模型接口及引擎参数"
          >
            <Sliders className="w-4 h-4" />
            <span className="hidden sm:inline text-xs font-semibold font-sans">偏好设置</span>
          </button>

          {/* Local Archives history Trigger */}
          <button
            onClick={() => setIsHistoryOpen(true)}
            className={`p-2.5 rounded-xl border flex items-center gap-1.5 hover:scale-105 active:scale-95 transition-all cursor-pointer relative ${
              settings.theme === 'cosmic-dark'
                ? 'border-slate-800 text-slate-300 hover:bg-slate-900 bg-slate-900/40'
                : 'border-slate-200 text-slate-600 hover:bg-slate-100 bg-white'
            }`}
          >
            <History className="w-4 h-4" />
            <span className="hidden sm:inline text-xs font-semibold font-sans">翻译历史</span>
            {sessions.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4, min-w-4 h-4 bg-brand-500 text-white rounded-full text-[9px] font-bold flex items-center justify-center px-1 animate-bounce">
                {sessions.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* ── Main Layout Body ── */}
      <main className="flex-1 w-full max-w-[1720px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 p-4 md:p-6 lg:p-8 relative z-10">
        
        {/* LEFT COLUMN: Input Workspace & Export Console (Span 5 on Desktop) */}
        <section className="lg:col-span-5 flex flex-col gap-6">

          {/* Language direction swapping strip */}
          <div className={`rounded-2xl border p-4 flex items-center justify-between shadow-sm ${cardBorderClass}`}>
            {/* Source selector picker */}
            <button
              onClick={() => setIsSrcSelectorOpen(true)}
              className="flex flex-col items-start gap-1 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all text-left flex-1 cursor-pointer"
            >
              <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">源语言 (From)</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{srcLang.flag}</span>
                <span className="font-serif font-bold text-sm md:text-base">{srcLang.name}</span>
              </div>
            </button>

            {/* Interchange Arrow button */}
            <button
              onClick={handleSwapLanguages}
              className="p-3 bg-brand-50 hover:bg-brand-100 dark:bg-slate-800 hover:scale-110 active:scale-90 text-brand-600 dark:text-brand-400 rounded-full transition-all cursor-pointer shadow-inner mx-4"
              title="互换通道方向"
            >
              <ArrowRightLeft className="w-4 h-4" />
            </button>

            {/* Target selector picker */}
            <button
              onClick={() => setIsTgtSelectorOpen(true)}
              className="flex flex-col items-start gap-1 p-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all text-left flex-1 cursor-pointer"
            >
              <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">译入语言 (To)</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{tgtLang.flag}</span>
                <span className="font-serif font-bold text-sm md:text-base">{tgtLang.name}</span>
              </div>
            </button>
          </div>

          {/* Drag & Drop File Uplink Zone */}
          <div className="relative group">
            {uploadedFileName ? (
              <div className="p-3.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-950/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded bg-emerald-500 text-white">
                    <CheckCircle className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 text-left">
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider">
                      已挂载待译文档
                    </span>
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[240px]">
                      {uploadedFileName}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setUploadedFileName('');
                    setSourceText('');
                  }}
                  className="px-2.5 py-1 text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 rounded-lg hover:underline transition-all cursor-pointer"
                >
                  卸载
                </button>
              </div>
            ) : (
              <div className={`rounded-2xl border border-dashed p-5 text-center flex flex-col items-center justify-center gap-2.5 hover:bg-slate-50 dark:hover:bg-slate-900/40 relative cursor-pointer border-slate-200 dark:border-slate-800`}>
                <input
                  type="file"
                  onChange={handleFileUpload}
                  accept=".txt,.md,.pdf,.docx,.xlsx,.csv"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <FileUp className="w-7 h-7 text-brand-500 animate-pulse" />
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    挂载翻译外部文档 (Upload Document)
                  </p>
                  <p className="text-[10px] text-slate-400 leading-normal max-w-sm">
                    拖拽或点击载入 TXT, MD, PDF, WORD 格式，自适应导入全文
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Text Editor Box */}
          <div className={`rounded-2xl border overflow-hidden flex flex-col ${cardBorderClass}`}>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="请把所需进行多重审议共识翻译的手稿贴入此处……（按住 Ctrl + Enter 回车可快速唤醒合议引擎）"
              rows={8}
              className="w-full p-4 bg-transparent outline-none border-none text-slate-800 dark:text-slate-100 placeholder:text-slate-400 font-sans text-sm md:text-[15px] leading-relaxed resize-none focus:ring-0"
              onKeyDown={(e) => {
                if (e.ctrlKey && e.key === 'Enter') {
                  e.preventDefault();
                  handleStartConsensus();
                }
              }}
            />
            {/* Editor Footer Tools */}
            <div className={`flex items-center justify-between px-4 py-2 border-t text-xs ${cardHeaderClass}`}>
              <span className="text-slate-400 font-mono">
                字数：<strong className="text-slate-700 dark:text-slate-300">{sourceText.length}</strong>
              </span>
              <div className="flex gap-1">
                {sourceText && (
                  <button
                    onClick={() => {
                      setSourceText('');
                      setResultText('');
                      setCurrentRoundResults([]);
                      setAuditScores(null);
                      setUploadedFileName('');
                    }}
                    className="p-1 px-2 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-rose-500 rounded-lg transition-colors cursor-pointer"
                  >
                    清空手稿
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      const clipboardText = await navigator.clipboard.readText();
                      setSourceText(clipboardText);
                      triggerToast('已从剪贴板粘入手稿！', 'success');
                      detectLanguageHeuristically(clipboardText);
                    } catch (_) {
                      triggerToast('无法读取剪贴板', 'error');
                    }
                  }}
                  className="p-1 px-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg transition-colors cursor-pointer"
                >
                  智能粘入
                </button>
              </div>
            </div>
          </div>

          {/* FINAL RESULTS TRANSCRIPTION CARD (Renders only if Translation result is ready) */}
          {resultText && (
            <div className={`rounded-2xl border border-brand-500/20 dark:border-brand-500/10 overflow-hidden shadow-md ${cardBorderClass}`}>
              {/* Card Header title */}
              <div className={`flex items-center justify-between px-4 py-3 border-b border-brand-500/10 ${cardHeaderClass}`}>
                <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-800 dark:text-slate-100 uppercase tracking-widest">
                  <Sparkles className="w-4 h-4 text-brand-500 animate-spin" />
                  终审裁决最优译本 (Verdict Output)
                </div>
                <div className="flex items-center gap-1 text-[11px] text-slate-400">
                  <button
                    onClick={handleNarrateResult}
                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-brand-500 cursor-pointer"
                    title="音流 TTS 地道伴读"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handleCopyResult}
                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-slate-500 hover:text-brand-500 hover:scale-105 active:scale-95 cursor-pointer"
                    title="高保真复制译文"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Parsed Output text */}
              <div className="p-5 font-serif text-[15px] md:text-base leading-relaxed text-slate-800 dark:text-slate-100 tracking-wide select-text">
                <MarkdownRenderer content={resultText} isStreaming={isRunning} />
              </div>
            </div>
          )}

          {/* EXPORTER CONTROL STATION DESK */}
          {resultText && (
            <div className={`rounded-2xl border p-4 space-y-4 ${cardBorderClass}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                  <Download className="w-3.5 h-3.5 text-brand-500" />
                  手稿成果导出台
                </span>
                {/* Export presets checklist info */}
                <span className="text-[10px] text-slate-400 font-sans">
                  自由打包报告
                </span>
              </div>

              {/* Format selection segment */}
              <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-xl text-xs font-semibold">
                {(['md', 'txt', 'json', 'bilingual'] as const).map((fmt) => {
                  const isSelected = exportFormat === fmt;
                  const labels = { md: 'Markdown', txt: '文本', json: 'JSON', bilingual: '对照' };
                  return (
                    <button
                      key={fmt}
                      onClick={() => setExportFormat(fmt)}
                      className={`py-2 rounded-lg text-center cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-white dark:bg-slate-950 shadow-sm text-brand-500 font-black'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                      }`}
                    >
                      {labels[fmt]}
                    </button>
                  );
                })}
              </div>

              {/* Previews Checkboxes array selection */}
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-850 pt-2.5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportPrefs.incSource}
                    onChange={(e) => setExportPrefs({ ...exportPrefs, incSource: e.target.checked })}
                    className="rounded accent-brand-500"
                  />
                  包含原文
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportPrefs.incScores}
                    onChange={(e) => setExportPrefs({ ...exportPrefs, incScores: e.target.checked })}
                    className="rounded accent-brand-500"
                  />
                  评分细节
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportPrefs.incProcess}
                    onChange={(e) => setExportPrefs({ ...exportPrefs, incProcess: e.target.checked })}
                    className="rounded accent-brand-500"
                  />
                  协商记录
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={exportPrefs.incMeta}
                    onChange={(e) => setExportPrefs({ ...exportPrefs, incMeta: e.target.checked })}
                    className="rounded accent-brand-500"
                  />
                  元数据
                </label>
              </div>

              {/* Export Action trigger widgets */}
              <div className="grid grid-cols-12 gap-2 pt-2 border-t border-slate-100 dark:border-slate-850">
                <button
                  onClick={handleDownloadFile}
                  className="col-span-8 py-2.5 bg-slate-900 hover:bg-slate-850 dark:bg-brand-500 dark:hover:bg-brand-600 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1 hover:shadow-lg transition-all cursor-pointer font-sans"
                >
                  <Download className="w-3.5 h-3.5" />
                  下载成果报告 (.zip/.md)
                </button>
                <button
                  onClick={() => setShowExportPreview(!showExportPreview)}
                  className="col-span-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-all cursor-pointer font-sans"
                >
                  {showExportPreview ? '收起预览' : '代码预览'}
                </button>
              </div>

              {/* Interactive document Code Previews segment */}
              <AnimatePresence>
                {showExportPreview && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="relative pt-2">
                      <button
                        onClick={handleQuickCopyExport}
                        className="absolute right-3.5 top-5 p-1 text-[10px] font-semibold text-slate-400 hover:text-white bg-slate-800 rounded flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        一键复本
                      </button>
                      <pre
                        ref={previewRef}
                        className="p-3 bg-slate-950 border border-slate-800/80 rounded-xl text-[10px] font-mono leading-relaxed overflow-x-auto text-slate-400 select-all max-h-56 overflow-y-auto"
                      >
                        {generatedExportContent}
                      </pre>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

        </section>

        {/* RIGHT COLUMN: Pipeline Diagnostics, Rounds Debates, and Scores Rating Board (Span 7 on Desktop) */}
        <section className="lg:col-span-7 flex flex-col gap-6">

          {/* Consensus Active monitor telemetry panel */}
          <EngineStatus
            isRunning={isRunning}
            statusText={statusText}
            adaptiveModeLabel={activeSegmentIndex === 'refined' ? '精微多智能体协联' : activeSegmentIndex === 'chunk' ? '超长分块翻译' : '标准多轮合议'}
            adaptiveModeKey={activeSegmentIndex}
            progressPercent={progressPercent}
            elapsedSeconds={elapsedSeconds}
            onStop={handleStopTranslation}
            onStart={handleStartConsensus}
            isDisabled={isRunning || !sourceText.trim()}
          />

          {/* Dynamic round debate accordion card array displays */}
          {currentRoundResults.length > 0 ? (
            <div className="space-y-4">
              <h3 className="font-serif font-black text-base mt-2 flex items-center gap-1.5 border-b border-dashed border-slate-200 dark:border-slate-800/80 pb-2">
                智能协商纪要 (Live Telemetry Logs)
              </h3>
              
              {currentRoundResults.map((round, idx) => (
                <RoundDetails
                  key={round.round}
                  roundData={round}
                  dynamicAgentName={metaDynamicAgent?.name}
                  isCompleted={idx < currentRoundResults.length - 1 || progressPercent === 100}
                  defaultExpanded={idx === currentRoundResults.length - 1}
                />
              ))}
            </div>
          ) : (
            /* Idle prism empty-state visual showcase */
            <div className={`p-10 text-center flex flex-col items-center justify-center gap-6 rounded-2xl border min-h-[460px] relative overflow-hidden flex-1 ${cardBorderClass}`}>
              {/* Glowing Prismic element icon */}
              <div className="relative w-28 h-28 flex items-center justify-center bg-slate-50 dark:bg-slate-950/40 rounded-full shadow-inner animate-[pulse_3s_ease-in-out_infinite]">
                <div className="absolute inset-0 rounded-full border border-brand-500/20 dark:border-brand-500/10 animate-[spin_12s_linear_infinite]" />
                <div className="absolute inset-4 rounded-full border border-dashed border-rose-500/20 dark:border-rose-500/10 animate-[spin_8s_linear_infinite_reverse]" />
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-brand-600 to-rose-400 flex items-center justify-center text-white scale-110 shadow-lg shadow-brand-500/10 rotate-12">
                  <Sparkles className="w-7 h-7" />
                </div>
              </div>

              <div className="space-y-1.5 max-w-md">
                <h3 className="font-serif font-bold text-base md:text-lg">
                  棱镜多义智能合议工坊 · 待起流
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed font-sans">
                  贴入手稿后，六位专精不同维度的“智能学者”（信、达、雅、镜）将各抒己见，进行多学科评审、批判、和合意，最后由翻译总监一键产出最终成果译文。
                </p>
              </div>

              {/* Features key list grids */}
              <div className="grid grid-cols-2 gap-3.5 w-full max-w-xl text-left text-[11px] font-sans text-slate-500">
                <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-950/20 flex gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 mt-1" />
                  <div>
                    <strong className="text-slate-700 dark:text-slate-300 font-semibold block mb-0.5">信 · A路语言学家</strong>
                    逐词严格对应词法结构，精准防漏
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-950/20 flex gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0 mt-1" />
                  <div>
                    <strong className="text-slate-700 dark:text-slate-300 font-semibold block mb-0.5">达 · B路本土编辑</strong>
                    母语视角重构，消弭翻译直白硬涩腔
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-950/20 flex gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 mt-1" />
                  <div>
                    <strong className="text-slate-700 dark:text-slate-300 font-semibold block mb-0.5">雅 · C/F领域与风格对齐</strong>
                    锁定技术词库且深度镜像还原作者气韵
                  </div>
                </div>
                <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/40 dark:bg-slate-950/20 flex gap-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0 mt-1" />
                  <div>
                    <strong className="text-slate-700 dark:text-slate-300 font-semibold block mb-0.5">境 · E路隐义后处理器</strong>
                    侦测言下之非直白双关意境并予以补全
                  </div>
                </div>
              </div>

              {/* Try quick Demo trigger */}
              <div className="bg-slate-50 dark:bg-slate-950 rounded-xl p-3 max-w-[280px] border border-slate-100 dark:border-slate-850/80 flex flex-col gap-1 inline-block">
                <button
                  onClick={() => {
                    setSourceText(DEMO_TEXT);
                    triggerToast('示例文稿已就绪，由于未设置API密钥，将自动运行高解析流式智能体验合议过程！', 'success');
                  }}
                  className="w-full py-2 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold rounded-lg shadow-sm font-sans flex items-center justify-center gap-1 cursor-pointer hover:-translate-y-0.5 transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5 fill-white" />
                  一键贴入大片示例手稿
                </button>
              </div>
            </div>
          )}

          {/* FINAL QUALITY TELEMETRY GRADE AUDIT PANEL */}
          {auditScores && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`rounded-2xl border p-5 space-y-4 shadow-sm ${cardBorderClass}`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                <h3 className="font-serif font-bold text-base text-slate-800 dark:text-slate-100">
                  PrismTrans 综合翻译质量终审报告 (Engine Evaluation)
                </h3>
              </div>

              {/* Progress sliders grids */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { name: '忠实度 (Fidelity)', val: auditScores[0], color: 'from-emerald-500 to-teal-400', remarks: '语义对齐度' },
                  { name: '流畅度 (Fluency)', val: auditScores[1], color: 'from-brand-500 to-rose-400', remarks: '语理顺达度' },
                  { name: '地道度 (Expressive)', val: auditScores[2], color: 'from-indigo-500 to-blue-400', remarks: '文化气韵合度' },
                ].map((score, index) => (
                  <div
                    key={index}
                    className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-850/60 text-center flex flex-col justify-between"
                  >
                    <span className="text-[10px] text-slate-400 font-semibold font-sans">{score.name}</span>
                    <span className="font-serif text-3xl font-black text-slate-800 dark:text-white my-1 bg-gradient-to-br from-slate-900 to-slate-500 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                      {score.val}/10
                    </span>
                    <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-1 mb-2">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${score.val * 10}%` }}
                        transition={{ duration: 0.8, delay: index * 0.15 }}
                        className={`h-full rounded-full bg-gradient-to-r ${score.color}`}
                      />
                    </div>
                    <span className="text-[9px] text-slate-400 font-mono tracking-wider">{score.remarks}</span>
                  </div>
                ))}
              </div>

              {/* Audit Summary Box */}
              {auditRemark && (
                <div className="p-4 rounded-xl border border-brand-100/50 bg-brand-50/5 dark:bg-slate-950/10 text-xs leading-relaxed text-slate-600 dark:text-slate-400 prose prose-slate">
                  <MarkdownRenderer content={auditRemark} isMemo />
                </div>
              )}
            </motion.div>
          )}

        </section>

      </main>

      {/* ── Toasts container ── */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2.5 max-w-md w-full px-4 font-sans text-xs">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 30, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.9 }}
              className={`p-3.5 rounded-xl shadow-lg ring-1 flex items-center justify-between gap-3 text-slate-50 border ${
                t.type === 'success'
                  ? 'bg-emerald-900/90 ring-emerald-500/20 border-emerald-500/10'
                  : t.type === 'error'
                  ? 'bg-rose-950/90 ring-rose-500/20 border-rose-500/10'
                  : 'bg-slate-900/90 ring-slate-500/10 border-slate-800/10'
              }`}
            >
              <span className="font-medium text-left leading-relaxed">{t.msg}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
                className="opacity-70 hover:opacity-100 text-xs px-1 hover:underline"
              >
                ✕
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Sub Selector Drawers & Overlays ── */}
      <LanguageSelector
        isOpen={isSrcSelectorOpen}
        onClose={() => setIsSrcSelectorOpen(false)}
        selectedLanguage={srcLang}
        onSelect={setSrcLang}
        title="选择翻译源文本语种"
      />

      <LanguageSelector
        isOpen={isTgtSelectorOpen}
        onClose={() => setIsTgtSelectorOpen(false)}
        selectedLanguage={tgtLang}
        onSelect={setTgtLang}
        title="选择目标合议语流语种"
      />

      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={(updated) => {
          setSettings(updated);
          triggerToast('由于没有写入真实API密钥，系统偏好参数已更新，引擎校对管线将自适应模拟！', 'success');
        }}
      />

      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        sessions={sessions}
        onLoadSession={(session) => {
          setSourceText(session.source);
          setResultText(session.result);
          // Set language objects appropriately
          const matchedSrc = LANGUAGES.find((l) => l.code === session.srcCode) || srcLang;
          const matchedTgt = LANGUAGES.find((l) => l.code === session.tgtCode) || tgtLang;
          setSrcLang(matchedSrc);
          setTgtLang(matchedTgt);
          setAuditScores(session.scores);
          setAuditRemark(session.remark || '');
          
          // Mimic Round Results
          if (session.roundData) {
            setCurrentRoundResults(session.roundData);
          } else {
            setCurrentRoundResults([]);
          }
          triggerToast('翻译档案已复原挂载！', 'success');
        }}
        onDeleteSession={(id) => {
          const updated = sessions.filter((s) => s.id !== id);
          setSessions(updated);
          localStorage.setItem('prism_history', JSON.stringify(updated));
          triggerToast('一条本地记录已彻底抹除', 'info');
        }}
        onClearAll={() => {
          setSessions([]);
          localStorage.removeItem('prism_history');
          triggerToast('全部本地历史档案已清空', 'info');
        }}
      />
    </div>
  );
}
