export function screenTransitionIndex(output, hasText, isScreen,
  isText = entry => entry.type === "text" && entry.text.trim()) {
  const screen = output.findIndex(isScreen);
  if (screen < 0) return -1;
  const clear = output.findLastIndex((entry, index) => index <= screen && entry.type === "clear" && entry.count > 0);
  const boundary = clear < 0 ? screen : clear;
  const printed = output.slice(0, boundary).some(isText);
  return hasText || printed ? boundary : -1;
}

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
  function pause() {
    paused = true;
    clear();
  }
  return { update, clear, observeResult, reset, pause, isPaused: () => paused };
}
