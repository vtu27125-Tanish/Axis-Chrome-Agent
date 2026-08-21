// sidepanel/sidepanel.js — Axis
// Manages UI state, Google Auth, audio playback, visualizer, ephemeral transcripts.
import { processCommand } from "../engine/agentEngine.js";
// --- ENVIRONMENT CONFIGURATION ---
const IS_PROD = true; // Set to true for production
const PROD_DOMAIN = "axis-chrome-agent.onrender.com";
const BACKEND_WS = IS_PROD ? `wss://${PROD_DOMAIN}/ws/` : 'ws://127.0.0.1:8080/ws/';
const BACKEND_WS_CHAT = IS_PROD ? `wss://${PROD_DOMAIN}/ws-chat/` : 'ws://127.0.0.1:8080/ws-chat/';
const BACKEND_HTTP = IS_PROD ? `https://${PROD_DOMAIN}` : 'http://127.0.0.1:8080';
// ---------------------------------
let SESSION_ID = crypto.randomUUID();

const GOOGLE_CLIENT_ID = '461115625041-lp7uhcsip7r1uk6bv70rtqap60nkd4mb.apps.googleusercontent.com';

// Mermaid (loaded globally via lib/mermaid.min.js in sidepanel.html) — used to
// render actual flowchart/diagram SVGs instead of dumping raw diagram syntax.
if (typeof mermaid !== 'undefined') {
  mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
}
let _mermaidRenderSeq = 0;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let ws = null;
let chatWs = null;              // WebSocket for chat sessions (tool bridge)
let isListening = false;
let isHolding = false;
let currentTabId = null;
let currentWindowId = null;
let currentUrl = '';
let currentTitle = '';
let currentUser = null;
let currentView = 'idle'; // idle | live | settings
let wsConnecting = false;
let sessionEnding = false;
let activeSources = []; // Store active audio buffer sources for interruption
let selectedVoice = 'Aoede';
let selectedPersona = 'Pilot';
let savedCustomInstructions = '';
let ssQuality = 0.5;           // screenshot JPEG quality (hardcoded)
let selectedTabs = [];          // [{id, title, url, favIconUrl}] — tabs RESTRICTED from screenshots
let chatSessionId = null;       // current chat session ID
let isChatBusy = false;         // true while waiting on a chat_response — blocks overlapping sends
let chatSessionType = null;     // 'chat' or null
let deferredReadyMessage = false; // flag to show "Ready" when landing on idle

// Keep service worker alive
const keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });

// Mic recording state — runs in sidepanel (extension origin, works on all tabs)
let micStream = null;
let micAudioContext = null;
let micWorkletNode = null;

// ---------------------------------------------------------------------------
// Animated Toasts — success / error / warning / info
// ---------------------------------------------------------------------------
function showAxisToast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('axis-toast-container');
  if (!container || !message) return;

  const icons = { success: '✓', error: '⚠', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = `axis-toast toast-${type}`;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'axis-toast-icon';
  iconSpan.textContent = icons[type] || icons.info;

  const textSpan = document.createElement('span');
  textSpan.className = 'axis-toast-text';
  textSpan.textContent = message;

  toast.appendChild(iconSpan);
  toast.appendChild(textSpan);
  container.appendChild(toast);

  // Cap stack size so toasts don't pile up forever
  while (container.children.length > 4) {
    container.firstElementChild.remove();
  }

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 260);
  }, duration);
}

// Best-effort classification for legacy plain-string toast callers
function inferToastType(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('too large') || m.includes('unsupported') || m.includes('fail') || m.includes('error') || m.includes("can't") || m.includes('cannot')) return 'error';
  if (m.includes('restrict')) return 'warning';
  if (m.includes('shared') || m.includes('unrestrict') || m.includes('copied') || m.includes('saved') || m.includes('cleared')) return 'success';
  return 'info';
}

// ---------------------------------------------------------------------------
// Lightweight Markdown renderer for AI chat responses
// (bold, inline code, fenced code blocks, bullet/numbered lists)
// ---------------------------------------------------------------------------
function renderMarkdown(raw) {
  if (!raw) return '';

  // Escape HTML first so we never inject raw markup from the model
  const escapeDiv = document.createElement('div');
  escapeDiv.textContent = raw;
  let text = escapeDiv.innerHTML;

  // Protect fenced code blocks so inner content isn't touched by later rules
  const codeBlocks = [];
  text = text.replace(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    codeBlocks.push({ lang: (lang || 'text').trim(), code: code.replace(/\n$/, '') });
    return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
  });

  // Inline code
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Bold
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italics (single asterisk/underscore, avoid clobbering leftover bold markers)
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');

  // Line-by-line pass for lists
  const lines = text.split('\n');
  let html = '';
  let inUl = false, inOl = false;
  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };

  for (const line of lines) {
    const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const olMatch = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ulMatch) {
      if (!inUl) { closeLists(); html += '<ul>'; inUl = true; }
      html += `<li>${ulMatch[1]}</li>`;
    } else if (olMatch) {
      if (!inOl) { closeLists(); html += '<ol>'; inOl = true; }
      html += `<li>${olMatch[1]}</li>`;
    } else {
      closeLists();
      html += line.trim() === '' ? '<br>' : `${line}<br>`;
    }
  }
  closeLists();

  // Restore code blocks with a language label + per-block copy button
  html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (m, idx) => {
    const { lang, code } = codeBlocks[Number(idx)];
    return `<div class="code-block">
      <div class="code-block-header">
        <span class="code-block-lang">${lang}</span>
        <div class="code-block-actions">
          <button type="button" class="code-run-btn" title="Send this code to an online compiler and run it">&#9654; Run in Compiler</button>
          <button type="button" class="code-copy-btn">Copy</button>
        </div>
      </div>
      <pre><code>${code}</code></pre>
    </div>`;
  });

  return html;
}

// ---------------------------------------------------------------------------
// "Run in Compiler" — copies a code block and opens a matching online
// compiler tab, ready to paste (Ctrl/Cmd+V) and run.
// ---------------------------------------------------------------------------
const COMPILER_LANG_SLUGS = {
  python: 'python', py: 'python',
  javascript: 'javascript', js: 'javascript', node: 'javascript', nodejs: 'javascript',
  typescript: 'typescript', ts: 'typescript',
  java: 'java',
  c: 'c',
  cpp: 'cpp', 'c++': 'cpp',
  csharp: 'csharp', 'c#': 'csharp', cs: 'csharp',
  php: 'php',
  ruby: 'ruby', rb: 'ruby',
  go: 'go', golang: 'go',
  kotlin: 'kotlin',
  swift: 'swift',
  rust: 'rust', rs: 'rust',
  r: 'r',
  perl: 'perl',
  html: 'html',
  bash: 'bash', sh: 'bash', shell: 'bash',
  sql: 'mysql', mysql: 'mysql',
};

function compilerUrlForLang(lang) {
  const slug = COMPILER_LANG_SLUGS[(lang || '').toLowerCase().trim()];
  return slug ? `https://onecompiler.com/${slug}` : 'https://onecompiler.com';
}

async function sendCodeToCompiler(lang, code, btn) {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    showAxisToast('Could not copy code to clipboard', 'error');
    return;
  }
  const url = compilerUrlForLang(lang);
  if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
  try {
    await chrome.tabs.create({ url });
    showAxisToast('Code copied — paste it (Ctrl/Cmd+V) in the compiler tab and hit Run', 'success');
  } catch {
    showAxisToast('Could not open the compiler tab', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#9654; Run in Compiler'; }
  }
}

function nowTimeStr() {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// Builds a fully-featured chat message: glass bubble, markdown (agent only),
// timestamp, and a copy button on agent responses.
function createChatMsg(role, text) {
  const isUser = role === 'user';
  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${isUser ? 'user-msg' : 'agent-msg'}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg-bubble';
  if (isUser) {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
    bubble.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.code-copy-btn');
      if (copyBtn) {
        const codeEl = copyBtn.closest('.code-block').querySelector('code');
        navigator.clipboard.writeText(codeEl.textContent).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        }).catch(() => showAxisToast('Could not copy code', 'error'));
        return;
      }
      const runBtn = e.target.closest('.code-run-btn');
      if (runBtn) {
        const block = runBtn.closest('.code-block');
        const lang = block.querySelector('.code-block-lang')?.textContent || '';
        const codeEl = block.querySelector('code');
        sendCodeToCompiler(lang, codeEl.textContent, runBtn);
      }
    });
  }
  wrap.appendChild(bubble);

  const meta = document.createElement('div');
  meta.className = 'chat-msg-meta';
  const time = document.createElement('span');
  time.className = 'chat-msg-time';
  time.textContent = nowTimeStr();
  meta.appendChild(time);

  if (!isUser) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'chat-msg-copy';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        showAxisToast('Copied to clipboard', 'success');
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }).catch(() => showAxisToast('Could not copy text', 'error'));
    });
    meta.appendChild(copyBtn);
  }
  wrap.appendChild(meta);
  return wrap;
}

function createTypingIndicator() {
  const el = document.createElement('div');
  el.className = 'typing-indicator';
  el.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  return el;
}

// Helpers
function isNewTab(url) {
  if (!url) return true;
  const low = url.toLowerCase();
  return low.startsWith('chrome://newtab') || 
         low.startsWith('chrome://new-tab-page') || 
         low.startsWith('about:newtab') || 
         low.startsWith('chrome://startpageshared');
}

// Tab change detection
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    currentTabId = String(tab.id);
    currentWindowId = tab.windowId;
    currentUrl = tab.url || '';
    currentTitle = tab.title || '';
    if (ws?.readyState === WebSocket.OPEN) sendPageContext(tab, ws);
    if (chatWs?.readyState === WebSocket.OPEN) sendPageContext(tab, chatWs);
  } catch (e) { /* tab closed */ }
});

// Window focus detection to handle window switches
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId: windowId });
    if (tab) {
      currentTabId = String(tab.id);
      currentWindowId = tab.windowId;
      currentUrl = tab.url || '';
      currentTitle = tab.title || '';
      if (ws?.readyState === WebSocket.OPEN) sendPageContext(tab, ws);
      if (chatWs?.readyState === WebSocket.OPEN) sendPageContext(tab, chatWs);
    }
  } catch (e) { /* window closed */ }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (String(tabId) === currentTabId) {
    if (changeInfo.url) currentUrl = changeInfo.url;
    if (changeInfo.title) currentTitle = changeInfo.title;
    
    // Send context on any URL/Title change (loading or complete) to prevent desync
    if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
      if (ws?.readyState === WebSocket.OPEN) sendPageContext(tab, ws);
      if (chatWs?.readyState === WebSocket.OPEN) sendPageContext(tab, chatWs);
    }
  }
});

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const screenHome = document.getElementById('screen-home');
const screenAuth = document.getElementById('screen-auth');
const screenMain = document.getElementById('screen-main');

const viewIdle = document.getElementById('view-idle');
const viewLive = document.getElementById('view-live');
const viewSettings = document.getElementById('view-settings');
const settingsOverlay = document.getElementById('settings-overlay');

const userInitialEl = document.getElementById('user-initial');
const userPhotoEl = document.getElementById('user-photo');
const settingsInitialEl = document.getElementById('settings-initial');
const settingsPhotoEl = document.getElementById('settings-photo');
const settingsDisplayName = document.getElementById('settings-display-name');
const settingsEmail = document.getElementById('settings-email');

