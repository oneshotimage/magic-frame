const { avatarImage } = require('../../utils/constants');
const { request, refreshCredits, creditText, logout, showToast } = require('../../utils/api');

Page({
  data: {
    user: null,
    loggedIn: false,
    credits: 0,
    creditText: '0',
    actualCreditText: '0',
    userIdText: '',
    avatarImage
  },

  onShow() {
    wx.hideTabBar({ animation: false, fail() {} });
    const app = getApp();
    const loggedIn = Boolean(app.globalData.token || wx.getStorageSync('accessToken'));
    if (!loggedIn) {
      this.setData({
        user: null,
        loggedIn: false,
        credits: 0,
        creditText: '0',
        actualCreditText: '0',
        userIdText: ''
      });
      return;
    }
    this.setData({
      loggedIn: true,
      user: app.globalData.user,
      credits: app.globalData.credits?.balance || 0,
      creditText: creditText(app.globalData.credits),
      actualCreditText: this.actualCreditText(app.globalData.credits),
      userIdText: this.formatUserId(app.globalData.user?.userId)
    });
    Promise.all([
      request({ url: '/user/profile' }).then((user) => {
        app.globalData.user = user;
        this.setData({ user, userIdText: this.formatUserId(user.userId) });
      }).catch(() => {}),
      refreshCredits().then((credits) => {
        this.setData({
          credits: credits.balance,
          creditText: creditText(credits),
          actualCreditText: this.actualCreditText(credits)
        });
      }).catch(() => {})
    ]);
  },

  onHide() {
    wx.showTabBar({ animation: false, fail() {} });
  },

  onUnload() {
    wx.showTabBar({ animation: false, fail() {} });
  },

  formatUserId(userId = '') {
    if (!userId) return '未绑定';
    return userId.length > 12 ? `${userId.slice(0, 6)}...${userId.slice(-4)}` : userId;
  },

  actualCreditText(credits) {
    if (!credits) return '0';
    return String(credits.actualBalance ?? credits.balance ?? credits.totalCredits ?? 0);
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/index' });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/index' });
  },

  editProfile() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '输入昵称',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        request({
          url: '/user/profile',
          method: 'PATCH',
          data: { nickname: res.content }
        }).then((user) => {
          getApp().globalData.user = user;
          this.setData({ user });
          showToast('已更新');
        }).catch(() => showToast('更新失败'));
      }
    });
  },

  goPurchase() {
    wx.navigateTo({ url: '/pages/purchase/index' });
  },

  goWorks() {
    wx.switchTab({ url: '/pages/works/index' });
  },

  goOrders() {
    wx.navigateTo({ url: '/pages/orders/index' });
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  goFaq() {
    wx.navigateTo({ url: '/pages/faq/index' });
  },

  goLegal() {
    wx.navigateTo({ url: '/pages/legal/index' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' });
  },

  goAd() {
    wx.navigateTo({ url: '/pages/ad-reward/index' });
  },

  deleteUser() {
    wx.showModal({
      title: '删除账号',
      content: '删除后会清空本地登录态，开发环境可重新登录。',
      confirmColor: '#BA1A1A',
      success: (res) => {
        if (!res.confirm) return;
        request({ url: '/user/delete', method: 'POST' }).finally(() => {
          wx.removeStorageSync('accessToken');
          const app = getApp();
          app.globalData.token = '';
          app.globalData.user = null;
          wx.reLaunch({ url: '/pages/splash/index' });
        });
      }
    });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后当前设备会清空登录态，作品和订单仍保留在账号下。',
      success: (res) => {
        if (!res.confirm) return;
        logout().finally(() => {
          showToast('已退出登录');
          this.setData({
            user: null,
            loggedIn: false,
            credits: 0,
            creditText: '0',
            actualCreditText: '0',
            userIdText: ''
          });
          wx.reLaunch({ url: '/pages/splash/index' });
        });
      }
    });
  }
});
