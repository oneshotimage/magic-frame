const { styles } = require('../../utils/constants');
const { request, refreshCredits, creditText, showToast } = require('../../utils/api');

Page({
  data: {
    task: null,
    images: [],
    credits: 0,
    creditText: '0',
    canRetry: false,
    debugText: ''
  },

  onShow() {
    const app = getApp();
    const task = app.globalData.currentTask || {};
    const selected = app.globalData.selectedStyles || [];
    const styleMap = styles.reduce((map, item) => ({ ...map, [item.id]: item }), {});
    const images = (task.images || []).map((item, index) => {
      const styleId = item.style || item.styleId;
      const isSvg = typeof item.url === 'string' && (item.url.includes('.svg') || item.url.startsWith('data:image/svg'));
      return {
        ...item,
        isSvg,
        displayImage: item.url && !isSvg,
        theme: styleMap[styleId]?.theme || ['realistic', 'pixar', 'handdrawn', 'comic'][index % 4],
        name: styleMap[styleId]?.name || selected[index]?.name || `作品 ${index + 1}`
      };
    });

    this.setData({
      task,
      images,
      credits: app.globalData.credits?.balance || 0,
      creditText: creditText(app.globalData.credits),
      canRetry: ['FAILED', 'PARTIAL_SUCCESS', 'TIMEOUT'].includes(task.status),
      debugText: this.buildDebugText(task)
    });

    refreshCredits().then((credits) => {
      this.setData({ credits: credits.balance, creditText: creditText(credits) });
    }).catch(() => {});
  },

  buildDebugText(task) {
    if (!task?.taskId) return '';
    if (!['FAILED', 'TIMEOUT', 'CANCELLED'].includes(task.status)) return '';
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

  saveAll() {
    const urls = this.data.images.map((item) => item.displayImage && item.url).filter(Boolean);
    if (!urls.length) {
      showToast('暂无可保存图片');
      return;
    }
    wx.showLoading({ title: '保存中' });
    this.saveImages(urls)
      .then(() => showToast('已保存到相册'))
      .catch((error) => {
        console.warn(error);
        showToast('保存失败，请先授权相册');
      })
      .finally(() => wx.hideLoading());
  },

  saveImages(urls) {
    return urls.reduce((chain, url) => chain.then(() => this.saveOneImage(url)), Promise.resolve());
  },

  saveOneImage(url) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url,
        success: (res) => {
          if (res.statusCode !== 200 || !res.tempFilePath) {
            reject(new Error('download failed'));
            return;
          }
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: resolve,
            fail: reject
          });
        },
        fail: reject
      });
    });
  },

  again() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  goBack() {
    wx.switchTab({ url: '/pages/home/index' });
  }
});
