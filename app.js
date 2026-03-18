// 维修工作记录 App - 主逻辑

// ============ 数据存储 ============
const DB_NAME = 'repair_tracker';
const DB_VERSION = 1;
let db = null;

// 全局状态
let currentUser = null;
let currentOrder = null;
let editingFlowStep = null;
let mediaFiles = [];

// 预设流程标题
const FLOW_TITLES = [
    '开始检测',
    '确定故障原因待客户回复',
    '维修中',
    '等待配件中',
    '维修完成待提货',
    '交易完成'
];

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    loadUser();
    checkSharedOrder();
    
    // Service Worker 注册
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js');
    }
});

// 数据库初始化
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            
            // 用户表
            if (!database.objectStoreNames.contains('users')) {
                database.createObjectStore('users', { keyPath: 'username' });
            }
            
            // 邀请码表
            if (!database.objectStoreNames.contains('invite_codes')) {
                database.createObjectStore('invite_codes', { keyPath: 'code' });
            }
            
            // 维修单表
            if (!database.objectStoreNames.contains('orders')) {
                const orderStore = database.createObjectStore('orders', { keyPath: 'id' });
                orderStore.createIndex('createdAt', 'createdAt');
                orderStore.createIndex('creator', 'creator');
            }
            
            // 分享记录表
            if (!database.objectStoreNames.contains('shares')) {
                database.createObjectStore('shares', { keyPath: 'id' });
            }
            
            // 设置表
            if (!database.objectStoreNames.contains('settings')) {
                database.createObjectStore('settings', { keyPath: 'key' });
            }
        };
    });
}

// ============ 用户相关 ============
function loadUser() {
    const user = localStorage.getItem('currentUser');
    if (user) {
        currentUser = JSON.parse(user);
        showMain();
        updateUserInfo();
    } else {
        showLogin();
    }
}

function showLogin() {
    hideAllPages();
    document.getElementById('login-page').classList.remove('hidden');
}

function showRegister() {
    hideAllPages();
    document.getElementById('register-page').classList.remove('hidden');
}

async function register() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const inviteCode = document.getElementById('reg-invite-code')?.value.trim();
    
    if (!username || !password) {
        showToast('请填写完整信息');
        return;
    }
    
    // 检查用户是否已存在
    const exists = await dbGet('users', username);
    if (exists) {
        showToast('用户名已存在');
        return;
    }
    
    // 验证邀请码
    const allUsers = await dbGetAll('users');
    if (allUsers.length > 0) {
        // 需要邀请码
        if (!inviteCode) {
            showToast('请输入邀请码');
            return;
        }
        const validCode = await dbGet('invite_codes', inviteCode);
        if (!validCode || validCode.used) {
            showToast('邀请码无效或已使用');
            return;
        }
        // 标记邀请码已使用
        validCode.used = true;
        validCode.usedBy = username;
        validCode.usedAt = Date.now();
        await dbPut('invite_codes', validCode);
    }
    
    // 第一个注册的是管理员
    const role = allUsers.length === 0 ? 'admin' : 'partial';
    
    // 创建用户
    await dbPut('users', {
        username,
        password,
        nickname: nickname || username,
        role,
        createdAt: Date.now()
    });
    
    showToast('注册成功，请登录');
    showLogin();
}

async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const role = document.getElementById('role').value;
    
    if (!username || !password) {
        showToast('请输入用户名和密码');
        return;
    }
    
    const user = await dbGet('users', username);
    if (!user || user.password !== password) {
        showToast('用户名或密码错误');
        return;
    }
    
    // 验证角色权限（部分授权用户不能选择管理员权限）
    if (user.role === 'partial' && role !== 'partial') {
        showToast('您没有管理员权限');
        return;
    }
    
    currentUser = { ...user, loginRole: role };
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    showMain();
    updateUserInfo();
}

function logout() {
    currentUser = null;
    localStorage.removeItem('currentUser');
    showLogin();
}

