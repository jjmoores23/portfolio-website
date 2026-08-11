const videoUrlInput = document.getElementById("video-url");
const recipeInput = document.getElementById("recipe-input");
const fetchButton = document.getElementById("fetch-button");
const extractButton = document.getElementById("extract-button");
const clearButton = document.getElementById("clear-button");
const downloadTxtButton = document.getElementById("download-txt-button");
const downloadImageButton = document.getElementById("download-image-button");
const shareImageButton = document.getElementById("share-image-button");
const templateImageInput = document.getElementById("template-image");
const titleOutput = document.getElementById("title-output");
const ingredientsOutput = document.getElementById("ingredients-output");
const stepsOutput = document.getElementById("steps-output");
const notesOutput = document.getElementById("notes-output");
const recipeOutput = document.getElementById("recipe-output");
const extractorStatus = document.getElementById("extractor-status");
const hostedExtractorRow = document.getElementById("hosted-extractor-row");
const hostedExtractorLink = document.getElementById("hosted-extractor-link");

const HOSTED_EXTRACTOR_URL = "https://tiktok-recipe-extractor.onrender.com";
const LOCAL_API_URL = "http://127.0.0.1:5000";
const DEFAULT_RECIPE_TEMPLATE_URL = "Cute%20Pastel%20Border%20Design.jpeg";
const RECIPE_CARD_LOGO_URL = "newlogo.png";

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

const setFetchLoading = (isLoading, label) => {
  if (!fetchButton) {
    return;
  }

  const defaultLabel = fetchButton.getAttribute("data-default-label") || "Extract Metadata";
  if (isLoading) {
    fetchButton.classList.add("is-loading");
    fetchButton.disabled = true;
    fetchButton.textContent = label || "Working...";
    return;
  }

  fetchButton.classList.remove("is-loading");
  fetchButton.disabled = false;
  fetchButton.textContent = defaultLabel;
};

const setupHostedExtractorLink = () => {
  const url = (HOSTED_EXTRACTOR_URL || "").trim();
  if (!url || !hostedExtractorRow || !hostedExtractorLink) {
    return;
  }

  hostedExtractorLink.href = url;
  hostedExtractorRow.hidden = false;
};

const openHostedExtractor = (videoUrl = "", sameTab = false) => {
  const baseUrl = (HOSTED_EXTRACTOR_URL || "").trim();
  if (!baseUrl || typeof window === "undefined") {
    return false;
  }

  const targetUrl = videoUrl ? `${baseUrl}?video_url=${encodeURIComponent(videoUrl)}` : baseUrl;
  if (sameTab) {
    window.location.href = targetUrl;
    return true;
  }

  const opened = window.open(targetUrl, "_blank", "noopener");
  if (!opened) {
    window.location.href = targetUrl;
  }
  return true;
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
  } catch (error) {
    throw new Error("Please provide a full TikTok URL starting with http:// or https://.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Please provide a full TikTok URL starting with http:// or https://.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname !== "tiktok.com" && !hostname.endsWith(".tiktok.com")) {
    throw new Error("Please provide a TikTok URL.");
  }

  return trimmed;
};

const fetchTikTokMetadata = async (videoUrl) => {
  const isLocal = ["", "localhost", "127.0.0.1"].includes(window.location.hostname);
  const localApiOverride = isLocal
    ? new URLSearchParams(window.location.search).get("api")
    : "";
  const apiBaseUrl = isLocal ? localApiOverride || LOCAL_API_URL : HOSTED_EXTRACTOR_URL;
  const response = await fetch(`${apiBaseUrl}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_url: videoUrl })
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error(
      "The hosted extractor is running an older version without the portfolio API. Deploy the current backend changes."
    );
  }
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Backend returned HTTP ${response.status}.`);
  }
  if (!payload.caption) {
    throw new Error("The backend returned no caption.");
  }

  return {
    caption: payload.caption.trim(),
    thumbnailUrl: (payload.thumbnail_url || "").trim()
  };
};

