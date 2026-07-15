const videoUrlInput = document.getElementById("video-url");
const recipeInput = document.getElementById("recipe-input");
const fetchButton = document.getElementById("fetch-button");
const extractButton = document.getElementById("extract-button");
const clearButton = document.getElementById("clear-button");
const downloadTxtButton = document.getElementById("download-txt-button");
const downloadImageButton = document.getElementById("download-image-button");
const templateImageInput = document.getElementById("template-image");
const titleOutput = document.getElementById("title-output");
const ingredientsOutput = document.getElementById("ingredients-output");
const stepsOutput = document.getElementById("steps-output");
const notesOutput = document.getElementById("notes-output");
const recipeOutput = document.getElementById("recipe-output");
const extractorStatus = document.getElementById("extractor-status");
const hostedExtractorRow = document.getElementById("hosted-extractor-row");
const hostedExtractorLink = document.getElementById("hosted-extractor-link");

const HOSTED_EXTRACTOR_URL = "";

const INGREDIENT_QTY_PATTERN = /\b(\d+\/\d+|\d+(?:\.\d+)?|one|two|three|half|quarter)\b/i;
const INGREDIENT_UNIT_PATTERN =
  /\b(cup|cups|tbsp|tsp|teaspoon|teaspoons|tablespoon|tablespoons|g|kg|ml|l|oz|pound|lb|pinch|clove|cloves|slice|slices|can|cans)\b/i;
const STEP_VERB_PATTERN = /\b(mix|bake|cook|stir|serve|boil|fry|simmer|whisk|fold|combine|preheat|pour)\b/i;

const state = {
  thumbnailUrl: "",
  lastRecipeText: ""
};

const setStatus = (message) => {
  if (extractorStatus) {
    extractorStatus.textContent = message;
  }
};

const setupHostedExtractorLink = () => {
  const url = (HOSTED_EXTRACTOR_URL || "").trim();
  if (!url || !hostedExtractorRow || !hostedExtractorLink) {
    return;
  }

  hostedExtractorLink.href = url;
  hostedExtractorRow.hidden = false;
};

const setList = (listElement, items, fallbackText, ordered = false) => {
  if (!listElement) {
    return;
  }

  listElement.textContent = "";
  if (!items.length) {
    const fallback = document.createElement("li");
    fallback.textContent = fallbackText;
    listElement.appendChild(fallback);
    return;
  }

  items.forEach((item) => {
    const entry = document.createElement("li");
    entry.textContent = ordered ? item.replace(/^\d+[).\-]\s*/, "") : item;
    listElement.appendChild(entry);
  });
};

const normalizeTikTokUrl = (rawUrl) => {
  const trimmed = (rawUrl || "").trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Please provide a full TikTok URL starting with http:// or https://.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Please provide a full TikTok URL starting with http:// or https://.");
  }

  if (!parsed.hostname.toLowerCase().includes("tiktok.com")) {
    throw new Error("Please provide a TikTok URL.");
  }

  return trimmed;
};

const fetchTikTokMetadata = async (videoUrl) => {
  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
  const attempts = [
    { label: "direct", url: oembedUrl, parseAs: "json" },
    {
      label: "allorigins-raw",
      url: `https://api.allorigins.win/raw?url=${encodeURIComponent(oembedUrl)}`,
      parseAs: "json"
    }
  ];

  let lastError = "unknown error";

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i];
    try {
      const response = await fetch(attempt.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const caption = (payload.title || "").trim();
      const thumbnailUrl = (payload.thumbnail_url || "").trim();
      if (!caption) {
        throw new Error("No caption/title in metadata response.");
      }

      return { caption, thumbnailUrl };
    } catch (error) {
      lastError = `${attempt.label}: ${error.message}`;
    }
  }

  throw new Error(`Metadata fetch blocked or unavailable (${lastError}).`);
};

const cleanCaption = (caption) => {
  let cleaned = (caption || "").replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/#([A-Za-z0-9_]+)/g, "$1");
  cleaned = cleaned.replace(/@\w+/g, "").trim();
  return cleaned;
};

