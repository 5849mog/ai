const FIXED = [100, 500, 1000, 2000, 3000, 5000, 6000, 10000];
export const THINKING_OPTIONS = [...FIXED.map(ms => [String(ms), `${ms / 1000} 秒`]), ["adaptive", "自适应深思"]];
export const THINKING_VALUES = THINKING_OPTIONS.map(([value]) => value);
export const SPECTATOR_DELAYS = [[0, "无间隔"], ...[100, 250, 500, 1000, 2000, 3000].map(ms => [ms, `${ms / 1000} 秒`])];
export const spectatorBudgets = () => '<option value="shared">跟随每步思考</option>' + THINKING_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
