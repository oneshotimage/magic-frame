const { request, showToast } = require('../../utils/api');

Page({
  data: {
    preview: '',
    checks: [
      { label: '真人正面更佳' },
      { label: '光线清晰' },
      { label: '无明显遮挡' }
    ]
  },

  onShow() {
    this.setData({ preview: getApp().globalData.uploadDataUrl });
  },

  validate() {
    const upload = getApp().globalData.upload;
    request({
      url: '/upload/validate',
      method: 'POST',
      data: { imageId: upload.imageId }
    }).then((res) => {
      if (!res.valid) {
        showToast(res.reason || '图片不符合要求');
        return;
      }
      wx.navigateTo({ url: '/pages/agreement/index' });
    });
  },

  reselect() {
    wx.navigateBack();
  }
});
