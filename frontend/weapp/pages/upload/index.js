const { uploadLocalImage, request, demoImageDataUrl, showToast } = require('../../utils/api');

Page({
  data: {
    preview: ''
  },

  choosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        wx.showLoading({ title: '上传中' });
        uploadLocalImage(file.tempFilePath)
          .then(({ upload, dataUrl }) => {
            const app = getApp();
            app.globalData.upload = upload;
            app.globalData.uploadDataUrl = dataUrl;
            this.setData({ preview: dataUrl });
          })
          .catch((error) => {
            console.warn(error);
            showToast('上传失败，请重试');
          })
          .finally(() => wx.hideLoading());
      }
    });
  },

  useDemo() {
    const dataUrl = demoImageDataUrl();
    wx.showLoading({ title: '准备演示图' });
    request({
      url: '/upload/image',
      method: 'POST',
      data: {
        dataUrl,
        width: 1024,
        height: 1024,
        sizeBytes: dataUrl.length
      }
    })
      .then((upload) => {
        const app = getApp();
        app.globalData.upload = upload;
        app.globalData.uploadDataUrl = dataUrl;
        this.setData({ preview: dataUrl });
      })
      .finally(() => wx.hideLoading());
  },

  next() {
    const upload = getApp().globalData.upload;
    if (!upload) {
      showToast('请先选择照片');
      return;
    }
    wx.navigateTo({ url: '/pages/confirm/index' });
  }
});
