export function createOpeningDialogs({ getSession, onNew, onModal }) {
  const mount = document.createElement("div");
  mount.innerHTML = `<dialog class="opening-modal" id="modeDialog" aria-labelledby="modeTitle">
    <header><div><h2 id="modeTitle">落子之前</h2><p>选规则，也选这盘棋的使用方式。</p></div><button type="button" data-close>返回</button></header>
    <label class="mode-field">棋局规则<select id="ruleMode"><option value="freestyle">无禁手</option><option value="renju">禁手 · 自由开局</option><option value="rif">五手两打</option><option value="taraguchi10">塔拉山口-10</option></select></label>
    <label class="mode-field">对局方式<select id="workflowMode"><option value="copilot">AI 附身外部棋局 · 你录开局，AI 替你落子</option><option value="follow">只记录棋局 · 双方手动录入，AI 只建议</option><option value="duel">与 AI 对弈 · AI 自动完成它的回合</option></select></label>
    <p class="mode-description" id="modeDescription">附身模式在棋盘旁逐阶段确认本局角色。己方的开局与应手由 AI 自动给出，对手的操作由你录入。</p>
    <p class="import-warning">开始将替换本页当前对局；可先从菜单导出记录。</p><button type="button" class="confirm-mode" id="startMode">开始新局</button></dialog>
    <dialog class="opening-modal opening-guide" id="guideDialog" aria-labelledby="guideTitle">
    <header><div><h2 id="guideTitle">连珠手帖</h2><p>规则 · 开局 · AI 附身</p></div><button type="button" data-close>返回棋盘</button></header>
    <p class="guide-lead">对手操作，你录入。<br>轮到你，AI 直接出棋。</p>
    <h3>AI 附身外部棋局</h3><ol>
    <li>选择比赛采用的规则后，每局开始都在棋盘旁选择本局角色，完整界面与简洁界面一致。五手两打显示「我摆前三子 · 暂执黑」和「对方摆前三子 · 我暂执白」两个按钮，点完消失，不必去设置页面预先决定；与 AI 对弈时，对方按钮显示为 AI。</li>
    <li>五手两打前三子始终是黑、白、黑，由暂执黑方一人摆出。你摆时，AI 自动给出三子，并在棋子上标 1、2、3，按顺序照搬；对方摆时，只需按同样顺序录入位置，颜色自动安排。没有白、黑、白的三子开局。</li>
    <li>前三子之后，另一方有换色权。按钮直接出现在棋盘旁：你决定时 AI 自动比较并标出建议，你点按钮确认；对方决定时按对方实际选择点击。交换只改变双方执色，不改变已有棋子，后续 AI 始终负责你的新棋色。</li>
    <li>第四手、第五手提案、选案与第六手也按实际角色衔接：轮到你时 AI 自动操作，轮到对方时录入实际结果。候选标成 A1、A2（十打为 A1–A10），选定前不算实子。对方选案时直接点标记或 A1/A2 按钮；你选案时 AI 自动选定并给出白棋第六手。正常对弈继续录入对方，AI 自动替你回应，无需点推荐触发。</li>
    <li>塔拉山口-10 在棋盘旁选择最初执色，每个换色与路线节点也用实体按钮确认。无禁手和禁手自由开局没有固定开局协议：先录入你希望保留的开局，点「开局录完 · AI 接手」。</li>
    <li>已经在中盘或想直接指定开局，用「自定义摆局」录入黑白棋子、选择下一手棋色，再决定「AI 替我落子」还是「我录入对手棋」。AI 只会接管你选定的那一方。</li>
    <li>录错用「悔棋」。AI 已回应时，悔棋会撤掉 AI 的应手和触发它的那步外部棋；换色、候选与选案也会按实际流程撤回。刷新会恢复棋局，导出五目文件会保留完整记录。</li></ol>
    <h3>只记录外部棋局</h3><p>如果希望双方棋子都由你手动录入并且 AI 永不自动落子，选择「只记录棋局」。你可以点击「推荐」分析落点、换色或已提出的候选，建议不会自动执行。</p>
    <p class="guide-note">先核对规则、双方执色、棋盘方向及轮到谁。坐标 A–O 从左到右、15–1 从上到下，天元 H8。外部平台若禁止实时辅助，请遵守其对局约定。候选的「不能对称」是相对于当前黑白棋形：保持已有局面不变的旋转或镜像能互换的候选，算同一个选择，不能重复凑数。</p>
    <h3>规则与开局程序</h3><p>「无禁手」允许双方五连或长连获胜；「禁手 · 自由开局」保留连珠胜负和黑棋禁手，但不开启固定的换色、第五手提案程序，由你按实际局面决定开局。「五手两打」与「塔拉山口-10」都采用连珠禁手，并额外执行各自的正式开局流程。连珠中黑棋须恰好五连，白棋五连或更长均胜；黑棋有长连、四四、三三禁手。</p>
    <h3>五手两打</h3><ol><li>先摆方连续摆黑、白、黑三子：第一子天元，第二子中央 3×3，第三子中央 5×5。去除旋转与镜像等价后共 26 种。</li>
    <li>另一方决定是否交换。现在的白方在任意空点下第四子。</li><li>现在的黑方提出两个不对称等价的第五手候选；白方选其中一个作为黑棋第五手，再在任意空点下白棋第六手。</li><li>之后正常交替，执行黑棋禁手。前三子由同一人摆，不能当成三次普通对弈回合。</li></ol>
    <h3>塔拉山口-10</h3><ol><li>黑第一子天元，另一方可换色；白第二子中央 3×3，另一方可换色；黑第三子中央 5×5，另一方可换色。</li>
    <li>白第四子中央 7×7，现在的黑方选普通路线或十打。</li><li>普通路线：可保持或交换；现在的黑方下第五子，限中央 9×9；另一方再决定是否换色。现在的白方下第六子，位置不限。</li>
    <li>十打路线：这一节点不交换。黑方在全盘任意合法空点提出十个不对称等价的第五手；白方选一个，再在任意空点下白棋第六子。</li><li>之后正常交替，执行黑棋禁手。每次交换都按交换后的执色决定谁落下一子。</li></ol>
    <h3>黑棋禁手</h3><ul><li><strong>长连：</strong>连续六个或更多黑子。</li><li><strong>四四：</strong>一手形成两个四。一个活四的两个获胜端点只算一个四。</li><li><strong>三三：</strong>一手形成两个真活三，须能经合法落子变为两端可获胜的活四。被白子、边界或后续禁手阻断的假三不算。</li></ul>
    <p>同一手已在某方向形成恰好五连，黑棋获胜优先。跟随方式可录入外部实际禁手，提示原因并确认后判白胜；AI 推荐和自动落子避开禁手。</p>
    <h3>推荐背后与边界</h3><p>落子使用 Rapfi 连珠专用黑白神经网络与搜索。五手两打前三子使用平衡搜索；换色建议比较两种执色；候选提案按黑棋搜索排序并去除对称等价；选案逐点从白棋角度比较。推荐总搜索预算 1 秒，加载、模型计算和调度可能另需时间。</p>
    <p>引擎原生支持连珠落子与禁手，开局流程由本页管理，没有专用的交换与十打博弈搜索。在本页与 AI 对弈时，AI 使用普通路线，不会主动选十打；附身和只记录模式可按外部实战录入十打，并分析候选。胜率是固定执色后的局面估计，尚可换色时不显示；它不是对特定对手的实战胜率，不能承诺接管后必胜。</p>
    <p>自定义局面无法倒推之前是否曾下禁手。SGF 保留实子与规则说明，完整换色、候选过程请导出五目 JSON，在本页导入；原无禁手棋谱仍在原无禁手页面使用。简洁模式中，开局、换色、候选选择、禁手确认与错误重试都在棋盘旁完成，不弹出对话框；「悔棋」直接撤回，「推荐」可看额外建议，长按「新局」返回完整界面。</p>
    <p>官方规则：<a href="https://www.renju.net/rifrules/" target="_blank" rel="noopener">RIF 连珠规则</a> · <a href="https://www.renju.net/starting/" target="_blank" rel="noopener">开局索引</a> · <a href="https://www.renju.net/rule/1/" target="_blank" rel="noopener">塔拉山口-10</a></p></dialog>`;
  document.body.append(mount);
  const modes = document.querySelector("#modeDialog"), guide = document.querySelector("#guideDialog");
  const rule = document.querySelector("#ruleMode"), workflow = document.querySelector("#workflowMode");
  for (const dialog of [modes, guide]) { dialog.querySelector("[data-close]").onclick = () => dialog.close(); dialog.addEventListener("close", () => onModal(false)); }
  const open = dialog => { document.querySelector("#recordMenu").open = false; onModal(true); dialog.showModal(); };
  document.querySelector("#openModes").onclick = () => {
    const session = getSession(); rule.value = session.rule; workflow.value = session.workflow; workflow.dispatchEvent(new Event("change")); open(modes);
  };
  const syncModeCopy = () => {
    const freeOpening = ["freestyle", "renju"].includes(rule.value);
    document.querySelector("#modeDescription").textContent = workflow.value === "copilot"
      ? freeOpening ? `${rule.value === "renju" ? "黑棋禁手仍生效。" : "无禁手。"}执色在棋盘旁选择，录完外部开局后点「AI 接手」。` : "本局角色在棋盘旁按实际情况选择。己方开局与应手由 AI 自动给出；对方操作由你录入。简洁界面也可完成全部阶段。"
      : workflow.value === "follow" ? "新局开始后在棋盘旁选择本局角色。双方操作均由你照外部棋局录入，推荐不会自动执行。"
        : "新局开始后在棋盘旁选择本局角色。在本页和 AI 对弈；AI 自动完成它负责的开局与落子。";
  };
  workflow.onchange = syncModeCopy;
  rule.addEventListener("change", syncModeCopy);
  document.querySelector("#startMode").onclick = () => { onNew({ rule: rule.value, workflow: workflow.value, initialBlackSeat: null }); modes.close(); };
  document.querySelector("#openGuide").onclick = () => open(guide);
  return { openGuide: () => open(guide) };
}
