const { showToast, resolveAssetUrl } = require('../../utils/api');

Page({
  data: {
    image: ''
  },

  onShow() {
    this.setData({ image: resolveAssetUrl(getApp().globalData.previewImage || '') });
  },

  saveImage() {
    const image = this.data.image;
    if (!image) {
      showToast('没有可保存的图片');
      return;
    }

    if (!/^https?:\/\//i.test(image)) {
      wx.navigateTo({ url: '/pages/save-success/index' });
      return;
    }

    wx.showLoading({ title: '保存中' });
    wx.downloadFile({
      url: image,
      success: (download) => {
        if (download.statusCode !== 200) {
          showToast('图片下载失败');
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: download.tempFilePath,
          success: () => wx.navigateTo({ url: '/pages/save-success/index' }),
          fail: () => showToast('请允许保存到相册')
        });
      },
      fail: () => showToast('图片下载失败'),
      complete: () => wx.hideLoading()
    });
  },

  sharePoster() {
    wx.navigateTo({ url: '/pages/share-poster/index' });
  },

  onShareAppMessage() {
    return {
      title: '我的 AI 写真作品',
      path: '/pages/home/index'
    };
  }
});
