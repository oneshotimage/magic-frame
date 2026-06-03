Page({
  skip() {
    wx.navigateTo({ url: '/pages/login/index' });
  },

  start() {
    const app = getApp();
    const loggedIn = Boolean(app.globalData.token || wx.getStorageSync('accessToken'));
    if (loggedIn) {
      wx.switchTab({ url: '/pages/home/index' });
      return;
    }
    wx.navigateTo({ url: '/pages/login/index' });
  }
});
