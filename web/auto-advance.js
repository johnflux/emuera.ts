export function createAutoAdvance(currentWait, advance) {
  let timer = null;
  let pending = null;
  let consumed = null;
  let paused = false;
  function clear() {
    clearTimeout(timer);
    timer = null;
    pending = null;
  }
  function update() {
    const wait = currentWait();
    if (paused || !wait || wait === consumed) { clear(); return; }
    if (wait === pending) return;
    clear();
    pending = wait;
    timer = setTimeout(() => {
      clear();
      if (currentWait() !== wait) { update(); return; }
      consumed = wait;
      advance();
    }, 500);
  }
  function observeResult(snapshot, automatic) {
    if (automatic && snapshot.output.some((output) => output.type === "clear" && output.count > 0)) {
      paused = true;
      clear();
    } else if (!automatic && !snapshot.error) paused = false;
  }
  function reset() {
    clear();
    consumed = null;
    paused = false;
  }
  return { update, clear, observeResult, reset, isPaused: () => paused };
}
