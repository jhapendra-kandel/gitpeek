/**
 * GitPeek — script.js  v2.1
 * A beautiful GitHub repository explorer
 * Pure Vanilla JS + jQuery | No build tools | Works on GitHub Pages
 *
 * Fixes v2.1:
 *  - HTML/MD files auto-open in split view (code left, preview right)
 *  - CSS injection: <link href="style.css"> fetched from repo and injected
 *  - Apply CSS toggle button
 *  - Batch download: explicit button only, no auto-download
 *  - Download buttons in pane header properly wired
 *  - Renamed GitPeak → GitPeek
 */

/* ================================================================
   CONFIGURATION & CONSTANTS
   ================================================================ */
const CONFIG = {
  API_BASE:        'https://api.github.com',
  RAW_BASE:        'https://raw.githubusercontent.com',
  GITHUB_BASE:     'https://github.com',
  CACHE_NAME:      'gitpeek-v2',
  LS_THEME:        'gitpeek_theme',
  LS_RECENT:       'gitpeek_recent',
  LS_FAVORITES:    'gitpeek_favorites',
  LS_SIDEBAR_W:    'gitpeek_sidebar_w',
  MAX_RECENT:      10,
  PREVIEW_LINES:   6,
  TEXT_EXTS: new Set([
    'js','jsx','ts','tsx','mjs','cjs','css','scss','sass','less',
    'html','htm','xml','svg','json','jsonc','yaml','yml','toml','ini',
    'env','md','mdx','txt','log','csv','py','rb','go','rs','java',
    'kt','swift','c','cpp','h','hpp','cs','php','pl','lua','r','sh',
    'bash','zsh','fish','ps1','vue','svelte','elm','ex','exs','erl',
    'hs','dart','scala','groovy','makefile','dockerfile','gitignore',
    'editorconfig','prisma','graphql','gql','proto','conf','cfg',
  ]),
  IMAGE_EXTS: new Set(['png','jpg','jpeg','gif','webp','ico','bmp','avif','svg']),
  VIDEO_EXTS: new Set(['mp4','webm','ogg','mov']),
  DUAL_PANE_EXTS: new Set(['html','htm','md','mdx']),
  PRISM_MAP: {
    js:'javascript', jsx:'jsx', ts:'typescript', tsx:'tsx',
    mjs:'javascript', cjs:'javascript', css:'css', scss:'scss',
    sass:'scss', less:'less', html:'markup', htm:'markup',
    xml:'markup', svg:'markup', json:'json', yaml:'yaml', yml:'yaml',
    toml:'toml', md:'markdown', mdx:'markdown', py:'python',
    rb:'ruby', go:'go', rs:'rust', java:'java', kt:'kotlin',
    swift:'swift', c:'c', cpp:'cpp', h:'c', hpp:'cpp', cs:'csharp',
    php:'php', pl:'perl', lua:'lua', sh:'bash', bash:'bash',
    zsh:'bash', fish:'bash', ps1:'powershell', vue:'markup',
    svelte:'markup', dart:'dart', scala:'scala', groovy:'groovy',
    graphql:'graphql', gql:'graphql', dockerfile:'docker',
    prisma:'json', proto:'protobuf',
  },
  BADGE: {
    js:'JS', jsx:'JSX', ts:'TS', tsx:'TSX', css:'CSS', scss:'SCSS',
    sass:'SASS', less:'LESS', html:'HTML', htm:'HTML', xml:'XML',
    json:'JSON', yaml:'YAML', yml:'YAML', toml:'TOML', md:'MD',
    mdx:'MDX', txt:'TXT', py:'PY', rb:'RB', go:'GO', rs:'RS',
    java:'JAVA', kt:'KT', swift:'SWIFT', c:'C', cpp:'C++', cs:'C#',
    php:'PHP', sh:'SH', bash:'SH', vue:'VUE', svelte:'SVE',
    dockerfile:'DOC', lock:'LOCK',
    png:'IMG', jpg:'IMG', jpeg:'IMG', gif:'GIF', webp:'IMG',
    ico:'ICO', svg:'SVG', mp4:'VID', webm:'VID',
  },
  ICON_COLOR: {
    js:'#eac53f', jsx:'#61dafb', ts:'#3178c6', tsx:'#61dafb',
    css:'#5383ff', scss:'#cc6699', sass:'#cc6699', less:'#1d365d',
    html:'#e44d26', htm:'#e44d26', xml:'#e44d26', json:'#c69650',
    yaml:'#cb2027', yml:'#cb2027', md:'#7f56d9', py:'#3776ab',
    rb:'#cc342d', go:'#00add8', rs:'#dea584', java:'#ed592f',
    kt:'#7f52ff', swift:'#fa7343', c:'#555596', cpp:'#00599d',
    cs:'#68217a', php:'#777bb3', sh:'#89c132', bash:'#89c132',
    vue:'#41b883', svelte:'#ff3e00', dart:'#00b4ab', scala:'#dc322f',
    png:'#3fb950', jpg:'#3fb950', jpeg:'#3fb950', gif:'#3fb950',
    webp:'#3fb950', ico:'#3fb950', svg:'#3fb950',
    mp4:'#bc8cff', webm:'#bc8cff',
  },
};

/* ================================================================
   APPLICATION STATE
   ================================================================ */
const State = {
  repo:          null,
  tree:          [],
  treeMap:       {},
  openFolders:   new Set(),
  activeFile:    null,
  splitFile:     null,
  isSplitOpen:   false,
  isSidebarOpen: true,
  currentTheme:  localStorage.getItem(CONFIG.LS_THEME) || 'github-dark',
  favorites:     {},
  recent:        [],
  fileIndex:     [],
  fileIndexPos:  -1,
  hoverTimer:    null,
  isResizing:    false,
  selectedFiles: new Set(),
  applyCss:      true,   // Toggle CSS injection for HTML preview
  viewMode:      'split', // 'split' | 'code' | 'preview'
};

/* ================================================================
   BOOT
   ================================================================ */
$(function () {
  loadPersistedState();
  applyTheme(State.currentTheme);
  bindEvents();
  renderRecentList();
  renderFavoritesList();
  checkDeepLink();
  initDragDrop();
  initSidebarResize();
  initMobileSwipe();
  const savedW = localStorage.getItem(CONFIG.LS_SIDEBAR_W);
  if (savedW) $('#sidebar').css('width', savedW + 'px');
  updateCssToggleBtn();
});

