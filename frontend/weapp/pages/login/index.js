const { splashImage } = require('../../utils/constants');
const { showToast } = require('../../utils/api');

Page({
  data: {
    splashImage,
    loading: false,
    agreed: true,
    userInfo: null
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
        showToast(error.message || '登录失败');
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  skipProfile() {
    this.setData({ userInfo: null });
    this.login();
  },

  openLegal() {
    wx.navigateTo({ url: '/pages/legal/index' });
  }
});
