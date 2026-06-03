const state = {
  token: localStorage.getItem('adminToken') || '',
  view: 'dashboard'
};

const titles = {
  dashboard: ['概览', '查看业务、生成和 KL API 运行状态'],
  users: ['用户', '用户资料、额度和关联数据'],
  tasks: ['生成任务', '查看任务状态、失败原因、输出图片并支持重试'],
  orders: ['订单', '支付订单与充值记录'],
  feedback: ['反馈', '用户提交的问题与建议'],
  assets: ['图片资产', 'image2 输出转存后的可访问图片'],
  runtime: ['运行配置', 'KL API、代理、无限额度和 mock 配置']
};

const $ = (selector) => document.querySelector(selector);
const fmt = (value) => value == null || value === '' ? '-' : String(value);
const money = (fen) => `¥${((fen || 0) / 100).toFixed(2)}`;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function resolveAssetUrl(url = '') {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('/assets/generated/') || url.startsWith('/assets/object/')) return url;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isAsset = parsed.pathname.startsWith('/assets/generated/') || parsed.pathname.startsWith('/assets/object/');
    const isLocal = host === 'localhost' || host === '0.0.0.0' || host.startsWith('127.');
    const isPrivateLan = host.startsWith('192.168.') || host.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    if (isAsset && (isLocal || isPrivateLan)) return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return url;
  }
  return url;
}

function thumb(url) {
  const resolved = resolveAssetUrl(url);
  if (!resolved) return '-';
  const safeUrl = escapeHtml(resolved);
  return `<a class="thumb-link" href="${safeUrl}" target="_blank"><img class="thumb" src="${safeUrl}" alt="生成图" loading="lazy" /></a>`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function showApp(loggedIn) {
  $('#loginPanel').classList.toggle('hidden', loggedIn);
  $('#appPanel').classList.toggle('hidden', !loggedIn);
  $('#logoutBtn').classList.toggle('hidden', !loggedIn);
  $('#refreshBtn').classList.toggle('hidden', !loggedIn);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach((item) => item.classList.add('hidden'));
  $(`#${view}View`).classList.remove('hidden');
  const [title, subtitle] = titles[view];
  $('#viewTitle').textContent = title;
  $('#viewSubtitle').textContent = subtitle;
  loadCurrentView();
}

function status(value) {
  return `<span class="status ${fmt(value)}">${fmt(value)}</span>`;
}

function table(headers, rows) {
  if (!rows.length) return '<div class="card muted">暂无数据</div>';
  return `<div class="panel"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function row(cells) {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
}

function detail(title, data) {
  $('#dialogTitle').textContent = title;
  $('#dialogBody').textContent = JSON.stringify(data, null, 2);
  $('#detailDialog').showModal();
}

async function loadDashboard() {
  const stats = await api('/admin/api/stats');
  $('#dashboardView').innerHTML = `
    <section class="grid">
      ${metric('用户', stats.users)}
      ${metric('任务', stats.tasks)}
      ${metric('成功图片', stats.successImages)}
      ${metric('失败图片', stats.failedImages)}
      ${metric('订单', stats.orders)}
      ${metric('已支付', stats.paidOrders)}
      ${metric('收入', money(stats.paidAmountFen))}
      ${metric('反馈', stats.feedback)}
    </section>
    <section class="panel">
      <div class="panel-head"><strong>运行状态</strong></div>
      <pre>${JSON.stringify(stats.runtime, null, 2)}</pre>
    </section>
  `;
}

function metric(label, value) {
  return `<div class="card"><div class="muted">${label}</div><div class="metric">${value}</div></div>`;
}

async function loadUsers() {
  const data = await api('/admin/api/users');
  $('#usersView').innerHTML = table(['用户', '昵称', '剩余次数', '实际额度', '任务', '订单', '操作'], data.items.map((item) => row([
    `<code>${item.userId}</code>`,
    fmt(item.nickname),
    item.credits?.displayText || item.credits?.balance || 0,
    item.credits?.actualBalance ?? item.credits?.balance ?? 0,
    item.taskCount,
    item.orderCount,
    `<div class="actions"><button class="secondary" data-action="userDetail" data-id="${item.userId}">详情</button><button class="secondary" data-action="creditManage" data-id="${item.userId}" data-balance="${item.credits?.actualBalance ?? item.credits?.balance ?? 0}">管理次数</button></div>`
  ])));
}

async function loadTasks() {
  const data = await api('/admin/api/tasks');
  $('#tasksView').innerHTML = table(['任务', '用户', '状态', '进度', '输出', '耗时', '操作'], data.items.map((item) => {
    const first = (item.images || []).find((image) => image.url) || {};
    const elapsed = Math.max(...(item.images || []).map((image) => image.elapsedMs || 0), 0);
    return row([
      `<code>${item.taskId}</code>`,
      `<code>${item.userId}</code>`,
      status(item.status),
      `${item.progress || 0}%`,
      thumb(first.url),
      `${elapsed}ms`,
      `<div class="actions"><button class="secondary" data-action="taskDetail" data-id="${item.taskId}">详情</button><button class="secondary" data-action="taskRetry" data-id="${item.taskId}">重试</button><button class="danger" data-action="taskCancel" data-id="${item.taskId}">取消</button></div>`
    ]);
  }));
}

async function loadOrders() {
  const data = await api('/admin/api/orders');
  $('#ordersView').innerHTML = table(['订单', '用户', '套餐', '金额', '状态', '时间', '操作'], data.items.map((item) => row([
    `<code>${item.orderId}</code>`,
    `<code>${item.userId}</code>`,
    fmt(item.packageName || item.packageId),
    money(item.amountFen),
    status(item.status),
    fmt(item.createdAt),
    item.status === 'PENDING' ? `<button class="danger" data-action="orderClose" data-id="${item.orderId}">关闭</button>` : '-'
  ])));
}

async function loadFeedback() {
  const data = await api('/admin/api/feedback');
  $('#feedbackView').innerHTML = table(['用户', '内容', '联系方式', '来源', '时间'], data.items.map((item) => row([
    `<code>${item.userId}</code>`,
    fmt(item.content),
    fmt(item.contact),
    fmt(item.source),
    fmt(item.createdAt)
  ])));
}

async function loadAssets() {
  const data = await api('/admin/api/assets');
  $('#assetsView').innerHTML = table(['图片', '风格', '类型', '大小', '时间', '链接'], data.items.map((item) => row([
    thumb(item.url),
    fmt(item.style),
    fmt(item.mimeType),
    `${Math.round((item.sizeBytes || 0) / 1024)} KB`,
    fmt(item.createdAt),
    `<a href="${escapeHtml(resolveAssetUrl(item.url))}" target="_blank">打开</a>`
  ])));
}

async function loadRuntime() {
  const data = await api('/admin/api/runtime');
  $('#runtimeView').innerHTML = `<section class="panel"><div class="panel-head"><strong>当前配置</strong></div><pre>${JSON.stringify(data, null, 2)}</pre></section>`;
}

async function loadCurrentView() {
  try {
    if (state.view === 'dashboard') await loadDashboard();
    if (state.view === 'users') await loadUsers();
    if (state.view === 'tasks') await loadTasks();
    if (state.view === 'orders') await loadOrders();
    if (state.view === 'feedback') await loadFeedback();
    if (state.view === 'assets') await loadAssets();
    if (state.view === 'runtime') await loadRuntime();
  } catch (error) {
    if (/登录|token|401/i.test(error.message)) {
      localStorage.removeItem('adminToken');
      state.token = '';
      showApp(false);
      return;
    }
    $(`#${state.view}View`).innerHTML = `<pre class="error">${error.message}</pre>`;
  }
}

