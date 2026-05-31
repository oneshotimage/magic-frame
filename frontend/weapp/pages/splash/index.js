const { splashImage } = require('../../utils/constants');

Page({
  data: {
    splashImage
  },

  onLoad() {
    getApp().ensureLogin().catch(() => {});
  },

  start() {
    wx.switchTab({ url: '/pages/home/index' });
  }
});
