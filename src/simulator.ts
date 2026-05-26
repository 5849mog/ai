/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Language, RoundData, TranslationSession } from './types';

// Standard demo text data matching user's "试译一段" requirements
export const DEMO_TEXT = `在世界人工智能大会的开幕式上，百度创始人李彦宏发表了题为《译者时代》的主旨演讲。他指出，大语言模型已经从"炫技"阶段迈入"应用"阶段，而译者（Agent）将成为连接用户与服务的核心枢纽。

"未来的互联网将不再是你去搜索信息，而是译者主动为你完成任务。"李彦宏以医疗健康领域为例，阐述了 AI 译者如何帮助患者完成从症状描述、医院推荐到挂号预约的全流程服务。他强调，这一转变需要解决三大挑战：数据隐私保护、多模态交互能力、以及可解释性。

演讲尾声，他引用了一句古希腊哲言："认识你自己。"并补充道，"而在 AI 时代，我们更需要让 AI 认识每一个独特的你。"`;

// High fidelity Simulated Translation Process for the standard demo text
export const SIMULATED_ROUNDS_DATA: RoundData[] = [
  {
    round: 1,
    paths: {
      A: `At the opening ceremony of the World Artificial Intelligence Conference, Robin Li, the founder of Baidu, delivered a keynote speech titled "The Era of Translators" (Agent). He pointed out that large language models have entered the "application" phase from the "tech-showoff" phase, and agents will become the core hub connecting users and services.

"The future Internet will no longer be about you searching for information, but translators actively completing tasks for you." Taking the healthcare sector as an example, Robin Li explained how AI agents help patients complete the entire process from symptom description, hospital recommendation to booking appointments. He stressed that this transformation needs to solve three major challenges: data privacy protection, multimodal interaction capability, and explainability.

At the end of the speech, he quoted an ancient Greek proverb: "Know thyself." He added, "In the AI era, we need to let AI know every unique you even more."`,
      B: `Robin Li, founder of Baidu, kicked off the World Artificial Intelligence Conference with a compelling keynote speech titled "The Age of the Agent." He declared that large language models have transitioned from being merely "gimmicky tech previews" into "substantive applications," with AI Agents emerging as the crucial bridge connecting users and services.

"In the future, the internet won't just sit there waiting for you to search for information; instead, active agents will complete tasks for you," Li remarked. Using healthcare as an example, he illustrated how AI agents can streamline a patient's journey—from describing symptoms and receiving hospital recommendations to scheduling doctor appointments. However, he noted that this shift hinges on mastering three critical challenges: data privacy, multimodal interface capabilities, and framework explainability.

Closing his address, Li invoked the ancient Greek adage, "Know thyself," adding: "But in the era of AI, what matters most is letting AI understand the unique individual that is you."`,
      C: `At the World AI Conference (WAIC) opening ceremony, Baidu founder Robin Li delivered a keynote titled "The Era of Agents." He stated that Large Language Models (LLMs) have migrated from the "technology demonstration" phase to "practical application," noting that Agents will serve as the core pipeline interface between users and services.

"The future internet paradigm will shift from pull-based search to agentic automation," Li explained, highlighting healthcare delivery to show how AI Agents coordinate workflows, ranging from symptom profiling and hospital matching to automated scheduling. He underscored three critical hurdles: strict data privacy protection, robust multimodal interaction, and model interpretability.

Concluding his address, he cited the Socratic maxim "Know thyself," appending: "In the LLM era, our mandate is to configure AI to recognize each unique user."`,
      D: `At the opening session of the World AI Conference, Baidu’s founder Robin Li delivered a strategic address entitled "The Age of the Agentic Hub." He declared that generative systems have crossed the chasm from "performance showcase" to "enterprise deployment," framing the AI Agent as the ultimate nexus for user-service coordination.

"The upcoming digital paradigm will bypass direct queries; instead, intelligent agents will autonomously orchestrate workflows," Li forecasted. He illustrated this through patient healthcare systems, mapping how agents manage the patient lifecycle—from initial symptom logging and clinical triage to final slot reservations. He flagged three key system bottlenecks: data privacy compliance, cross-modal integration, and ethical explainability.

He concluded with the classic philosophy: "Know thyself," suggesting: "In the cognitive era, our priority is provisioning machines with the context to fully comprehend you."`,
      F: `At the opening of the World Artificial Intelligence Conference, Google AI and Baidu's pioneer Robin Li delivered an elegant, thought-provoking keynote under the banner "The Era of the Translator-Agent." He argued that major language models have completed their transition from "technical showmanship" to "real-world application," positioning the Agent as the ultimate bridge between human intent and software utility.

"The internet of tomorrow will no longer demand that you seek; it will offer Translators that execute," Li envisioned. Focusing on medicine, he elegantly mapped a patient's path—from mapping symptoms and seeking medical centers to final slot booking. He marked three grand frontiers for this shift: private data sovereignty, seamless multimodal dialogue, and cognitive explainability.

As a final grace note, he evoked the Oracle of Delphi: "Know thyself." "Yet in this AI dawn," he remarked, "the greater calling is to teach AI to know the unique beauty of who you are."`,
      E: `【隐义诊断意见】
原文“译者”在演讲中是一个双关：字面指Agent（智能体），深层呼应了“消除人机交流隔阂、连接用户与服务”的桥梁涵义。
1. B路用“gimmicky tech previews”翻译“炫技”极佳，充分传达了演讲者对早期技术炒作的戏谑意味。
2. C路用“pull-based search to agentic automation”表达了互联网搜索模式向智能体代理任务执行的深度跃迁，符合专业术语。
3. 原文尾声“让AI认识每一个独特的你”，在英文语族中，呼应“Know thyself”的最佳代词置换是修辞对仗。B路和F路处理具有极高的文学色彩。建议在裁决中将F路的浪漫主义色彩与C路的底层技术架构风格进行有机融合。`
    },
    critiques: {
      A: `【自审-甲】忠实度极为完美，原语中所有要点（医疗流程、三大挑战等）均精准保留，但句式略显呆板，翻译腔稍重。
【评估-B（本土编辑）】表达流畅极其惊艳，但“Age of the Agent”未能涵盖“译者”的双重对应关系，“gimmicky tech previews”修辞略微过度。
【评估-C（领域专家）】术语精确度非常高，“WAIC”和“LLMs”很符合行业规范，但句法过度紧凑，学术色彩过于浓厚，缺乏主旨演讲的口语鼓动感染力。`,
      B: `【自审-乙】可读性极高，采用了标准的英文演讲高亢语体。但在第二段中，把“未来的互联网将不再是你去搜索信息，而是译者主动为你完成任务”拆分时，稍失原文逻辑。
【评估-C（领域专家）】“Paradigm shift”用词太棒了，完美捕捉了李彦宏所表达的宏大变革感。
【评估-D（专属译者）**】“nexuses of user-service coordination”过于学术化和晦涩，削弱了人性化温度。`,
      C: `【自审-丙】“technology demonstration”和“agentic automation”完美贴合AI领域专家术语。但整体句法过于干瘪，读起来像科学报告。
【评估-D（专属译者）】“generative systems”将“大语言模型”范畴有所扩大，虽然全面但不够严谨。
【评估-F（风格镜像师）】“Translator-Agent”用词新颖，极好地扣住了演讲题目《译者时代》中的隐喻。`,
      D: `【自审-丁】自主设计的协调架构视角完美突出了商业系统部署的概念，但是有些句子太长，在多模态和可解释性部分读起来略显冗长。
【评估-A（语言学家）】“tech-showoff”作为“炫技”略显平淡和粗俗，不如B路的表达地道。
【评估-B（本土编辑）】整体风格极强，特别喜欢最后一句“But in the era of AI, what matters most...”，几乎是完美的同等效力翻译。`,
      F: `【自审-己】还原了哲学气韵与修辞之美，特别是Delphi的引用。但在技术点上略显松散，特别是三大挑战处偏重文学表达。
【评估-A（语言学家）】逐字对照较为僵硬，“World Artificial Intelligence Conference”缩写未出，略占版面。
【评估-C（领域专家）】专业味道十足，但对于广大非专业受众在WAIC这种公开场合，阅读负担偏大。`
    },
    synthesis: `Indeed, large language models have transited from mere technical virtuosity to practical orchestration, and the Agent (reimagined as the "Translator") stands as the paramount bridge connecting human intent and service ecosystems.

"The internet of tomorrow will no longer oblige you to search; rather, intelligent agents will pro-actively resolve tasks on your behalf." Li illustrated this agentic evolution inside healthcare—guiding a patient seamlessly through symptom logging, clinical triage, and medical slot booking. He underscored three systemic frontiers blocking this shift: data privacy sovereignty, multimodal interface capabilities, and framework explainability.

Concluding his address, Li invoked the legendary Socratic maxim, "Know thyself." "Yet in this AI dawn," he appended, "our greater calling is to allow AI to know and celebrate the unique individual that is you."`,
    memo: `本轮主轴：采纳了B路（本土编辑）的演讲宣讲语气作为语言主轴，并高保真融合了C路（领域专家）在“AI智能体服务流”中的核心术语（data privacy sovereignty, multimodal interface, framework explainability）。
遗留问题：第一段中的“大语言模型”与“译者”双关在合成句中可以进一步提炼，使语法更工整。
待优化片段：“而译者（Agent）将成为连接用户与服务的核心枢纽”
下轮策略：在第二轮协商中，将重点微调第一句的流畅度，并将F路（风格镜像师）优雅的气韵对齐到各段衔接处。`,
    usageTokens: { prompt: 4096, completion: 1512, total: 5608 }
  },
  {
    round: 2,
    paths: {
      A: `At the opening ceremony of the World Artificial Intelligence Conference, Robin Li, founder of Baidu, delivered a keynote address entitled "The Era of the Translator." He emphasized that Large Language Models (LLMs) have crossed the threshold from tech-showmanship to actual application, and the Translator (Agent) will emerge as the core nexus mapping users to service arrays.

"The Web of the future will no longer be about you crawling for information; instead, the Translators will autonomously handle tasks for you." Taking healthcare as an example, Robin Li detailed how AI Translators navigate an individual from clinical symptom tracing and institutional matching to direct slot allocation. He flagged three key systemic bottlenecks: user privacy locks, native multimodal dialogue, and pipeline interpretability.

In his speech's graceful exit, he cited the Socratic wisdom: "Know thyself." He added reflecting: "Yet in this AI era, we need to let AI know every distinct aspect of who you are."`,
      B: `At the opening session of the World Artificial Intelligence Conference, Baidu founder Robin Li delivered a strategic keynote titled "The Age of the Agent as Translator." He argued that large language models have finished their "wow-factor showcase" and are moving into genuine application, with the Agent, acting as an intellectual translator, serving as the ultimate nexus connecting users with digital services.

"The internet of tomorrow will bypass simple search queries; instead, active agents will take the initiative to orchestrate tasks for you," Li forecasted. He pointed to healthcare to show how AI agents can shepherd patients through a unified journey—from initial symptom logging and hospital triage to hospital slot booking. He marked three grand challenges for this digital transition: data privacy, fluid multimodal interaction, and explainability.

He concluded by citing the timeless Greek maxim: "Know thyself." "But in the cognitive era," he added, "our deeper mandate is to configure AI to understand the unique characteristics of you."`,
      C: `At the World AI Conference opening ceremony, Baidu’s founder Robin Li delivered a keynote lecture entitled "The Era of the Translator-Agent." He highlighted that Large Language Models (LLMs) have crossed the chasm from "performance showcases" to "practical deployments," specifying that the Translator (represented by the AI Agent) will become the central hub connecting end-users to downstream services.

"The future internet paradigm will transition from query-driven search to autonomous agentic execution," Li described, using medical ecosystems to conceptualize how AI Agents manage patient lifecycles, spanning symptom profiling, clinical recommendation, and booking slot allocations. He highlighted three research frontiers: strict data privacy protection, robust multimodal interfaces, and model explainability.

Concluding his address, he cited the ancient maxim "Know thyself," suggesting: "In the AI era, our design objective is to enable AI to recognize and adapt to each unique user."`,
      D: `At the World AI Conference, Baidu founder Robin Li presented his vision under the title "The Translator Ecosystem." He stated that Large Language Models have successfully transitioned from the "exposing technical limits" phase into "enterprise execution," casting the Agent as the ultimate nexus for user-service interactions.

"The future of the digital world won't be dominated by passive searching, but by active Agent orchestration on your behalf," Li explained. He demonstrated this using the hospital workflow, showing how AI Translators autonomously guide a patient from logging symptom patterns and clinics matching right through to booking clinical slots. He identified three key technical bottlenecks: user privacy boundaries, multimodal synchronization, and transparent explainability.

He closed by recalling: "Know thyself," and argued: "In the era of AI, we must empower systems to understand the distinct contours of your identity."`,
      F: `At the opening of the World Artificial Intelligence Conference, Baidu’s founder Robin Li delivered an inspiring keynote under the title "The Era of the Translator-Agent." He observed that large language models have moved past the phase of "performance spectacles" and are entering the era of "real-world application," with the Agent (acting as the linguistic and functional translator) serving as the bridge between humanity and services.

"The web of tomorrow will not ask you to seek; it will assign Translators to draft and execute," Li envisioned. Highlighting healthcare, he mapped out a patient's seamless journey from symptom profiling and clinic recommendations to scheduling doctor slots. He isolated three grand frontiers: user data privacy, multimodal conversation, and AI explainability.

In his final remarks, he echoed the Oracle of Delphi: "Know thyself." "Yet in this cognitive dawn," he added, "the greater task is to enable AI to truly know and honor the unique individual in you."`,
      E: `【隐义诊断意见】
第二轮中，F路和B路对“译者时代”的双关隐喻做出了更为完美的翻译。
1. B路用“wow-factor showcase”翻译“炫技”更具演讲风采，比上轮更加成熟。
2. C路用“autonomous agentic execution”符合最新的前沿学术报告，而F路采用“not ask you to seek; it will assign Translators to draft and execute”将未来的交互变革翻译得极富生命力和感染力，体现了等效的文体韵味。
3. 隐义诠释建议：融合主轴应彻底吸纳F路对尾声金句“让AI认识每一个独特的你”的处理，使其与Socrates箴言的呼应更加无缝。`
    },
    critiques: {
      A: `【自审-甲】整体句型相比上一轮得到了极大的舒展，忠实度依旧保持极高，但在“译者”隐语处仍稍显死板。
【评估-F（风格镜像师）】对最后两句话的笔触非常具有文学张力，近乎完美，且三大挑战的翻译非常干净，强烈建议采纳。`,
      B: `【自审-乙】“Age of the Agent as Translator”将中英文在双语标题上的呼应做到了最大程度的均衡。
【评估-C（领域专家）】“patient lifecycles”和“downstream services”用词非常准确、老道，凸显了领域专家的实力。`,
      C: `【自审-丙】“tech-showmanship”和“practical deployments”对仗极佳，但在结尾的叙事风格上显得有些冰冷。
【评估-F（风格镜像师）】文学气韵极其优美，特别是“cognitive dawn”（人工智能拂晓）的意象使用，非常打动人。`,
      D: `【自审-丁】通过结合医疗系统的“hospital workflow”，使得第二段医疗案例具有极佳的企业设计感，且词律很工整。
【评估-B（本土编辑）】整体口吻最符合Robin Li主旨演讲的场景，既有高层视角的宏大感，又有大模落地的务实性。`,
      F: `【自审-己】在保持高度艺术性的同时，对三大挑战的技术词汇进行了精准对齐，消除了第一轮的松散，现在表现极佳。
【评估-D（专属译者）】“distinct contours of your identity”非常具有散文美，体现了专属定制译者的细腻关怀。`
    },
    synthesis: `At the opening ceremony of the World Artificial Intelligence Conference, Robin Li, the founder of Baidu, delivered an inspiring keynote address titled "The Era of the Translator-Agent." He highlighted that Large Language Models have successfully crossed the threshold from "tech-wow showcasing" to substantive "real-world application," positioning the Agent as the ultimate translator and nexus connecting users directly with services.

"The internet of tomorrow will no longer ask you to search; rather, intelligent agents will actively orchestrate and complete tasks on your behalf." Li illustrated this agentic paradigm shift through medical care, showing how AI Translators autonomously shepherd patients cardinally from symptom profiling and hospital recommendations to scheduling booking slots. He emphasized that this digital transition resides on three grand frontiers: user data privacy, native multimodal conversation, and framework explainability.

Concluding his address, he cited the ancient maxim: "Know thyself." "Yet in this cognitive dawn," Li appended, "our deeper mandate is to configure AI to recognize and celebrate the unique individual that is you."`,
    memo: `本轮主轴：确立了以F路（风格镜像师）的文学优雅宣讲为基调，深度揉合了B路（本土编辑）与C路（领域专家）关于互联网交互变迁和AI技术实操的硬核表达，整体语感已臻炉火纯青。
遗留问题：本篇翻译已经高度契合了“信、达、雅”和“风格等效迁移”的指标。
待优化片段：无
下轮策略：完成迭代，移交终审评估。`,
    usageTokens: { prompt: 5120, completion: 1840, total: 6960 }
  }
];

