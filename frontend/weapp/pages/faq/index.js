const FAQS = [
  {
    q: '如何获得更多生成次数？',
    a: '可以在“我的”页面进入充值中心购买生成点数，也可以关注活动入口领取限时赠送次数。'
  },
  {
    q: '生成效果不理想怎么办？',
    a: '建议重新上传五官清晰、光线充足的正面人像照，并尽量避免遮挡、强滤镜或多人同框。'
  },
  {
    q: '照片上传失败提示什么原因？',
    a: '通常是图片过大、网络不稳定或本地临时文件已过期。请重新选择图片，并保持在页面内完成上传。'
  },
  {
    q: '支付遇到问题如何解决？',
    a: '请先确认微信支付状态和网络连接。如果订单已扣款但次数未到账，可联系客服协助核对。'
  }
];

Page({
  data: {
    keyword: '',
    activeIndex: 0,
    faqs: FAQS,
    filteredFaqs: FAQS
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/profile/index' });
  },

  onSearch(event) {
    const keyword = (event.detail.value || '').trim();
    const filteredFaqs = keyword
      ? this.data.faqs.filter((item) => item.q.includes(keyword) || item.a.includes(keyword))
      : this.data.faqs;
    this.setData({
      keyword,
      filteredFaqs,
      activeIndex: filteredFaqs.length ? 0 : -1
    });
  },

  toggleFaq(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ activeIndex: this.data.activeIndex === index ? -1 : index });
  }
});
