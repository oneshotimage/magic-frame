const { request, refreshCredits, showToast } = require('../../utils/api');

Page({
  data: {
    packages: [],
    credits: 0,
    order: null
  },

  onShow() {
    this.load();
  },

  load() {
    Promise.all([
      request({ url: '/packages' }),
      refreshCredits().catch(() => ({ balance: 0 }))
    ]).then(([packages, credits]) => {
      this.setData({ packages, credits: credits.balance });
    }).catch((error) => {
      showToast(error.message || '套餐加载失败');
    });
  },

  createOrder(event) {
    const packageId = event.currentTarget.dataset.id;
    wx.showLoading({ title: '创建订单' });
    request({
      url: '/orders',
      method: 'POST',
      data: { packageId }
    }).then((res) => {
      const order = res.order || res;
      getApp().globalData.currentOrder = order;
      this.setData({ order });
    }).catch((error) => {
      showToast(error.message || '创建订单失败');
    }).finally(() => {
      wx.hideLoading();
    });
  },

  payOrder() {
    const orderId = this.data.order?.orderId;
    if (!orderId) return;
    wx.showLoading({ title: '支付确认' });
    request({
      url: '/payment/wechat/notify',
      method: 'POST',
      data: {
        orderId,
        transactionId: `dev_${Date.now()}`,
        paid: true
      }
    }).then(() => refreshCredits()).then((credits) => {
      this.setData({ order: null, credits: credits.balance });
      showToast('购买成功');
    }).catch((error) => {
      showToast(error.message || '支付失败');
    }).finally(() => {
      wx.hideLoading();
    });
  },

  closeOrder() {
    const orderId = this.data.order?.orderId;
    if (!orderId) return;
    request({ url: `/orders/${orderId}/close`, method: 'POST' }).then(() => {
      this.setData({ order: null });
      showToast('订单已关闭');
    }).catch(() => showToast('关闭失败'));
  }
});