export const SIMULATED_AUDIT_DATA = {
  scores: [10, 9, 10] as [number, number, number],
  remark: `### 🏅 棱镜译系统综合质量审计：
1. **忠实度 (10/10)**：译文极其忠实地重现了李彦宏主旨演讲的全部信息要点。将“炫技”译为“tech-wow showcasing”表现出色，对医疗流程的各个节点（symptom profiling, hospital recommendations, booking slots）还原异常精确。
2. **流畅度 (9/10)**：句子结构行云流水，打破了传统的逐字死板对译，完美符合英语本土演讲的语势和节奏，排比语境流畅自然。
3. **地道度 (10/10)**：将“译者时代”巧妙隐喻为“Translator-Agent”，把结尾的“让AI认识独特的你”与希腊箴言“Know thyself”完美呼应，在“言下之意”和“风格气韵等效”上达到了行业殿堂级翻译水准。`
};

// Simple helper to sleep so we simulate real-time API streaming character-by-character
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Stream helper for React state mimicking real streaming fetches
export const streamSimulatedText = async (
  fullText: string,
  onUpdate: (streamedText: string) => void,
  abortSignal?: AbortSignal,
  speedMultiplier: number = 2
) => {
  let currentString = '';
  // Stream words and characters
  const chunks = fullText.split(/(\s+|\n+)/);
  for (const chunk of chunks) {
    if (abortSignal?.aborted) return;
    currentString += chunk;
    onUpdate(currentString);
    await sleep(Math.max(5, Math.min(60, 40 / speedMultiplier)));
  }
};

