const { request, showToast } = require('../../utils/api');

Page({
  data: {
    preview: '',
    styleCount: 1,
    allChecked: true,
    agreements: [
      { text: '我确认已获得照片中人物授权', checked: true },
      { text: '我确认上传内容合法合规', checked: true },
      { text: '我了解 AI 生成结果存在差异', checked: true }
    ]
  },

  onShow() {
    const app = getApp();
    this.setData({
      preview: app.globalData.uploadDataUrl || '',
      styleCount: Math.max(1, (app.globalData.selectedStyles || []).length)
    });
  },

  toggleAgreement(event) {
    const index = Number(event.currentTarget.dataset.index);
    const agreements = this.data.agreements.map((item, itemIndex) => (
      itemIndex === index ? { ...item, checked: !item.checked } : item
    ));
    this.setData({
      agreements,
      allChecked: agreements.every((item) => item.checked)
    });
  },

  goBack() {
    wx.navigateBack();
  },

  createTask() {
    if (!this.data.allChecked) {
      showToast('请先确认授权与合规声明');
      return;
    }
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