const splitIntoCandidateLines = (text) => {
  return text
    .split(/(?:\n+|[•\-\u2022]+|\s[|]\s|;)/)
    .map((part) => part.trim().replace(/[ .,:-\t]+$/g, "").replace(/^[ .,:-\t]+/g, ""))
    .filter(Boolean);
};

const looksLikeIngredient = (line) =>
  INGREDIENT_QTY_PATTERN.test(line) || INGREDIENT_UNIT_PATTERN.test(line);

const parseIngredientsSection = (sectionText) => {
  return sectionText
    .split(/(?:\n+|,|•|\u2022|;)/)
    .map((chunk) => chunk.trim().replace(/^[ .-]+|[ .-]+$/g, ""))
    .filter(Boolean);
};

const parseStepsSection = (sectionText) => {
  const numbered = sectionText
    .split(/(?:^|\s)\d+[).\-]\s*/)
    .map((part) => part.trim().replace(/^[ .]+|[ .]+$/g, ""))
    .filter(Boolean);
  if (numbered.length > 1) {
    return numbered;
  }

  return sectionText
    .split(/(?:\.\s+|;\s+|\n+|•|\u2022)/)
    .map((part) => part.trim().replace(/^[ .]+|[ .]+$/g, ""))
    .filter((part) => part.length > 1);
};

const extractRecipe = (caption) => {
  const cleaned = cleanCaption(caption);
  const candidates = splitIntoCandidateLines(cleaned);
  const lower = cleaned.toLowerCase();

  let title = "Extracted Recipe";
  const titleFromSections = cleaned
    .split(/\bingredients?\b|\binstructions?\b|\bmethod\b|\bdirections?\b|\bsteps?\b/i, 1)[0]
    .trim()
    .replace(/[:\- ]+$/g, "");
  if (titleFromSections && titleFromSections.split(/\s+/).length >= 2 && titleFromSections.split(/\s+/).length <= 14) {
    title = titleFromSections;
  } else {
    const titleMatch = cleaned.match(/^([^.!?]{8,80})/);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
  }

  let ingredients = [];
  let steps = [];
  const notes = [];

  let ingredientMode = lower.includes("ingredients");
  let stepMode = /instructions|method|directions|steps/.test(lower);

  const ingredientSectionMatch = cleaned.match(
    /ingredients?\s*[:\-]\s*([\s\S]*?)(?=(?:instructions?|method|directions?|steps?)\s*[:\-]|$)/i
  );
  if (ingredientSectionMatch) {
    ingredients = parseIngredientsSection(ingredientSectionMatch[1]);
    ingredientMode = false;
  }

  const stepsSectionMatch = cleaned.match(
    /(?:instructions?|method|directions?|steps?)\s*[:\-]\s*([\s\S]*)$/i
  );
  if (stepsSectionMatch) {
    steps = parseStepsSection(stepsSectionMatch[1]);
    stepMode = false;
  }

  const useFallback = !(ingredientSectionMatch || stepsSectionMatch);

  candidates.forEach((line, idx) => {
    if (!useFallback) {
      return;
    }

    const lineLower = line.toLowerCase();

    if (["ingredients", "ingredient"].includes(lineLower)) {
      ingredientMode = true;
      stepMode = false;
      return;
    }
    if (["instructions", "method", "directions", "steps"].includes(lineLower)) {
      ingredientMode = false;
      stepMode = true;
      return;
    }

    if (ingredientMode && !ingredients.length) {
      if (looksLikeIngredient(line)) {
        ingredients.push(line);
        return;
      }
      if (STEP_VERB_PATTERN.test(lineLower)) {
        ingredientMode = false;
        stepMode = true;
      } else {
        notes.push(line);
        return;
      }
    }

    if (stepMode && !steps.length) {
      steps.push(line.replace(/^\d+[).\-]\s*/, ""));
      return;
    }

    if (looksLikeIngredient(line)) {
      ingredients.push(line);
    } else if (idx < 2 && line.split(/\s+/).length <= 10 && title === "Extracted Recipe") {
      title = line;
    } else if (STEP_VERB_PATTERN.test(lineLower)) {
      steps.push(line);
    } else {
      notes.push(line);
    }
  });

  if (!steps.length && notes.length) {
    const promoted = notes.filter((note) => note.split(/\s+/).length > 4);
    steps = promoted;
    promoted.forEach((item) => {
      const index = notes.indexOf(item);
      if (index >= 0) {
        notes.splice(index, 1);
      }
    });
  }

  ingredients = ingredients.filter(
    (item) =>
      !item.toLowerCase().includes("ingredients:") && !item.toLowerCase().includes("instructions:")
  );

  return {
    title,
    ingredients,
    steps,
    notes,
    sourceCaption: cleaned
  };
};