function updateUserInfo() {
    const roleText = {
        admin: '管理员',
        full: '完全授权',
        partial: '部分授权'
    };
    document.getElementById('user-info').textContent = 
        `${currentUser.nickname || currentUser.username} (${roleText[currentUser.loginRole || currentUser.role]})`;
}

function showSettings() {
    hideAllPages();
    document.getElementById('settings-page').classList.remove('hidden');
    loadSettings();
}

async function loadSettings() {
    const nasUrl = await dbGet('settings', 'nas_url');
    const nasUsername = await dbGet('settings', 'nas_username');
    const nasPassword = await dbGet('settings', 'nas_password');
    const autoSync = await dbGet('settings', 'auto_sync');
    
    if (nasUrl) document.getElementById('nas-url').value = nasUrl.value || '';
    if (nasUsername) document.getElementById('nas-username').value = nasUsername.value || '';
    if (nasPassword) document.getElementById('nas-password').value = nasPassword.value || '';
    if (autoSync) document.getElementById('auto-sync').checked = autoSync.value;
}

async function saveSettings() {
    const nasUrl = document.getElementById('nas-url').value.trim();
    const nasUsername = document.getElementById('nas-username').value.trim();
    const nasPassword = document.getElementById('nas-password').value.trim();
    const autoSync = document.getElementById('auto-sync').checked;
    
    await dbPut('settings', { key: 'nas_url', value: nasUrl });
    await dbPut('settings', { key: 'nas_username', value: nasUsername });
    await dbPut('settings', { key: 'nas_password', value: nasPassword });
    await dbPut('settings', { key: 'auto_sync', value: autoSync });
    
    showToast('设置已保存');
    showMain();
}

// ============ 邀请码管理 ============
async function generateInviteCode() {
    if (currentUser.loginRole !== 'admin' && currentUser.role !== 'admin') {
        showToast('需要管理员权限');
        return;
    }
    
    const code = document.getElementById('new-invite-code').value.trim();
    if (!code) {
        showToast('请输入邀请码');
        return;
    }
    
    const exists = await dbGet('invite_codes', code);
    if (exists) {
        showToast('邀请码已存在');
        return;
    }
    
    await dbPut('invite_codes', {
        code: code,
        createdBy: currentUser.username,
        createdAt: Date.now(),
        used: false
    });
    
    showToast('邀请码已生成: ' + code);
    document.getElementById('new-invite-code').value = '';
    showInviteCodes();
}

async function showInviteCodes() {
    if (currentUser.loginRole !== 'admin' && currentUser.role !== 'admin') {
        showToast('需要管理员权限');
        return;
    }
    
    const codes = await dbGetAll('invite_codes');
    const container = document.getElementById('invite-codes-list');
    
    if (codes.length === 0) {
        container.innerHTML = '<p style="color:#999">暂无邀请码</p>';
        return;
    }
    
    container.innerHTML = codes.map(c => `
        <div style="padding:8px;background:#f5f5f5;margin-bottom:8px;border-radius:4px;">
            <strong>${c.code}</strong> - ${c.used ? '已使用 by ' + c.usedBy : '未使用'}
        </div>
    `).join('');
}

// ============ 维修单管理 ============
function showMain() {
    hideAllPages();
    document.getElementById('main-page').classList.remove('hidden');
    loadOrders();
}

async function loadOrders() {
    const allOrders = await dbGetAll('orders');
    
    // 权限过滤
    let orders = allOrders;
    if (currentUser.loginRole === 'partial' || currentUser.role === 'partial') {
        orders = allOrders.filter(o => o.creator === currentUser.username);
    }
    
    // 按时间排序（新的在前）
    orders.sort((a, b) => b.createdAt - a.createdAt);
    
    renderOrders(orders);
    renderStats(orders);
}