async function handleAction(action, id) {
  if (action === 'userDetail') return detail('用户详情', await api(`/admin/api/users/${id}`));
  if (action === 'creditManage') return openCreditDialog(id);
  if (action === 'taskDetail') return detail('任务详情', await api(`/admin/api/tasks/${id}`));
  if (action === 'taskRetry') {
    await api(`/admin/api/tasks/${id}/retry`, { method: 'POST', body: '{}' });
    return loadTasks();
  }
  if (action === 'taskCancel') {
    await api(`/admin/api/tasks/${id}/cancel`, { method: 'POST', body: '{}' });
    return loadTasks();
  }
  if (action === 'orderClose') {
    await api(`/admin/api/orders/${id}/close`, { method: 'POST', body: '{}' });
    return loadOrders();
  }
}

async function openCreditDialog(userId) {
  const user = await api(`/admin/api/users/${userId}`);
  const current = user.user?.credits?.actualBalance ?? user.user?.credits?.balance ?? 0;
  const input = prompt(`当前实际剩余次数：${current}\n输入目标剩余次数，或输入 +10 / -3 调整次数。`, String(current));
  if (input == null) return;
  const value = input.trim();
  if (!value) return;

  const payload = value.startsWith('+') || value.startsWith('-')
    ? { amount: Number(value), reason: 'admin_adjust' }
    : { balance: Number(value), reason: 'admin_set_balance' };

  if (!Number.isFinite(payload.amount ?? payload.balance)) {
    alert('请输入有效数字');
    return;
  }

  await api(`/admin/api/users/${userId}/credits`, { method: 'POST', body: JSON.stringify(payload) });
  await loadUsers();
}

async function login() {
  $('#loginError').textContent = '';
  try {
    const data = await api('/admin/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#usernameInput').value,
        password: $('#passwordInput').value
      })
    });
    state.token = data.accessToken;
    localStorage.setItem('adminToken', state.token);
    showApp(true);
    setView('dashboard');
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
}

document.addEventListener('click', (event) => {
  const actionTarget = event.target.closest('[data-action]');
  if (actionTarget) {
    handleAction(actionTarget.dataset.action, actionTarget.dataset.id);
    return;
  }
  const navTarget = event.target.closest('[data-view]');
  if (navTarget) {
    setView(navTarget.dataset.view);
  }
});

$('#loginBtn').addEventListener('click', login);
$('#refreshBtn').addEventListener('click', loadCurrentView);
$('#logoutBtn').addEventListener('click', async () => {
  try {
    await api('/admin/api/logout', { method: 'POST', body: '{}' });
  } catch {}
  localStorage.removeItem('adminToken');
  state.token = '';
  showApp(false);
});
$('#closeDialogBtn').addEventListener('click', () => $('#detailDialog').close());

showApp(Boolean(state.token));
if (state.token) setView('dashboard');
