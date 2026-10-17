import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { EngineJobs } from "../engine-jobs.js";
import { searchCommands, parseOutput, boardCommand } from "../engine-protocol.js";

export const RULES = new Set(["freestyle", "renju", "rif", "taraguchi10"]);
export class NativeRuntime {
  constructor({ directory, rule, threads, memoryMiB, emit, reportSlices = false, processFactory = spawn }) {
    if (!RULES.has(rule)) throw Error("不支持的规则");
    Object.assign(this, { directory, rule, threads, memoryMiB, emit });
    this.closed = false;
    this.jobs = new EngineJobs({ searchCommands, send: command => this.send(command),
      onPonderSlice: result => { if (reportSlices) emit({ type: "ponder-slice", result: { ...result, ...this.metadata() } }); }, emit: message => {
      if (message.type === "move") { clearTimeout(this.deadline); message.result = { ...message.result, ...this.metadata() }; }
      emit(message);
    } });
    this.ready = new Promise((accept, reject) => { this.accept = accept; this.reject = reject; });
    this.timer = setTimeout(() => this.fail(Error("电脑引擎准备超时")), 30000);
    this.watchdog = setInterval(() => {
      const job = this.jobs.active;
      if (job && performance.now() - job.started > (job.phase === "search" ? job.timeMs + 2500 : (job.sliceMs ?? 250) + 2500)) this.fail(Error("电脑引擎未能及时结束搜索"));
    }, 500);
    const family = rule === "freestyle" ? "freestyle" : "renju";
    this.child = processFactory(join(directory, "rapfi.exe"), [], { cwd: join(directory, family), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.on("error", error => this.fail(error));
    this.child.on("exit", code => { if (!this.closed) this.fail(Error(`电脑引擎意外退出 (${code})`)); });
    this.child.stdin.on("error", error => this.fail(error));
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.lines.on("line", line => { try { this.output(line); } catch (error) { this.fail(error); } });
    this.stderr = createInterface({ input: this.child.stderr, crlfDelay: Infinity });
    this.stderr.on("line", line => { if (/error|failed|abort/i.test(line)) this.fail(Error(line)); });
    for (const command of [`INFO rule ${family === "freestyle" ? 0 : 4}`, `INFO max_memory ${memoryMiB * 2 ** 20}`,
      `INFO thread_num ${threads}`, "INFO pondering 0", "INFO usedatabase 0", "INFO show_detail 2", "START 15"]) this.send(command);
  }
  metadata() { return { backend: "remote-native-avx2", threads: this.threads, memoryMiB: this.memoryMiB, evaluator: "mix9svq", weight: this.weight }; }
  send(command) { if (!this.closed) this.child.stdin.write(command + "\n"); }
  output(line) {
    if (this.closed) return;
    if (/Evaluator .* disabled:/i.test(line)) throw Error("电脑引擎未能启用指定权重");
    const loaded = /mix9svq nnue: load weight from (.+)/.exec(line); if (loaded) this.weight = loaded[1].trim();
    const parsed = parseOutput(line);
    if (parsed.type === "error") throw Error(parsed.message);
    if (parsed.type === "ok" && this.accept) { clearTimeout(this.timer); this.accept(); this.accept = null; return; }
    if (this.forbiddenId !== undefined && line.startsWith("FORBID ")) {
      const indices = (line.slice(7).match(/\d{4}/g) ?? []).map(c => Number(c.slice(2)) * 15 + Number(c.slice(0, 2)));
      this.emit({ type: "forbids", requestId: this.forbiddenId, indices }); this.forbiddenId = undefined; return;
    }
    if (parsed.type === "move" && this.jobs.active) {
      const expected = this.rule === "freestyle" ? /mix9svqfreestyle_bsmix\.bin\.lz4$/ : /mix9svqrenju_bs15_(black|white)\.bin\.lz4$/;
      if (!expected.test(this.weight ?? "")) throw Error("无法确认电脑引擎使用的神经网络权重");
    }
    this.jobs.output(parsed, line);
  }
  command(data) {
    if (data.type === "stop-ponder") { this.jobs.stopPonder(); return; }
    if (data.type === "forbids") {
      if (this.jobs.active || this.jobs.background || this.jobs.queuedSearch) throw Error("禁手查询需要空闲引擎");
      boardCommand(data.board, 1, true); this.forbiddenId = data.requestId;
      this.send(boardCommand(data.board, 1, true).replace(/^BOARD/, "YXBOARD")); this.send("YXSHOWFORBID"); return;
    }
    if (!["search", "ponder"].includes(data.type)) throw Error("不支持的搜索请求");
    if ((data.rule === "freestyle") !== (this.rule === "freestyle") || !RULES.has(data.rule)) throw Error("搜索规则与引擎不一致，请重新连接");
    if (!Array.isArray(data.board) || !Number.isSafeInteger(data.requestId) || data.requestId < 0 || typeof (data.allowSetup ?? false) !== "boolean" || typeof (data.balance ?? false) !== "boolean") throw Error("搜索请求格式无效");
    if (data.allowedMoves !== undefined && !Array.isArray(data.allowedMoves)) throw Error("搜索范围无效");
    if (data.sliceMs !== undefined && (!Number.isInteger(data.sliceMs) || data.sliceMs < 100 || data.sliceMs > 1000)) throw Error("后台分析时间无效");
    searchCommands(data.board, data.sideToMove, data.type === "search" ? data.timeMs : data.sliceMs ?? 250, data.multiPV ?? 1, data.allowSetup, data);
    if (data.type === "search") {
      this.jobs.search(data);
      this.deadline = setTimeout(() => this.fail(Error("电脑引擎搜索超时")), data.timeMs + 2500);
    } else this.jobs.ponder(data);
  }
  fail(error) { if (this.closed) return; this.reject(error); this.emit({ type: "error", message: error.message }); this.dispose(); }
  dispose() {
    if (this.closed) return; this.closed = true; clearTimeout(this.timer); clearTimeout(this.deadline); clearInterval(this.watchdog);
    this.jobs.cancelNext(); this.jobs.background = this.jobs.queuedSearch = this.jobs.active = null;
    this.reject(new DOMException("电脑引擎连接已取消", "AbortError")); this.lines.close(); this.stderr.close(); this.child.kill();
  }
}
