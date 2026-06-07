const { request, refreshCredits } = require('../../utils/api');
const { styles } = require('../../utils/constants');

Page({
  data: {
    task: {},
    progressDeg: 0,
    displayProgress: 0,
    providerSummary: '',
    elapsedText: '00:00',
    remainingText: '01:00',
    estimateText: '预计约 01:00 完成',
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
    const estimate = this.buildProgressEstimate(task, elapsedMs);
    this.setData({
      elapsedText: this.formatElapsed(elapsedMs),
      remainingText: this.formatElapsed(estimate.remainingMs),
      estimateText: `预计还需 ${this.formatElapsed(estimate.remainingMs)}`,
      displayProgress: estimate.progress,
      progressDeg: Math.round((estimate.progress / 100) * 360)
    });
  },

  buildProgressEstimate(task = {}, elapsedMs = 0) {
    const terminal = ['SUCCESS', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED'].includes(task.status);
    const images = Array.isArray(task.images) ? task.images : [];
    const imageCount = Math.max(1, images.length || 1);
    const secondsPerImage = Number(task.generationSecondsPerImage || task.provider?.generationSecondsPerImage || 60);
    const estimatedTotalMs = Number(task.estimatedTotalMs || imageCount * secondsPerImage * 1000);
    if (terminal) {
      return { progress: 100, remainingMs: 0, estimatedTotalMs };
    }
    const completedCount = images.filter((image) => ['SUCCESS', 'FAILED'].includes(image.status)).length;
    const elapsedProgress = Math.floor(Math.min(95, Math.max(0, elapsedMs / Math.max(1, estimatedTotalMs) * 95)));
    const completedProgress = Math.floor(Math.min(95, completedCount / imageCount * 95));
    const progress = Math.max(Number(task.progress || 0), Number(task.estimatedProgress || 0), elapsedProgress, completedProgress);
    const remainingMs = Math.max(0, Number(task.estimatedRemainingMs || estimatedTotalMs - elapsedMs));
    return { progress: Math.min(99, Math.round(progress)), remainingMs, estimatedTotalMs };
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
        providerSummary: this.buildProviderSummary(task)
      });
      this.updateElapsedText();
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
      task.generationSecondsPerImage ? `估算：${task.generationSecondsPerImage}秒/张` : '',
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

  goWorks() {
    wx.switchTab({ url: '/pages/works/index' });
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
