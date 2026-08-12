// content/content.js
// WebMCP bridge + DOM interaction executor
// SECURITY: Never passes raw page text to backend (prompt injection defense)

// ---------------------------------------------------------------------------
// WebMCP API access — support both production and testing namespaces
// ---------------------------------------------------------------------------
function getModelContext() {
  return navigator.modelContext || navigator.modelContextTesting || null;
}

// ---------------------------------------------------------------------------
// Message listener — service worker / side panel relay
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get_webmcp_tools') {
    getWebMCPTools().then(sendResponse);
    return true; // async response
  }
  if (message.type === 'execute_webmcp') {
    executeWebMCPTool(message.tool_name, message.args).then(sendResponse);
    return true;
  }
  if (message.type === 'execute_dom') {
    executeDOMAction(message.selector, message.action, message.value).then(sendResponse);
    return true;
  }
  if (message.type === 'get_page_meta') {
    // Return ONLY structured metadata — never raw page text
    sendResponse({
      url: window.location.href,
      title: document.title,
    });
    return false;
  if (message.type === "get_page_context") {

    const selectedText = window.getSelection
        ? window.getSelection().toString()
        : "";

    sendResponse({

        success: true,

        context: {

            title: document.title,

            url: window.location.href,

            pageText: document.body.innerText,

            selectedText,

            html: document.documentElement.outerHTML,

            metadata: {

                language: document.documentElement.lang || "",

                description:
                    document.querySelector(
                        'meta[name="description"]'
                    )?.content || "",

                keywords:
                    document.querySelector(
                        'meta[name="keywords"]'
                    )?.content || ""

            }

        }

    });

    return false;
}
  }
  if (message.type === 'get_interactive_elements') {
    sendResponse(getInteractiveElements());
    return false;
  }
});

// ---------------------------------------------------------------------------
// WebMCP tools — check availability before every call
// ---------------------------------------------------------------------------
async function getWebMCPTools() {
  const ctx = getModelContext();
  if (!ctx) {
    return { available: false, tools: [] };
  }
  try {
    // Reference pattern: listTools() returns tool schemas
    const tools = typeof ctx.listTools === 'function'
      ? ctx.listTools()
      : (typeof ctx.getTools === 'function' ? await ctx.getTools() : []);
    return { available: true, tools: tools || [] };
  } catch (e) {
    return { available: false, tools: [], error: e.message };
  }
}