const recipeToText = (recipe) => {
  const lines = [recipe.title || "Extracted Recipe", ""];
  if (recipe.ingredients.length) {
    lines.push("Ingredients");
    recipe.ingredients.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }
  if (recipe.steps.length) {
    lines.push("Instructions");
    recipe.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
    lines.push("");
  }
  if (recipe.notes.length) {
    lines.push("Notes");
    recipe.notes.forEach((note) => lines.push(`- ${note}`));
    lines.push("");
  }
  lines.push("Source Caption");
  lines.push(recipe.sourceCaption || "");
  return `${lines.join("\n").trim()}\n`;
};

const renderRecipe = () => {
  if (!recipeInput || !recipeOutput || !titleOutput) {
    return null;
  }

  const rawText = recipeInput.value.trim();
  if (!rawText) {
    setStatus("Please provide a caption or source text first.");
    setList(ingredientsOutput, [], "No ingredients extracted yet.");
    setList(stepsOutput, [], "No instructions extracted yet.", true);
    setList(notesOutput, [], "No notes extracted yet.");
    titleOutput.textContent = "Extracted Recipe";
    recipeOutput.value = "";
    state.lastRecipeText = "";
    return null;
  }

  const recipe = extractRecipe(rawText);
  const recipeText = recipeToText(recipe);

  titleOutput.textContent = recipe.title || "Extracted Recipe";
  setList(
    ingredientsOutput,
    recipe.ingredients,
    "Could not confidently detect ingredients. Try a caption with quantities."
  );
  setList(
    stepsOutput,
    recipe.steps,
    "Could not confidently detect instructions. Try a caption with action verbs.",
    true
  );
  setList(notesOutput, recipe.notes, "No additional notes detected.");
  recipeOutput.value = recipeText;
  state.lastRecipeText = recipeText;
  setStatus(
    `Extracted: ${recipe.ingredients.length} ingredient(s), ${recipe.steps.length} step(s), ${recipe.notes.length} note(s).`
  );

  return recipe;
};