function renderOrders(orders) {
    const container = document.getElementById('orders-container');
    
    if (orders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📋</div>
                <p>暂无维修单</p>
                <p>点击上方"新建维修单"开始</p>
            </div>
        `;
        return;
    }
    
    // 按月份分组
    const months = {};
    orders.forEach(order => {
        const date = new Date(order.createdAt);
        const key = `${date.getFullYear()}年${date.getMonth() + 1}月`;
        if (!months[key]) months[key] = [];
        months[key].push(order);
    });
    
    let html = '';
    for (const [month, monthOrders] of Object.entries(months)) {
        html += `
            <div class="month-group">
                <div class="month-header" onclick="toggleMonth(this)">
                    <span>${month}</span>
                    <span class="count">${monthOrders.length}</span>
                </div>
                <div class="month-orders">
                    ${monthOrders.map(order => renderOrderCard(order)).join('')}
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
    
    // 默认展开最近月份
    const firstMonth = container.querySelector('.month-header');
    if (firstMonth) firstMonth.classList.remove('collapsed');
}

function renderOrderCard(order) {
    const status = order.flow && order.flow.length > 0 
        ? order.flow[order.flow.length - 1].title 
        : '待开始';
    const statusClass = getStatusClass(status);
    
    const flowProgress = order.flow 
        ? order.flow.map((f, i) => {
            const isActive = i === order.flow.length - 1;
            return `<span class="flow-dot ${isActive ? 'active' : 'completed'}">${i + 1}</span>`;
        }).join('')
        : '';
    
    const creator = order.creatorNickname || order.creator;
    const date = new Date(order.createdAt);
    const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    
    return `
        <div class="order-card" onclick="viewOrder('${order.id}')">
            <div class="order-card-header">
                <div class="order-card-title">${order.title || '未命名维修单'}</div>
                <span class="order-card-status ${statusClass}">${status}</span>
            </div>
            <div class="order-card-info">
                <span>👤 ${order.customer || '未设置客户'}</span>
                <span>📅 ${dateStr}</span>
            </div>
            <div class="order-card-flow">
                <span>🔧 ${creator}</span>
                <div class="flow-progress">${flowProgress}</div>
            </div>
        </div>
    `;
}

function getStatusClass(status) {
    if (status.includes('检测')) return 'status-检测中';
    if (status.includes('回复')) return 'status-待回复';
    if (status.includes('维修')) return 'status-维修中';
    if (status.includes('配件')) return 'status-等待配件';
    if (status.includes('提货')) return 'status-待提货';
    if (status.includes('完成')) return 'status-已完成';
    return '';
}

function toggleMonth(header) {
    header.classList.toggle('collapsed');
    header.nextElementSibling.classList.toggle('collapsed');
}

function showAddOrder() {
    currentOrder = null;
    hideAllPages();
    document.getElementById('order-page').classList.remove('hidden');
    document.getElementById('order-title').value = '';
    document.getElementById('order-customer').value = '';
    document.getElementById('order-contact').value = '';
    document.getElementById('flow-steps').innerHTML = '';
    document.getElementById('delete-btn').style.display = 'none';
}

async function viewOrder(id) {
    const order = await dbGet('orders', id);
    if (!order) {
        showToast('维修单不存在');
        return;
    }
    
    // 权限检查
    if ((currentUser.loginRole === 'partial' || currentUser.role === 'partial') 
        && order.creator !== currentUser.username 
        && !order.sharedTo?.includes(currentUser.username)) {
        showToast('您没有权限查看此维修单');
        return;
    }
    
    currentOrder = order;
    hideAllPages();
    document.getElementById('order-page').classList.remove('hidden');
    
    document.getElementById('order-title').value = order.title || '';
    document.getElementById('order-customer').value = order.customer || '';
    document.getElementById('order-contact').value = order.contact || '';
    
    renderFlowSteps(order.flow || []);
    
    // 只有创建者或管理员可以删除
    const canDelete = currentUser.loginRole === 'admin' || currentUser.loginRole === 'full' 
        || order.creator === currentUser.username;
    document.getElementById('delete-btn').style.display = canDelete ? 'block' : 'none';
}

function renderFlowSteps(flow) {
    const container = document.getElementById('flow-steps');
    
    if (flow.length === 0) {
        container.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">暂无流程步骤</p>';
        return;
    }
    
    // 按时间排序（新的在前）
    const sortedFlow = [...flow].sort((a, b) => b.time - a.time);
    
    container.innerHTML = sortedFlow.map((step, index) => {
        const date = new Date(step.time);
        const timeStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
        
        let mediaHtml = '';
        if (step.media && step.media.length > 0) {
            mediaHtml = '<div class="flow-step-media">';
            step.media.forEach(m => {
                if (m.type.startsWith('image/')) {
                    mediaHtml += `<img src="${m.data}" alt="附件" onclick="previewMedia('${m.data}')">`;
                } else if (m.type.startsWith('video/')) {
                    mediaHtml += `<video src="${m.data}" controls></video>`;
                }
            });
            mediaHtml += '</div>';
        }
        
        return `
            <div class="flow-step">
                <div class="flow-step-header">
                    <span class="flow-step-title">${step.title}</span>
                    <span class="flow-step-time">${timeStr}</span>
                </div>
                <div class="flow-step-desc">${step.desc || '无描述'}</div>
                ${mediaHtml}
                <div class="flow-step-actions">
                    <button class="btn-small" onclick="editFlowStep(${index})">编辑</button>
                    <button class="btn-small" style="background:#F44336" onclick="deleteFlowStep(${index})">删除</button>
                </div>
            </div>
        `;
    }).join('');
}

async function saveOrder() {
    const title = document.getElementById('order-title').value.trim();
    const customer = document.getElementById('order-customer').value.trim();
    const contact = document.getElementById('order-contact').value.trim();
    
    if (!title) {
        showToast('请输入维修单标题');
        return;
    }
    
    const order = currentOrder || {
        id: generateId(),
        creator: currentUser.username,
        creatorNickname: currentUser.nickname || currentUser.username,
        createdAt: Date.now()
    };
    
    order.title = title;
    order.customer = customer;
    order.contact = contact;
    order.updatedAt = Date.now();
    
    await dbPut('orders', order);
    
    // 自动同步
    const autoSync = await dbGet('settings', 'auto_sync');
    if (autoSync?.value) {
        syncToNAS();
    }
    
    showToast('保存成功');
    showMain();
}

async function deleteOrder() {
    if (!currentOrder) return;
    
    if (!confirm('确定要删除这个维修单吗？')) return;
    
    await dbDelete('orders', currentOrder.id);
    showToast('已删除');
    showMain();
}

// ============ 流程步骤 ============
function addFlowStep() {
    editingFlowStep = null;
    document.getElementById('flow-title-select').value = '开始检测';
    document.getElementById('flow-title-custom').style.display = 'none';
    document.getElementById('flow-title-custom').value = '';
    document.getElementById('flow-desc').value = '';
    document.getElementById('flow-media').value = '';
    document.getElementById('media-preview').innerHTML = '';
    mediaFiles = [];
    
    document.getElementById('flow-modal').classList.remove('hidden');
}

function editFlowStep(index) {
    editingFlowStep = index;
    const step = currentOrder.flow[index];
    
    if (FLOW_TITLES.includes(step.title)) {
        document.getElementById('flow-title-select').value = step.title;
        document.getElementById('flow-title-custom').style.display = 'none';
    } else {
        document.getElementById('flow-title-select').value = '自定义';
        document.getElementById('flow-title-custom').style.display = 'block';
        document.getElementById('flow-title-custom').value = step.title;
    }
    
    document.getElementById('flow-desc').value = step.desc || '';
    document.getElementById('flow-media').value = '';
    document.getElementById('media-preview').innerHTML = '';
    mediaFiles = step.media || [];
    
    // 显示已有媒体
    renderMediaPreview();
    
    document.getElementById('flow-modal').classList.remove('hidden');
}

document.getElementById('flow-title-select').addEventListener('change', function() {
    const customInput = document.getElementById('flow-title-custom');
    if (this.value === '自定义') {
        customInput.style.display = 'block';
    } else {
        customInput.style.display = 'none';
    }
});

document.getElementById('flow-media').addEventListener('change', async function() {
    const files = Array.from(this.files);
    for (const file of files) {
        const data = await fileToBase64(file);
        mediaFiles.push({
            name: file.name,
            type: file.type,
            data
        });
    }
    renderMediaPreview();
});

function renderMediaPreview() {
    const container = document.getElementById('media-preview');
    container.innerHTML = mediaFiles.map((m, i) => {
        if (m.type.startsWith('image/')) {
            return `<img src="${m.data}" onclick="removeMedia(${i})" title="点击删除">`;
        } else if (m.type.startsWith('video/')) {
            return `<video src="${m.data}" onclick="removeMedia(${i})" title="点击删除"></video>`;
        }
        return '';
    }).join('');
}

function removeMedia(index) {
    mediaFiles.splice(index, 1);
    renderMediaPreview();
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function confirmFlowStep() {
    const titleSelect = document.getElementById('flow-title-select').value;
    const titleCustom = document.getElementById('flow-title-custom').value;
    const title = titleSelect === '自定义' ? titleCustom : titleSelect;
    const desc = document.getElementById('flow-desc').value.trim();
    
    if (!title) {
        showToast('请输入步骤标题');
        return;
    }
    
    const step = {
        title,
        desc,
        media: mediaFiles,
        time: Date.now()
    };
    
    if (!currentOrder.flow) currentOrder.flow = [];
    
    if (editingFlowStep !== null) {
        currentOrder.flow[editingFlowStep] = step;
    } else {
        currentOrder.flow.push(step);
    }
    
    renderFlowSteps(currentOrder.flow);
    closeFlowModal();
}

function deleteFlowStep(index) {
    if (!confirm('确定删除此步骤？')) return;
    currentOrder.flow.splice(index, 1);
    renderFlowSteps(currentOrder.flow);
}

function closeFlowModal() {
    document.getElementById('flow-modal').classList.add('hidden');
}

// ============ 分享功能 ============
function shareOrder() {
    document.getElementById('share-modal').classList.remove('hidden');
}

function closeShareModal() {
    document.getElementById('share-modal').classList.add('hidden');
}

function copyShareLink() {
    const shareUrl = `${window.location.origin}${window.location.pathname}?share=${currentOrder.id}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('链接已复制');
    }).catch(() => {
        showToast('复制失败，请手动复制');
    });
}

function generateShareCode() {
    const code = currentOrder.id.substring(0, 8).toUpperCase();
    navigator.clipboard.writeText(code).then(() => {
        showToast(`分享码: ${code}`);
    });
}

async function checkSharedOrder() {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get('share');
    const shareCode = params.get('code');
    
    if (shareId || shareCode) {
        // 显示分享的维修单（临时）
        const allOrders = await dbGetAll('orders');
        const order = allOrders.find(o => 
            o.id === shareId || 
            o.id.substring(0, 8).toUpperCase() === shareCode
        );
        
        if (order) {
            // 将分享的订单添加到当前用户（如果已登录）
            const user = localStorage.getItem('currentUser');
            if (user) {
                const currentUser = JSON.parse(user);
                if (!order.sharedTo) order.sharedTo = [];
                if (!order.sharedTo.includes(currentUser.username)) {
                    order.sharedTo.push(currentUser.username);
                    await dbPut('orders', order);
                }
            }
        }
    }
}

// ============ NAS 同步 ============
async function syncToNAS() {
    const nasUrl = await dbGet('settings', 'nas_url');
    const nasUsername = await dbGet('settings', 'nas_username');
    const nasPassword = await dbGet('settings', 'nas_password');
    
    if (!nasUrl?.value) {
        showToast('请先配置NAS设置');
        return;
    }
    
    try {
        showToast('正在同步...');
        
        const allOrders = await dbGetAll('orders');
        const data = JSON.stringify(allOrders, null, 2);
        
        const response = await fetch(nasUrl.value + 'repair_data.json', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: data
        });
        
        if (response.ok) {
            showToast('同步成功 ☁️');
        } else {
            showToast('同步失败: ' + response.status);
        }
    } catch (e) {
        showToast('同步失败: ' + e.message);
    }
}

// ============ 导入导出 ============
function exportData() {
    Promise.all([
        dbGetAll('orders'),
        dbGetAll('users'),
        dbGetAll('settings')
    ]).then(([orders, users, settings]) => {
        const data = { orders, users, settings, exportedAt: Date.now() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `repair_tracker_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('导出成功');
    });
}