const cleanCaption = (caption) => {
  let cleaned = (caption || "").replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/(?:\s*#[A-Za-z0-9_]+)+\s*$/g, "").trim();
  cleaned = cleaned.replace(/#([A-Za-z0-9_]+)/g, "$1");
  cleaned = cleaned.replace(/@\w+/g, "").trim();
  return cleaned;
};

const splitIntoCandidateLines = (text) => {
  return text
    .split(/(?:\n+|[•\-\u2022]+|\s[|]\s|;)/)
    .map((part) => part.trim().replace(/[ .,:\-\t]+$/g, "").replace(/^[ .,:\-\t]+/g, ""))
    .filter(Boolean);
};

const looksLikeIngredient = (line) =>
  INGREDIENT_QTY_PATTERN.test(line) || INGREDIENT_UNIT_PATTERN.test(line);

const parseIngredientsSection = (sectionText) => {
  const separated = sectionText
    .replace(/(\bpotatoes?)\s+(?=(?:olive|vegetable|canola)\s+oil\b)/gi, "$1\n")
    .replace(
      /(?<!\d)\s+(?=(?:\d+(?:\s+\d+\/\d+|\/\d+|-\d+)?)\s+(?:lb|lbs|tsp|tbsp|oz|cups?|chopped)\b)/gi,
      "\n"
    );
  return separated
    .split(/(?:\n+|\s{2,}|\s+[-•\u2022]\s+|;|,\s+(?=\d|one\b|two\b|three\b|half\b|quarter\b))/i)
    .map((chunk) => chunk.trim().replace(/^[ .-]+|[ .-]+$/g, ""))
    .filter(Boolean);
};

const parseStepsSection = (sectionText) => {
  const withoutTrailingTags = sectionText
    .replace(/(?:\s*#[A-Za-z0-9_]+)+\s*$/g, "")
    .trim();
  const spaced = withoutTrailingTags
    .split(/\s{2,}/)
    .map((part) => part.trim().replace(/^[ .]+|[ .]+$/g, ""))
    .filter(Boolean);
  if (spaced.length > 1) {
    return spaced;
  }

  const dashed = withoutTrailingTags
    .split(/\s+[-•\u2022]\s+/)
    .map((part) => part.trim().replace(/^[ .]+|[ .]+$/g, ""))
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
  if (dashed.length > 1) {
    return dashed;
  }

  const numbered = withoutTrailingTags
    .split(/(?:^|\s)\d+[).]\s*/)
    .map((part) => part.trim().replace(/^[ .]+|[ .]+$/g, ""))
    .filter(Boolean);
  if (numbered.length > 1) {
    return numbered;
  }

  return withoutTrailingTags
    .split(/(?:\.\s+|;\s+|\n+|•|\u2022)/)
    .map((part) => part.trim().replace(/^[ .]+|[ .]+$/g, ""))
    .filter((part) => part.length > 1);
};

const extractRecipe = (caption) => {
  const rawCaption = caption || "";
  const cleaned = cleanCaption(caption);
  const candidates = splitIntoCandidateLines(cleaned);
  const lower = cleaned.toLowerCase();

  let title = "Extracted Recipe";
  const titleFromSections = cleaned
    .split(/\bingredients?\b|\binstructions?\b|\bmethod\b|\bdirections?\b|\bsteps?\b/i, 1)[0]
    .trim()
    .replace(/[:\- ]+$/g, "");
  const rawTitlePrefix = rawCaption
    .split(/\bingredients?\b|\binstructions?\b|\bmethod\b|\bdirections?\b|\bsteps?\b/i, 1)[0]
    .trim();
  let explicitHeadingTitle = "";
  if (rawTitlePrefix.endsWith(":")) {
    explicitHeadingTitle = rawTitlePrefix
      .slice(0, -1)
      .split(/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u)
      .pop()
      .split(/[.!?]/)
      .pop()
      .trim();
    const explicitWordCount = explicitHeadingTitle.split(/\s+/).filter(Boolean).length;
    if (explicitWordCount < 2 || explicitWordCount > 14) {
      explicitHeadingTitle = "";
    }
  }
  const titleBeforeEmoji = titleFromSections.split(/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/u, 1)[0].trim();
  const promotionalTitle = titleFromSections.match(
    /\bthis\s+(.{3,80}?)\s+(?:won['’]?t\s+disappoint|will\s+not\s+disappoint)\b/i
  );
  if (explicitHeadingTitle) {
    title = explicitHeadingTitle;
  } else if (promotionalTitle) {
    title = promotionalTitle[1].trim().replace(/^[ .,!?:-]+|[ .,!?:-]+$/g, "");
  } else if (titleBeforeEmoji && titleBeforeEmoji.split(/\s+/).length >= 2 && titleBeforeEmoji.split(/\s+/).length <= 14) {
    title = titleBeforeEmoji;
  } else if (titleFromSections && titleFromSections.split(/\s+/).length >= 2 && titleFromSections.split(/\s+/).length <= 14) {
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

  const ingredientSectionMatch = rawCaption.match(
    /ingredients?\s*[:\-]?\s*([\s\S]*?)(?=(?:instructions?|method|directions?|steps?)\s*[:\-]?\s|$)/i
  );
  if (ingredientSectionMatch) {
    ingredients = parseIngredientsSection(ingredientSectionMatch[1]);
    ingredientMode = false;
  }

  const stepsSectionMatch = rawCaption.match(
    /(?:instructions?|method|directions?|steps?)\s*[:\-]?\s*([\s\S]*)$/i
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

const loadImageFromUrl = (url, errorMessage = "The requested image could not be loaded.") =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(errorMessage));
    img.src = url;
  });

const imageOnlyRecipeText = (recipeText) =>
  (recipeText || "").split(/\nSource Caption\s*\n/i, 1)[0].trim();

const safeRecipeFilename = (title) => {
  const cleaned = (title || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned && cleaned.toLowerCase() !== "extracted recipe" ? cleaned : "TikTokRecipe";
};

const drawExtendedTemplate = (ctx, image, targetHeight) => {
  const width = image.width;
  if (targetHeight <= image.height) {
    ctx.drawImage(image, 0, 0, width, image.height);
    return;
  }

  const topSlice = Math.floor(image.height * 0.24);
  const bottomSlice = Math.floor(image.height * 0.22);
  const middleSourceHeight = image.height - topSlice - bottomSlice;
  const middleTargetHeight = targetHeight - topSlice - bottomSlice;

  ctx.drawImage(image, 0, 0, width, topSlice, 0, 0, width, topSlice);
  ctx.drawImage(
    image,
    0,
    topSlice,
    width,
    middleSourceHeight,
    0,
    topSlice,
    width,
    middleTargetHeight
  );
  ctx.drawImage(
    image,
    0,
    image.height - bottomSlice,
    width,
    bottomSlice,
    0,
    targetHeight - bottomSlice,
    width,
    bottomSlice
  );
};

const createRecipeCard = async () => {
  const recipeText = imageOnlyRecipeText(
    recipeOutput && recipeOutput.value ? recipeOutput.value.trim() : ""
  );
  if (!recipeText) {
    setStatus("Nothing to render yet. Extract a recipe first.");
    return;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    setStatus("Image rendering is not supported in this browser.");
    return;
  }

  let templateImage = null;
  let usesDefaultTemplate = false;
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
  } else {
    try {
      templateImage = await loadImageFromUrl(
        DEFAULT_RECIPE_TEMPLATE_URL,
        "The default recipe card template could not be loaded."
      );
      usesDefaultTemplate = true;
    } catch (error) {
      setStatus(error.message);
      return;
    }
  }

  const [titleLine, ...bodyLines] = recipeText.split("\n");
  const title = titleLine.trim() || "TikTokRecipe";
  const bodyText = bodyLines.join("\n").trim();
  const width = templateImage.width;
  let logoImage;
  try {
    logoImage = await loadImageFromUrl(RECIPE_CARD_LOGO_URL, "The recipe card logo could not be loaded.");
  } catch (error) {
    setStatus(error.message);
    return;
  }
  const safeLeft = Math.floor(width * (usesDefaultTemplate ? 0.17 : 0.14));
  const safeRight = Math.floor(width * (usesDefaultTemplate ? 0.83 : 0.86));
  const safeWidth = safeRight - safeLeft;

  ctx.textAlign = "left";
  const titleFontSize = Math.max(30, Math.floor(width * 0.046));
  const bodyFontSize = Math.max(20, Math.floor(width * 0.03));
  const titleLineHeight = Math.floor(titleFontSize * 1.25);
  const bodyLineHeight = Math.floor(bodyFontSize * 1.38);

  ctx.font = `bold ${titleFontSize}px "Times New Roman", serif`;
  const wrappedTitle = wrapCanvasText(ctx, title, safeWidth);
  const titleHeight = wrappedTitle.length * titleLineHeight;
  ctx.font = `${bodyFontSize}px Arial, sans-serif`;
  const wrappedBody = wrapCanvasText(ctx, bodyText, safeWidth);
  const bodyHeight = wrappedBody.length * bodyLineHeight;
  const safeTop = usesDefaultTemplate ? 165 : Math.floor(templateImage.height * 0.1);
  const logoSize = Math.max(62, Math.floor(width * 0.095));
  const logoBottomOffset = usesDefaultTemplate
    ? Math.max(110, Math.floor(width * 0.15))
    : Math.max(48, Math.floor(width * 0.08));
  const safeBottomPadding = logoSize + logoBottomOffset + Math.max(36, Math.floor(width * 0.05));
  const contentGap = Math.floor(bodyLineHeight * 0.7);
  const requiredHeight = safeTop + titleHeight + contentGap + bodyHeight + safeBottomPadding;

  canvas.width = width;
  canvas.height = Math.max(templateImage.height, requiredHeight);
  drawExtendedTemplate(ctx, templateImage, canvas.height);

  ctx.fillStyle = "rgba(69, 42, 49, 0.96)";
  ctx.textAlign = "center";
  ctx.font = `bold ${titleFontSize}px "Times New Roman", serif`;
  let y = safeTop + titleLineHeight;
  wrappedTitle.forEach((line) => {
    ctx.fillText(line, width / 2, y);
    y += titleLineHeight;
  });

  y += contentGap;
  ctx.textAlign = "left";
  ctx.font = `${bodyFontSize}px Arial, sans-serif`;
  wrappedBody.forEach((line) => {
    if (!line) {
      y += bodyLineHeight;
      return;
    }
    ctx.fillText(line, safeLeft, y);
    y += bodyLineHeight;
  });

  const logoX = Math.floor((canvas.width - logoSize) / 2);
  const logoY = canvas.height - logoBottomOffset - logoSize;
  ctx.save();
  ctx.beginPath();
  ctx.arc(canvas.width / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize);
  ctx.restore();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    setStatus("Could not create image file.");
    return;
  }
  return {
    blob,
    filename: `${safeRecipeFilename(title)}.png`,
    title: safeRecipeFilename(title)
  };
};

const downloadRecipeCard = (card, statusMessage = "Recipe card image downloaded.") => {
  const url = URL.createObjectURL(card.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = card.filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  setStatus(statusMessage);
};

const shareRecipeCard = async (card) => {
  const file = new File([card.blob], card.filename, { type: "image/png" });
  const shareData = {
    files: [file],
    title: card.title,
    text: `${card.title} recipe card`
  };

  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      setStatus("Recipe card shared. On iPhone, choose Save Image to add it to Photos.");
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        setStatus("Sharing cancelled.");
        return;
      }
      setStatus("The share sheet was unavailable, so the image was downloaded instead.");
    }
  }

  downloadRecipeCard(
    card,
    "Sharing files is unavailable in this browser, so the image was downloaded instead."
  );
};

const fetchMetadataAndPopulate = async () => {
  if (!videoUrlInput || !recipeInput) {
    setFetchLoading(false);
    return;
  }

  const videoUrl = videoUrlInput.value.trim();
  if (!videoUrl) {
    setStatus("Please enter a TikTok URL first.");
    setFetchLoading(false);
    return;
  }

  let normalized;
  try {
    normalized = normalizeTikTokUrl(videoUrl);
  } catch (error) {
    setStatus(error.message);
    setFetchLoading(false);
    return;
  }

  setStatus("Fetching TikTok metadata...");
  try {
    const metadata = await fetchTikTokMetadata(normalized);
    recipeInput.value = metadata.caption;
    state.thumbnailUrl = metadata.thumbnailUrl || "";
    renderRecipe();
  } catch (error) {
    state.thumbnailUrl = "";
    const errorMessage = error && error.message ? error.message : "unknown error";
    const message =
      `Metadata fetch failed (${errorMessage}). Paste caption text manually and click Extract.`;
    setStatus(message);
  } finally {
    setFetchLoading(false);
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
  fetchButton.setAttribute("data-default-label", fetchButton.textContent.trim() || "Extract Metadata");
  fetchButton.addEventListener("click", () => {
    setFetchLoading(true);
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
  downloadImageButton.addEventListener("click", async () => {
    if (!(recipeOutput && recipeOutput.value && recipeOutput.value.trim())) {
      renderRecipe();
    }
    const card = await createRecipeCard();
    if (card) {
      downloadRecipeCard(card);
    }
  });
}

if (shareImageButton) {
  shareImageButton.addEventListener("click", async () => {
    if (!(recipeOutput && recipeOutput.value && recipeOutput.value.trim())) {
      renderRecipe();
    }
    const card = await createRecipeCard();
    if (card) {
      await shareRecipeCard(card);
    }
  });
}

setupHostedExtractorLink();