const downloadText = () => {
  const text = recipeOutput && recipeOutput.value ? recipeOutput.value.trim() : "";
  if (!text) {
    setStatus("Nothing to download yet. Extract a recipe first.");
    return;
  }
  const blob = new Blob([`${text}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "recipe.txt";
  link.click();
  URL.revokeObjectURL(url);
};

const wrapCanvasText = (ctx, text, maxWidth) => {
  const lines = [];
  text.split("\n").forEach((paragraph) => {
    if (!paragraph.trim()) {
      lines.push("");
      return;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        if (line) {
          lines.push(line);
        }
        line = word;
      }
    });
    if (line) {
      lines.push(line);
    }
  });
  return lines;
};

const loadImageFromFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read uploaded template image."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read uploaded template image."));
    reader.readAsDataURL(file);
  });

const loadImageFromUrl = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Thumbnail image could not be loaded due to CORS or network restrictions."));
    img.src = url;
  });

const drawRecipeCard = async () => {
  const recipeText = recipeOutput && recipeOutput.value ? recipeOutput.value.trim() : "";
  if (!recipeText) {
    setStatus("Nothing to render yet. Extract a recipe first.");
    return;
  }

  const defaultWidth = 1080;
  const defaultHeight = 1350;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    setStatus("Image rendering is not supported in this browser.");
    return;
  }

  let templateImage = null;
  const templateFile =
    templateImageInput && templateImageInput.files && templateImageInput.files[0]
      ? templateImageInput.files[0]
      : null;
  if (templateFile) {
    try {
      templateImage = await loadImageFromFile(templateFile);
    } catch (error) {
      setStatus(error.message);
      return;
    }
  }

  canvas.width = templateImage && templateImage.width ? templateImage.width : defaultWidth;
  canvas.height = templateImage && templateImage.height ? templateImage.height : defaultHeight;

  if (templateImage) {
    ctx.drawImage(templateImage, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#f3efe6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const safeLeft = Math.floor(canvas.width * 0.14);
  const safeTop = Math.floor(canvas.height * 0.1);
  const safeRight = Math.floor(canvas.width * 0.86);
  const safeBottom = Math.floor(canvas.height * 0.92);
  const safeWidth = safeRight - safeLeft;
  const safeHeight = safeBottom - safeTop;

  const [titleLine, ...bodyLines] = recipeText.split("\n");
  const title = titleLine.trim() || "Extracted Recipe";
  const bodyText = bodyLines.join("\n").trim();

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(16, 16, 16, 0.95)";

  ctx.font = `${Math.max(42, Math.floor(canvas.width * 0.048))}px "pgLang Roman", "Times New Roman", serif`;
  let wrappedTitle = wrapCanvasText(ctx, title, Math.floor(safeWidth * 0.95));
  while (wrappedTitle.length > 4) {
    ctx.font = `${Math.max(24, parseInt(ctx.font, 10) - 2)}px "pgLang Roman", "Times New Roman", serif`;
    wrappedTitle = wrapCanvasText(ctx, title, Math.floor(safeWidth * 0.95));
  }

  const titleFontSize = parseInt(ctx.font, 10);
  const titleLineHeight = Math.floor(titleFontSize * 1.2);
  const titleHeight = wrappedTitle.length * titleLineHeight;

  const thumbnailReserved = state.thumbnailUrl ? Math.floor(safeHeight * 0.23) : 0;
  const bodyTop = safeTop + Math.floor(safeHeight * 0.2);
  const bodyBottom = safeBottom - thumbnailReserved;
  const bodyHeight = Math.max(120, bodyBottom - bodyTop);

  ctx.font = `${Math.max(24, Math.floor(canvas.width * 0.026))}px "courier-std", "Courier New", monospace`;
  let wrappedBody = wrapCanvasText(ctx, bodyText, Math.floor(safeWidth * 0.96));
  let bodyLineHeight = Math.floor(parseInt(ctx.font, 10) * 1.28);
  while (wrappedBody.length * bodyLineHeight > bodyHeight && parseInt(ctx.font, 10) > 16) {
    const nextSize = parseInt(ctx.font, 10) - 2;
    ctx.font = `${nextSize}px "courier-std", "Courier New", monospace`;
    wrappedBody = wrapCanvasText(ctx, bodyText, Math.floor(safeWidth * 0.96));
    bodyLineHeight = Math.floor(nextSize * 1.28);
  }

  const cardPadding = Math.floor(canvas.width * 0.02);
  const maxBodyWidth = Math.max(
    ...wrappedBody.map((line) => Math.ceil(ctx.measureText(line || " ").width)),
    0
  );
  const cardWidth = Math.min(safeWidth, Math.max(maxBodyWidth, Math.ceil(ctx.measureText(title).width)) + cardPadding * 2);
  const cardLeft = safeLeft + Math.floor((safeWidth - cardWidth) / 2);
  const cardTop = safeTop + Math.floor((safeHeight - (titleHeight + wrappedBody.length * bodyLineHeight + cardPadding * 3)) / 2);
  const cardHeight = Math.floor(titleHeight + wrappedBody.length * bodyLineHeight + cardPadding * 3);

  ctx.fillStyle = "rgba(255, 255, 255, 0.84)";
  ctx.strokeStyle = "rgba(16, 16, 16, 0.28)";
  ctx.lineWidth = 2;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(cardLeft, cardTop, cardWidth, cardHeight, 18);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(cardLeft, cardTop, cardWidth, cardHeight);
    ctx.strokeRect(cardLeft, cardTop, cardWidth, cardHeight);
  }

  ctx.fillStyle = "rgba(16, 16, 16, 0.95)";
  ctx.font = `${titleFontSize}px "pgLang Roman", "Times New Roman", serif`;
  let y = cardTop + cardPadding + titleLineHeight;
  wrappedTitle.forEach((line) => {
    const lineWidth = ctx.measureText(line).width;
    const x = cardLeft + Math.floor((cardWidth - lineWidth) / 2);
    ctx.fillText(line, x, y);
    y += titleLineHeight;
  });

  y += Math.floor(cardPadding * 0.5);
  ctx.font = `${parseInt(ctx.font, 10) > 0 ? Math.max(16, Math.floor(canvas.width * 0.026)) : 22}px "courier-std", "Courier New", monospace`;
  wrappedBody.forEach((line) => {
    if (!line) {
      y += bodyLineHeight;
      return;
    }
    const lineWidth = ctx.measureText(line).width;
    const x = cardLeft + Math.floor((cardWidth - lineWidth) / 2);
    ctx.fillText(line, x, y);
    y += bodyLineHeight;
  });

  if (state.thumbnailUrl) {
    try {
      const thumbnail = await loadImageFromUrl(state.thumbnailUrl);
      const maxThumbW = Math.floor(safeWidth * 0.72);
      const maxThumbH = Math.floor(safeHeight * 0.2);
      const ratio = Math.min(maxThumbW / thumbnail.width, maxThumbH / thumbnail.height, 1);
      const w = Math.floor(thumbnail.width * ratio);
      const h = Math.floor(thumbnail.height * ratio);
      const x = safeLeft + Math.floor((safeWidth - w) / 2);
      const yThumb = safeBottom - h;
      ctx.drawImage(thumbnail, x, yThumb, w, h);
    } catch {
      setStatus("Recipe extracted. Thumbnail could not be embedded due to browser image restrictions.");
    }
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    setStatus("Could not create image file.");
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "recipe-card.png";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Recipe card image downloaded.");
};

const fetchMetadataAndPopulate = async () => {
  if (!videoUrlInput || !recipeInput) {
    return;
  }

  const videoUrl = videoUrlInput.value.trim();
  if (!videoUrl) {
    setStatus("Please enter a TikTok URL first.");
    return;
  }

  let normalized;
  try {
    normalized = normalizeTikTokUrl(videoUrl);
  } catch (error) {
    setStatus(error.message);
    return;
  }

  setStatus("Fetching TikTok metadata...");
  try {
    const metadata = await fetchTikTokMetadata(normalized);
    recipeInput.value = metadata.caption;
    state.thumbnailUrl = metadata.thumbnailUrl || "";
    setStatus("Metadata fetched successfully. You can now extract.");
  } catch (error) {
    state.thumbnailUrl = "";
    const message =
      `Metadata fetch failed (${error.message}). Paste caption text manually and click Extract.`
    setStatus(message);
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message);
    }
  }
};

const clearExtractor = () => {
  if (videoUrlInput) {
    videoUrlInput.value = "";
  }
  if (recipeInput) {
    recipeInput.value = "";
    recipeInput.focus();
  }
  if (recipeOutput) {
    recipeOutput.value = "";
  }
  if (templateImageInput) {
    templateImageInput.value = "";
  }
  state.thumbnailUrl = "";
  state.lastRecipeText = "";
  if (titleOutput) {
    titleOutput.textContent = "Extracted Recipe";
  }
  setList(ingredientsOutput, [], "Paste recipe text and click Extract.");
  setList(stepsOutput, [], "Steps will appear here.", true);
  setList(notesOutput, [], "Additional notes will appear here if detected.");
  setStatus("Tip: use a public TikTok URL with a visible caption for best metadata results.");
};

if (fetchButton) {
  fetchButton.addEventListener("click", () => {
    fetchMetadataAndPopulate();
  });
}

if (extractButton) {
  extractButton.addEventListener("click", () => {
    renderRecipe();
  });
}

if (clearButton) {
  clearButton.addEventListener("click", clearExtractor);
}

if (downloadTxtButton) {
  downloadTxtButton.addEventListener("click", downloadText);
}

if (downloadImageButton) {
  downloadImageButton.addEventListener("click", () => {
    if (!(recipeOutput && recipeOutput.value && recipeOutput.value.trim())) {
      renderRecipe();
    }
    drawRecipeCard();
  });
}

setupHostedExtractorLink();
