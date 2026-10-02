// Test-only runtime double. Real app, worker, protocol and scheduler are used;
// this substitutes Rapfi for deterministic edge cases, not the application API.
self.Rapfi = async config => {
  const { validatePosition, hasFive } = await import(new URL("./game-rules.js", self.location.href));
  const asynchronous = config.mainScriptUrlOrBlob.includes("multi");
  let board = new Uint8Array(225), side = 1, timeout = 1000, thinking = false;
  let finishTimer, statsTimer, chosen;
  const stdout = config.onReceiveStdout;
  const diagnostics = command => self.postMessage({ type: "test-command", command });
  const finish = () => {
    clearTimeout(finishTimer); clearInterval(statsTimer);
    board[chosen] = side;
    stdout(`${chosen % 15},${Math.floor(chosen / 15)}`);
    thinking = false;
  };
  const search = () => {
    validatePosition(board, side);
    chosen = -1;
    for (let i = 0; i < 225; i++) {
      if (board[i]) continue;
      board[i] = side;
      const winning = hasFive(board, i % 15, Math.floor(i / 15), side);
      board[i] = 0;
      if (winning) { chosen = i; break; }
    }
    if (chosen < 0) chosen = [112, 0, 30, 60, 90, 120, 150, 180, 210, 14, 44, 74].find(i => !board[i])
      ?? board.findIndex(value => !value);
    thinking = true;
    let depth = 0;
    const stats = () => {
      stdout(`INFO DEPTH ${++depth + 5}`);
      stdout(`INFO TOTALNODES ${depth * 1200}`);
      stdout("INFO SPEED 42000");
      stdout("INFO EVAL 420");
    };
    if (asynchronous) {
      statsTimer = setInterval(stats, 35);
      finishTimer = setTimeout(finish, Math.min(timeout, 350));
    } else {
      const until = performance.now() + Math.min(timeout, 180);
      let tick = performance.now();
      while (performance.now() < until) {
        if (performance.now() - tick > 35) { stats(); tick = performance.now(); }
      }
      finish();
    }
  };
  stdout("mix9svq nnue: load weight from mix9svqfreestyle_bsmix.bin.lz4");
  return { sendCommand(command) {
    diagnostics(command);
    if (command === "STOP") { if (thinking) finish(); return; }
    if (thinking) return; // Match Rapfi: other commands are ignored during search.
    if (command === "INFO pondering 1") throw new Error("Unbounded pondering enabled in test runtime");
    if (command.startsWith("INFO timeout_turn ")) timeout = Number(command.split(" ").at(-1));
    else if (command.startsWith("START ")) { board.fill(0); stdout("OK"); }
    else if (command === "BEGIN") {
      if (board.some(Boolean)) stdout("ERROR Board is not empty."); else { side = 1; search(); }
    } else if (command.startsWith("BOARD\n")) {
      board.fill(0);
      const lines = command.split("\n").slice(1, -1);
      const ownColor = lines.length ? (Number(lines[0].split(",")[2]) === 1 ? 1 : 2) : 1;
      for (const line of lines) {
        const [x, y, relativeColor] = line.split(",").map(Number);
        board[y * 15 + x] = relativeColor === 1 ? ownColor : 3 - ownColor;
      }
      const black = board.filter(color => color === 1).length;
      const white = board.filter(color => color === 2).length;
      side = black === white ? 1 : 2;
      if (side !== ownColor) throw new Error("BOARD color perspective mismatch");
      search();
    }
  } };
};
