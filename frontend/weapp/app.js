const { login } = require('./utils/api');

App({
  globalData: {
    apiBaseUrl: 'http://localhost:4180',
    token: '',
    user: null,
    credits: null,
    selectedStyles: ['pixar', 'realistic', 'handdrawn', 'comic'],
    upload: null,
    uploadDataUrl: '',
    currentTask: null,
    previewImage: '',
    currentOrder: null
  },

  onLaunch() {
    const token = wx.getStorageSync('accessToken');
    if (token) {
      this.globalData.token = token;
    }
  },

  ensureLogin() {
    if (this.globalData.token) {
      return Promise.resolve(this.globalData);
    }
    return login().then((data) => {
      this.globalData.token = data.accessToken;
      this.globalData.user = data.user;
      this.globalData.credits = data.credits;
      wx.setStorageSync('accessToken', data.accessToken);
      wx.setStorageSync('refreshToken', data.refreshToken);
      return this.globalData;
    });
  }
});
