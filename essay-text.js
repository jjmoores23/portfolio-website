const essayTextContainer = document.querySelector("[data-essay-format-src]");

const loadEssayText = async () => {
  if (!essayTextContainer) {
    return;
  }

  const source = essayTextContainer.getAttribute("data-essay-format-src");
  if (!source) {
    essayTextContainer.textContent = "Essay text source is missing.";
    return;
  }

  essayTextContainer.textContent = "Loading essay text...";

  try {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    essayTextContainer.textContent = "";

    if (!lines.length) {
      essayTextContainer.textContent = "No essay text found.";
      return;
    }

    lines.forEach((line) => {
      const row = document.createElement("p");
      row.className = "essay-line";

      if (line.blank) {
        row.classList.add("essay-line-blank");
        row.textContent = "";
      } else {
        row.textContent = line.text || "";
        if (line.align === "center") {
          row.classList.add("essay-line-center");
        }
      }

      essayTextContainer.appendChild(row);
    });
  } catch (error) {
    const message = error && error.message ? error.message : "unknown error";
    essayTextContainer.textContent =
      `Could not load essay text (${message}). Please use Download PDF instead.`;
  }
};

loadEssayText();
