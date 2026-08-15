/**
 * Portfolio Guide - embeddable chat widget.
 *
 * Usage (add to any business website):
 *
 *   <script
 *     src="widget.js"
 *     data-backend-url="wss://yourservice.com"
 *     data-target-url="https://boka.frisornyfors.se/"
 *     data-business-name="Portfolio Guide"
 *     data-logo-url="newlogo.png"
 *     data-lang="en"
 *     data-primary-color="#101010"
 *   ></script>
 *
 * The widget injects itself into a Shadow DOM root so it never conflicts
 * with the host page's styles.
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Read configuration from the script tag's data-* attributes
  // -------------------------------------------------------------------------
  const scriptTag =
    document.currentScript ||
    document.querySelector("script[data-backend-url]");

  // Per-language UI strings.
  const LANG_STRINGS = {
    en: {
      greeting: "Hello. What would you like to explore?",
      placeholder: "ask anything",
    },
  };
  const _ls = LANG_STRINGS[scriptTag?.dataset.lang] || LANG_STRINGS.en;
  const SUGGESTED_QUESTIONS = [
    "What projects has Jacob built?",
    "Summarize Jacob's essays.",
    "What can the TikTok Recipe Extractor do?",
    "Tell me a fun fact.",
  ];

  const cfg = {
    backendUrl: (scriptTag?.dataset.backendUrl || "ws://localhost:8000").replace(/\/$/, ""),
    targetUrl: scriptTag?.dataset.targetUrl || "",
    // data-info-url: separate URL for knowledge crawling (e.g. main site).
    // Defaults to targetUrl when not set.
    infoUrl: scriptTag?.dataset.infoUrl || scriptTag?.dataset.targetUrl || "",
    // The backend should answer portfolio questions first, then use its general
    // knowledge for safe non-portfolio questions. Set to "false" to opt out.
    allowGeneralKnowledge: scriptTag?.dataset.generalKnowledge !== "false",
    businessName: scriptTag?.dataset.businessName || "Business Assistant",
    lang: scriptTag?.dataset.lang || "en",
    primaryColor: scriptTag?.dataset.primaryColor || "#1246D6",
    position: scriptTag?.dataset.position || "bottom-right", // bottom-right | bottom-left
    greeting: scriptTag?.dataset.greeting || _ls.greeting,
    logoUrl: scriptTag?.dataset.logoUrl || "newlogo.png",
  };

  // -------------------------------------------------------------------------
  // Generate a stable session ID for this browser tab
  // -------------------------------------------------------------------------
  const SESSION_KEY = "mcp_widget_session_id";
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  const CONVERSATION_STORAGE_KEY = `mcp_widget_conversation:${cfg.businessName}`;
  const navigationEntry = performance.getEntriesByType("navigation")[0];
  if (navigationEntry?.type === "reload") {
    sessionStorage.removeItem(CONVERSATION_STORAGE_KEY);
  }

  // -------------------------------------------------------------------------
  // Build Shadow DOM host element
  // -------------------------------------------------------------------------
  const host = document.createElement("div");
  host.id = "mcp-widget-host";
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483647",
    bottom: "calc(24px + env(safe-area-inset-bottom))",
    [cfg.position === "bottom-left" ? "left" : "right"]: "24px",
    fontFamily: '"courier-std", "Courier New", monospace',
  });
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  // -------------------------------------------------------------------------
  // Styles (scoped inside shadow root)
  // -------------------------------------------------------------------------
  const style = document.createElement("style");
  style.textContent = `
    :host {
      --guide-bg: #ede5c6;
      --guide-text: #101010;
      --guide-line: #101010;
      --guide-muted: #2f3237;
      all: initial;
    }

    :host([data-theme="dark"]) {
      --guide-bg: #4e5b69;
      --guide-text: #e9e6de;
      --guide-line: #e9e6de;
      --guide-muted: #b9b4a9;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    button, input { font: inherit; }
    button { cursor: pointer; }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--guide-text); outline-offset: 2px; }

    .fab {
      align-items: center;
      background: var(--guide-bg);
      border: 2px solid var(--guide-line);
      color: var(--guide-text);
      display: inline-flex;
      gap: 0.45rem;
      height: 52px;
      justify-content: center;
      padding: 0.35rem 0.5rem;
    }
    .fab:hover { background: var(--guide-text); color: var(--guide-bg); }
    .launcher-logo { border-radius: 50%; display: block; height: 34px; width: 34px; }
    .launcher-label { font-size: 0.75rem; font-weight: 600; }

    .window {
      background: var(--guide-bg);
      border: 3px solid var(--guide-line);
      bottom: 64px;
      color: var(--guide-text);
      display: flex;
      flex-direction: column;
      max-height: min(560px, calc(100vh - 112px));
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      position: absolute;
      right: 0;
      transform: translateY(0.75rem);
      transition: opacity 180ms ease, transform 180ms ease;
      width: min(390px, calc(100vw - 48px));
    }
    .window.open { opacity: 1; pointer-events: auto; transform: translateY(0); }

    .header {
      align-items: center;
      border-bottom: 2px solid var(--guide-line);
      display: flex;
      gap: 0.65rem;
      padding: 0.65rem 0.75rem;
    }
    .header-avatar { flex: 0 0 auto; }
    .header-avatar img { border-radius: 50%; display: block; height: 30px; width: 30px; }
    .header-copy { flex: 1; min-width: 0; }
    .header-title { font-family: "pgLang Roman", Times, serif; font-size: 1.2rem; line-height: 1; }
    .header-subtitle { color: var(--guide-muted); font-size: 0.72rem; margin-top: 0.2rem; }
    .header-close {
      background: transparent;
      border: 2px solid var(--guide-line);
      color: var(--guide-text);
      height: 30px;
      line-height: 1;
      width: 30px;
    }
    .header-close:hover { background: var(--guide-text); color: var(--guide-bg); }

    .messages {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 0.75rem;
      min-height: 12rem;
      overflow-y: auto;
      padding: 0.85rem;
      scroll-behavior: smooth;
    }
    .messages::-webkit-scrollbar { width: 6px; }
    .messages::-webkit-scrollbar-thumb { background: var(--guide-line); }
    .message { font-size: 0.82rem; line-height: 1.55; max-width: 100%; overflow-wrap: anywhere; padding: 0.2rem 0; }
    .message-label { color: var(--guide-muted); display: block; font-size: 0.72rem; font-weight: 600; margin-bottom: 0.15rem; }
    .message-body { border-left: 2px solid var(--guide-line); padding-left: 0.7rem; }
    .message.user .message-body { border-left: 0; border-right: 2px solid var(--guide-line); padding-left: 0; padding-right: 0.55rem; text-align: right; }
    .message.user .message-label { text-align: right; }
    .message a { color: inherit; text-decoration: underline; text-underline-offset: 0.15em; }
    .message strong { font-weight: 700; }
    .message code {
      border: 1px solid var(--guide-line);
      font-family: inherit;
      font-size: 0.76rem;
      padding: 0.05rem 0.2rem;
    }
    .message-heading { display: inline-block; margin-top: 0.15rem; }
    .message.typing .message-body { color: var(--guide-muted); }

    .suggestions {
      border-top: 2px solid var(--guide-line);
      display: grid;
      gap: 0.4rem;
      padding: 0.65rem 0.75rem;
    }
    .suggestions[hidden] { display: none; }
    .suggestions-label {
      color: var(--guide-muted);
      font-size: 0.68rem;
      font-weight: 600;
    }
    .suggestion-btn {
      background: transparent;
      border: 1px solid var(--guide-line);
      color: var(--guide-text);
      font-size: 0.72rem;
      padding: 0.42rem 0.5rem;
      text-align: left;
    }
    .suggestion-btn:hover,
    .suggestion-btn:focus-visible {
      background: var(--guide-text);
      color: var(--guide-bg);
    }
    .suggestion-btn:disabled { cursor: wait; opacity: 0.6; }

    .disclaimer {
      border-top: 2px solid var(--guide-line);
      color: var(--guide-muted);
      font-size: 0.67rem;
      line-height: 1.45;
      padding: 0.55rem 0.75rem;
    }

    .input-row {
      border-top: 2px solid var(--guide-line);
      display: flex;
      gap: 0.5rem;
      padding: 0.65rem;
    }
    .input-row input {
      background: transparent;
      border: 2px solid var(--guide-line);
      color: var(--guide-text);
      flex: 1;
      font-size: 0.78rem;
      min-width: 0;
      padding: 0.55rem;
    }
    .input-row input::placeholder { color: var(--guide-muted); opacity: 1; }
    .input-row input:disabled { opacity: 0.65; }
    .send-btn {
      background: var(--guide-text);
      border: 2px solid var(--guide-line);
      color: var(--guide-bg);
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.55rem 0.7rem;
    }
    .send-btn:hover:not(:disabled) { background: var(--guide-bg); color: var(--guide-text); }
    .send-btn:disabled { cursor: wait; opacity: 0.6; }

    .powered { color: var(--guide-muted); font-size: 0.66rem; padding: 0 0.65rem 0.55rem; }

    /* Mobile Safari/Chrome zoom focused inputs below 16px automatically. */
    @media (max-width: 600px) {
      .input-row input {
        font-size: 16px;
        line-height: 1.25;
      }
    }

    @supports (height: 100dvh) {
      .window { max-height: min(560px, calc(100dvh - 112px)); }
    }

    @media (max-width: 420px) {
      .fab { height: 52px; width: 52px; }
      .launcher-label { display: none; }
      .window { right: 0; width: calc(100vw - 24px); }
    }

    @media (prefers-reduced-motion: reduce) {
      .window { transition: none; }
    }
  `;
  shadow.appendChild(style);

  // -------------------------------------------------------------------------
  // DOM structure
  // -------------------------------------------------------------------------
  const suggestionsMarkup = SUGGESTED_QUESTIONS.map(
    (question) =>
      `<button class="suggestion-btn" type="button" data-question="${escHtml(question)}">${escHtml(question)}</button>`
  ).join("");
  const container = document.createElement("div");
  container.innerHTML = `
    <div
      class="window"
      id="chat-window"
      role="dialog"
      aria-modal="true"
      aria-hidden="true"
      inert
      aria-labelledby="chat-title"
      aria-describedby="chat-disclaimer"
    >
      <div class="header">
        <div class="header-avatar"><img src="${escHtml(cfg.logoUrl)}" alt="" /></div>
        <div class="header-copy">
          <div class="header-title" id="chat-title">${escHtml(cfg.businessName)}</div>
          <div class="header-subtitle">site navigator</div>
        </div>
        <button class="header-close" id="close-btn" type="button" aria-label="Close Portfolio Guide">x</button>
      </div>
      <div class="messages" id="messages" role="log" aria-live="polite" aria-atomic="false" aria-busy="false" aria-relevant="additions text"></div>
      <div class="suggestions" id="suggestions" aria-label="Suggested questions">
        <span class="suggestions-label">Try asking:</span>
        ${suggestionsMarkup}
      </div>
      <div class="disclaimer" id="chat-disclaimer">EXTERNAL AI SERVICE. Do not share private, financial, or sensitive information.</div>
      <div class="input-row">
        <input type="text" id="user-input" aria-label="Ask Portfolio Guide" placeholder="${escHtml(_ls.placeholder)}" autocomplete="off" enterkeyhint="send" />
        <button class="send-btn" id="send-btn" type="button" aria-label="Send question">ASK</button>
      </div>
      <div class="powered">PORTFOLIO GUIDE / EXTERNAL AI</div>
    </div>
    <button class="fab" id="fab-btn" type="button" aria-label="Open Portfolio Guide" aria-expanded="false" aria-controls="chat-window">
      <img class="launcher-logo" src="${escHtml(cfg.logoUrl)}" alt="" />
      <span class="launcher-label">GUIDE</span>
    </button>
  `;
  shadow.appendChild(container);

  const chatWindow = shadow.getElementById("chat-window");
  const messagesEl = shadow.getElementById("messages");
  const suggestionsEl = shadow.getElementById("suggestions");
  const userInput = shadow.getElementById("user-input");
  const sendBtn = shadow.getElementById("send-btn");
  const fabBtn = shadow.getElementById("fab-btn");
  const closeBtn = shadow.getElementById("close-btn");

  const updateTheme = () => {
    host.dataset.theme = document.body.classList.contains("theme-dark") ? "dark" : "light";
  };

  updateTheme();
  new MutationObserver(updateTheme).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeLink(url, label) {
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return escHtml(label);
      }
      return `<a href="${escHtml(parsed.href)}" target="_blank" rel="noopener noreferrer">${escHtml(label)}</a>`;
    } catch {
      return escHtml(label);
    }
  }

  function renderInlineText(text) {
    const markdownLinks = [];
    const withLinkTokens = String(text).replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label, url) => {
        const token = `@@PORTFOLIO_GUIDE_LINK_${markdownLinks.length}@@`;
        markdownLinks.push(safeLink(url, label));
        return token;
      }
    );

    let rendered = escHtml(withLinkTokens)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(
        /(https?:\/\/[^\s<>"']+?)([)\].,;!?]*(?=\s|$))/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>$2'
      );

    markdownLinks.forEach((link, index) => {
      rendered = rendered.replace(`@@PORTFOLIO_GUIDE_LINK_${index}@@`, link);
    });
    return rendered;
  }

  // Render the small, safe Markdown subset commonly returned by the backend.
  function renderText(text) {
    return String(text)
      .split("\n")
      .map((line) => {
        const heading = line.match(/^#{1,6}\s+(.+)$/);
        if (heading) {
          return `<strong class="message-heading">${renderInlineText(heading[1])}</strong>`;
        }
        return renderInlineText(line);
      })
      .join("<br>");
  }

  function getPageContext() {
    const seenUrls = new Set();
    const links = [];

    document.querySelectorAll("a[href]").forEach((link) => {
      const label = link.textContent.trim().replace(/\s+/g, " ");
      if (!label) return;

      try {
        const url = new URL(link.getAttribute("href"), window.location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") return;
        if (seenUrls.has(url.href)) return;
        seenUrls.add(url.href);
        links.push({ label, url: url.href });
      } catch {
        // Ignore malformed host-page links rather than blocking a chat request.
      }
    });

    return {
      url: window.location.href,
      title: document.title,
      path: window.location.pathname + window.location.hash,
      links: links.slice(0, 40),
    };
  }

  const MAX_CONVERSATION_MESSAGES = 40;
  const MAX_CONVERSATION_CHARS = 24000;

  function loadConversation() {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem(CONVERSATION_STORAGE_KEY) || "[]"
      );
      if (!Array.isArray(stored)) return [];
      return stored
        .filter(
          (message) =>
            message &&
            (message.role === "user" || message.role === "bot") &&
            typeof message.text === "string" &&
            message.text.trim()
        )
        .slice(-MAX_CONVERSATION_MESSAGES);
    } catch {
      return [];
    }
  }

  let conversationHistory = loadConversation();

  function persistConversation() {
    try {
      let messages = conversationHistory.slice(-MAX_CONVERSATION_MESSAGES);
      while (
        JSON.stringify(messages).length > MAX_CONVERSATION_CHARS &&
        messages.length > 1
      ) {
        messages = messages.slice(1);
      }
      conversationHistory = messages;
      sessionStorage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Chat remains usable if storage is unavailable or full.
    }
  }

  function recordMessage(role, text) {
    if (!text || !String(text).trim()) return;
    conversationHistory.push({ role, text: String(text) });
    persistConversation();
  }

  function addBubble(role, text, { record = true } = {}) {
    if (record) recordMessage(role, text);
    const el = document.createElement("div");
    const label = role === "user" ? "YOU >" : "GUIDE >";
    el.className = `message ${role}`;
    el.innerHTML = `<span class="message-label">${label}</span><div class="message-body">${renderText(text)}</div>`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function updateBubbleText(element, text) {
    const body = element.querySelector(".message-body");
    if (body) {
      body.innerHTML = renderText(text);
    }
  }

  function addTypingIndicator() {
    const el = document.createElement("div");
    el.className = "message bot typing";
    el.id = "typing-indicator";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.innerHTML = '<span class="message-label">GUIDE &gt;</span><div class="message-body">retrieving site context...</div>';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function removeTypingIndicator() {
    const el = shadow.getElementById("typing-indicator");
    if (el) el.remove();
  }

  function setInputEnabled(enabled) {
    userInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    suggestionsEl.querySelectorAll("button").forEach((button) => {
      button.disabled = !enabled;
    });
    if (enabled) userInput.focus();
  }

  function restoreConversation() {
    conversationHistory.forEach(({ role, text }) => {
      addBubble(role, text, { record: false });
    });
    if (conversationHistory.length) {
      suggestionsEl.hidden = true;
    }
  }

  // Show greeting on first open
  let greeted = conversationHistory.some(
    (message) => message.role === "bot" && message.text === cfg.greeting
  );
  function showGreetingOnce() {
    if (!greeted) {
      greeted = true;
      addBubble("bot", cfg.greeting);
    }
  }

  restoreConversation();

  let isOpen = false;
  function openWidget() {
    isOpen = true;
    chatWindow.classList.add("open");
    chatWindow.setAttribute("aria-hidden", "false");
    chatWindow.removeAttribute("inert");
    fabBtn.setAttribute("aria-expanded", "true");
    showGreetingOnce();
    userInput.focus();
  }
  function closeWidget() {
    isOpen = false;
    chatWindow.classList.remove("open");
    chatWindow.setAttribute("aria-hidden", "true");
    chatWindow.setAttribute("inert", "");
    fabBtn.setAttribute("aria-expanded", "false");
    userInput.blur();
    fabBtn.focus();
  }

  fabBtn.addEventListener("click", () => (isOpen ? closeWidget() : openWidget()));
  closeBtn.addEventListener("click", closeWidget);
  chatWindow.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWidget();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = [...
      chatWindow.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ),
    ];
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && shadow.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) closeWidget();
  });

  suggestionsEl.querySelectorAll(".suggestion-btn").forEach((button) => {
    button.addEventListener("click", () => {
      sendMessage(button.dataset.question || "");
    });
  });

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------
  let ws = null;
  let wsReady = false;
  let currentBotBubble = null;
  let currentBotText = "";
  let pendingQueue = []; // messages queued before WS is ready

  function connectWS() {
    const wsUrl = cfg.backendUrl.replace(/^http/, "ws") + "/ws/" + sessionId;
    ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      wsReady = true;
      // Flush any messages that arrived before connection was ready
      pendingQueue.forEach((text) => sendToWS(text));
      pendingQueue = [];
    });

    ws.addEventListener("message", (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }

      if (msg.type === "token") {
        removeTypingIndicator();
        if (!currentBotBubble) {
          currentBotBubble = addBubble("bot", "", { record: false });
          currentBotText = "";
        }
        currentBotText += msg.text;
        updateBubbleText(currentBotBubble, currentBotText);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else if (msg.type === "done") {
        recordMessage("bot", currentBotText);
        currentBotBubble = null;
        currentBotText = "";
        messagesEl.setAttribute("aria-busy", "false");
        setInputEnabled(true);
      } else if (msg.type === "error") {
        removeTypingIndicator();
        if (currentBotText) recordMessage("bot", currentBotText);
        currentBotBubble = null;
        currentBotText = "";
        messagesEl.setAttribute("aria-busy", "false");
        addBubble("bot", "ERROR: " + (msg.message || "Something went wrong."));
        setInputEnabled(true);
      }
    });

    ws.addEventListener("close", () => {
      wsReady = false;
      // Attempt reconnect after 3 seconds
      setTimeout(connectWS, 3000);
    });

    ws.addEventListener("error", () => {
      wsReady = false;
    });
  }

  function sendToWS(text) {
    if (!wsReady || !ws || ws.readyState !== WebSocket.OPEN) {
      pendingQueue.push(text);
      return;
    }
    const pageContext = getPageContext();
    ws.send(
      JSON.stringify({
        type: "chat",
        text: text,
        business_name: cfg.businessName,
        target_url: cfg.targetUrl,
        info_url: cfg.infoUrl,
        lang: cfg.lang,
        answer_scope: "portfolio_first_general_knowledge",
        allow_general_knowledge: cfg.allowGeneralKnowledge,
        current_page_url: pageContext.url,
        current_page_title: pageContext.title,
        page_context: pageContext,
      })
    );
  }

  // Start WebSocket connection immediately
  connectWS();

  // -------------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------------
  function sendMessage(prefilledText = "") {
    const text = (prefilledText || userInput.value).trim();
    if (!text) return;

    const disclaimer = shadow.getElementById("chat-disclaimer");
    disclaimer?.remove();
    chatWindow.removeAttribute("aria-describedby");
    suggestionsEl.hidden = true;
    addBubble("user", text);
    userInput.value = "";
    setInputEnabled(false);
    messagesEl.setAttribute("aria-busy", "true");
    addTypingIndicator();

    sendToWS(text);
  }

  sendBtn.addEventListener("click", sendMessage);
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
})();
