const { login } = require('./utils/api');

App({
  globalData: {
    apiBaseUrl: 'http://192.168.0.106:8000',
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
    return Promise.reject(new Error('LOGIN_REQUIRED'));
  },

  login(userInfo = {}) {
    return login(userInfo).then((data) => {
      this.globalData.token = data.accessToken;
      this.globalData.user = data.user;
      this.globalData.credits = data.credits;
      wx.setStorageSync('accessToken', data.accessToken);
      wx.setStorageSync('refreshToken', data.refreshToken);
      return this.globalData;
    });
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.user = null;
    this.globalData.credits = null;
    this.globalData.upload = null;
    this.globalData.uploadDataUrl = '';
    this.globalData.currentTask = null;
    this.globalData.previewImage = '';
    this.globalData.currentOrder = null;
    wx.removeStorageSync('accessToken');
    wx.removeStorageSync('refreshToken');
  }
});