function importData() {
    document.getElementById('import-file').click();
}

async function handleImport(input) {
    const file = input.files[0];
    if (!file) return;
    
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (data.orders) {
            for (const order of data.orders) {
                await dbPut('orders', order);
            }
        }
        
        showToast('导入成功');
        showMain();
    } catch (e) {
        showToast('导入失败: ' + e.message);
    }
    
    input.value = '';
}

// ============ 工具函数 ============
function hideAllPages() {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) {
        const t = document.createElement('div');
        t.id = 'toast';
        document.body.appendChild(t);
    }
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

// IndexedDB 封装
function dbGet(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

function dbPut(storeName, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.put(value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function dbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ============ 用户管理（管理员） ============
function showUsers() {
    if (currentUser.loginRole !== 'admin' && currentUser.role !== 'admin') {
        showToast('需要管理员权限');
        return;
    }
    
    hideAllPages();
    document.getElementById('users-page').classList.remove('hidden');
    loadUsers();
}

async function loadUsers() {
    const users = await dbGetAll('users');
    const container = document.getElementById('users-list');
    
    const roleText = { admin: '管理员', full: '完全授权', partial: '部分授权' };
    
    container.innerHTML = users.map(u => `
        <div class="user-item">
            <div class="user-info">
                <span class="user-name">${u.nickname || u.username}</span>
                <span class="user-role">${roleText[u.role]}</span>
            </div>
            <div class="user-actions">
                <button class="btn-small" onclick="editUserRole('${u.username}')">修改权限</button>
            </div>
        </div>
    `).join('');
}

async function editUserRole(username) {
    const user = await dbGet('users', username);
    const newRole = prompt('请输入权限 (admin/full/partial):', user.role);
    if (newRole && ['admin', 'full', 'partial'].includes(newRole)) {
        user.role = newRole;
        await dbPut('users', user);
        showToast('权限已更新');
        loadUsers();
    }
}

// ============ 统计卡片 ============
function renderStats(orders) {
    const total = orders.length;
    const pending = orders.filter(o => {
        const status = o.flow && o.flow.length > 0 ? o.flow[o.flow.length - 1].title : '';
        return !status.includes('完成');
    }).length;
    const inProgress = orders.filter(o => {
        const status = o.flow && o.flow.length > 0 ? o.flow[o.flow.length - 1].title : '';
        return status.includes('维修') || status.includes('检测') || status.includes('配件');
    }).length;
    const completed = orders.filter(o => {
        const status = o.flow && o.flow.length > 0 ? o.flow[o.flow.length - 1].title : '';
        return status.includes('完成');
    }).length;
    
    const container = document.getElementById('stats-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="stat-card stat-blue" onclick="filterOrders('all')">
            <div class="stat-label">总修售单</div>
            <div class="stat-value">${total}</div>
        </div>
        <div class="stat-card stat-yellow" onclick="filterOrders('pending')">
            <div class="stat-label">待处理</div>
            <div class="stat-value">${pending}</div>
        </div>
        <div class="stat-card stat-purple" onclick="filterOrders('inProgress')">
            <div class="stat-label">进行中</div>
            <div class="stat-value">${inProgress}</div>
        </div>
        <div class="stat-card stat-green" onclick="filterOrders('completed')">
            <div class="stat-label">已完成</div>
            <div class="stat-value">${completed}</div>
        </div>
    `;
}

function filterOrders(type) {
    // 这里可以实现过滤功能，暂时只显示全部
    showToast('显示: ' + (type === 'all' ? '全部' : type === 'pending' ? '待处理' : type === 'inProgress' ? '进行中' : '已完成'));
}