const goLiveBtn = document.getElementById('go-live-btn');
const endSessionBtn = document.getElementById('end-session-btn');
const holdBtn = document.getElementById('hold-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsBackBtn = document.getElementById('settings-back-btn');
const signOutBtn = document.getElementById('sign-out-btn');
const newSessionBtn = document.getElementById('new-session-btn');
const themeToggle = document.getElementById('theme-toggle');

// Idle view elements
const idleGreetingEl = document.getElementById('idle-greeting');
const tabPillsEl = document.getElementById('tab-pills');
const addTabsBtn = document.getElementById('add-tabs-btn');
const tabDropdown = document.getElementById('tab-dropdown');
const idleTextInput = document.getElementById('idle-text-input');
const chatDropOverlay = document.getElementById('chat-drop-overlay');

// Chat view elements
const viewChat = document.getElementById('view-chat');
const chatBackBtn = document.getElementById('chat-back-btn');
const chatSessionTitle = document.getElementById('chat-session-title');
const newChatBtn = document.getElementById('new-chat-btn');
const chatMessagesEl = document.getElementById('chat-messages');
const chatTextInput = document.getElementById('chat-text-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const ragUploadInput = document.getElementById('rag-upload-input');
const chatTabPillsEl = document.getElementById('chat-tab-pills');
const chatAddTabsBtn = document.getElementById('chat-add-tabs-btn');
const chatTabDropdown = document.getElementById('chat-tab-dropdown');
const sessionResumePopup = document.getElementById('session-resume-popup');
const chatScrollControls = document.getElementById('chat-scroll-controls');
const chatScrollUpBtn = document.getElementById('chat-scroll-up-btn');
const chatScrollDownBtn = document.getElementById('chat-scroll-down-btn');

// Limit view references
const viewLimit = document.getElementById('view-limit');
const limitBackBtn = document.getElementById('limit-back-btn');
const inputUsageBar = document.getElementById('input-usage-bar');
const imageUsageBar = document.getElementById('image-usage-bar');
const inputUsageText = document.getElementById('input-usage-text');
const imageUsageText = document.getElementById('image-usage-text');

const liveCanvas = document.getElementById('live-visualizer');
const chatContainer = document.getElementById('chat-container');
const liveScrollControls = document.getElementById('live-scroll-controls');
const liveScrollUpBtn = document.getElementById('live-scroll-up-btn');
const liveScrollDownBtn = document.getElementById('live-scroll-down-btn');
const recentSessionsDiv = document.getElementById('recent-sessions');

// New Views
const viewOnboarding = document.getElementById('view-onboarding');
const onboardingCloseBtn = document.getElementById('onboarding-close-btn');
const viewOffline = document.getElementById('view-offline');
const retryConnBtn = document.getElementById('retry-conn-btn');

// Usage Dashboard references
const viewUsage = document.getElementById('usage-view');
const usageBackBtn = document.getElementById('usage-back-btn');
const usageCommandsRemaining = document.getElementById('usage-commands-remaining');
const usageCommandsFill = document.getElementById('usage-commands-fill');
const usageCommandsSubtext = document.getElementById('usage-commands-subtext');
const usageImagesRemaining = document.getElementById('usage-images-remaining');
const usageImagesFill = document.getElementById('usage-images-fill');
const usageImagesSubtext = document.getElementById('usage-images-subtext');
const usageRequestBtn = document.getElementById('usage-request-btn');
const usageSettingsBtn = document.getElementById('usage-settings-btn');

// Image Modal References
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const modalDownloadBtn = document.getElementById('modal-download-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');

// ---------------------------------------------------------------------------
// Screen & View management
// ---------------------------------------------------------------------------
function showScreen(el) {
  [screenHome, screenAuth, screenMain].forEach(s => s.classList.remove('active'));
  el.classList.add('active');
}

let lastPrimaryView = 'idle';

function switchView(view) {
  currentView = view;

  const primaryViews = ['idle', 'live', 'chat', 'limit', 'onboarding', 'offline'];
  const overlayViews = ['settings', 'usage', 'feedback'];

  // 1. If it's a primary view, update lastPrimaryView
  if (primaryViews.includes(view)) {
    lastPrimaryView = view;
  }

  // 2. Clear AND SET primary views only if new view is a primary view
  if (primaryViews.includes(view)) {
    // Hide all primary views
    viewIdle.classList.remove('active-view');
    viewLive.classList.remove('active-view');
    if (viewChat) viewChat.classList.remove('active-view');
    if (viewOnboarding) viewOnboarding.classList.remove('active-view');
    if (viewOffline) viewOffline.classList.remove('active-view');
    if (viewLimit) viewLimit.classList.remove('active-view');

    // Show the target primary view
    if (view === 'idle') viewIdle.classList.add('active-view');
    else if (view === 'live') viewLive.classList.add('active-view');
    else if (view === 'chat' && viewChat) viewChat.classList.add('active-view');
    else if (view === 'limit' && viewLimit) viewLimit.classList.add('active-view');
    else if (view === 'onboarding' && viewOnboarding) viewOnboarding.classList.add('active-view');
    else if (view === 'offline' && viewOffline) viewOffline.classList.add('active-view');
  }

  // 3. Ensure the underlying primary view IS visible if we are switching to/between overlays
  if (overlayViews.includes(view)) {
    const backgroundView = (lastPrimaryView === 'idle') ? viewIdle :
                           (lastPrimaryView === 'live') ? viewLive :
                           (lastPrimaryView === 'chat') ? viewChat :
                           (lastPrimaryView === 'limit') ? viewLimit :
                           (lastPrimaryView === 'onboarding') ? viewOnboarding :
                           (lastPrimaryView === 'offline') ? viewOffline : null;
    if (backgroundView) {
      backgroundView.classList.add('active-view');
    }
  }

  // 4. Handle Slide Overlays
  // Close others when opening one, or close all if switching to primary
  if (!overlayViews.includes(view)) {
    // Primary view: close all overlays
    if (viewUsage) viewUsage.classList.remove('open');
    if (viewFeedback) viewFeedback.classList.remove('open');
    viewSettings.classList.remove('open');
    settingsOverlay.classList.remove('visible');
  } else {
    // Specific overlay handling
    if (view === 'usage') {
      if (viewUsage) viewUsage.classList.add('open');
      viewSettings.classList.remove('open');
      settingsOverlay.classList.remove('visible');
      if (viewFeedback) viewFeedback.classList.remove('open');
    } else if (view === 'settings') {
      viewSettings.classList.add('open');
      settingsOverlay.classList.add('visible');
      if (viewUsage) viewUsage.classList.remove('open');
      if (viewFeedback) viewFeedback.classList.remove('open');
      if (currentUser) loadRecentSessions();
    } else if (view === 'feedback') {
      if (viewFeedback) viewFeedback.classList.add('open');
      viewSettings.classList.remove('open');
      settingsOverlay.classList.remove('visible');
      if (viewUsage) viewUsage.classList.remove('open');
    }
  }

  // If switching to idle, check for deferred "Ready" message
  if (view === 'idle' && deferredReadyMessage) {
    deferredReadyMessage = false;
    setTimeout(() => {
      handleStatusMessage({
        type: 'status',
        level: 'info',
        message: 'Ready to go Live!'
      });
    }, 500);
  }
}

function openSettings() {
  viewSettings.classList.add('open');
  settingsOverlay.classList.add('visible');
  if (currentUser) {
    settingsDisplayName.textContent = currentUser.name || 'User';
    settingsEmail.textContent = currentUser.email || '';
    const initial = (currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
    settingsInitialEl.textContent = initial;
    if (currentUser.picture) {
      settingsPhotoEl.src = currentUser.picture;
      settingsPhotoEl.classList.remove('hidden');
      settingsInitialEl.classList.add('hidden');
    } else {
      settingsPhotoEl.classList.add('hidden');
      settingsInitialEl.classList.remove('hidden');
    }
    loadRecentSessions();
  }
}

function closeSettings() {
  viewSettings.classList.remove('open');
  settingsOverlay.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
document.getElementById('sign-in-btn').addEventListener('click', signIn);
signOutBtn.addEventListener('click', signOutUser);

chrome.storage.local.get(['pp_user', 'pp_token'], (data) => {
  if (data.pp_user && data.pp_token) {
    currentUser = data.pp_user;
    showMainScreen();
    connectWS(currentUser.id, data.pp_token);
  }
});

// Load personalization settings from sync storage
chrome.storage.sync.get(['axis_voice', 'axis_persona', 'axis_custom_instructions'], (data) => {
  selectedVoice = data.axis_voice || 'Aoede';
  selectedPersona = data.axis_persona || 'Pilot';
  savedCustomInstructions = data.axis_custom_instructions || '';
  const voiceEl = document.getElementById('voice-select');
  const personaEl = document.getElementById('persona-select');
  const instructionsEl = document.getElementById('custom-instructions');
  const charCountEl = document.getElementById('char-count');
  if (voiceEl) voiceEl.value = selectedVoice;
  if (personaEl) personaEl.value = selectedPersona;
  if (instructionsEl) instructionsEl.value = savedCustomInstructions;
  if (charCountEl) charCountEl.textContent = `${savedCustomInstructions.length}/500`;
});

function signIn() {
  console.log("signIn() triggered!");
  try {
    const redirectUrl = chrome.identity.getRedirectURL();
    console.log("Redirect URL:", redirectUrl);
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUrl);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', 'openid profile email');
    console.log("Auth URL ready:", authUrl.toString());

    chrome.identity.launchWebAuthFlow(
      { url: authUrl.toString(), interactive: true },
      async (responseUrl) => {
        console.log("launchWebAuthFlow callback returned. URL:", responseUrl);
        const errorDiv = document.getElementById('auth-error');
        if (chrome.runtime.lastError || !responseUrl) {
          const errMsg = chrome.runtime.lastError?.message || '';
          const isCancelled = errMsg.toLowerCase().includes('did not approve') || 
                              errMsg.toLowerCase().includes('user cancelled') ||
                              errMsg.toLowerCase().includes('interrupt');
          
          if (!isCancelled) {
            console.error('Auth error (chrome.runtime.lastError):', errMsg || chrome.runtime.lastError || 'No response URL');
            if (errorDiv) {
              errorDiv.textContent = 'Auth error: ' + (errMsg || 'No response URL');
            }
          } else {
            console.log("User cancelled authentication flow.");
            if (errorDiv) errorDiv.textContent = ''; // clear any previous error
          }

          // Show popup message same as "ready to go live"
          handleStatusMessage({
            type: 'status',
            level: 'info',
            message: 'Sign-in failed, please try again'
          });
          return;
        }
        if (errorDiv) errorDiv.textContent = '';
        console.log("Parsing token from fragment...");

        let accessToken = null;
        try {
          // The responseUrl often looks like: https://<id>.chromiumapp.org/#access_token=ya29....
          const hashIdx = responseUrl.indexOf('#');
          if (hashIdx !== -1) {
            const fragment = responseUrl.substring(hashIdx + 1);
            const params = new URLSearchParams(fragment);
            accessToken = params.get('access_token');
          }
        } catch (e) {
          console.error("Error parsing URL Fragment:", e);
        }

        if (!accessToken) {
          console.error("No access token found in response URL:", responseUrl);
          if (errorDiv) errorDiv.textContent = "Sign in successful but could not extract token.";
          return;
        }

        console.log("Fetching user profile...");
        try {
          const resp = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`);
          if (!resp.ok) {
            throw new Error(`Profile fetch HTTP Error: ${resp.status}`);
          }
          const profile = await resp.json();
          console.log("Profile fetched:", profile.email);
          currentUser = { id: profile.email, name: profile.name, email: profile.email, picture: profile.picture };
          chrome.storage.local.set({ pp_user: currentUser, pp_token: accessToken });
          showAuthenticatingScreen(() => { showMainScreen(); connectWS(currentUser.id, accessToken); });
        } catch (e) {
          console.error("Profile fetch error:", e);
          if (errorDiv) errorDiv.textContent = 'User info fetch failed: ' + e.message;
          handleStatusMessage({
            type: 'status',
            level: 'info',
            message: 'Sign-in failed, please Try again'
          });
        }
      }
    );
  } catch (err) {
    const errorDiv = document.getElementById('auth-error');
    console.error('Synchronous error in signIn():', err);
    if (errorDiv) errorDiv.textContent = 'Error: ' + err.message;
  }
}

function showAuthenticatingScreen(onComplete) {
  showScreen(screenAuth);
  setTimeout(() => { if (onComplete) onComplete(); }, 2200);
}

function showMainScreen() {
  showScreen(screenMain);
  if (currentUser) {
    const initial = (currentUser.name || currentUser.email || '?').charAt(0).toUpperCase();
    userInitialEl.textContent = initial;
    if (currentUser.picture) {
      userPhotoEl.src = currentUser.picture;
      userPhotoEl.classList.remove('hidden');
      userInitialEl.classList.add('hidden');
    } else {
      userPhotoEl.classList.add('hidden');
      userInitialEl.classList.remove('hidden');
    }
    // Populate greeting
    const firstName = (currentUser.name || '').split(' ')[0] || 'there';
    if (idleGreetingEl) idleGreetingEl.textContent = `Nice to see you, ${firstName}!`;
  }

  // Onboarding Logic
  chrome.storage.local.get(['axis_onboarding_seen'], (data) => {
    if (!data.axis_onboarding_seen) {
      switchView('onboarding');
    } else {
      switchView('idle');
    }
  });
  populateTabSelector();
  updateUsageCounts();
}

if (onboardingCloseBtn) {
  onboardingCloseBtn.addEventListener('click', () => {
    chrome.storage.local.set({ axis_onboarding_seen: true });
    switchView('idle');
  });
}

function signOutUser() {
  chrome.storage.local.remove(['pp_user', 'pp_token']);
  currentUser = null;
  closeSettings();
  disconnectWS();
  showScreen(screenHome);
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
function connectWS(userId, token) {
  if (wsConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
  if (ws && ws.readyState === WebSocket.CONNECTING) return;

  let reconnectAttempts = 0;
  const maxReconnect = 10;
  const baseDelay = 1000;

  function doConnect() {
    if (wsConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
    wsConnecting = true;
    ws = new WebSocket(BACKEND_WS + SESSION_ID);
    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
      wsConnecting = false;
      reconnectAttempts = 0;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = String(tab.id);
      currentWindowId = tab.windowId;
      currentUrl = tab.url || '';
      currentTitle = tab.title || '';

      // Wait for backend 'ready' signal before sending auth
      const authPayload = JSON.stringify({
        type: 'auth',
        user_id: userId,
        id_token: token,
        email: currentUser?.email || '',
        display_name: currentUser?.name || '',
        tab_id: currentTabId,
        page_url: tab.url,
        page_title: tab.title || '',
        session_id: SESSION_ID,
        voice: selectedVoice,
        persona: selectedPersona,
        custom_instructions: savedCustomInstructions,
        selected_tabs: selectedTabs.map(t => ({ id: t.id, url: t.url, title: t.title })),
      });

      let authSent = false;
      const readyTimeout = setTimeout(() => {
        // Fallback: send auth after 8s even without 'ready'
        if (!authSent && ws?.readyState === WebSocket.OPEN) {
          authSent = true;
          ws.send(authPayload);
          sendPageContext(tab);
          goLiveBtn.disabled = false;
        }
      }, 8000);

      // Temporarily listen for the 'ready' message
      const origOnMessage = ws.onmessage;
      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ready' && !authSent) {
              authSent = true;
              clearTimeout(readyTimeout);
              ws.send(authPayload);
              sendPageContext(tab);
              goLiveBtn.disabled = false;
            }
          } catch { }
        }
        // Restore original handler and forward this message
        ws.onmessage = origOnMessage;
        if (origOnMessage) origOnMessage(event);
      };
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playAudioBinary(event.data);
      } else {
        handleMessage(JSON.parse(event.data), ws);
      }
    };

    ws.onerror = () => {
      wsConnecting = false;
      if (!sessionEnding) switchView('offline');
    };

    ws.onclose = () => {
      wsConnecting = false;
      goLiveBtn.disabled = true;
      if (!sessionEnding && reconnectAttempts >= maxReconnect) {
        switchView('offline');
      }
      if (!sessionEnding && reconnectAttempts < maxReconnect) {
        setTimeout(doConnect, baseDelay * Math.pow(2, reconnectAttempts));
        reconnectAttempts++;
      }
    };
  }
  doConnect();
}

if (retryConnBtn) {
  retryConnBtn.addEventListener('click', () => {
    if (currentUser) {
      chrome.storage.local.get(['pp_token'], (data) => {
        if (data.pp_token) {
          switchView('idle'); // optimistic switch
          connectWS(currentUser.id, data.pp_token);
        }
      });
    }
  });
}

function disconnectWS() {
  if (ws) { ws.close(); ws = null; }
}

// ---------------------------------------------------------------------------
// Page context
// ---------------------------------------------------------------------------
function isRestrictedUrl(url) {
  if (!url) return true;
  if (isNewTab(url)) return false;
  const low = url.toLowerCase();
  return low.startsWith('chrome://') || low.startsWith('chrome-extension://') || low.startsWith('about:') || low.startsWith('edge://') || url === 'about:blank';
}

function sendPageContext(tab, targetWs) {
  const s = targetWs || ws;
  const url = tab.url || '';
  const title = tab.title || '';

  // Define manual sidepanel tools to inject
  const manualTools = [
    {
      name: "end_session",
      description: "End the current live session and return to home screen",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "hold_session",
      description: "Put the live session on hold (pauses the microphone)",
      input_schema: { type: "object", properties: {} }
    },
    {
      name: "resume_session",
      description: "Resume the live session from hold (re-activates the microphone)",
      input_schema: { type: "object", properties: {} }
    }
  ];

  if (isRestrictedUrl(url)) {
    if (s?.readyState === WebSocket.OPEN) {
      s.send(JSON.stringify({ type: 'page_context', url, title: title || 'New Tab', webmcp_available: false, webmcp_tools: manualTools, selected_tabs: selectedTabs, session_id: SESSION_ID }));
    }
    return;
  }
  chrome.runtime.sendMessage({ type: 'get_webmcp_tools' }, (response) => {
    if (chrome.runtime.lastError) {
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'page_context', url, title, webmcp_available: false, webmcp_tools: manualTools, selected_tabs: selectedTabs, session_id: SESSION_ID }));
      }
      return;
    }
    const combinedTools = [...(response?.tools || []), ...manualTools];
    if (s?.readyState === WebSocket.OPEN) {
      s.send(JSON.stringify({ type: 'page_context', url, title, webmcp_available: response?.available || false, webmcp_tools: combinedTools, selected_tabs: selectedTabs, session_id: SESSION_ID }));
    }
  });
}

// ---------------------------------------------------------------------------
// Screenshot Helpers
// ---------------------------------------------------------------------------
function processScreenshotForTab(tab, s) {
  const activeUrl = tab.url || '';
  const activeTabId = tab.id;
  const restrictedPrefixes = ["chrome://", "about:", "chrome-extension://", "edge://"];
  let isChromePage = (restrictedPrefixes.some(p => activeUrl.toLowerCase().startsWith(p)) || !activeUrl) && !isNewTab(activeUrl);
  const isRestrictedTab = selectedTabs.some(t => t.id === activeTabId);

  if (isChromePage || isRestrictedTab) {
    handleStatusMessage({
      type: 'status',
      level: 'info',
      message: "Restricted, Won't Peek here."
    });
    if (s?.readyState === WebSocket.OPEN) {
      s.send(JSON.stringify({
        type: 'screenshot_result',
        data: '',
        success: false,
        error: isChromePage ? 'chrome_internal_page' : 'tab_restricted',
        session_id: SESSION_ID
      }));
    }
    return;
  }

  // Show "Peek" notification before capturing
  handleStatusMessage({
    type: 'status',
    level: 'info',
    message: "Taking a look at the screen."
  });

  chrome.runtime.sendMessage({ 
    type: 'capture_screenshot', 
    quality: 80, 
    windowId: tab.windowId, 
    tabId: tab.id 
  }, (response) => {
    void chrome.runtime.lastError;
    if (!response?.success || !response?.data) {
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'screenshot_result', data: '', success: false, session_id: SESSION_ID }));
      }
      return;
    }

    const img = new Image();
    img.onload = () => {
      const MAX_WIDTH = 960;
      let width = img.width;
      let height = img.height;

      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', ssQuality);
      const compressedB64 = compressedDataUrl.replace(/^data:image\/jpeg;base64,/, '');

      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'screenshot_result', data: compressedB64, success: true, session_id: SESSION_ID }));
      }
    };

    img.onerror = (e) => {
      console.error('[Axis] Screenshot img load error:', e);
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'screenshot_result', data: '', success: false, error: 'img_load_error', session_id: SESSION_ID }));
      }
    };

    img.src = 'data:image/jpeg;base64,' + response.data;
  });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
function handleMessage(msg, sock) {
  const s = sock || ws;
  console.log('[Axis] WS message:', msg.type, msg.text ? msg.text.slice(0, 80) : '');
  
  if (msg.type === 'limit_reached') {
    showLimitView({ 
      input_count: msg.input_count, 
      image_count: msg.image_count,
      input_limit: msg.input_limit || 150,
      image_limit: msg.image_limit || 5
    });
    if (s === ws) stopListening();
    return;
  }

  if (msg.type === 'audio_response') {
    playAudio(msg.data);
  } else if (msg.type === 'user_transcript' || msg.type === 'input_transcription') {
    if (msg.text) {
      showTranscript(msg.text, 'user', !msg.is_partial);
      // If user starts speaking, stop agent audio immediately to prevent overlap/lag
      if (msg.is_partial) {
        stopAllAudio();
      }
    }
  } else if (msg.type === 'agent_transcript' || msg.type === 'output_transcription') {
    if (msg.text) {
      showTranscript(msg.text, 'agent', !msg.is_partial);

      // TRIGGER: If agent says they will generate/draw, show a simple text bubble immediately
      const lower = msg.text.toLowerCase();
      const keywords = ['generating', 'drawing', 'creating', 'painting', 'rendering', 'sketching', 'generated', 'visualizing'];
      const hasKeywords = keywords.some(k => lower.includes(k));

      if (hasKeywords) {
        if (!document.querySelector('.generating-bubble') && !document.querySelector('.image-message-card')) {
          showGeneratingBubble();
        }
      }
    }
  } else if (msg.type === 'session_ended') {
    // Server confirmed session end
  } else if (msg.type === 'turn_complete') {
    if (msg.interrupted) {
      console.log('[Axis] Agent interrupted, stopping audio');
      stopAllAudio();
    }
  } else if (msg.type === 'status') {
    handleStatusMessage(msg);
  } else if (msg.type === 'error') {
    if (msg.message && !msg.message.toLowerCase().includes('cannot access')) {
      showTranscript(msg.message, 'agent', true);
    }
    setChatBusy(false);
  } else if (msg.type === 'request_screenshot') {
    // Optimization: query the truly active tab in the current window to avoid stale state
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      let tab = tabs[0];
      if (chrome.runtime.lastError || !tab) {
        // Fallback to currentTabId if query fails or returns nothing
        chrome.tabs.get(Number(currentTabId), (fallbackTab) => {
          if (chrome.runtime.lastError || !fallbackTab) {
            if (s?.readyState === WebSocket.OPEN) {
              s.send(JSON.stringify({ type: 'screenshot_result', data: '', success: false, error: 'tab_not_found', session_id: SESSION_ID }));
            }
            return;
          }
          processScreenshotForTab(fallbackTab, s);
        });
        return;
      }
      processScreenshotForTab(tab, s);
    });
  } else if (msg.type === 'execute_webmcp') {
    // Handle manual sidepanel tools
    if (msg.tool_name === 'end_session') {
      handleEndSession();
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: true, session_id: SESSION_ID }));
      }
      return;
    }
    if (msg.tool_name === 'hold_session') {
      handleHold();
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: true, session_id: SESSION_ID }));
      }
      return;
    }
    if (msg.tool_name === 'resume_session') {
      handleResume();
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: true, session_id: SESSION_ID }));
      }
      return;
    }

    chrome.runtime.sendMessage({ type: 'execute_webmcp', tool_name: msg.tool_name, args: msg.args }, (response) => {
      void chrome.runtime.lastError;
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: response?.success || false, error: response?.error || null, session_id: SESSION_ID }));
      }
    });
  } else if (msg.type === 'execute_dom') {
    chrome.runtime.sendMessage({ type: 'execute_dom', selector: msg.selector, action: msg.action, value: msg.value }, (response) => {
      void chrome.runtime.lastError;
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: response?.success || false, error: response?.error || null, session_id: SESSION_ID }));
      }
    });
  } else if (msg.type === 'browser_action') {
    chrome.runtime.sendMessage({ type: 'browser_action', action: msg.action, url: msg.url, tab_query: msg.tab_query }, (response) => {
      void chrome.runtime.lastError;
      if (response?.success) {
        // Sync local state immediately on successful navigation/switch
        if (response.url) currentUrl = response.url;
        if (response.title) currentTitle = response.title;
        if (response.tabId) currentTabId = String(response.tabId);
        
        // Re-send context so agent knows it has moved
        chrome.tabs.get(Number(currentTabId), (tab) => {
          if (!chrome.runtime.lastError && tab) {
            sendPageContext(tab, s);
          }
        });
      }
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'browser_action_result', success: response?.success || false, error: response?.error || null, message: response?.message || '', tabs: response?.tabs || null, tabId: response?.tabId || null, url: response?.url || null, title: response?.title || null, session_id: SESSION_ID }));
      }
    });
  } else if (msg.type === 'get_interactive_elements') {
    chrome.runtime.sendMessage({ type: 'get_interactive_elements' }, (response) => {
      void chrome.runtime.lastError;
      if (s?.readyState === WebSocket.OPEN) {
        s.send(JSON.stringify({ type: 'action_result', success: response?.success || false, elements: response?.elements || [], session_id: SESSION_ID }));
      }
    });
  } else if (msg.type === 'file_uploaded') {
    showToast(`\u2713 ${msg.filename} shared with Axis`);
  } else if (msg.type === 'tool_start' && msg.tool === 'generate_image') {
    const isImageCardReady = document.querySelector('.image-message-card');
    const isBubbleActive = document.querySelector('.generating-bubble');
    if (!isBubbleActive && !isImageCardReady) {
      showGeneratingBubble();
    }
  } else if (msg.type === 'tool_start' && msg.tool === 'generate_code') {
    const isCodeCardReady = document.querySelector('.code-message-card');
    const isBubbleActive = document.querySelector('.generating-bubble');
    if (!isBubbleActive && !isCodeCardReady) {
      showGeneratingBubble('Writing code...');
    }
  } else if (msg.type === 'tool_result' && msg.tool === 'generate_code') {
    if (currentView === 'chat') {
      const thinkingBubble = document.querySelector('.chat-bubble.agent.partial');
      if (thinkingBubble) thinkingBubble.remove();
    }
    const generatingBubble = document.querySelector('.generating-bubble');
    if (generatingBubble) {
      resolveCodeMessage(generatingBubble, msg.data);
    } else {
      const container = currentView === 'chat' ? chatMessagesEl : chatContainer;
      const ghost = document.createElement('div');
      container.appendChild(ghost);
      resolveCodeMessage(ghost, msg.data);
    }
  } else if (msg.type === 'tool_result' && msg.tool === 'generate_image') {
    // In chat view, remove the '...' thinking bubble since the image IS the response
    if (currentView === 'chat') {
      const thinkingBubble = document.querySelector('.chat-bubble.agent.partial');
      if (thinkingBubble) thinkingBubble.remove();
    }
    const generatingBubble = document.querySelector('.generating-bubble');
    if (generatingBubble) {
      resolveImageMessage(generatingBubble, msg.data);
    } else {
      // If result came before bubble was triggered (race condition)
      const container = currentView === 'chat' ? chatMessagesEl : chatContainer;
      const ghost = document.createElement('div');
      container.appendChild(ghost);
      resolveImageMessage(ghost, msg.data);
    }
  } else if (msg.type === 'tool_result' && msg.tool === 'screenshot_tool') {
    // Screenshots have no preceding "generating" bubble — just append the image
    // as its own message alongside the agent's text reply.
    const container = currentView === 'chat' ? chatMessagesEl : chatContainer;
    const ghost = document.createElement('div');
    container.appendChild(ghost);
    resolveImageMessage(ghost, msg.data);
    container.scrollTop = container.scrollHeight;
  }
}

// ---------------------------------------------------------------------------
// Tab Selector
// ---------------------------------------------------------------------------
async function populateTabSelector() {
  if (!tabPillsEl) return;
  // Restore previously restricted tabs
  chrome.storage.session.get(['axis_selected_tabs'], async (data) => {
    const saved = data.axis_selected_tabs || [];
    try {
      const allTabs = await chrome.tabs.query({});
      const openIds = new Set(allTabs.map(t => t.id));
      selectedTabs = saved.filter(t => openIds.has(t.id));
    } catch { selectedTabs = []; }
    renderTabPills();
  });
}

function renderTabPills() {
  // Pills UI removed per new UX
  if (tabPillsEl) tabPillsEl.innerHTML = '';
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

if (addTabsBtn) {
  addTabsBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!tabDropdown.classList.contains('hidden')) {
      tabDropdown.classList.add('hidden');
      return;
    }
    // Populate dropdown with open tabs
    const allTabs = await chrome.tabs.query({});
    const selIds = new Set(selectedTabs.map(t => t.id));
    tabDropdown.innerHTML = '';
    for (const tab of allTabs) {
      if (isRestrictedUrl(tab.url)) continue;
      const isRestricted = selIds.has(tab.id);
      const item = document.createElement('div');
      item.className = 'tab-dropdown-item';
      const checkClass = isRestricted ? 'tab-check checked' : 'tab-check';
      const favicon = tab.favIconUrl ? `<img src="${escapeAttr(tab.favIconUrl)}" alt="" title="${escapeAttr(tab.title)}">` : `<span style="width:16px" title="${escapeAttr(tab.title)}"></span>`;
      item.innerHTML = `<span class="${checkClass}"></span>${favicon}<span class="tab-title">${escapeHtml((tab.title || '').slice(0, 50))}</span>`;
      item.addEventListener('click', () => {
        const idx = selectedTabs.findIndex(t => t.id === tab.id);
        const checkIcon = item.querySelector('.tab-check');

        if (idx >= 0) {
          selectedTabs.splice(idx, 1);
          if (checkIcon) checkIcon.classList.remove('checked');
          chrome.storage.session.set({ axis_selected_tabs: selectedTabs });
          showToast(`${tab.title || 'Tab'} unrestricted`);
        } else {
          selectedTabs.push({ id: tab.id, title: tab.title || '', url: tab.url || '', favIconUrl: tab.favIconUrl || '' });
          if (checkIcon) checkIcon.classList.add('checked');
          chrome.storage.session.set({ axis_selected_tabs: selectedTabs });
          showToast(`${tab.title || 'Tab'} restricted`);
        }

        // Immediate sync with backend
        chrome.tabs.get(Number(currentTabId), (t) => {
          if (!chrome.runtime.lastError && t) sendPageContext(t);
        });
      });
      tabDropdown.appendChild(item);
    }
    tabDropdown.classList.remove('hidden');
  });
}
// Close tab dropdown on outside click
document.addEventListener('click', (e) => {
  if (tabDropdown && !tabDropdown.contains(e.target) && e.target !== addTabsBtn && !addTabsBtn?.contains(e.target)) {
    tabDropdown.classList.add('hidden');
  }
});

// Chat restrict tabs button logic
if (chatAddTabsBtn) {
  chatAddTabsBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!chatTabDropdown.classList.contains('hidden')) {
      chatTabDropdown.classList.add('hidden');
      return;
    }
    // Populate dropdown with open tabs
    const allTabs = await chrome.tabs.query({});
    const selIds = new Set(selectedTabs.map(t => t.id));
    chatTabDropdown.innerHTML = '';
    for (const tab of allTabs) {
      if (isRestrictedUrl(tab.url)) continue;
      const isRestricted = selIds.has(tab.id);
      const item = document.createElement('div');
      item.className = 'tab-dropdown-item';
      const check = document.createElement('span');
      check.className = isRestricted ? 'tab-check checked' : 'tab-check';
      const favicon = tab.favIconUrl ? `<img src="${escapeAttr(tab.favIconUrl)}" alt="" title="${escapeAttr(tab.title)}">` : `<span style="width:16px" title="${escapeAttr(tab.title)}"></span>`;
      item.innerHTML = `${favicon}<span class="tab-title">${escapeHtml((tab.title || '').slice(0, 50))}</span>`;
      item.prepend(check);
      item.addEventListener('click', (ev) => {
        const idx = selectedTabs.findIndex(t => t.id === tab.id);
        if (idx >= 0) {
          selectedTabs.splice(idx, 1);
          check.classList.remove('checked');
          chrome.storage.session.set({ axis_selected_tabs: selectedTabs });
          showChatToast(`${tab.title || 'Tab'} unrestricted`);
        } else {
          selectedTabs.push({ id: tab.id, title: tab.title || '', url: tab.url || '', favIconUrl: tab.favIconUrl || '' });
          check.classList.add('checked');
          chrome.storage.session.set({ axis_selected_tabs: selectedTabs });
          showChatToast(`${tab.title || 'Tab'} restricted`);
        }

        // Immediate sync with backend
        chrome.tabs.get(Number(currentTabId), (t) => {
          if (!chrome.runtime.lastError && t) sendPageContext(t);
        });
      });
      chatTabDropdown.appendChild(item);
    }
    chatTabDropdown.classList.remove('hidden');
  });
}

// (Screenshot mode feature removed — agent handles screenshots via predictive caching)

// ---------------------------------------------------------------------------
// Go Live / End Session / Hold
// ---------------------------------------------------------------------------
goLiveBtn.addEventListener('click', async () => {
  // Guard: ignore repeat clicks while a session is already actively listening.
  // (Checks isListening, not just micStream — micStream can theoretically be
  // set mid-setup before isListening flips true; stopMicOnly() also now
  // guarantees micStream is cleared whenever isListening is false.)
  if (isListening) {
    console.warn('[Axis] Go Live clicked while mic already active - ignoring.');
    return;
  }
  const hasPermission = await checkMicPermission();
  if (!hasPermission) return;

  const isLimited = await checkUsageLimit();
  if (isLimited) return;

  sessionEnding = false;
  if (idleTextInput) idleTextInput.value = '';
  clearTranscript();
  switchView('live');
  startListening();
  showSilenceDots();
});

async function checkMicPermission() {
  try {
    // navigator.permissions API might not be available or support 'microphone' in all contexts
    const result = await navigator.permissions.query({ name: 'microphone' });
    if (result.state === 'granted') return true;

    if (result.state === 'denied') {
      handleStatusMessage({
        type: 'status',
        level: 'error',
        message: 'Microphone access is blocked. Please open the extension settings and allow microphone access.'
      });
      return false;
    }

    // Attempt to trigger prompt directly
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch (e) {
      // Direct prompt failed (common in sidepanels), use tab fallback
      handleStatusMessage({
        type: 'status',
        level: 'info',
        message: 'Opening permission request tab...'
      });
      chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/permission.html') });
      return false;
    }
  } catch (err) {
    // Fallback if navigator.permissions.query fails
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    } catch (e) {
      chrome.tabs.create({ url: chrome.runtime.getURL('sidepanel/permission.html') });
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared idle-command submission (used by Enter key, quick chips, history)
// ---------------------------------------------------------------------------
async function submitIdleCommand(text) {
  text = (text || '').trim();
  if (!text) return;

  const isLimited = await checkUsageLimit();
  if (isLimited) return;

  if (idleTextInput) idleTextInput.value = '';
  hideHistoryPanel();
  openChatSession(text);
}

// Enter key in idle text input → open chat session
if (idleTextInput) {
  idleTextInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitIdleCommand(idleTextInput.value);
    }
  });
}

// ---------------------------------------------------------------------------
// Quick Command Chips — one-tap shortcuts
// ---------------------------------------------------------------------------
document.querySelectorAll('.quick-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const cmd = btn.getAttribute('data-cmd');
    if (cmd) submitIdleCommand(cmd);
  });
});

// ---------------------------------------------------------------------------
// Chat History — last 20 full conversations (command + agent result),
// click an entry to reopen the whole transcript, not just the prompt.
// ---------------------------------------------------------------------------
const SESSIONS_KEY = 'axis_chat_sessions';
const MAX_SESSIONS = 20;
const historyBtn = document.getElementById('history-btn');
const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');
const historyClearBtn = document.getElementById('history-clear-btn');

// Messages captured for the conversation currently open in the chat view.
let currentSessionMessages = [];

function sessionTimeStr(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

// Persist (create or update) the transcript for the conversation currently
// open in the chat view, keyed by chatSessionId.
function saveCurrentSession() {
  if (!chatSessionId || currentSessionMessages.length === 0) return;
  const firstUserMsg = currentSessionMessages.find((m) => m.role === 'user');
  const lastAgentMsg = [...currentSessionMessages].reverse().find((m) => m.role === 'agent');
  const record = {
    id: chatSessionId,
    updatedAt: Date.now(),
    title: firstUserMsg ? firstUserMsg.text : 'Chat',
    preview: lastAgentMsg ? lastAgentMsg.text : '',
    messages: currentSessionMessages.slice(),
  };
  chrome.storage.local.get([SESSIONS_KEY], (data) => {
    let list = Array.isArray(data[SESSIONS_KEY]) ? data[SESSIONS_KEY] : [];
    list = list.filter((s) => s.id !== record.id);
    list.unshift(record);
    if (list.length > MAX_SESSIONS) list = list.slice(0, MAX_SESSIONS);
    chrome.storage.local.set({ [SESSIONS_KEY]: list }, () => renderHistory(list));
  });
}

function renderHistory(list) {
  if (!historyList) return;
  historyList.innerHTML = '';
  if (!list || list.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No recent conversations yet</div>';
    return;
  }
  for (const session of list) {
    const item = document.createElement('div');
    item.className = 'history-item';

    const icon = document.createElement('span');
    icon.className = 'history-item-icon';
    icon.textContent = '↺';

    const body = document.createElement('div');
    body.className = 'history-item-body';

    const label = document.createElement('span');
    label.className = 'history-item-text';
    label.textContent = session.title || 'Chat';
    body.appendChild(label);

    if (session.preview) {
      const preview = document.createElement('span');
      preview.className = 'history-item-preview';
      preview.textContent = session.preview;
      body.appendChild(preview);
    }

    const time = document.createElement('span');
    time.className = 'history-item-time';
    time.textContent = sessionTimeStr(session.updatedAt);
    body.appendChild(time);

    item.appendChild(icon);
    item.appendChild(body);
    item.addEventListener('click', () => openSavedSession(session));
    historyList.appendChild(item);
  }
}

// Reopen a saved conversation: replays every past message (prompt AND
// result) into the chat view. Sending a new message afterwards starts a
// fresh backend session while keeping the prior transcript visible above it.
function openSavedSession(session) {
  closeChatWs();
  setChatBusy(false);
  chatSessionId = null; // no live backend session until the user sends something new
  chatSessionType = 'chat';
  currentSessionMessages = session.messages.slice();
  if (chatSessionTitle) chatSessionTitle.textContent = session.title || 'Chat';
  if (chatMessagesEl) {
    chatMessagesEl.innerHTML = '';
    for (const m of session.messages) {
      chatMessagesEl.appendChild(createChatMsg(m.role, m.text));
    }
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }
  switchView('chat');
  populateChatTabSelector();
  hideHistoryPanel();
}

function loadHistory() {
  chrome.storage.local.get([SESSIONS_KEY], (data) => {
    renderHistory(Array.isArray(data[SESSIONS_KEY]) ? data[SESSIONS_KEY] : []);
  });
}
loadHistory();

function showHistoryPanel() {
  historyPanel?.classList.remove('hidden');
}
function hideHistoryPanel() {
  historyPanel?.classList.add('hidden');
}

if (historyBtn) {
  historyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!historyPanel) return;
    historyPanel.classList.contains('hidden') ? showHistoryPanel() : hideHistoryPanel();
  });
}

// Close history panel on outside click
document.addEventListener('click', (e) => {
  if (!historyPanel || historyPanel.classList.contains('hidden')) return;
  if (!historyPanel.contains(e.target) && e.target !== historyBtn && !historyBtn?.contains(e.target)) {
    hideHistoryPanel();
  }
});

if (historyClearBtn) {
  historyClearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.storage.local.set({ [SESSIONS_KEY]: [] }, () => {
      renderHistory([]);
      showAxisToast('Chat history cleared', 'success');
    });
  });
}

function handleEndSession() {
  sessionEnding = true;
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'end_session' }));
  }
  stopListening();
  setTimeout(() => {
    if (ws) { ws.close(); ws = null; }
    
    // Reset state for a fresh session
    SESSION_ID = crypto.randomUUID();
    sessionEnding = false; // Allow fresh connection
    
    switchView('idle');
    clearTranscript();

    handleStatusMessage({
      type: 'status',
      level: 'info',
      message: 'Session Ended, please wait for new Live Session'
    });

    // Re-initiate "waiting" connection so "Go Live" re-enables
    if (currentUser) {
      chrome.storage.local.get(['pp_token'], (data) => {
        if (data.pp_token) {
          connectWS(currentUser.id, data.pp_token);
        }
      });
    }
  }, 500);
}

function handleHold() {
  if (isHolding) return;
  isHolding = true;
  holdBtn.textContent = '▶️';
  handleStatusMessage({
    type: 'status',
    level: 'info',
    message: 'Session on hold',
    persistent: true
  });
  stopMicOnly();
}

function handleResume() {
  if (!isHolding) return;
  isHolding = false;
  holdBtn.textContent = '⏸️';
  // Clear the persistent "on hold" banner by sending a new session resumed banner
  handleStatusMessage({
    type: 'status',
    level: 'info',
    message: 'Session resumed.'
  });
  startListening();
}

endSessionBtn.addEventListener('click', () => {
  handleEndSession();
});

holdBtn.addEventListener('click', () => {
  if (isHolding) {
    handleResume();
  } else {
    handleHold();
  }
});

settingsBtn.addEventListener('click', () => {
  openSettings();
  updateUsageCounts();
});
settingsBackBtn.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

newSessionBtn.addEventListener('click', () => { resetSession(); });

// Persistent error reset button
const errorResetBtn = document.getElementById('error-reset-btn');
if (errorResetBtn) {
  errorResetBtn.addEventListener('click', () => { resetSession(); });
}

function resetSession() {
  SESSION_ID = crypto.randomUUID();
  clearTranscript();
  closeSettings();
  document.getElementById('error-modal')?.classList.add('hidden');

  if (currentView === 'live') {
    switchView('idle');
    stopListening();
  }
  // Reconnect with new session
  if (currentUser) {
    chrome.storage.local.get(['pp_token'], (data) => {
      if (data.pp_token) {
        disconnectWS();
        connectWS(currentUser.id, data.pp_token);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Usage Limits
// ---------------------------------------------------------------------------
function updateUsageUI(counts) {
  const inputCount = counts.input_count || 0;
  const imageCount = counts.image_count || 0;
  const inputLimit = counts.input_limit || 150;
  const imageLimit = counts.image_limit || 5;

  if (inputUsageText) inputUsageText.textContent = `${inputCount} / ${inputLimit}`;
  if (imageUsageText) imageUsageText.textContent = `${imageCount} / ${imageLimit}`;

  if (inputUsageBar) {
    const inputWidth = Math.min(100, (inputCount / inputLimit) * 100);
    inputUsageBar.style.width = `${inputWidth}%`;
  }
  if (imageUsageBar) {
    const imageWidth = Math.min(100, (imageCount / imageLimit) * 100);
    imageUsageBar.style.width = `${imageWidth}%`;
  }

  // Update Dashboard View if available
  if (usageCommandsRemaining) usageCommandsRemaining.textContent = `${inputCount} / ${inputLimit}`;
  if (usageImagesRemaining) usageImagesRemaining.textContent = `${imageCount} / ${imageLimit}`;
  
  if (usageCommandsSubtext) usageCommandsSubtext.textContent = `${inputCount} commands used out of ${inputLimit}`;
  if (usageImagesSubtext) usageImagesSubtext.textContent = `${imageCount} of ${imageLimit} image generations used`;

  if (usageCommandsFill) {
    const p = (inputCount / inputLimit) * 100;
    usageCommandsFill.style.width = `${p}%`;
    usageCommandsFill.className = 'usage-progress-bar-fill ' + getUsageColorClass(p);
  }
  if (usageImagesFill) {
    const p = (imageCount / imageLimit) * 100;
    usageImagesFill.style.width = `${p}%`;
    usageImagesFill.className = 'usage-progress-bar-fill ' + getUsageColorClass(p);
  }
}

function getUsageColorClass(percentage) {
  if (percentage < 70) return 'safe';
  if (percentage < 90) return 'warning';
  return 'danger';
}

function showUsageView() {
  switchView('usage');
  loadUsageCounts();
}

async function loadUsageCounts() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${BACKEND_HTTP}/user-counts/${currentUser.id}`);
    if (!res.ok) throw new Error("Fetch failed");
    const data = await res.json();
    updateUsageUI(data);
  } catch (e) {
    console.error("Failed to load usage counts:", e);
    if (usageCommandsRemaining) usageCommandsRemaining.textContent = "Unable to load";
    if (usageImagesRemaining) usageImagesRemaining.textContent = "Unable to load";
  }
}

function showLimitView(counts) {
  updateUsageUI(counts);
  switchView('limit');
}

async function checkUsageLimit() {
  if (!currentUser) return false;
  try {
    const res = await fetch(`${BACKEND_HTTP}/user-counts/${currentUser.id}`);
    const data = await res.json();
    updateUsageUI(data);

    const inputLimit = data.input_limit || 150;
    const imageLimit = data.image_limit || 5;
    if (data.input_count >= inputLimit || data.image_count >= imageLimit) {
      showLimitView(data);
      return true;
    }
    return false;
  } catch (e) {
    console.error("Check usage limit failed:", e);
    return false; 
  }
}

async function updateUsageCounts() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${BACKEND_HTTP}/user-counts/${currentUser.id}`);
    const data = await res.json();
    updateUsageUI(data);
    // Silent update, do not switch view
  } catch (e) {
    console.error("Failed to update usage counts:", e);
  }
}

if (limitBackBtn) {
  limitBackBtn.addEventListener('click', () => {
    switchView('idle');
  });
}

// Usage Dashboard Listeners
if (usageSettingsBtn) {
  usageSettingsBtn.addEventListener('click', showUsageView);
}
if (usageBackBtn) {
  usageBackBtn.addEventListener('click', () => {
    switchView('settings');
  });
}
if (usageRequestBtn) {
  usageRequestBtn.addEventListener('click', () => {
    const feedbackView = document.getElementById('view-feedback');
    if (feedbackView) {
      // Hide usage, show feedback
      viewUsage.classList.remove('open');
      feedbackView.classList.add('open');
      // Pre-select 'Limit Increase'
      const typeSelect = document.getElementById('feedback-type');
      if (typeSelect) typeSelect.value = 'Limit Increase';
    }
  });
}

// Theme toggle
themeToggle.addEventListener('change', () => {
  document.body.classList.toggle('theme-light', themeToggle.checked);
});

// Image Modal Listeners
if (imageModal) {
  modalCloseBtn.onclick = closeModal;
  imageModal.onclick = (e) => {
    if (e.target === imageModal) closeModal();
  };
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal.classList.contains('visible')) {
      closeModal();
    }
  });
}

function openModal(src) {
  if (!imageModal || !modalImage) return;
  modalImage.src = src;
  imageModal.classList.add('visible');

  // Set up modal download
  modalDownloadBtn.onclick = () => downloadImage(src);
}

function closeModal() {
  if (imageModal) imageModal.classList.remove('visible');
}

function downloadImage(dataUrl) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `axis-vision-${timestamp}.png`;
  link.click();
}

// ---------------------------------------------------------------------------
// Mic — captures directly in sidepanel (extension origin, single permission)
// ---------------------------------------------------------------------------
async function startListening() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    micAudioContext = new AudioContext({ sampleRate: 16000 });
    const source = micAudioContext.createMediaStreamSource(micStream);

    const workletUrl = chrome.runtime.getURL('content/pcm-processor.js');
    await micAudioContext.audioWorklet.addModule(workletUrl);

    micWorkletNode = new AudioWorkletNode(micAudioContext, 'pcm-processor');
    micWorkletNode.port.onmessage = (e) => {
      if (e.data.type === 'audio_data' && ws?.readyState === WebSocket.OPEN && !sessionEnding) {
        ws.send(e.data.buffer);
      }
    };

    source.connect(micWorkletNode);
    // micWorkletNode.connect(micAudioContext.destination); // REMOVED to prevent echo loopback

    isListening = true;

    // Notify user that agent is live and ready for mic input
    handleStatusMessage({
      type: 'status',
      level: 'info',
      message: 'Please use earphones for better experience'
    });
  } catch (err) {
    console.error('[Axis] Mic start failed:', err.message);
    // IMPORTANT: fully tear down any partially-acquired mic/audio state on
    // failure. Without this, micStream can be left set even though setup
    // never completed (isListening stays false), which permanently blocks
    // every future "Go Live" click via the `if (micStream)` guard until the
    // extension is reloaded.
    stopMicOnly();
    handleStatusMessage({
      type: 'status',
      level: 'error',
      message: 'Could not start the microphone. Please try again.'
    });
  }
}

function stopListening() {
  stopMicOnly();
  isListening = false;
  isHolding = false;
  holdBtn.textContent = '⏸️';
}

function stopMicOnly() {
  if (micWorkletNode) {
    micWorkletNode.disconnect();
    micWorkletNode = null;
  }
  if (micAudioContext) {
    micAudioContext.close();
    micAudioContext = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  isListening = false;
}

// ---------------------------------------------------------------------------
// Audio playback with small Jitter Buffer
// ---------------------------------------------------------------------------
const playbackCtx = new AudioContext({ sampleRate: 24000 });
let nextPlayTime = 0;
const JITTER_BUFFER_MS = 150; // Delay playback by 150ms to absorb network jitter

// Analyser for agent audio output
const playbackAnalyser = playbackCtx.createAnalyser();
playbackAnalyser.fftSize = 128;
playbackAnalyser.connect(playbackCtx.destination);

function playAudio(base64Data) {
  try {
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const samples = new Int16Array(bytes.buffer);
    schedulePlayback(samples);
  } catch (e) { /* silent */ }
}

function playAudioBinary(arrayBuffer) {
  try {
    const samples = new Int16Array(arrayBuffer);
    schedulePlayback(samples);
  } catch (e) { /* silent */ }
}

function stopAllAudio() {
  activeSources.forEach(s => {
    try { s.stop(); } catch (e) { /* ignore */ }
  });
  activeSources = [];
  nextPlayTime = 0; // Reset scheduling clock
}

function schedulePlayback(samples) {
  const buffer = playbackCtx.createBuffer(1, samples.length, 24000);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768.0;

  const source = playbackCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(playbackAnalyser);

  // Track source for potential interruption
  activeSources.push(source);
  source.onended = () => {
    activeSources = activeSources.filter(s => s !== source);
  };

  const now = playbackCtx.currentTime;

  // Initialize nextPlayTime if it's in the past
  if (nextPlayTime < now) {
    // Add jitter buffer delay on the first chunk of a potential new stream
    nextPlayTime = now + (JITTER_BUFFER_MS / 1000);
  }

  source.start(nextPlayTime);
  nextPlayTime += buffer.duration;
}

// ---------------------------------------------------------------------------
// Audio Visualizer (AudioAnalyser-based)
// ---------------------------------------------------------------------------
const liveCtx = liveCanvas.getContext('2d');

// Rounded-rect helper for glowing bars
function _visRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Live visualizer — multi-bar frequency display with per-bar color glow
function drawLiveVisualizer() {
  const w = liveCanvas.width;
  const h = liveCanvas.height;
  liveCtx.clearRect(0, 0, w, h);
  const bars = 48;
  const barW = (w / bars) * 0.6;
  const gap = w / bars;

  const dataArray = new Uint8Array(playbackAnalyser.frequencyBinCount);
  playbackAnalyser.getByteFrequencyData(dataArray);

  liveCtx.save();

  for (let i = 0; i < bars; i++) {
    const idx = Math.floor(i * dataArray.length / bars);
    const amp = dataArray[idx] / 255;
    const barH = Math.max(h * amp * 0.85, 3);
    const x = i * gap + (gap - barW) / 2;
    const y = (h - barH) / 2;

    // Sweep hue across the bar spread — cyan -> indigo -> violet -> pink
    const hue = 190 + (i / bars) * 150;
    const lightness = 55 + amp * 20;
    const glowColor = `hsl(${hue}, 92%, ${lightness}%)`;

    liveCtx.shadowBlur = 6 + amp * 14;
    liveCtx.shadowColor = glowColor;

    const grad = liveCtx.createLinearGradient(x, y, x, y + barH);
    grad.addColorStop(0, `hsla(${hue}, 95%, 72%, 0.95)`);
    grad.addColorStop(1, `hsla(${hue + 25}, 90%, 48%, 0.85)`);
    liveCtx.fillStyle = grad;

    _visRoundRect(liveCtx, x, y, barW, barH, 3);
    liveCtx.fill();
  }

  liveCtx.restore();
  requestAnimationFrame(drawLiveVisualizer);
}
drawLiveVisualizer();

// ---------------------------------------------------------------------------
// Chat Bubbles — bottom-to-top stacking, no fading
// ---------------------------------------------------------------------------
const MAX_BUBBLES = 50;
let lastBubbleRole = null;
let lastBubbleEl = null;

function showTranscript(text, role, isFinal) {
  if (!chatContainer) return;

  // If partial: append delta to active bubble for same role
  if (!isFinal) {
    if (lastBubbleEl && lastBubbleRole === role && lastBubbleEl.classList.contains('partial')) {
      // Manage spacing between word chunks
      const current = lastBubbleEl.textContent;
      const separator = (current && !current.endsWith(' ') && !text.startsWith(' ')) ? ' ' : '';
      lastBubbleEl.textContent += separator + text;
    } else {
      // Create a new partial bubble
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${role} partial`;
      bubble.textContent = text;
      chatContainer.appendChild(bubble);
      lastBubbleEl = bubble;
      lastBubbleRole = role;
    }
  }
  // If final: overwrite active partial bubble with cumulative string, then seal
  else {
    if (lastBubbleEl && lastBubbleRole === role && lastBubbleEl.classList.contains('partial')) {
      lastBubbleEl.textContent = text;
      lastBubbleEl.classList.remove('partial');
    } else {
      // Create a new final bubble if no active partial existed
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${role}`;
      bubble.textContent = text;
      chatContainer.appendChild(bubble);
    }
    // Seal bubble (next transcript creates a new one)
    lastBubbleRole = null;
    lastBubbleEl = null;
  }

  // Scroll to bottom — but only if the user hasn't scrolled up to read
  // earlier messages. Otherwise a new bubble mid-read would yank them
  // back down. They can hit the down-arrow (or scroll down themselves)
  // to re-pin.
  if (typeof liveAutoScrollPinned === 'undefined' || liveAutoScrollPinned) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // De-spawn old bubbles at the top when exceeding max
  while (chatContainer.children.length > MAX_BUBBLES) {
    const oldest = chatContainer.firstElementChild;
    // Remove immediately to prevent infinite while loop if animationend hasn't fired
    oldest.remove();
  }
}

function clearTranscript() {
  if (chatContainer) chatContainer.innerHTML = '';
  lastBubbleRole = null;
  lastBubbleEl = null;
}

// Legacy stubs
function showSilenceDots() { }
function clearEphemeral() { clearTranscript(); }

// ---------------------------------------------------------------------------
// Drag & Drop File Upload
// ---------------------------------------------------------------------------
const liveView = document.getElementById('view-live');
const dropOverlay = document.getElementById('drop-overlay');

liveView.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropOverlay.classList.add('visible');
});

liveView.addEventListener('dragleave', () => {
  dropOverlay.classList.remove('visible');
});

liveView.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropOverlay.classList.remove('visible');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  await handleFileUpload(file);
});

async function handleFileUpload(file) {
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB
  if (file.size > MAX_SIZE) {
    showToast('File too large. Max 5MB.');
    return;
  }

  const allowed = [
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  if (!allowed.includes(file.type)) {
    showToast('Unsupported file type.');
    return;
  }

  showToast(`Uploading ${file.name}...`);

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'file_upload',
        session_id: SESSION_ID,
        filename: file.name,
        mime_type: file.type,
        size: file.size,
        data: base64
      }));
    }
  };
  reader.readAsDataURL(file);
}

function showToast(msg) {
  showAxisToast(msg, inferToastType(msg));
}

function showChatToast(msg) {
  showAxisToast(msg, inferToastType(msg));
}

// ---------------------------------------------------------------------------
// Drag & Drop for Chat view
// ---------------------------------------------------------------------------
if (viewChat) {
  viewChat.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (chatDropOverlay) chatDropOverlay.classList.add('visible');
  });
  viewChat.addEventListener('dragleave', () => {
    if (chatDropOverlay) chatDropOverlay.classList.remove('visible');
  });
  viewChat.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (chatDropOverlay) chatDropOverlay.classList.remove('visible');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    await handleChatFileUpload(file);
  });
}

async function handleChatFileUpload(file) {
  const MAX_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_SIZE) { showChatToast('File too large. Max 5MB.'); return; }
  const allowed = [
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  if (!allowed.includes(file.type)) { showChatToast('Unsupported file type.'); return; }
  showChatToast(`Uploading ${file.name}...`);
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    // For chat, send as a chat message with the file context
    if (chatSessionId && currentUser) {
      sendChatMessage(`[Attached file: ${file.name}]`);
    } else if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'file_upload', session_id: SESSION_ID,
        filename: file.name, mime_type: file.type, size: file.size, data: base64
      }));
    }
  };
  reader.readAsDataURL(file);
}

// ---------------------------------------------------------------------------
// REST API calls — Recent Sessions
// ---------------------------------------------------------------------------
async function fetchRecentSessions(userId) {
  try {
    const resp = await fetch(`${BACKEND_HTTP}/users/${encodeURIComponent(userId)}/sessions?limit=10`);
    if (!resp.ok) throw new Error('Failed');
    return await resp.json();
  } catch (e) {
    return [];
  }
}

async function fetchSessionTranscript(userId, sessionId) {
  try {
    const resp = await fetch(`${BACKEND_HTTP}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}/transcript`);
    if (!resp.ok) throw new Error('Failed');
    return await resp.json();
  } catch (e) {
    return [];
  }
}

async function deleteSession(userId, sessionId) {
  const resp = await fetch(`${BACKEND_HTTP}/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error('Delete failed');
  return await resp.json();
}

function relativeTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

async function loadRecentSessions() {
  if (!currentUser) return;
  recentSessionsDiv.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  const sessions = await fetchRecentSessions(currentUser.id);
  recentSessionsDiv.innerHTML = '';
  if (!sessions.length) {
    recentSessionsDiv.innerHTML = '<div class="session-empty">No recent sessions</div>';
    return;
  }
  for (const s of sessions) {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.dataset.sessionId = s.session_id;
    const urlShort = s.page_url ? (() => { try { return new URL(s.page_url).hostname; } catch { return s.page_url; } })() : '';
    const sessionType = s.session_type || 'live';
    const typeBadge = sessionType === 'chat'
      ? '<span class="session-type-badge chat">💬 Chat</span>'
      : '<span class="session-type-badge live">🎙 Live</span>';
    card.innerHTML = `
      <div class="session-card-left">
        <div class="session-headline">${escapeHtml(s.session_headline || 'Session')}</div>
        <div class="session-url">${escapeHtml(urlShort)}</div>
        <div class="session-time">${relativeTime(s.started_at)} ${typeBadge}</div>
      </div>
      <button class="session-delete" title="Delete">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>`;

    // Click card → show popup then resume session
    card.querySelector('.session-card-left').addEventListener('click', async () => {
      // Show popup
      if (sessionResumePopup) {
        sessionResumePopup.classList.remove('hidden');
        setTimeout(() => sessionResumePopup.classList.add('hidden'), 2200);
      }
      const transcript = await fetchSessionTranscript(currentUser.id, s.session_id);
      closeSettings();
      setTimeout(() => {
        resumeSession(s, transcript);
      }, 800);
    });

    // Delete button
    card.querySelector('.session-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      card.remove(); // optimistic
      try {
        await deleteSession(currentUser.id, s.session_id);
      } catch {
        // Re-add on failure
        card.classList.add('error');
        recentSessionsDiv.prepend(card);
        setTimeout(() => card.classList.remove('error'), 1000);
      }
    });

    recentSessionsDiv.appendChild(card);
  }
}

function resumeSession(sessionMeta, transcript) {
  const sessionType = sessionMeta.session_type || 'live';
  if (sessionType === 'chat') {
    // Show chat view with read-only transcript
    switchView('chat');
    if (chatSessionTitle) chatSessionTitle.textContent = sessionMeta.session_headline || 'Chat';
    chatSessionId = sessionMeta.session_id;
    if (chatMessagesEl) {
      chatMessagesEl.innerHTML = '';
      for (const msg of transcript) {
        chatMessagesEl.appendChild(createChatMsg(msg.role, msg.text));
      }
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }
  } else {
    // Live session — show transcript in live view (read-only)
    switchView('live');
    clearTranscript();
    for (const msg of transcript) {
      showTranscript(msg.text, msg.role, true);
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// About Axis panel
// ---------------------------------------------------------------------------
const viewAbout = document.getElementById('view-about');
const aboutAxisBtn = document.getElementById('about-axis-btn');
const aboutBackBtn = document.getElementById('about-back-btn');

function openAbout() { viewAbout.classList.add('open'); }
function closeAbout() { viewAbout.classList.remove('open'); }

aboutAxisBtn.addEventListener('click', openAbout);
if (aboutBackBtn) aboutBackBtn.addEventListener('click', closeAbout);

// ---------------------------------------------------------------------------
// Chat Session (WebSocket-based with full tool access)
// ---------------------------------------------------------------------------

function closeChatWs() {
  if (chatWs) {
    try { chatWs.send(JSON.stringify({ type: 'end_session' })); } catch { }
    chatWs.close();
    chatWs = null;
  }
}

async function openChatSession(initialMessage) {
  // Close any existing chat WS
  closeChatWs();
  setChatBusy(false);

  chatSessionId = crypto.randomUUID();
  chatSessionType = 'chat';
  if (chatSessionTitle) chatSessionTitle.textContent = 'Chat';
  if (chatMessagesEl) chatMessagesEl.innerHTML = '';
  switchView('chat');
  populateChatTabSelector();

  if (!currentUser) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = String(tab?.id || '');

  // Open WebSocket for chat (full tool access)
  chatWs = new WebSocket(BACKEND_WS_CHAT + chatSessionId);

  chatWs.onopen = () => {
    console.log('[Axis] Chat WS connected');
  };

  chatWs.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'ready') {
      // Send auth
      chatWs.send(JSON.stringify({
        type: 'auth',
        user_id: currentUser.id,
        email: currentUser?.email || '',
        display_name: currentUser?.name || '',
        tab_id: currentTabId,
        page_url: tab?.url || '',
        page_title: tab?.title || '',
      }));
      sendPageContext(tab, chatWs);
    } else if (msg.type === 'status' && msg.message === 'authenticated') {
      console.log('[Axis] Chat WS authenticated');
      // Send initial message if any
      if (initialMessage) {
        sendChatMessage(initialMessage);
        initialMessage = null;
      }
    } else if (msg.type === 'chat_thinking') {
      // Agent is processing — show the animated typing indicator
      if (!chatMessagesEl.querySelector('.typing-indicator')) {
        chatMessagesEl.appendChild(createTypingIndicator());
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }
    } else if (msg.type === 'chat_response') {
      // Replace the typing indicator with the rendered markdown response
      const typing = chatMessagesEl.querySelector('.typing-indicator');
      if (typing) typing.remove();
      chatMessagesEl.appendChild(createChatMsg('agent', msg.text || 'Done.'));
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      setChatBusy(false);
    } else {
      // Delegate tool bridge messages (screenshot, DOM, browser action requests)
      handleMessage(msg, chatWs);
    }
  };

  chatWs.onerror = () => {
    console.error('[Axis] Chat WS error');
    setChatBusy(false);
  };

  chatWs.onclose = () => {
    console.log('[Axis] Chat WS closed');
    chatWs = null;
    setChatBusy(false);
  };
}

function setChatBusy(busy) {
  isChatBusy = busy;
  if (chatSendBtn) chatSendBtn.disabled = busy;
  if (chatTextInput) chatTextInput.disabled = busy;
  document.querySelectorAll('.quick-chip').forEach((btn) => { btn.disabled = busy; });
}

async function sendChatMessage(text) {

    if (!text || !chatSessionId || !currentUser) return;

    if (isChatBusy) {
        // A previous command is still being processed — ignore this send
        // instead of letting responses interleave out of order in the chat.
        showToast('Please wait for the current response to finish');
        return;
    }

    // ==========================
    // Existing Backend Flow
    // ==========================

    if (!chatWs || chatWs.readyState !== WebSocket.OPEN) {
        console.error("[Axis] Chat WS not connected");
        return;
    }

    setChatBusy(true);

    chatMessagesEl.appendChild(createChatMsg("user", text));
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

    if (!chatMessagesEl.querySelector(".typing-indicator")) {
        chatMessagesEl.appendChild(createTypingIndicator());
    }

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;

    chatWs.send(JSON.stringify({
        type: "chat_message",
        text
    }));
}

// RAG document upload
if (ragUploadInput) {
  ragUploadInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Reset input
    e.target.value = '';

    // Verify limit 
    if (!await checkUsageLimit('input')) {
        showToast("Inputs limit reached. Upgrade to continue.", "error");
        return;
    }

    showToast("Uploading document for RAG indexing...", "info");
    
    // Fetch auth token / user ID (using default structure)
    chrome.storage.local.get(['axis_user_id'], async (res) => {
      const userId = res.axis_user_id || 'anonymous';
      
      const formData = new FormData();
      formData.append('user_id', userId);
      formData.append('file', file);
      
      try {
        const response = await fetch(`${BACKEND_HTTP}/upload-document`, {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
          showToast(`Document indexed successfully! (${data.chunks_added} chunks)`, "success");
          
          // Optionally add a user message to show it in chat
          chatMessagesEl.appendChild(createChatMsg("user", `Uploaded document: ${file.name}`));
          chatMessagesEl.appendChild(createChatMsg("assistant", "I've memorized that document for you. You can ask me questions about it!"));
          chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        } else {
          showToast(`Upload failed: ${data.error || 'Unknown error'}`, "error");
        }
      } catch (err) {
        console.error("RAG upload error:", err);
        showToast("Error uploading document.", "error");
      }
    });
  });
}

// Chat send button
if (chatSendBtn) {
  chatSendBtn.addEventListener('click', () => {
    const text = chatTextInput?.value.trim();
    if (!text) return;
    chatTextInput.value = '';
    sendChatMessage(text);
  });
}

// Chat Enter key
if (chatTextInput) {
  chatTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = chatTextInput.value.trim();
      if (!text) return;
      chatTextInput.value = '';
      sendChatMessage(text);
    }
  });
}

