export function installLiveMcp({ bridge, connected, message }) {
  const dialog = document.querySelector("#agent-access");
  const status = document.querySelector("#agent-status");
  const allow = document.querySelector("#agent-allow");
  const autoApprove = document.querySelector("#agent-auto-approve");
  const preferenceKey = "era-typescript.agent-auto-approve";
  function readPreference() {
    try { autoApprove.checked = localStorage.getItem(preferenceKey) === "1"; }
    catch (error) {
      autoApprove.checked = false;
      message(`Could not read agent approval preference: ${error.message}`, true);
    }
  }
  readPreference();
  dialog.addEventListener("close", readPreference);
  function savePreference(value) {
    try {
      if (value) localStorage.setItem(preferenceKey, "1");
      else localStorage.removeItem(preferenceKey);
      autoApprove.checked = value;
      return true;
    } catch (error) {
      autoApprove.checked = false;
      message(`Could not save agent approval preference: ${error.message}`, true);
      return false;
    }
  }
  autoApprove.addEventListener("change", () => {
    if (!pending) savePreference(autoApprove.checked);
  });
  window.addEventListener("storage", event => {
    if (event.storageArea === localStorage && (event.key === preferenceKey || event.key === null))
      autoApprove.checked = event.newValue === "1";
  });
  const deny = document.querySelector("#agent-deny");
  const disconnect = document.querySelector("#agent-disconnect");
  document.querySelector("#agent-endpoint").textContent = `${location.origin}/mcp`;
  document.querySelector("#agent-toggle").addEventListener("click", () => { if (!dialog.open) dialog.showModal(); });
  let pending = null, shown = null, active = false, previousSession = null, result = {}, decision = {};
  allow.addEventListener("click", () => {
    if (savePreference(autoApprove.checked)) {
      decision = { id: pending?.id, decision: "allow" };
      dialog.close();
    }
  });
  deny.addEventListener("click", () => { decision = { id: pending?.id, decision: "deny" }; dialog.close(); });
  disconnect.addEventListener("click", () => {
    savePreference(false);
    decision = { revoke: true };
  });
  const setConnected = value => {
    if (active === value) return;
    active = value;
    connected(value);
  };
  async function post(data) {
    const response = await fetch("/api/mcp/browser", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || `Agent connection failed (${response.status})`);
    return value;
  }
  async function execute(command, key, session) {
    await bridge.ready();
    const state = bridge.state();
    if (state.session !== session || state.busy || state.rendering) throw new Error("Game is busy or changed; observe again");
    switch (command.operation) {
      case "observe": return { view: bridge.observe(), isolated: false, graphical: true };
      case "games": {
        const response = await fetch("/api/runtime");
        if (!response.ok) throw new Error(`Could not list games (${response.status})`);
        return response.json();
      }
      case "act":
        await bridge.act(command.args);
        if (bridge.state().session !== session) throw new Error("The action changed the game session; reconnect to request access again");
        return { view: bridge.observe(), isolated: false };
      case "screenshot":
        if (!window.eraDesktop?.captureGame) throw new Error("Live screenshots require the desktop app. Use isolated graphical mode for browser screenshots.");
        return window.eraDesktop.captureGame();
      case "input":
      case "context":
      case "debug": {
        const debug = command.operation !== "input";
        const response = await fetch(debug ? "/api/debug" : command.args.timeout ? "/api/timeout" : "/api/input", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            session, step: state.step,
            ...(debug ? { command: command.operation === "context" ? { action: "context" } : command.args } : { value: command.args.value }),
          }),
        });
        const value = await response.json();
        const mutation = !debug || command.operation === "debug" && ["write", "evaluate", "call", "seed"].includes(command.args.action);
        if (mutation && !await bridge.resume(session)) throw new Error("Game changed but its display could not be restored; observe before retrying");
        if (!response.ok) throw new Error(typeof value.error === "string" ? value.error : value.error?.message || `Game command failed (${response.status})`);
        return value;
      }
      default: throw new Error("Unknown agent command");
    }
  }
  async function poll() {
    try {
      const session = bridge.state().session;
      if (previousSession && session !== previousSession) {
        setConnected(false);
        result = {};
        decision = {};
        const oldSession = previousSession;
        previousSession = session;
        const response = await fetch("/api/mcp/browser", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: oldSession, revoke: true }),
        });
        if (!response.ok && response.status !== 404) throw new Error(`Could not disconnect the previous game (${response.status})`);
      }
      previousSession = session;
      if (!session) {
        status.textContent = "Start a game to approve agent access.";
        return;
      }
      const state = await post({ session, ...result, ...decision });
      result = {};
      decision = {};
      setConnected(state.connected);
      pending = state.pending ?? null;
      allow.hidden = deny.hidden = !pending;
      disconnect.hidden = !state.connected;
      status.textContent = pending ? `“${pending.name}” requests access (name supplied by client).`
        : state.connected ? `Connected: ${state.name}` : "No agent connected.";
      if (pending && shown !== pending.id) {
        shown = pending.id;
        if (autoApprove.checked) decision = { id: pending.id, decision: "allow" };
        else if (!dialog.open) dialog.showModal();
      }
      if (state.command) {
        try {
          result = { resultId: state.command.id, result: await execute(state.command, state.key, session) };
        } catch (error) {
          result = { resultId: state.command.id, error: error.message };
        }
      }
    } catch (error) {
      status.textContent = error.message;
      message(`Agent access: ${error.message}`, true);
    } finally {
      setTimeout(poll, active ? 250 : 1500);
    }
  }
  void poll();
}
