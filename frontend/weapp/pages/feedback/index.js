const { request, showToast } = require('../../utils/api');

Page({
  data: {
    content: '',
    contact: '',
    submitting: false
  },

  onContentInput(event) {
    this.setData({ content: event.detail.value });
  },

  onContactInput(event) {
    this.setData({ contact: event.detail.value });
  },

  submit() {
    if (!this.data.content.trim()) {
      showToast('请填写反馈内容');
      return;
    }
    this.setData({ submitting: true });
    request({
      url: '/feedback',
      method: 'POST',
      data: {
        content: this.data.content,
        contact: this.data.contact,
        source: 'weapp'
      }
    }).then(() => {
      showToast('已提交');
      setTimeout(() => wx.navigateBack(), 700);
    }).catch((error) => {
      showToast(error.message || '提交失败');
    }).finally(() => {
      this.setData({ submitting: false });
    });
  }
});