// Chat back button → idle
if (chatBackBtn) {
  chatBackBtn.addEventListener('click', () => {
    closeChatWs();
    switchView('idle');
  });
}

// New Chat button
if (newChatBtn) {
  newChatBtn.addEventListener('click', () => {
    openChatSession(null);
  });
}

// Chat scroll controls — jump to top/bottom, and only show once there's
// actually enough content to scroll.
if (chatScrollUpBtn) {
  chatScrollUpBtn.addEventListener('click', () => {
    chatMessagesEl.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
if (chatScrollDownBtn) {
  chatScrollDownBtn.addEventListener('click', () => {
    chatMessagesEl.scrollTo({ top: chatMessagesEl.scrollHeight, behavior: 'smooth' });
  });
}
if (chatMessagesEl && chatScrollControls) {
  const updateChatScrollControls = () => {
    const hasOverflow = chatMessagesEl.scrollHeight > chatMessagesEl.clientHeight + 40;
    chatScrollControls.classList.toggle('hidden', !hasOverflow);
    if (!hasOverflow) return;
    const atTop = chatMessagesEl.scrollTop < 20;
    const atBottom = chatMessagesEl.scrollTop + chatMessagesEl.clientHeight > chatMessagesEl.scrollHeight - 20;
    chatScrollUpBtn.disabled = atTop;
    chatScrollDownBtn.disabled = atBottom;
  };
  chatMessagesEl.addEventListener('scroll', updateChatScrollControls);
  new MutationObserver(updateChatScrollControls).observe(chatMessagesEl, { childList: true, subtree: true });
  updateChatScrollControls();
}

// Live view scroll controls — same idea as chat scroll controls above, but
// for the AXIS LIVE transcript (#chat-container). Also tracks whether the
// user has scrolled up so new bubbles don't yank them back to the bottom
// mid-read (see liveAutoScrollPinned, used by showTranscript()).
let liveAutoScrollPinned = true;
if (liveScrollUpBtn) {
  liveScrollUpBtn.addEventListener('click', () => {
    chatContainer.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
if (liveScrollDownBtn) {
  liveScrollDownBtn.addEventListener('click', () => {
    liveAutoScrollPinned = true;
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
  });
}
if (chatContainer && liveScrollControls) {
  const updateLiveScrollControls = () => {
    const hasOverflow = chatContainer.scrollHeight > chatContainer.clientHeight + 40;
    liveScrollControls.classList.toggle('hidden', !hasOverflow);
    const atTop = chatContainer.scrollTop < 20;
    const atBottom = chatContainer.scrollTop + chatContainer.clientHeight > chatContainer.scrollHeight - 20;
    liveAutoScrollPinned = atBottom;
    if (!hasOverflow) return;
    liveScrollUpBtn.disabled = atTop;
    liveScrollDownBtn.disabled = atBottom;
  };
  chatContainer.addEventListener('scroll', updateLiveScrollControls);
  new MutationObserver(updateLiveScrollControls).observe(chatContainer, { childList: true, subtree: true });
  updateLiveScrollControls();
}

// Chat tab selector — no pills, restriction is shown via toast only
async function populateChatTabSelector() {
  // No pills to render — tab restriction feedback is via toast popup
}

// Close chat tab dropdown on outside click
document.addEventListener('click', (e) => {
  if (chatTabDropdown && !chatTabDropdown.contains(e.target) && e.target !== chatAddTabsBtn && !chatAddTabsBtn?.contains(e.target)) {
    chatTabDropdown.classList.add('hidden');
  }
});

// ---------------------------------------------------------------------------
// Feedback panel
// ---------------------------------------------------------------------------
const viewFeedback = document.getElementById('view-feedback');
const sendFeedbackBtn = document.getElementById('send-feedback-btn');
const feedbackBackBtn = document.getElementById('feedback-back-btn');
const feedbackForm = document.getElementById('feedback-form');
const feedbackSuccess = document.getElementById('feedback-success');

function openFeedback() {
  viewFeedback.classList.add('open');
  feedbackForm.classList.remove('hidden');
  feedbackSuccess.classList.add('hidden');
}
function closeFeedback() { viewFeedback.classList.remove('open'); }

sendFeedbackBtn.addEventListener('click', openFeedback);
feedbackBackBtn.addEventListener('click', closeFeedback);

feedbackForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const type = document.getElementById('feedback-type').value;
  const subject = document.getElementById('feedback-subject').value.trim();
  const message = document.getElementById('feedback-message').value.trim();
  const name = document.getElementById('feedback-name').value.trim() || 'Anonymous';
  if (!subject || !message) return;

  const submitBtn = feedbackForm.querySelector('.btn-feedback-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending...';

  try {
    const resp = await fetch(`${BACKEND_HTTP}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedback_type: type,
        subject: subject,
        message: message,
        sender_name: name,
        user_email: currentUser?.email || '',
      }),
    });
    const result = await resp.json();
    if (result.success) {
      feedbackForm.classList.add('hidden');
      feedbackSuccess.textContent = 'Thank you for your valuable feedback!🥺';
      feedbackSuccess.classList.remove('hidden');
      feedbackForm.reset();
    } else {
      feedbackSuccess.textContent = 'Failed to send. Please try again later🥲.';
      feedbackSuccess.classList.remove('hidden');
    }
  } catch (err) {
    feedbackSuccess.textContent = 'Failed to send. Please try again later🥲.';
    feedbackSuccess.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Feedback';
  }
});

// ---------------------------------------------------------------------------
// Personalize Pilot settings
// ---------------------------------------------------------------------------
function showSaveConfirm() {
  const el = document.getElementById('settings-save-confirm');
  if (!el) return;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 1500);
}

const voiceSelect = document.getElementById('voice-select');
const personaSelect = document.getElementById('persona-select');
const customInstructionsEl = document.getElementById('custom-instructions');
const charCountEl = document.getElementById('char-count');
const saveInstructionsBtn = document.getElementById('save-instructions-btn');

if (voiceSelect) {
  voiceSelect.addEventListener('change', () => {
    selectedVoice = voiceSelect.value;
    chrome.storage.sync.set({ axis_voice: selectedVoice });
    showSaveConfirm();
  });
}

if (personaSelect) {
  personaSelect.addEventListener('change', () => {
    selectedPersona = personaSelect.value;
    chrome.storage.sync.set({ axis_persona: selectedPersona });
    showSaveConfirm();
  });
}

if (customInstructionsEl) {
  customInstructionsEl.addEventListener('input', () => {
    const len = customInstructionsEl.value.length;
    if (charCountEl) charCountEl.textContent = `${len}/500`;
  });
}

if (saveInstructionsBtn) {
  saveInstructionsBtn.addEventListener('click', () => {
    savedCustomInstructions = (customInstructionsEl?.value || '').slice(0, 500);
    chrome.storage.sync.set({ axis_custom_instructions: savedCustomInstructions });
    showSaveConfirm();
  });
}

// ---------------------------------------------------------------------------
// Image Generation DOM Helpers
// ---------------------------------------------------------------------------

/**
 * Shows a simple text bubble indicating image generation is in progress.
 */
function showGeneratingBubble(label) {
  // Generated content (code/image cards) renders wherever the user actually
  // asked for it — the Live transcript if they're on the Live tab, or the
  // persistent chat log if they're in the Chat tab.
  const container = currentView === 'chat' ? chatMessagesEl : chatContainer;
  if (!container) return null;

  // Dupe check
  if (document.querySelector('.generating-bubble')) return null;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble agent generating-bubble';
  bubble.textContent = label || 'Generating, please wait...';

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

/**
 * Replaces a generating bubble or ghost element with a rendered code card.
 */
function resolveCodeMessage(anchorEl, data) {
  if (!anchorEl) return;

  const card = document.createElement('div');
  card.className = 'code-message-card';

  const header = document.createElement('div');
  header.className = 'code-card-header';

  const langLabel = document.createElement('span');
  langLabel.className = 'code-card-lang';
  langLabel.textContent = data.language || 'code';
  header.appendChild(langLabel);

  const isMermaid = (data.language || '').trim().toLowerCase() === 'mermaid';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'code-copy-btn';
  copyBtn.textContent = 'Copy';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(data.code || '').then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  };
  header.appendChild(copyBtn);

  const pre = document.createElement('pre');
  const codeEl = document.createElement('code');
  codeEl.textContent = data.code || '';
  pre.appendChild(codeEl);

  card.appendChild(header);

  if (isMermaid) {
    card.classList.add('mermaid-card');

    // Toggle between rendered diagram and raw source.
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'code-copy-btn mermaid-toggle-btn';
    toggleBtn.textContent = 'View source';
    header.insertBefore(toggleBtn, copyBtn);

    const diagramWrap = document.createElement('div');
    diagramWrap.className = 'mermaid-diagram';
    diagramWrap.textContent = 'Rendering diagram…';

    pre.classList.add('hidden');

    card.appendChild(diagramWrap);
    card.appendChild(pre);

    toggleBtn.onclick = () => {
      const sourceCurrentlyHidden = pre.classList.contains('hidden');
      pre.classList.toggle('hidden', !sourceCurrentlyHidden);
      diagramWrap.classList.toggle('hidden', sourceCurrentlyHidden);
      toggleBtn.textContent = sourceCurrentlyHidden ? 'View diagram' : 'View source';
    };

    if (typeof mermaid === 'undefined') {
      diagramWrap.textContent = '';
      const err = document.createElement('div');
      err.className = 'mermaid-error';
      err.textContent = "Diagram renderer didn't load — showing source instead.";
      diagramWrap.appendChild(err);
      diagramWrap.classList.add('hidden');
      pre.classList.remove('hidden');
      toggleBtn.textContent = 'View diagram';
    } else {
      const renderId = `mermaid-render-${Date.now()}-${_mermaidRenderSeq++}`;
      mermaid.render(renderId, data.code || '')
        .then(({ svg }) => {
          diagramWrap.innerHTML = svg;
          if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        })
        .catch((err) => {
          console.error('Mermaid render failed:', err);
          diagramWrap.textContent = '';
          const errEl = document.createElement('div');
          errEl.className = 'mermaid-error';
          errEl.textContent = "Couldn't render this diagram — showing source instead.";
          diagramWrap.appendChild(errEl);
          diagramWrap.classList.add('hidden');
          pre.classList.remove('hidden');
          toggleBtn.textContent = 'View diagram';
        });
    }
  } else {
    card.appendChild(pre);
  }

  if (data.explanation) {
    const explanation = document.createElement('div');
    explanation.className = 'code-card-explanation';
    explanation.textContent = data.explanation;
    card.appendChild(explanation);
  }

  anchorEl.replaceWith(card);

  if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

/**
 * Replaces a generating bubble or ghost element with the actual generated image card.
 */
function resolveImageMessage(anchorEl, data) {
  if (!anchorEl) return;

  const card = document.createElement('div');
  card.className = 'image-message-card';

  const imgSrc = `data:${data.mime_type || 'image/png'};base64,${data.image_b64}`;
  const img = document.createElement('img');
  img.src = imgSrc;
  img.alt = data.caption || 'Generated image';

  // Open modal on click
  card.onclick = () => openModal(imgSrc);

  const footer = document.createElement('div');
  footer.className = 'image-card-footer';

  if (data.caption) {
    const caption = document.createElement('div');
    caption.className = 'image-caption';
    caption.textContent = data.caption;
    footer.appendChild(caption);
  }

  // Prompt text intentionally hidden from UI for cleaner look

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'image-download-btn';
  downloadBtn.textContent = 'Download';
  downloadBtn.onclick = (e) => {
    e.stopPropagation(); // Don't open modal
    downloadImage(imgSrc);
  };
  footer.appendChild(downloadBtn);

  card.appendChild(img);
  card.appendChild(footer);

  // Replace anchor with card
  anchorEl.replaceWith(card);

  // Scroll to bottom
  if (chatMessagesEl) chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}
/**
 * Handles real-time status updates from the backend.
 */
function handleStatusMessage(msg) {
  let container = document.getElementById('status-notification-container');
  // Use the live-status-container if we are in live view and it's NOT a fatal error
  if (currentView === 'live' && msg.level !== 'error') {
    const liveContainer = document.getElementById('live-status-container');
    if (liveContainer) {
      container = liveContainer;
      // Clear previous messages in live view to ensure only the latest status is visible
      container.innerHTML = '';
    }
  }

  if (!container) return;

  if (msg.level === 'error') {
    const modal = document.getElementById('error-modal');
    if (modal) {
      modal.classList.remove('hidden');
      const msgEl = document.getElementById('error-message');
      if (msgEl) msgEl.textContent = msg.message;
    }
    // Remove all warning banners if there's a fatal error
    container.innerHTML = '';
    return;
  }

  // Suppress "Ready to go Live!" messages during onboarding or sign-in
  const suppressedViews = ['onboarding', 'auth'];
  const isAuthScreen = screenAuth.classList.contains('active');
  const isReadyMsg = msg.message && msg.message.toLowerCase().includes('ready to go live');

  if (isReadyMsg && (currentView === 'onboarding' || isAuthScreen)) {
    deferredReadyMessage = true;
    return;
  }

  const banner = document.createElement('div');
  const level = msg.level || 'info';
  banner.className = `status-banner ${level}`;

  const icon = level === 'warning' ? '✦' : level === 'info' ? '✦' : '✦';

  let countdownPart = '';
  if (level === 'warning' && msg.countdown) {
    let timeLeft = msg.countdown;
    const isReconnecting = msg.message.toLowerCase().includes('reconnect') || msg.message === 'please wait...';

    if (isReconnecting && msg.retry_attempt !== undefined && msg.total_attempts !== undefined) {
      countdownPart = ` Retrying in <span class="countdown-num">${timeLeft}</span>s (Attempt ${msg.retry_attempt}/${msg.total_attempts})`;
    } else if (isReconnecting) {
      countdownPart = ` <span class="countdown-num">${timeLeft}</span>s`;
    } else {
      countdownPart = ` Retrying in <span class="countdown-num">${timeLeft}</span>s`;
    }

    // Local setInterval for countdown
    const interval = setInterval(() => {
      timeLeft--;
      const numEl = banner.querySelector('.countdown-num');
      if (numEl) numEl.textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(interval);
        if (isReconnecting && !isListening) {
          // If we reach 0 and still not listening, it's a failure
          // The backend will send a final error, but we want to make sure
        }
      }
    }, 1000);

    // Auto-remove warning banner just before retry/timeout (countdown + a bit)
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 300);
    }, (msg.countdown * 1000) - 200);
  }
  banner.innerHTML = `<span>${icon}</span> <span>${msg.message}${countdownPart}</span>`;
  container.appendChild(banner);

  // If not persistent and not a warning with countdown, auto-remove
  if (!msg.persistent && !(level === 'warning' && msg.countdown)) {
    setTimeout(() => {
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 300);
    }, 3500);
  }
}// ---------------------------------------------------------------------------
// Opening greeting — spoken welcome + animated "speaking" orb state
// ---------------------------------------------------------------------------
(function playOpeningGreeting() {
  const orbWrapper = document.querySelector('.idle-orb-wrapper');
  if (!orbWrapper) return;
  if (!('speechSynthesis' in window)) return;

  const GREETING_LINES = [
    "Hey, I'm here for you. What can I help with today?",
    "Hi there — I'm ready when you are.",
    "Hello! I'm listening, let's get started.",
  ];
  const greeting = GREETING_LINES[Math.floor(Math.random() * GREETING_LINES.length)];

  const utterance = new SpeechSynthesisUtterance(greeting);
  utterance.rate = 1.0;
  utterance.pitch = 1.05;
  utterance.volume = 0.9;

  utterance.onstart = () => {
    orbWrapper.classList.add('speaking');
  };
  utterance.onend = () => {
    orbWrapper.classList.remove('speaking');
  };
  utterance.onerror = () => {
    orbWrapper.classList.remove('speaking');
  };

  // Small delay so the panel finishes rendering before speaking starts
  setTimeout(() => {
    try {
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[Axis] Greeting speech failed:', e);
    }
  }, 400);
})();