const { styles, heroImage } = require('../../utils/constants');
const { refreshCredits, creditText } = require('../../utils/api');

Page({
  data: {
    styles,
    heroImage,
    credits: {},
    creditText: '0',
    selectedMap: {}
  },

  onShow() {
    wx.hideTabBar({ animation: false, fail() {} });
    const app = getApp();
    app.ensureLogin()
      .then(() => refreshCredits())
      .then((credits) => {
        this.setData({
          credits,
          creditText: creditText(credits),
          selectedMap: this.buildSelectedMap(app.globalData.selectedStyles)
        });
      })
      .catch(() => {
        wx.navigateTo({ url: '/pages/login/index' });
      });
  },

  onHide() {
    wx.showTabBar({ animation: false, fail() {} });
  },

  onUnload() {
    wx.showTabBar({ animation: false, fail() {} });
  },

  buildSelectedMap(ids = []) {
    return ids.reduce((map, id) => {
      map[id] = true;
      return map;
    }, {});
  },

  toggleStyle(event) {
    const id = event.currentTarget.dataset.id;
    const app = getApp();
    const selected = app.globalData.selectedStyles || [];
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : selected.concat(id);
    app.globalData.selectedStyles = next.length ? next : [id];
    this.setData({ selectedMap: this.buildSelectedMap(app.globalData.selectedStyles) });
  },

  goStyle() {
    wx.navigateTo({ url: '/pages/style/index' });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    }
  },

  goUpload() {
    wx.navigateTo({ url: '/pages/upload/index' });
  },

  goWorks() {
    wx.switchTab({ url: '/pages/works/index' });
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/index' });
  },

  goAd() {
    wx.navigateTo({ url: '/pages/ad-reward/index' });
  }
});
