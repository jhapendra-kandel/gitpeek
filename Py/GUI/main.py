#!/usr/bin/env python3
"""
  ____ _ _   ____           _    
 / ___(_) |_|  _ \\ ___  ___| | __
| |  _| | __| |_) / _ \\/ _ \\ |/ /
| |_| | | |_|  __/  __/  __/   < 
 \\____|_|\\__|_|   \\___|\\___|\\_|\\_\\

GitPeek — GitHub Repository Explorer (GUI)
Tkinter-based desktop application
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox, font as tkFont
import threading
import json
import os
import re
import webbrowser
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import quote, urlencode
from urllib.error import HTTPError, URLError
import base64

# ─── Optional: pygments for syntax highlighting ───────────────────────────────
try:
    from pygments import highlight
    from pygments.lexers import get_lexer_for_filename, TextLexer
    from pygments.formatters import get_formatter_by_name
    HAS_PYGMENTS = True
except ImportError:
    HAS_PYGMENTS = False

# ─── Optional: requests (falls back to urllib) ────────────────────────────────
try:
    import requests as req_lib
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# ══════════════════════════════════════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════════════════════════════════════
APP_NAME    = "GitPeek"
APP_VERSION = "1.0.0"
API_BASE    = "https://api.github.com"
RAW_BASE    = "https://raw.githubusercontent.com"
DATA_DIR    = Path.home() / ".gitpeek"
RECENT_FILE = DATA_DIR / "recent.json"
FAVS_FILE   = DATA_DIR / "favorites.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)

TEXT_EXTS = {
    'js','jsx','ts','tsx','mjs','cjs','css','scss','sass','less',
    'html','htm','xml','svg','json','jsonc','yaml','yml','toml','ini',
    'env','md','mdx','txt','log','csv','py','rb','go','rs','java',
    'kt','swift','c','cpp','h','hpp','cs','php','pl','lua','r','sh',
    'bash','zsh','fish','ps1','vue','svelte','elm','ex','exs','erl',
    'hs','dart','scala','groovy','makefile','dockerfile','gitignore',
    'editorconfig','prisma','graphql','gql','proto','conf','cfg',
}
IMAGE_EXTS  = {'png','jpg','jpeg','gif','webp','ico','bmp','avif'}
AUTO_SPLIT  = {'html','htm','md','mdx'}

DARK_THEME = {
    'bg':           '#0d1117',
    'bg2':          '#161b22',
    'bg3':          '#21262d',
    'border':       '#30363d',
    'text':         '#e6edf3',
    'text2':        '#8b949e',
    'text3':        '#6e7681',
    'accent':       '#388bfd',
    'accent2':      '#1f6feb',
    'green':        '#3fb950',
    'yellow':       '#e3b341',
    'red':          '#f85149',
    'select_bg':    '#1f6feb',
    'select_fg':    '#ffffff',
    'code_bg':      '#161b22',
}

LIGHT_THEME = {
    'bg':           '#ffffff',
    'bg2':          '#f6f8fa',
    'bg3':          '#eaeef2',
    'border':       '#d0d7de',
    'text':         '#1f2328',
    'text2':        '#656d76',
    'text3':        '#8c959f',
    'accent':       '#0969da',
    'accent2':      '#218bff',
    'green':        '#1a7f37',
    'yellow':       '#9a6700',
    'red':          '#d1242f',
    'select_bg':    '#0969da',
    'select_fg':    '#ffffff',
    'code_bg':      '#f6f8fa',
}


# ══════════════════════════════════════════════════════════════════════════════
# GITHUB API HELPERS
# ══════════════════════════════════════════════════════════════════════════════
def api_get(path, token=None):
    url = path if path.startswith('http') else f"{API_BASE}{path}"
    headers = {'Accept': 'application/vnd.github.v3+json'}
    if token:
        headers['Authorization'] = f'token {token}'
    if HAS_REQUESTS:
        resp = req_lib.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        return resp.json()
    else:
        rq = Request(url, headers=headers)
        with urlopen(rq, timeout=15) as r:
            return json.loads(r.read().decode())

def fetch_raw(owner, name, branch, path):
    url = f"{RAW_BASE}/{owner}/{name}/{branch}/{quote(path, safe='/')}"
    if HAS_REQUESTS:
        resp = req_lib.get(url, timeout=20)
        resp.raise_for_status()
        return resp.text
    else:
        rq = Request(url)
        with urlopen(rq, timeout=20) as r:
            return r.read().decode('utf-8', errors='replace')

def download_raw_bytes(owner, name, branch, path):
    url = f"{RAW_BASE}/{owner}/{name}/{branch}/{quote(path, safe='/')}"
    if HAS_REQUESTS:
        resp = req_lib.get(url, timeout=30, stream=True)
        resp.raise_for_status()
        return resp.content
    else:
        rq = Request(url)
        with urlopen(rq, timeout=30) as r:
            return r.read()


# ══════════════════════════════════════════════════════════════════════════════
# PERSISTENCE
# ══════════════════════════════════════════════════════════════════════════════
def load_json(path, default):
    try:
        if path.exists():
            return json.loads(path.read_text('utf-8'))
    except Exception:
        pass
    return default

def save_json(path, data):
    try:
        path.write_text(json.dumps(data, indent=2), 'utf-8')
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════════════
# SYNTAX HIGHLIGHTING
# ══════════════════════════════════════════════════════════════════════════════
# Simple token-based highlighting without pygments
KEYWORD_COLORS = {
    'keyword':   '#ff7b72',
    'string':    '#a5d6ff',
    'comment':   '#8b949e',
    'number':    '#79c0ff',
    'function':  '#d2a8ff',
    'default':   '#e6edf3',
}

PY_KEYWORDS = {'def','class','import','from','return','if','else','elif','for',
               'while','try','except','finally','with','as','in','not','and','or',
               'True','False','None','lambda','yield','pass','break','continue',
               'raise','del','global','nonlocal','assert','async','await'}

JS_KEYWORDS = {'function','const','let','var','return','if','else','for','while',
               'class','import','export','from','default','new','this','typeof',
               'null','undefined','true','false','async','await','try','catch',
               'finally','throw','switch','case','break','continue','in','of'}


def simple_highlight_python(code):
    """Return list of (text, tag) tuples for Python code."""
    tokens = []
    lines = code.split('\n')
    for line in lines:
        # Inline comment
        if '#' in line:
            idx = line.index('#')
            # but not inside string - simplistic
            tokens.extend(tokenize_line(line[:idx], PY_KEYWORDS))
            tokens.append((line[idx:], 'comment'))
        else:
            tokens.extend(tokenize_line(line, PY_KEYWORDS))
        tokens.append(('\n', 'default'))
    return tokens

def tokenize_line(line, keywords):
    """Very simple tokenizer."""
    tokens = []
    i = 0
    while i < len(line):
        # String
        if line[i] in ('"', "'"):
            q = line[i]
            j = i + 1
            # triple quote
            if line[i:i+3] in ('"""', "'''"):
                q3 = line[i:i+3]
                j = i + 3
                end = line.find(q3, j)
                if end == -1:
                    tokens.append((line[i:], 'string'))
                    i = len(line)
                    continue
                else:
                    tokens.append((line[i:end+3], 'string'))
                    i = end + 3
                    continue
            while j < len(line) and line[j] != q:
                if line[j] == '\\':
                    j += 1
                j += 1
            tokens.append((line[i:j+1], 'string'))
            i = j + 1
            continue
        # Number
        if line[i].isdigit():
            j = i
            while j < len(line) and (line[j].isdigit() or line[j] == '.'):
                j += 1
            tokens.append((line[i:j], 'number'))
            i = j
            continue
        # Word
        if line[i].isalpha() or line[i] == '_':
            j = i
            while j < len(line) and (line[j].isalnum() or line[j] == '_'):
                j += 1
            word = line[i:j]
            tag = 'keyword' if word in keywords else 'default'
            tokens.append((word, tag))
            i = j
            continue
        tokens.append((line[i], 'default'))
        i += 1
    return tokens


