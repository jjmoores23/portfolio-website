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

  const cfg = {
    backendUrl: (scriptTag?.dataset.backendUrl || "ws://localhost:8000").replace(/\/$/, ""),
    targetUrl: scriptTag?.dataset.targetUrl || "",
    // data-info-url: separate URL for knowledge crawling (e.g. main site).
    // Defaults to targetUrl when not set.
    infoUrl: scriptTag?.dataset.infoUrl || scriptTag?.dataset.targetUrl || "",
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

  // -------------------------------------------------------------------------
  // Build Shadow DOM host element
  // -------------------------------------------------------------------------
  const host = document.createElement("div");
  host.id = "mcp-widget-host";
  Object.assign(host.style, {
    position: "fixed",
    zIndex: "2147483647",
    bottom: "24px",
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
    .message.typing .message-body { color: var(--guide-muted); }

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
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="window" id="chat-window">
      <div class="header">
        <div class="header-avatar"><img src="${escHtml(cfg.logoUrl)}" alt="" /></div>
        <div class="header-copy">
          <div class="header-title">${escHtml(cfg.businessName)}</div>
          <div class="header-subtitle">site navigator</div>
        </div>
        <button class="header-close" id="close-btn" type="button" aria-label="Close Portfolio Guide">x</button>
      </div>
      <div class="messages" id="messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="disclaimer" id="chat-disclaimer">EXTERNAL AI SERVICE. Do not share private, financial, or sensitive information.</div>
      <div class="input-row">
        <input type="text" id="user-input" aria-label="Ask Portfolio Guide" placeholder="${escHtml(_ls.placeholder)}" />
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
      .replace(/>/g, "&gt;");
  }

  // Render plain text to safe HTML with clickable links and line breaks.
  function renderText(text) {
    const escaped = escHtml(text);
    // Linkify URLs (http/https)
    const linked = escaped.replace(
      /(https?:\/\/[^\s<>"']+?)([)\].,;!?]*(?:\s|$))/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>$2'
    );
    // Preserve line breaks
    return linked.replace(/\n/g, "<br>");
  }

  function addBubble(role, text) {
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
    if (enabled) userInput.focus();
  }

  // Show greeting on first open
  let greeted = false;
  function showGreetingOnce() {
    if (!greeted) {
      greeted = true;
      addBubble("bot", cfg.greeting);
    }
  }

  let isOpen = false;
  function openWidget() {
    isOpen = true;
    chatWindow.classList.add("open");
    fabBtn.setAttribute("aria-expanded", "true");
    showGreetingOnce();
    userInput.focus();
  }
  function closeWidget() {
    isOpen = false;
    chatWindow.classList.remove("open");
    fabBtn.setAttribute("aria-expanded", "false");
    fabBtn.focus();
  }

  fabBtn.addEventListener("click", () => (isOpen ? closeWidget() : openWidget()));
  closeBtn.addEventListener("click", closeWidget);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) {
      closeWidget();
    }
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
          currentBotBubble = addBubble("bot", "");
          currentBotText = "";
        }
        currentBotText += msg.text;
        updateBubbleText(currentBotBubble, currentBotText);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } else if (msg.type === "done") {
        currentBotBubble = null;
        currentBotText = "";
        setInputEnabled(true);
      } else if (msg.type === "error") {
        removeTypingIndicator();
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
    ws.send(
      JSON.stringify({
        type: "chat",
        text: text,
        business_name: cfg.businessName,
        target_url: cfg.targetUrl,
        info_url: cfg.infoUrl,
        lang: cfg.lang,
      })
    );
  }

  // Start WebSocket connection immediately
  connectWS();

  // -------------------------------------------------------------------------
  // Send message
  // -------------------------------------------------------------------------
  function sendMessage() {
    shadow.getElementById("chat-disclaimer")?.remove();
    const text = userInput.value.trim();
    if (!text) return;

    addBubble("user", text);
    userInput.value = "";
    setInputEnabled(false);
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
