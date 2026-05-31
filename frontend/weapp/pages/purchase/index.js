const { request, refreshCredits, creditText, showToast } = require('../../utils/api');

Page({
  data: {
    packages: [],
    credits: 0,
    creditText: '0',
    selectedPackageId: '',
    selectedPriceText: '0',
    popularPackageId: '',
    order: null,
    orderPriceText: '0'
  },

  onShow() {
    this.load();
  },

  load() {
    Promise.all([
      request({ url: '/packages' }),
      refreshCredits().catch(() => ({ balance: 0 }))
    ]).then(([packages, credits]) => {
      const displayPackages = this.preparePackages(packages);
      const selected = displayPackages[1] || displayPackages[0] || {};
      this.setData({
        packages: displayPackages,
        credits: credits.balance,
        creditText: creditText(credits),
        selectedPackageId: selected.packageId || '',
        selectedPriceText: selected.priceYuan || '0',
        popularPackageId: selected.packageId || ''
      });
    }).catch((error) => {
      showToast(error.message || '套餐加载失败');
    });
  },

  preparePackages(packages = []) {
    return packages.map((item) => ({
      ...item,
      priceYuan: this.fenToYuan(item.priceFen),
      note: item.credits === 50 ? '加赠 5 次' : item.credits >= 100 ? '超值大满足' : ''
    }));
  },

  fenToYuan(priceFen = 0) {
    const yuan = Number(priceFen || 0) / 100;
    return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2);
  },

  selectPackage(event) {
    const packageId = event.currentTarget.dataset.id;
    const selected = this.data.packages.find((item) => item.packageId === packageId) || {};
    this.setData({
      selectedPackageId: packageId,
      selectedPriceText: selected.priceYuan || '0'
    });
  },

  buySelected() {
    if (!this.data.selectedPackageId) {
      showToast('请选择套餐');
      return;
    }
    this.createOrder(this.data.selectedPackageId);
  },

  createOrder(packageId) {
    wx.showLoading({ title: '创建订单' });
    request({
      url: '/orders',
      method: 'POST',
      data: { packageId }
    }).then((res) => {
      const order = res.order || res;
      getApp().globalData.currentOrder = order;
      this.setData({ order, orderPriceText: this.fenToYuan(order.amountFen) });
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
      this.setData({ order: null, credits: credits.balance, creditText: creditText(credits) });
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
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/profile/index' });
  }
});
