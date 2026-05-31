const { request, showToast } = require('../../utils/api');

Page({
  data: {
    image: '',
    posterUrl: '',
    creating: false
  },

  onShow() {
    const app = getApp();
    const image = app.globalData.previewImage || app.globalData.currentTask?.images?.[0]?.url || '';
    this.setData({ image });
    this.createPoster(image);
  },

  createPoster(image) {
    if (!image) return;
    this.setData({ creating: true });
    request({
      url: '/share/create-poster',
      method: 'POST',
      data: {
        imageUrl: image,
        templateId: 'warm_portrait'
      }
    }).then((res) => {
      this.setData({ posterUrl: res.posterUrl || image });
    }).catch(() => {
      this.setData({ posterUrl: image });
    }).finally(() => {
      this.setData({ creating: false });
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
      imageUrl: this.data.posterUrl || this.data.image
    };
  }
});
