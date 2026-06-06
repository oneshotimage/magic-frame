const { login } = require('./utils/api');

App({
  globalData: {
    // Local LAN HTTP is only for developer-tool debugging. Real devices should use HTTPS.
    // apiBaseUrl: 'http://192.168.123.211:8000',
    apiBaseUrl: "https://images-3-264959-8-1439090877.sh.run.tcloudbase.com",
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

  onPageNotFound(res = {}) {
    console.warn('[app] page not found, fallback to home', {
      path: res.path || '',
      query: res.query || {},
      isEntryPage: Boolean(res.isEntryPage)
    });
    wx.switchTab({ url: '/pages/home/index' });
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
