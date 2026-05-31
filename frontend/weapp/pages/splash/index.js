const { splashImage } = require('../../utils/constants');

Page({
  data: {
    splashImage,
    loggedIn: false
  },

  onShow() {
    this.setData({ loggedIn: Boolean(getApp().globalData.token || wx.getStorageSync('accessToken')) });
  },

  start() {
    if (this.data.loggedIn) {
      wx.switchTab({ url: '/pages/home/index' });
      return;
    }
    wx.navigateTo({ url: '/pages/login/index' });
  }
});
