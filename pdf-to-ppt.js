const pdfForm = document.getElementById("pdf-converter-form");
const pdfFileInput = document.getElementById("pdf-file");
const loadPdfButton = document.getElementById("load-pdf-button");
const clearPdfButton = document.getElementById("clear-pdf-button");
const convertPdfButton = document.getElementById("convert-pdf-button");
const pdfStatus = document.getElementById("pdf-status");
const pdfEmptyState = document.getElementById("pdf-empty-state");
const pdfNotesPanel = document.getElementById("pdf-notes-panel");
const pdfNotesHeading = document.getElementById("pdf-notes-heading");
const pdfPageNotes = document.getElementById("pdf-page-notes");

const HOSTED_API_URL = "https://tiktok-recipe-extractor.onrender.com";
const LOCAL_API_URL = "http://127.0.0.1:5000";

const state = {
  file: null,
  pageCount: 0
};

const setStatus = (message) => {
  if (pdfStatus) {
    pdfStatus.textContent = message;
  }
};

const setLoading = (button, isLoading, loadingLabel) => {
  if (!button) {
    return;
  }

  const defaultLabel = button.getAttribute("data-default-label") || button.textContent.trim();
  button.setAttribute("data-default-label", defaultLabel);
  button.disabled = isLoading;
  button.classList.toggle("is-loading", isLoading);
  button.textContent = isLoading ? loadingLabel : defaultLabel;
};

const getApiBaseUrl = () => {
  const isLocal = ["", "localhost", "127.0.0.1"].includes(window.location.hostname);
  if (!isLocal) {
    return HOSTED_API_URL;
  }

  return new URLSearchParams(window.location.search).get("api") || LOCAL_API_URL;
};

const parseErrorResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({}));
    return payload.error || `Backend returned HTTP ${response.status}.`;
  }

  return `Backend returned HTTP ${response.status}. The converter service may need to be redeployed.`;
};

const getSelectedFile = () => {
  const file = pdfFileInput && pdfFileInput.files ? pdfFileInput.files[0] : null;
  if (!file) {
    setStatus("Please choose a PDF file first.");
    return null;
  }

  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    setStatus("Please choose a PDF file.");
    return null;
  }

  if (file.size > 16 * 1024 * 1024) {
    setStatus("That file is larger than the 16 MB limit.");
    return null;
  }

  return file;
};

const requestPdfInfo = async (file) => {
  const formData = new FormData();
  formData.append("pdf_file", file, file.name);

  const response = await fetch(`${getApiBaseUrl()}/api/pdf-info`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  return response.json();
};

const createPageNote = (pageNumber) => {
  const wrapper = document.createElement("div");
  wrapper.className = "pdf-page-note";

  const label = document.createElement("label");
  label.className = "field-label";
  label.htmlFor = `pdf-note-${pageNumber}`;
  label.textContent = `Slide ${pageNumber} / PDF page ${pageNumber}`;

  const textarea = document.createElement("textarea");
  textarea.id = `pdf-note-${pageNumber}`;
  textarea.className = "pdf-note-input";
  textarea.rows = 4;
  textarea.placeholder = "Add presenter comments for this slide...";
  textarea.setAttribute("aria-label", `Presenter comments for slide ${pageNumber}`);

  wrapper.append(label, textarea);
  return wrapper;
};

const showPageNotes = (pageCount) => {
  if (!pdfPageNotes || !pdfNotesPanel || !pdfEmptyState || !convertPdfButton) {
    return;
  }

  pdfPageNotes.textContent = "";
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    pdfPageNotes.appendChild(createPageNote(pageNumber));
  }

  pdfNotesHeading.textContent = `Presenter comments for ${pageCount} slide${pageCount === 1 ? "" : "s"}`;
  pdfEmptyState.hidden = true;
  pdfNotesPanel.hidden = false;
  convertPdfButton.disabled = false;
};

const loadPdf = async () => {
  const file = getSelectedFile();
  if (!file) {
    return;
  }

  state.file = file;
  setLoading(loadPdfButton, true, "Loading pages...");
  if (convertPdfButton) {
    convertPdfButton.disabled = true;
  }
  setStatus("Checking the PDF and counting its pages...");

  try {
    const info = await requestPdfInfo(file);
    state.pageCount = Number(info.page_count) || 0;
    if (!state.pageCount) {
      throw new Error("The PDF did not contain any pages.");
    }

    showPageNotes(state.pageCount);
    setStatus(`${state.pageCount} page${state.pageCount === 1 ? "" : "s"} ready. Add comments, then convert.`);
  } catch (error) {
    state.file = null;
    state.pageCount = 0;
    if (pdfNotesPanel) {
      pdfNotesPanel.hidden = true;
    }
    if (pdfEmptyState) {
      pdfEmptyState.hidden = false;
    }
    setStatus(error && error.message ? error.message : "The PDF could not be loaded.");
  } finally {
    setLoading(loadPdfButton, false);
  }
};

const getPresenterNotes = () =>
  Array.from(document.querySelectorAll(".pdf-note-input"), (textarea) => textarea.value);

const downloadPowerPoint = async () => {
  if (!state.file || !state.pageCount) {
    setStatus("Load a PDF before converting it.");
    return;
  }

  const formData = new FormData();
  formData.append("pdf_file", state.file, state.file.name);
  formData.append("notes", JSON.stringify(getPresenterNotes()));

  setLoading(convertPdfButton, true, "Converting...");
  setStatus("Rendering PDF pages and adding presenter comments...");

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/pdf-to-ppt`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(await parseErrorResponse(response));
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = state.file.name.replace(/\.pdf$/i, "") + ".pptx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    setStatus("PowerPoint downloaded. Open it in Microsoft PowerPoint to view the presenter notes.");
  } catch (error) {
    setStatus(error && error.message ? error.message : "The PDF could not be converted.");
  } finally {
    setLoading(convertPdfButton, false);
  }
};

const clearPdf = () => {
  state.file = null;
  state.pageCount = 0;
  if (pdfFileInput) {
    pdfFileInput.value = "";
  }
  if (pdfPageNotes) {
    pdfPageNotes.textContent = "";
  }
  if (pdfNotesPanel) {
    pdfNotesPanel.hidden = true;
  }
  if (pdfEmptyState) {
    pdfEmptyState.hidden = false;
  }
  if (convertPdfButton) {
    convertPdfButton.disabled = true;
  }
  setStatus("Choose a PDF to begin.");
};

if (pdfForm) {
  pdfForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadPdf();
  });
}

if (clearPdfButton) {
  clearPdfButton.addEventListener("click", clearPdf);
}

if (convertPdfButton) {
  convertPdfButton.addEventListener("click", downloadPowerPoint);
}
