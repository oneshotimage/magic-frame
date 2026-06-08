const { request, showToast } = require('../../utils/api');

const CATEGORIES = [
  { value: 'generation', label: '生成效果', icon: '✦' },
  { value: 'payment', label: '支付订单', icon: '▭' },
  { value: 'account', label: '账号登录', icon: '♙' },
  { value: 'other', label: '其他', icon: '▦' }
];

Page({
  data: {
    categories: CATEGORIES,
    category: 'generation',
    content: '',
    contentLength: 0,
    contact: '',
    submitting: false
  },

  selectCategory(event) {
    this.setData({ category: event.currentTarget.dataset.value });
  },

  goBack() {
    wx.navigateBack();
  },

  onContentInput(event) {
    const content = event.detail.value;
    this.setData({ content, contentLength: content.length });
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
        category: this.data.category,
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
