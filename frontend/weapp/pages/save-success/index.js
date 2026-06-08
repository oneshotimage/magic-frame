Page({
  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/works/index' })
    });
  },

  home() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  works() {
    wx.switchTab({ url: '/pages/works/index' });
  },

  sharePoster() {
    wx.navigateTo({ url: '/pages/share-poster/index' });
  }
});
