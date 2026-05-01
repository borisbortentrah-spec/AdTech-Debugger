/*!
 * AdTech Debug Panel v2.0
 * Lightweight ad tag inspector — XHR/fetch/pixel/postMessage interceptor + iframe tree
 * Usage: <script src="https://your-cdn.com/adtech-debugger.js"><\/script>
 *        AdTechDebugger.init({ containerId: 'my-banner', aid: '972229' });
 */
(function (global) {
  'use strict';

  /* ============================================================
     INTERNAL STATE
     ============================================================ */
  const _state = {
    mode: 'script',
    logEntries: 0,
    pixEntries: 0,
    msgEntries: 0,
    urlEntries: 0,
    errEntries: 0,
    xhrEntries: 0,
    lastResponse: '',
    detectedUrls: new Set(),
    interceptorsInstalled: false,
    panelMounted: false,
    targetContainer: null,
    config: {},
  };

  /* ============================================================
     UTILS
     ============================================================ */
  function _uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16).toUpperCase();
    });
  }

  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _el(id) { return document.getElementById('__adt_' + id); }

  function _safeJson(data) {
    if (typeof data === 'string') {
      try { return JSON.stringify(JSON.parse(data), null, 2); } catch (e) { return data; }
    }
    if (data === null || data === undefined) return String(data);
    try { return JSON.stringify(data, null, 2); } catch (e) {
      return '[unserializable: ' + typeof data + '] ' + String(data);
    }
  }

  function _classifyUrl(url) {
    if (/pixel|track|noscript|beacon|imp|event/i.test(url)) return { label: 'PIXEL', cls: 'purple' };
    if (/vast|video|vpaid/i.test(url))                       return { label: 'VAST',  cls: 'amber'  };
    if (/\.js(\?|$)/i.test(url))                             return { label: 'JS',    cls: 'cyan'   };
    if (/click|clk|redirect/i.test(url))                     return { label: 'CLICK', cls: 'green'  };
    if (/\.html?(\?|$)/i.test(url))                          return { label: 'HTML',  cls: 'cyan'   };
    if (/cdn|static|asset/i.test(url))                       return { label: 'CDN',   cls: 'amber'  };
    return { label: 'URL', cls: 'cyan' };
  }

  function _classifyMsg(data) {
    if (typeof data === 'string') {
      if (data === 'ad.imp')          return { type: 'IMP',    cls: 'green'  };
      if (/click/i.test(data))        return { type: 'CLICK',  cls: 'amber'  };
      if (/error/i.test(data))        return { type: 'ERROR',  cls: 'red'    };
      if (/resize/i.test(data))       return { type: 'RESIZE', cls: 'purple' };
      return                                 { type: 'STR',    cls: 'cyan'   };
    }
    if (data && typeof data === 'object') {
      const ev = data.evType || data.type || data.event || data.action || '';
      if (/imp/i.test(ev))            return { type: 'IMP',    cls: 'green'  };
      if (/click/i.test(ev))          return { type: 'CLICK',  cls: 'amber'  };
      if (/error/i.test(ev))          return { type: 'ERROR',  cls: 'red'    };
      if (/resize/i.test(ev))         return { type: 'RESIZE', cls: 'purple' };
      if (/slwCl|slow/i.test(ev))     return { type: 'SLOW',   cls: 'red'    };
      return                                 { type: 'OBJ',    cls: 'cyan'   };
    }
    return { type: 'MSG', cls: 'cyan' };
  }

  /* ============================================================
     CSS INJECTION
     ============================================================ */
  function _injectStyles() {
    if (document.getElementById('__adt_styles')) return;
    const style = document.createElement('style');
    style.id = '__adt_styles';
    style.textContent = `
      #__adt_panel *{box-sizing:border-box;margin:0;padding:0}
      #__adt_panel{
        position:fixed;bottom:0;right:0;width:520px;height:420px;
        background:#0a0c10;color:#e2e8f0;font-family:'JetBrains Mono',monospace,sans-serif;
        font-size:11px;border-top:1px solid #1e2535;border-left:1px solid #1e2535;
        border-radius:8px 0 0 0;z-index:2147483647;display:flex;flex-direction:column;
        box-shadow:0 -4px 40px rgba(0,0,0,0.6);
        transition:height 0.2s,width 0.2s;
      }
      #__adt_panel.adt-collapsed{height:36px;overflow:hidden}
      #__adt_panel.adt-expanded{width:760px;height:560px}
      .__adt_header{
        display:flex;align-items:center;gap:8px;padding:0 10px;height:36px;
        border-bottom:1px solid #1e2535;background:#0f1117;flex-shrink:0;cursor:pointer;
        border-radius:8px 0 0 0;
      }
      .__adt_logo{font-family:sans-serif;font-weight:800;font-size:12px;color:#00d4ff;letter-spacing:.05em}
      .__adt_logo span{color:#8892a4;font-weight:400}
      .__adt_badge{font-size:8px;font-weight:700;letter-spacing:.1em;padding:2px 6px;border-radius:2px;text-transform:uppercase}
      .__adt_b_cyan{background:rgba(0,212,255,.1);color:#00d4ff;border:1px solid rgba(0,212,255,.3)}
      .__adt_b_green{background:rgba(34,197,94,.1);color:#22c55e;border:1px solid rgba(34,197,94,.3)}
      .__adt_b_red{background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.3)}
      .__adt_b_amber{background:rgba(245,158,11,.1);color:#f59e0b;border:1px solid rgba(245,158,11,.3)}
      .__adt_b_purple{background:rgba(124,58,237,.1);color:#a78bfa;border:1px solid rgba(124,58,237,.3)}
      .__adt_stats{display:flex;gap:10px;margin-left:auto;font-size:9px;color:#8892a4}
      .__adt_stat_val{color:#e2e8f0;font-weight:500}
      .__adt_dot{width:6px;height:6px;border-radius:50%;background:#4a5568;display:inline-block;margin-right:3px}
      .__adt_dot.green{background:#22c55e;box-shadow:0 0 5px #22c55e}
      .__adt_dot.red{background:#ef4444}
      .__adt_actions{display:flex;gap:4px;margin-left:6px}
      .__adt_btn{
        font-family:inherit;font-size:9px;padding:3px 8px;border-radius:3px;cursor:pointer;
        border:1px solid #2a3348;background:#161b25;color:#8892a4;
        transition:all .15s;white-space:nowrap;
      }
      .__adt_btn:hover{color:#e2e8f0;border-color:#4a5568}
      .__adt_tabs{display:flex;border-bottom:1px solid #1e2535;background:#0f1117;overflow-x:auto;flex-shrink:0}
      .__adt_tab{
        padding:6px 12px;font-size:9px;font-weight:500;letter-spacing:.08em;
        color:#4a5568;cursor:pointer;border-bottom:2px solid transparent;
        transition:all .15s;white-space:nowrap;text-transform:uppercase;
        display:flex;align-items:center;gap:5px;
      }
      .__adt_tab:hover{color:#8892a4}
      .__adt_tab.active{color:#00d4ff;border-bottom-color:#00d4ff}
      .__adt_cnt{font-size:8px;background:#2a3348;padding:1px 4px;border-radius:8px;color:#4a5568}
      .__adt_tab.active .__adt_cnt{background:rgba(0,212,255,.15);color:#00d4ff}
      .__adt_panels{flex:1;overflow:hidden;display:flex;flex-direction:column}
      .__adt_panel_body{display:none;flex:1;overflow-y:auto}
      .__adt_panel_body.active{display:block}
      .__adt_toolbar{
        display:flex;align-items:center;justify-content:space-between;
        padding:5px 10px;border-bottom:1px solid #1e2535;background:#161b25;flex-shrink:0;
      }
      .__adt_entry{
        padding:3px 10px;border-bottom:1px solid rgba(255,255,255,.02);
        font-size:10px;line-height:1.5;display:grid;grid-template-columns:62px 48px 1fr;gap:0;
      }
      .__adt_t{color:#4a5568}
      .__adt_l_info .adt_lv{color:#00d4ff}
      .__adt_l_warn .adt_lv{color:#f59e0b}
      .__adt_l_error .adt_lv{color:#ef4444}
      .__adt_l_success .adt_lv{color:#22c55e}
      .__adt_l_pixel .adt_lv{color:#a78bfa}
      .__adt_l_post .adt_lv{color:#f472b6}
      .__adt_l_xhr .adt_lv{color:#34d399}
      .adt_lm{color:#e2e8f0;word-break:break-all}
      .__adt_pix_entry{padding:5px 10px;border-bottom:1px solid rgba(255,255,255,.02)}
      .__adt_pix_url{color:#a78bfa;word-break:break-all;font-size:9px}
      .__adt_pix_meta{color:#4a5568;font-size:9px;margin-top:2px}
      .__adt_msg_entry{padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.02)}
      .__adt_url_item{padding:4px 10px;border-bottom:1px solid rgba(255,255,255,.02);display:flex;gap:6px;align-items:flex-start}
      .__adt_url_href{color:#8892a4;word-break:break-all;font-size:9px}
      .__adt_empty{
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100px;color:#4a5568;font-size:10px;gap:6px;
      }
      .__adt_code{
        padding:8px 10px;font-size:9px;color:#8892a4;white-space:pre-wrap;
        word-break:break-all;line-height:1.6;
      }
      .__adt_iframe_node{
        margin:4px 8px;padding:6px 8px;border:1px solid #1e2535;border-radius:3px;
        background:#0a0c10;font-size:9px;
      }
      #__adt_panel ::-webkit-scrollbar{width:4px;height:4px}
      #__adt_panel ::-webkit-scrollbar-track{background:transparent}
      #__adt_panel ::-webkit-scrollbar-thumb{background:#2a3348;border-radius:2px}
    `;
    document.head.appendChild(style);
  }

  /* ============================================================
     PANEL HTML
     ============================================================ */
  function _buildPanel() {
    const div = document.createElement('div');
    div.id = '__adt_panel';
    div.innerHTML = `
      <div class="__adt_header" onclick="AdTechDebugger.toggleCollapse()">
        <div class="__adt_logo">AD<span>TECH</span> DEBUG</div>
        <div class="__adt_badge __adt_b_cyan">v2.0</div>
        <span class="__adt_dot" id="__adt_statusDot"></span>
        <span style="font-size:9px;color:#8892a4" id="__adt_statusText">IDLE</span>
        <div class="__adt_stats">
          XHR <span class="__adt_stat_val" id="__adt_xhrCount">0</span>
          &nbsp;PIX <span class="__adt_stat_val" id="__adt_pixCount">0</span>
          &nbsp;MSG <span class="__adt_stat_val" id="__adt_msgCount">0</span>
          &nbsp;ERR <span class="__adt_stat_val" id="__adt_errCount">0</span>
        </div>
        <div class="__adt_actions" onclick="event.stopPropagation()">
          <button class="__adt_btn" onclick="AdTechDebugger.toggleExpand()">⤢</button>
          <button class="__adt_btn" onclick="AdTechDebugger.clearAll()">✕</button>
        </div>
      </div>
      <div class="__adt_tabs">
        <div class="__adt_tab active" onclick="AdTechDebugger.showTab('log')">
          📋 Console <span class="__adt_cnt" id="__adt_logCount">0</span>
        </div>
        <div class="__adt_tab" onclick="AdTechDebugger.showTab('pixels')">
          🔴 Pixels <span class="__adt_cnt" id="__adt_pixTabCount">0</span>
        </div>
        <div class="__adt_tab" onclick="AdTechDebugger.showTab('messages')">
          📨 postMsg <span class="__adt_cnt" id="__adt_msgTabCount">0</span>
        </div>
        <div class="__adt_tab" onclick="AdTechDebugger.showTab('urls')">
          🔗 URLs <span class="__adt_cnt" id="__adt_urlTabCount">0</span>
        </div>
        <div class="__adt_tab" onclick="AdTechDebugger.showTab('response')">
          {} Response
        </div>
        <div class="__adt_tab" onclick="AdTechDebugger.showTab('iframes')">
          🖼 iFrames
        </div>
      </div>
      <div class="__adt_panels">
        <!-- LOG -->
        <div class="__adt_panel_body active" id="__adt_tab_log">
          <div class="__adt_toolbar">
            <span style="font-size:9px;color:#8892a4" id="__adt_logInfo">0 entries</span>
            <button class="__adt_btn" onclick="AdTechDebugger.clearLog()">Clear</button>
          </div>
          <div id="__adt_logContainer"></div>
        </div>
        <!-- PIXELS -->
        <div class="__adt_panel_body" id="__adt_tab_pixels">
          <div class="__adt_toolbar">
            <span style="font-size:9px;color:#8892a4" id="__adt_pixInfo">0 pixels</span>
            <button class="__adt_btn" onclick="AdTechDebugger.clearPixels()">Clear</button>
          </div>
          <div id="__adt_pixelContainer">
            <div class="__adt_empty">🔴 Pixel fires will appear here</div>
          </div>
        </div>
        <!-- MESSAGES -->
        <div class="__adt_panel_body" id="__adt_tab_messages">
          <div class="__adt_toolbar">
            <span style="font-size:9px;color:#8892a4" id="__adt_msgInfo">0 messages</span>
            <button class="__adt_btn" onclick="AdTechDebugger.clearMessages()">Clear</button>
          </div>
          <div id="__adt_msgContainer">
            <div class="__adt_empty">📨 postMessage events will appear here</div>
          </div>
        </div>
        <!-- URLS -->
        <div class="__adt_panel_body" id="__adt_tab_urls">
          <div class="__adt_toolbar">
            <span style="font-size:9px;color:#8892a4" id="__adt_urlInfo">0 URLs</span>
            <button class="__adt_btn" onclick="AdTechDebugger.clearUrls()">Clear</button>
          </div>
          <div id="__adt_urlContainer">
            <div class="__adt_empty">🔗 URLs will appear here</div>
          </div>
        </div>
        <!-- RESPONSE -->
        <div class="__adt_panel_body" id="__adt_tab_response">
          <div class="__adt_toolbar">
            <span style="font-size:9px;color:#8892a4">Raw Response</span>
            <button class="__adt_btn" onclick="AdTechDebugger.copyResponse()">Copy</button>
          </div>
          <div class="__adt_code" id="__adt_responseBlock">No response yet</div>
        </div>
        <!-- IFRAMES -->
        <div class="__adt_panel_body" id="__adt_tab_iframes">
          <div class="__adt_toolbar">
            <span style="font-size:9px;color:#8892a4">iFrame tree</span>
            <button class="__adt_btn" onclick="AdTechDebugger.scanIframes()">↺ Scan</button>
          </div>
          <div id="__adt_iframeTree">
            <div class="__adt_empty">🖼 Click Scan after ad loads</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(div);
    _state.panelMounted = true;
  }

  /* ============================================================
     LOG
     ============================================================ */
  function _log(level, msg) {
    _state.logEntries++;
    if (level === 'error') _state.errEntries++;
    _updateCounters();

    const c = _el('logContainer');
    if (!c) return;
    const e = document.createElement('div');
    e.className = '__adt_entry __adt_l_' + level;
    const t = new Date().toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const lm = { info: 'INFO', warn: 'WARN', error: 'ERR!', success: 'OK', pixel: 'PIX', post: 'POST', xhr: 'XHR' };
    e.innerHTML = `<span class="__adt_t">${t}</span><span class="adt_lv">${lm[level] || level.toUpperCase()}</span><span class="adt_lm">${_esc(String(msg).slice(0, 200))}</span>`;
    c.appendChild(e);
    c.scrollTop = c.scrollHeight;

    const lc = _el('logCount');
    if (lc) lc.textContent = _state.logEntries;
    const li = _el('logInfo');
    if (li) li.textContent = _state.logEntries + ' entries';
  }

  /* ============================================================
     PIXEL
     ============================================================ */
  function _addPixel(url, source) {
    _state.pixEntries++;
    _updateCounters();
    _log('pixel', '[PIX] ' + url.slice(0, 100));
    _addUrl(url);

    const c = _el('pixelContainer');
    if (!c) return;
    if (c.querySelector('.__adt_empty')) c.innerHTML = '';
    const e = document.createElement('div');
    e.className = '__adt_pix_entry';
    e.innerHTML = `<div class="__adt_pix_url">${_esc(url)}</div><div class="__adt_pix_meta">${new Date().toLocaleTimeString()} · ${_esc(source)}</div>`;
    c.appendChild(e);
    c.scrollTop = c.scrollHeight;

    const pt = _el('pixTabCount'); if (pt) pt.textContent = _state.pixEntries;
    const pi = _el('pixInfo');     if (pi) pi.textContent = _state.pixEntries + ' pixels';
  }

  /* ============================================================
     URL
     ============================================================ */
  function _addUrl(url) {
    if (!url || _state.detectedUrls.has(url)) return;
    _state.detectedUrls.add(url);
    _state.urlEntries++;

    const c = _el('urlContainer');
    if (!c) return;
    if (c.querySelector('.__adt_empty')) c.innerHTML = '';

    const { label, cls } = _classifyUrl(url);
    const e = document.createElement('div');
    e.className = '__adt_url_item';
    e.innerHTML = `<span class="__adt_badge __adt_b_${cls}" style="flex-shrink:0">${label}</span><span class="__adt_url_href">${_esc(url)}</span>`;
    c.appendChild(e);

    const ut = _el('urlTabCount'); if (ut) ut.textContent = _state.urlEntries;
    const ui = _el('urlInfo');     if (ui) ui.textContent = _state.urlEntries + ' URLs';
  }

  function _detectUrls(text) {
    const matches = text.match(/https?:\/\/[^\s"'<>)]+/g) || [];
    [...new Set(matches)].forEach(_addUrl);
    _log('info', (new Set(matches)).size + ' URLs found in response');
  }

  /* ============================================================
     POSTMESSAGE
     ============================================================ */
  function _addMessage(data, origin) {
    _state.msgEntries++;
    _updateCounters();

    const str = _safeJson(data);
    const { type: msgType, cls: msgCls } = _classifyMsg(data);

    let originDisplay = origin || '';
    if (!originDisplay || originDisplay === 'null') originDisplay = 'sandboxed / same-origin';

    // Key field summary for known ad payloads
    let summaryHtml = '';
    const raw = (typeof data === 'object' && data !== null) ? data : null;
    if (raw) {
      const fields = ['evType','type','event','action','key','adup','el','adid','cmpId','width','height'];
      const found = fields.filter(k => raw[k] !== undefined && raw[k] !== '');
      if (found.length) {
        summaryHtml = `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">
          ${found.map(k => `<span style="font-size:9px;background:#161b25;border:1px solid #2a3348;border-radius:2px;padding:1px 5px">
            <span style="color:#4a5568">${k}:</span>
            <span style="color:#e2e8f0">${_esc(String(raw[k]).slice(0, 40))}</span>
          </span>`).join('')}
        </div>`;
      }
    }

    const c = _el('msgContainer');
    if (!c) return;
    if (c.querySelector('.__adt_empty')) c.innerHTML = '';

    const e = document.createElement('div');
    e.className = '__adt_msg_entry';
    e.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="__adt_badge __adt_b_${msgCls}">${msgType}</span>
        <span style="font-size:10px;color:#e2e8f0;font-weight:500">${_esc(originDisplay)}</span>
        <span style="margin-left:auto;font-size:9px;color:#4a5568">${new Date().toLocaleTimeString()}</span>
      </div>
      ${summaryHtml}
      <details style="margin-top:4px">
        <summary style="font-size:9px;color:#4a5568;cursor:pointer">raw payload</summary>
        <pre style="margin-top:3px;font-size:9px;color:#8892a4;background:#0a0c10;border:1px solid #1e2535;border-radius:3px;padding:5px;overflow:auto;max-height:120px;white-space:pre-wrap;word-break:break-all">${_esc(str.slice(0, 2000))}</pre>
      </details>
    `;
    c.appendChild(e);
    c.scrollTop = c.scrollHeight;

    const mt = _el('msgTabCount'); if (mt) mt.textContent = _state.msgEntries;
    const mi = _el('msgInfo');     if (mi) mi.textContent = _state.msgEntries + ' messages';

    _log('post', `[${msgType}] ${str.slice(0, 80)}`);
  }

  /* ============================================================
     RESPONSE
     ============================================================ */
  function _setResponse(text) {
    _state.lastResponse = text;
    const b = _el('responseBlock');
    if (b) b.textContent = text;
    _detectUrls(text);
  }

  /* ============================================================
     IFRAME TREE
     ============================================================ */
  function _buildIframeNode(frame, depth, counter) {
    const idx = counter.n++;
    const w = frame.offsetWidth || parseInt(frame.getAttribute('width')) || '?';
    const h = frame.offsetHeight || parseInt(frame.getAttribute('height')) || '?';

    const srcAttr = frame.getAttribute('src') || '';
    const srcdoc  = frame.getAttribute('srcdoc') || '';
    let srcDisplay, srcType;
    if (srcAttr && srcAttr !== 'about:blank') { srcDisplay = srcAttr; srcType = 'src'; }
    else if (srcdoc) { srcDisplay = srcdoc.slice(0, 100) + (srcdoc.length > 100 ? '…' : ''); srcType = 'srcdoc'; }
    else             { srcDisplay = 'about:blank'; srcType = 'blank'; }

    let doc = null, crossOrigin = false;
    try { doc = frame.contentDocument; if (!doc) crossOrigin = true; } catch (e) { crossOrigin = true; }

    const sandbox    = frame.getAttribute('sandbox');
    const readyState = doc ? doc.readyState : (crossOrigin ? 'cross-origin' : 'unknown');
    const scripts    = doc ? doc.querySelectorAll('script').length : '?';

    let assets = [];
    if (doc) {
      assets = Array.from(doc.querySelectorAll('script[src],img[src],iframe[src]'))
        .map(el => el.src || el.getAttribute('src')).filter(Boolean);
    }

    let childrenHtml = '';
    if (doc) {
      childrenHtml = Array.from(doc.querySelectorAll('iframe'))
        .map(f => _buildIframeNode(f, depth + 1, counter)).join('');
    }

    const bcls = ['__adt_b_cyan','__adt_b_green','__adt_b_amber','__adt_b_purple'][depth % 4];
    const rcls = readyState === 'complete' ? '__adt_b_green' : readyState === 'cross-origin' ? '__adt_b_red' : '__adt_b_amber';

    return `<div class="__adt_iframe_node" style="margin-left:${depth*14}px;border-left:2px solid ${['#00d4ff','#22c55e','#f59e0b','#a78bfa'][depth%4]}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="__adt_badge ${bcls}">IFRAME #${idx}</span>
        <span style="font-weight:500;color:#e2e8f0">${w}×${h}px</span>
        <span class="__adt_badge ${rcls}">${readyState}</span>
        ${sandbox !== null ? `<span class="__adt_badge __adt_b_amber" title="${_esc(sandbox||'(empty)')}">sandboxed</span>` : ''}
        ${crossOrigin ? `<span class="__adt_badge __adt_b_red">cross-origin</span>` : ''}
        <span style="margin-left:auto;font-size:9px;color:#4a5568">depth ${depth}</span>
      </div>
      <div style="margin-top:5px;display:grid;grid-template-columns:58px 1fr;gap:2px 6px;line-height:1.6">
        <span style="color:#4a5568">src type</span>
        <span class="__adt_badge ${srcType==='src'?'__adt_b_cyan':srcType==='srcdoc'?'__adt_b_purple':'__adt_b_amber'}">${srcType}</span>
        <span style="color:#4a5568">src</span>
        <span style="color:#00d4ff;word-break:break-all">${_esc(srcDisplay)}</span>
        <span style="color:#4a5568">scripts</span>
        <span style="color:#e2e8f0">${scripts}</span>
        ${assets.length ? `<span style="color:#4a5568">assets</span><span style="color:#8892a4">${assets.slice(0,3).map(u=>`<div style="word-break:break-all">${_esc(u.slice(0,80))}</div>`).join('')}${assets.length>3?`<div style="color:#4a5568">+${assets.length-3} more</div>`:''}</span>` : ''}
      </div>
      ${childrenHtml ? `<div style="margin-top:5px">${childrenHtml}</div>` : ''}
    </div>`;
  }

  /* ============================================================
     INTERCEPTORS
     ============================================================ */
  function _installInterceptors() {
    if (_state.interceptorsInstalled) return;
    _state.interceptorsInstalled = true;

    // XHR
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this._adtUrl = url; this._adtMethod = method;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this._adtUrl) {
        _state.xhrEntries++;
        _updateCounters();
        _log('xhr', `[XHR] ${this._adtMethod || 'GET'} ${this._adtUrl}`);
        _addUrl(this._adtUrl);
      }
      return origSend.apply(this, arguments);
    };

    // fetch
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      _state.xhrEntries++;
      _updateCounters();
      _log('xhr', `[fetch] ${url}`);
      _addUrl(url);
      return origFetch.apply(this, arguments);
    };

    // Image pixels
    const OrigImage = window.Image;
    window.Image = function (w, h) {
      const img = new OrigImage(w, h);
      const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
                || Object.getOwnPropertyDescriptor(Element.prototype, 'src');
      let _src = '';
      Object.defineProperty(img, 'src', {
        get: () => _src,
        set: (val) => {
          _src = val;
          if (val && !val.startsWith('data:')) _addPixel(val, 'Image()');
          if (desc && desc.set) desc.set.call(img, val);
          else img.setAttribute('src', val);
        }
      });
      return img;
    };
    window.Image.prototype = OrigImage.prototype;

    // postMessage
    window.addEventListener('message', function (e) {
      if (e.data && e.data.__adtSelf) return;
      _addMessage(e.data, e.origin);
    });
  }

  /* ============================================================
     STATUS / COUNTERS
     ============================================================ */
  function _setStatus(s) {
    const dot = _el('statusDot');
    const txt = _el('statusText');
    if (!dot || !txt) return;
    if (s === 'loading') { dot.className = '__adt_dot green'; txt.textContent = 'LOADING'; }
    else if (s === 'ok') { dot.className = '__adt_dot green'; txt.textContent = 'LIVE';    }
    else if (s === 'error') { dot.className = '__adt_dot red'; txt.textContent = 'ERROR';  }
    else                 { dot.className = '__adt_dot';        txt.textContent = 'IDLE';   }
  }

  function _updateCounters() {
    const map = { xhrCount: _state.xhrEntries, pixCount: _state.pixEntries, msgCount: _state.msgEntries, errCount: _state.errEntries };
    Object.entries(map).forEach(([id, val]) => { const el = _el(id); if (el) el.textContent = val; });
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  const AdTechDebugger = {

    /**
     * Initialize the debugger.
     * @param {object} opts
     * @param {string} [opts.containerId]   - ID of the ad container element to watch
     * @param {string} [opts.aid]           - Ad source/aid
     * @param {boolean} [opts.autoMount]    - Mount the panel immediately (default: true)
     */
    init(opts) {
      _state.config = opts || {};
      _injectStyles();
      if (opts && opts.containerId) {
        _state.targetContainer = document.getElementById(opts.containerId);
      }
      if (opts && opts.autoMount !== false) {
        this.mount();
      }
      _installInterceptors();
      _log('info', `AdTech Debugger initialized${opts && opts.aid ? ' · aid=' + opts.aid : ''}`);
      if (_state.targetContainer) {
        _log('info', `Watching container: #${opts.containerId}`);
      }
      return this;
    },

    /** Mount the panel into the DOM */
    mount() {
      if (!_state.panelMounted) _buildPanel();
      return this;
    },

    /** Show a named tab: 'log' | 'pixels' | 'messages' | 'urls' | 'response' | 'iframes' */
    showTab(name) {
      document.querySelectorAll('.__adt_tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.__adt_panel_body').forEach(t => t.classList.remove('active'));
      const tab = document.querySelector(`.__adt_tab[onclick="AdTechDebugger.showTab('${name}')"]`);
      const body = _el('tab_' + name);
      if (tab) tab.classList.add('active');
      if (body) body.classList.add('active');
    },

    toggleCollapse() {
      const p = document.getElementById('__adt_panel');
      if (p) p.classList.toggle('adt-collapsed');
    },

    toggleExpand() {
      const p = document.getElementById('__adt_panel');
      if (p) p.classList.toggle('adt-expanded');
    },

    /** Manually log a message to the Console tab */
    log(level, msg) { _log(level, msg); return this; },

    /** Manually record a URL as detected */
    addUrl(url) { _addUrl(url); return this; },

    /** Set raw response text (populates Response tab) */
    setResponse(text) { _setResponse(text); return this; },

    /** Set the ad container element to use for iframe scanning */
    setContainer(el) {
      _state.targetContainer = typeof el === 'string' ? document.getElementById(el) : el;
      return this;
    },

    /** Scan iframes inside the watched container */
    scanIframes() {
      const tree = _el('iframeTree');
      if (!tree) return;
      const container = _state.targetContainer || document.body;
      const rootFrames = container.querySelectorAll('iframe');
      if (!rootFrames.length) {
        tree.innerHTML = '<div class="__adt_empty">🖼 No iframes found</div>';
        return;
      }
      const counter = { n: 0 };
      tree.innerHTML = Array.from(rootFrames).map(f => _buildIframeNode(f, 0, counter)).join('');
    },

    setStatus(s) { _setStatus(s); return this; },

    copyResponse() {
      const text = _state.lastResponse || (_el('responseBlock') || {}).textContent || '';
      navigator.clipboard && navigator.clipboard.writeText(text);
      _log('info', 'Response copied to clipboard');
    },

    clearLog() {
      const c = _el('logContainer'); if (c) c.innerHTML = '';
      _state.logEntries = 0;
      const lc = _el('logCount'); if (lc) lc.textContent = '0';
      const li = _el('logInfo');  if (li) li.textContent = '0 entries';
    },

    clearPixels() {
      const c = _el('pixelContainer'); if (c) c.innerHTML = '<div class="__adt_empty">🔴 Pixel fires will appear here</div>';
      _state.pixEntries = 0;
      const pt = _el('pixTabCount'); if (pt) pt.textContent = '0';
      const pi = _el('pixInfo');     if (pi) pi.textContent = '0 pixels';
      _updateCounters();
    },

    clearMessages() {
      const c = _el('msgContainer'); if (c) c.innerHTML = '<div class="__adt_empty">📨 postMessage events will appear here</div>';
      _state.msgEntries = 0;
      const mt = _el('msgTabCount'); if (mt) mt.textContent = '0';
      const mi = _el('msgInfo');     if (mi) mi.textContent = '0 messages';
      _updateCounters();
    },

    clearUrls() {
      const c = _el('urlContainer'); if (c) c.innerHTML = '<div class="__adt_empty">🔗 URLs will appear here</div>';
      _state.urlEntries = 0;
      _state.detectedUrls.clear();
      const ut = _el('urlTabCount'); if (ut) ut.textContent = '0';
      const ui = _el('urlInfo');     if (ui) ui.textContent = '0 URLs';
    },

    clearAll() {
      this.clearLog();
      this.clearPixels();
      this.clearMessages();
      this.clearUrls();
      const rb = _el('responseBlock'); if (rb) rb.textContent = 'No response yet';
      _state.errEntries = 0; _state.xhrEntries = 0;
      _updateCounters();
      _setStatus('idle');
      _log('info', 'Panel cleared');
    },

    /** Access internal state (read-only) */
    get state() { return Object.assign({}, _state); },
  };

  // Expose globally
  global.AdTechDebugger = AdTechDebugger;

}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));
