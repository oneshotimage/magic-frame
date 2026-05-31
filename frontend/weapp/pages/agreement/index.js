const { request, showToast } = require('../../utils/api');

Page({
  createTask() {
    const app = getApp();
    const upload = app.globalData.upload;
    if (!upload) {
      showToast('请先上传照片');
      return;
    }
    wx.showLoading({ title: '创建任务' });
    request({
      url: '/generation/create',
      method: 'POST',
      data: {
        inputImageId: upload.imageId,
        styles: app.globalData.selectedStyles,
        size: '1024x1024'
      }
    })
      .then((task) => {
        app.globalData.currentTask = task;
        wx.redirectTo({ url: `/pages/generating/index?taskId=${task.taskId}` });
      })
      .catch((error) => {
        showToast(error.message || '创建任务失败');
      })
      .finally(() => wx.hideLoading());
  }
});
