const { showToast } = require('../../utils/api');

Page({
  data: {
    loading: false,
    agreed: true,
    userInfo: null
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: '/pages/splash/index' });
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  chooseAvatar(event) {
    const avatarUrl = event.detail.avatarUrl;
    this.setData({
      userInfo: {
        ...(this.data.userInfo || {}),
        avatarUrl
      }
    });
  },

  onNicknameInput(event) {
    this.setData({
      userInfo: {
        ...(this.data.userInfo || {}),
        nickname: event.detail.value
      }
    });
  },

  login() {
    if (this.data.loading) return;
    if (!this.data.agreed) {
      showToast('请先同意用户协议与隐私政策');
      return;
    }

    this.setData({ loading: true });
    const app = getApp();
    app.login(this.data.userInfo || {})
      .then(() => {
        showToast('登录成功');
        wx.switchTab({ url: '/pages/home/index' });
      })
      .catch((error) => {
        const message = error.message || '登录失败';
        console.warn('[login] failed', message, error);
        showToast(message.includes('timeout') || message.includes('超时') ? '登录超时，请检查网络或后端地址' : message);
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  skipProfile() {
    if (this.data.loading) return;
    this.setData({ userInfo: null });
    this.login();
  },

  openAgreement(event) {
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    wx.navigateTo({ url: '/pages/legal/index' });
  },

  openPrivacy(event) {
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    wx.navigateTo({ url: '/pages/privacy/index' });
  }
});
