Page({
  data: {
    rules: [
      '您必须年满18周岁或在法定监护人的同意下使用本服务。',
      '禁止上传包含淫秽、暴力、侵权或任何违反国家法律法规的图像内容。',
      '不得利用本服务生成的影像从事诽谤、诈骗或其他侵犯他人合法权益的活动。',
      '您应对使用账号所进行的一切行为负责，请妥善保管账号及密码。'
    ]
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.switchTab({ url: '/pages/profile/index' });
  },

  agree() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/profile/index' });
      }
    });
  }
});