async function executeWebMCPTool(toolName, args) {
  const ctx = getModelContext();
  if (!ctx) {
    return { success: false, error: 'WebMCP not available on this page' };
  }
  try {
    // Reference pattern: executeTool(name, args)
    let result;
    if (typeof ctx.executeTool === 'function') {
      result = await ctx.executeTool(toolName, args);
    } else if (typeof ctx.callTool === 'function') {
      result = await ctx.callTool(toolName, args);
    } else {
      return { success: false, error: 'No WebMCP execution method available' };
    }
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Interactive element discovery — returns visible inputs, textareas, contenteditables
// ---------------------------------------------------------------------------
function getInteractiveElements() {
  const results = [];
  const seen = new Set();

  function describeText(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const img = el.querySelector?.('img[alt]');
    if (img?.getAttribute('alt')?.trim()) return img.getAttribute('alt').trim();
    return (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  }

  function pushEl(el, kind) {
    if (seen.has(el)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    seen.add(el);
    results.push({
      index: results.length,
      kind, // 'field' (form input) or 'clickable' (link/button/card)
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      text: describeText(el),
      href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
      placeholder: el.getAttribute('placeholder') || el.getAttribute('aria-label') || '',
      role: el.getAttribute('role') || '',
      contenteditable: el.isContentEditable,
      selector: buildSelector(el),
      position: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
    });
  }

  // Form fields — text inputs, textareas, editable/combobox regions
  document.querySelectorAll(
    'input:not([type="hidden"]), textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]'
  ).forEach((el) => pushEl(el, 'field'));

  // Clickable elements — links, buttons, cards (video thumbnails, search
  // results, nav items, etc). Without this, the agent has no way to find
  // e.g. "the video titled X" except by guessing a selector purely from a
  // screenshot, which fails whenever the element has no matching aria-label.
  document.querySelectorAll(
    'a[href], button, [role="button"], [role="link"], [onclick]'
  ).forEach((el) => pushEl(el, 'clickable'));

  // Cap payload size on link-heavy pages (e.g. search results feeds)
  return { success: true, elements: results.slice(0, 150) };
}

function buildSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
  if (el.getAttribute('aria-label')) return `[aria-label="${el.getAttribute('aria-label')}"]`;
  if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${el.getAttribute('name')}"]`;
  if (el.getAttribute('placeholder')) return `${el.tagName.toLowerCase()}[placeholder="${el.getAttribute('placeholder')}"]`;
  if (el.tagName === 'A' && el.getAttribute('href')) return `a[href="${CSS.escape(el.getAttribute('href'))}"]`;
  if (el.isContentEditable) {
    if (el.classList.contains('ProseMirror')) return 'div.ProseMirror[contenteditable="true"]';
    if (el.getAttribute('role') === 'textbox') return '[role="textbox"][contenteditable="true"]';
    return '[contenteditable="true"]';
  }
  return el.tagName.toLowerCase();
}

// Fallback selector cascade for typing into rich-text editors / reply boxes
const REPLY_BOX_SELECTORS = [
  'div.ProseMirror[contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
  'div[contenteditable="true"][data-placeholder]',
  'div[contenteditable="true"]',
  'textarea',
  'input[type="text"]:not([hidden])',
  'input:not([type]):not([hidden])',
];

// Search iframes recursively for an element
function findElement(selector) {
  // Try top-level document first
  let el = document.querySelector(selector);
  if (el) return el;

  // Search all iframes recursively
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) continue;
      el = doc.querySelector(selector);
      if (el) return el;

      // Nested iframes
      const nested = doc.querySelectorAll('iframe');
      for (const n of nested) {
        try {
          el = n.contentDocument?.querySelector(selector);
          if (el) return el;
        } catch {}
      }
    } catch {}
  }
  return null;
}

/**
 * Robustly escapes CSS selectors to handle special characters in utility classes (e.g., '/', ':').
 */
function sanitizeSelector(selector) {
  if (!selector) return '';
  // If it's a simple tag selector or already escaped, skip
  if (/^[a-zA-Z0-9-]+$/.test(selector)) return selector;
  
  try {
    // Only escape forward slashes logic. 
    // Brackets, dots, and colons are standard CSS syntax if constructured by the agent.
    // However, identifier-internal colons (Tailwind sm:p-4) would need escaping.
    // For now, removing the categorical escaping of [], ., and : fixes the reported 
    // bug where 'button[aria-label="Pause"]' becomes 'button\[aria-label="Pause"\]'.
    return selector.replace(/([/])/g, '\\$1');
  } catch (e) {
    return selector;
  }
}

