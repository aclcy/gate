const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
// 自定义静态文件托管：让分享短码路由优先于静态文件
const staticDir = path.join(__dirname, '.');
const staticFiles = new Set(['favicon.png', 'favicon.ico', 'app.js', 'styles.css', 'admin.html', 'index.html', 'share.html', 'mark.png', 'mark1.png']);
app.use((req, res, next) => {
    const urlPath = req.path.replace(/^\//, '');
    // 如果是已知静态文件或 api/admin 路由，直接走 express.static
    if (staticFiles.has(urlPath) || req.path.startsWith('/api/') || req.path === '/admin' || req.path === '/') {
        return express.static(staticDir)(req, res, next);
    }
    next();
});

const databaseConfig = {
    connectionString: process.env.DATABASE_URL
};

if (process.env.DATABASE_URL) {
    databaseConfig.ssl = {
        rejectUnauthorized: false
    };
}

const pool = new Pool(databaseConfig);

// 管理员密码（从数据库加载，默认 'admin'）
let adminPassword = 'admin';

// 从数据库加载管理员密码
async function loadAdminPassword() {
    try {
        const result = await pool.query(
            "SELECT value FROM admin_settings WHERE key = 'admin_password'"
        );
        if (result.rows.length > 0) {
            // 数据库中存储的是 bcrypt hash
            adminPassword = result.rows[0].value;
            console.log('Admin password loaded from database');
        } else {
            // 首次启动，存入默认密码 hash
            const defaultHash = await bcrypt.hash('admin', 10);
            await pool.query(
                "INSERT INTO admin_settings (key, value) VALUES ('admin_password', $1) ON CONFLICT (key) DO NOTHING",
                [defaultHash]
            );
            adminPassword = defaultHash;
            console.log('Default admin password saved to database');
        }
    } catch (err) {
        console.error('Failed to load admin password, using default:', err.message);
        adminPassword = await bcrypt.hash('admin', 10);
    }
}

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

async function initDatabase() {
    let retries = 5;
    while (retries > 0) {
        try {
            console.log('Attempting to initialize database...');
            
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Users table created or already exists');
            
            await pool.query(`
                CREATE TABLE IF NOT EXISTS bookmarks (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    data JSONB NOT NULL DEFAULT '[]',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Bookmarks table created or already exists');

            await pool.query(`
                CREATE TABLE IF NOT EXISTS admin_settings (
                    key VARCHAR(255) PRIMARY KEY,
                    value TEXT NOT NULL
                )
            `);
            console.log('Admin settings table created or already exists');

            await pool.query(`
                CREATE TABLE IF NOT EXISTS shares (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                    code VARCHAR(50) UNIQUE NOT NULL,
                    title VARCHAR(200),
                    content JSONB NOT NULL DEFAULT '[]',
                    domain VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Shares table created or already exists');

            // 迁移：为旧 shares 表添加 domain 列
            try {
                await pool.query("ALTER TABLE shares ADD COLUMN IF NOT EXISTS domain VARCHAR(255)");
            } catch (e) {
                // 列已存在则忽略
            }

            await pool.query(`
                CREATE TABLE IF NOT EXISTS user_preferences (
                    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    preferences JSONB NOT NULL DEFAULT '{}',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('User preferences table created or already exists');
            
            console.log('Database tables initialized successfully');
            return true;
        } catch (err) {
            console.error('Error initializing database:', err.message);
            retries--;
            if (retries > 0) {
                console.log(`Retrying in 3 seconds... ${retries} attempts left`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }
    console.error('Failed to initialize database after all retries');
    return false;
}

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    // 检查注册限额
    try {
        const limitResult = await pool.query("SELECT value FROM admin_settings WHERE key = 'registration_limit'");
        const limit = limitResult.rows.length > 0 ? parseInt(limitResult.rows[0].value, 10) : 10;
        if (limit === 0) {
            return res.status(403).json({ error: '当前不允许注册新用户' });
        }

        const today = new Date().toISOString().split('T')[0];
        const countResult = await pool.query("SELECT value FROM admin_settings WHERE key = 'registration_count_date'");
        const storedDate = countResult.rows.length > 0 ? countResult.rows[0].value : '';
        let todayCount = 0;
        if (storedDate === today) {
            const cnt = await pool.query("SELECT value FROM admin_settings WHERE key = 'registration_count_today'");
            todayCount = cnt.rows.length > 0 ? parseInt(cnt.rows[0].value, 10) : 0;
        } else {
            // 新的一天，重置计数
            await pool.query("INSERT INTO admin_settings (key, value) VALUES ('registration_count_date', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [today]);
            await pool.query("INSERT INTO admin_settings (key, value) VALUES ('registration_count_today', '0') ON CONFLICT (key) DO UPDATE SET value = '0'");
        }

        if (todayCount >= limit) {
            return res.status(403).json({ error: '已经超过每天注册用户限制，请24小时后重新申请注册' });
        }
    } catch (err) {
        console.error('Register limit check error:', err);
        return res.status(500).json({ error: '服务器错误' });
    }
    
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const userResult = await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username',
            [username, hashedPassword]
        );
        
        const user = userResult.rows[0];
        
        await pool.query(
            'INSERT INTO bookmarks (user_id, data) VALUES ($1, $2)',
            [user.id, '[]']
        );

        // 增加今日注册计数
        const today = new Date().toISOString().split('T')[0];
        await pool.query("INSERT INTO admin_settings (key, value) VALUES ('registration_count_date', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [today]);
        await pool.query("UPDATE admin_settings SET value = (COALESCE((SELECT value::int FROM admin_settings WHERE key = 'registration_count_today'), 0) + 1)::text WHERE key = 'registration_count_today'");
        
        res.json({ success: true, message: '注册成功' });
    } catch (err) {
        console.error('Register error:', err);
        if (err.code === '23505') {
            return res.status(400).json({ error: '用户名已存在' });
        }
        res.status(500).json({ error: '注册失败，请重试' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    
    try {
        const userResult = await pool.query(
            'SELECT id, username, password FROM users WHERE username = $1',
            [username]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        
        const user = userResult.rows[0];
        const valid = await bcrypt.compare(password, user.password);
        
        if (!valid) {
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        
        const bookmarksResult = await pool.query(
            'SELECT data FROM bookmarks WHERE user_id = $1',
            [user.id]
        );
        
        let userBookmarks = [];
        if (bookmarksResult.rows.length > 0 && bookmarksResult.rows[0].data) {
            try {
                userBookmarks = typeof bookmarksResult.rows[0].data === 'string' 
                    ? JSON.parse(bookmarksResult.rows[0].data) 
                    : bookmarksResult.rows[0].data;
            } catch (e) {
                console.error('Error parsing bookmarks:', e);
            }
        }
        
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username
            },
            bookmarks: userBookmarks
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: '登录失败，请重试' });
    }
});

// 修改个人资料（用户名/密码）
app.put('/api/profile', async (req, res) => {
    const { userId, username, currentPassword, password } = req.body;

    if (!userId) {
        return res.status(400).json({ error: '用户ID不能为空' });
    }
    if (!currentPassword) {
        return res.status(400).json({ error: '请输入当前密码' });
    }

    try {
        // 验证当前密码
        const user = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: '用户不存在' });
        }

        const validPassword = await bcrypt.compare(currentPassword, user.rows[0].password);
        if (!validPassword) {
            return res.status(401).json({ error: '当前密码不正确' });
        }

        // 修改用户名
        if (username) {
            const existing = await pool.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, userId]);
            if (existing.rows.length > 0) {
                return res.status(400).json({ error: '用户名已被占用' });
            }
            await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username, userId]);
        }

        // 修改密码
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ error: '修改失败，请重试' });
    }
});

app.post('/api/save-bookmarks', async (req, res) => {
    const { userId, bookmarks: bookmarksData } = req.body;
    
    if (!userId) {
        return res.status(400).json({ error: '用户ID不能为空' });
    }
    
    try {
        const bookmarksJson = JSON.stringify(bookmarksData || []);
        
        const existing = await pool.query(
            'SELECT id FROM bookmarks WHERE user_id = $1',
            [userId]
        );
        
        if (existing.rows.length > 0) {
            await pool.query(
                'UPDATE bookmarks SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
                [bookmarksJson, userId]
            );
        } else {
            await pool.query(
                'INSERT INTO bookmarks (user_id, data) VALUES ($1, $2)',
                [userId, bookmarksJson]
            );
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Save bookmarks error:', err);
        res.status(500).json({ error: '保存失败，请重试' });
    }
});

app.get('/api/get-bookmarks/:userId', async (req, res) => {
    const { userId } = req.params;
    
    if (!userId) {
        return res.status(400).json({ error: '用户ID不能为空' });
    }
    
    try {
        const result = await pool.query(
            'SELECT data FROM bookmarks WHERE user_id = $1',
            [userId]
        );
        
        let userBookmarks = [];
        if (result.rows.length > 0 && result.rows[0].data) {
            try {
                userBookmarks = typeof result.rows[0].data === 'string' 
                    ? JSON.parse(result.rows[0].data) 
                    : result.rows[0].data;
            } catch (e) {
                console.error('Error parsing bookmarks:', e);
            }
        }
        
        res.json({ success: true, bookmarks: userBookmarks });
    } catch (err) {
        console.error('Get bookmarks error:', err);
        res.status(500).json({ error: '获取书签失败，请重试' });
    }
});

app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, created_at FROM users ORDER BY created_at DESC'
        );
        
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ error: '获取用户列表失败' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    
    if (!id) {
        return res.status(400).json({ error: '用户ID不能为空' });
    }
    
    try {
        await pool.query('DELETE FROM bookmarks WHERE user_id = $1', [id]);
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        
        res.json({ success: true, message: '用户已删除' });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: '删除用户失败' });
    }
});

// 批量删除用户
app.post('/api/users/batch-delete', async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '请选择要删除的用户' });
    }
    try {
        for (const id of ids) {
            await pool.query('DELETE FROM bookmarks WHERE user_id = $1', [id]);
            await pool.query('DELETE FROM users WHERE id = $1', [id]);
        }
        res.json({ success: true, message: `已删除 ${ids.length} 个用户` });
    } catch (err) {
        console.error('Batch delete error:', err);
        res.status(500).json({ error: '批量删除失败' });
    }
});

// 重置用户密码
app.post('/api/users/:id/reset-password', async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 1) {
        return res.status(400).json({ error: '新密码不能为空' });
    }
    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, id]);
        res.json({ success: true, message: '密码修改成功' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: '修改密码失败' });
    }
});

// 管理员 API
app.post('/api/admin/verify', async (req, res) => {
    const { password } = req.body;
    try {
        const valid = await bcrypt.compare(password, adminPassword);
        if (valid) {
            res.json({ success: true });
        } else {
            res.json({ success: false, error: '密码错误' });
        }
    } catch (err) {
        console.error('Admin verify error:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

app.post('/api/admin/change-password', async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    try {
        const valid = await bcrypt.compare(oldPassword, adminPassword);
        if (!valid) {
            return res.json({ success: false, error: '原密码错误' });
        }
        if (!newPassword || newPassword.length < 1) {
            return res.json({ success: false, error: '新密码不能为空' });
        }
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query(
            "UPDATE admin_settings SET value = $1 WHERE key = 'admin_password'",
            [hashedPassword]
        );
        adminPassword = hashedPassword;
        res.json({ success: true, message: '密码修改成功' });
    } catch (err) {
        console.error('Admin change password error:', err);
        res.status(500).json({ error: '修改密码失败' });
    }
});

// 获取/更新注册限额
app.get('/api/admin/registration-limit', async (req, res) => {
    try {
        const limitResult = await pool.query("SELECT value FROM admin_settings WHERE key = 'registration_limit'");
        const countDateResult = await pool.query("SELECT value FROM admin_settings WHERE key = 'registration_count_date'");
        const countResult = await pool.query("SELECT value FROM admin_settings WHERE key = 'registration_count_today'");

        const limit = limitResult.rows.length > 0 ? parseInt(limitResult.rows[0].value, 10) : 10;
        const today = new Date().toISOString().split('T')[0];
        const storedDate = countDateResult.rows.length > 0 ? countDateResult.rows[0].value : '';
        const todayCount = storedDate === today
            ? (countResult.rows.length > 0 ? parseInt(countResult.rows[0].value, 10) : 0)
            : 0;

        res.json({ success: true, limit, todayCount });
    } catch (err) {
        console.error('Get registration limit error:', err);
        res.status(500).json({ error: '获取失败' });
    }
});

app.post('/api/admin/registration-limit', async (req, res) => {
    const { limit } = req.body;
    if (limit === undefined || limit === null || limit < 0) {
        return res.status(400).json({ error: '请输入有效数字' });
    }
    try {
        await pool.query("INSERT INTO admin_settings (key, value) VALUES ('registration_limit', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [String(limit)]);
        res.json({ success: true, limit: parseInt(limit, 10) });
    } catch (err) {
        console.error('Update registration limit error:', err);
        res.status(500).json({ error: '更新失败' });
    }
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ====== 全局搜索引擎管理 ======

// 内置引擎默认值（首次初始化时写入数据库，管理员可编辑排序但不可删除）
const DEFAULT_ENGINES_SEED = [
    { id: 'bookmark', name: '书签搜索', searchUrl: null,                                     color: '#2c3e50', isBuiltin: true,  visible: true },
    { id: 'bing',     name: '必应',     searchUrl: 'https://www.bing.com/search?q={q}',      color: '#008373', isBuiltin: true,  visible: true },
    { id: 'baidu',    name: '百度',     searchUrl: 'https://www.baidu.com/s?wd={q}',         color: '#2932E1', isBuiltin: false, visible: true },
    { id: 'sogou',    name: '搜狗',     searchUrl: 'https://www.sogou.com/web?query={q}',    color: '#FF4F01', isBuiltin: false, visible: true },
    { id: 'so360',    name: '360搜索',  searchUrl: 'https://www.so.com/s?q={q}',             color: '#40BA21', isBuiltin: false, visible: true },
    { id: 'metaso',   name: '秘塔AI',   searchUrl: 'https://metaso.cn/?q={q}',               color: '#6C5CE7', isBuiltin: false, visible: true },
];

// 初始化全局引擎（首次部署时写入内置引擎）
async function initGlobalEngines() {
    try {
        const result = await pool.query("SELECT value FROM admin_settings WHERE key = 'global_engines'");
        if (result.rows.length === 0) {
            // 首次部署：写入全套内置引擎
            await pool.query(
                "INSERT INTO admin_settings (key, value) VALUES ('global_engines', $1) ON CONFLICT (key) DO NOTHING",
                [JSON.stringify(DEFAULT_ENGINES_SEED)]
            );
            console.log('Default engines seeded to global_engines');
        } else {
            // 已有数据：补齐缺失的内置引擎，并同步更新已有引擎的 isBuiltin 字段
            let existing = JSON.parse(result.rows[0].value);
            const existingIds = new Set(existing.map(e => e.id));
            const missing = DEFAULT_ENGINES_SEED.filter(e => !existingIds.has(e.id));
            // 同步 isBuiltin 字段（确保升级后旧数据的 isBuiltin 状态正确）
            const builtinMap = {};
            DEFAULT_ENGINES_SEED.forEach(e => { builtinMap[e.id] = e.isBuiltin; });
            let changed = missing.length > 0;
            existing = existing.map(e => {
                let modified = false;
                // 同步 isBuiltin 字段
                if (e.id in builtinMap && e.isBuiltin !== builtinMap[e.id]) {
                    e = { ...e, isBuiltin: builtinMap[e.id] };
                    modified = true;
                }
                // 补齐 visible 字段（旧数据可能没有）
                if (e.visible === undefined) {
                    e = { ...e, visible: true };
                    modified = true;
                }
                if (modified) changed = true;
                return e;
            });
            if (changed) {
                // 补齐的内置引擎放到列表头部
                const merged = [...missing, ...existing];
                await pool.query(
                    "INSERT INTO admin_settings (key, value) VALUES ('global_engines', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
                    [JSON.stringify(merged)]
                );
                console.log(`Global engines updated: ${missing.length} added, isBuiltin fields synced`);
            }
        }
    } catch (err) {
        console.error('Failed to init global engines:', err.message);
    }
}

// 公开接口：所有用户获取全局引擎列表
app.get('/api/global-engines', async (req, res) => {
    try {
        const result = await pool.query("SELECT value FROM admin_settings WHERE key = 'global_engines'");
        const engines = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : [];
        res.json({ success: true, engines });
    } catch (err) {
        console.error('Get global engines error:', err);
        res.json({ success: true, engines: [] });
    }
});

// 管理员接口：整体排序（传入完整的 engines 数组，顺序即为新顺序）
app.put('/api/admin/global-engines/reorder', async (req, res) => {
    const { password, engines } = req.body;
    if (!password) return res.status(400).json({ error: '缺少密码' });
    const valid = await bcrypt.compare(password, adminPassword);
    if (!valid) return res.status(403).json({ error: '管理员密码错误' });
    if (!Array.isArray(engines)) return res.status(400).json({ error: 'engines 必须为数组' });
    try {
        await pool.query(
            "INSERT INTO admin_settings (key, value) VALUES ('global_engines', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [JSON.stringify(engines)]
        );
        res.json({ success: true, engines });
    } catch (err) {
        console.error('Reorder global engines error:', err);
        res.status(500).json({ error: '排序保存失败' });
    }
});

// 管理员接口：新增全局引擎
app.post('/api/admin/global-engines', async (req, res) => {
    const { password, name, searchUrl, color } = req.body;
    if (!password || !name || !searchUrl) {
        return res.status(400).json({ error: '参数不完整' });
    }
    const valid = await bcrypt.compare(password, adminPassword);
    if (!valid) return res.status(403).json({ error: '管理员密码错误' });
    if (!searchUrl.includes('{q}')) {
        return res.status(400).json({ error: '搜索地址必须包含 {q}' });
    }
    try {
        const result = await pool.query("SELECT value FROM admin_settings WHERE key = 'global_engines'");
        const engines = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : [];
        const id = 'global_' + Date.now();
        engines.push({ id, name, searchUrl, color: color || '#666' });
        await pool.query(
            "INSERT INTO admin_settings (key, value) VALUES ('global_engines', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [JSON.stringify(engines)]
        );
        res.json({ success: true, engines });
    } catch (err) {
        console.error('Add global engine error:', err);
        res.status(500).json({ error: '添加失败' });
    }
});

// 管理员接口：修改全局引擎
app.put('/api/admin/global-engines/:id', async (req, res) => {
    const { password, name, searchUrl, color } = req.body;
    const { id } = req.params;
    if (!password) return res.status(400).json({ error: '缺少密码' });
    const valid = await bcrypt.compare(password, adminPassword);
    if (!valid) return res.status(403).json({ error: '管理员密码错误' });
    try {
        const result = await pool.query("SELECT value FROM admin_settings WHERE key = 'global_engines'");
        let engines = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : [];
        const idx = engines.findIndex(e => e.id === id);
        if (idx === -1) return res.status(404).json({ error: '引擎不存在' });
        if (name) engines[idx].name = name;
        if (searchUrl) {
            if (!searchUrl.includes('{q}')) return res.status(400).json({ error: '搜索地址必须包含 {q}' });
            engines[idx].searchUrl = searchUrl;
        }
        if (color) engines[idx].color = color;
        await pool.query(
            "INSERT INTO admin_settings (key, value) VALUES ('global_engines', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [JSON.stringify(engines)]
        );
        res.json({ success: true, engines });
    } catch (err) {
        console.error('Update global engine error:', err);
        res.status(500).json({ error: '修改失败' });
    }
});

// 管理员接口：删除全局引擎
app.delete('/api/admin/global-engines/:id', async (req, res) => {
    const { password } = req.body;
    const { id } = req.params;
    if (!password) return res.status(400).json({ error: '缺少密码' });
    const valid = await bcrypt.compare(password, adminPassword);
    if (!valid) return res.status(403).json({ error: '管理员密码错误' });
    try {
        const result = await pool.query("SELECT value FROM admin_settings WHERE key = 'global_engines'");
        let engines = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : [];
        const target = engines.find(e => e.id === id);
        if (target && target.isBuiltin) {
            return res.status(403).json({ error: '内置引擎不可删除，可在列表中隐藏或调整顺序' });
        }
        engines = engines.filter(e => e.id !== id);
        await pool.query(
            "INSERT INTO admin_settings (key, value) VALUES ('global_engines', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [JSON.stringify(engines)]
        );
        res.json({ success: true, engines });
    } catch (err) {
        console.error('Delete global engine error:', err);
        res.status(500).json({ error: '删除失败' });
    }
});

// 管理员接口：切换引擎显示/隐藏
app.patch('/api/admin/global-engines/:id/visibility', async (req, res) => {
    const { password, visible } = req.body;
    const { id } = req.params;
    if (!password) return res.status(400).json({ error: '缺少密码' });
    const valid = await bcrypt.compare(password, adminPassword);
    if (!valid) return res.status(403).json({ error: '管理员密码错误' });
    try {
        const result = await pool.query("SELECT value FROM admin_settings WHERE key = 'global_engines'");
        let engines = result.rows.length > 0 ? JSON.parse(result.rows[0].value) : [];
        const idx = engines.findIndex(e => e.id === id);
        if (idx === -1) return res.status(404).json({ error: '引擎不存在' });
        engines[idx].visible = !!visible;
        await pool.query(
            "INSERT INTO admin_settings (key, value) VALUES ('global_engines', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
            [JSON.stringify(engines)]
        );
        res.json({ success: true, engines });
    } catch (err) {
        console.error('Toggle engine visibility error:', err);
        res.status(500).json({ error: '操作失败' });
    }
});

// ====== 分享功能 ======

// 已知路由列表，避免分享短码冲突
const KNOWN_PATHS = new Set(['admin', 'api', 'favicon.png', 'favicon.ico', 'index.html', 'app.js', 'styles.css', 'admin.html', 'share.html']);

app.post('/api/share/create', async (req, res) => {
    const { userId, code, title, content } = req.body;
    if (!userId || !code || !content) {
        return res.status(400).json({ error: '参数不完整' });
    }
    // 检查是否与已知路径冲突
    if (KNOWN_PATHS.has(code.toLowerCase())) {
        return res.status(400).json({ error: '短码与系统路径冲突，请换一个' });
    }
    try {
        // 检查是否已存在
        const exist = await pool.query('SELECT id FROM shares WHERE code = $1', [code]);
        if (exist.rows.length > 0) {
            return res.status(409).json({ error: '该短码已被使用，请换一个' });
        }
        await pool.query(
            'INSERT INTO shares (user_id, code, title, content) VALUES ($1, $2, $3, $4)',
            [userId, code, title || '', JSON.stringify(content)]
        );
        res.json({ success: true, code });
    } catch (err) {
        console.error('Share create error:', err);
        res.status(500).json({ error: '创建分享失败' });
    }
});

app.get('/api/share/:code', async (req, res) => {
    try {
        const result = await pool.query('SELECT title, content, created_at FROM shares WHERE code = $1', [req.params.code]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: '分享不存在' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Share get error:', err);
        res.status(500).json({ error: '获取分享失败' });
    }
});

// 分享查看页面 - 放在所有 API 路由之后，静态文件之前需要特殊处理
// 改为在 express.static 之前用条件判断
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 分享短码路由（匹配所有非静态文件、非 API 的路径）
app.get('/:code', async (req, res) => {
    const code = req.params.code;
    try {
        const result = await pool.query(`SELECT s.title, s.content, s.domain, s.created_at, u.username
            FROM shares s LEFT JOIN users u ON s.user_id = u.id
            WHERE s.code = $1`, [code]);
        if (result.rows.length === 0) {
            // 不是分享短码，返回 404
            return res.status(404).send('Not Found');
        }
        const share = result.rows[0];
        const items = typeof share.content === 'string' ? JSON.parse(share.content) : share.content;
        // 渲染分享查看页面
        const html = renderSharePage(share.title, items, code, share.domain || '', share.username || '用户');
        res.send(html);
    } catch (err) {
        console.error('Share view error:', err);
        res.status(500).send('Server Error');
    }
});

// 分享页面渲染
function renderSharePage(title, items, code, domain, username) {
    // 递归渲染分享内容（包括嵌套文件夹）
    function renderShareItems(list, depth) {
        if (!list || list.length === 0) return '';
        const pad = depth * 16;
        return list.map(item => {
            if (item.type === 'folder') {
                const childHtml = item.children && item.children.length > 0
                    ? renderShareItems(item.children, depth + 1)
                    : '';
                const count = countItems(item.children || []);
                return `<div class="share-folder" onclick="this.classList.toggle('share-folder--open')" style="padding-left:${pad + 16}px">
                    <span class="share-folder-arrow">&#9654;</span>
                    <span class="share-folder-icon">&#x1F4C1;</span>
                    <span>${escapeHtml(item.name || item.title || '')}</span>
                    ${count > 0 ? `<span class="share-count">${count}项</span>` : ''}
                </div>
                <div class="share-folder-children">${childHtml}</div>`;
            }
            return `<a class="share-link" href="${escapeHtml(item.url || '')}" target="_blank" rel="noopener" style="padding-left:${pad + 16}px">
                <div class="share-link-title">${escapeHtml(item.title || '')}</div>
                <div class="share-link-url">${escapeHtml(item.url || '')}</div>
            </a>`;
        }).join('');
    }

    const itemsHtml = renderShareItems(items, 0);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title || '分享')} - Mark</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;min-height:100vh}
        .share-header{background:#2c3e50;color:white;padding:20px 24px;text-align:center}
        .share-header h1{font-size:20px;font-weight:500;margin-bottom:4px}
        .share-header .share-meta{font-size:12px;opacity:.7}
        .share-list{max-width:640px;margin:24px auto;padding:0 16px;display:flex;flex-direction:column;gap:4px}
        .share-link{display:flex;flex-direction:column;padding:12px 16px;background:white;border-radius:6px;text-decoration:none;color:#333;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:box-shadow .15s;gap:4px}
        .share-link:hover{box-shadow:0 2px 8px rgba(0,0,0,.12)}
        .share-link-title{font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .share-link-url{font-size:12px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .share-folder{display:flex;align-items:center;padding:10px 16px;background:#f0f4ff;border-radius:6px;gap:8px;color:#333;cursor:pointer;user-select:none;transition:background .1s}
        .share-folder:hover{background:#dce8ff}
        .share-folder-arrow{font-size:10px;transition:transform .2s;flex-shrink:0;color:#666}
        .share-folder--open .share-folder-arrow{transform:rotate(90deg)}
        .share-folder-icon{font-size:18px}
        .share-count{font-size:12px;color:#888;margin-left:auto}
        .share-folder-children{display:none;flex-direction:column;gap:4px}
        .share-folder--open+.share-folder-children{display:flex}
        .share-empty{text-align:center;padding:40px;color:#888;font-size:14px}
        .share-footer{text-align:center;padding:20px;color:#999;font-size:12px}
    </style>
</head>
<body>
    <div class="share-header">
        <h1>${escapeHtml(title || '分享')}</h1>
        <div class="share-meta">来自 Mark 用户 ${escapeHtml(username)} 分享</div>
    </div>
    <div class="share-list">
        ${itemsHtml || '<div class="share-empty">暂无内容</div>'}
    </div>
    <div class="share-footer">mark.lcy.app/${escapeHtml(code)} &middot; Powered by Mark</div>
</body>
</html>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function countItems(children) {
    let count = 0;
    for (const c of children) {
        if (c.type === 'bookmark') count++;
        else if (c.type === 'folder') count += 1 + countItems(c.children || []);
    }
    return count;
}

// ====== 管理员短链接管理 ======

// 获取所有短链接
app.get('/api/admin/shares', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.id, s.code, s.title, s.domain, s.created_at, s.user_id, u.username
            FROM shares s
            LEFT JOIN users u ON s.user_id = u.id
            ORDER BY s.created_at DESC
        `);
        res.json({ success: true, shares: result.rows });
    } catch (err) {
        console.error('Get shares error:', err);
        res.status(500).json({ error: '获取短链接列表失败' });
    }
});

// 获取当前用户的短链接
app.get('/api/my-shares', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ error: '用户ID不能为空' });
    }
    try {
        const result = await pool.query(
            'SELECT id, code, title, created_at FROM shares WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        res.json({ success: true, shares: result.rows });
    } catch (err) {
        console.error('Get my shares error:', err);
        res.status(500).json({ error: '获取短链接失败' });
    }
});

