const { styles, heroImage } = require('../../utils/constants');
const { refreshCredits } = require('../../utils/api');

Page({
  data: {
    styles,
    heroImage,
    credits: {},
    selectedMap: {}
  },

  onShow() {
    const app = getApp();
    app.ensureLogin()
      .then(() => refreshCredits())
      .then((credits) => {
        this.setData({
          credits,
          selectedMap: this.buildSelectedMap(app.globalData.selectedStyles)
        });
      });
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

  goUpload() {
    wx.navigateTo({ url: '/pages/upload/index' });
  },

  goAd() {
    wx.navigateTo({ url: '/pages/ad-reward/index' });
  }
});