// Generates simulated custom translation process for ANY general inputtext when API keys are blank
export const generateSimulatedRoundsForCustomText = (text: string, src: string, tgt: string): RoundData[] => {
  const charCount = text.length;
  const sentenceSnippet = text.slice(0, 30) + (charCount > 30 ? '...' : '');

  return [
    {
      round: 1,
      paths: {
        A: `[语言学家草稿] 经过对原文的语法分析，将“${sentenceSnippet}”及其后续内容忠实转换为目标语言 ${tgt}。我们极力保留原句的被动语态、动宾结构。句式保持与原文百分之百对应，未发现严重信息缺漏。确保逻辑一致。`,
        B: `[本土编辑草稿] 采取地道 ${tgt} 重构：打破原文的被动语流，将其重构为主动叙事。优化原词中的生硬句式，移除冗余的修饰衔接词，使得在“${tgt}”母语者听来如行云流水。`,
        C: `[领域专家草稿] 经过领域语体扫描，定位这段文本属于通用科技语篇。我们对其中的关键短语（如“${sentenceSnippet}”）进行了专业定义，锁定了目标术语词频。`,
        D: `[定制智体 D 草稿] 从文本所呈现的特殊格式和感情语境出发，强化了文本中潜藏的劝诱语气和商业感染力。`,
        F: `[风格镜像师草稿] 评估原文气韵为温和、感性，具有淡淡的散文色彩，我们在译文中致力于还原这种情绪价值和流动韵律。`,
        E: `【隐义诠释建议】
原文含有一定的劝诱和潜在意图。建议在最终裁决中，摒弃A路的过于僵硬的学术死板直译，全面吸纳B路的流畅框架，并点缀D路的专业度。`
      },
      critiques: {
        A: `【自审-甲】忠实无误，但过于死板。B修饰极好。C在术语把握上更专业。
【评估-B】译文地道，但有几处漏翻译了部分修辞代词。`,
        B: `【自审-乙】流畅度完美。但C在个别句子里的动词选择更有力量感。`,
        C: `【自审-丙】术语无误，但句法像专利说明书，略微干燥。B的语流更佳。`,
        D: `【自审-丁】语气契合商务表达，赞同E关于隐义的融合建议。`,
        F: `【自审-己】文学美感表现良好。但在名词对应的严谨性上应多借鉴C路。`
      },
      synthesis: `[第一轮裁断结果]
综合五位译人草稿，以乙（本土编辑）的流利度作为结构主轴，拼融入丙（领域专家）提取的专业术语。在第一段衔接处吸纳了风格镜像师的诗意细节。

最终成果译文：
(这里是根据您的输入“${sentenceSnippet}”为您综合翻译得出的阶段性 ${tgt} 译本...)`,
      memo: `本轮主轴：采纳B路口吻。
遗留问题：某些术语映射仍有微小偏差。
下一轮策略：在下一轮深度对话中进行精细化的标点磨光和句法重构。`,
      usageTokens: { prompt: Math.round(charCount * 2.5), completion: Math.round(charCount * 1.5), total: Math.round(charCount * 4) }
    },
    {
      round: 2,
      paths: {
        A: `[语言学家二轮精修] 基于第一轮的共识，我们对“${sentenceSnippet}”的边缘语序进行了修正。在忠实度上保持极其无可挑剔的长难句对应。`,
        B: `[本土编辑二轮精修] 吸收了第一轮合议，现在译文中的惯用搭配更上层楼，去掉了任何让人感到“翻译腔”的可能。`,
        C: `[领域专家二轮精修] 进行了术语一致性排查，锁定了段落之间的修辞一致性，使其符合特定语域的国际惯例。`,
        D: `[定制智体 D 二轮精修] 专注于个性化语气精修，配合自定义翻译指令完善了文字的情感流露。`,
        F: `[风格镜像师二轮精修] 完成了风格镜像，在诗意的叙述与客观知识的传达之间找到了最好的平衡点。`,
        E: `【隐义诊断意见】
在第二轮优化中，各路草稿在隐义的落地、语调的一致性上已经非常完美，尤其是F路与B路的结合，已经完全跨越了翻译腔的鸿沟。`
      },
      critiques: {
        A: `【自审-甲】已经吸收了B路和F路的生动表达，句法得到了完全的解放。`,
        B: `【自审-乙】二轮精修非常满意，术语已经与C路完美合并。`,
        C: `【自审-丙】行文完美，术语一致。没有发现信息丢失。`,
        D: `【自审-丁】完全符合最终用户的特殊要求偏好。`,
        F: `【自审-己】诗意的韵味和专业性的融合非常典范。`
      },
      synthesis: `[高级翻译裁决总监审订稿]
这是您的文本 “${sentenceSnippet}” 最终通过六位译者多轮对话、交互批判、以及综合裁决得出的最终最优 ${tgt} 译文：

(Here is the polished and refined ${tgt} translation of your text, exhibiting premium synthesis of faithfulness, fluency, and idiomatic local expressions. Readably structured and optimized through iterative multi-agent debate...)`,
      memo: `本轮完成：共识度极佳，顺利将译文移交外部评审审计节点。`,
      usageTokens: { prompt: Math.round(charCount * 3.1), completion: Math.round(charCount * 1.8), total: Math.round(charCount * 4.9) }
    }
  ];
};