/* ================================================================
   UTILITIES
   ================================================================ */
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function getExt(filename) {
  const base = String(filename).split('/').pop();
  const dot = base.lastIndexOf('.');
  return dot < 1 ? base.toLowerCase() : base.slice(dot + 1).toLowerCase();
}
function getFilename(path) { return String(path).split('/').pop(); }
function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s/60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m/60); if (h < 24) return h + 'h ago';
  return Math.floor(h/24) + 'd ago';
}
function showLoading(msg) {
  $('#loading-text').text(msg || 'Loading…');
  $('#loading-overlay').removeClass('hidden');
}
function hideLoading() { $('#loading-overlay').addClass('hidden'); }
function toast(msg, type = 'info', dur = 3200) {
  const id = 't' + Date.now();
  const el = $(`<div class="toast toast-${type}" id="${id}" role="alert"><span class="toast-dot"></span><span>${escHtml(msg)}</span></div>`);
  $('#toast-container').append(el);
  setTimeout(() => el.fadeOut(250, () => el.remove()), dur);
}
function parseRepoInput(raw) {
  raw = String(raw).trim();
  const m1 = raw.match(/github\.com\/([^\/\s]+)\/([^\/\s#?]+)/i);
  if (m1) return { owner: m1[1], name: m1[2].replace(/\.git$/, '') };
  const m2 = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (m2) return { owner: m2[1], name: m2[2] };
  return null;
}
function rawUrl(path) {
  if (!State.repo) return '';
  return `${CONFIG.RAW_BASE}/${State.repo.owner}/${State.repo.name}/${State.repo.branch}/${encodeURIComponent(path).replace(/%2F/g,'/')}`;
}
function githubFileUrl(path) {
  if (!State.repo) return '';
  return `${CONFIG.GITHUB_BASE}/${State.repo.owner}/${State.repo.name}/blob/${State.repo.branch}/${path}`;
}
function zipUrl() {
  if (!State.repo) return '';
  return `${CONFIG.GITHUB_BASE}/${State.repo.owner}/${State.repo.name}/archive/refs/heads/${State.repo.branch}.zip`;
}
function updatePageUrl(params) {
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([k,v]) => {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  });
  history.replaceState(null, '', url.toString());
}

/* Normalize relative path (handle ../ segments) */
function normalizePath(path) {
  const parts = path.split('/');
  const result = [];
  for (const part of parts) {
    if (part === '..') { if (result.length) result.pop(); }
    else if (part !== '.' && part !== '') result.push(part);
  }
  return result.join('/');
}

function fileIconSvg(name, isDir, isOpen) {
  if (isDir) {
    return `<svg class="tree-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-yellow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
  }
  const ext = getExt(name);
  const col = CONFIG.ICON_COLOR[ext] || 'var(--text-muted)';
  return `<svg class="tree-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

/* ================================================================
   PERSISTENCE
   ================================================================ */
function loadPersistedState() {
  try { State.favorites = JSON.parse(localStorage.getItem(CONFIG.LS_FAVORITES) || '{}'); } catch(e) { State.favorites = {}; }
  try { State.recent    = JSON.parse(localStorage.getItem(CONFIG.LS_RECENT)    || '[]'); } catch(e) { State.recent    = []; }
}
function saveFavorites() { localStorage.setItem(CONFIG.LS_FAVORITES, JSON.stringify(State.favorites)); }
function saveRecent()    { localStorage.setItem(CONFIG.LS_RECENT,    JSON.stringify(State.recent));    }
function addToRecent(repo) {
  const key = repo.fullName;
  State.recent = State.recent.filter(r => r.key !== key);
  State.recent.unshift({ key, owner: repo.owner, name: repo.name, branch: repo.branch, time: new Date().toISOString() });
  if (State.recent.length > CONFIG.MAX_RECENT) State.recent.pop();
  saveRecent();
  renderRecentList();
}

/* ================================================================
   THEME
   ================================================================ */
function applyTheme(theme) {
  State.currentTheme = theme;
  $('html').attr('data-theme', theme);
  localStorage.setItem(CONFIG.LS_THEME, theme);
  $('.dropdown-item[data-theme]').removeClass('active');
  $(`.dropdown-item[data-theme="${theme}"]`).addClass('active');
  const href = theme === 'light-minimal'
    ? 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism.min.css'
    : 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css';
  $('link[href*="prism"][href*="themes"]').attr('href', href);
}

/* ================================================================
   CSS INJECTION HELPERS
   ================================================================ */
function updateCssToggleBtn() {
  const $btn = $('#css-inject-btn');
  if (State.applyCss) {
    $btn.removeClass('css-off').addClass('css-on').html(
      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> CSS: ON`
    );
  } else {
    $btn.removeClass('css-on').addClass('css-off').html(
      `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> CSS: OFF`
    );
  }
}

function toggleApplyCss() {
  State.applyCss = !State.applyCss;
  updateCssToggleBtn();
  toast(`CSS injection ${State.applyCss ? 'enabled' : 'disabled'}`, 'info', 2000);
  // Re-render active HTML file
  if (State.activeFile) {
    const ext = getExt(State.activeFile);
    if (ext === 'html' || ext === 'htm') {
      openFileInPane(State.activeFile, 'primary');
    }
  }
}

/**
 * Parse HTML text, find <link rel="stylesheet" href="..."> tags,
 * fetch those CSS files from the repo, and inject them as <style> blocks.
 */
async function injectCSSFromRepo(htmlText, filePath) {
  if (!State.applyCss || !State.repo) return htmlText;

  const basePath = filePath.includes('/')
    ? filePath.slice(0, filePath.lastIndexOf('/'))
    : '';

  let result = htmlText;

  // Find all <link ...> tags
  const linkRegex = /<link(\s[^>]*?)>/gi;
  const found = [];
  let m;
  // We must not exec on 'result' while modifying it, so collect first
  while ((m = linkRegex.exec(htmlText)) !== null) {
    found.push(m[0]);
  }

  for (const tag of found) {
    // Must be rel=stylesheet
    if (!/rel=["']stylesheet["']/i.test(tag)) continue;

    const hrefM = /href=["']([^"']+)["']/i.exec(tag);
    if (!hrefM) continue;

    const href = hrefM[1].trim();
    // Skip external and data URIs
    if (/^(https?:|\/\/|data:)/.test(href)) continue;

    // Resolve relative to HTML file's directory
    const rawPath = basePath ? `${basePath}/${href}` : href;
    const cssPath = normalizePath(rawPath);

    if (State.treeMap[cssPath]) {
      try {
        const { text: cssText } = await fetchFileContent(cssPath);
        const replacement = `<style>\n/* GitPeek: injected from ${cssPath} */\n${cssText}\n</style>`;
        result = result.replace(tag, replacement);
        console.log('[GitPeek] CSS injected:', cssPath);
      } catch(e) {
        console.warn('[GitPeek] Failed to inject CSS:', cssPath, e);
      }
    } else {
      console.info('[GitPeek] CSS not found in tree:', cssPath);
    }
  }

  return result;
}

/* ================================================================
   GITHUB API
   ================================================================ */
function apiGet(path) {
  const url = path.startsWith('http') ? path : CONFIG.API_BASE + path;
  return $.ajax({ url, type: 'GET', headers: { Accept: 'application/vnd.github.v3+json' } })
    .then(function(data, st, xhr) {
      const rem = xhr.getResponseHeader('X-RateLimit-Remaining');
      const lim = xhr.getResponseHeader('X-RateLimit-Limit');
      if (rem !== null) updateRateLimitUI(rem, lim);
      return data;
    });
}
function updateRateLimitUI(rem, lim) {
  $('#rate-limit-badge').removeClass('hidden low');
  $('#rate-limit-text').text(`${rem}/${lim}`);
  if (parseInt(rem, 10) < 10) $('#rate-limit-badge').addClass('low');
}

/* ================================================================
   LOAD REPO
   ================================================================ */
async function loadRepo(input) {
  const parsed = parseRepoInput(input);
  if (!parsed) { toast('Invalid URL. Use github.com/owner/repo or owner/repo', 'error'); return; }

  showLoading('Fetching repository info…');
  try {
    let meta;
    try { meta = await apiGet(`/repos/${parsed.owner}/${parsed.name}`); }
    catch(e) {
      if (e.status === 404) throw new Error('Repository not found. Check the URL and make sure it\'s public.');
      if (e.status === 403) throw new Error('GitHub API rate limit hit. Please wait a minute and try again.');
      throw new Error('Network error: ' + (e.responseJSON?.message || e.statusText || 'Unknown'));
    }

    const branch = meta.default_branch || 'main';
    State.repo = { owner: parsed.owner, name: parsed.name, branch, fullName: `${parsed.owner}/${parsed.name}`, meta };

    showLoading('Building file tree…');
    let rawTree;
    try {
      rawTree = await fetchTree(parsed.owner, parsed.name, branch);
    } catch(e) {
      if (branch !== 'master') {
        try {
          rawTree = await fetchTree(parsed.owner, parsed.name, 'master');
          State.repo.branch = 'master';
        } catch(_) {
          throw new Error('Could not load file tree: ' + (e.responseJSON?.message || e.message || ''));
        }
      } else throw new Error('Could not load file tree: ' + (e.responseJSON?.message || e.message || ''));
    }

    if (rawTree.truncated) toast('Large repository: tree may be incomplete', 'warn');

    State.tree    = rawTree.tree || rawTree;
    State.treeMap = {};
    (rawTree.tree || rawTree).forEach(i => { State.treeMap[i.path] = i; });
    State.fileIndex   = (rawTree.tree || rawTree).filter(i => i.type === 'blob').map(i => i.path);
    State.fileIndexPos = -1;
    State.openFolders  = new Set();
    State.selectedFiles = new Set();
    clearSelection();

    cacheTreeData();
    addToRecent(State.repo);

    renderRepoInfo(meta);
    renderFileTree();
    updateStatusBar();

    $('#welcome-screen').hide();
    $('#primary-pane').addClass('hidden');

    $('#download-zip-btn').removeClass('hidden');
    $('#status-branch, #status-file-count').removeClass('hidden');
    $('#branch-name').text(State.repo.branch);
    $('#file-count-text').text(State.fileIndex.length + ' files');

    updatePageUrl({ repo: State.repo.fullName, file: null });

    const urlParams = new URLSearchParams(window.location.search);
    const fileParam  = urlParams.get('file');
    if (fileParam && State.treeMap[fileParam]) openFile(fileParam);
    else showWelcomePlaceholder();

    toast(`Loaded ${State.repo.fullName} · ${State.fileIndex.length} files`, 'success');
  } catch(err) {
    toast(err.message, 'error', 6000);
    console.error('[GitPeek]', err);
    showWelcomePlaceholder();
  } finally {
    hideLoading();
  }
}

async function fetchTree(owner, name, branch) {
  return await apiGet(`/repos/${owner}/${name}/git/trees/${branch}?recursive=1`);
}

function cacheTreeData() {
  try {
    localStorage.setItem(
      `gitpeek_tree_${State.repo.fullName}`,
      JSON.stringify({ tree: State.tree, branch: State.repo.branch, ts: Date.now() })
    );
  } catch(e) {}
}

function showWelcomePlaceholder() {
  if (!State.repo) { $('#welcome-screen').show(); return; }
  $('#welcome-screen').hide();
  $('#primary-pane').removeClass('hidden');
  $('#view-mode-btns').addClass('hidden');
  $('#css-inject-btn').addClass('hidden');
  $('#sandbox-toggle-wrap').addClass('hidden');
  $('#primary-content').html(`
    <div class="preview-message">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <p style="color:var(--text-secondary);margin-top:8px;">Select a file to preview</p>
      <p class="sub">Click any file in the tree on the left</p>
    </div>`);
  renderBreadcrumb('primary-breadcrumb', '');
}

/* ================================================================
   REPO INFO PANEL
   ================================================================ */
function renderRepoInfo(meta) {
  const depth = calcMaxDepth(State.tree);
  const folderCount = State.tree.filter(i => i.type === 'tree').length;
  $('#repo-info-card').removeClass('hidden');
  $('#owner-avatar').attr('src', meta.owner?.avatar_url || '').attr('alt', meta.owner?.login || '');
  $('#repo-full-name').text(meta.full_name || State.repo.fullName);
  $('#repo-meta').html(
    `<span title="Files">${State.fileIndex.length} files</span> &nbsp;·&nbsp; ` +
    `<span title="Folders">${folderCount} folders</span> &nbsp;·&nbsp; ` +
    `<span title="Max depth">depth ${depth}</span>`
  );
}

function calcMaxDepth(tree) {
  let max = 0;
  (tree || []).forEach(i => { const d = i.path.split('/').length; if (d > max) max = d; });
  return max;
}

/* ================================================================
   FILE TREE RENDERING
   ================================================================ */
function buildNodeTree(items) {
  const root = {};
  (items || []).forEach(item => {
    const parts = item.path.split('/');
    let node = root;
    parts.forEach((part, idx) => {
      if (!node[part]) node[part] = { _item: null, _children: {}, _name: part };
      if (idx === parts.length - 1) node[part]._item = item;
      node = node[part]._children;
    });
  });
  return root;
}

function renderFileTree() {
  const $tree = $('#file-tree');
  $tree.empty();
  $('#tree-empty').remove();
  if (!State.tree || State.tree.length === 0) {
    $tree.html('<div class="empty-state" id="tree-empty"><p>No files found</p></div>');
    return;
  }
  const structure = buildNodeTree(State.tree);
  const $container = $('<div>');
  renderNodeChildren(structure, $container, '', 0);
  $tree.append($container.children());
}

function sortEntries(node) {
  return Object.entries(node).sort(([aName, aVal], [bName, bVal]) => {
    const aIsDir = aVal._item ? aVal._item.type === 'tree' : Object.keys(aVal._children).length > 0;
    const bIsDir = bVal._item ? bVal._item.type === 'tree' : Object.keys(bVal._children).length > 0;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function renderNodeChildren(node, $parent, parentPath, depth) {
  sortEntries(node).forEach(([name, val]) => {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    const isDir    = val._item ? val._item.type === 'tree' : Object.keys(val._children).length > 0;
    const isOpen   = State.openFolders.has(fullPath);
    const hasKids  = Object.keys(val._children).length > 0;
    const $item = buildTreeItem(name, fullPath, isDir, isOpen, depth);
    $parent.append($item);
    if (isDir && hasKids) {
      const $kids = $('<div class="tree-children" data-path="' + escHtml(fullPath) + '">');
      if (isOpen) $kids.addClass('open');
      renderNodeChildren(val._children, $kids, fullPath, depth + 1);
      $parent.append($kids);
    }
  });
}

function buildTreeItem(name, fullPath, isDir, isOpen, depth) {
  const ext      = isDir ? null : getExt(name);
  const isStarred = !!State.favorites[fullPath];
  const isActive  = State.activeFile === fullPath;

  let indentHtml = '';
  for (let i = 0; i < depth; i++) indentHtml += '<span class="tree-indent-line"></span>';

  const chevron = isDir
    ? `<svg class="tree-chevron${isOpen ? ' open' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`
    : '<span style="width:12px;display:inline-block;flex-shrink:0"></span>';

  const badge = (!isDir && CONFIG.BADGE[ext])
    ? `<span class="file-badge badge-${getBadgeClass(ext)}">${CONFIG.BADGE[ext]}</span>`
    : '';

  const starBtn = !isDir
    ? `<button class="tree-star-btn${isStarred ? ' starred' : ''}" data-path="${escHtml(fullPath)}" title="${isStarred ? 'Unstar' : 'Star'}">
         <svg width="11" height="11" viewBox="0 0 24 24" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
       </button>`
    : '';

  // Checkbox for batch selection (files only)
  const checkBox = !isDir
    ? `<input type="checkbox" class="file-select-cb" data-path="${escHtml(fullPath)}" title="Select for batch download" style="margin-right:3px;cursor:pointer;accent-color:var(--accent-blue);flex-shrink:0">`
    : '';

  const $el = $(`
    <div class="tree-item${isActive ? ' active' : ''}" data-path="${escHtml(fullPath)}" data-dir="${isDir ? '1' : '0'}" role="treeitem" aria-expanded="${isDir ? (isOpen ? 'true' : 'false') : undefined}" tabindex="0">
      <div class="tree-item-inner">
        <div class="tree-indent">${indentHtml}</div>
        ${chevron}
        ${fileIconSvg(name, isDir, isOpen)}
        <span class="tree-name">${escHtml(name)}</span>
        ${badge}
        ${checkBox}
        ${starBtn}
      </div>
    </div>
  `);
  return $el;
}

function getBadgeClass(ext) {
  const map = {
    js:'js', jsx:'jsx', ts:'ts', tsx:'tsx', mjs:'js', cjs:'js',
    css:'css', scss:'scss', sass:'scss', less:'css',
    html:'html', htm:'html', xml:'html', json:'json',
    yaml:'yml', yml:'yml', toml:'json', md:'md', mdx:'md',
    py:'py', rb:'rb', go:'go', rs:'rs', java:'java', kt:'ts',
    swift:'ts', c:'c', cpp:'cpp', cs:'cs', php:'php',
    sh:'sh', bash:'sh', zsh:'sh', vue:'html', svelte:'html',
    png:'img', jpg:'img', jpeg:'img', gif:'img', webp:'img',
    ico:'img', svg:'img', mp4:'img', webm:'img',
    lock:'lock', txt:'txt', dockerfile:'sh',
  };
  return map[ext] || 'txt';
}

/* ================================================================
   FILE TREE EVENTS
   ================================================================ */
$(document).on('click', '.tree-item', function(e) {
  const $item = $(this);
  const path  = $item.data('path');
  const isDir = $item.data('dir') === 1 || $item.data('dir') === '1';

  if ($(e.target).hasClass('tree-star-btn') || $(e.target).closest('.tree-star-btn').length) return;
  if ($(e.target).hasClass('file-select-cb')) return;

  if (isDir) {
    toggleFolder(path);
  } else {
    if ((e.ctrlKey || e.metaKey) && State.isSplitOpen) {
      openFileInPane(path, 'secondary');
    } else {
      openFile(path);
    }
  }
});

$(document).on('click', '.tree-star-btn', function(e) {
  e.stopPropagation();
  toggleFavorite($(this).data('path'));
});

$(document).on('change', '.file-select-cb', function(e) {
  e.stopPropagation();
  const path = $(this).data('path');
  if ($(this).is(':checked')) State.selectedFiles.add(path);
  else State.selectedFiles.delete(path);
  updateSelectedDownloadUI();
});

$(document).on('keydown', '.tree-item', function(e) {
  if (e.key === 'Enter' || e.key === ' ') { $(this).trigger('click'); e.preventDefault(); }
});

/* Hover preview */
$(document).on('mouseenter', '.tree-item[data-dir="0"]', function(e) {
  const path = $(this).data('path');
  clearTimeout(State.hoverTimer);
  State.hoverTimer = setTimeout(() => showHoverPreview(path, e), 600);
});
$(document).on('mouseleave', '.tree-item', function() {
  clearTimeout(State.hoverTimer);
  hideHoverPreview();
});
$(document).on('mousemove', '.tree-item', function(e) { positionHoverPreview(e); });

function toggleFolder(path) {
  const $kids = $(`.tree-children[data-path="${CSS.escape(path)}"]`);
  const $chevron = $(`.tree-item[data-path="${CSS.escape(path)}"] .tree-chevron`);
  if (State.openFolders.has(path)) {
    State.openFolders.delete(path);
    $kids.removeClass('open');
    $chevron.removeClass('open');
    $(`.tree-item[data-path="${CSS.escape(path)}"]`).attr('aria-expanded','false');
  } else {
    State.openFolders.add(path);
    $kids.addClass('open');
    $chevron.addClass('open');
    $(`.tree-item[data-path="${CSS.escape(path)}"]`).attr('aria-expanded','true');
  }
}

function collapseAll() {
  State.openFolders.clear();
  $('.tree-children').removeClass('open');
  $('.tree-chevron').removeClass('open');
  $('.tree-item[data-dir="1"]').attr('aria-expanded','false');
}

/* ================================================================
   BATCH DOWNLOAD BAR
   - Files are selected via checkboxes
   - Download bar shows with explicit "Download X Files" button
   - No auto-download ever happens on selection
   ================================================================ */
function updateSelectedDownloadUI() {
  const count = State.selectedFiles.size;
  let $bar = $('#selected-dl-bar');

  if (count === 0) {
    $bar.remove();
    return;
  }

  if (!$bar.length) {
    $bar = $(`
      <div id="selected-dl-bar" style="
        position:sticky;bottom:0;left:0;right:0;
        background:var(--bg-overlay);
        border-top:1px solid var(--border-default);
        padding:8px 12px;
        display:flex;align-items:center;gap:8px;z-index:50;">
        <span id="sel-count" style="font-size:12px;color:var(--text-secondary);flex:1;"></span>
        <button id="dl-selected-btn" style="
          background:var(--accent-blue);color:#fff;border:none;
          padding:5px 14px;border-radius:5px;font-size:12px;
          cursor:pointer;font-family:var(--font-ui);">
          ⬇ Download Selected
        </button>
        <button id="clear-sel-btn" style="
          background:none;border:none;color:var(--text-muted);
          font-size:12px;cursor:pointer;padding:5px;" title="Clear selection">✕</button>
      </div>`);
    $('#sidebar').append($bar);
    // Bind inside creation so it always has a fresh reference
    $bar.on('click', '#dl-selected-btn', startBatchDownload);
    $bar.on('click', '#clear-sel-btn',   clearSelection);
  }

  $bar.find('#sel-count').text(
    `${count} file${count !== 1 ? 's' : ''} selected`
  );
  // Update button text with count
  $bar.find('#dl-selected-btn').text(`⬇ Download ${count} File${count !== 1 ? 's' : ''}`);
}

/** User explicitly clicked "Download X Files" — actually trigger downloads */
async function startBatchDownload() {
  const files = [...State.selectedFiles];
  if (files.length === 0) return;

  toast(`Starting download of ${files.length} file${files.length > 1 ? 's' : ''}…`, 'info', 3000);

  for (const path of files) {
    await new Promise(res => setTimeout(res, 350));
    triggerFileDownload(path);
  }

  clearSelection();
}

/** Trigger a single file download via <a> link (browser handles dialog) */
function triggerFileDownload(path) {
  const url  = rawUrl(path);
  const name = getFilename(path);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = name;
  a.target   = '_blank';
  a.rel      = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function clearSelection() {
  State.selectedFiles.clear();
  $('.file-select-cb').prop('checked', false);
  updateSelectedDownloadUI();
}

/* ================================================================
   OPEN FILE
   ================================================================ */
async function openFile(path, pane = 'primary') {
  if (!State.treeMap[path]) { toast('File not found in tree', 'error'); return; }

  if (pane === 'primary') {
    State.activeFile = path;
    State.fileIndexPos = State.fileIndex.indexOf(path);
    $('.tree-item').removeClass('active');
    $(`.tree-item[data-path="${CSS.escape(path)}"]`).addClass('active');
    expandParentsOf(path);
    updatePageUrl({ repo: State.repo.fullName, file: path });
    updateStatusBar();
  } else {
    State.splitFile = path;
  }

  await openFileInPane(path, pane);
}

async function openFileInPane(path, pane) {
  const $pane    = pane === 'primary' ? $('#primary-pane')      : $('#secondary-pane');
  const $content = pane === 'primary' ? $('#primary-content')   : $('#secondary-content');
  const $bc      = pane === 'primary' ? $('#primary-breadcrumb'): $('#secondary-breadcrumb');
  const $rawBtn  = pane === 'primary' ? $('#primary-raw-btn')   : $('#secondary-raw-btn');
  const $ghBtn   = pane === 'primary' ? $('#primary-github-btn'): null;
  const $starBtn = pane === 'primary' ? $('#primary-star-btn')  : $('#secondary-star-btn');

  $pane.removeClass('hidden');
  $('#welcome-screen').hide();

  renderBreadcrumb($bc, path);
  $rawBtn.attr('href', rawUrl(path));
  if ($ghBtn) $ghBtn.attr('href', githubFileUrl(path));

  const isStarred = !!State.favorites[path];
  $starBtn.toggleClass('starred', isStarred);

  const ext       = getExt(path);
  const isDualPaneFile = CONFIG.DUAL_PANE_EXTS.has(ext);

  // Show/hide header controls for primary pane
  if (pane === 'primary') {
    // View mode buttons — only for HTML and MD
    $('#view-mode-btns').toggleClass('hidden', !isDualPaneFile);

    // CSS inject toggle — only for HTML
    const isHtml = ext === 'html' || ext === 'htm';
    $('#css-inject-btn').toggleClass('hidden', !isHtml);
    if (isHtml) updateCssToggleBtn();

    // Legacy sandbox toggle
    $('#sandbox-toggle-wrap').toggleClass('hidden', !isHtml);

    // Reset view mode to split when switching to a dual-pane file
    if (isDualPaneFile) {
      State.viewMode = 'split';
      $('.view-mode-btn').removeClass('active');
      $('.view-mode-btn[data-mode="split"]').addClass('active');
    }
  }

  // Loading spinner
  $content.html('<div class="preview-message"><div class="loading-ring"></div></div>');

  try {
    if (isDualPaneFile && pane === 'primary') {
      // Auto split: code left, rendered preview right
      const html = await buildDualPaneHtml(path, ext);
      $content.html(html);
      postProcessDualPane($content, path);
    } else {
      const html = await buildPreviewHtml(path);
      $content.html(html);
      postProcessPreview($content, path, pane);
    }
  } catch(err) {
    $content.html(`
      <div class="preview-message">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>
        <p>Failed to load file</p>
        <p class="sub">${escHtml(err.message)}</p>
        <a href="${escHtml(rawUrl(path))}" target="_blank" style="color:var(--accent-blue);font-size:12px;margin-top:8px;">Open raw file ↗</a>
      </div>`);
  }
}

/* ================================================================
   DUAL PANE (code + preview) for HTML and MD
   ================================================================ */
async function buildDualPaneHtml(path, ext) {
  const { text, fromCache } = await fetchFileContent(path);
  if (fromCache) toast('Loaded from offline cache', 'info', 2000);

  // — Code side —
  const lang   = CONFIG.PRISM_MAP[ext] || 'plain';
  const escaped = escHtml(text);
  const codeHtml = `<div class="code-wrap"><pre class="line-numbers language-${lang}"><code class="language-${lang}">${escaped}</code></pre></div>`;

  // — Preview side —
  let previewHtml = '';

  if (ext === 'md' || ext === 'mdx') {
    previewHtml = renderMarkdown(text);
  } else if (ext === 'html' || ext === 'htm') {
    previewHtml = await buildHtmlPreview(text, path);
  }

  return `
    <div class="dual-pane-wrap" id="dual-pane-main">
      <div class="dual-code-side">
        <div class="dual-pane-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          SOURCE CODE
        </div>
        <div class="dual-pane-scroll">${codeHtml}</div>
      </div>
      <div class="dual-preview-side">
        <div class="dual-pane-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          ${ext === 'md' || ext === 'mdx' ? 'RENDERED MARKDOWN' : 'HTML PREVIEW'}
          ${(ext === 'html' || ext === 'htm') ? `<span class="dual-pane-css-badge" style="margin-left:auto;font-size:9px;padding:1px 6px;border-radius:3px;background:${State.applyCss ? 'rgba(63,185,80,.15)' : 'rgba(139,148,158,.1)'};color:${State.applyCss ? 'var(--accent-green)' : 'var(--text-muted)'};">${State.applyCss ? 'CSS ON' : 'CSS OFF'}</span>` : ''}
        </div>
        <div class="dual-pane-scroll dual-preview-scroll">${previewHtml}</div>
      </div>
    </div>`;
}

/** Build the HTML sandbox iframe HTML (with optional CSS injection) */
async function buildHtmlPreview(htmlText, filePath) {
  let processed = htmlText;

  if (State.applyCss) {
    processed = await injectCSSFromRepo(htmlText, filePath);
  }

  // Sanitize
  const clean = typeof DOMPurify !== 'undefined'
    ? DOMPurify.sanitize(processed, { WHOLE_DOCUMENT: true, FORCE_BODY: false })
    : processed;

  const strict = $('#sandbox-strict').is(':checked');
  const sandboxAttr = strict
    ? 'sandbox="allow-scripts"'
    : 'sandbox="allow-scripts allow-same-origin allow-forms"';

  // Use srcdoc attribute — no URL-length limit, proper escaping
  const srcdocEscaped = clean.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<iframe class="sandbox-iframe dual-iframe" srcdoc="${srcdocEscaped}" ${sandboxAttr} title="HTML Preview"></iframe>`;
}

function postProcessDualPane($content, path) {
  // Syntax highlight the code side
  $content.find('pre code').each(function() {
    if (typeof Prism !== 'undefined') Prism.highlightElement(this);
  });

  // Apply view mode
  applyViewMode($content);

  // Markdown TOC
  const ext = getExt(path);
  if (ext === 'md' || ext === 'mdx') {
    buildMarkdownTOC($content.find('.dual-preview-scroll'));
  } else {
    $('#md-toc-panel').addClass('hidden');
  }
}

/* ================================================================
   VIEW MODE TOGGLE (Split / Code / Preview)
   ================================================================ */
function applyViewMode($container) {
  const $dp = ($container || $('#primary-content')).find('#dual-pane-main');
  if (!$dp.length) return;
  $dp.removeClass('code-only preview-only');
  if (State.viewMode === 'code')    $dp.addClass('code-only');
  if (State.viewMode === 'preview') $dp.addClass('preview-only');
}

/* ================================================================
   SINGLE-PANE PREVIEW (non-HTML/MD files)
   ================================================================ */
async function buildPreviewHtml(path) {
  const ext  = getExt(path);
  const name = getFilename(path);

  if (CONFIG.IMAGE_EXTS.has(ext)) {
    return `<div class="image-preview-wrap">
      <img src="${escHtml(rawUrl(path))}" alt="${escHtml(name)}" loading="lazy" />
      <div class="image-meta">${escHtml(name)}</div>
    </div>`;
  }

  if (CONFIG.VIDEO_EXTS.has(ext)) {
    return `<div class="video-preview-wrap"><video controls src="${escHtml(rawUrl(path))}"></video></div>`;
  }

  if (ext === 'pdf') {
    return `<div class="preview-message">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
      <p>PDF preview not supported</p>
      <a href="${escHtml(rawUrl(path))}" target="_blank" style="color:var(--accent-blue);font-size:12px;margin-top:8px;">Download PDF ↗</a>
    </div>`;
  }

  if (CONFIG.TEXT_EXTS.has(ext) || isLikelyText(name)) {
    const { text, fromCache } = await fetchFileContent(path);
    if (fromCache) toast('Loaded from offline cache', 'info', 2000);

    // Code syntax view
    const lang    = CONFIG.PRISM_MAP[ext] || 'plain';
    const escaped = escHtml(text);
    return `<div class="code-wrap"><pre class="line-numbers language-${lang}"><code class="language-${lang}">${escaped}</code></pre></div>`;
  }

  // Unknown / binary
  const itemInfo = State.treeMap[path];
  const sizeStr  = itemInfo?.size ? ` (${formatSize(itemInfo.size)})` : '';
  return `<div class="preview-message">
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    <p style="color:var(--text-secondary)">${escHtml(name)}${escHtml(sizeStr)}</p>
    <p class="sub">Binary file — preview not supported</p>
    <button onclick="triggerFileDownload('${escHtml(path)}')" style="display:inline-flex;align-items:center;gap:6px;margin-top:12px;padding:7px 16px;background:var(--accent-blue);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12.5px;">
      ⬇ Download File
    </button>
  </div>`;
}

function isLikelyText(name) {
  const n = name.toLowerCase();
  return ['makefile','dockerfile','readme','license','changelog','contributing',
          '.gitignore','.gitattributes','.editorconfig','.env','.nvmrc','.npmrc',
          '.prettierrc','.eslintrc','.babelrc'].some(k => n.includes(k));
}

function renderMarkdown(text) {
  if (typeof marked === 'undefined') return `<pre style="padding:24px;font-family:var(--font-code)">${escHtml(text)}</pre>`;
  marked.setOptions({ breaks: true, gfm: true });
  const raw   = marked.parse(text);
  const clean = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(raw) : raw;
  return `<div class="markdown-body" id="md-body">${clean}</div>`;
}

function renderHtmlSandbox(htmlText) {
  const strict = $('#sandbox-strict').is(':checked');
  const sandboxAttr = strict
    ? 'sandbox="allow-scripts"'
    : 'sandbox="allow-scripts allow-same-origin allow-forms"';
  const clean = typeof DOMPurify !== 'undefined'
    ? DOMPurify.sanitize(htmlText, { WHOLE_DOCUMENT: true, FORCE_BODY: false })
    : htmlText;
  const srcdocEscaped = clean.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<iframe class="sandbox-iframe" srcdoc="${srcdocEscaped}" ${sandboxAttr} title="HTML Preview"></iframe>`;
}

function postProcessPreview($content, path, pane) {
  if ($content.find('pre code').length && typeof Prism !== 'undefined') {
    $content.find('pre code').each(function() { Prism.highlightElement(this); });
  }
  $('#md-toc-panel').addClass('hidden');
}

/* ================================================================
   FETCH FILE CONTENT (with Cache API)
   ================================================================ */
async function fetchFileContent(path) {
  const url = rawUrl(path);

  if ('caches' in window) {
    try {
      const cache  = await caches.open(CONFIG.CACHE_NAME);
      const cached = await cache.match(url);
      if (cached) return { text: await cached.text(), fromCache: true };
    } catch(e) {}
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${path}`);

  if ('caches' in window) {
    try {
      const cache = await caches.open(CONFIG.CACHE_NAME);
      cache.put(url, resp.clone());
    } catch(e) {}
  }

  return { text: await resp.text(), fromCache: false };
}

/* ================================================================
   BREADCRUMB
   ================================================================ */
function renderBreadcrumb($el, path) {
  if (typeof $el === 'string') $el = $('#' + $el);
  if (!path) { $el.html(`<span class="bread-part">${State.repo ? escHtml(State.repo.fullName) : 'GitPeek'}</span>`); return; }
  const parts = path.split('/');
  let html = '';
  if (State.repo) {
    html += `<span class="bread-part" style="cursor:pointer" data-repo-root="1">${escHtml(State.repo.name)}</span>`;
  }
  parts.forEach(part => {
    html += `<span class="bread-sep">/</span><span class="bread-part">${escHtml(part)}</span>`;
  });
  $el.html(html);
}

/* ================================================================
   MARKDOWN TOC
   ================================================================ */
function buildMarkdownTOC($container) {
  const $search = ($container && $container.length) ? $container : $('#primary-content');
  const headings = $search.find('#md-body h1, #md-body h2, #md-body h3, #md-body h4');
  if (headings.length < 3) { $('#md-toc-panel').addClass('hidden'); return; }

  $('#md-toc-panel').removeClass('hidden');
  const $toc = $('#md-toc-content').empty();

  headings.each(function(i) {
    const $h = $(this);
    const tag = this.tagName.toLowerCase();
    const id  = 'heading-' + i;
    $h.attr('id', id);
    const $link = $(`<a class="toc-item toc-${tag}" href="#${id}">${escHtml($h.text())}</a>`);
    $link.on('click', function(e) {
      e.preventDefault();
      $h[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('.toc-item').removeClass('active');
      $link.addClass('active');
    });
    $toc.append($link);
  });
  $('#close-toc-btn').off('click').on('click', () => $('#md-toc-panel').addClass('hidden'));
}

/* ================================================================
   HOVER PREVIEW
   ================================================================ */
async function showHoverPreview(path, e) {
  const $preview = $('#hover-preview');
  const name = getFilename(path);
  const ext  = getExt(path);
  let contentHtml = '';

  if (CONFIG.IMAGE_EXTS.has(ext)) {
    contentHtml = `
      <div class="hover-preview-header">${escHtml(name)}</div>
      <img src="${escHtml(rawUrl(path))}" alt="${escHtml(name)}" style="max-width:260px;max-height:140px;object-fit:contain;display:block;margin:8px auto;" />`;
  } else if (CONFIG.TEXT_EXTS.has(ext) || isLikelyText(name)) {
    try {
      const resp = await fetch(rawUrl(path));
      if (resp.ok) {
        const text  = await resp.text();
        const lines = text.split('\n').slice(0, CONFIG.PREVIEW_LINES).join('\n');
        contentHtml = `
          <div class="hover-preview-header">${escHtml(name)} · ${text.split('\n').length} lines</div>
          <div class="hover-preview-body">${escHtml(lines)}</div>`;
      }
    } catch(e) {
      contentHtml = `<div class="hover-preview-header">${escHtml(name)}</div><div class="hover-preview-body">Preview unavailable</div>`;
    }
  } else {
    const item = State.treeMap[path];
    const sz   = item?.size ? formatSize(item.size) : '';
    contentHtml = `<div class="hover-preview-header">${escHtml(name)}${sz ? ' · ' + sz : ''}</div><div class="hover-preview-body">Binary file</div>`;
  }

  $('#hover-preview-content').html(contentHtml);
  positionHoverPreview(e);
  $preview.addClass('visible');
}

function positionHoverPreview(e) {
  const $p = $('#hover-preview');
  if (!$p.hasClass('visible')) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX + 16, y = e.clientY + 10;
  const pw = $p.outerWidth(true) || 280;
  const ph = $p.outerHeight(true) || 120;
  if (x + pw > vw - 10) x = e.clientX - pw - 8;
  if (y + ph > vh - 10) y = e.clientY - ph - 8;
  $p.css({ left: x + 'px', top: y + 'px' });
}

function hideHoverPreview() { $('#hover-preview').removeClass('visible'); }

/* ================================================================
   FAVORITES
   ================================================================ */
function toggleFavorite(path) {
  const name = getFilename(path);
  if (State.favorites[path]) {
    delete State.favorites[path];
    toast('Removed from favorites', 'info', 2000);
  } else {
    State.favorites[path] = { path, name, repo: State.repo?.fullName, ts: Date.now() };
    toast('⭐ Added to favorites', 'success', 2000);
  }
  saveFavorites();

  const $btn = $(`.tree-star-btn[data-path="${CSS.escape(path)}"]`);
  const isNowStarred = !!State.favorites[path];
  $btn.toggleClass('starred', isNowStarred)
      .find('svg').attr('fill', isNowStarred ? 'currentColor' : 'none');
  $btn.attr('title', isNowStarred ? 'Unstar' : 'Star');

  if (State.activeFile === path) $('#primary-star-btn').toggleClass('starred', isNowStarred);
  if (State.splitFile  === path) $('#secondary-star-btn').toggleClass('starred', isNowStarred);

  renderFavoritesList();
}

function renderFavoritesList() {
  const $list = $('#favorites-list').empty();
  const favs  = Object.values(State.favorites);
  if (favs.length === 0) {
    $list.html(`<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div><p>No starred files yet</p><p class="empty-sub">Click ★ on any file to save it</p></div>`);
    return;
  }
  favs.sort((a,b) => b.ts - a.ts).forEach(fav => {
    const ext   = getExt(fav.name);
    const badge = CONFIG.BADGE[ext] ? `<span class="file-badge badge-${getBadgeClass(ext)}" style="font-size:9px">${CONFIG.BADGE[ext]}</span>` : '';
    const $item = $(`
      <div class="list-item" title="${escHtml(fav.path)}">
        ${fileIconSvg(fav.name, false, false)}
        <div style="flex:1;min-width:0">
          <div class="list-item-name">${escHtml(fav.name)} ${badge}</div>
          <div class="list-item-sub">${escHtml(fav.repo || '')}</div>
        </div>
        <button class="list-item-remove fav-remove" data-path="${escHtml(fav.path)}" title="Remove">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>
        </button>
      </div>`);
    $item.on('click', function(e) {
      if ($(e.target).closest('.fav-remove').length) { toggleFavorite(fav.path); return; }
      if (State.repo?.fullName !== fav.repo && fav.repo) {
        loadRepo(fav.repo).then(() => openFile(fav.path));
      } else if (State.treeMap[fav.path]) {
        openFile(fav.path);
      } else {
        toast('Load the repo first to open this file', 'warn');
      }
    });
    $list.append($item);
  });
}

/* ================================================================
   RECENT REPOS
   ================================================================ */
function renderRecentList() {
  const $list = $('#recent-list').empty();
  if (State.recent.length === 0) {
    $list.html(`<div class="empty-state"><div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><p>No recent repos</p><p class="empty-sub">Visited repos appear here</p></div>`);
    return;
  }
  State.recent.forEach(r => {
    const $item = $(`
      <div class="recent-item">
        <div style="display:flex;align-items:center;gap:8px">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" stroke-width="2"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/></svg>
          <span class="recent-item-name">${escHtml(r.name)}</span>
        </div>
        <div class="recent-item-url">${escHtml(r.owner)}/${escHtml(r.name)}</div>
        <div class="recent-item-time">${timeAgo(r.time)}</div>
      </div>`);
    $item.on('click', () => {
      $('#repo-input').val(`${r.owner}/${r.name}`);
      loadRepo(`${r.owner}/${r.name}`);
    });
    $list.append($item);
  });
}

/* ================================================================
   SEARCH
   ================================================================ */
let searchDebounce = null;
function handleSearch(query) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => runSearch(query), 80);
}

function runSearch(query) {
  const $results = $('#search-results').empty();
  const $clear   = $('#search-clear');
  query = query.trim().toLowerCase();

  if (!query) {
    $clear.addClass('hidden');
    $results.html('<p class="search-hint">Type to search across all filenames</p>');
    $('.tree-name').each(function() { $(this).html(escHtml($(this).text())); });
    return;
  }
  $clear.removeClass('hidden');

  if (!State.tree || State.tree.length === 0) {
    $results.html('<p class="search-hint">Load a repository first</p>');
    return;
  }

  const matches = State.tree.filter(item =>
    item.type === 'blob' && item.path.toLowerCase().includes(query)
  ).slice(0, 100);

  if (matches.length === 0) {
    $results.html('<p class="search-hint">No files match "' + escHtml(query) + '"</p>');
    return;
  }

  $results.append(`<p class="search-count">${matches.length} result${matches.length !== 1 ? 's' : ''}</p>`);
  matches.forEach(item => {
    const name  = getFilename(item.path);
    const dir   = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : '';
    const ext   = getExt(name);
    const badge = CONFIG.BADGE[ext] ? `<span class="file-badge badge-${getBadgeClass(ext)}" style="font-size:9px">${CONFIG.BADGE[ext]}</span>` : '';
    const hl    = highlightMatch(name, query);
    const $item = $(`
      <div class="search-result-item">
        ${fileIconSvg(name, false, false)}
        <div style="flex:1;min-width:0">
          <div class="search-result-name">${hl} ${badge}</div>
          <div class="search-result-path">${escHtml(dir)}</div>
        </div>
      </div>`);
    $item.on('click', () => {
      openFile(item.path);
      switchTab('explorer');
      revealInTree(item.path);
    });
    $results.append($item);
  });

  highlightTreeMatches(query);
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escHtml(text);
  return escHtml(text.slice(0, idx)) +
    '<mark>' + escHtml(text.slice(idx, idx + query.length)) + '</mark>' +
    escHtml(text.slice(idx + query.length));
}

function highlightTreeMatches(query) {
  $('.tree-item[data-dir="0"]').each(function() {
    const path = $(this).data('path');
    const name = getFilename(path);
    const $nm  = $(this).find('.tree-name');
    if (!query) {
      $nm.html(escHtml(name));
      $(this).removeClass('highlighted');
    } else if (name.toLowerCase().includes(query.toLowerCase())) {
      $nm.html(highlightMatch(name, query));
      $(this).addClass('highlighted');
    } else {
      $nm.html(escHtml(name));
      $(this).removeClass('highlighted');
    }
  });
}

function revealInTree(path) {
  expandParentsOf(path);
  setTimeout(() => {
    const $item = $(`.tree-item[data-path="${CSS.escape(path)}"]`);
    if ($item.length) {
      $item[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      $item.addClass('active');
    }
  }, 100);
}

function expandParentsOf(path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const folderPath = parts.slice(0, i).join('/');
    if (!State.openFolders.has(folderPath)) toggleFolder(folderPath);
  }
}

/* ================================================================
   SPLIT VIEW (two file panes side-by-side)
   ================================================================ */
function toggleSplitView() {
  State.isSplitOpen = !State.isSplitOpen;
  $('#split-btn').toggleClass('active', State.isSplitOpen);
  if (!State.isSplitOpen) {
    $('#secondary-pane').addClass('hidden');
    State.splitFile = null;
  } else {
    $('#secondary-pane').removeClass('hidden');
    $('#welcome-screen').hide();
    if (!State.activeFile) {
      $('#secondary-content').html(`<div class="preview-message"><p style="color:var(--text-secondary)">Select a file to preview here</p><p class="sub">Ctrl+Click a file in the tree to open here</p></div>`);
      renderBreadcrumb($('#secondary-breadcrumb'), '');
    } else {
      openFileInPane(State.activeFile, 'secondary');
    }
    toast('Split view — Ctrl+Click a file to open in right pane', 'info', 3000);
  }
}

/* ================================================================
   SIDEBAR
   ================================================================ */
function toggleSidebar() {
  State.isSidebarOpen = !State.isSidebarOpen;
  const $sb = $('#sidebar');
  if (window.innerWidth <= 768) {
    $sb.toggleClass('mobile-open', State.isSidebarOpen);
    $('#mobile-overlay').toggleClass('visible', State.isSidebarOpen);
  } else {
    $sb.toggleClass('collapsed', !State.isSidebarOpen);
  }
}

function switchTab(tab) {
  $('.sidebar-tab').removeClass('active').attr('aria-selected','false');
  $('.sidebar-panel').removeClass('active').attr('aria-hidden','true');
  $(`.sidebar-tab[data-tab="${tab}"]`).addClass('active').attr('aria-selected','true');
  $(`#panel-${tab}`).addClass('active').attr('aria-hidden','false');
  if (!State.isSidebarOpen) {
    State.isSidebarOpen = true;
    $('#sidebar').removeClass('collapsed');
  }
}

/* ================================================================
   SIDEBAR RESIZE
   ================================================================ */
function initSidebarResize() {
  const $handle = $('#sidebar-resize');
  const $sb     = $('#sidebar');
  let startX, startW;

  $handle.on('mousedown', function(e) {
    startX = e.clientX;
    startW = $sb.outerWidth();
    State.isResizing = true;
    $handle.addClass('resizing');
    $('body').css('cursor','col-resize').css('user-select','none');
    e.preventDefault();
  });

  $(document).on('mousemove', function(e) {
    if (!State.isResizing) return;
    const newW = Math.max(180, Math.min(500, startW + e.clientX - startX));
    $sb.css('width', newW + 'px');
  });

  $(document).on('mouseup', function() {
    if (!State.isResizing) return;
    State.isResizing = false;
    $handle.removeClass('resizing');
    $('body').css('cursor','').css('user-select','');
    localStorage.setItem(CONFIG.LS_SIDEBAR_W, $('#sidebar').outerWidth());
  });
}

/* ================================================================
   DRAG & DROP
   ================================================================ */
function initDragDrop() {
  const $body = $(document.body);
  $body.on('dragover', function(e) {
    e.preventDefault();
    $('#drag-drop-zone, #welcome-drop-zone').addClass('drag-over');
  });
  $body.on('dragleave', function(e) {
    if (!$(e.relatedTarget).closest('#drag-drop-zone, #welcome-drop-zone').length) {
      $('#drag-drop-zone, #welcome-drop-zone').removeClass('drag-over');
    }
  });
  $body.on('drop', function(e) {
    e.preventDefault();
    $('#drag-drop-zone, #welcome-drop-zone').removeClass('drag-over');
    const dt  = e.originalEvent?.dataTransfer;
    if (!dt) return;
    const uri  = dt.getData('text/uri-list');
    const text = dt.getData('text/plain');
    const raw  = (uri || text || '').split('\n')[0].trim();
    if (raw && raw.includes('github.com')) {
      const parsed = parseRepoInput(raw);
      if (parsed) {
        $('#repo-input').val(`${parsed.owner}/${parsed.name}`);
        loadRepo(raw);
      }
    } else {
      toast('Drop a GitHub repository URL', 'warn');
    }
  });
}

/* ================================================================
   MOBILE SWIPE
   ================================================================ */
function initMobileSwipe() {
  let startX = null;
  $(document).on('touchstart', function(e) { startX = e.originalEvent.touches[0].clientX; });
  $(document).on('touchend', function(e) {
    if (startX === null) return;
    const dx = e.originalEvent.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < 60) { startX = null; return; }
    if (dx > 0 && startX < 30) { if (!State.isSidebarOpen) toggleSidebar(); }
    else if (dx < 0 && State.isSidebarOpen && window.innerWidth <= 768) { toggleSidebar(); }
    else if (Math.abs(dx) > 80 && window.innerWidth <= 768) { navigateFile(dx < 0 ? 1 : -1); }
    startX = null;
  });
}

/* ================================================================
   FILE NAVIGATION
   ================================================================ */
function navigateFile(dir) {
  if (!State.fileIndex.length) return;
  let pos = State.fileIndexPos + dir;
  pos = Math.max(0, Math.min(State.fileIndex.length - 1, pos));
  if (pos === State.fileIndexPos) return;
  State.fileIndexPos = pos;
  openFile(State.fileIndex[pos]);
}

/* ================================================================
   STATUS BAR
   ================================================================ */
function updateStatusBar() {
  if (!State.activeFile) { $('#status-lang').text(''); return; }
  const ext  = getExt(State.activeFile);
  const lang = (CONFIG.PRISM_MAP[ext] || ext).toUpperCase();
  $('#status-lang').text(lang);
}

/* ================================================================
   DEEP LINK
   ================================================================ */
function checkDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const repo   = params.get('repo');
  if (repo) {
    $('#repo-input').val(repo);
    loadRepo(repo);
  }
}

/* ================================================================
   KEYBOARD SHORTCUTS
   ================================================================ */
$(document).on('keydown', function(e) {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && (e.key === 'k' || e.key === 'p')) {
    e.preventDefault();
    switchTab('search');
    setTimeout(() => $('#file-search').focus(), 100);
    return;
  }
  if (ctrl && e.key === '\\') {
    e.preventDefault();
    toggleSplitView();
    return;
  }
  if (ctrl && e.key === 's' && State.activeFile) {
    e.preventDefault();
    toggleFavorite(State.activeFile);
    return;
  }
  if (e.key === 'Escape') {
    $('#theme-dropdown').addClass('hidden');
    if (State.isSplitOpen) toggleSplitView();
    return;
  }
  if (!$(document.activeElement).is('input, textarea')) {
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateFile(1);  return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateFile(-1); return; }
  }
});

/* ================================================================
   EVENT BINDINGS
   ================================================================ */
function bindEvents() {
  // Load repo
  $('#repo-input').on('keydown', function(e) { if (e.key === 'Enter') loadRepo($(this).val()); });
  $('#repo-load-btn').on('click', function() { loadRepo($('#repo-input').val()); });

  // Sidebar tabs
  $(document).on('click', '.sidebar-tab', function() { switchTab($(this).data('tab')); });

  // Sidebar toggle
  $('#sidebar-toggle').on('click', toggleSidebar);

  // Mobile overlay
  $('#mobile-overlay').on('click', function() { if (State.isSidebarOpen) toggleSidebar(); });

  // Split view
  $('#split-btn').on('click', toggleSplitView);
  $('#close-split-btn').on('click', function() { if (State.isSplitOpen) toggleSplitView(); });

  // Theme dropdown
  $('#theme-btn').on('click', function(e) {
    e.stopPropagation();
    const $dd = $('#theme-dropdown');
    $dd.toggleClass('hidden');
    if (!$dd.hasClass('hidden')) {
      const offset = $(this).offset();
      $dd.css({ top: (offset.top + 34) + 'px', right: ($(window).width() - offset.left - $(this).outerWidth() + 4) + 'px', left: 'auto' });
    }
  });
  $(document).on('click', function(e) {
    if (!$(e.target).closest('#theme-dropdown, #theme-btn').length) $('#theme-dropdown').addClass('hidden');
  });
  $(document).on('click', '.dropdown-item[data-theme]', function() {
    applyTheme($(this).data('theme'));
    $('#theme-dropdown').addClass('hidden');
  });

  // Search
  $('#file-search').on('input', function() { handleSearch($(this).val()); });
  $('#search-clear').on('click', function() {
    $('#file-search').val('');
    handleSearch('');
    $('#file-search').focus();
  });

  // Collapse all
  $('#collapse-all-btn').on('click', collapseAll);

  // Download ZIP
  $('#download-zip-btn').on('click', function() {
    if (!State.repo) return;
    window.open(zipUrl(), '_blank', 'noopener,noreferrer');
    toast('Downloading ZIP archive…', 'success');
  });

  // Favorites / recent clear
  $('#clear-favorites-btn').on('click', function() {
    if (!confirm('Clear all favorites?')) return;
    State.favorites = {};
    saveFavorites();
    renderFavoritesList();
    toast('Favorites cleared', 'info');
  });
  $('#clear-recent-btn').on('click', function() {
    if (!confirm('Clear recent repos history?')) return;
    State.recent = [];
    saveRecent();
    renderRecentList();
    toast('Recent history cleared', 'info');
  });

  // Primary pane star
  $('#primary-star-btn').on('click', function() { if (State.activeFile) toggleFavorite(State.activeFile); });

  // Secondary pane star
  $('#secondary-star-btn').on('click', function() { if (State.splitFile) toggleFavorite(State.splitFile); });

  // Primary pane download button — download active file
  $('#primary-download-btn').on('click', function() {
    if (State.activeFile) {
      triggerFileDownload(State.activeFile);
      toast('Downloading ' + getFilename(State.activeFile), 'success', 2000);
    } else {
      toast('No file open', 'warn', 1500);
    }
  });

  // Secondary pane download button
  $('#secondary-download-btn').on('click', function() {
    if (State.splitFile) {
      triggerFileDownload(State.splitFile);
      toast('Downloading ' + getFilename(State.splitFile), 'success', 2000);
    } else {
      toast('No file open in split pane', 'warn', 1500);
    }
  });

  // Raw btn click
  $('#primary-raw-btn, #secondary-raw-btn').on('click', function() {
    toast('Opening raw file…', 'info', 1500);
  });

  // CSS inject toggle
  $('#css-inject-btn').on('click', toggleApplyCss);

  // Sandbox toggle (re-render HTML preview)
  $('#sandbox-strict').on('change', function() {
    if (State.activeFile) {
      const ext = getExt(State.activeFile);
      if (ext === 'html' || ext === 'htm') openFileInPane(State.activeFile, 'primary');
    }
  });

  // View mode toggle buttons (Split / Code / Preview)
  $(document).on('click', '.view-mode-btn', function() {
    $('.view-mode-btn').removeClass('active');
    $(this).addClass('active');
    State.viewMode = $(this).data('mode');
    applyViewMode($('#primary-content'));
  });

  // Breadcrumb root click
  $(document).on('click', '[data-repo-root="1"]', function() { showWelcomePlaceholder(); });

  // Window resize
  $(window).on('resize', function() {
    if (window.innerWidth > 768) {
      $('#mobile-overlay').removeClass('visible');
      if (!State.isSidebarOpen) $('#sidebar').removeClass('mobile-open');
    }
  });
}

/* ================================================================
   OFFLINE MODE
   ================================================================ */
$(window).on('load', function() {
  if (!navigator.onLine) toast('You are offline. Cached files may be available.', 'warn', 5000);
});
window.addEventListener('online',  () => toast('Back online ✓', 'success', 2000));
window.addEventListener('offline', () => toast('You are offline', 'warn', 4000));