function findElementWithFallback(selector) {
  // Try the given selector first (including iframes)
  let el = findElement(selector);
  if (el) return el;

  // Try smart partial matching for aria-label selectors
  const ariaExact = selector.match(/\[aria-label=["'](.+?)["']\]/);
  if (ariaExact) {
    const labelText = ariaExact[1].toLowerCase();
    // Try contains match
    const allWithLabel = document.querySelectorAll('[aria-label]');
    for (const candidate of allWithLabel) {
      const candidateLabel = (candidate.getAttribute('aria-label') || '').toLowerCase();
      if (candidateLabel.includes(labelText) || labelText.includes(candidateLabel)) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return candidate;
      }
    }
  }

  // Try matching by data-testid partial match
  const testIdMatch = selector.match(/\[data-testid=["'](.+?)["']\]/);
  if (testIdMatch) {
    const testId = testIdMatch[1].toLowerCase();
    const allWithTestId = document.querySelectorAll('[data-testid]');
    for (const candidate of allWithTestId) {
      if ((candidate.getAttribute('data-testid') || '').toLowerCase().includes(testId)) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return candidate;
      }
    }
  }

  // Try the fallback cascade (for reply boxes / text inputs)
  for (const fallback of REPLY_BOX_SELECTORS) {
    el = findElement(fallback);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Visibility helper — waits for element to be visible before interaction
// ---------------------------------------------------------------------------
async function waitForVisible(el, maxRetries = 3, delayMs = 200) {
  for (let i = 0; i < maxRetries; i++) {
    if (typeof el.checkVisibility === 'function') {
      if (el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
    } else {
      // Fallback for browsers without checkVisibility
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.opacity !== '0') return true;
    }
    if (i < maxRetries - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// DOM actions — fallback when WebMCP not available
// ---------------------------------------------------------------------------
async function executeDOMAction(selector, action, value) {
  try {
    // Page-level scroll actions — no element needed
    if (action === 'scroll_down') {
      const amount = parseInt(value) || 600;
      window.scrollBy({ top: amount, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 300));
      return { success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight };
    }
    if (action === 'scroll_up') {
      const amount = parseInt(value) || 600;
      window.scrollBy({ top: -amount, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 300));
      return { success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight };
    }
    if (action === 'scroll_to_top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 300));
      return { success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight };
    }
    if (action === 'scroll_to_bottom') {
      // Scroll in steps to trigger infinite scroll content loading
      for (let i = 0; i < 3; i++) {
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 500));
      }
      return { success: true, scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight };
    }

    // Sanitize selector before query (Priority 2)
    const sanitizedSelector = sanitizeSelector(selector);

    // Use smart fallback for type/click/press_enter actions on potential text inputs
    const el = (action === 'type' || action === 'click' || action === 'press_enter')
      ? findElementWithFallback(sanitizedSelector)
      : findElement(sanitizedSelector);
    if (!el) {
      return { success: false, error: 'Element not found: ' + (sanitizedSelector || selector) };
    }

    switch (action) {
      case 'click': {
        // Check visibility before clicking — retry up to 3 times
        const isVisible = await waitForVisible(el, 3, 200);
        if (!isVisible) {
          return { success: false, error: 'Element found but not visible: ' + selector };
        }

        // Heuristic: is this click likely meant to start video playback?
        // (the target itself is/contains a <video>, or the page already has
        // video elements — e.g. a thumbnail/play-button click on YouTube).
        const pageVideosBefore = Array.from(document.querySelectorAll('video'));
        const looksLikeVideoTrigger =
          el.tagName === 'VIDEO' ||
          !!el.closest('video') ||
          !!el.querySelector?.('video') ||
          pageVideosBefore.length > 0;

        const attemptClick = () => {
          try {
            if (typeof el.click === 'function') {
              el.click();
            } else {
              throw new Error('el.click is not a function');
            }
          } catch (e) {
            console.warn('[Axis] click() failed, falling back to MouseEvents:', e);
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
          }
        };

        const dispatchFullMouseSequence = () => {
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
        };

        const isAnyVideoPlaying = () =>
          Array.from(document.querySelectorAll('video')).some(v => !v.paused && v.currentTime > 0);

        attemptClick();
        await new Promise(r => setTimeout(r, 400));

        // If this looked like a video-play click and no video actually started,
        // retry once with a full synthetic mouse-event sequence — some players
        // (YouTube included) only react to a real pointerdown/up/click chain,
        // not a bare el.click().
        if (looksLikeVideoTrigger && !isAnyVideoPlaying()) {
          dispatchFullMouseSequence();
          await new Promise(r => setTimeout(r, 400));
        }

        // Only claim success on a video click if we can actually confirm a
        // video is playing — don't just trust that click() didn't throw.
        if (looksLikeVideoTrigger && document.querySelectorAll('video').length > 0 && !isAnyVideoPlaying()) {
          return {
            success: false,
            error: 'Clicked the element but no video started playing — it may not be the actual play control. Try screenshot_tool or get_interactive_elements to find the right target.',
          };
        }
        break;
      }
      case 'type': {
        const textToType = value || '';

        // Always clear existing content before typing
        el.focus();
        el.click();

        // Strategy 1: contenteditable elements (e.g. Claude.ai, rich text editors)
        if (el.isContentEditable) {
          // Clear existing content first
          el.innerHTML = '';
          el.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          
          if (document.execCommand('insertText', false, textToType)) {
            // execCommand successfully handled insertion and event dispatching on most sites
            break;
          } else {
            // Fallback for cases where execCommand fails
            el.textContent = textToType;
            el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: textToType, bubbles: true, cancelable: true }));
            el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          }
          break;
        }

        // Clear existing value for input/textarea fields
        if ('value' in el) {
          el.value = '';
        }
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);

        // Strategy 2: execCommand('insertText') for standard inputs
        if (el.select) el.select();
        try {
          if (document.execCommand('insertText', false, textToType)) {
            // Success, most frameworks will react to this automatically
            break;
          }
        } catch (ignore) { /* fall through */ }

        // Strategy 3: Click + set value via native setter + dispatch events (React-friendly)
        el.click();
        const proto = Object.getPrototypeOf(el);
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(el, textToType);
        } else {
          el.value = textToType;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
      case 'scroll':
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      case 'hover':
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        break;
      case 'select':
        if (el.tagName === 'SELECT') {
          el.value = value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        break;
      case 'press_enter': {
        // Submits a chat/message/search box after typing into it. Many chat
        // UIs (ChatGPT, Slack, WhatsApp Web, etc.) submit on a JS keydown
        // listener rather than native form submission, so a synthetic
        // Enter key sequence covers most of them.
        el.focus();
        const enterInit = {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true, composed: true,
        };
        el.dispatchEvent(new KeyboardEvent('keydown', enterInit));
        el.dispatchEvent(new KeyboardEvent('keypress', enterInit));
        el.dispatchEvent(new KeyboardEvent('keyup', enterInit));

        // Fallback: some UIs only listen for a real click on a dedicated
        // send/submit button, not a synthetic Enter. If the field still
        // has its value after a short beat, look for a nearby send button
        // and click it.
        await new Promise(r => setTimeout(r, 200));
        const stillHasValue = el.isContentEditable
          ? (el.textContent || '').trim().length > 0
          : ('value' in el && (el.value || '').trim().length > 0);
        if (stillHasValue) {
          const sendBtn = findElement(
            "button[type='submit'], button[aria-label*='send' i], button[data-testid*='send' i], "
            + "[role='button'][aria-label*='send' i], button[title*='send' i]",
          );
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
          }
        }
        break;
      }
      default:
        return { success: false, error: 'Unknown action: ' + action };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Notify service worker when WebMCP tools change on this page
// ---------------------------------------------------------------------------
(function observeWebMCPTools() {
  const ctx = getModelContext();
  if (!ctx) return;

  // Reference pattern: listen for tool changes
  if (typeof ctx.addEventListener === 'function') {
    ctx.addEventListener('toolchange', () => {
      getWebMCPTools().then((result) => {
        chrome.runtime.sendMessage({
          type: 'webmcp_tools_updated',
          tools: result.tools,
          url: window.location.href,
        });
      });
    });
  } else if (typeof ctx.registerToolsChangedCallback === 'function') {
    ctx.registerToolsChangedCallback(() => {
      getWebMCPTools().then((result) => {
        chrome.runtime.sendMessage({
          type: 'webmcp_tools_updated',
          tools: result.tools,
          url: window.location.href,
        });
      });
    });
  }
})();
