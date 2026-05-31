const { request, showToast } = require('../../utils/api');

Page({
  data: {
    orders: [],
    loading: false
  },

  onShow() {
    this.load();
  },

  load() {
    this.setData({ loading: true });
    request({ url: '/orders' }).then((res) => {
      const orders = res.items || res || [];
      this.setData({ orders });
    }).catch((error) => {
      showToast(error.message || '订单加载失败');
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  closeOrder(event) {
    const orderId = event.currentTarget.dataset.id;
    request({ url: `/orders/${orderId}/close`, method: 'POST' }).then(() => {
      showToast('订单已关闭');
      this.load();
    }).catch(() => showToast('关闭失败'));
  },

  purchase() {
    wx.navigateTo({ url: '/pages/purchase/index' });
  }
});
