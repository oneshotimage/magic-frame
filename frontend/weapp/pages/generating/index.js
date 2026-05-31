const { request, refreshCredits } = require('../../utils/api');
const { styles } = require('../../utils/constants');

Page({
  data: {
    task: {},
    progressDeg: 0,
    providerSummary: '',
    styleNames: styles.reduce((map, item) => {
      map[item.id] = item.name;
      return map;
    }, {})
  },

  onLoad(options) {
    this.taskId = options.taskId || getApp().globalData.currentTask?.taskId;
    this.poll();
  },

  onUnload() {
    clearTimeout(this.timer);
  },

  poll() {
    if (!this.taskId) return;
    request({ url: `/generation/${this.taskId}` }).then((task) => {
      getApp().globalData.currentTask = task;
      this.setData({
        task,
        progressDeg: Math.round(((task.progress || 0) / 100) * 360),
        providerSummary: this.buildProviderSummary(task)
      });
      if (['SUCCESS', 'FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT', 'CANCELLED'].includes(task.status)) {
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
      provider.klProxyConfigured ? '代理：已启用' : ''
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
    this.cancelTask();
  }
});
