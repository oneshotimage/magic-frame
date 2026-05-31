const { styles } = require('../../utils/constants');

Page({
  data: {
    styles,
    selectedMap: {}
  },

  onShow() {
    this.sync();
  },

  sync() {
    const selected = getApp().globalData.selectedStyles || [];
    this.setData({
      selectedMap: selected.reduce((map, id) => {
        map[id] = true;
        return map;
      }, {})
    });
  },

  toggleStyle(event) {
    const id = event.currentTarget.dataset.id;
    const app = getApp();
    const selected = app.globalData.selectedStyles || [];
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : selected.concat(id);
    app.globalData.selectedStyles = next.length ? next : [id];
    this.sync();
  },

  next() {
    wx.navigateTo({ url: '/pages/upload/index' });
  }
});
