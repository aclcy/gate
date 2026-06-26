// 当前版本号 - 每次发布时自动更新
const CURRENT_VERSION = 'v3.3.4';

// 搜索引擎定义
const DEFAULT_ENGINES = [
    { id: 'bookmark', name: '书签搜索（需要登录并导入书签）', searchUrl: null, color: '#2c3e50' },
    { id: 'bing', name: '必应', searchUrl: 'https://www.bing.com/search?q={q}', color: '#008373' },
    { id: 'baidu', name: '百度', searchUrl: 'https://www.baidu.com/s?wd={q}', color: '#2932E1' },
    { id: 'sogou', name: '搜狗', searchUrl: 'https://www.sogou.com/web?query={q}', color: '#FF4F01' },
    { id: 'so360', name: '360搜索', searchUrl: 'https://www.so.com/s?q={q}', color: '#40BA21' },
    { id: 'metaso', name: '秘塔AI', searchUrl: 'https://metaso.cn/?q={q}', color: '#6C5CE7' },
];

function getEngineIconSVG(engineId, size) {
    const s = size || 20;
    if (engineId === 'bookmark') {
        return '<img src="favicon.png" width="' + s + '" height="' + s + '" style="border-radius:4px" alt="Mark">';
    }
    // 必应：直接使用其 favicon URL（代理抓取不稳定）
    if (engineId === 'bing') {
        return '<img src="https://www.bing.com/favicon.ico" width="' + s + '" height="' + s + '" style="border-radius:4px" alt="" '
            + 'onerror="this.outerHTML=\'<svg width=' + s + ' height=' + s + ' viewBox=0 0 24 24><rect width=24 height=24 rx=12 fill=%23008373/><text x=12 y=17 text-anchor=middle fill=white font-size=13 font-weight=bold font-family=Arial>b</text></svg>\'">';
    }
    // 1. 优先从全局引擎列表（服务端下发，含内置+管理员添加）查找
    // 2. 找不到时从 DEFAULT_ENGINES 查找（服务端未返回时的兜底）
    // 3. 再找不到则查用户本地自定义引擎
    try {
        var globalList = (typeof GLOBAL_ENGINES !== 'undefined' ? GLOBAL_ENGINES : []);
        var customList = JSON.parse(localStorage.getItem('mark_custom_engines') || '[]');
        // 合并：全局 → 默认内置 → 用户自定义，确保任何 id 都能找到
        var allDynamic = globalList.concat(
            DEFAULT_ENGINES.filter(function(e) {
                return e.id !== 'bookmark' && !globalList.some(function(g) { return g.id === e.id; });
            })
        ).concat(
            customList.filter(function(e) {
                return !globalList.some(function(g) { return g.id === e.id; });
            })
        );
        var cEng = allDynamic.find(function(e) { return e.id === engineId; });
        if (cEng && cEng.searchUrl) {
            var urlStr = cEng.searchUrl.replace('{q}', '');
            var uObj = new URL(urlStr);
            var hName = uObj.hostname;
            var fChar = (cEng.name || '?').charAt(0).toUpperCase();
            var fColor = cEng.color || '#666';
            var fUrl = '/api/favicon/' + encodeURIComponent(hName);
            return '<img src="' + fUrl + '" width="' + s + '" height="' + s + '" style="border-radius:4px" alt="" onerror="this.outerHTML=\'<svg width=' + s + ' height=' + s + ' viewBox=0 0 24 24><rect width=24 height=24 rx=12 fill=' + fColor + '/><text x=12 y=17 text-anchor=middle fill=white font-size=13 font-weight=bold font-family=Arial>' + fChar + '</text></svg>\'">';
        }
    } catch (e) {}
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24"><rect width="24" height="24" rx="12" fill="#666"/><text x="12" y="17" text-anchor="middle" fill="white" font-size="12" font-weight="bold" font-family="Arial">?</text></svg>';
}

// 统一 favicon 加载策略
// 核心：自建服务端代理 + 客户端 localStorage 缓存，实现近乎零延迟
// 流程：localStorage 缓存 → 服务端代理 API → 首字母 fallback
const FAVICON_CACHE_KEY = 'mark_favicon_cache';
const FAVICON_CACHE_MAX = 500; // 最多缓存500个域名
const FAVICON_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7天过期

function getFaviconCache() {
    try {
        return JSON.parse(localStorage.getItem(FAVICON_CACHE_KEY) || '{}');
    } catch (e) { return {}; }
}

function setFaviconCacheEntry(hostname, dataUrl) {
    try {
        const cache = getFaviconCache();
        cache[hostname] = { url: dataUrl, t: Date.now() };
        // 清理过期和超量
        const keys = Object.keys(cache);
        if (keys.length > FAVICON_CACHE_MAX) {
            keys.sort((a, b) => cache[a].t - cache[b].t);
            const remove = keys.slice(0, keys.length - FAVICON_CACHE_MAX);
            remove.forEach(k => delete cache[k]);
        }
        localStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(cache));
    } catch (e) { /* localStorage 满了忽略 */ }
}

function getFaviconCacheEntry(hostname) {
    const cache = getFaviconCache();
    const entry = cache[hostname];
    if (!entry) return null;
    if (Date.now() - entry.t > FAVICON_CACHE_TTL) {
        delete cache[hostname];
        try { localStorage.setItem(FAVICON_CACHE_KEY, JSON.stringify(cache)); } catch(e) {}
        return null;
    }
    return entry.url;
}

// 通用 favicon 加载器：先查缓存，再走服务端代理，最后 fallback
function loadFavicon(imgEl, hostname, fallbackChar) {
    if (!hostname) {
        showFallback(imgEl, fallbackChar);
        return;
    }
    // 1. 先查 localStorage 缓存
    const cached = getFaviconCacheEntry(hostname);
    if (cached) {
        imgEl.src = cached;
        imgEl.style.opacity = '1';
        return;
    }
    // 2. 走服务端代理 API（服务端用 favicon.im 抓取并缓存）
    const proxyUrl = '/api/favicon/' + encodeURIComponent(hostname);
    imgEl.onerror = function() {
        // 代理也失败，显示首字母
        showFallback(imgEl, fallbackChar);
    };
    imgEl.onload = function() {
        imgEl.style.opacity = '1';
        // 缓存到 localStorage（用 proxy URL，浏览器会缓存）
    };
    imgEl.src = proxyUrl;
}

// 简洁模式专用：不替换 DOM，只设 src（因为 img 已经在 DOM 中）
function loadFaviconInPlace(imgEl, hostname, fallbackChar) {
    if (!hostname) {
        showFallback(imgEl, fallbackChar);
        return;
    }
    const cached = getFaviconCacheEntry(hostname);
    if (cached) {
        imgEl.src = cached;
        return;
    }
    const proxyUrl = '/api/favicon/' + encodeURIComponent(hostname);
    imgEl.onerror = function() {
        showFallback(imgEl, fallbackChar);
    };
    imgEl.src = proxyUrl;
}

function showFallback(imgEl, fallbackChar) {
    if (fallbackChar && imgEl.parentNode) {
        const span = document.createElement('span');
        span.textContent = fallbackChar || '?';
        // 根据上下文使用不同样式：简洁模式用 clean-icon-char，书签列表用 bookmark-favicon-fallback
        if (imgEl.closest && imgEl.closest('.clean-bookmark-icon')) {
            span.className = 'clean-icon-char';
        } else {
            span.className = 'bookmark-favicon-fallback';
        }
        imgEl.parentNode.replaceChild(span, imgEl);
    } else {
        imgEl.style.opacity = '0';
    }
}

// 全局引擎（由服务端管理，启动时异步拉取）
let GLOBAL_ENGINES = [];

function getAllEngines() {
    const customs = JSON.parse(localStorage.getItem('mark_custom_engines') || '[]');
    // 服务端返回全局引擎时（包含内置+管理员添加），以服务端顺序为准
    // 服务端不可达时 fallback 到 DEFAULT_ENGINES
    const base = (typeof GLOBAL_ENGINES !== 'undefined' && GLOBAL_ENGINES.length > 0)
        ? GLOBAL_ENGINES
        : DEFAULT_ENGINES;
    // 过滤掉管理员隐藏的引擎（visible === false）
    const visibleBase = base.filter(function(e) { return e.visible !== false; });
    // 用户自定义引擎追加到末尾（去重：不覆盖同ID的全局引擎）
    const baseIds = new Set(visibleBase.map(function(e) { return e.id; }));
    const uniqueCustoms = customs.filter(function(e) { return !baseIds.has(e.id); });
    return [...visibleBase, ...uniqueCustoms];
}

// 拉取全局引擎并刷新图标/选择器
function fetchGlobalEngines() {
    fetch('/api/global-engines')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success && Array.isArray(data.engines) && data.engines.length > 0) {
                GLOBAL_ENGINES = data.engines;
                // 刷新当前搜索引擎图标（全局引擎可能是当前选中引擎）
                if (typeof updateEngineIcon === 'function') updateEngineIcon();
                if (typeof updateCleanEngineIcon === 'function') updateCleanEngineIcon();
            }
        })
        .catch(function() {}); // 拉取失败不影响正常使用
}

function getCurrentEngine() {
    const all = getAllEngines();
    const id = localStorage.getItem('mark_engine') || 'bing';
    return all.find(e => e.id === id) || all[0] || DEFAULT_ENGINES.find(e => e.id === 'bing');
}

// 文件夹 SVG 图标
// type: 'empty' = 无子文件夹, 'open' = 有子+展开(方案A展开), 'closed' = 有子+收起(方案B)
function getFolderIconSVG(type, size) {
    const w = size || 16;
    const s = size || 16;
    if (type === 'empty') {
        // 方案 A 闭合：空白文件夹，无子文件夹
        return '<svg width="' + w + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6a2 2 0 0 1 2-2h7l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z"/></svg>';
    }
    if (type === 'open') {
        // 方案 A 展开：前盖翻开
        return '<svg width="' + w + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l2 2h7a2 2 0 0 1 2 2v1Z"/><path d="M2 8h20"/><path d="M4 8l1.5 3h13L20 8"/></svg>';
    }
    // 方案 B：有子文件夹但收起，内部三条文档横线
    return '<svg width="' + w + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6a2 2 0 0 1 2-2h7l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z"/><path d="M7 13h10"/><path d="M7 16h7"/><path d="M7 10h8"/></svg>';
}

function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('toast--show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => toast.classList.remove('toast--show'), 3500);
}

// 全选（挂到 window 供 onclick 调用）
function toggleSelectAll() { if (window._markToggleSelectAll) window._markToggleSelectAll(); }

