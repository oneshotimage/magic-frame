const { avatarImage } = require('../../utils/constants');
const { request, refreshCredits, creditText, showToast } = require('../../utils/api');

Page({
  data: {
    user: null,
    credits: 0,
    creditText: '0',
    avatarImage
  },

  onShow() {
    const app = getApp();
    this.setData({
      user: app.globalData.user,
      credits: app.globalData.credits?.balance || 0,
      creditText: creditText(app.globalData.credits)
    });
    refreshCredits().then((credits) => {
      this.setData({ credits: credits.balance, creditText: creditText(credits) });
    }).catch(() => {});
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

  goFaq() {
    wx.navigateTo({ url: '/pages/faq/index' });
  },

  goLegal() {
    wx.navigateTo({ url: '/pages/legal/index' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/index' });
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
  }
});