// 用户删除自己的短链接
app.delete('/api/my-shares/:id', async (req, res) => {
    const { id } = req.params;
    const userId = req.query.userId;
    if (!userId) {
        return res.status(400).json({ error: '用户ID不能为空' });
    }
    try {
        await pool.query('DELETE FROM shares WHERE id = $1 AND user_id = $2', [id, userId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete my share error:', err);
        res.status(500).json({ error: '删除短链接失败' });
    }
});

// 修改短链接短码
app.post('/api/admin/shares/:id/domain', async (req, res) => {
    const { id } = req.params;
    const { domain } = req.body;
    if (!domain || domain.trim() === '') {
        return res.status(400).json({ error: '短码不能为空' });
    }
    try {
        // 检查是否与已知路径冲突
        if (KNOWN_PATHS.has(domain.trim().toLowerCase())) {
            return res.status(400).json({ error: '短码与系统路径冲突，请换一个' });
        }
        // 检查是否已存在
        const exist = await pool.query('SELECT id FROM shares WHERE code = $1 AND id != $2', [domain.trim(), id]);
        if (exist.rows.length > 0) {
            return res.status(409).json({ error: '该短码已被使用，请换一个' });
        }
        await pool.query('UPDATE shares SET code = $1, domain = $1 WHERE id = $2', [domain.trim(), id]);
        res.json({ success: true, code: domain.trim() });
    } catch (err) {
        console.error('Update share code error:', err);
        res.status(500).json({ error: '更新短码失败' });
    }
});

// 删除短链接
app.delete('/api/admin/shares/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM shares WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete share error:', err);
        res.status(500).json({ error: '删除短链接失败' });
    }
});