# ══════════════════════════════════════════════════════════════════════════════
# MAIN APPLICATION
# ══════════════════════════════════════════════════════════════════════════════
class GitPeekApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(f"{APP_NAME} — GitHub Repository Explorer")
        self.root.geometry("1280x780")
        self.root.minsize(800, 500)

        # ── State ────────────────────────────────────────────────────────────
        self.repo        = None   # {'owner':…,'name':…,'branch':…,'full_name':…}
        self.tree_data   = []
        self.tree_map    = {}     # path → item
        self.file_index  = []
        self.file_pos    = -1
        self.active_file = None
        self.open_dirs   = set()
        self.selected    = set()
        self.favorites   = load_json(FAVS_FILE, {})
        self.recent      = load_json(RECENT_FILE, [])
        self.dark_mode   = True
        self.apply_css   = True
        self.token       = os.environ.get('GITHUB_TOKEN', '')

        self.colors = DARK_THEME

        # ── UI ───────────────────────────────────────────────────────────────
        self._build_styles()
        self._build_ui()
        self._apply_colors()

        self.root.bind('<Control-k>', lambda e: self._focus_search())
        self.root.bind('<Control-q>', lambda e: self.root.quit())
        self.root.bind('<Control-backslash>', lambda e: self._toggle_split())
        self.root.bind('<Control-s>', lambda e: self._toggle_favorite())
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ─────────────────────────────────────────────────────────────────────────
    # UI BUILD
    # ─────────────────────────────────────────────────────────────────────────
    def _build_styles(self):
        self.style = ttk.Style()
        self.style.theme_use('clam')

    def _build_ui(self):
        c = self.colors

        # ── Root layout ──────────────────────────────────────────────────────
        self.root.configure(bg=c['bg'])

        # Top bar
        self._build_topbar()

        # Main paned window (sidebar | content)
        self.main_pw = tk.PanedWindow(self.root, orient=tk.HORIZONTAL,
                                       bg=c['border'], sashwidth=4,
                                       sashrelief=tk.FLAT, bd=0)
        self.main_pw.pack(fill=tk.BOTH, expand=True)

        # Sidebar
        self._build_sidebar()

        # Content area (further split for split-view)
        self.content_frame = tk.Frame(self.main_pw, bg=c['bg'])
        self.main_pw.add(self.content_frame, minsize=300, stretch='always')

        # Content paned (primary | secondary)
        self.content_pw = tk.PanedWindow(self.content_frame, orient=tk.HORIZONTAL,
                                          bg=c['border'], sashwidth=4,
                                          sashrelief=tk.FLAT, bd=0)
        self.content_pw.pack(fill=tk.BOTH, expand=True)

        self._build_primary_pane()
        self._split_visible = False

        # Status bar
        self._build_statusbar()

        # Sidebar initial size
        self.root.update_idletasks()
        self.main_pw.sash_place(0, 260, 0)

    def _build_topbar(self):
        c = self.colors
        tb = tk.Frame(self.root, bg=c['bg2'], height=44, bd=0)
        tb.pack(fill=tk.X, side=tk.TOP)
        tb.pack_propagate(False)

        # Brand
        brand = tk.Label(tb, text=f"  {APP_NAME}", bg=c['bg2'], fg=c['accent'],
                         font=('Segoe UI', 13, 'bold'), cursor='hand2')
        brand.pack(side=tk.LEFT, padx=(8,4), pady=4)
        brand.bind('<Button-1>', lambda e: self._show_welcome())

        sep = tk.Label(tb, text='|', bg=c['bg2'], fg=c['text3'])
        sep.pack(side=tk.LEFT, padx=2)

        # URL Input
        self.url_var = tk.StringVar()
        self.url_entry = tk.Entry(tb, textvariable=self.url_var, bg=c['bg3'],
                                   fg=c['text'], insertbackground=c['text'],
                                   relief=tk.FLAT, bd=0,
                                   font=('Consolas', 11),
                                   highlightthickness=1,
                                   highlightbackground=c['border'],
                                   highlightcolor=c['accent'])
        self.url_entry.pack(side=tk.LEFT, fill=tk.X, expand=True,
                            padx=(4, 2), pady=8, ipady=4)
        self.url_entry.insert(0, 'github.com/owner/repo  or  owner/repo')
        self.url_entry.bind('<FocusIn>',  self._url_focus_in)
        self.url_entry.bind('<FocusOut>', self._url_focus_out)
        self.url_entry.bind('<Return>',   lambda e: self._load_repo())

        # Load button
        load_btn = tk.Button(tb, text='Load', bg=c['accent'], fg='#ffffff',
                              font=('Segoe UI', 10, 'bold'), relief=tk.FLAT,
                              bd=0, padx=10, cursor='hand2',
                              activebackground=c['accent2'],
                              activeforeground='#ffffff',
                              command=self._load_repo)
        load_btn.pack(side=tk.LEFT, padx=(0,8), pady=8)

        # Right-side buttons
        btn_frame = tk.Frame(tb, bg=c['bg2'])
        btn_frame.pack(side=tk.RIGHT, padx=8)

        split_btn = tk.Button(btn_frame, text='⊟ Split', bg=c['bg3'], fg=c['text2'],
                               font=('Segoe UI', 9), relief=tk.FLAT, bd=0, padx=6,
                               cursor='hand2', command=self._toggle_split,
                               activebackground=c['bg3'], activeforeground=c['text'])
        split_btn.pack(side=tk.LEFT, padx=2, pady=6)
        self.split_btn = split_btn

        theme_btn = tk.Button(btn_frame, text='◑ Theme', bg=c['bg3'], fg=c['text2'],
                               font=('Segoe UI', 9), relief=tk.FLAT, bd=0, padx=6,
                               cursor='hand2', command=self._toggle_theme,
                               activebackground=c['bg3'], activeforeground=c['text'])
        theme_btn.pack(side=tk.LEFT, padx=2, pady=6)

        gh_btn = tk.Button(btn_frame, text='⌥ GitHub', bg=c['bg3'], fg=c['text2'],
                            font=('Segoe UI', 9), relief=tk.FLAT, bd=0, padx=6,
                            cursor='hand2', command=lambda: webbrowser.open('https://github.com'),
                            activebackground=c['bg3'], activeforeground=c['text'])
        gh_btn.pack(side=tk.LEFT, padx=2, pady=6)

        # Rate limit label
        self.rate_lbl = tk.Label(btn_frame, text='', bg=c['bg2'],
                                  fg=c['text3'], font=('Segoe UI', 8))
        self.rate_lbl.pack(side=tk.LEFT, padx=4)

    def _build_sidebar(self):
        c = self.colors
        self.sidebar = tk.Frame(self.main_pw, bg=c['bg2'], bd=0)
        self.main_pw.add(self.sidebar, minsize=180, width=260)

        # Tab bar
        tab_bar = tk.Frame(self.sidebar, bg=c['bg3'], height=38)
        tab_bar.pack(fill=tk.X)
        tab_bar.pack_propagate(False)

        self.tab_frames = {}
        self.tab_btns   = {}
        tabs = [('explorer','📁'), ('search','🔍'), ('favorites','⭐'), ('recent','🕐')]
        for name, icon in tabs:
            b = tk.Label(tab_bar, text=icon, bg=c['bg3'], fg=c['text2'],
                         font=('Segoe UI', 14), cursor='hand2', padx=8)
            b.pack(side=tk.LEFT, pady=4)
            b.bind('<Button-1>', lambda e, n=name: self._switch_tab(n))
            b.bind('<Enter>',    lambda e, btn=b: btn.config(fg=c['text']))
            b.bind('<Leave>',    lambda e, btn=b, n=name: btn.config(
                fg=c['accent'] if self.current_tab == n else c['text2']))
            self.tab_btns[name] = b

        self.current_tab = 'explorer'

        # Panels
        self.panel_container = tk.Frame(self.sidebar, bg=c['bg2'])
        self.panel_container.pack(fill=tk.BOTH, expand=True)

        self._build_explorer_panel()
        self._build_search_panel()
        self._build_favorites_panel()
        self._build_recent_panel()

        self._switch_tab('explorer')

    def _build_explorer_panel(self):
        c = self.colors
        f = tk.Frame(self.panel_container, bg=c['bg2'])
        self.tab_frames['explorer'] = f

        # Header
        hdr = tk.Frame(f, bg=c['bg2'])
        hdr.pack(fill=tk.X, padx=8, pady=(6,2))
        tk.Label(hdr, text='EXPLORER', bg=c['bg2'], fg=c['text3'],
                 font=('Segoe UI', 8, 'bold')).pack(side=tk.LEFT)
        tk.Button(hdr, text='⊖', bg=c['bg2'], fg=c['text3'], font=('Segoe UI',9),
                  relief=tk.FLAT, bd=0, cursor='hand2',
                  command=self._collapse_all,
                  activebackground=c['bg2']).pack(side=tk.RIGHT)
        self.dl_zip_btn = tk.Button(hdr, text='⬇ZIP', bg=c['bg2'], fg=c['text3'],
                                     font=('Segoe UI',9), relief=tk.FLAT, bd=0,
                                     cursor='hand2', command=self._download_zip,
                                     activebackground=c['bg2'], state=tk.DISABLED)
        self.dl_zip_btn.pack(side=tk.RIGHT, padx=2)

        # Repo info
        self.repo_info_frame = tk.Frame(f, bg=c['bg3'])
        self.repo_info_frame.pack(fill=tk.X, padx=6, pady=(0,4))
        self.repo_name_lbl = tk.Label(self.repo_info_frame, text='No repo loaded',
                                       bg=c['bg3'], fg=c['text2'],
                                       font=('Segoe UI', 9), anchor='w',
                                       wraplength=220)
        self.repo_name_lbl.pack(fill=tk.X, padx=8, pady=(4,1))
        self.repo_meta_lbl = tk.Label(self.repo_info_frame, text='',
                                       bg=c['bg3'], fg=c['text3'],
                                       font=('Segoe UI', 8), anchor='w')
        self.repo_meta_lbl.pack(fill=tk.X, padx=8, pady=(0,4))

        # Tree
        tree_frame = tk.Frame(f, bg=c['bg2'])
        tree_frame.pack(fill=tk.BOTH, expand=True)

        self.file_tree = ttk.Treeview(tree_frame, show='tree', selectmode='browse')
        self.file_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb = ttk.Scrollbar(tree_frame, orient=tk.VERTICAL, command=self.file_tree.yview)
        vsb.pack(side=tk.RIGHT, fill=tk.Y)
        self.file_tree.configure(yscrollcommand=vsb.set)
        self.file_tree.bind('<<TreeviewSelect>>', self._on_tree_select)
        self.file_tree.bind('<Double-Button-1>',   self._on_tree_double)

        self._style_treeview()

    def _build_search_panel(self):
        c = self.colors
        f = tk.Frame(self.panel_container, bg=c['bg2'])
        self.tab_frames['search'] = f

        tk.Label(f, text='SEARCH FILES', bg=c['bg2'], fg=c['text3'],
                 font=('Segoe UI', 8, 'bold')).pack(anchor='w', padx=8, pady=(6,4))

        search_frame = tk.Frame(f, bg=c['bg3'], highlightthickness=1,
                                 highlightbackground=c['border'])
        search_frame.pack(fill=tk.X, padx=6, pady=(0,6))
        self.search_var = tk.StringVar()
        self.search_var.trace_add('write', lambda *a: self._run_search())
        entry = tk.Entry(search_frame, textvariable=self.search_var,
                         bg=c['bg3'], fg=c['text'], insertbackground=c['text'],
                         relief=tk.FLAT, bd=0, font=('Consolas', 10))
        entry.pack(fill=tk.X, padx=6, pady=5)
        self.search_entry = entry

        self.search_results_frame = tk.Frame(f, bg=c['bg2'])
        self.search_results_frame.pack(fill=tk.BOTH, expand=True)
        self.search_listbox = tk.Listbox(self.search_results_frame,
                                          bg=c['bg2'], fg=c['text'],
                                          selectbackground=c['select_bg'],
                                          selectforeground=c['select_fg'],
                                          relief=tk.FLAT, bd=0,
                                          font=('Consolas', 9),
                                          activestyle='none')
        self.search_listbox.pack(fill=tk.BOTH, expand=True, side=tk.LEFT)
        sb = ttk.Scrollbar(self.search_results_frame, orient=tk.VERTICAL,
                            command=self.search_listbox.yview)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        self.search_listbox.configure(yscrollcommand=sb.set)
        self.search_listbox.bind('<<ListboxSelect>>', self._on_search_select)
        self._search_paths = []

    def _build_favorites_panel(self):
        c = self.colors
        f = tk.Frame(self.panel_container, bg=c['bg2'])
        self.tab_frames['favorites'] = f

        hdr = tk.Frame(f, bg=c['bg2'])
        hdr.pack(fill=tk.X, padx=8, pady=(6,4))
        tk.Label(hdr, text='FAVORITES', bg=c['bg2'], fg=c['text3'],
                 font=('Segoe UI', 8, 'bold')).pack(side=tk.LEFT)
        tk.Button(hdr, text='Clear', bg=c['bg2'], fg=c['text3'],
                  font=('Segoe UI', 8), relief=tk.FLAT, bd=0, cursor='hand2',
                  command=self._clear_favorites,
                  activebackground=c['bg2']).pack(side=tk.RIGHT)

        self.fav_listbox = tk.Listbox(f, bg=c['bg2'], fg=c['text'],
                                       selectbackground=c['select_bg'],
                                       selectforeground=c['select_fg'],
                                       relief=tk.FLAT, bd=0,
                                       font=('Consolas', 9),
                                       activestyle='none')
        self.fav_listbox.pack(fill=tk.BOTH, expand=True, padx=4)
        self.fav_listbox.bind('<Double-Button-1>', self._on_fav_select)
        self._fav_data = []
        self._refresh_favorites()

    def _build_recent_panel(self):
        c = self.colors
        f = tk.Frame(self.panel_container, bg=c['bg2'])
        self.tab_frames['recent'] = f

        hdr = tk.Frame(f, bg=c['bg2'])
        hdr.pack(fill=tk.X, padx=8, pady=(6,4))
        tk.Label(hdr, text='RECENT REPOS', bg=c['bg2'], fg=c['text3'],
                 font=('Segoe UI', 8, 'bold')).pack(side=tk.LEFT)
        tk.Button(hdr, text='Clear', bg=c['bg2'], fg=c['text3'],
                  font=('Segoe UI', 8), relief=tk.FLAT, bd=0, cursor='hand2',
                  command=self._clear_recent,
                  activebackground=c['bg2']).pack(side=tk.RIGHT)

        self.recent_listbox = tk.Listbox(f, bg=c['bg2'], fg=c['text'],
                                          selectbackground=c['select_bg'],
                                          selectforeground=c['select_fg'],
                                          relief=tk.FLAT, bd=0,
                                          font=('Consolas', 9),
                                          activestyle='none')
        self.recent_listbox.pack(fill=tk.BOTH, expand=True, padx=4)
        self.recent_listbox.bind('<Double-Button-1>', self._on_recent_select)
        self._refresh_recent()

    def _build_primary_pane(self):
        c = self.colors
        self.primary_frame = tk.Frame(self.content_pw, bg=c['bg'])
        self.content_pw.add(self.primary_frame, stretch='always', minsize=200)
        self._build_pane_content(self.primary_frame, 'primary')

    def _build_secondary_pane(self):
        c = self.colors
        self.secondary_frame = tk.Frame(self.content_pw, bg=c['bg'])
        self.content_pw.add(self.secondary_frame, stretch='always', minsize=200)
        self._build_pane_content(self.secondary_frame, 'secondary')

    def _build_pane_content(self, parent, pane_id):
        c = self.colors

        # Header bar
        hdr = tk.Frame(parent, bg=c['bg2'], height=34)
        hdr.pack(fill=tk.X)
        hdr.pack_propagate(False)

        bc_lbl = tk.Label(hdr, text='GitPeek', bg=c['bg2'], fg=c['text3'],
                           font=('Segoe UI', 9), anchor='w')
        bc_lbl.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=8)

        # Pane-specific controls
        btn_frame = tk.Frame(hdr, bg=c['bg2'])
        btn_frame.pack(side=tk.RIGHT, padx=4)

        if pane_id == 'primary':
            self.primary_bc    = bc_lbl
            self.primary_btns  = btn_frame

        if pane_id == 'secondary':
            self.secondary_bc   = bc_lbl
            self.secondary_btns = btn_frame
            # Apply CSS toggle
            self.apply_css_var = tk.BooleanVar(value=self.apply_css)
            css_cb = tk.Checkbutton(btn_frame, text='Apply CSS',
                                     variable=self.apply_css_var,
                                     bg=c['bg2'], fg=c['text3'],
                                     selectcolor=c['bg3'],
                                     activebackground=c['bg2'],
                                     font=('Segoe UI', 8),
                                     command=self._on_css_toggle)
            css_cb.pack(side=tk.LEFT, padx=4)

        # Action buttons
        for label, cmd in [('⬇', lambda p=pane_id: self._download_active(p)),
                            ('⭐', lambda p=pane_id: self._toggle_favorite(p)),
                            ('↗', lambda p=pane_id: self._open_github(p))]:
            b = tk.Button(btn_frame, text=label, bg=c['bg2'], fg=c['text3'],
                           font=('Segoe UI', 10), relief=tk.FLAT, bd=0,
                           padx=4, cursor='hand2',
                           activebackground=c['bg3'],
                           command=cmd)
            b.pack(side=tk.LEFT)

        if pane_id == 'secondary':
            tk.Button(btn_frame, text='✕', bg=c['bg2'], fg=c['text3'],
                       font=('Segoe UI', 10), relief=tk.FLAT, bd=0,
                       padx=4, cursor='hand2',
                       activebackground=c['bg3'],
                       command=self._close_split).pack(side=tk.LEFT)

        # Content area
        content = tk.Frame(parent, bg=c['bg'])
        content.pack(fill=tk.BOTH, expand=True)

        if pane_id == 'primary':
            self.primary_content = content
        else:
            self.secondary_content = content

        self._show_welcome_in_pane(content)

    def _build_statusbar(self):
        c = self.colors
        sb = tk.Frame(self.root, bg=c['bg3'], height=24)
        sb.pack(fill=tk.X, side=tk.BOTTOM)
        sb.pack_propagate(False)

        self.status_branch = tk.Label(sb, text='', bg=c['bg3'], fg=c['text3'],
                                       font=('Consolas', 8))
        self.status_branch.pack(side=tk.LEFT, padx=(8,0))

        self.status_files = tk.Label(sb, text='', bg=c['bg3'], fg=c['text3'],
                                      font=('Consolas', 8))
        self.status_files.pack(side=tk.LEFT, padx=8)

        self.status_lang = tk.Label(sb, text='', bg=c['bg3'], fg=c['text3'],
                                     font=('Consolas', 8))
        self.status_lang.pack(side=tk.RIGHT, padx=8)

        tk.Label(sb, text='Ctrl+K Search · Ctrl+\\ Split · Ctrl+S Star',
                 bg=c['bg3'], fg=c['text3'], font=('Segoe UI', 8)
                 ).pack(side=tk.RIGHT, padx=8)

    # ─────────────────────────────────────────────────────────────────────────
    # WELCOME / PLACEHOLDER
    # ─────────────────────────────────────────────────────────────────────────
    def _show_welcome_in_pane(self, parent):
        c = self.colors
        for w in parent.winfo_children():
            w.destroy()
        frame = tk.Frame(parent, bg=c['bg'])
        frame.place(relx=.5, rely=.5, anchor='center')
        tk.Label(frame, text=APP_NAME, bg=c['bg'], fg=c['accent'],
                 font=('Segoe UI', 22, 'bold')).pack()
        tk.Label(frame, text='GitHub Repository Explorer',
                 bg=c['bg'], fg=c['text3'],
                 font=('Segoe UI', 10)).pack(pady=(2,8))
        tk.Label(frame, text='Paste a GitHub URL above and press Load',
                 bg=c['bg'], fg=c['text2'],
                 font=('Segoe UI', 9)).pack()
        tk.Label(frame, text='Ctrl+K  Search  ·  Ctrl+\\  Split  ·  Ctrl+S  Star',
                 bg=c['bg'], fg=c['text3'],
                 font=('Consolas', 8)).pack(pady=(8,0))

    def _show_select_file_in_pane(self, parent):
        c = self.colors
        for w in parent.winfo_children():
            w.destroy()
        frame = tk.Frame(parent, bg=c['bg'])
        frame.place(relx=.5, rely=.5, anchor='center')
        tk.Label(frame, text='📂', bg=c['bg'], font=('Segoe UI', 32)).pack()
        tk.Label(frame, text='Select a file to preview',
                 bg=c['bg'], fg=c['text2'], font=('Segoe UI', 10)).pack(pady=4)

    # ─────────────────────────────────────────────────────────────────────────
    # STYLING
    # ─────────────────────────────────────────────────────────────────────────
    def _style_treeview(self):
        c = self.colors
        self.style.configure('Treeview',
                              background=c['bg2'],
                              foreground=c['text'],
                              fieldbackground=c['bg2'],
                              borderwidth=0,
                              rowheight=22,
                              font=('Consolas', 9))
        self.style.configure('Treeview.Heading', background=c['bg3'],
                              foreground=c['text2'], borderwidth=0)
        self.style.map('Treeview',
                       background=[('selected', c['select_bg'])],
                       foreground=[('selected', c['select_fg'])])
        self.style.configure('Vertical.TScrollbar',
                              background=c['bg3'], troughcolor=c['bg2'],
                              borderwidth=0, arrowsize=12)

    def _apply_colors(self):
        """Re-theme all widgets."""
        c = self.colors
        self.root.configure(bg=c['bg'])
        # Rebuild styles
        self._style_treeview()

    # ─────────────────────────────────────────────────────────────────────────
    # TAB SWITCHING
    # ─────────────────────────────────────────────────────────────────────────
    def _switch_tab(self, name):
        c = self.colors
        self.current_tab = name
        for n, f in self.tab_frames.items():
            f.pack_forget()
        self.tab_frames[name].pack(fill=tk.BOTH, expand=True)
        for n, b in self.tab_btns.items():
            b.config(fg=c['accent'] if n == name else c['text2'])

    # ─────────────────────────────────────────────────────────────────────────
    # URL ENTRY HELPERS
    # ─────────────────────────────────────────────────────────────────────────
    def _url_focus_in(self, e):
        val = self.url_var.get()
        if 'or  owner/repo' in val or val == 'github.com/owner/repo  or  owner/repo':
            self.url_entry.delete(0, tk.END)

    def _url_focus_out(self, e):
        if not self.url_var.get().strip():
            self.url_entry.insert(0, 'github.com/owner/repo  or  owner/repo')

    # ─────────────────────────────────────────────────────────────────────────
    # PARSE REPO INPUT
    # ─────────────────────────────────────────────────────────────────────────
    @staticmethod
    def _parse_input(raw):
        raw = raw.strip()
        m = re.search(r'github\.com/([^/\s]+)/([^/\s#?]+)', raw, re.I)
        if m:
            return m.group(1), m.group(2).rstrip('.git')
        m = re.match(r'^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$', raw)
        if m:
            return m.group(1), m.group(2)
        return None, None

    # ─────────────────────────────────────────────────────────────────────────
    # LOAD REPO
    # ─────────────────────────────────────────────────────────────────────────
    def _load_repo(self):
        raw = self.url_var.get().strip()
        owner, name = self._parse_input(raw)
        if not owner:
            messagebox.showerror(APP_NAME, 'Invalid input.\nUse: github.com/owner/repo  or  owner/repo')
            return
        self._set_status_text('Loading…')
        thread = threading.Thread(target=self._load_repo_thread,
                                   args=(owner, name), daemon=True)
        thread.start()

    def _load_repo_thread(self, owner, name):
        try:
            meta   = api_get(f'/repos/{owner}/{name}', self.token)
            branch = meta.get('default_branch', 'main')
            full   = f'{owner}/{name}'
            self.repo = {'owner': owner, 'name': name, 'branch': branch,
                          'full_name': full, 'meta': meta}
            tree_data = api_get(f'/repos/{owner}/{name}/git/trees/{branch}?recursive=1',
                                 self.token)
            items = tree_data.get('tree', [])
            self.tree_data  = items
            self.tree_map   = {i['path']: i for i in items}
            self.file_index = [i['path'] for i in items if i['type'] == 'blob']
            self.file_pos   = -1
            self.selected.clear()

            # Add to recent
            self._add_recent(owner, name, branch)

            self.root.after(0, self._on_repo_loaded, meta)
        except HTTPError as e:
            msg = f'HTTP {e.code}: {e.reason}'
            if e.code == 404: msg = 'Repository not found. Make sure it\'s public.'
            if e.code == 403: msg = 'GitHub API rate limit hit. Try again in a moment.'
            self.root.after(0, lambda: messagebox.showerror(APP_NAME, msg))
            self.root.after(0, self._clear_status)
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror(APP_NAME, str(e)))
            self.root.after(0, self._clear_status)

    def _on_repo_loaded(self, meta):
        r = self.repo
        fc = len(self.file_index)
        self.repo_name_lbl.config(text=r['full_name'])
        self.repo_meta_lbl.config(text=f'{fc} files · branch: {r["branch"]}')
        self.dl_zip_btn.config(state=tk.NORMAL)
        self.status_branch.config(text=f' ⎇ {r["branch"]}')
        self.status_files.config(text=f'  {fc} files')
        self._render_file_tree()
        self._show_select_file_in_pane(self.primary_content)
        self._set_status_text(f'Loaded {r["full_name"]} · {fc} files')

    def _set_status_text(self, text):
        self.status_lang.config(text=text)

    def _clear_status(self):
        self.status_lang.config(text='')

    # ─────────────────────────────────────────────────────────────────────────
    # FILE TREE
    # ─────────────────────────────────────────────────────────────────────────
    def _render_file_tree(self):
        self.file_tree.delete(*self.file_tree.get_children())
        if not self.tree_data:
            return
        self._tree_node_ids = {}
        self._build_tree_nodes('', self.tree_data)

    def _build_tree_nodes(self, parent_id, items):
        """Build hierarchical tree from flat list."""
        # Organize into node dict
        structure = {}
        for item in items:
            parts = item['path'].split('/')
            node  = structure
            for i, part in enumerate(parts):
                if part not in node:
                    node[part] = {'__children__': {}, '__item__': None}
                if i == len(parts) - 1:
                    node[part]['__item__'] = item
                node = node[part]['__children__']

        self._insert_nodes('', structure)

    def _insert_nodes(self, parent, node, depth=0):
        # Dirs first, then files
        dirs  = [(k,v) for k,v in node.items() if v['__item__'] is None or
                  (v['__item__'] and v['__item__']['type'] == 'tree')]
        files = [(k,v) for k,v in node.items() if v['__item__'] and
                  v['__item__']['type'] == 'blob']
        dirs.sort(key=lambda x: x[0].lower())
        files.sort(key=lambda x: x[0].lower())

        for name, val in dirs + files:
            item   = val.get('__item__')
            isdir  = not item or item.get('type') == 'tree'
            has_children = bool(val.get('__children__'))

            prefix = '📁 ' if isdir else self._file_icon(name)
            iid = self.file_tree.insert(
                parent, 'end',
                text=f'{prefix}{name}',
                open=False
            )
            if item:
                self._tree_node_ids[item['path']] = iid
            # Also store by visual path for dirs
            if isdir:
                dir_path = (self.file_tree.item(parent, 'values')[0]
                            if parent else '') 
                self.file_tree.item(iid, values=[name])

            if has_children:
                self._insert_nodes(iid, val['__children__'], depth + 1)

    def _file_icon(self, name):
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        icons = {
            'py':'🐍 ','js':'🟨 ','ts':'🔷 ','html':'🌐 ','css':'🎨 ',
            'json':'📋 ','md':'📝 ','sh':'⚙ ','yml':'⚙ ','yaml':'⚙ ',
            'go':'🐹 ','rs':'⚙ ','java':'☕ ','rb':'💎 ','php':'🐘 ',
            'vue':'💚 ','svelte':'🧡 ','dockerfile':'🐳 ',
            'png':'🖼 ','jpg':'🖼 ','jpeg':'🖼 ','gif':'🖼 ','svg':'🖼 ',
            'mp4':'🎬 ','pdf':'📄 ',
        }
        return icons.get(ext, '📄 ')

    def _on_tree_select(self, e):
        pass  # handled on double-click / Enter

    def _on_tree_double(self, e):
        sel = self.file_tree.selection()
        if not sel:
            return
        iid   = sel[0]
        # Find path by reverse lookup
        path  = None
        for p, node_id in self._tree_node_ids.items():
            if node_id == iid:
                path = p
                break
        if path is None:
            return
        item = self.tree_map.get(path)
        if item and item['type'] == 'blob':
            self._open_file(path)

    def _collapse_all(self):
        for iid in self.file_tree.get_children():
            self.file_tree.item(iid, open=False)

    # ─────────────────────────────────────────────────────────────────────────
    # OPEN FILE
    # ─────────────────────────────────────────────────────────────────────────
    def _open_file(self, path):
        if not self.repo:
            return
        self.active_file = path
        ext = path.rsplit('.', 1)[-1].lower() if '.' in path else ''
        is_autosplit = ext in AUTO_SPLIT

        # Update breadcrumb
        self.primary_bc.config(text=f'{self.repo["name"]} / ' +
                                     ' / '.join(path.split('/')))

        # Status bar language
        self.status_lang.config(text=ext.upper())

        if is_autosplit:
            # Ensure split is open
            if not self._split_visible:
                self._open_split_view()
            # Left = code, right = preview
            threading.Thread(target=self._load_file_thread,
                              args=(path, 'primary', 'code'), daemon=True).start()
            threading.Thread(target=self._load_file_thread,
                              args=(path, 'secondary', 'preview'), daemon=True).start()
        else:
            # Close split if it was an auto-split
            threading.Thread(target=self._load_file_thread,
                              args=(path, 'primary', 'auto'), daemon=True).start()

    def _load_file_thread(self, path, pane, mode):
        try:
            r = self.repo
            ext = path.rsplit('.', 1)[-1].lower() if '.' in path else ''

            if ext in TEXT_EXTS or self._is_likely_text(path):
                text = fetch_raw(r['owner'], r['name'], r['branch'], path)
                self.root.after(0, self._display_text,
                                path, text, pane, mode, ext)
            elif ext in IMAGE_EXTS:
                self.root.after(0, self._display_image_placeholder, path, pane)
            else:
                self.root.after(0, self._display_binary_placeholder, path, pane)
        except Exception as e:
            self.root.after(0, self._display_error, str(e), pane)

    def _display_text(self, path, text, pane, mode, ext):
        c = self.colors
        parent = self.primary_content if pane == 'primary' else self.secondary_content
        for w in parent.winfo_children():
            w.destroy()

        # Label bar
        label_mode = 'Source Code' if mode == 'code' else (
            'Rendered Preview' if mode == 'preview' else ext.upper())
        bar = tk.Frame(parent, bg=c['bg2'], height=22)
        bar.pack(fill=tk.X)
        bar.pack_propagate(False)
        tk.Label(bar, text=f'  {label_mode}', bg=c['bg2'], fg=c['text3'],
                 font=('Segoe UI', 8)).pack(side=tk.LEFT)

        if pane == 'secondary':
            # Update secondary breadcrumb
            self.secondary_bc.config(
                text=f'{self.repo["name"]} / ' + ' / '.join(path.split('/')))

        # For preview mode of MD, show rendered (simple)
        if mode == 'preview' and ext in ('md', 'mdx'):
            self._render_markdown_in(parent, text, c)
            return

        # For HTML preview mode — show the raw HTML as code (simple approach)
        # A full Tkinter HTML renderer is complex; we show formatted HTML code
        # but with a "Open in Browser" button for actual live preview
        if mode == 'preview' and ext in ('html', 'htm'):
            self._render_html_preview_in(parent, path, text, c)
            return

        # Code view
        txt = scrolledtext.ScrolledText(parent, wrap=tk.NONE,
                                         bg=c['code_bg'], fg=c['text'],
                                         insertbackground=c['text'],
                                         font=('Consolas', 10),
                                         relief=tk.FLAT, bd=0,
                                         padx=12, pady=8,
                                         selectbackground=c['select_bg'],
                                         selectforeground=c['select_fg'])
        txt.pack(fill=tk.BOTH, expand=True)

        # Horizontal scrollbar
        hsb = ttk.Scrollbar(parent, orient=tk.HORIZONTAL, command=txt.xview)
        hsb.pack(fill=tk.X)
        txt.configure(xscrollcommand=hsb.set)

        # Insert text with basic highlighting
        txt.config(state=tk.NORMAL)
        txt.delete('1.0', tk.END)

        self._setup_text_tags(txt, c)

        if ext == 'py':
            tokens = simple_highlight_python(text)
            for tok_text, tag in tokens:
                txt.insert(tk.END, tok_text, tag)
        else:
            txt.insert(tk.END, text, 'default')

        txt.config(state=tk.DISABLED)

    def _setup_text_tags(self, txt, c):
        txt.tag_configure('keyword',  foreground='#ff7b72')
        txt.tag_configure('string',   foreground='#a5d6ff')
        txt.tag_configure('comment',  foreground=c['text3'])
        txt.tag_configure('number',   foreground='#79c0ff')
        txt.tag_configure('function', foreground='#d2a8ff')
        txt.tag_configure('default',  foreground=c['text'])

    def _render_markdown_in(self, parent, text, c):
        """Simple Markdown rendering: strip # headings, **, etc."""
        txt = scrolledtext.ScrolledText(parent, wrap=tk.WORD,
                                         bg=c['bg'], fg=c['text'],
                                         font=('Georgia', 11),
                                         relief=tk.FLAT, bd=0,
                                         padx=20, pady=12,
                                         selectbackground=c['select_bg'])
        txt.pack(fill=tk.BOTH, expand=True)
        txt.tag_configure('h1', font=('Georgia', 18, 'bold'), foreground=c['text'],
                           spacing3=8)
        txt.tag_configure('h2', font=('Georgia', 15, 'bold'), foreground=c['text'],
                           spacing3=6)
        txt.tag_configure('h3', font=('Georgia', 13, 'bold'), foreground=c['text'],
                           spacing3=4)
        txt.tag_configure('bold', font=('Georgia', 11, 'bold'))
        txt.tag_configure('code', font=('Consolas', 10),
                           background=c['bg3'], foreground='#a5d6ff')
        txt.tag_configure('link', foreground=c['accent'], underline=True)
        txt.tag_configure('normal', font=('Georgia', 11))

        txt.config(state=tk.NORMAL)
        for line in text.split('\n'):
            if line.startswith('### '):
                txt.insert(tk.END, line[4:] + '\n', 'h3')
            elif line.startswith('## '):
                txt.insert(tk.END, line[3:] + '\n', 'h2')
            elif line.startswith('# '):
                txt.insert(tk.END, line[2:] + '\n', 'h1')
            elif line.startswith('    ') or line.startswith('\t'):
                txt.insert(tk.END, line + '\n', 'code')
            else:
                # Simple bold
                parts = re.split(r'(\*\*[^*]+\*\*|`[^`]+`)', line)
                for part in parts:
                    if part.startswith('**') and part.endswith('**'):
                        txt.insert(tk.END, part[2:-2], 'bold')
                    elif part.startswith('`') and part.endswith('`'):
                        txt.insert(tk.END, part[1:-1], 'code')
                    else:
                        txt.insert(tk.END, part, 'normal')
                txt.insert(tk.END, '\n', 'normal')
        txt.config(state=tk.DISABLED)

    def _render_html_preview_in(self, parent, path, html_text, c):
        """Show HTML code with an 'Open in Browser' option and Apply CSS info."""
        # Resolve CSS if enabled
        if self.apply_css and self.repo:
            html_dir = '/'.join(path.split('/')[:-1])
            resolved = self._resolve_css_sync(html_text, html_dir)
        else:
            resolved = html_text

        btn_bar = tk.Frame(parent, bg=c['bg2'])
        btn_bar.pack(fill=tk.X, pady=2)

        css_status = '(CSS injected)' if self.apply_css else '(no CSS)'
        tk.Label(btn_bar, text=f'HTML Preview {css_status}',
                 bg=c['bg2'], fg=c['text3'], font=('Segoe UI', 8)
                 ).pack(side=tk.LEFT, padx=8)

        def open_in_browser():
            import tempfile, os
            with tempfile.NamedTemporaryFile('w', suffix='.html',
                                             delete=False, encoding='utf-8') as f:
                f.write(resolved)
                tmp = f.name
            webbrowser.open(f'file://{tmp}')

        tk.Button(btn_bar, text='🌐 Open in Browser', bg=c['accent'], fg='white',
                   font=('Segoe UI', 8), relief=tk.FLAT, bd=0, padx=8,
                   cursor='hand2', command=open_in_browser,
                   activebackground=c['accent2']
                   ).pack(side=tk.RIGHT, padx=4, pady=2)

        # Show the (resolved) HTML source code
        txt = scrolledtext.ScrolledText(parent, wrap=tk.NONE,
                                         bg=c['code_bg'], fg=c['text'],
                                         font=('Consolas', 10),
                                         relief=tk.FLAT, bd=0,
                                         padx=12, pady=8)
        txt.pack(fill=tk.BOTH, expand=True)
        txt.config(state=tk.NORMAL)
        txt.insert(tk.END, resolved)
        txt.config(state=tk.DISABLED)

    def _resolve_css_sync(self, html_text, html_dir):
        """Synchronously resolve <link rel=stylesheet> from tree."""
        if not self.repo:
            return html_text
        result = html_text
        pattern = re.compile(r'<link\b([^>]*?)>', re.IGNORECASE)
        href_pat = re.compile(r'\bhref=["\']([^"\']+)["\']', re.IGNORECASE)
        rel_pat  = re.compile(r'\brel=["\']stylesheet["\']', re.IGNORECASE)

        for m in pattern.finditer(html_text):
            tag = m.group(0)
            if not rel_pat.search(tag):
                continue
            h = href_pat.search(tag)
            if not h:
                continue
            href = h.group(1)
            if re.match(r'^(https?:|//|data:)', href):
                continue
            css_path = f'{html_dir}/{href}'.lstrip('/') if html_dir else href
            # Normalize
            parts, out = css_path.split('/'), []
            for p in parts:
                if p == '..': out.pop() if out else None
                elif p not in ('.', ''): out.append(p)
            css_path = '/'.join(out)

            if css_path in self.tree_map:
                try:
                    r = self.repo
                    css_text = fetch_raw(r['owner'], r['name'], r['branch'], css_path)
                    result = result.replace(tag, f'<style>\n{css_text}\n</style>', 1)
                except Exception:
                    pass
        return result

    def _display_image_placeholder(self, path, pane):
        c = self.colors
        parent = self.primary_content if pane == 'primary' else self.secondary_content
        for w in parent.winfo_children():
            w.destroy()
        frame = tk.Frame(parent, bg=c['bg'])
        frame.place(relx=.5, rely=.5, anchor='center')
        tk.Label(frame, text='🖼', font=('Segoe UI', 36), bg=c['bg']).pack()
        tk.Label(frame, text=path.split('/')[-1],
                 bg=c['bg'], fg=c['text2'], font=('Segoe UI', 10)).pack(pady=4)
        r = self.repo
        url = f'{RAW_BASE}/{r["owner"]}/{r["name"]}/{r["branch"]}/{quote(path, safe="/")}'
        tk.Button(frame, text='Open Image in Browser', bg=c['accent'], fg='white',
                   font=('Segoe UI', 9), relief=tk.FLAT, bd=0, padx=10,
                   cursor='hand2', command=lambda: webbrowser.open(url),
                   activebackground=c['accent2']).pack(pady=4)

    def _display_binary_placeholder(self, path, pane):
        c = self.colors
        parent = self.primary_content if pane == 'primary' else self.secondary_content
        for w in parent.winfo_children():
            w.destroy()
        frame = tk.Frame(parent, bg=c['bg'])
        frame.place(relx=.5, rely=.5, anchor='center')
        tk.Label(frame, text='📄', font=('Segoe UI', 36), bg=c['bg']).pack()
        tk.Label(frame, text=f'{path.split("/")[-1]}  —  binary file',
                 bg=c['bg'], fg=c['text2'], font=('Segoe UI', 10)).pack(pady=4)
        tk.Button(frame, text='⬇ Download', bg=c['accent'], fg='white',
                   font=('Segoe UI', 9), relief=tk.FLAT, bd=0, padx=10,
                   cursor='hand2',
                   command=lambda: self._download_file(path),
                   activebackground=c['accent2']).pack(pady=4)

    def _display_error(self, msg, pane):
        c = self.colors
        parent = self.primary_content if pane == 'primary' else self.secondary_content
        for w in parent.winfo_children():
            w.destroy()
        frame = tk.Frame(parent, bg=c['bg'])
        frame.place(relx=.5, rely=.5, anchor='center')
        tk.Label(frame, text='⚠', font=('Segoe UI', 36), bg=c['bg'],
                 fg=c['red']).pack()
        tk.Label(frame, text='Failed to load file',
                 bg=c['bg'], fg=c['text'], font=('Segoe UI', 10)).pack(pady=2)
        tk.Label(frame, text=msg, bg=c['bg'], fg=c['text3'],
                 font=('Consolas', 8), wraplength=300).pack()

    @staticmethod
    def _is_likely_text(name):
        n = name.lower()
        return any(k in n for k in [
            'makefile','dockerfile','readme','license','changelog',
            '.gitignore','.editorconfig','.env','.nvmrc'])

    # ─────────────────────────────────────────────────────────────────────────
    # SPLIT VIEW
    # ─────────────────────────────────────────────────────────────────────────
    def _open_split_view(self):
        if not self._split_visible:
            self._build_secondary_pane()
            self._split_visible = True
            self.split_btn.config(relief=tk.SUNKEN)
        try:
            w = self.content_pw.winfo_width()
            self.content_pw.sash_place(0, w // 2, 0)
        except Exception:
            pass

    def _close_split(self):
        if self._split_visible:
            self.content_pw.remove(self.secondary_frame)
            self._split_visible = False
            self.split_btn.config(relief=tk.FLAT)

    def _toggle_split(self, event=None):
        if self._split_visible:
            self._close_split()
        else:
            self._open_split_view()
            if self.active_file:
                threading.Thread(target=self._load_file_thread,
                                  args=(self.active_file, 'secondary', 'auto'),
                                  daemon=True).start()

    # ─────────────────────────────────────────────────────────────────────────
    # FAVORITES
    # ─────────────────────────────────────────────────────────────────────────
    def _toggle_favorite(self, pane=None):
        path = self.active_file
        if not path:
            return
        if path in self.favorites:
            del self.favorites[path]
        else:
            self.favorites[path] = {
                'path': path,
                'name': path.split('/')[-1],
                'repo': self.repo['full_name'] if self.repo else '',
                'ts':   0
            }
        save_json(FAVS_FILE, self.favorites)
        self._refresh_favorites()

    def _refresh_favorites(self):
        self.fav_listbox.delete(0, tk.END)
        self._fav_data = list(self.favorites.values())
        for fav in self._fav_data:
            self.fav_listbox.insert(tk.END, f"  ⭐  {fav['name']}  ({fav['repo']})")

    def _on_fav_select(self, e):
        sel = self.fav_listbox.curselection()
        if not sel:
            return
        fav = self._fav_data[sel[0]]
        if self.repo and self.repo['full_name'] == fav['repo']:
            self._open_file(fav['path'])
        else:
            messagebox.showinfo(APP_NAME,
                f'Load repo {fav["repo"]} first to open this file.')

    def _clear_favorites(self):
        if messagebox.askyesno(APP_NAME, 'Clear all favorites?'):
            self.favorites = {}
            save_json(FAVS_FILE, self.favorites)
            self._refresh_favorites()

    # ─────────────────────────────────────────────────────────────────────────
    # RECENT REPOS
    # ─────────────────────────────────────────────────────────────────────────
    def _add_recent(self, owner, name, branch):
        key = f'{owner}/{name}'
        self.recent = [r for r in self.recent if r.get('key') != key]
        self.recent.insert(0, {'key': key, 'owner': owner, 'name': name,
                                'branch': branch})
        self.recent = self.recent[:10]
        save_json(RECENT_FILE, self.recent)
        self.root.after(0, self._refresh_recent)

    def _refresh_recent(self):
        self.recent_listbox.delete(0, tk.END)
        for r in self.recent:
            self.recent_listbox.insert(tk.END, f"  ⌥  {r['owner']}/{r['name']}")

    def _on_recent_select(self, e):
        sel = self.recent_listbox.curselection()
        if not sel:
            return
        r = self.recent[sel[0]]
        self.url_entry.delete(0, tk.END)
        self.url_entry.insert(0, f"{r['owner']}/{r['name']}")
        self._load_repo()

    def _clear_recent(self):
        if messagebox.askyesno(APP_NAME, 'Clear recent repos?'):
            self.recent = []
            save_json(RECENT_FILE, self.recent)
            self._refresh_recent()

    # ─────────────────────────────────────────────────────────────────────────
    # SEARCH
    # ─────────────────────────────────────────────────────────────────────────
    def _focus_search(self):
        self._switch_tab('search')
        self.search_entry.focus_set()

    def _run_search(self):
        query = self.search_var.get().strip().lower()
        self.search_listbox.delete(0, tk.END)
        self._search_paths = []
        if not query or not self.tree_data:
            return
        matches = [i for i in self.tree_data
                   if i['type'] == 'blob' and query in i['path'].lower()][:100]
        for item in matches:
            self._search_paths.append(item['path'])
            self.search_listbox.insert(tk.END,
                f'  📄  {item["path"].split("/")[-1]}  —  {item["path"]}')

    def _on_search_select(self, e):
        sel = self.search_listbox.curselection()
        if not sel:
            return
        path = self._search_paths[sel[0]]
        self._open_file(path)
        self._switch_tab('explorer')

    # ─────────────────────────────────────────────────────────────────────────
    # DOWNLOADS
    # ─────────────────────────────────────────────────────────────────────────
    def _download_active(self, pane):
        if self.active_file:
            self._download_file(self.active_file)

    def _download_file(self, path):
        if not self.repo:
            return
        from tkinter import filedialog
        default_name = path.split('/')[-1]
        save_path = filedialog.asksaveasfilename(
            defaultextension='',
            initialfile=default_name,
            title='Save File'
        )
        if not save_path:
            return
        threading.Thread(target=self._download_thread,
                          args=(path, save_path), daemon=True).start()

    def _download_thread(self, path, save_path):
        try:
            r = self.repo
            data = download_raw_bytes(r['owner'], r['name'], r['branch'], path)
            with open(save_path, 'wb') as f:
                f.write(data)
            self.root.after(0, lambda: self._set_status_text(
                f'Downloaded: {save_path.split("/")[-1]}'))
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror(APP_NAME,
                f'Download failed: {e}'))

    def _download_zip(self):
        if not self.repo:
            return
        r = self.repo
        url = f'https://github.com/{r["owner"]}/{r["name"]}/archive/refs/heads/{r["branch"]}.zip'
        webbrowser.open(url)

    # ─────────────────────────────────────────────────────────────────────────
    # MISC
    # ─────────────────────────────────────────────────────────────────────────
    def _open_github(self, pane):
        if not self.repo or not self.active_file:
            return
        r = self.repo
        url = f'https://github.com/{r["owner"]}/{r["name"]}/blob/{r["branch"]}/{self.active_file}'
        webbrowser.open(url)

    def _show_welcome(self):
        self._show_welcome_in_pane(self.primary_content)

    def _on_css_toggle(self):
        self.apply_css = self.apply_css_var.get()
        # Re-render if active file is HTML
        if self.active_file:
            ext = self.active_file.rsplit('.', 1)[-1].lower()
            if ext in ('html', 'htm') and self._split_visible:
                threading.Thread(target=self._load_file_thread,
                                  args=(self.active_file, 'secondary', 'preview'),
                                  daemon=True).start()

    def _toggle_theme(self):
        self.dark_mode = not self.dark_mode
        self.colors = DARK_THEME if self.dark_mode else LIGHT_THEME
        messagebox.showinfo(APP_NAME,
            'Theme changed. Please restart for full effect.\n'
            '(Full dynamic theming requires restart.)')

    def _on_close(self):
        save_json(FAVS_FILE, self.favorites)
        save_json(RECENT_FILE, self.recent)
        self.root.destroy()


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════
def main():
    root = tk.Tk()
    try:
        root.tk.call('tk', 'scaling', 1.25)
    except Exception:
        pass
    app = GitPeekApp(root)
    root.mainloop()

if __name__ == '__main__':
    main()