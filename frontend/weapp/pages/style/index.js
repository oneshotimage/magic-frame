const { styles } = require('../../utils/constants');
const { showToast } = require('../../utils/api');

const filters = [
  { name: '推荐', icon: '✦' },
  { name: '人像', icon: '♙' },
  { name: '插画', icon: '◌' }
];

function buildSelectedMap(selected) {
  return selected.reduce((map, id) => {
    map[id] = true;
    return map;
  }, {});
}

Page({
  data: {
    styles,
    featuredStyle: styles.find((item) => item.id === 'realistic') || styles[0],
    filters,
    activeFilter: '推荐',
    selectedMap: {},
    selectedCount: 0
  },

  onShow() {
    this.sync();
  },

  sync() {
    const selected = getApp().globalData.selectedStyles || [];
    this.setData({
      selectedMap: buildSelectedMap(selected),
      selectedCount: selected.length
    });
  },

  selectFilter(event) {
    this.setData({ activeFilter: event.currentTarget.dataset.name });
  },

  toggleStyle(event) {
    const id = event.currentTarget.dataset.id;
    const app = getApp();
    const selected = app.globalData.selectedStyles || [];
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : selected.concat(id);
    app.globalData.selectedStyles = next.length ? next : [id];
    this.sync();
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/home/index' })
    });
  },

  next() {
    if (!getApp().globalData.token && !wx.getStorageSync('accessToken')) {
      showToast('请先登录后再制作');
      return;
    }
    wx.navigateTo({ url: '/pages/upload/index' });
  }
});