// 获取用户偏好
app.get('/api/preferences/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            'SELECT preferences FROM user_preferences WHERE user_id = $1',
            [userId]
        );
        const preferences = result.rows.length > 0 ? result.rows[0].preferences : {};
        res.json({ success: true, preferences });
    } catch (err) {
        console.error('Get preferences error:', err);
        res.status(500).json({ error: '获取偏好失败' });
    }
});

// 保存用户偏好
app.post('/api/save-preference', async (req, res) => {
    const { userId, key, value } = req.body;
    if (!userId || !key) {
        return res.status(400).json({ error: '参数不完整' });
    }
    try {
        const result = await pool.query(
            'SELECT preferences FROM user_preferences WHERE user_id = $1',
            [userId]
        );
        let preferences = result.rows.length > 0 ? result.rows[0].preferences : {};
        if (value === undefined || value === null) {
            delete preferences[key];
        } else {
            preferences[key] = value;
        }
        await pool.query(
            `INSERT INTO user_preferences (user_id, preferences, updated_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (user_id)
             DO UPDATE SET preferences = $2, updated_at = CURRENT_TIMESTAMP`,
            [userId, JSON.stringify(preferences)]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Save preference error:', err);
        res.status(500).json({ error: '保存偏好失败' });
    }
});

// ============ Favicon 代理 API ============
// 服务端抓取 favicon 并缓存，解决国内无法访问 Google/DuckDuckGo 的问题
const faviconCache = new Map(); // 内存缓存: hostname → { data, contentType, t }
const FAVICON_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h 过期
const FAVICON_CACHE_MAX = 2000;

app.get('/api/favicon/:hostname', async (req, res) => {
    const hostname = req.params.hostname;
    if (!hostname || !/^[a-zA-Z0-9._-]+$/.test(hostname)) {
        return res.status(400).send('Invalid hostname');
    }

    // 检查内存缓存
    const cached = faviconCache.get(hostname);
    if (cached && Date.now() - cached.t < FAVICON_CACHE_TTL) {
        res.set('Content-Type', cached.contentType);
        res.set('Cache-Control', 'public, max-age=86400'); // 浏览器缓存24h
        return res.send(cached.data);
    }

    // 按优先级尝试不同源
    const sources = [
        `https://favicon.im/${hostname}`,
        `https://icon.horse/icon/${hostname}`,
        `https://${hostname}/favicon.ico`,
        `https://${hostname}/favicon.png`,
    ];

    for (const sourceUrl of sources) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            const response = await fetch(sourceUrl, {
                signal: controller.signal,
                headers: { 'User-Agent': 'MarkFaviconBot/1.0' }
            });
            clearTimeout(timeout);

            if (response.ok) {
                const contentType = response.headers.get('content-type') || 'image/png';
                const buffer = Buffer.from(await response.arrayBuffer());

                // 检查是否是有效图片（大于100字节）
                if (buffer.length < 100) continue;

                // 存入内存缓存
                faviconCache.set(hostname, { data: buffer, contentType, t: Date.now() });
                // 清理超量缓存
                if (faviconCache.size > FAVICON_CACHE_MAX) {
                    const oldest = [...faviconCache.entries()].sort((a, b) => a[1].t - b[1].t);
                    for (let i = 0; i < oldest.length / 2; i++) faviconCache.delete(oldest[i][0]);
                }

                res.set('Content-Type', contentType);
                res.set('Cache-Control', 'public, max-age=86400');
                return res.send(buffer);
            }
        } catch (e) {
            // 此源失败，尝试下一个
            continue;
        }
    }

    // 所有源都失败，返回 404
    res.status(404).send('Not found');
});

