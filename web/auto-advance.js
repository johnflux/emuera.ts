export function createAutoAdvance(currentWait, advance) {
  let timer = null;
  let pending = null;
  let consumed = null;
  function clear() {
    clearTimeout(timer);
    timer = null;
    pending = null;
  }
  function update() {
    const wait = currentWait();
    if (!wait || wait === consumed) { clear(); return; }
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
  return { update, clear };
}
