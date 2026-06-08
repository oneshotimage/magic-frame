const { request, refreshCredits, creditText, showToast } = require('../../utils/api');

Page({
  data: {
    credits: 0,
    creditText: '0',
    loading: false
  },

  onShow() {
    refreshCredits().then((credits) => {
      this.setData({ credits: credits.balance, creditText: creditText(credits) });
    }).catch(() => {});
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: '/pages/profile/index' })
    });
  },

  completeAd() {
    this.setData({ loading: true });
    request({
      url: '/credits/reward-ad',
      method: 'POST',
      data: {
        adUnitId: 'dev_reward_video',
        adEventId: `ad_${Date.now()}`,
        completed: true
      }
    }).then((res) => {
      const credits = res.credits || res;
      getApp().globalData.credits = credits;
      this.setData({ credits: credits.balance, creditText: creditText(credits) });
      showToast('奖励已到账');
      wx.switchTab({ url: '/pages/home/index' });
    }).catch((error) => {
      showToast(error.message || '领取失败');
    }).finally(() => {
      this.setData({ loading: false });
    });
  }
});
