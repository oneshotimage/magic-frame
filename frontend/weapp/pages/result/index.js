const { styles } = require('../../utils/constants');
const { request, refreshCredits, showToast } = require('../../utils/api');

Page({
  data: {
    task: null,
    images: [],
    credits: 0,
    canRetry: false,
    debugText: ''
  },

  onShow() {
    const app = getApp();
    const task = app.globalData.currentTask || {};
    const selected = app.globalData.selectedStyles || [];
    const styleMap = styles.reduce((map, item) => ({ ...map, [item.id]: item }), {});
    const images = (task.images || []).map((item, index) => ({
      ...item,
      name: styleMap[item.style || item.styleId]?.name || selected[index]?.name || `作品 ${index + 1}`
    }));

    this.setData({
      task,
      images,
      credits: app.globalData.credits?.balance || 0,
      canRetry: ['FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT'].includes(task.status),
      debugText: this.buildDebugText(task)
    });

    refreshCredits().then((credits) => {
      this.setData({ credits: credits.balance });
    }).catch(() => {});
  },

  buildDebugText(task) {
    if (!task?.taskId) return '';
    const provider = task.provider || {};
    const images = (task.images || []).map((image) => ({
      style: image.style,
      status: image.status,
      elapsedMs: image.elapsedMs,
      hasUrl: Boolean(image.url),
      errorMessage: image.errorMessage || '',
      provider: image.provider || {}
    }));
    return JSON.stringify({
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      provider,
      images
    }, null, 2);
  },

  preview(event) {
    const { url } = event.currentTarget.dataset;
    if (!url) return;
    getApp().globalData.previewImage = url;
    wx.navigateTo({ url: '/pages/preview/index' });
  },

  retryTask() {
    if (!this.data.task?.taskId) return;
    wx.showLoading({ title: '重新生成中' });
    request({
      url: `/generation/${this.data.task.taskId}/retry`,
      method: 'POST'
    }).then((task) => {
      getApp().globalData.currentTask = task;
      wx.redirectTo({ url: '/pages/generating/index' });
    }).catch((error) => {
      showToast(error.message || '重试失败');
    }).finally(() => {
      wx.hideLoading();
    });
  },

  sharePoster() {
    if (this.data.images[0]?.url) {
      getApp().globalData.previewImage = this.data.images[0].url;
    }
    wx.navigateTo({ url: '/pages/share-poster/index' });
  },

  again() {
    wx.switchTab({ url: '/pages/home/index' });
  }
});
