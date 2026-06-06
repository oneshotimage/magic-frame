const { request, refreshCredits } = require('../../utils/api');
const { styles } = require('../../utils/constants');

Page({
  data: {
    task: {},
    progressDeg: 0,
    providerSummary: '',
    elapsedText: '00:00',
    styleNames: styles.reduce((map, item) => {
      map[item.id] = item.name;
      return map;
    }, {})
  },

  onLoad(options) {
    this.taskId = options.taskId || getApp().globalData.currentTask?.taskId;
    this.startElapsedTimer();
    this.poll();
  },

  onUnload() {
    clearTimeout(this.timer);
    clearInterval(this.elapsedTimer);
  },

  startElapsedTimer() {
    clearInterval(this.elapsedTimer);
    this.updateElapsedText();
    this.elapsedTimer = setInterval(() => this.updateElapsedText(), 1000);
  },

  updateElapsedText() {
    const task = this.data.task || {};
    const startedAt = task.startedAt || task.provider?.startedAt || task.createdAt || '';
    const completedAt = task.completedAt || task.provider?.completedAt || '';
    let elapsedMs = Number(task.elapsedMs || 0);
    if (startedAt && !completedAt && !['SUCCESS', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED'].includes(task.status)) {
      const started = new Date(startedAt).getTime();
      if (!Number.isNaN(started)) {
        elapsedMs = Date.now() - started;
      }
    }
    this.setData({ elapsedText: this.formatElapsed(elapsedMs) });
  },

  formatElapsed(ms = 0) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  },

  poll() {
    if (!this.taskId) return;
    request({ url: `/generation/${this.taskId}` }).then((task) => {
      getApp().globalData.currentTask = task;
      this.setData({
        task,
        progressDeg: Math.round(((task.progress || 0) / 100) * 360),
        elapsedText: this.formatElapsed(task.elapsedMs || 0),
        providerSummary: this.buildProviderSummary(task)
      });
      if (['SUCCESS', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED'].includes(task.status)) {
        clearInterval(this.elapsedTimer);
        refreshCredits().finally(() => {
          setTimeout(() => wx.redirectTo({ url: '/pages/result/index' }), 500);
        });
        return;
      }
      this.timer = setTimeout(() => this.poll(), 1200);
    });
  },

  buildProviderSummary(task) {
    const provider = task.provider || {};
    const parts = [
      provider.generationMode ? `模式：${provider.generationMode}` : '',
      provider.klImageModel ? `模型：${provider.klImageModel}` : '',
      provider.klImageEndpoint ? `接口：${provider.klImageEndpoint}` : '',
      provider.klTokenConfigured === false ? 'Token：未配置' : '',
      provider.klProxyConfigured ? '代理：已启用' : '',
      task.elapsedMs ? `耗时：${this.formatElapsed(task.elapsedMs)}` : ''
    ].filter(Boolean);
    return parts.join(' · ');
  },

  cancelTask() {
    request({ url: `/generation/${this.taskId}/cancel`, method: 'POST' }).then((task) => {
      getApp().globalData.currentTask = task;
      wx.redirectTo({ url: '/pages/result/index' });
    });
  },

  viewResult() {
    wx.navigateTo({ url: '/pages/result/index' });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/index' });
  }
});