document.addEventListener('DOMContentLoaded', () => {
    const API_URL = '/api';

    // 启动时拉取全局引擎
    fetchGlobalEngines();

    let currentUser = null;
    let currentUserId = null;
    let bookmarks = [];
    let selectedFolder = null;

    // 多选状态
    let multiSelectMode = false;
    let selectedItems = []; // {type: 'folder'|'bookmark', item: ..., parentArray: ...}

    // 拖拽排序状态
    let dragState = null; // { items: [...], srcArray: [...] }

    // 初始化版本号显示
    const versionDisplay = document.getElementById('version-display');
    if (versionDisplay) {
        versionDisplay.textContent = CURRENT_VERSION;
    }

    // 初始化DOM元素
    const loginTab = document.getElementById('login-tab');
    const registerTab = document.getElementById('register-tab');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const authContainer = document.getElementById('auth-container');
    const mainContainer = document.getElementById('main-container');
    const logoutBtn = document.getElementById('logout-btn');
    const changelogBtn = document.getElementById('changelog-btn');
    const folderTree = document.getElementById('folder-tree');
    const bookmarksList = document.getElementById('bookmarks-list');
    const selectedFolderName = document.getElementById('selected-folder-name');
    const changelogModal = document.getElementById('changelog-modal');
    const adminBtn = document.getElementById('admin-btn');
    const sharesBtn = document.getElementById('shares-btn');
    const sharesModal = document.getElementById('shares-modal');
    const sharesModalClose = document.getElementById('shares-modal-close');
    const sharesList = document.getElementById('shares-list');
    const searchInput = document.querySelector('.search-input');
    const searchEngineBtn = document.getElementById('search-engine-btn');
    const searchSubmitBtn = document.getElementById('search-submit-btn');
    const searchEnginePicker = document.getElementById('search-engine-picker');
    const contentActions = document.getElementById('content-actions');
    const langBtn = document.getElementById('lang-btn');
    const themeBtn = document.getElementById('theme-btn');
    const navMenuBtn = document.getElementById('nav-menu-btn');
    const navMenuDropdown = document.getElementById('nav-menu-dropdown');
    const searchHistoryBtn = document.getElementById('search-history-btn');
    const searchHistoryPanel = document.getElementById('search-history-panel');
    const searchHistoryClose = document.getElementById('search-history-close');
    const searchHistoryClear = document.getElementById('search-history-clear');
    const searchHistoryList = document.getElementById('search-history-list');
    const searchHistoryFilter = document.getElementById('search-history-filter');

    // 简洁模式 DOM
    const cleanModeView = document.getElementById('clean-mode-view');
    const cleanSearchInput = document.getElementById('clean-search-input');
    const cleanSearchEngineBtn = document.getElementById('clean-search-engine-btn');
    const cleanSearchSubmitBtn = document.getElementById('clean-search-submit-btn');
    const cleanSearchEnginePicker = document.getElementById('clean-search-engine-picker');
    const cleanSuggestionsDropdown = document.getElementById('clean-suggestions-dropdown');
    const cleanBookmarksGrid = document.getElementById('clean-bookmarks-grid');
    const viewModeBtn = document.getElementById('view-mode-btn');

    // ====== 视图模式 ======
    let currentViewMode = localStorage.getItem('mark_view_mode') || 'bookmark';
    function getDefaultViewMode() {
        return currentUserId ? 'bookmark' : 'clean';
    }

    function switchViewMode(mode) {
        currentViewMode = mode;
        localStorage.setItem('mark_view_mode', mode);
        const mainLayout = document.querySelector('.main-layout');
        if (mode === 'clean') {
            if (mainLayout) mainLayout.classList.add('hidden');
            if (cleanModeView) cleanModeView.classList.remove('hidden');
            document.body.classList.add('clean-mode-active');
            renderCleanModeBookmarks();
            updateCleanEngineIcon();
        } else {
            if (mainLayout) mainLayout.classList.remove('hidden');
            if (cleanModeView) cleanModeView.classList.add('hidden');
            document.body.classList.remove('clean-mode-active');
        }
        if (viewModeBtn) {
            const t = i18n[currentLang];
            viewModeBtn.textContent = mode === 'clean' ? t.bookmarkMode : t.cleanMode;
        }
    }

    function renderCleanModeBookmarks() {
        if (!cleanBookmarksGrid) return;
        if (!currentUserId) {
            cleanBookmarksGrid.innerHTML = '';
            return;
        }
        const all = getAllBookmarks(bookmarks);
        const items = all.filter(b => b.type === 'bookmark').slice(0, 9);
        let html = '';
        items.forEach(item => {
            const title = escapeHtml(item.title);
            const firstChar = (item.title || '?').charAt(0).toUpperCase();
            let hostname = '';
            try { hostname = new URL(item.url).hostname; } catch (e) {}
            const iconHtml = hostname
                ? `<img src="" alt="" width="48" height="48" data-hostname="${escapeAttr(hostname)}" data-fallback="${escapeAttr(firstChar)}" class="clean-favicon">`
                : `<span class="clean-icon-char">${escapeHtml(firstChar)}</span>`;
            html += `<a class="clean-bookmark-item" href="${escapeAttr(item.url)}" target="_blank" title="${title}">
                <div class="clean-bookmark-icon">${iconHtml}</div>
                <span class="clean-bookmark-title">${title}</span>
            </a>`;
        });
        // 添加按钮
        html += `<button class="clean-add-btn" id="clean-add-bookmark-btn">
            <div class="clean-add-icon">+</div>
            <span class="clean-add-label">添加</span>
        </button>`;
        cleanBookmarksGrid.innerHTML = html;
        // 使用统一 favicon 加载
        cleanBookmarksGrid.querySelectorAll('.clean-favicon').forEach(img => {
            loadFaviconInPlace(img, img.dataset.hostname, img.dataset.fallback);
        });
        // 绑定点击事件（记录访问历史）
        cleanBookmarksGrid.querySelectorAll('.clean-bookmark-item').forEach(el => {
            el.addEventListener('click', () => {
                saveVisitHistory(el.href, el.title);
                debouncedSearchHistorySync();
            });
        });
        const addBtn = document.getElementById('clean-add-bookmark-btn');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                navMenuDropdown.classList.add('hidden');
                addBookmarkToCurrentFolder();
            });
        }
    }

    function updateCleanEngineIcon() {
        if (!cleanSearchEngineBtn) return;
        const engine = getCurrentEngine();
        cleanSearchEngineBtn.innerHTML = getEngineIconSVG(engine.id, 22);
    }

    // 简洁模式搜索引擎选择器
    function renderCleanEnginePicker() {
        if (!cleanSearchEnginePicker) return;
        const currentId = localStorage.getItem('mark_engine') || 'bing';
        const engines = getAllEngines();

        let html = '';
        engines.forEach(eng => {
            const isActive = eng.id === currentId;
            const isBookmark = eng.id === 'bookmark';
            if (isBookmark && !currentUserId) return;
            const isCustom = !DEFAULT_ENGINES.some(d => d.id === eng.id);
            html += '<div class="engine-item' + (isActive ? ' active' : '') + '" data-engine-id="' + eng.id + '">';
            html += '<div class="engine-item-icon">' + getEngineIconSVG(eng.id, 28) + '</div>';
            html += '<span class="engine-item-name">' + eng.name + '</span>';
            if (isActive) html += '<span class="engine-item-check">&#10003;</span>';
            if (isCustom) html += '<button class="engine-item-delete" data-delete="' + eng.id + '" title="删除">&times;</button>';
            html += '</div>';
        });
        html += '<div class="engine-divider"></div>';
        html += '<button class="engine-add-btn" data-action="add-engine" type="button">';
        html += '<div class="engine-add-icon">+</div>';
        html += '<span>自定义搜索引擎</span>';
        html += '</button>';

        cleanSearchEnginePicker.innerHTML = html;
        cleanSearchEnginePicker.classList.add('show');
    }

    function showCleanCustomEngineForm() {
        cleanSearchEnginePicker.innerHTML =
            '<div class="engine-custom-form">' +
            '<input type="text" id="clean-custom-engine-name" placeholder="搜索引擎名称" autocomplete="off">' +
            '<input type="text" id="clean-custom-engine-url" placeholder="搜索地址（用 {q} 代替关键词）" autocomplete="off">' +
            '<div class="engine-custom-actions">' +
            '<button type="button" id="clean-custom-engine-cancel">取消</button>' +
            '<button type="button" class="engine-save-btn" id="clean-custom-engine-save">添加</button>' +
            '</div></div>';

        setTimeout(() => {
            const nameInput = document.getElementById('clean-custom-engine-name');
            const urlInput = document.getElementById('clean-custom-engine-url');
            const cancelBtn = document.getElementById('clean-custom-engine-cancel');
            const saveBtn = document.getElementById('clean-custom-engine-save');

            if (nameInput) nameInput.focus();

            if (cancelBtn) {
                cancelBtn.onclick = function(e) {
                    e.stopPropagation();
                    cleanSearchEnginePicker.classList.remove('show');
                    setTimeout(() => renderCleanEnginePicker(), 100);
                };
            }

            if (saveBtn) {
                saveBtn.onclick = function(e) {
                    e.stopPropagation();
                    const name = nameInput ? nameInput.value.trim() : '';
                    const url = urlInput ? urlInput.value.trim() : '';
                    if (!name || !url) {
                        alert('请填写名称和搜索地址');
                        return;
                    }
                    if (!url.includes('{q}')) {
                        alert('搜索地址必须包含 {q} 作为搜索关键词占位符');
                        return;
                    }
                    const customs = JSON.parse(localStorage.getItem('mark_custom_engines') || '[]');
                    const id = 'custom_' + Date.now();
                    customs.push({ id, name, searchUrl: url, color: '#666' });
                    localStorage.setItem('mark_custom_engines', JSON.stringify(customs));
                    localStorage.setItem('mark_engine', id);
                    saveCustomEnginesToCloud();
                    savePreference('currentEngine', id);
                    updateEngineIcon();
                    updateCleanEngineIcon();
                    renderCleanEnginePicker();
                };
            }
        }, 50);
    }

    if (cleanSearchEngineBtn) {
        cleanSearchEngineBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (cleanSearchEnginePicker.classList.contains('show')) {
                cleanSearchEnginePicker.classList.remove('show');
            } else {
                cleanSearchEnginePicker.classList.remove('show');
                renderCleanEnginePicker();
            }
        });
    }

    // 简洁模式引擎选择器面板内事件委托
    if (cleanSearchEnginePicker) {
        cleanSearchEnginePicker.addEventListener('click', function(e) {
            const engineItem = e.target.closest('.engine-item');
            if (engineItem && !e.target.closest('.engine-item-delete')) {
                const engineId = engineItem.dataset.engineId;
                if (engineId === 'bookmark' && !currentUser) {
                    cleanSearchEnginePicker.classList.remove('show');
                    showAuthContainer();
                    return;
                }
                localStorage.setItem('mark_engine', engineId);
                savePreference('currentEngine', engineId);
                updateEngineIcon();
                updateCleanEngineIcon();
                cleanSearchEnginePicker.classList.remove('show');
                return;
            }

            const delBtn = e.target.closest('.engine-item-delete');
            if (delBtn) {
                e.stopPropagation();
                if (!confirm('确定删除这个搜索引擎吗？')) return;
                let customs = JSON.parse(localStorage.getItem('mark_custom_engines') || '[]');
                customs = customs.filter(eng => eng.id !== delBtn.dataset.delete);
                localStorage.setItem('mark_custom_engines', JSON.stringify(customs));
                saveCustomEnginesToCloud();
                const currentId = localStorage.getItem('mark_engine');
                if (currentId === delBtn.dataset.delete) {
                    localStorage.setItem('mark_engine', 'bing');
                    savePreference('currentEngine', 'bing');
                    updateEngineIcon();
                    updateCleanEngineIcon();
                }
                renderCleanEnginePicker();
                return;
            }

            const addBtn = e.target.closest('.engine-add-btn');
            if (addBtn) {
                e.stopPropagation();
                showCleanCustomEngineForm();
                return;
            }
        });
    }

    // 简洁模式搜索输入
    if (cleanSearchInput) {
        cleanSearchInput.addEventListener('input', async () => {
            clearTimeout(suggestionTimer);
            const query = cleanSearchInput.value.trim();
            if (!query) {
                if (cleanSuggestionsDropdown) {
                    cleanSuggestionsDropdown.classList.remove('show');
                    cleanSuggestionsDropdown.innerHTML = '';
                }
                return;
            }
            suggestionTimer = setTimeout(async () => {
                const suggestions = await fetchBingSuggestions(query);
                if (!cleanSearchInput.value.trim() || cleanSearchInput.value.trim() !== query) return;
                const html = await renderSuggestions(suggestions, query);
                if (cleanSuggestionsDropdown) {
                    cleanSuggestionsDropdown.innerHTML = html;
                    cleanSuggestionsDropdown.classList.add('show');
                }
            }, 200);
        });

        cleanSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (cleanSuggestionsDropdown) {
                    cleanSuggestionsDropdown.classList.remove('show');
                    cleanSuggestionsDropdown.innerHTML = '';
                }
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                updateActiveSuggestionClean(1);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                updateActiveSuggestionClean(-1);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const items = cleanSuggestionsDropdown ? cleanSuggestionsDropdown.querySelectorAll('.suggestion-item') : [];
                let activeQuery = '';
                items.forEach((item, idx) => {
                    if (item.classList.contains('active')) activeQuery = item.dataset.query;
                });
                const keyword = activeQuery || cleanSearchInput.value.trim();
                if (keyword) doWebSearch(keyword);
            }
        });
    }

    function updateActiveSuggestionClean(delta) {
        if (!cleanSuggestionsDropdown) return;
        const items = cleanSuggestionsDropdown.querySelectorAll('.suggestion-item');
        if (items.length === 0) return;
        items.forEach(item => item.classList.remove('active'));
        activeSuggestionIdx = Math.max(-1, Math.min(items.length - 1, activeSuggestionIdx + delta));
        if (activeSuggestionIdx >= 0) {
            items[activeSuggestionIdx].classList.add('active');
            items[activeSuggestionIdx].scrollIntoView({ block: 'nearest' });
        }
    }

    if (cleanSuggestionsDropdown) {
        cleanSuggestionsDropdown.addEventListener('click', (e) => {
            const item = e.target.closest('.suggestion-item');
            const footer = e.target.closest('.suggestion-footer');
            if (footer && footer.dataset.action === 'clear-history') {
                clearSearchHistory();
                return;
            }
            if (item && item.dataset.query) {
                doWebSearch(item.dataset.query);
            }
        });
    }

    if (cleanSearchSubmitBtn) {
        cleanSearchSubmitBtn.addEventListener('click', () => {
            const query = cleanSearchInput.value.trim();
            if (!query) return;
            doWebSearch(query);
        });
    }

    // 简洁模式外部点击关闭
    document.addEventListener('click', (e) => {
        if (cleanSearchEnginePicker && !cleanSearchEnginePicker.contains(e.target) && e.target !== cleanSearchEngineBtn) {
            cleanSearchEnginePicker.classList.remove('show');
        }
        if (cleanSuggestionsDropdown && !cleanSuggestionsDropdown.contains(e.target) && e.target !== cleanSearchInput) {
            cleanSuggestionsDropdown.classList.remove('show');
            cleanSuggestionsDropdown.innerHTML = '';
        }
    });

    // 视图模式切换按钮
    if (viewModeBtn) {
        viewModeBtn.addEventListener('click', () => {
            navMenuDropdown.classList.add('hidden');
            const newMode = currentViewMode === 'clean' ? 'bookmark' : 'clean';
            switchViewMode(newMode);
        });
    }

    // ====== 语言与主题切换 ======
    let currentLang = localStorage.getItem('mark_lang') || 'zh';
    // 兼容旧版 light → white
    let currentTheme = localStorage.getItem('mark_theme') || 'white';
    if (currentTheme === 'light') currentTheme = 'white';
    const THEME_LIST = ['white', 'warm', 'cool', 'green', 'pink', 'dark'];
    const THEME_NAMES = {
        white: '纯白', warm: '暖色', cool: '冷色',
        green: '护眼', pink: '粉色', dark: '暗色'
    };

    // 偏好管理
    async function loadPreferences() {
        if (!currentUserId) return;
        try {
            const resp = await fetch(`${API_URL}/preferences/${currentUserId}`);
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.success && data.preferences) {
                // 加载自定义搜索引擎：合并云端与本地（云端为准，本地有而云端没有的也保留并同步）
                const localCustoms = JSON.parse(localStorage.getItem('mark_custom_engines') || '[]');
                if (Array.isArray(data.preferences.customEngines)) {
                    const cloudCustoms = data.preferences.customEngines;
                    const cloudIds = new Set(cloudCustoms.map(e => e.id));
                    // 本地独有（尚未同步）的引擎追加到云端列表
                    const localOnly = localCustoms.filter(e => !cloudIds.has(e.id));
                    const merged = [...cloudCustoms, ...localOnly];
                    localStorage.setItem('mark_custom_engines', JSON.stringify(merged));
                    // 如果有本地独有引擎，立即同步到云端
                    if (localOnly.length > 0) {
                        savePreference('customEngines', merged);
                    }
                } else if (localCustoms.length > 0) {
                    // 云端没有记录但本地有，直接同步上去
                    savePreference('customEngines', localCustoms);
                }
                if (data.preferences.currentEngine) {
                    localStorage.setItem('mark_engine', data.preferences.currentEngine);
                }
                updateEngineIcon();
                updateCleanEngineIcon();
            }
        } catch (e) {
            console.log('加载偏好失败');
        }
    }

    // 保存自定义引擎列表到云端
    function saveCustomEnginesToCloud() {
        if (!currentUserId) return;
        const customs = JSON.parse(localStorage.getItem('mark_custom_engines') || '[]');
        savePreference('customEngines', customs);
    }

    async function savePreference(key, value) {
        if (!currentUserId) return;
        try {
            await fetch(`${API_URL}/save-preference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUserId, key, value })
            });
        } catch (e) {
            console.log('保存偏好失败');
        }
    }

    // ====== 搜索历史云同步 ======
    let searchHistorySyncTimer = null;

    // 从云端加载搜索历史并与本地合并
    async function loadSearchHistoryFromCloud() {
        if (!currentUserId) return;
        try {
            const resp = await fetch(`${API_URL}/preferences/${currentUserId}`);
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.success && data.preferences && Array.isArray(data.preferences.searchHistory)) {
                const cloudHistory = data.preferences.searchHistory;
                const localHistory = getSearchHistory();
                const merged = mergeSearchHistory(localHistory, cloudHistory);
                localStorage.setItem('mark_bing_history', JSON.stringify(merged));
                if (searchHistoryList && searchHistoryPanel && !searchHistoryPanel.classList.contains('hidden')) {
                    renderSearchHistoryPanel();
                }
            }
        } catch (e) {
            console.log('加载搜索历史失败');
        }
    }

    // 合并本地和云端历史（去重，保留较新版本）
    function mergeSearchHistory(local, cloud) {
        const map = new Map();
        const all = [...cloud, ...local];
        all.forEach(item => {
            const key = (item.query || '') + '|' + (item.type || 'search') + '|' + (item.url || '') + '|' + (item.time || 0);
            map.set(key, item);
        });
        return Array.from(map.values()).sort((a, b) => b.time - a.time).slice(0, 100);
    }

    // 保存搜索历史到云端（防抖）
    async function saveSearchHistoryToCloud() {
        if (!currentUserId) return;
        try {
            const history = getSearchHistory();
            await fetch(`${API_URL}/save-preference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUserId, key: 'searchHistory', value: history })
            });
        } catch (e) {
            console.log('保存搜索历史到云端失败');
        }
    }

    function debouncedSearchHistorySync() {
        if (searchHistorySyncTimer) clearTimeout(searchHistorySyncTimer);
        searchHistorySyncTimer = setTimeout(() => {
            saveSearchHistoryToCloud();
        }, 3000);
    }

    // 强制立即同步（用于登出、页面关闭）
    async function forceSearchHistorySync() {
        if (searchHistorySyncTimer) clearTimeout(searchHistorySyncTimer);
        await saveSearchHistoryToCloud();
    }

    function updateEngineIcon() {
        const engine = getCurrentEngine();
        if (searchEngineBtn) {
            searchEngineBtn.innerHTML = getEngineIconSVG(engine.id, 28);
        }
        if (searchInput) {
            const t = i18n[currentLang];
            searchInput.placeholder = isBookmarkMode() ? t.searchBookmark : t.searchPlaceholder;
        }
        if (cleanSearchEngineBtn) {
            cleanSearchEngineBtn.innerHTML = getEngineIconSVG(engine.id, 28);
        }
        if (cleanSearchInput) {
            const t = i18n[currentLang];
            cleanSearchInput.placeholder = isBookmarkMode() ? t.searchBookmark : t.searchPlaceholder;
        }
    }

    // 渲染搜索引擎选择器面板
    function renderEnginePicker() {
        if (!searchEnginePicker) return;
        const currentId = localStorage.getItem('mark_engine') || 'bing';
        const engines = getAllEngines();

        let html = '';
        engines.forEach((eng, idx) => {
            const isActive = eng.id === currentId;
            const isCustom = !DEFAULT_ENGINES.some(d => d.id === eng.id);
            html += '<div class="engine-item' + (isActive ? ' active' : '') + '" data-engine-id="' + eng.id + '">';
            html += '<div class="engine-item-icon">' + getEngineIconSVG(eng.id, 28) + '</div>';
            html += '<span class="engine-item-name">' + eng.name + '</span>';
            if (isActive) html += '<span class="engine-item-check">&#10003;</span>';
            if (isCustom) html += '<button class="engine-item-delete" data-delete="' + eng.id + '" title="删除">&times;</button>';
            html += '</div>';
        });
        html += '<div class="engine-divider"></div>';
        html += '<button class="engine-add-btn" data-action="add-engine" type="button">';
        html += '<div class="engine-add-icon">+</div>';
        html += '<span>自定义搜索引擎</span>';
        html += '</button>';

        searchEnginePicker.innerHTML = html;
        searchEnginePicker.classList.remove('hidden');
        searchEnginePicker.classList.add('show');
    }

    function hideEnginePicker() {
        if (searchEnginePicker) {
            searchEnginePicker.classList.remove('show');
            searchEnginePicker.classList.add('hidden');
        }
    }

    function showCustomEngineForm() {
        searchEnginePicker.innerHTML = 
            '<div class="engine-custom-form">' +
            '<input type="text" id="custom-engine-name" placeholder="搜索引擎名称" autocomplete="off">' +
            '<input type="text" id="custom-engine-url" placeholder="搜索地址（用 {q} 代替关键词）" autocomplete="off">' +
            '<div class="engine-custom-actions">' +
            '<button type="button" id="custom-engine-cancel">取消</button>' +
            '<button type="button" class="engine-save-btn" id="custom-engine-save">添加</button>' +
            '</div></div>';

        // 直接绑定事件，不依赖委托（委托在 innerHTML 替换后可能有竞态）
        setTimeout(() => {
            const nameInput = document.getElementById('custom-engine-name');
            const urlInput = document.getElementById('custom-engine-url');
            const cancelBtn = document.getElementById('custom-engine-cancel');
            const saveBtn = document.getElementById('custom-engine-save');

            if (nameInput) nameInput.focus();

            if (cancelBtn) {
                cancelBtn.onclick = function(e) {
                    e.stopPropagation();
                    hideEnginePicker();
                    setTimeout(() => renderEnginePicker(), 100);
                };
            }

            if (saveBtn) {
                saveBtn.onclick = function(e) {
                    e.stopPropagation();
                    const name = nameInput ? nameInput.value.trim() : '';
                    const url = urlInput ? urlInput.value.trim() : '';
                    if (!name || !url) {
                        alert('请填写名称和搜索地址');
                        return;
                    }
                    if (!url.includes('{q}')) {
                        alert('搜索地址必须包含 {q} 作为搜索关键词占位符');
                        return;
                    }
                    addCustomEngine(name, url);
                };
            }
        }, 50);
    }

    function addCustomEngine(name, url) {
        const customs = JSON.parse(localStorage.getItem('mark_custom_engines') || '[]');
        const id = 'custom_' + Date.now();
        customs.push({ id, name, searchUrl: url, color: '#666' });
        localStorage.setItem('mark_custom_engines', JSON.stringify(customs));
        localStorage.setItem('mark_engine', id);
        saveCustomEnginesToCloud();
        savePreference('currentEngine', id);
        updateEngineIcon();
        updateCleanEngineIcon();
        renderEnginePicker();
    }

    function deleteCustomEngine(engineId) {
        if (!confirm('确定删除这个搜索引擎吗？')) return;
        let customs = JSON.parse(localStorage.getItem('mark_custom_engines') || '[]');
        customs = customs.filter(e => e.id !== engineId);
        localStorage.setItem('mark_custom_engines', JSON.stringify(customs));
        saveCustomEnginesToCloud();

        const currentId = localStorage.getItem('mark_engine');
        if (currentId === engineId) {
            localStorage.setItem('mark_engine', 'bing');
            savePreference('currentEngine', 'bing');
            updateEngineIcon();
            updateCleanEngineIcon();
        }
        renderEnginePicker();
    }

    // 搜索引擎按钮点击
    if (searchEngineBtn) {
        searchEngineBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (searchEnginePicker.classList.contains('show')) {
                hideEnginePicker();
            } else {
                hideEnginePicker();
                renderEnginePicker();
            }
        });
    }

    // 引擎选择器面板内事件委托（绑定一次，不依赖每次 innerHTML 重建）
    if (searchEnginePicker) {
        searchEnginePicker.addEventListener('click', function(e) {
            // 点击引擎项
            const engineItem = e.target.closest('.engine-item');
            if (engineItem && !e.target.closest('.engine-item-delete')) {
                const engineId = engineItem.dataset.engineId;
                if (engineId === 'bookmark' && !currentUser) {
                    // 未登录：跳转登录界面
                    hideEnginePicker();
                    showAuthContainer();
                    return;
                }
                localStorage.setItem('mark_engine', engineId);
                savePreference('currentEngine', engineId);
                updateEngineIcon();
                hideEnginePicker();
                if (engineId === 'bookmark') {
                    searchInput.value = '';
                    if (selectedFolder) {
                        selectedFolderName.textContent = selectedFolder.name;
                        updateBookmarksList(selectedFolder.children || []);
                    }
                }
                return;
            }

            // 删除自定义引擎
            const delBtn = e.target.closest('.engine-item-delete');
            if (delBtn) {
                deleteCustomEngine(delBtn.dataset.delete);
                return;
            }

            // 自定义搜索引擎按钮
            if (e.target.closest('[data-action="add-engine"]')) {
                showCustomEngineForm();
                return;
            }
        });
    }

    // 点击外部关闭引擎选择器
    document.addEventListener('click', (e) => {
        if (searchEnginePicker && !searchEnginePicker.contains(e.target) && e.target !== searchEngineBtn) {
            hideEnginePicker();
        }
    });

    const i18n = {
        zh: {
            searchPlaceholder: '搜索或输入网址',
            searchBookmark: '搜索书签',
            login: '登录',
            register: '注册',
            loginBtn: '登录',
            registerBtn: '注册',
            username: '用户名',
            password: '密码',
            confirmPassword: '确认密码',
            multiSelect: '多选',
            shares: '短链接',
            searchHistory: '搜索历史',
            admin: '后台管理',
            logout: '退出登录',
            profile: '个人',
            cleanMode: '简洁模式',
            bookmarkMode: '书签模式',
            loginSync: '登录同步书签',
            profileTitle: '个人资料',
            changeUsername: '新用户名（留空不修改）',
            currentPassword: '当前密码',
            newPassword: '新密码（留空不修改）',
            profileSave: '保存修改',
            changePassword: '修改密码',
            rootFolder: '根文件夹',
            allBookmarks: '全部书签',
            addBookmark: '添加链接',
            addSubfolder: '新建子文件夹',
            addSibling: '新建同级文件夹',
            import: '导入',
            export: '导出',
            rename: '修改名称',
            flatten: '去层',
            deleteFolder: '删除收藏夹',
            sync: '同步',
            selectAll: '全选',
            selectedCount: '已选',
            delete: '删除',
            copy: '拷贝',
            move: '移动',
            share: '分享',
            cancel: '取消',
            noContent: '暂无内容',
            searchPrefix: '全局搜索',
            changelogTitle: '更新日志',
            shareTitle: '短链接管理',
            loading: '加载中...',
            versionBadgeTitle: '点击查看更新日志'
        },
        en: {
            searchPlaceholder: 'Search or enter URL',
            searchBookmark: 'Search bookmarks',
            login: 'Login',
            register: 'Register',
            loginBtn: 'Login',
            registerBtn: 'Register',
            username: 'Username',
            password: 'Password',
            confirmPassword: 'Confirm Password',
            multiSelect: 'Multi',
            shares: 'Shares',
            searchHistory: 'Search History',
            admin: 'Admin Panel',
            logout: 'Logout',
            profile: 'Profile',
            cleanMode: 'Clean Mode',
            bookmarkMode: 'Bookmark Mode',
            loginSync: 'Login to Sync',
            profileTitle: 'User Profile',
            changeUsername: 'New username (leave blank to keep)',
            currentPassword: 'Current password',
            newPassword: 'New password (leave blank to keep)',
            profileSave: 'Save Changes',
            changePassword: 'Change Password',
            rootFolder: 'Root',
            allBookmarks: 'All Bookmarks',
            addBookmark: 'Add Link',
            addSubfolder: 'New Subfolder',
            addSibling: 'New Sibling',
            import: 'Import',
            export: 'Export',
            rename: 'Rename',
            flatten: 'Flatten',
            deleteFolder: 'Delete Folder',
            sync: 'Sync',
            selectAll: 'Select All',
            selectedCount: 'Selected',
            delete: 'Delete',
            copy: 'Copy',
            move: 'Move',
            share: 'Share',
            cancel: 'Cancel',
            noContent: 'No content',
            searchPrefix: 'Search',
            changelogTitle: 'Changelog',
            shareTitle: 'Share Links',
            loading: 'Loading...',
            versionBadgeTitle: 'Click to view changelog'
        }
    };

    function applyLanguage() {
        const t = i18n[currentLang];
        if (searchInput) {
            searchInput.placeholder = isBookmarkMode() ? t.searchBookmark : t.searchPlaceholder;
        }
        if (loginTab) loginTab.textContent = t.login;
        if (registerTab) registerTab.textContent = t.register;
        if (loginForm) loginForm.querySelector('button').textContent = t.loginBtn;
        if (registerForm) registerForm.querySelector('button').textContent = t.registerBtn;
        if (loginForm) loginForm.querySelector('input[type="text"]').placeholder = t.username;
        if (loginForm) loginForm.querySelector('input[type="password"]').placeholder = t.password;
        if (registerForm) {
            const regInputs = registerForm.querySelectorAll('input');
            if (regInputs[0]) regInputs[0].placeholder = t.username;
            if (regInputs[1]) regInputs[1].placeholder = t.password;
            if (regInputs[2]) regInputs[2].placeholder = t.confirmPassword;
        }
        if (langBtn) langBtn.textContent = currentLang === 'zh' ? '中' : 'En';
        if (multiSelectNavBtn) multiSelectNavBtn.textContent = t.multiSelect;
        if (sharesBtn) sharesBtn.textContent = t.shares;
        if (searchHistoryBtn) searchHistoryBtn.textContent = t.searchHistory;
        if (adminBtn) adminBtn.textContent = t.admin;
        const profileBtn = document.getElementById('profile-btn');
        if (profileBtn) profileBtn.textContent = t.profile;
        if (logoutBtn) logoutBtn.textContent = currentUser ? t.logout : t.loginSync;
        if (viewModeBtn) viewModeBtn.textContent = currentViewMode === 'clean' ? t.bookmarkMode : t.cleanMode;
        if (versionDisplay) versionDisplay.title = t.versionBadgeTitle;
        // 侧边栏标题
        const sidebarTitle = document.querySelector('.sidebar-title');
        if (sidebarTitle) {
            sidebarTitle.innerHTML = `<span class="folder-icon">${getFolderIconSVG('open', 18)}</span>${t.rootFolder}`;
        }
        // 菜单项
        const menuAddBookmark = document.getElementById('menu-add-bookmark-btn');
        const menuAddSubfolder = document.getElementById('menu-add-subfolder-btn');
        const menuAddSibling = document.getElementById('menu-add-sibling-btn');
        const menuImport = document.getElementById('menu-import-btn');
        const menuExport = document.getElementById('menu-export-btn');
        const menuRename = document.getElementById('menu-rename-btn');
        const menuFlatten = document.getElementById('menu-flatten-btn');
        const menuDelete = document.getElementById('menu-delete-btn');
        const menuSync = document.getElementById('menu-sync-btn');
        if (menuAddBookmark) menuAddBookmark.textContent = t.addBookmark;
        if (menuAddSubfolder) menuAddSubfolder.textContent = t.addSubfolder;
        if (menuAddSibling) menuAddSibling.textContent = t.addSibling;
        if (menuImport) menuImport.textContent = t.import;
        if (menuExport) menuExport.textContent = t.export;
        if (menuRename) menuRename.textContent = t.rename;
        if (menuFlatten) menuFlatten.textContent = t.flatten;
        if (menuDelete) menuDelete.textContent = t.deleteFolder;
        if (menuSync) menuSync.textContent = t.sync;
        // 多选栏
        const selectAllLabel = document.querySelector('.multi-select-all-label');
        if (selectAllLabel) {
            const cb = selectAllLabel.querySelector('input');
            selectAllLabel.innerHTML = '';
            if (cb) selectAllLabel.appendChild(cb);
            selectAllLabel.appendChild(document.createTextNode(' ' + t.selectAll));
        }
        if (multiDeleteBtn) multiDeleteBtn.textContent = t.delete;
        if (multiCopyBtn) multiCopyBtn.textContent = t.copy;
        if (multiMoveBtn) multiMoveBtn.textContent = t.move;
        if (multiShareBtn) multiShareBtn.textContent = t.share;
        if (multiCancelBtn) multiCancelBtn.textContent = t.cancel;
        // 更新当前显示
        if (!searchInput || !searchInput.value.trim()) {
            if (selectedFolder) {
                selectedFolderName.textContent = selectedFolder.name;
            } else {
                selectedFolderName.textContent = t.allBookmarks;
            }
        }
    }

    function applyTheme() {
        document.documentElement.setAttribute('data-theme', currentTheme);
        if (themeBtn) {
            var name = THEME_NAMES[currentTheme] || '主题';
            themeBtn.innerHTML = '<span>' + name + '</span>';
            themeBtn.title = '选择主题';
        }
        // 更新下拉面板中的选中状态
        document.querySelectorAll('.theme-picker-item').forEach(function(item) {
            item.classList.toggle('active', item.dataset.theme === currentTheme);
        });
    }

    if (langBtn) {
        langBtn.addEventListener('click', () => {
            navMenuDropdown.classList.add('hidden');
            currentLang = currentLang === 'zh' ? 'en' : 'zh';
            localStorage.setItem('mark_lang', currentLang);
            applyLanguage();
        });
    }

    // 主题选择下拉面板
    var themePickerDropdown = document.getElementById('theme-picker-dropdown');
    var THEME_SWATCHES = {
        white: '#ffffff', warm: '#faf5ef', cool: '#eef3f8',
        green: '#eef5ee', pink: '#fdf2f6', dark: '#1a1a1a'
    };

    // 初始化主题选项（竖排列表）
    if (themePickerDropdown) {
        THEME_LIST.forEach(function(t) {
            var btn = document.createElement('button');
            btn.className = 'theme-picker-item' + (t === currentTheme ? ' active' : '');
            btn.dataset.theme = t;
            btn.innerHTML = '<span class="theme-picker-swatch" style="background:' + THEME_SWATCHES[t] + ';"></span>' +
                            '<span>' + THEME_NAMES[t] + '</span>';
            btn.addEventListener('click', function() {
                currentTheme = t;
                localStorage.setItem('mark_theme', currentTheme);
                applyTheme();
                themePickerDropdown.classList.add('hidden');
            });
            themePickerDropdown.appendChild(btn);
        });
    }

    if (themeBtn) {
        themeBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            navMenuDropdown.classList.add('hidden');
            themePickerDropdown.classList.toggle('hidden');
        });
    }

    // 点击其他地方关闭主题下拉
    document.addEventListener('click', function(e) {
        if (themePickerDropdown && !themePickerDropdown.classList.contains('hidden')) {
            if (!e.target.closest('.nav-menu-wrapper')) {
                themePickerDropdown.classList.add('hidden');
            }
        }
    });

    // 多选操作栏
    const multiSelectBar = document.getElementById('multi-select-bar');
    const multiSelectCount = document.getElementById('multi-select-count');
    const multiDeleteBtn = document.getElementById('multi-delete-btn');
    const multiCopyBtn = document.getElementById('multi-copy-btn');
    const multiMoveBtn = document.getElementById('multi-move-btn');
    const multiShareBtn = document.getElementById('multi-share-btn');
    const multiCancelBtn = document.getElementById('multi-cancel-btn');
    // ====== 通用输入对话框 ======
    const inputModal = document.getElementById('input-modal');
    const inputModalTitle = document.getElementById('input-modal-title');
    const inputModalField1 = document.getElementById('input-modal-field1');
    const inputModalField2 = document.getElementById('input-modal-field2');
    const inputModalCancel = document.getElementById('input-modal-cancel');
    const inputModalConfirm = document.getElementById('input-modal-confirm');

    let _inputModalResolve = null;

    /**
     * 显示通用输入对话框
     * @param {string} title       对话框标题
     * @param {string} placeholder1  第一个输入框占位符
     * @param {string} placeholder2  第二个输入框占位符（传 null 则隐藏）
     * @param {string} default1    第一个输入框默认值
     * @param {string} default2    第二个输入框默认值
     * @returns {Promise<{v1:string, v2:string}|null>}  点取消返回 null
     */
    function showInputModal(title, placeholder1, placeholder2, default1 = '', default2 = '') {
        return new Promise((resolve) => {
            _inputModalResolve = resolve;
            inputModalTitle.textContent = title;
            inputModalField1.placeholder = placeholder1 || '';
            inputModalField1.value = default1;
            if (placeholder2) {
                inputModalField2.placeholder = placeholder2;
                inputModalField2.value = default2;
                inputModalField2.classList.remove('hidden');
            } else {
                inputModalField2.classList.add('hidden');
                inputModalField2.value = '';
            }
            inputModal.classList.remove('hidden');
            inputModalField1.focus();
        });
    }

    function _closeInputModal(result) {
        inputModal.classList.add('hidden');
        if (_inputModalResolve) {
            _inputModalResolve(result);
            _inputModalResolve = null;
        }
    }

    inputModalCancel.addEventListener('click', () => _closeInputModal(null));
    inputModal.addEventListener('click', (e) => { if (e.target === inputModal) _closeInputModal(null); });
    inputModalConfirm.addEventListener('click', () => {
        const v1 = inputModalField1.value.trim();
        const v2 = inputModalField2.value.trim();
        if (!v1) { inputModalField1.focus(); return; }
        _closeInputModal({ v1, v2 });
    });
    // Enter 键确认
    [inputModalField1, inputModalField2].forEach(el => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const v1 = inputModalField1.value.trim();
                const v2 = inputModalField2.value.trim();
                if (!v1) { inputModalField1.focus(); return; }
                _closeInputModal({ v1, v2 });
            }
            if (e.key === 'Escape') _closeInputModal(null);
        });
    });

    // ==== Bing 搜索联想 ====
    const suggestionsDropdown = document.getElementById('suggestions-dropdown');
    let suggestionList = [];
    let activeSuggestionIdx = -1;
    let suggestionTimer = null;

    function hideSuggestions() {
        suggestionsDropdown.classList.remove('show');
        suggestionsDropdown.innerHTML = '';
        suggestionList = [];
        activeSuggestionIdx = -1;
    }

    function showSuggestions(html) {
        suggestionsDropdown.innerHTML = html;
        suggestionsDropdown.classList.add('show');
        activeSuggestionIdx = -1;
    }

    function isURL(str) {
        // 带协议头的完整 URL
        if (/^https?:\/\//i.test(str)) return true;
        // domain.tld 格式 (如 github.com, baidu.com)
        if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+(:\d+)?(\/.*)?$/.test(str)) return true;
        // localhost
        if (/^localhost(:\d+)?(\/.*)?$/i.test(str)) return true;
        // IP 地址
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/.test(str)) return true;
        return false;
    }

    // 搜索/访问历史（localStorage）
    // 格式: [{query, url, title, type:'search'|'visit', time}, ...]
    const MAX_HISTORY = 100;
    function getSearchHistory() {
        try {
            const raw = JSON.parse(localStorage.getItem('mark_bing_history') || '[]');
            // 向后兼容：纯字符串数组 → {query, type:'search'}
            if (raw.length > 0 && typeof raw[0] === 'string') {
                const migrated = raw.map(q => ({ query: q, type: 'search', time: Date.now() }));
                localStorage.setItem('mark_bing_history', JSON.stringify(migrated));
                return migrated;
            }
            // v3.0.23 格式只有 {query, time}，补 type:'search'
            if (raw.length > 0 && !raw[0].type) {
                raw.forEach(h => h.type = 'search');
                localStorage.setItem('mark_bing_history', JSON.stringify(raw));
            }
            return Array.isArray(raw) ? raw : [];
        } catch { return []; }
    }
    function saveSearchHistory(query, url, title, type) {
        type = type || 'search';
        let hist = getSearchHistory();
        // 去重：相同 query+type 的只保留最新一条
        hist = hist.filter(h => !(h.query === query && h.type === type));
        const entry = { query, time: Date.now(), type };
        if (url) entry.url = url;
        if (title) entry.title = title;
        hist.unshift(entry);
        if (hist.length > MAX_HISTORY) hist = hist.slice(0, MAX_HISTORY);
        localStorage.setItem('mark_bing_history', JSON.stringify(hist));
    }
    function saveVisitHistory(url, title) {
        // 用 URL 作为 query，记录访问
        const displayText = title || url;
        saveSearchHistory(displayText, url, title, 'visit');
    }
    function clearSearchHistory() {
        localStorage.removeItem('mark_bing_history');
        hideSuggestions();
        renderSearchHistoryPanel();
    }

    // 格式化时间显示
    function formatHistoryTime(timestamp) {
        const now = new Date();
        const t = new Date(timestamp);
        const diffMs = now - t;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return '刚刚';
        if (diffMins < 60) return diffMins + '分钟前';
        if (diffHours < 24) return diffHours + '小时前';
        if (diffDays === 1) return '昨天';
        if (diffDays < 7) return diffDays + '天前';

        const y = t.getFullYear();
        const m = String(t.getMonth() + 1).padStart(2, '0');
        const d = String(t.getDate()).padStart(2, '0');
        if (y === now.getFullYear()) {
            return m + '-' + d;
        }
        return y + '-' + m + '-' + d;
    }

    // 渲染搜索历史面板
    function renderSearchHistoryPanel(filterText) {
        if (!searchHistoryList) return;
        const history = getSearchHistory();
        const filter = (filterText || '').trim().toLowerCase();
        const filtered = filter
            ? history.filter(h => h.query.toLowerCase().includes(filter) || (h.url && h.url.toLowerCase().includes(filter)) || (h.title && h.title.toLowerCase().includes(filter)))
            : history;

        if (filtered.length === 0) {
            searchHistoryList.innerHTML = '<div class="side-panel-empty">' +
                (filter ? '无匹配记录' : '暂无搜索历史') +
                '</div>';
            return;
        }

        const visitIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
        const searchIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

        let html = '';
        filtered.forEach(item => {
            const isVisit = item.type === 'visit';
            const icon = isVisit ? visitIcon : searchIcon;
            const cls = isVisit ? 'history-item history-item-visit' : 'history-item';
            const dataAttrs = `data-query="${escapeAttr(item.query)}"` + (item.url ? ` data-url="${escapeAttr(item.url)}"` : '') + (isVisit ? ' data-type="visit"' : '');
            let queryHtml = '<span class="history-item-query">' + escapeHtml(item.query) + '</span>';
            if (isVisit && item.url && item.url !== item.query) {
                queryHtml += '<span class="history-item-url">' + escapeHtml(item.url) + '</span>';
            }
            html += `<div class="${cls}" ${dataAttrs}>
                <span class="history-item-icon">${icon}</span>
                <div class="history-item-content">${queryHtml}</div>
                <span class="history-item-time">${escapeHtml(formatHistoryTime(item.time))}</span>
            </div>`;
        });
        searchHistoryList.innerHTML = html;
    }

    async function fetchBingSuggestions(query) {
        try {
            const resp = await fetch(`${API_URL}/bing-suggestions?query=${encodeURIComponent(query)}`);
            if (!resp.ok) return [];
            const data = await resp.json();
            return Array.isArray(data) ? data : [];
        } catch {
            return [];
        }
    }

    function renderSuggestions(suggestions, query) {
        const history = getSearchHistory();
        let html = '';

        // 搜索历史（仅输入框为空时显示在联想面板中，只显示搜索类型）
        const searchOnlyHistory = history.filter(h => h.type !== 'visit');
        if (!query && searchOnlyHistory.length > 0) {
            html += '<div class="suggestion-section-label">搜索历史</div>';
            searchOnlyHistory.slice(0, 6).forEach(item => {
                html += `<div class="suggestion-item" data-query="${escapeAttr(item.query)}">
                    <span class="suggestion-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
                    <span class="suggestion-text">${escapeHtml(item.query)}</span>
                </div>`;
            });
            html += '<div class="suggestion-footer" data-action="clear-history">清除搜索历史</div>';
            html += '<div class="suggestion-divider"></div>';
        }

        // Bing 联想词
        if (suggestions.length > 0) {
            if (history.length > 0 || !query) {
                html += '<div class="suggestion-section-label">联想搜索</div>';
            }
            suggestions.forEach(s => {
                html += `<div class="suggestion-item" data-query="${escapeAttr(s)}">
                    <span class="suggestion-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
                    <span class="suggestion-text">${escapeHtml(s)}</span>
                </div>`;
            });
        }

        // 直接搜索当前输入
        if (query && suggestions.length === 0) {
            html += `<div class="suggestion-item" data-query="${escapeAttr(query)}">
                <span class="suggestion-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
                <span class="suggestion-text">搜索 "${escapeHtml(query)}"</span>
            </div>`;
        }

        return html;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function updateActiveSuggestion(delta) {
        const items = suggestionsDropdown.querySelectorAll('.suggestion-item');
        if (items.length === 0) return;
        items.forEach(item => item.classList.remove('active'));
        activeSuggestionIdx = Math.max(-1, Math.min(items.length - 1, activeSuggestionIdx + delta));
        if (activeSuggestionIdx >= 0) {
            items[activeSuggestionIdx].classList.add('active');
            items[activeSuggestionIdx].scrollIntoView({ block: 'nearest' });
        }
    }

    function getActiveQuery() {
        const items = suggestionsDropdown.querySelectorAll('.suggestion-item');
        if (activeSuggestionIdx >= 0 && activeSuggestionIdx < items.length) {
            return items[activeSuggestionIdx].dataset.query;
        }
        return null;
    }

    function isBookmarkMode() {
        return (localStorage.getItem('mark_engine') || 'bing') === 'bookmark';
    }

    function doWebSearch(query) {
        if (!query) return;
        if (isURL(query)) {
            let url = query.trim();
            if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
            window.open(url, '_blank');
        } else {
            const engine = getCurrentEngine();
            const searchUrl = (engine.searchUrl || 'https://www.bing.com/search?q={q}').replace('{q}', encodeURIComponent(query));
            window.open(searchUrl, '_blank');
        }
        hideSuggestions();
        if (searchInput) searchInput.value = '';
        if (cleanSearchInput) cleanSearchInput.value = '';
        if (cleanSuggestionsDropdown) {
            cleanSuggestionsDropdown.classList.remove('show');
            cleanSuggestionsDropdown.innerHTML = '';
        }
        saveSearchHistory(query, null, null, 'search');
        // 同步到云端
        debouncedSearchHistorySync();
    }

    // 搜索输入事件
    if (searchInput) {
        searchInput.addEventListener('input', async () => {
            if (isBookmarkMode()) {
                // 书签模式：本地搜索
                const keyword = searchInput.value.trim().toLowerCase();
                if (!keyword) {
                    if (selectedFolder) {
                        selectedFolderName.textContent = selectedFolder.name;
                        updateBookmarksList(selectedFolder.children || []);
                    } else {
                        selectedFolderName.textContent = '根文件夹';
                        updateBookmarksList(getAllBookmarks(bookmarks));
                    }
                    return;
                }
                const allItems = getAllBookmarks(bookmarks);
                const filtered = allItems.filter(item =>
                    item.type === 'bookmark' && (
                        item.title.toLowerCase().includes(keyword) ||
                        item.url.toLowerCase().includes(keyword)
                    )
                );
                const matchedFolders = bookmarks.filter(item =>
                    item.type === 'folder' && item.name.toLowerCase().includes(keyword)
                );
                const allFiltered = [...matchedFolders, ...filtered];
                selectedFolderName.textContent = '全局搜索："' + searchInput.value.trim() + '"';
                updateBookmarksList(allFiltered, keyword);
                return;
            }

            // Web 搜索引擎模式：联想搜索
            clearTimeout(suggestionTimer);
            const query = searchInput.value.trim();
            if (!query) {
                hideSuggestions();
                return;
            }

            suggestionTimer = setTimeout(async () => {
                const suggestions = await fetchBingSuggestions(query);
                // 输入框已被清空或查询已改变，丢弃过期结果
                if (!searchInput.value.trim() || searchInput.value.trim() !== query) return;
                const html = await renderSuggestions(suggestions, query);
                showSuggestions(html);
            }, 200);
        });

        // 聚焦时不显示任何内容
        searchInput.addEventListener('focus', async () => {
            if (isBookmarkMode()) return;
        });

        // Enter / Arrow 键导航
        searchInput.addEventListener('keydown', (e) => {
            if (isBookmarkMode()) {
                if (e.key !== 'Enter') return;
                return;
            }

            if (e.key === 'Escape') {
                hideSuggestions();
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                updateActiveSuggestion(1);
                return;
            }

            if (e.key === 'ArrowUp') {
                e.preventDefault();
                updateActiveSuggestion(-1);
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                const active = getActiveQuery();
                const keyword = active || searchInput.value.trim();
                if (keyword) doWebSearch(keyword);
            }
        });

        // 点击联想项
        suggestionsDropdown.addEventListener('click', (e) => {
            const item = e.target.closest('.suggestion-item');
            const footer = e.target.closest('.suggestion-footer');

            if (footer && footer.dataset.action === 'clear-history') {
                clearSearchHistory();
                return;
            }

            if (item && item.dataset.query) {
                doWebSearch(item.dataset.query);
            }
        });

        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (!suggestionsDropdown.contains(e.target) && e.target !== searchInput) {
                hideSuggestions();
            }
        });
    }

    // 放大镜按钮点击搜索
    if (searchSubmitBtn) {
        searchSubmitBtn.addEventListener('click', () => {
            const query = searchInput.value.trim();
            if (!query) return;
            if (isBookmarkMode()) {
                // 书签模式下放大镜也做书签搜索（输入事件已经做了过滤）
                return;
            }
            doWebSearch(query);
        });
    }

    // 添加链接（从文件夹菜单触发，添加到当前选中文件夹内）
    async function addBookmarkToCurrentFolder() {
        const result = await showInputModal('添加链接', '标题', '链接地址（https://...）');
        if (!result || !result.v1) return;
        const title = result.v1;
        let url = result.v2.trim();
        if (!url) return;
        if (!/^https?:\/\//i.test(url) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
            url = 'https://' + url;
        }
        const parent = selectedFolder;
        const newBookmark = {
            type: 'bookmark',
            title: title,
            url: url,
            dateAdded: Math.floor(Date.now() / 1000)
        };
        if (parent) {
            if (!parent.children) parent.children = [];
            parent.children.push(newBookmark);
        } else {
            bookmarks.push(newBookmark);
        }
        await saveBookmarks();
        renderFolderTree();
        renderCleanModeBookmarks();
        if (parent) {
            selectedFolderName.textContent = parent.name;
            updateBookmarksList(parent.children || []);
        } else {
            selectedFolderName.textContent = '根文件夹';
            updateBookmarksList(getAllBookmarks(bookmarks));
        }
    }

    // 新建子文件夹（在选中文件夹内创建）
    async function addSubfolderToCurrentFolder() {
        const name = prompt('子文件夹名称：');
        if (!name) return;
        const parent = selectedFolder;
        const newFolder = {
            type: 'folder',
            name: name,
            dateAdded: Math.floor(Date.now() / 1000),
            children: []
        };
        if (parent) {
            if (!parent.children) parent.children = [];
            parent.children.push(newFolder);
        } else {
            bookmarks.push(newFolder);
        }
        await saveBookmarks();
        renderFolderTree();
        if (parent) {
            selectedFolderName.textContent = parent.name;
            updateBookmarksList(parent.children || []);
        } else {
            selectedFolderName.textContent = '根文件夹';
            updateBookmarksList(getAllBookmarks(bookmarks));
        }
    }

    // 新建同级文件夹（在选中文件夹的父级中创建）
    async function addSiblingFolder() {
        if (!selectedFolder) {
            alert('请先在左侧选中一个文件夹！');
            return;
        }
        const name = prompt('同级文件夹名称：');
        if (!name) return;

        const newFolder = {
            type: 'folder',
            name: name,
            dateAdded: Math.floor(Date.now() / 1000),
            children: []
        };

        // 找 selectedFolder 所在的父级数组
        function findParentArray(items, target) {
            for (const item of items) {
                if (item.type === 'folder' && item.children) {
                    if (item.children.includes(target)) return item.children;
                    const found = findParentArray(item.children, target);
                    if (found) return found;
                }
            }
            return null;
        }

        const parentArray = findParentArray(bookmarks, selectedFolder)
            || (bookmarks.includes(selectedFolder) ? bookmarks : null);

        if (parentArray) {
            const idx = parentArray.indexOf(selectedFolder);
            parentArray.splice(idx + 1, 0, newFolder);
        } else {
            // fallback: 加到根级
            bookmarks.push(newFolder);
        }

        await saveBookmarks();
        renderFolderTree();
        // 保持当前选中不变，刷新内容区
        if (selectedFolder) {
            updateBookmarksList(selectedFolder.children || []);
        }
    }

    // 为文件夹添加 ... 菜单按钮（左侧 sidebar 和右侧内容区共用）
    function attachFolderMenuBtn(container, folder, btnCssClass) {
        const btn = document.createElement('button');
        btn.className = btnCssClass || 'folder-menu-btn';
        btn.textContent = '...';
        btn.title = '文件夹菜单';

        const menu = document.createElement('div');
        menu.className = 'dropdown-menu hidden';

        function addItem(label, onClick, isDanger) {
            const item = document.createElement('button');
            item.className = 'dropdown-item' + (isDanger ? ' dropdown-item--danger' : '');
            item.textContent = label;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.add('hidden');
                selectedFolder = folder;
                onClick();
            });
            menu.appendChild(item);
        }

        addItem('添加链接', () => addBookmarkToCurrentFolder());
        addItem('新建子文件夹', () => addSubfolderToCurrentFolder());
        addItem('新建同级文件夹', () => addSiblingFolder());

        const divider1 = document.createElement('div');
        divider1.className = 'dropdown-divider';
        menu.appendChild(divider1);

        addItem('导入', () => importBookmarks());
        addItem('导出', () => exportBookmarks());

        const divider2 = document.createElement('div');
        divider2.className = 'dropdown-divider';
        menu.appendChild(divider2);

        addItem('修改名称', async () => {
            const newName = prompt('请输入新的文件夹名称：', folder.name);
            if (!newName || !newName.trim()) return;
            folder.name = newName.trim();
            await saveBookmarks();
            renderFolderTree();
            selectedFolderName.textContent = folder.name;
            updateBookmarksList(folder.children || []);
        });

        addItem('去层', async () => {
            if (folder.name === '根文件夹') { alert('根文件夹不能去层！'); return; }
            function findParentArr(items, target) {
                for (const item of items) {
                    if (item.type === 'folder' && item.children) {
                        if (item.children.includes(target)) return item.children;
                        const f = findParentArr(item.children, target);
                        if (f) return f;
                    }
                }
                return null;
            }
            const parentArray = findParentArr(bookmarks, folder) || (bookmarks.includes(folder) ? bookmarks : null);
            if (!parentArray) { alert('找不到父文件夹，操作失败！'); return; }
            if (!confirm('确定要去层文件夹「' + folder.name + '」？\n其所有子内容将提升到上一级，文件夹本身将被删除。')) return;
            const idx = parentArray.indexOf(folder);
            const children = folder.children || [];
            parentArray.splice(idx, 1, ...children);
            await saveBookmarks();
            renderFolderTree();
            selectDefaultFolder();
        });

        const divider3 = document.createElement('div');
        divider3.className = 'dropdown-divider';
        menu.appendChild(divider3);

        addItem('删除该收藏', async () => {
            if (folder.name === '根文件夹') { alert('根文件夹不能删除！'); return; }
            if (!confirm('确定要删除文件夹「' + folder.name + '」及其所有内容吗？此操作不可恢复！')) return;
            function removeFromTree(items, target) {
                for (let i = items.length - 1; i >= 0; i--) {
                    if (items[i] === target) { items.splice(i, 1); return true; }
                    if (items[i].type === 'folder' && items[i].children) {
                        if (removeFromTree(items[i].children, target)) return true;
                    }
                }
                return false;
            }
            removeFromTree(bookmarks, folder);
            await saveBookmarks();
            renderFolderTree();
            selectDefaultFolder();
        }, true);

        // 底部统计
        const info = document.createElement('div');
        info.className = 'dropdown-info';
        const count = countBookmarks([folder]);
        info.textContent = count + ' 个书签';
        menu.appendChild(info);

        container.appendChild(btn);
        container.appendChild(menu);

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 关闭其他下拉菜单
            document.querySelectorAll('.dropdown-menu').forEach(m => {
                if (m !== menu) m.classList.add('hidden');
            });
            menu.classList.toggle('hidden');
        });
    }

    // 三点菜单
    const moreMenuBtn = document.getElementById('more-menu-btn');
    const moreMenuDropdown = document.getElementById('more-menu-dropdown');
    const menuImportBtn = document.getElementById('menu-import-btn');
    const menuExportBtn = document.getElementById('menu-export-btn');
    const menuRenameBtn = document.getElementById('menu-rename-btn');
    const multiSelectNavBtn = document.getElementById('multi-select-nav-btn');

    // 初始化语言和主题
    updateEngineIcon();
    applyLanguage();
    applyTheme();

    if (moreMenuBtn && moreMenuDropdown) {
        // 点击三点按钮切换菜单
        moreMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            moreMenuDropdown.classList.toggle('hidden');
        });
        // 点击页面其他地方关闭菜单
        document.addEventListener('click', () => {
            moreMenuDropdown.classList.add('hidden');
        });
        moreMenuDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    // 菜单-添加链接
    const menuAddBookmarkBtn = document.getElementById('menu-add-bookmark-btn');
    if (menuAddBookmarkBtn) {
        menuAddBookmarkBtn.addEventListener('click', () => {
            moreMenuDropdown.classList.add('hidden');
            addBookmarkToCurrentFolder();
        });
    }

    // 菜单-新建子文件夹
    const menuAddSubfolderBtn = document.getElementById('menu-add-subfolder-btn');
    if (menuAddSubfolderBtn) {
        menuAddSubfolderBtn.addEventListener('click', () => {
            moreMenuDropdown.classList.add('hidden');
            addSubfolderToCurrentFolder();
        });
    }

    // 菜单-新建同级文件夹
    const menuAddSiblingBtn = document.getElementById('menu-add-sibling-btn');
    if (menuAddSiblingBtn) {
        menuAddSiblingBtn.addEventListener('click', () => {
            moreMenuDropdown.classList.add('hidden');
            addSiblingFolder();
        });
    }

    // 菜单-导入
    if (menuImportBtn) {
        menuImportBtn.addEventListener('click', () => {
            moreMenuDropdown.classList.add('hidden');
            importBookmarks();
        });
    }

    // 菜单-导出（仅导出当前选中文件夹的内容）
    if (menuExportBtn) {
        menuExportBtn.addEventListener('click', () => {
            moreMenuDropdown.classList.add('hidden');
            exportBookmarks();
        });
    }

    // 菜单-修改名称
    if (menuRenameBtn) {
        menuRenameBtn.addEventListener('click', async () => {
            moreMenuDropdown.classList.add('hidden');
            if (!selectedFolder) {
                alert('请在左侧选中要修改名称的文件夹！');
                return;
            }
            const newName = prompt('请输入新的文件夹名称：', selectedFolder.name);
            if (!newName || newName.trim() === '') return;
            selectedFolder.name = newName.trim();
            await saveBookmarks();
            renderFolderTree();
            selectedFolderName.textContent = selectedFolder.name;
            // 刷新内容区
            updateBookmarksList(selectedFolder.children || []);
        });
    }

    // 菜单-去层（把选中文件夹的所有子内容提升到父文件夹，然后删除该文件夹壳）
    const menuFlattenBtn = document.getElementById('menu-flatten-btn');
    if (menuFlattenBtn) {
        menuFlattenBtn.addEventListener('click', async () => {
            moreMenuDropdown.classList.add('hidden');
            if (!selectedFolder) {
                alert('请在左侧选中要去层的文件夹！');
                return;
            }
            if (selectedFolder.name === '根文件夹') {
                alert('根文件夹不能去层！');
                return;
            }

            // 找到父级数组（selectedFolder 在哪个 children 里）
            function findParentArray(items, target) {
                for (const item of items) {
                    if (item.type === 'folder' && item.children) {
                        if (item.children.includes(target)) return item.children;
                        const found = findParentArray(item.children, target);
                        if (found) return found;
                    }
                }
                return null;
            }

            const parentArray = findParentArray(bookmarks, selectedFolder)
                || (bookmarks.includes(selectedFolder) ? bookmarks : null);

            if (!parentArray) {
                alert('找不到父文件夹，操作失败！');
                return;
            }

            const folderName = selectedFolder.name;
            if (!confirm(`确定要去层文件夹「${folderName}」？\n其所有子内容将提升到上一级，文件夹本身将被删除。`)) return;

            // 找到 selectedFolder 在 parentArray 中的位置
            const idx = parentArray.indexOf(selectedFolder);
            // 把 selectedFolder 的 children 展开插入到同一位置
            const children = selectedFolder.children || [];
            parentArray.splice(idx, 1, ...children);

            await saveBookmarks();
            renderFolderTree();
            // 去层后选中父文件夹或回到根文件夹
            selectDefaultFolder();
        });
    }

    // 菜单-删除收藏夹
    const menuDeleteBtn = document.getElementById('menu-delete-btn');
    if (menuDeleteBtn) {
        menuDeleteBtn.addEventListener('click', async () => {
            moreMenuDropdown.classList.add('hidden');
            if (!selectedFolder) {
                alert('请在左侧选中要删除的文件夹！');
                return;
            }
            if (selectedFolder.name === '根文件夹') {
                alert('根文件夹不能删除！');
                return;
            }
            const folderName = selectedFolder.name;
            const confirmMsg = '确定要删除文件夹「' + folderName + '」及其所有内容吗？此操作不可恢复！';
            if (!confirm(confirmMsg)) return;

            function removeFromTree(items, target) {
                for (let i = items.length - 1; i >= 0; i--) {
                    if (items[i] === target) {
                        items.splice(i, 1);
                        return true;
                    }
                    if (items[i].type === 'folder' && items[i].children) {
                        if (removeFromTree(items[i].children, target)) return true;
                    }
                }
                return false;
            }

            removeFromTree(bookmarks, selectedFolder);
            await saveBookmarks();
            renderFolderTree();
            selectDefaultFolder();
        });
    }

    // 导入书签（可复用函数）
    function importBookmarks() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.html';
        input.style.display = 'none';

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                const html = event.target.result;
                const importedBookmarks = parseBookmarksHTML(html);

                if (importedBookmarks.length === 0) {
                    alert('未解析到任何书签，请确保文件格式正确！');
                    return;
                }

                // 如果选中了文件夹，导入到该文件夹内
                if (selectedFolder) {
                    if (!selectedFolder.children) selectedFolder.children = [];
                    selectedFolder.children = mergeBookmarks(selectedFolder.children, importedBookmarks);
                } else {
                    bookmarks = mergeBookmarks(bookmarks, importedBookmarks);
                }
                await saveBookmarks();
                renderFolderTree();
                if (selectedFolder) {
                    selectedFolderName.textContent = selectedFolder.name;
                    updateBookmarksList(selectedFolder.children || []);
                } else {
                    updateBookmarksList(getAllBookmarks(bookmarks));
                }
                showToast('成功导入 ' + countBookmarks(importedBookmarks) + ' 个书签');
            };
            reader.onerror = () => {
                showToast('文件读取失败');
            };
            reader.readAsText(file);
            document.body.removeChild(input);
        });

        document.body.appendChild(input);
        input.click();
    }

    // 导出书签（只导出当前选中文件夹的内容）
    function exportBookmarks() {
        const target = selectedFolder ? selectedFolder.children || [] : bookmarks;
        const html = generateBookmarksHTML(target);
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fileName = selectedFolder ? selectedFolder.name : 'bookmarks';
        a.download = fileName + '.html';
        a.click();
        URL.revokeObjectURL(url);
    }

    // 登录/注册标签切换
    loginTab.addEventListener('click', () => {
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    });

    registerTab.addEventListener('click', () => {
        registerTab.classList.add('active');
        loginTab.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
    });

    // 取消/关闭登录弹窗
    const authBackBtn = document.querySelector('.auth-back-btn');
    if (authBackBtn) {
        authBackBtn.addEventListener('click', () => {
            showMainContainer();
        });
    }

    // 关闭按钮 & 点击遮罩层关闭弹窗
    const authModalClose = document.querySelector('.auth-modal-close');
    const authModalOverlay = document.querySelector('.auth-modal-overlay');
    if (authModalClose) {
        authModalClose.addEventListener('click', () => {
            showMainContainer();
        });
    }
    if (authModalOverlay) {
        authModalOverlay.addEventListener('click', () => {
            showMainContainer();
        });
    }

    // 注册
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('register-username').value;
        const password = document.getElementById('register-password').value;
        const confirm = document.getElementById('register-confirm').value;

        if (password !== confirm) {
            alert('两次输入的密码不一致！');
            return;
        }

        try {
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                alert('服务器响应错误，请稍后重试');
                return;
            }
            
            if (data.success) {
                alert('注册成功！请登录');
                registerForm.reset();
                loginTab.click();
            } else {
                alert(data.error || '注册失败');
            }
        } catch (err) {
            alert('网络错误，请稍后重试');
        }
    });

    // 登录
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                alert('服务器响应错误，请稍后重试');
                return;
            }
            
            if (data.success) {
                currentUser = data.user.username;
                currentUserId = data.user.id;
                bookmarks = data.bookmarks || [];
                localStorage.setItem('mark_current_user', JSON.stringify({ username: currentUser, id: currentUserId }));
                showMainContainer();
                // 登录后恢复保存的视图模式，默认书签模式
                const savedMode = localStorage.getItem('mark_view_mode');
                const mode = (savedMode === 'clean' || savedMode === 'bookmark') ? savedMode : 'bookmark';
                switchViewMode(mode);
                if (viewModeBtn) viewModeBtn.classList.remove('hidden');
                // 新用户默认创建"收藏夹"文件夹
                initDefaultFolder();
                renderFolderTree();
                // 默认选中收藏夹
                selectDefaultFolder();
                // 加载用户偏好（搜索引擎等）
                loadPreferences();
                // 加载搜索历史（云端同步）
                loadSearchHistoryFromCloud();
                applyLanguage();
            } else {
                alert(data.error || '登录失败');
            }
        } catch (err) {
            alert('网络错误，请稍后重试');
        }
    });

    // 退出登录 / 登录同步
    logoutBtn.addEventListener('click', async () => {
        navMenuDropdown.classList.add('hidden');
        if (currentUser) {
            // 登出前强制同步搜索历史到云端
            await forceSearchHistorySync();
            await saveBookmarks();
            localStorage.removeItem('mark_current_user');
            currentUser = null;
            currentUserId = null;
            bookmarks = [];
            selectedFolder = null;
            applyLanguage();
            showMainContainer();
            // 登出后进入简洁模式
            switchViewMode('clean');
            if (viewModeBtn) viewModeBtn.classList.add('hidden');
            initDefaultFolder();
            renderFolderTree();
            selectDefaultFolder();
        } else {
            showAuthContainer();
        }
    });

    // 点击版本号显示更新日志
    if (versionDisplay) {
        versionDisplay.addEventListener('click', () => {
            changelogModal.classList.remove('hidden');
        });
        versionDisplay.style.cursor = 'pointer';
    }

    const closeBtn = changelogModal.querySelector('.close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            changelogModal.classList.add('hidden');
        });
    }

    if (changelogModal) {
        changelogModal.addEventListener('click', (e) => {
            if (e.target === changelogModal) {
                changelogModal.classList.add('hidden');
            }
        });
    }

    // 管理
    if (adminBtn) {
        adminBtn.addEventListener('click', () => {
            navMenuDropdown.classList.add('hidden');
            window.open('/admin', '_blank');
        });
    }
    if (searchHistoryBtn) {
        searchHistoryBtn.addEventListener('click', () => {
            navMenuDropdown.classList.add('hidden');
            if (searchHistoryPanel) {
                searchHistoryPanel.classList.remove('hidden');
                renderSearchHistoryPanel();
                if (searchHistoryFilter) searchHistoryFilter.value = '';
            }
        });
    }
    if (searchHistoryClose) {
        searchHistoryClose.addEventListener('click', () => {
            if (searchHistoryPanel) searchHistoryPanel.classList.add('hidden');
        });
    }
    if (searchHistoryClear) {
        searchHistoryClear.addEventListener('click', () => {
            if (confirm('确定要清空所有搜索历史吗？')) {
                clearSearchHistory();
            }
        });
    }
    if (searchHistoryFilter) {
        searchHistoryFilter.addEventListener('input', () => {
            renderSearchHistoryPanel(searchHistoryFilter.value);
        });
    }
    if (searchHistoryList) {
        searchHistoryList.addEventListener('click', (e) => {
            const item = e.target.closest('.history-item');
            if (!item) return;
            const query = item.getAttribute('data-query');
            const url = item.getAttribute('data-url');
            const type = item.getAttribute('data-type');
            if (!query) return;
            if (searchHistoryPanel) searchHistoryPanel.classList.add('hidden');

            if (type === 'visit' && url) {
                // 访问记录：直接打开网址
                window.open(url, '_blank');
            } else {
                // 搜索记录：填入搜索框并执行搜索
                if (searchInput) searchInput.value = query;
                if (isBookmarkMode()) {
                    searchInput.dispatchEvent(new Event('input'));
                } else {
                    doWebSearch(query);
                }
            }
        });
    }
    if (searchHistoryPanel) {
        searchHistoryPanel.addEventListener('click', (e) => {
            if (e.target === searchHistoryPanel) {
                searchHistoryPanel.classList.add('hidden');
            }
        });
    }

    // 个人资料
    const profileBtn = document.getElementById('profile-btn');
    const profileModal = document.getElementById('profile-modal');
    const profileForm = document.getElementById('profile-form');
    const profileModalClose = document.getElementById('profile-modal-close');

    if (profileBtn) {
        profileBtn.addEventListener('click', () => {
            navMenuDropdown.classList.add('hidden');
            if (!currentUser) {
                alert('请先登录后再修改个人资料');
                return;
            }
            document.getElementById('profile-username').value = '';
            document.getElementById('profile-current-password').value = '';
            document.getElementById('profile-new-password').value = '';
            profileModal.classList.remove('hidden');
        });
    }
    if (profileModalClose) {
        profileModalClose.addEventListener('click', () => {
            profileModal.classList.add('hidden');
        });
    }
    if (profileModal) {
        profileModal.addEventListener('click', (e) => {
            if (e.target === profileModal) {
                profileModal.classList.add('hidden');
            }
        });
    }
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser || !currentUserId) {
                alert('请先登录');
                return;
            }
            const newUsername = document.getElementById('profile-username').value.trim();
            const currentPassword = document.getElementById('profile-current-password').value;
            const newPassword = document.getElementById('profile-new-password').value.trim();

            if (!newUsername && !newPassword) {
                alert('请至少填写一项修改内容');
                return;
            }

            try {
                const res = await fetch(`${API_URL}/profile`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: currentUserId,
                        username: newUsername || undefined,
                        currentPassword,
                        password: newPassword || undefined
                    })
                });
                const data = await res.json();
                if (data.success) {
                    alert('修改成功！' + (newUsername ? ' 用户名已更新为 ' + newUsername : ''));
                    if (newUsername) {
                        currentUser = newUsername;
                        localStorage.setItem('mark_current_user', JSON.stringify({ username: currentUser, id: currentUserId }));
                        applyLanguage();
                    }
                    profileModal.classList.add('hidden');
                } else {
                    alert(data.error || '修改失败');
                }
            } catch (err) {
                alert('网络错误，请稍后重试');
            }
        });
    }

    // 导航栏多选
    if (multiSelectNavBtn) {
        multiSelectNavBtn.addEventListener('click', () => {
            navMenuDropdown.classList.add('hidden');
            if (multiSelectMode) {
                exitMultiSelectMode();
            } else {
                enterMultiSelectMode();
            }
        });
    }

    // 短链接管理
    if (sharesBtn) {
        sharesBtn.addEventListener('click', () => {
            navMenuDropdown.classList.add('hidden');
            sharesModal.classList.remove('hidden');
            loadMyShares();
        });
    }
    if (sharesModalClose) {
        sharesModalClose.addEventListener('click', () => {
            sharesModal.classList.add('hidden');
        });
    }
    if (sharesModal) {
        sharesModal.addEventListener('click', (e) => {
            if (e.target === sharesModal) {
                sharesModal.classList.add('hidden');
            }
        });
    }

    // ... 菜单 toggle
    if (navMenuBtn && navMenuDropdown) {
        navMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            navMenuDropdown.classList.toggle('hidden');
        });
        document.addEventListener('click', (e) => {
            if (!navMenuBtn.contains(e.target) && !navMenuDropdown.contains(e.target)) {
                navMenuDropdown.classList.add('hidden');
            }
        });
    }

    // 加载我的短链接（复用 admin API，前端过滤当前用户）
    async function loadMyShares() {
        if (!currentUserId) {
            sharesList.innerHTML = '<div class="empty-state">请先登录</div>';
            return;
        }
        sharesList.innerHTML = '<div class="loading">加载中...</div>';
        try {
            const res = await fetch('/api/admin/shares');
            if (!res.ok) {
                sharesList.innerHTML = `<div class="empty-state">加载失败 (${res.status})</div>`;
                return;
            }
            const data = await res.json();
            if (data.success && data.shares) {
                const myShares = data.shares.filter(s => s.user_id === currentUserId);
                if (myShares.length > 0) {
                    let html = '';
                    myShares.forEach(s => {
                        const date = new Date(s.created_at);
                        const formattedDate = date.toLocaleString('zh-CN');
                        const fullUrl = `https://mark.lcy.app/${s.code}`;
                        html += `
                        <div class="share-item">
                            <div class="share-item-info">
                                <div class="share-item-title">${s.title || '未命名'}</div>
                                <div class="share-item-url">${fullUrl}</div>
                                <div class="share-item-time">${formattedDate}</div>
                            </div>
                            <div class="share-item-actions">
                                <button class="share-item-btn" onclick="navigator.clipboard.writeText('${fullUrl}');showToast('已复制：${fullUrl}')">复制</button>
                                <button class="share-item-btn" onclick="editMyShare(${s.id}, '${s.code}')">改短码</button>
                                <button class="share-item-btn share-item-btn--danger" onclick="deleteMyShare(${s.id}, '${s.code}')">删除</button>
                            </div>
                        </div>`;
                    });
                    sharesList.innerHTML = html;
                } else {
                    sharesList.innerHTML = '<div class="empty-state">暂无短链接</div>';
                }
            } else {
                sharesList.innerHTML = `<div class="empty-state">加载失败: ${data.error || '未知错误'}</div>`;
            }
        } catch (err) {
            sharesList.innerHTML = `<div class="empty-state">网络错误: ${err.message}</div>`;
        }
    }

    // 删除短链接（复用 admin API）
    async function deleteMyShare(id, code) {
        if (!confirm(`确定删除短链接 "${code}" 吗？`)) return;
        try {
            const res = await fetch(`/api/admin/shares/${id}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                loadMyShares();
            } else {
                alert(data.error || '删除失败');
            }
        } catch (err) {
            alert('网络错误');
        }
    }
    window.deleteMyShare = deleteMyShare;

    // 修改短码
    async function editMyShare(id, currentCode) {
        const newCode = prompt('mark.lcy.app/', currentCode);
        if (newCode === null || newCode.trim() === '' || newCode.trim() === currentCode) return;
        try {
            const res = await fetch(`/api/admin/shares/${id}/domain`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain: newCode.trim() })
            });
            const data = await res.json();
            if (data.success) {
                loadMyShares();
            } else {
                alert(data.error || '修改失败');
            }
        } catch (err) {
            alert('网络错误');
        }
    }
    window.editMyShare = editMyShare;

    // 辅助函数
    function showAuthContainer() {
        authContainer.classList.remove('hidden');
    }

    function showMainContainer() {
        authContainer.classList.add('hidden');
    }

    // 初始化默认文件夹（新用户无数据时创建"根文件夹"）
    function initDefaultFolder() {
        if (!bookmarks || bookmarks.length === 0) {
            bookmarks = [{
                type: 'folder',
                name: '根文件夹',
                dateAdded: Math.floor(Date.now() / 1000),
                children: []
            }];
            // 仅游客模式立即保存，登录用户等 syncBookmarks 从服务器加载数据后再保存
            if (!currentUserId) {
                saveBookmarks();
            }
        }
    }

    // 默认选中根文件夹（效果等于显示全部书签）
    function selectDefaultFolder() {
        const defaultFolder = bookmarks.find(b => b.type === 'folder' && b.name === '根文件夹');
        if (defaultFolder) {
            selectedFolder = defaultFolder;
            selectedFolderName.textContent = defaultFolder.name;
            updateBookmarksList(defaultFolder.children || []);
            if (contentActions) contentActions.classList.remove('hidden');
        } else {
            // 没有根文件夹时显示全部书签（扁平列表）
            selectedFolder = null;
            selectedFolderName.textContent = '全部书签';
            updateBookmarksList(getAllBookmarks(bookmarks));
            if (contentActions) contentActions.classList.add('hidden');
        }
    }

    async function saveBookmarks() {
        if (currentUserId) {
            try {
                await fetch(`${API_URL}/save-bookmarks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUserId, bookmarks })
                });
            } catch (err) {
                console.log('保存到服务器失败');
            }
        } else {
            // 游客模式：保存到 localStorage
            localStorage.setItem('mark_guest_bookmarks', JSON.stringify(bookmarks));
        }
    }

    async function syncBookmarks() {
        if (!currentUserId) return;

        try {
            const response = await fetch(`${API_URL}/get-bookmarks/${currentUserId}`);
            const data = await response.json();

            if (data.success) {
                const serverBookmarks = data.bookmarks || [];
                const merged = mergeBookmarks(bookmarks, serverBookmarks);
                bookmarks = merged;
                await saveBookmarks();
                renderFolderTree();

                // 同步后重新定位 selectedFolder（引用可能已失效）
                if (selectedFolder) {
                    const found = findFolderByName(bookmarks, selectedFolder.name);
                    if (found) {
                        selectedFolder = found;
                        selectedFolderName.textContent = found.name;
                        updateBookmarksList(found.children || []);
                        updateSelectedStateByFolder(found);
                    } else {
                        // 文件夹已不存在，回到默认
                        selectDefaultFolder();
                    }
                } else {
                    selectDefaultFolder();
                }
            }
        } catch (err) {
            console.log('后台同步失败', err);
        }
    }

    // 在文件夹树中按名称查找文件夹对象
    function findFolderByName(items, name) {
        for (const item of items) {
            if (item.type === 'folder' && item.name === name) return item;
            if (item.type === 'folder' && item.children) {
                const found = findFolderByName(item.children, name);
                if (found) return found;
            }
        }
        return null;
    }

    // 书签解析函数
    function countBookmarks(arr) {
        let count = 0;
        for (let item of arr) {
            if (item.type === 'bookmark') {
                count++;
            } else if (item.type === 'folder' && item.children) {
                count += countBookmarks(item.children);
            }
        }
        return count;
    }

    function parseBookmarksHTML(html) {
        const result = [];
        const stack = [];
        let currentParent = result;
        let currentItem = null;
        
        const lines = html.split('\n');
        
        for (let line of lines) {
            line = line.trim();
            
            if (line.startsWith('<DT><H3')) {
                const nameMatch = line.match(/>([^<]+)<\/H3>/i);
                const addDateMatch = line.match(/ADD_DATE="?([^"]+)"?/i);
                
                currentItem = {
                    type: 'folder',
                    name: nameMatch ? nameMatch[1].trim() : '',
                    dateAdded: addDateMatch ? addDateMatch[1] : null,
                    children: []
                };
            }
            else if (line.includes('</DL>')) {
                if (stack.length > 0) {
                    currentParent = stack.pop();
                }
            }
            else if (line.includes('<DL>') && !line.includes('</DL>')) {
                if (currentItem && currentItem.type === 'folder') {
                    currentParent.push(currentItem);
                    stack.push(currentParent);
                    currentParent = currentItem.children;
                    currentItem = null;
                }
            }
            else if (line.startsWith('<DT><A ')) {
                const hrefMatch = line.match(/HREF="?([^"]+)"?/i);
                const addDateMatch = line.match(/ADD_DATE="?([^"]+)"?/i);
                const titleMatch = line.match(/>([^<]+)<\/A>/i);
                
                currentParent.push({
                    type: 'bookmark',
                    title: titleMatch ? titleMatch[1].trim() : (hrefMatch ? hrefMatch[1] : ''),
                    url: hrefMatch ? hrefMatch[1] : '',
                    dateAdded: addDateMatch ? addDateMatch[1] : null
                });
            }
        }
        
        return result;
    }

    function mergeBookmarks(existing, imported) {
        const merged = JSON.parse(JSON.stringify(existing));
        
        function mergeRecursive(existingItems, importedItems) {
            for (const item of importedItems) {
                let found = false;
                
                for (const existingItem of existingItems) {
                    if (existingItem.type === item.type) {
                        if (existingItem.type === 'bookmark' && existingItem.url === item.url) {
                            found = true;
                            break;
                        }
                        if (existingItem.type === 'folder' && existingItem.name === item.name) {
                            found = true;
                            if (item.children && existingItem.children) {
                                mergeRecursive(existingItem.children, item.children);
                            }
                            break;
                        }
                    }
                }
                
                if (!found) {
                    existingItems.push(JSON.parse(JSON.stringify(item)));
                }
            }
        }
        
        mergeRecursive(merged, imported);
        return merged;
    }

    function generateBookmarksHTML(bookmarks) {
        let html = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
        html += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
        html += '<TITLE>Bookmarks</TITLE>\n';
        html += '<H1>Bookmarks</H1>\n';
        html += '<DL><p>\n';
        
        function generateItems(items, indent = 2) {
            let result = '';
            const spaces = ' '.repeat(indent);
            for (const item of items) {
                if (item.type === 'folder') {
                    const date = item.dateAdded || Math.floor(Date.now() / 1000);
                    result += `${spaces}<DT><H3 ADD_DATE="${date}">${escapeHTML(item.name)}</H3>\n`;
                    result += `${spaces}<DL><p>\n`;
                    if (item.children) {
                        result += generateItems(item.children, indent + 4);
                    }
                    result += `${spaces}</DL><p>\n`;
                } else if (item.type === 'bookmark') {
                    const date = item.dateAdded || Math.floor(Date.now() / 1000);
                    result += `${spaces}<DT><A HREF="${escapeHTML(item.url)}" ADD_DATE="${date}">${escapeHTML(item.title)}</A>\n`;
                }
            }
            return result;
        }
        
        html += generateItems(bookmarks);
        html += '</DL><p>\n';
        return html;
    }

    function escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // 渲染函数
    function renderFolderTree() {
        folderTree.innerHTML = '';

        // 渲染用户导入的文件夹树（parentArray 直接传 bookmarks，确保拖拽排序修改到原始数组）
        const topFolders = bookmarks.filter(item => item.type === 'folder');
        for (let i = 0; i < topFolders.length; i++) {
            const childItem = renderFolderItem(topFolders[i], bookmarks, i);
            folderTree.appendChild(childItem);
        }
    }

    function renderFolderItem(folder, parentArray, index) {
        const div = document.createElement('div');
        div.className = 'folder-item';

        // 存储 DOM 引用，供高亮使用
        folder._domElement = div;

        const header = document.createElement('div');
        header.className = 'folder-header';

        // 多选模式 checkbox（放在 header 内部）
        if (multiSelectMode) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'select-checkbox';
            // 检查是否已选中
            const isSelected = selectedItems.some(s => s.item === folder);
            if (isSelected) checkbox.checked = true;
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelectItem('folder', folder, parentArray, checkbox);
            });
            header.appendChild(checkbox);
        }
        

        
        const icon = document.createElement('span');
        icon.className = 'folder-icon';
        const hasSubfolders = folder.children && folder.children.some(child => child.type === 'folder');
        folder._isOpen = hasSubfolders;
        icon.innerHTML = getFolderIconSVG(hasSubfolders ? 'open' : 'empty', 16);
        
        const name = document.createElement('span');
        name.className = 'folder-name';
        name.textContent = folder.name;
        
        header.appendChild(icon);
        header.appendChild(name);

        // 文件夹 ... 菜单按钮
        attachFolderMenuBtn(header, folder, 'folder-menu-btn');

        header.onclick = (e) => {
            if (multiSelectMode && e.target.tagName === 'INPUT') return;
            if (multiSelectMode) return;
            // 展开/收起子文件夹
            if (folder.children && folder.children.some(child => child.type === 'folder')) {
                const subfoldersEl = div.querySelector('.subfolders');
                if (subfoldersEl) {
                    if (subfoldersEl.style.display === 'none') {
                        subfoldersEl.style.display = 'block';
                        folder._isOpen = true;
                    } else {
                        subfoldersEl.style.display = 'none';
                        folder._isOpen = false;
                    }
                    // 更新图标
                    const iconEl = header.querySelector('.folder-icon');
                    if (iconEl) iconEl.innerHTML = getFolderIconSVG(folder._isOpen ? 'open' : 'closed', 16);
                }
            }
            selectedFolder = folder;
            selectedFolderName.textContent = folder.name;
            updateBookmarksList(folder.children || []);
            updateSelectedState(div);
            if (contentActions) contentActions.classList.remove('hidden');
        };
        
        if (selectedFolder === folder) {
            div.classList.add('selected');
        }
        
        div.appendChild(header);
        
        if (folder.children && folder.children.some(child => child.type === 'folder')) {
            const subfolders = document.createElement('div');
            subfolders.className = 'subfolders';
            subfolders.style.display = 'block'; // 默认展开
            folder._isOpen = true;
            
            for (let i = 0; i < folder.children.length; i++) {
                const child = folder.children[i];
                if (child.type === 'folder') {
                    const childItem = renderFolderItem(child, folder.children, i);
                    subfolders.appendChild(childItem);
                }
            }
            
            div.appendChild(subfolders);
        }
        
        // 多选模式：侧边栏文件夹拖拽排序
        if (multiSelectMode) {
            div.setAttribute('draggable', 'true');
            div.dataset.dragType = 'sidebar-folder';
            div.dataset.dragRef = folder._dragId = folder._dragId || (Math.random().toString(36).slice(2));

            div.addEventListener('dragstart', (e) => {
                const isSelected = selectedItems.some(s => s.item === folder);
                if (isSelected && selectedItems.length > 0) {
                    // 拖整个选中集合（仅同一 parentArray 内的）
                    dragState = {
                        items: selectedItems.filter(s => s.parentArray === parentArray).map(s => s.item),
                        srcArray: parentArray
                    };
                } else {
                    dragState = { items: [folder], srcArray: parentArray };
                }
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'sidebar-folder');
                div.classList.add('drag-source');
            });

            div.addEventListener('dragend', () => {
                div.classList.remove('drag-source');
                document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
            });

            div.addEventListener('dragover', (e) => {
                if (!dragState || dragState.srcArray !== parentArray) return;
                if (dragState.items.includes(folder)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = div.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
                    el.classList.remove('drag-over-top', 'drag-over-bottom');
                });
                if (e.clientY < mid) {
                    div.classList.add('drag-over-top');
                } else {
                    div.classList.add('drag-over-bottom');
                }
            });

            div.addEventListener('dragleave', () => {
                div.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            div.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!dragState || dragState.srcArray !== parentArray) return;
                if (dragState.items.includes(folder)) return;

                const isTop = div.classList.contains('drag-over-top');
                div.classList.remove('drag-over-top', 'drag-over-bottom');

                const arr = parentArray;
                // 从数组中移除被拖动的项
                const dragged = dragState.items;
                dragged.forEach(it => {
                    const idx = arr.indexOf(it);
                    if (idx !== -1) arr.splice(idx, 1);
                });

                // 找目标位置（移除后重新找）
                let targetIdx = arr.indexOf(folder);
                if (!isTop) targetIdx += 1;
                if (targetIdx < 0) targetIdx = 0;
                arr.splice(targetIdx, 0, ...dragged);

                dragState = null;
                renderFolderTree();
                saveBookmarks();
            });
        }

        return div;
    }

    function updateSelectedState(element) {
        document.querySelectorAll('.folder-item').forEach(item => item.classList.remove('selected'));
        element.classList.add('selected');
    }

    function getAllBookmarks(items) {
        const result = [];
        for (const item of items) {
            if (item.type === 'bookmark') {
                result.push(item);
            } else if (item.type === 'folder' && item.children) {
                result.push(...getAllBookmarks(item.children));
            }
        }
        return result;
    }

    function getFolderChildren(folder) {
        if (!folder || !folder.children) return [];
        return folder.children.filter(item => item.type === 'bookmark');
    }

    // ====== 拖拽排序（内容区：文件夹 + 书签） ======
    function attachContentDrag(el, dataItem, arr) {
        el.setAttribute('draggable', 'true');

        el.addEventListener('dragstart', (e) => {
            // 如果当前项已选中，则批量拖动选中项（同一 arr 内）
            const isSelected = selectedItems.some(s => s.item === dataItem && s.parentArray === arr);
            if (isSelected && selectedItems.length > 0) {
                dragState = {
                    items: selectedItems.filter(s => s.parentArray === arr).map(s => s.item),
                    srcArray: arr
                };
            } else {
                dragState = { items: [dataItem], srcArray: arr };
            }
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'content-item');
            el.classList.add('drag-source');
            // 拖动期间半透明
            setTimeout(() => { el.style.opacity = '0.4'; }, 0);
        });

        el.addEventListener('dragend', () => {
            el.classList.remove('drag-source');
            el.style.opacity = '';
            document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(node => {
                node.classList.remove('drag-over-top', 'drag-over-bottom');
            });
        });

        el.addEventListener('dragover', (e) => {
            if (!dragState || dragState.srcArray !== arr) return;
            if (dragState.items.includes(dataItem)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = el.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            // 清除同区域其他高亮
            el.closest('#bookmarks-list, #folder-tree') &&
                el.closest('#bookmarks-list, #folder-tree')
                    .querySelectorAll('.drag-over-top, .drag-over-bottom')
                    .forEach(n => n.classList.remove('drag-over-top', 'drag-over-bottom'));
            if (e.clientY < mid) {
                el.classList.add('drag-over-top');
            } else {
                el.classList.add('drag-over-bottom');
            }
        });

        el.addEventListener('dragleave', (e) => {
            if (!el.contains(e.relatedTarget)) {
                el.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        el.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!dragState || dragState.srcArray !== arr) return;
            if (dragState.items.includes(dataItem)) return;

            const isTop = el.classList.contains('drag-over-top');
            el.classList.remove('drag-over-top', 'drag-over-bottom');

            const dragged = dragState.items;
            // 移除原位置
            dragged.forEach(it => {
                const idx = arr.indexOf(it);
                if (idx !== -1) arr.splice(idx, 1);
            });
            // 找目标位置
            let targetIdx = arr.indexOf(dataItem);
            if (!isTop) targetIdx += 1;
            if (targetIdx < 0) targetIdx = 0;
            arr.splice(targetIdx, 0, ...dragged);

            dragState = null;
            // 刷新内容区
            updateBookmarksList(arr);
            saveBookmarks();
        });
    }

    function updateBookmarksList(items, highlightKeyword) {
        bookmarksList.innerHTML = '';

        if (!items || items.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'empty-state';
            emptyMsg.textContent = '暂无内容';
            bookmarksList.appendChild(emptyMsg);
            return;
        }

        const fragment = document.createDocumentFragment();

        // 按 items 原始顺序渲染（支持拖拽混排，文件夹和书签可自由排列）
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type === 'folder') {
                fragment.appendChild(renderContentFolderItem(item, items));
            } else if (item.type === 'bookmark') {
                fragment.appendChild(renderBookmarkItem(item, items, highlightKeyword));
            }
        }

        bookmarksList.appendChild(fragment);
    }

    // ====== 多选功能 ======

    function enterMultiSelectMode() {
        if (multiSelectMode) return;
        multiSelectMode = true;
        selectedItems = [];
        multiSelectBar.classList.remove('hidden');
        // 重新渲染左侧文件夹树和右侧内容区以显示 checkbox
        renderFolderTree();
        if (selectedFolder) {
            updateBookmarksList(selectedFolder.children || []);
        }
        updateMultiSelectUI();
    }

    function exitMultiSelectMode() {
        multiSelectMode = false;
        selectedItems = [];
        multiSelectBar.classList.add('hidden');
        // 关闭所有书签菜单
        document.querySelectorAll('.bookmark-dropdown').forEach(d => d.classList.add('hidden'));
        // 重新渲染左侧文件夹树和右侧内容区以移除 checkbox
        renderFolderTree();
        if (selectedFolder) {
            updateBookmarksList(selectedFolder.children || []);
        }
        updateMultiSelectUI();
    }

    function updateMultiSelectUI() {
        multiSelectCount.textContent = `已选 ${selectedItems.length} 项`;
        const selectAllCheckbox = document.getElementById('multi-select-all-check');
        if (selectAllCheckbox) {
            const allItems = getAllSelectableItems();
            selectAllCheckbox.checked = allItems.length > 0 && selectedItems.length === allItems.length;
            selectAllCheckbox.indeterminate = selectedItems.length > 0 && selectedItems.length < allItems.length;
        }
    }

    // 获取当前视图所有可选项
    function getAllSelectableItems() {
        const items = [];
        // 递归收集所有文件夹
        function collectFolders(arr, parentArr) {
            for (const item of arr) {
                if (item.type !== 'folder') continue;
                items.push({ type: 'folder', item: item, parentArray: parentArr });
                if (item.children) {
                    collectFolders(item.children, item.children);
                }
            }
        }
        collectFolders(bookmarks, bookmarks);
        // 当前选中文件夹下的书签
        if (selectedFolder && selectedFolder.children) {
            selectedFolder.children.forEach(bm => {
                if (bm.type === 'bookmark') {
                    items.push({ type: 'bookmark', item: bm, parentArray: selectedFolder.children });
                }
            });
        }
        return items;
    }

    // 全选/取消全选
    function toggleSelectAll() {
        const allItems = getAllSelectableItems();
        if (selectedItems.length === allItems.length) {
            // 取消全选
            selectedItems = [];
            document.querySelectorAll('.select-checkbox').forEach(cb => cb.checked = false);
        } else {
            // 全选
            selectedItems = allItems.map(a => ({ type: a.type, item: a.item, parentArray: a.parentArray || null }));
            document.querySelectorAll('.select-checkbox').forEach(cb => cb.checked = true);
        }
        updateMultiSelectUI();
    }
    window._markToggleSelectAll = toggleSelectAll;

    function toggleSelectItem(type, item, parentArray, checkboxEl) {
        const idx = selectedItems.findIndex(s => s.item === item);
        if (idx !== -1) {
            selectedItems.splice(idx, 1);
            if (checkboxEl) checkboxEl.checked = false;
        } else {
            selectedItems.push({ type, item, parentArray });
            if (checkboxEl) checkboxEl.checked = true;
        }
        updateMultiSelectUI();
    }

    async function batchDelete() {
        if (selectedItems.length === 0) return;
        if (!confirm(`确定要删除选中的 ${selectedItems.length} 项吗？此操作不可撤销。`)) return;

        for (const sel of selectedItems) {
            if (sel.type === 'folder') {
                removeFolderFromTree(sel.item);
            } else {
                const arr = sel.parentArray || (selectedFolder && selectedFolder.children);
                if (arr) {
                    const idx = arr.indexOf(sel.item);
                    if (idx !== -1) arr.splice(idx, 1);
                }
            }
        }
        await saveBookmarks();
        exitMultiSelectMode();
        renderFolderTree();
        if (selectedFolder) {
            updateBookmarksList(selectedFolder.children || []);
        }
        showToast('删除成功');
    }

    function removeFolderFromTree(target) {
        function removeFrom(items) {
            for (let i = items.length - 1; i >= 0; i--) {
                if (items[i] === target) {
                    items.splice(i, 1);
                    return true;
                }
                if (items[i].type === 'folder' && items[i].children) {
                    if (removeFrom(items[i].children)) return true;
                }
            }
            return false;
        }
        removeFrom(bookmarks);
    }

    async function batchMove() {
        if (selectedItems.length === 0) return;
        // 弹出文件夹树选择器
        const target = await showFolderPicker();
        if (!target) return;

        for (const sel of selectedItems) {
            const srcArr = sel.parentArray || (selectedFolder && selectedFolder.children);
            if (!srcArr) continue;
            const idx = srcArr.indexOf(sel.item);
            if (idx === -1) continue;
            // 不能移动到自己的子文件夹里
            if (sel.type === 'folder' && isDescendant(target, sel.item)) {
                showToast(`不能将「${sel.item.name}」移动到其子文件夹中`);
                continue;
            }
            srcArr.splice(idx, 1);
            target.children.push(sel.item);
        }
        await saveBookmarks();
        exitMultiSelectMode();
        renderFolderTree();
        if (selectedFolder) {
            updateBookmarksList(selectedFolder.children || []);
        }
        showToast('移动成功');
    }

    async function batchCopy() {
        if (selectedItems.length === 0) return;
        const target = await showFolderPicker();
        if (!target) return;

        for (const sel of selectedItems) {
            if (sel.type === 'folder' && isDescendant(target, sel.item)) {
                showToast(`不能将「${sel.item.name}」拷贝到其子文件夹中`);
                continue;
            }
            const clone = deepCloneItem(sel.item);
            target.children.push(clone);
        }
        await saveBookmarks();
        exitMultiSelectMode();
        renderFolderTree();
        if (selectedFolder) {
            updateBookmarksList(selectedFolder.children || []);
        }
        showToast('拷贝成功');
    }

    function deepCloneItem(item) {
        if (item.type === 'bookmark') {
            return { type: 'bookmark', title: item.title, url: item.url, favicon: item.favicon };
        }
        if (item.type === 'folder') {
            return {
                type: 'folder',
                name: item.name,
                children: (item.children || []).map(c => deepCloneItem(c))
            };
        }
        return JSON.parse(JSON.stringify(item));
    }

    function isDescendant(parent, folder) {
        if (parent === folder) return true;
        if (!parent.children) return false;
        for (const child of parent.children) {
            if (child.type === 'folder' && isDescendant(child, folder)) return true;
        }
        return false;
    }

    function showFolderPicker() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal';
            overlay.innerHTML = `
                <div class="modal-content folder-picker-content">
                    <h3>选择目标文件夹</h3>
                    <div class="folder-picker-tree" id="folder-picker-tree"></div>
                    <div class="input-modal-actions" style="margin-top:16px">
                        <button class="input-modal-btn input-modal-btn--cancel" id="fp-cancel">取消</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const treeContainer = overlay.querySelector('#folder-picker-tree');
            renderFolderPickerTree(treeContainer, bookmarks, 0);

            overlay.querySelector('#fp-cancel').addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    document.body.removeChild(overlay);
                    resolve(null);
                }
            });
        });
    }

    function renderFolderPickerTree(container, folders, depth) {
        folders.forEach(folder => {
            if (folder.type !== 'folder') return;
            const item = document.createElement('div');
            item.className = 'folder-picker-item';
            item.style.paddingLeft = `${depth * 16 + 12}px`;
            item.innerHTML = `<span style="font-size:16px">&#x1F4C1;</span> ${folder.name}`;
            item.addEventListener('click', () => {
                // 关闭弹窗
                const overlay = item.closest('.modal');
                if (overlay) document.body.removeChild(overlay);
                // resolve 被外层闭包捕获，这里用事件方式传递
                resolveFolderPicker(folder);
            });
            container.appendChild(item);
            if (folder.children) {
                renderFolderPickerTree(container, folder.children, depth + 1);
            }
        });
    }

    // 全局变量传递 folder picker 结果
    let _folderPickerResolve = null;
    function resolveFolderPicker(folder) {
        if (_folderPickerResolve) {
            _folderPickerResolve(folder);
            _folderPickerResolve = null;
        }
    }

    // 修改 showFolderPicker 使用全局 resolve
    // 覆盖之前的 showFolderPicker
    const _origShowFolderPicker = showFolderPicker;
    showFolderPicker = function() {
        return new Promise((resolve) => {
            _folderPickerResolve = resolve;
            const overlay = document.createElement('div');
            overlay.className = 'modal';
            overlay.innerHTML = `
                <div class="modal-content folder-picker-content">
                    <h3>选择目标文件夹</h3>
                    <div class="folder-picker-tree" id="folder-picker-tree"></div>
                    <div class="input-modal-actions" style="margin-top:16px">
                        <button class="input-modal-btn input-modal-btn--cancel" id="fp-cancel">取消</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const treeContainer = overlay.querySelector('#folder-picker-tree');
            renderFolderPickerTree(treeContainer, bookmarks, 0);

            overlay.querySelector('#fp-cancel').addEventListener('click', () => {
                document.body.removeChild(overlay);
                _folderPickerResolve = null;
                resolve(null);
            });
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    document.body.removeChild(overlay);
                    _folderPickerResolve = null;
                    resolve(null);
                }
            });
        });
    };

    async function batchShare() {
        if (selectedItems.length === 0) return;
        const res = await showInputModal('分享', '输入短码（字母或数字）', null, '');
        if (!res || !res.v1) return;
        const code = res.v1.trim();
        if (!code) return;

        // 构建分享内容
        const shareItems = selectedItems.map(s => {
            if (s.type === 'folder') {
                return { type: 'folder', name: s.item.name, children: s.item.children || [] };
            }
            return { type: 'bookmark', title: s.item.title, url: s.item.url };
        });

        try {
            const resp = await fetch(`${API_URL}/share/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUserId,
                    code: code,
                    title: selectedFolder ? selectedFolder.name : '书签分享',
                    content: shareItems
                })
            });
            const data = await resp.json();
            if (!resp.ok) {
                showToast(data.error || '创建分享失败');
                return;
            }
            const shareUrl = `https://mark.lcy.app/${code}`;
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(shareUrl);
            } else {
                const ta = document.createElement('textarea');
                ta.value = shareUrl;
                ta.style.position = 'fixed'; ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            showToast(`已复制：${shareUrl}`);
            exitMultiSelectMode();
        } catch (err) {
            showToast('创建分享失败');
        }
    }

    // 多选操作栏事件绑定
    if (multiCancelBtn) {
        multiCancelBtn.addEventListener('click', exitMultiSelectMode);
    }
    if (multiDeleteBtn) {
        multiDeleteBtn.addEventListener('click', batchDelete);
    }
    if (multiCopyBtn) {
        multiCopyBtn.addEventListener('click', batchCopy);
    }
    if (multiMoveBtn) {
        multiMoveBtn.addEventListener('click', batchMove);
    }
    if (multiShareBtn) {
        multiShareBtn.addEventListener('click', batchShare);
    }

    // 渲染内容区的子文件夹（可点击进入）
    function renderContentFolderItem(folder, parentArray) {
        const div = document.createElement('div');
        div.className = 'content-folder-item';

        const icon = document.createElement('span');
        icon.className = 'content-folder-icon';
        const hasSubfolders = folder.children && folder.children.some(child => child.type === 'folder');
        icon.innerHTML = getFolderIconSVG(hasSubfolders ? 'closed' : 'empty', 20);

        const name = document.createElement('span');
        name.className = 'content-folder-name';
        name.textContent = folder.name;

        div.appendChild(icon);
        div.appendChild(name);

        // 文件夹 ... 菜单按钮
        attachFolderMenuBtn(div, folder, 'content-folder-menu-btn');

        // 多选模式 checkbox
        if (multiSelectMode) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'select-checkbox';
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelectItem('folder', folder, parentArray || null, checkbox);
            });
            div.insertBefore(checkbox, div.firstChild);
            div.classList.add('multi-select-item');
            // 多选模式：内容区文件夹拖拽排序
            if (parentArray) {
                attachContentDrag(div, folder, parentArray);
            }
        }

        div.onclick = (e) => {
            // 点击菜单按钮或菜单本身不触发进入文件夹
            if (e.target.closest('.dropdown-menu')) return;
            if (e.target.closest('.content-folder-menu-btn')) return;
            if (multiSelectMode && e.target.tagName === 'INPUT') return;
            if (multiSelectMode) return;
            selectedFolder = folder;
            selectedFolderName.textContent = folder.name;
            updateBookmarksList(folder.children || []);
            updateSelectedStateByFolder(folder);
            if (contentActions) contentActions.classList.remove('hidden');
        };

        return div;
    }

    // 根据 folder 对象高亮左侧对应项
    function updateSelectedStateByFolder(folder) {
        document.querySelectorAll('.folder-item').forEach(item => item.classList.remove('selected'));
        if (folder && folder._domElement) {
            folder._domElement.classList.add('selected');
        }
    }

    function renderBookmarkItem(bookmark, parentArray, highlightKeyword) {
        const div = document.createElement('a');
        div.className = 'bookmark-item';
        div.href = bookmark.url;
        div.target = '_blank';
        // 记录书签访问历史
        div.addEventListener('click', () => {
            saveVisitHistory(bookmark.url, bookmark.title);
            // 同步到云端
            debouncedSearchHistorySync();
        });

        const favicon = document.createElement('img');
        favicon.className = 'bookmark-favicon';
        favicon.style.opacity = '0';

        try {
            const urlObj = new URL(bookmark.url);
            const firstChar = (bookmark.title || '?').charAt(0).toUpperCase();
            // 使用统一 favicon 加载
            loadFavicon(favicon, urlObj.hostname, firstChar);
        } catch (e) {
            // URL 解析失败，保持透明
        }

        const info = document.createElement('div');
        info.className = 'bookmark-info';

        // 高亮匹配关键词
        function highlightText(text, keyword) {
            if (!keyword) return text;
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escaped})`, 'gi');
            return text.replace(regex, '<mark class="search-highlight">$1</mark>');
        }

        const title = document.createElement('h3');
        title.innerHTML = highlightKeyword ? highlightText(bookmark.title, highlightKeyword) : bookmark.title;
        const url = document.createElement('p');
        url.innerHTML = highlightKeyword ? highlightText(bookmark.url, highlightKeyword) : bookmark.url;
        info.appendChild(title);
        info.appendChild(url);

        div.appendChild(favicon);
        div.appendChild(info);

        // 多选模式 checkbox
        if (multiSelectMode) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'select-checkbox';
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelectItem('bookmark', bookmark, parentArray, checkbox);
            });
            div.insertBefore(checkbox, div.firstChild);
            div.classList.add('multi-select-item');
            // 多选模式下禁止跳转链接
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    e.preventDefault();
                }
            });
            // 多选模式：书签拖拽排序
            if (parentArray) {
                attachContentDrag(div, bookmark, parentArray);
            }
        }

        // ====== 书签菜单栏 ======
        const menuBtn = document.createElement('button');
        menuBtn.className = 'bookmark-menu-btn';
        menuBtn.textContent = '...';
        menuBtn.title = '更多操作';

        const dropdown = document.createElement('div');
        dropdown.className = 'bookmark-dropdown dropdown-menu hidden';

        const menuItems = [
            { label: '修改标题', action: 'rename-title' },
            { label: '修改链接', action: 'rename-url' },
            { label: '复制链接', action: 'share' },
            { divider: true },
            { label: '在此下方添加链接', action: 'add-below' },
            { divider: true },
            { label: '删除', action: 'delete', danger: true },
        ];

        menuItems.forEach(item => {
            if (item.divider) {
                const d = document.createElement('div');
                d.className = 'dropdown-divider';
                dropdown.appendChild(d);
                return;
            }
            const btn = document.createElement('button');
            btn.className = 'dropdown-item' + (item.danger ? ' dropdown-item--danger' : '');
            btn.textContent = item.label;
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropdown.classList.add('hidden');

                if (item.action === 'rename-title') {
                    const res = await showInputModal('修改标题', '新标题', null, bookmark.title);
                    if (!res || !res.v1) return;
                    bookmark.title = res.v1;
                    title.textContent = res.v1;
                    await saveBookmarks();
                }
                else if (item.action === 'rename-url') {
                    const res = await showInputModal('修改链接', '新链接地址', null, bookmark.url);
                    if (!res || !res.v1) return;
                    let newUrl = res.v1.trim();
                    if (!/^https?:\/\//i.test(newUrl) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(newUrl)) {
                        newUrl = 'https://' + newUrl;
                    }
                    bookmark.url = newUrl;
                    url.textContent = newUrl;
                    div.href = newUrl;
                    await saveBookmarks();
                }
                else if (item.action === 'share') {
                    if (navigator.clipboard) {
                        await navigator.clipboard.writeText(bookmark.url);
                    } else {
                        const ta = document.createElement('textarea');
                        ta.value = bookmark.url;
                        ta.style.position = 'fixed';
                        ta.style.left = '-9999px';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    }
                    showToast('已复制到剪贴板');
                }
                else if (item.action === 'add-below') {
                    const res = await showInputModal('在此下方添加链接', '标题', '链接地址（https://...）');
                    if (!res || !res.v1) return;
                    let newUrl = res.v2.trim();
                    if (!newUrl) return;
                    if (!/^https?:\/\//i.test(newUrl) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(newUrl)) {
                        newUrl = 'https://' + newUrl;
                    }
                    const newBookmark = {
                        type: 'bookmark',
                        title: res.v1,
                        url: newUrl,
                        dateAdded: Math.floor(Date.now() / 1000)
                    };
                    // 插入到 bookmark 的后面
                    if (parentArray) {
                        const idx = parentArray.indexOf(bookmark);
                        if (idx !== -1) {
                            parentArray.splice(idx + 1, 0, newBookmark);
                        } else {
                            parentArray.push(newBookmark);
                        }
                    } else if (selectedFolder && selectedFolder.children) {
                        const idx = selectedFolder.children.indexOf(bookmark);
                        if (idx !== -1) {
                            selectedFolder.children.splice(idx + 1, 0, newBookmark);
                        } else {
                            selectedFolder.children.push(newBookmark);
                        }
                    }
                    await saveBookmarks();
                    // 刷新当前视图
                    if (selectedFolder) {
                        updateBookmarksList(selectedFolder.children || []);
                    }
                }
                else if (item.action === 'delete') {
                    if (!confirm(`确定要删除书签「${bookmark.title}」吗？`)) return;
                    // 从 parentArray 或 selectedFolder.children 中删除
                    const arr = parentArray || (selectedFolder && selectedFolder.children);
                    if (arr) {
                        const idx = arr.indexOf(bookmark);
                        if (idx !== -1) arr.splice(idx, 1);
                    }
                    await saveBookmarks();
                    div.remove();
                }
            });
            dropdown.appendChild(btn);
        });

        // 三点按钮切换菜单
        menuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 关闭其他所有书签菜单
            document.querySelectorAll('.bookmark-dropdown').forEach(d => {
                if (d !== dropdown) d.classList.add('hidden');
            });
            dropdown.classList.toggle('hidden');
        });

        div.appendChild(menuBtn);
        div.appendChild(dropdown);

        // 点击页面其他地方关闭
        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
        }, { once: false });

        return div;
    }

    // 全局点击外部关闭文件夹菜单
    document.addEventListener('click', (e) => {
        const isFolderMenuBtn = e.target.closest('.folder-menu-btn') ||
                                 e.target.closest('.content-folder-menu-btn');
        if (!isFolderMenuBtn) {
            document.querySelectorAll('.folder-menu-btn + .dropdown-menu, .content-folder-menu-btn + .dropdown-menu').forEach(m => {
                m.classList.add('hidden');
            });
        }
    });

    // 检查是否有保存的登录信息，无则直接进入（免登录）
    const savedUser = localStorage.getItem('mark_current_user');
    if (savedUser) {
        try {
            const userData = JSON.parse(savedUser);
            currentUser = userData.username;
            currentUserId = userData.id;
            // 立即渲染缓存数据，不等待网络
            initDefaultFolder();
            renderFolderTree();
            selectDefaultFolder();
            updateEngineIcon();
            applyLanguage();
            showMainContainer();
            // 已登录：恢复保存的视图模式，默认书签模式
            const savedMode = localStorage.getItem('mark_view_mode');
            const mode = (savedMode === 'clean' || savedMode === 'bookmark') ? savedMode : 'bookmark';
            switchViewMode(mode);
            if (viewModeBtn) viewModeBtn.classList.remove('hidden');
            // 后台同步服务器数据
            syncBookmarks().then(() => {
                renderFolderTree();
                selectDefaultFolder();
                loadPreferences();
                // 加载搜索历史（云端同步）
                loadSearchHistoryFromCloud();
                // 同步完成后刷新简洁模式书签
                if (currentViewMode === 'clean') renderCleanModeBookmarks();
            }).catch(() => {});
        } catch (err) {
            console.log('无法解析保存的用户信息');
            guestMode();
        }
    } else {
        // 游客模式：直接进入主界面，书签存 localStorage
        guestMode();
    }

    function guestMode() {
        const savedBookmarks = localStorage.getItem('mark_guest_bookmarks');
        if (savedBookmarks) {
            try {
                bookmarks = JSON.parse(savedBookmarks);
            } catch(e) {
                bookmarks = [];
            }
        }
        initDefaultFolder();
        renderFolderTree();
        selectDefaultFolder();
        updateEngineIcon();
        applyLanguage();
        showMainContainer();
        // 游客默认简洁模式
        switchViewMode('clean');
        if (viewModeBtn) viewModeBtn.classList.add('hidden');

        // 页面关闭前强制同步搜索历史到云端
        window.addEventListener('beforeunload', () => {
            if (currentUserId) {
                const history = getSearchHistory();
                fetch(`${API_URL}/save-preference`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: currentUserId, key: 'searchHistory', value: history }),
                    keepalive: true
                }).catch(() => {});
            }
        });
    }
});