const { request, showToast, resolveAssetUrl } = require('../../utils/api');

Page({
  data: {
    image: '',
    posterUrl: '',
    shareImage: '',
    creating: false
  },

  onShow() {
    const app = getApp();
    const image = resolveAssetUrl(app.globalData.previewImage || app.globalData.currentTask?.images?.[0]?.url || '');
    this.setData({ image });
    this.createPoster(image);
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/works/index' })
    });
  },

  createPoster(image) {
    if (!image) return;
    this.setData({ creating: true });
    request({
      url: '/share/create-poster',
      method: 'POST',
      data: {
        imageUrl: image,
        taskId: getApp().globalData.currentTask?.taskId || ''
      }
    }).then((res) => {
      const posterUrl = resolveAssetUrl(res.posterUrl || image);
      this.prepareShareImage(posterUrl || image);
    }).catch((error) => {
      console.warn('[share-poster] create poster failed', error);
      this.prepareShareImage(image);
    });
  },

  prepareShareImage(image) {
    if (!image) {
      this.setData({ creating: false });
      return;
    }
    if (!/^https?:\/\//i.test(image)) {
      this.setData({ posterUrl: image, shareImage: image, creating: false });
      return;
    }
    wx.downloadFile({
      url: image,
      success: (res) => {
        const localImage = res.statusCode === 200 && res.tempFilePath ? res.tempFilePath : image;
        this.setData({ posterUrl: image, shareImage: localImage });
      },
      fail: () => {
        this.setData({ posterUrl: image, shareImage: image });
      },
      complete: () => {
        this.setData({ creating: false });
      }
    });
  },

  reward() {
    request({
      url: '/share/reward',
      method: 'POST',
      data: { channel: 'wechat_session' }
    }).then(() => {
      showToast('分享奖励已领取');
      wx.switchTab({ url: '/pages/home/index' });
    }).catch(() => {
      showToast('分享成功');
    });
  },

  onShareAppMessage() {
    this.reward();
    return {
      title: '我生成了一组 AI 写真',
      path: '/pages/home/index',
      imageUrl: this.data.shareImage || this.data.posterUrl || this.data.image
    };
  }
});
