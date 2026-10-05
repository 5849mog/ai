export function createOpeningDialogs({ getSession, onNew, onModal }) {
  const mount = document.createElement("div");
  mount.innerHTML = `<dialog class="opening-modal" id="modeDialog" aria-labelledby="modeTitle">
    <header><div><h2 id="modeTitle">落子之前</h2><p>选规则，也选这盘棋的使用方式。</p></div><button type="button" data-close>返回</button></header>
    <label class="mode-field">棋局规则<select id="ruleMode"><option value="freestyle">无禁手</option><option value="rif">五手两打</option><option value="taraguchi10">塔拉山口-10</option></select></label>
    <label class="mode-field">对局方式<select id="workflowMode"><option value="follow">跟随棋局 · 双方手动录入，AI 只建议</option><option value="duel">与 AI 对弈 · AI 自动完成它的回合</option></select></label>
    <label class="mode-field">谁先摆开局<select id="firstSeat"><option value="0">我方先摆</option><option value="1">对方 / AI 先摆</option></select></label>
    <p class="mode-description" id="modeDescription">跟随棋局中，落子、换色、提案和选案均由你照实际棋局录入。推荐不会自动落子。</p>
    <p class="import-warning">开始将替换本页当前对局；可先从菜单导出记录。</p><button type="button" class="confirm-mode" id="startMode">开始新局</button></dialog>
    <dialog class="opening-modal opening-guide" id="guideDialog" aria-labelledby="guideTitle">
    <header><div><h2 id="guideTitle">连珠手帖</h2><p>规则 · 开局 · 跟随棋局</p></div><button type="button" data-close>返回棋盘</button></header>
    <p class="guide-lead">棋色可以交换。<br>棋局始终跟着实际操作。</p>
    <h3>跟随外部棋局，怎样用</h3><ol>
    <li>在「规则与对局方式」选外部平台使用的规则，再选「跟随棋局」。选择真正先摆开局的一方；这只决定初始角色，后续可依规则交换执色。</li>
    <li>把双方实际落子录入棋盘。手机点两次确认，电脑点击或方向键加回车。双方都能录入，AI 不会自动抢走任何一方的回合。</li>
    <li>点「推荐」分析当前操作。落子时标出建议点；换色时标出建议选项；白方选第五手时比较已录入候选。建议不会自动执行，你仍可输入外部实际下法。</li>
    <li>照外部结果点「交换黑白」或「不交换」。交换只改双方执色，保留棋子。「看黑棋 / 看白棋」只切换分析视角，不交换角色，也不重开。</li>
    <li>提出二打或十打时，依次点入所有候选。数字圆圈是提案，不是实子；齐全后点白方实际选中的一个，才成为黑棋第五手。随后录入白棋第六手。</li>
    <li>录错用「悔棋」逐步撤回，包括换色、每个候选和选定操作。刷新会恢复这些阶段；导出五目文件保留完整流程，可在本页重新导入。</li>
    <li>已到中盘，或开局已在别处完成，用「自定义摆局」摆出实子并指定下一手棋色。跟随方式保留，仍由你录入双方，不要求重走开局。</li></ol>
    <p class="guide-note">先核对规则、双方执色、棋盘方向及轮到谁。坐标 A–O 从左到右、15–1 从上到下，天元 H8。外部平台若禁止实时辅助，请遵守其对局约定。候选的「不能对称」是相对于当前黑白棋形：保持已有局面不变的旋转或镜像能互换的候选，算同一个选择，不能重复凑数。</p>
    <h3>三套规则</h3><p>无禁手：黑白交替，任何一方五连或更长即胜。下面两套采用连珠：黑棋须恰好五连，白棋五连或更长均胜；只有黑棋有禁手。完成交换与候选程序后才正常轮流落子。</p>
    <h3>五手两打</h3><ol><li>先摆方连续摆黑、白、黑三子：第一子天元，第二子中央 3×3，第三子中央 5×5。去除旋转与镜像等价后共 26 种。</li>
    <li>另一方决定是否交换。现在的白方在任意空点下第四子。</li><li>现在的黑方提出两个不对称等价的第五手候选；白方选其中一个作为黑棋第五手，再在任意空点下白棋第六手。</li><li>之后正常交替，执行黑棋禁手。前三子由同一人摆，不能当成三次普通对弈回合。</li></ol>
    <h3>塔拉山口-10</h3><ol><li>黑第一子天元，另一方可换色；白第二子中央 3×3，另一方可换色；黑第三子中央 5×5，另一方可换色。</li>
    <li>白第四子中央 7×7，现在的黑方选普通路线或十打。</li><li>普通路线：可保持或交换；现在的黑方下第五子，限中央 9×9；另一方再决定是否换色。现在的白方下第六子，位置不限。</li>
    <li>十打路线：这一节点不交换。黑方在全盘任意合法空点提出十个不对称等价的第五手；白方选一个，再在任意空点下白棋第六子。</li><li>之后正常交替，执行黑棋禁手。每次交换都按交换后的执色决定谁落下一子。</li></ol>
    <h3>黑棋禁手</h3><ul><li><strong>长连：</strong>连续六个或更多黑子。</li><li><strong>四四：</strong>一手形成两个四。一个活四的两个获胜端点只算一个四。</li><li><strong>三三：</strong>一手形成两个真活三，须能经合法落子变为两端可获胜的活四。被白子、边界或后续禁手阻断的假三不算。</li></ul>
    <p>同一手已在某方向形成恰好五连，黑棋获胜优先。跟随方式可录入外部实际禁手，提示原因并确认后判白胜；AI 推荐和自动落子避开禁手。</p>
    <h3>推荐背后与边界</h3><p>落子使用 Rapfi 连珠专用黑白神经网络与搜索。五手两打前三子使用平衡搜索；换色建议比较两种执色；候选提案按黑棋搜索排序并去除对称等价；选案逐点从白棋角度比较。推荐总搜索预算 1 秒，加载、模型计算和调度可能另需时间。</p>
    <p>引擎原生支持连珠落子与禁手，开局流程由本页管理，没有专用的交换与十打博弈搜索。AI 对弈在第四子后使用普通路线；跟随棋局可录入十打并分析候选。胜率是固定执色后的局面估计，尚可换色时不显示；它不是对特定对手的实战胜率，不能承诺接管后必胜。</p>
    <p>自定义局面无法倒推之前是否曾下禁手。SGF 保留实子与规则说明，完整换色、候选过程请导出五目 JSON，在本页导入；原无禁手棋谱仍在原对战页使用。简洁模式可录入棋子与候选，长按角色按钮获取推荐（键盘聚焦后按 R）；换色阶段短按角色按钮选择；长按「新局」返回完整界面。</p>
    <p>官方规则：<a href="https://www.renju.net/rifrules/" target="_blank" rel="noopener">RIF 连珠规则</a> · <a href="https://www.renju.net/starting/" target="_blank" rel="noopener">开局索引</a> · <a href="https://www.renju.net/rule/1/" target="_blank" rel="noopener">塔拉山口-10</a></p></dialog>`;
  document.body.append(mount);
  const modes = document.querySelector("#modeDialog"), guide = document.querySelector("#guideDialog");
  const rule = document.querySelector("#ruleMode"), workflow = document.querySelector("#workflowMode"), first = document.querySelector("#firstSeat");
  for (const dialog of [modes, guide]) { dialog.querySelector("[data-close]").onclick = () => dialog.close(); dialog.addEventListener("close", () => onModal(false)); }
  const open = dialog => { document.querySelector("#recordMenu").open = false; onModal(true); dialog.showModal(); };
  document.querySelector("#openModes").onclick = () => {
    const session = getSession(); rule.value = session.rule; workflow.value = session.workflow; first.value = String(session.options.initialBlackSeat); workflow.dispatchEvent(new Event("change")); open(modes);
  };
  workflow.onchange = () => { document.querySelector("#modeDescription").textContent = workflow.value === "follow" ? "双方操作均由你照外部棋局录入。推荐不会自动执行。" : "AI 自动完成它的开局操作和落子；换色后按新执色继续。悔棋回到你上次操作之前。"; };
  document.querySelector("#startMode").onclick = () => { onNew({ rule: rule.value, workflow: workflow.value, initialBlackSeat: Number(first.value) }); modes.close(); };
  document.querySelector("#openGuide").onclick = () => open(guide);
  return { openGuide: () => open(guide) };
}
