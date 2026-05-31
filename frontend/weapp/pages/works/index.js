const { request, showToast } = require('../../utils/api');

Page({
  data: {
    tasks: [],
    images: [],
    loading: false
  },

  onShow() {
    this.load();
  },

  load() {
    this.setData({ loading: true });
    request({ url: '/generation/history' }).then((res) => {
      const tasks = res.items || res || [];
      const images = [];
      tasks.forEach((task) => {
        (task.images || []).forEach((image) => {
          images.push({ ...image, taskId: task.taskId, createdAt: task.createdAt });
        });
      });
      this.setData({ tasks, images });
    }).catch((error) => {
      showToast(error.message || '作品加载失败');
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  preview(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    getApp().globalData.previewImage = url;
    wx.navigateTo({ url: '/pages/preview/index' });
  },

  create() {
    wx.switchTab({ url: '/pages/home/index' });
  }
});
