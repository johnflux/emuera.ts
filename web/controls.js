export function createCheckbox(checked, activate) {
  const label = document.createElement("label");
  label.className = "checkbox-control";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.defaultChecked = checked;
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
