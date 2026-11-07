export const EDITABLE_CONTROL = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=hidden]), textarea, select, [contenteditable]:not([contenteditable='false'])";

export function navigateControl(element) {
  if (element.matches(EDITABLE_CONTROL)) {
    element.classList.remove("is-control-editing");
    element.classList.add("is-control-navigation");
  }
}

export function resetControlNavigation(element) {
  element.classList.remove("is-control-navigation", "is-control-editing");
}

export function activateNavigationControl(element) {
  if (!element?.classList?.contains("is-control-navigation")) return false;
  resetControlNavigation(element);
  element.classList.add("is-control-editing");
  element.focus({ preventScroll: true });
  element.click();
  return true;
}

export function adjustControllerRange(element, key) {
  if (element?.type !== "range" || !element.matches('input[type="range"]:enabled')
    || element.classList.contains("is-control-navigation")) return false;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return false;
  const before = element.value;
  const step = element.step === "any"
    ? (Number(element.max || 100) - Number(element.min || 0)) / 100
    : Number(element.step || 1);
  const direction = key === "ArrowUp" || key === "ArrowRight" ? 1 : -1;
  element.value = String(Number(before) + direction * step);
  if (element.value !== before) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}

export function setCheckboxState(input, state, active = state !== false) {
  input.checked = state === true;
  input.defaultChecked = state === true;
  input.indeterminate = state === "mixed";
  input.dataset.active = String(active);
}

export function createCheckbox(checked, activate) {
  const label = document.createElement("label");
  label.className = "checkbox-control";
  const input = document.createElement("input");
  input.type = "checkbox";
  setCheckboxState(input, checked);
  const content = document.createElement("span");
  content.className = "checkbox-label";
  label.append(input, content);
  input.addEventListener("click", (event) => {
    // Game state is authoritative; a rejected command must not change the check.
    event.preventDefault();
    activate(event);
  });
  return label;
}

export function choiceControl(element) {
  return element.querySelector(":scope > input[type=checkbox]") ?? element;
}
