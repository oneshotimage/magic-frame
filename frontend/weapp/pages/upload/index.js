const { uploadLocalImage, request, demoImageDataUrl, showToast } = require('../../utils/api');

Page({
  data: {
    preview: '',
    canvasWidth: 1,
    canvasHeight: 1
  },

  choosePhoto(sourceType = ['album', 'camera']) {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType,
      success: (res) => {
        const tempFilePath = res.tempFilePaths && res.tempFilePaths[0];
        if (!tempFilePath) return;
        wx.showLoading({ title: '上传中' });
        this.resizeForUpload(tempFilePath)
          .then((uploadPath) => uploadLocalImage(uploadPath))
          .then(({ upload, dataUrl }) => {
            const app = getApp();
            app.globalData.upload = upload;
            app.globalData.uploadDataUrl = dataUrl;
            this.setData({ preview: dataUrl });
          })
          .catch((error) => {
            console.warn(error);
            showToast(error.message || '上传失败，请重试');
          })
          .finally(() => wx.hideLoading());
      }
    });
  },

  resizeForUpload(filePath) {
    return new Promise((resolve) => {
      wx.getImageInfo({
        src: filePath,
        success: (info) => {
          const maxSide = 512;
          const width = info.width || maxSide;
          const height = info.height || maxSide;
          const scale = Math.min(1, maxSide / Math.max(width, height));
          const targetWidth = Math.max(1, Math.round(width * scale));
          const targetHeight = Math.max(1, Math.round(height * scale));
          this.setData({ canvasWidth: targetWidth, canvasHeight: targetHeight }, () => {
            const ctx = wx.createCanvasContext('resizeCanvas', this);
            ctx.drawImage(filePath, 0, 0, targetWidth, targetHeight);
            ctx.draw(false, () => {
              wx.canvasToTempFilePath({
                canvasId: 'resizeCanvas',
                x: 0,
                y: 0,
                width: targetWidth,
                height: targetHeight,
                destWidth: targetWidth,
                destHeight: targetHeight,
                fileType: 'jpg',
                quality: 0.35,
                success: (res) => resolve(res.tempFilePath || filePath),
                fail: () => resolve(filePath)
              }, this);
            });
          });
        },
        fail: () => resolve(filePath)
      });
    });
  },

  chooseAlbum() {
    this.choosePhoto(['album']);
  },

  chooseCamera() {
    this.choosePhoto(['camera']);
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
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/home/index' });
  }
});