// Bing 搜索联想代理（解决浏览器 CORS 限制）
app.get('/api/bing-suggestions', async (req, res) => {
    const { query } = req.query;
    if (!query) {
        return res.json([]);
    }
    try {
        const bingUrl = `https://cn.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`;
        console.log('[Bing Proxy] Fetching:', bingUrl);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const bingResp = await fetch(bingUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
                'Accept': '*/*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://cn.bing.com/'
            }
        });
        clearTimeout(timeout);
        console.log('[Bing Proxy] Status:', bingResp.status, bingResp.statusText);
        const text = await bingResp.text();
        console.log('[Bing Proxy] Response length:', text.length, 'preview:', text.substring(0, 100));
        const parsed = JSON.parse(text);
        const suggestions = Array.isArray(parsed) && parsed.length > 1 ? parsed[1] : [];
        console.log('[Bing Proxy] Suggestions count:', suggestions.length);
        res.json(suggestions);
    } catch (err) {
        console.error('[Bing Proxy] Error:', err.name, err.message);
        res.json([]);
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

async function startServer() {
    console.log('Starting server...');
    console.log('Database URL:', process.env.DATABASE_URL ? 'configured' : 'not configured');
    
    const dbInitialized = await initDatabase();
    
    if (dbInitialized) {
        console.log('Database connection successful');
        await loadAdminPassword();
        await initGlobalEngines();
        // 每次启动清理 shares 脏数据
        try {
            await pool.query("UPDATE shares SET domain = NULL WHERE domain LIKE 'mark.lcy.app%'");
            console.log('Cleaned share domain data');
        } catch (e) {
            // 忽略
        }
    } else {
        console.log('Database connection failed, server will start anyway');
    }
    
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
        console.log(`Main app: http://localhost:${port}/`);
        console.log(`Admin panel: http://localhost:${port}/admin`);
    });
}

startServer();